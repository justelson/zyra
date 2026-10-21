import { stripSidebarBrowserContext } from "../browser-context.mjs";
import { mobileHistoryStart } from './mobile-history-window.mjs';
import { EventEmitter } from 'node:events';
import { ChatModelBackfill } from './chat-model-backfill.mjs';
import { applyEntryModel, newModelPresentation } from './chat-model.mjs';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { getProjectSessionsDir } from "../project-paths.mjs";
import { getAgentServerPaths } from "./paths.mjs";
import {
  findRecordByEntryIndex,
  HISTORY_TOOL_RESULT_BODY_POLICY,
  HISTORY_ON_DEMAND_BODY_POLICY,
  inspectToolResultEntry,
  isDeferrableHistoryRecord,
  projectIndexedHistoryEntries,
  readIndexedHistoryRecord,
  searchIndexedToolResults,
  trackQuestionCalls,
  validateHistoryBodyRef
} from "./history-bodies.mjs";

const INDEX_VERSION = 3;
const READ_BUFFER_SIZE = 1024 * 1024;
const MAX_TITLE_SOURCE_CHARS = 2_000;

export class CanonicalChatIndex extends EventEmitter {
  constructor(options = {}) {
    super();
    this.paths = getAgentServerPaths(options);
    this.file = path.join(this.paths.stateDirectory, "chat-index-v3.json");
    this.record = readIndex(this.file);
    this.projectScans = new Map();
    const modelChanges = new Map();
    this.modelBackfill = new ChatModelBackfill({
      get: id => this.record.chats[id],
      commit: (id, presentation) => {
        const previous = this.record.chats[id];
        if (!previous) return;
        const updated = { ...previous, ...presentation };
        this.record.chats[id] = updated;
        modelChanges.set(id, { previous, updated });
      },
      flush: () => {
        if (!modelChanges.size) return;
        try {
          this.persist();
          this.emit('modelsChanged', { model: true });
        } catch {
          // Metadata is a cache. A failed write must not clobber a newer history scan.
          for (const [id, { previous, updated }] of modelChanges) if (this.record.chats[id] === updated) this.record.chats[id] = previous;
        } finally { modelChanges.clear(); }
      }
    });
  }

  queueModelPresentations(ids) { this.modelBackfill.enqueue(ids); }
  async closeModelBackfill() { this.modelBackfill.close(); await this.modelBackfill.idle(); }
  async listProjects(projects = []) {
    const normalized = [...new Set(projects.map(normalizePath).filter(Boolean))];
    await Promise.all(normalized.map((project) => this.refreshProject(project)));
    return Object.values(this.record.chats)
      .filter((chat) => normalized.some((project) => pathKey(chat.storageProject) === pathKey(project)))
      .map(cloneChat);
  }

  async refreshProject(projectValue) {
    const project = normalizePath(projectValue);
    if (!project) return [];
    const key = pathKey(project);
    const existing = this.projectScans.get(key);
    if (existing) return existing;
    const scan = this.scanProject(project).finally(() => this.projectScans.delete(key));
    this.projectScans.set(key, scan);
    return scan;
  }

  async scanProject(project) {
    const sessionDir = getProjectSessionsDir(project);
    if (!existsSync(sessionDir)) return [];
    const files = readdirSync(sessionDir)
      .filter((name) => name.toLowerCase().endsWith(".jsonl"))
      .map((name) => path.resolve(sessionDir, name));
    const present = new Set(files.map(pathKey));
    let changed = false;

    for (const [chatId, chat] of Object.entries(this.record.chats)) {
      if (pathKey(chat.storageProject) !== pathKey(project)) continue;
      if (chat.agentThread === true && existsSync(chat.sessionPath)) { files.push(chat.sessionPath); present.add(pathKey(chat.sessionPath)); }
      if (present.has(pathKey(chat.sessionPath))) continue;
      delete this.record.chats[chatId];
      changed = true;
    }

    for (const file of files) {
      const stats = statSync(file);
      const current = findBySessionPath(this.record.chats, file);
      if (current && current.fileSize === stats.size && current.fileMtimeMs === stats.mtimeMs) continue;
      const next = scanSessionFile(file, project, current, stats);
      if (!next?.canonicalChatId) continue;
      if (current?.canonicalChatId && current.canonicalChatId !== next.canonicalChatId) {
        delete this.record.chats[current.canonicalChatId];
      }
      this.record.chats[next.canonicalChatId] = next;
      if (current?.agentThread) next.agentThread = true;
      changed = true;
    }

    if (changed) this.persist();
    return Object.values(this.record.chats).filter((chat) => pathKey(chat.storageProject) === pathKey(project)).map(cloneChat);
  }

  get(canonicalChatId) {
    const chat = this.record.chats[String(canonicalChatId || "").trim()];
    return chat ? cloneChat(chat) : null;
  }

  registerAgentThread(file, project) {
    const root = path.resolve(project, '.zyra', 'agent-runs');
    const relative = path.relative(root, path.resolve(file));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Agent transcript must stay inside its project agent-runs directory.');
    const record = scanSessionFile(file, project, this.findByPath(file), statSync(file));
    if (!record?.canonicalChatId) throw new Error('Agent transcript is not durable yet.');
    record.agentThread = true;
    this.record.chats[record.canonicalChatId] = record;
    this.persist();
    return cloneChat(record);
  }

  findByPath(sessionPath) {
    const chat = findBySessionPath(this.record.chats, sessionPath);
    return chat ? cloneChat(chat) : null;
  }

  update(canonicalChatId, patch = {}) {
    const id = String(canonicalChatId || "").trim();
    const chat = this.record.chats[id];
    if (!chat) return null;
    if (patch.title !== undefined) chat.title = normalizeTitle(patch.title, chat.firstMessage);
    if (patch.project !== undefined) chat.project = normalizePath(patch.project) || chat.storageProject;
    if (patch.cwd !== undefined) chat.cwd = normalizePath(patch.cwd) || chat.cwd;
    chat.indexedAt = new Date().toISOString();
    this.persist();
    return cloneChat(chat);
  }

  history(canonicalChatId, options = {}) {
    const chat = this.refreshChat(canonicalChatId, options.toolResultBodies === HISTORY_ON_DEMAND_BODY_POLICY);
    if (!chat) return null;
    const offsets = Array.isArray(chat.entryOffsets) ? chat.entryOffsets : [];
    const limit = Math.max(1, Math.min(2_000, Number(options.limit) || 500));
    const requestedEnd = options.before == null || options.before === ""
      ? offsets.length
      : Math.max(0, Math.min(offsets.length, Number(options.before) || 0));
    let start = Math.max(0, requestedEnd - limit);
    if ([HISTORY_TOOL_RESULT_BODY_POLICY, HISTORY_ON_DEMAND_BODY_POLICY].includes(options.toolResultBodies)) {
      while (start > 0 && includesSortedNumber(chat.toolResultEntryIndexes || [], start)) start -= 1;
    }
    if (options.toolResultBodies === "lazy-mobile-v1" && (options.before == null || options.before === "")) {
      start = mobileHistoryStart({ start, end: requestedEnd,
        bytesAt: index => Number(offsets[index]?.[1]),
        isDeferredTool: index => Boolean(findRecordByEntryIndex(chat.deferredToolResults || [], index)),
        readEntry: index => readIndexedHistoryRecord(chat.sessionPath, offsets[index])?.entry });
    }
    const selected = offsets.slice(start, requestedEnd).map((offset, localIndex) => ({
      entryIndex: start + localIndex,
      offset
    }));
    const entries = projectIndexedHistoryEntries({
      file: chat.sessionPath,
      selected,
      toolResultEntryIndexes: chat.toolResultEntryIndexes,
      deferredToolResults: chat.deferredToolResults,
      options
    });
    return {
      chat: cloneChat(chat),
      entries,
      pageInfo: {
        startCursor: String(start),
        endCursor: String(requestedEnd),
        oldestCursor: start > 0 ? String(start) : null,
        hasOlder: start > 0,
        totalEntries: offsets.length
      }
    };
  }

  refreshChat(canonicalChatId, requireQuestionIdentity = false) {
    const id = String(canonicalChatId || "").trim();
    const current = this.record.chats[id];
    if (!current) return null;
    let stats;
    try { stats = statSync(current.sessionPath); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      delete this.record.chats[id];
      this.persist();
      return null;
    }
    if (current.fileSize === stats.size && current.fileMtimeMs === stats.mtimeMs
      && (!requireQuestionIdentity || hasQuestionIdentity(current))) return current;
    // A runtime can append without a catalog list between successive history reads.
    // Reuse the incremental scanner for this file only, including rewrite detection.
    const next = scanSessionFile(current.sessionPath, current.storageProject, current, stats);
    if (next?.canonicalChatId !== id) {
      delete this.record.chats[id];
      if (next?.canonicalChatId) this.record.chats[next.canonicalChatId] = next;
      this.persist();
      return null;
    }
    this.record.chats[id] = next;
    if (current.agentThread) next.agentThread = true;
    this.persist();
    return next;
  }

  async searchToolResults(canonicalChatId, query, limit) {
    const chat = this.record.chats[String(canonicalChatId || "").trim()];
    if (!chat) return null;
    return searchIndexedToolResults(
      chat.sessionPath,
      chat.deferredToolResults || [],
      chat.entryOffsets || [],
      query,
      limit
    );
  }

  entryBody(canonicalChatId, ref = {}) {
    const chat = this.record.chats[String(canonicalChatId || "").trim()];
    if (!chat) return null;
    const entryIndex = Number(ref.entryIndex);
    if (!Number.isSafeInteger(entryIndex) || entryIndex < 0) throw new Error("Historical tool output reference is invalid.");
    const record = findRecordByEntryIndex(chat.deferredToolResults || [], entryIndex);
    validateHistoryBodyRef(record, ref);
    const offset = chat.entryOffsets?.[entryIndex];
    const hydrated = readIndexedHistoryRecord(chat.sessionPath, offset);
    if (
      !hydrated
      || String(hydrated.entry?.id || "") !== record.entryId
      || hydrated.entrySha256 !== record.entrySha256
    ) throw new Error("Historical tool output reference is stale.");
    return { entry: hydrated.entry };
  }

  snapshot() {
    return structuredClone(this.record);
  }

  persist() {
    this.record.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.file, this.record);
  }
}

function scanSessionFile(file, storageProject, current, stats) {
  const canAppend = current
    && hasQuestionIdentity(current)
    && current.fileSize < stats.size
    && Number.isSafeInteger(current.scanOffset)
    && current.scanOffset <= stats.size
    && Array.isArray(current.entryOffsets)
    && Array.isArray(current.toolResultEntryIndexes)
    && Array.isArray(current.deferredToolResults);
  const record = canAppend
    ? structuredClone(current)
    : {
        version: INDEX_VERSION,
        ...newModelPresentation(),
        canonicalChatId: "",
        sessionPath: path.resolve(file),
        storageProject: normalizePath(storageProject),
        project: normalizePath(storageProject),
        cwd: normalizePath(storageProject),
        title: "New chat",
        firstMessage: "",
        titleCandidates: [],
        createdAt: new Date(stats.birthtimeMs || stats.ctimeMs).toISOString(),
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        messageCount: 0,
        displayMessageCount: 0,
        toolCallCount: 0,
        errorCount: 0,
        imageCount: 0,
        pathEvidence: {},
        entryCount: 0,
        entryOffsets: [],
        toolResultEntryIndexes: [],
        deferredToolResults: [],
        scanOffset: 0
      };
  const start = canAppend ? record.scanOffset : 0;
  const questionCallIds = new Set(canAppend ? record.questionCallIds : []);
  const fd = openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
  let pending = Buffer.alloc(0);
  let absoluteOffset = start;
  let position = start;

  try {
    while (position < stats.size) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, stats.size - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      pending = pending.length ? Buffer.concat([pending, buffer.subarray(0, bytesRead)]) : Buffer.from(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      while (true) {
        const newline = pending.indexOf(10, lineStart);
        if (newline < 0) break;
        const lineBuffer = pending.subarray(lineStart, newline);
        consumeLine(record, decoder.write(lineBuffer), absoluteOffset + lineStart, lineBuffer.length, questionCallIds);
        lineStart = newline + 1;
      }
      absoluteOffset += lineStart;
      pending = Buffer.from(pending.subarray(lineStart));
    }
    if (pending.length > 0 && position >= stats.size) {
      const tail = decoder.end(pending);
      if (consumeLine(record, tail, absoluteOffset, pending.length, questionCallIds)) absoluteOffset += pending.length;
    }
  } finally {
    closeSync(fd);
  }

  record.sessionPath = path.resolve(file);
  record.storageProject = normalizePath(storageProject);
  record.project ||= record.storageProject;
  record.cwd ||= record.project;
  record.title = normalizeTitle(record.title, record.firstMessage);
  record.fileSize = stats.size;
  record.fileMtimeMs = stats.mtimeMs;
  record.scanOffset = absoluteOffset;
  record.questionCallIds = [...questionCallIds];
  record.questionIdentityScanOffset = absoluteOffset;
  record.entryCount = record.entryOffsets.length;
  record.indexedAt = new Date().toISOString();
  return record;
}

function hasQuestionIdentity(record) {
  return Array.isArray(record.questionCallIds) && record.questionIdentityScanOffset === record.scanOffset;
}

function consumeLine(record, line, offset, byteLength, questionCallIds) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return true;
  let entry;
  try { entry = JSON.parse(trimmed); }
  catch { return false; }

  applyEntryModel(record, entry);
  collectPathEvidence(record, entry);
  if (entry.type === "session") {
    if (entry.id) record.canonicalChatId = String(entry.id);
    if (entry.cwd) record.cwd = normalizePath(entry.cwd);
    if (entry.timestamp) record.createdAt = toIso(entry.timestamp, record.createdAt);
    return true;
  }

  const entryIndex = record.entryOffsets.length;
  trackQuestionCalls(entry, questionCallIds);
  record.entryOffsets.push([offset, byteLength]);
  const toolResult = inspectToolResultEntry(entry, entryIndex, byteLength, {
    canonicalChatId: record.canonicalChatId,
    resolvedToolName: questionCallIds.has(entry.message?.toolCallId || entry.message?.tool_call_id) ? "request_user_input" : undefined,
    rawLine: line
  });
  if (toolResult) {
    record.toolResultEntryIndexes.push(entryIndex);
    if (isDeferrableHistoryRecord(toolResult)) record.deferredToolResults.push(toolResult);
  }
  if (entry.type === "session_info") {
    record.title = normalizeTitle(entry.name, record.firstMessage);
  }
  if (entry.type !== "message") return true;
  record.messageCount += 1;
  const message = entry.message && typeof entry.message === "object" ? entry.message : {};
  if (["user", "assistant", "system"].includes(message.role)) record.displayMessageCount = (record.displayMessageCount || 0) + 1;
  const content = Array.isArray(message.content) ? message.content : [];
  record.toolCallCount = (record.toolCallCount || 0) + content.filter((part) => part?.type === "toolCall" && part.name !== 'set_chat_title').length;
  record.imageCount = (record.imageCount || 0) + content.filter((part) => part?.type === "image").length;
  if (message.isError === true || message.stopReason === "error" || message.errorMessage) record.errorCount = (record.errorCount || 0) + 1;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : entry.timestamp;
  record.modifiedAt = toIso(timestamp, record.modifiedAt);
  if (message.role === "user") {
    const userText = stripSidebarBrowserContext(extractText(message.content)).slice(0, MAX_TITLE_SOURCE_CHARS);
    if (!record.firstMessage) {
      record.firstMessage = userText;
      if (!record.title || record.title === "New chat") record.title = normalizeTitle("", record.firstMessage);
    }
    record.titleCandidates ||= [];
    if (isUsefulTitleCandidate(userText) && record.titleCandidates.length < 12 && !record.titleCandidates.includes(userText)) {
      record.titleCandidates.push(userText);
    }
  }
  return true;
}

function collectPathEvidence(record, entry) {
  record.pathEvidence ||= {};
  if (entry?.cwd) addPathEvidence(record, entry.cwd, 3);
  if (entry?.type !== "message") return;
  const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
  for (const part of content) {
    if (part?.type !== "toolCall") continue;
    collectPathValues(record, part.arguments, "", 0);
  }
}

function collectPathValues(record, value, key, depth) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    const keyLooksLikePath = /(?:^|_)(?:path|file|cwd|directory|folder|root|repo|target|source)(?:$|_)/i.test(key);
    for (const candidate of absolutePathCandidates(value, keyLooksLikePath)) addPathEvidence(record, candidate, keyLooksLikePath ? 3 : 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectPathValues(record, item, key, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    collectPathValues(record, childValue, childKey, depth + 1);
  }
}

function absolutePathCandidates(value, wholeValuePreferred) {
  const source = String(value || "").trim();
  const candidates = [];
  if (wholeValuePreferred && path.isAbsolute(source)) candidates.push(source);
  const quoted = /["']([a-zA-Z]:[\\/][^"'\r\n]+)["']/g;
  for (const match of source.matchAll(quoted)) candidates.push(match[1]);
  const unquoted = /(?:^|\s)([a-zA-Z]:[\\/][^\s"'`|<>?*]+)/g;
  for (const match of source.matchAll(unquoted)) candidates.push(match[1]);
  return [...new Set(candidates.map((candidate) => candidate.replace(/[),;]+$/, "").trim()).filter(Boolean))];
}

function addPathEvidence(record, value, weight) {
  const raw = String(value || "").trim();
  if (!raw || !path.isAbsolute(raw)) return;
  const normalized = path.resolve(raw);
  if (/[\\/](?:node_modules|\.git|AppData|\.zyra)[\\/]/i.test(normalized)) return;
  const evidence = record.pathEvidence || (record.pathEvidence = {});
  const keys = Object.keys(evidence);
  if (!(normalized in evidence) && keys.length >= 128) return;
  evidence[normalized] = Math.min(10_000, (Number(evidence[normalized]) || 0) + Math.max(1, Number(weight) || 1));
}

function isUsefulTitleCandidate(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !/^(?:\[zyra managed command update\]|the user sent the following while you were already working|go on\.?$|continue\.?$)/i.test(text);
}

function extractText(content) {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value, fallback) {
  const title = stripSidebarBrowserContext(value).replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 240);
  const first = stripSidebarBrowserContext(fallback).replace(/\s+/g, " ").trim();
  return first.slice(0, 240) || "New chat";
}

function cloneChat(chat) {
  const {
    entryOffsets,
    toolResultEntryIndexes,
    deferredToolResults,
    scanOffset,
    questionCallIds,
    questionIdentityScanOffset,
    fileSize,
    fileMtimeMs,
    indexedAt,
    firstMessage,
    titleCandidates,
    pathEvidence,
    modelPresentationVersion,
    modelNames,
    modelLineage,
    modelLeaf,
    ...publicChat
  } = chat;
  return structuredClone(publicChat);
}

function includesSortedNumber(values, target) {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = values[middle];
    if (candidate === target) return true;
    if (candidate < target) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function findBySessionPath(chats, sessionPath) {
  const key = pathKey(sessionPath);
  return Object.values(chats).find((chat) => pathKey(chat.sessionPath) === key) || null;
}

function normalizePath(value) {
  const raw = String(value || "").trim();
  return raw ? path.resolve(raw) : "";
}

function pathKey(value) {
  const normalized = normalizePath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toIso(value, fallback) {
  const date = typeof value === "number" ? new Date(value) : new Date(value || fallback || 0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function emptyIndex() {
  return { version: INDEX_VERSION, chats: {}, updatedAt: new Date().toISOString() };
}

function readIndex(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value?.version !== INDEX_VERSION || !value.chats || typeof value.chats !== "object") return emptyIndex();
    return { version: INDEX_VERSION, chats: value.chats, updatedAt: String(value.updatedAt || new Date().toISOString()) };
  } catch {
    return emptyIndex();
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, file);
}
