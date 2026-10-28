import { stripSidebarBrowserContext } from "../browser-context.mjs";
import { getAgentConversationKind } from '../agents/contracts.mjs';
import { mobileHistoryStart } from './mobile-history-window.mjs';
import { normalizeChatModel } from './chat-model.mjs';
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { replaceFileWithRetry } from '../file-replacement.mjs';
import path from "node:path";
import { getProjectSessionsDir } from "../project-paths.mjs";
import { CanonicalChatIndex } from "./chat-index.mjs";
import { getAgentServerPaths } from "./paths.mjs";
import { appendCanonicalMessage, findCanonicalMessageReceipt } from "./canonical-message-ledger.mjs";
import { ZyraSessionManager } from "./zyra-session-manager.mjs";
import { projectChatSettlement, automaticSettlementDeadline, currentChatSettlementChoice } from './chat-settlement.mjs';
import { normalizeWorkContextInput, readChatWorkContext } from '../chat-work-context.mjs';
import {
  EAGER_HISTORY_TOOL_RESULTS,
  HISTORY_TOOL_RESULT_BODY_POLICY,
  HISTORY_ON_DEMAND_BODY_POLICY,
  inspectToolResultEntry,
  historyQuestionCallIds,
  projectLoadedHistoryEntries,
  toolResultMatches,
  validateHistoryBodyRef
} from "./history-bodies.mjs";

const CATALOG_VERSION = 1;
const MAX_KNOWN_PROJECTS = 256;
const MAX_ALIASES = 4096;

export class CanonicalChatCatalog {
  constructor(options = {}) {
    this.paths = getAgentServerPaths(options);
    this.loadSessionManager = options.loadSessionManager || null;
    this.index = options.index || new CanonicalChatIndex(options);
    this.record = readCatalog(this.paths.catalogFile);
    this.legacyAgentKinds = new Map();
    this.workContextUpdates = new Map();
  }

  registerProject(projectValue) {
    const project = normalizeProject(projectValue);
    const key = pathKey(project);
    const existing = this.record.projects.find((entry) => pathKey(entry.path) === key);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
    } else {
      this.record.projects.push({ path: project, registeredAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
      this.record.projects = this.record.projects.slice(-MAX_KNOWN_PROJECTS);
    }
    this.persist();
    return project;
  }

  recordAttachment(input = {}) {
    const canonicalChatId = String(input.canonicalChatId || "").trim();
    if (!canonicalChatId) return;
    if (input.project) this.registerProject(input.project);
    const aliases = [input.localThreadId, ...(Array.isArray(input.aliases) ? input.aliases : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const alias of aliases) {
      this.record.aliases[alias] = canonicalChatId;
    }
    const surfaces = this.record.surfaces[canonicalChatId] || [];
    if (input.surface) surfaces.push(String(input.surface).slice(0, 64));
    this.record.surfaces[canonicalChatId] = [...new Set(surfaces)].slice(-8);
    trimRecord(this.record);
    this.persist();
  }

  resolveAlias(value) {
    const normalized = String(value || "").trim();
    return this.record.aliases[normalized] || normalized;
  }

  projectPaths() { return this.record.projects.map(entry => entry.path); }

  nextSettlementDeadline(chat) {
    return automaticSettlementDeadline(chat, this.record.metadata[chat.canonicalChatId] || {});
  }

  async list(options = {}) {
    const requestedProject = options.project ? this.registerProject(options.project) : null;
    const knownProjects = this.record.projects.map((entry) => entry.path);
    const scopedProjects = Array.isArray(options.projects) ? options.projects.slice(0, MAX_KNOWN_PROJECTS).map(normalizeProject) : null;
    const excluded = new Set((Array.isArray(options.excludedProjects) ? options.excludedProjects : []).map(pathKey));
    const projects = (scopedProjects || (requestedProject && options.allProjects !== true
      ? [requestedProject]
      : [...new Set([...(requestedProject ? [requestedProject] : []), ...knownProjects])])).filter(project => !excluded.has(pathKey(project)));
    const indexed = this.loadSessionManager
      ? await this.listInjectedSessions(projects)
      : await this.index.listProjects(projects);
    const byId = new Map();
    for (const indexedChat of indexed) {
      const chat = this.projectChatMetadata(indexedChat);
      const current = byId.get(chat.canonicalChatId);
      if (!current || Date.parse(chat.modifiedAt) > Date.parse(current.modifiedAt)) byId.set(chat.canonicalChatId, chat);
    }
    let chats = [...byId.values()].sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt) || left.canonicalChatId.localeCompare(right.canonicalChatId));
    if (options.includeDeleted !== true) chats = chats.filter((chat) => !chat.deleted);
    if (options.includeArchived !== true) chats = chats.filter((chat) => !chat.archived);
    if (options.includeSubagents !== true) chats = chats.filter(chat => (!chat.agentThread && !chat.agentCreatedBy) || chat.agentConversationKind === 'thread');
    const query = String(options.query || "").trim().toLowerCase();
    if (query) {
      chats = chats.filter((chat) => `${chat.title} ${chat.project} ${chat.cwd} ${chat.canonicalChatId}`.toLowerCase().includes(query));
    }
    if (options.beforeChat && typeof options.beforeChat === 'object') {
      const time = Date.parse(options.beforeChat.modifiedAt);
      const id = String(options.beforeChat.canonicalChatId || '');
      if (!Number.isFinite(time) || !id) throw new Error('Invalid chat cursor.');
      chats = chats.filter(chat => Date.parse(chat.modifiedAt) < time || (Date.parse(chat.modifiedAt) === time && chat.canonicalChatId.localeCompare(id) > 0));
    }
    const limit = Math.max(1, Math.min(2000, Number(options.limit) || 500));
    return chats.slice(0, limit);
  }

  projectChatMetadata(chat) {
    const metadata = this.record.metadata[chat.canonicalChatId] || {};
    let kind = metadata.agentConversationKind;
    if (!kind && metadata.agentCreatedBy && /^\w[\w.-]{0,191}$/.test(metadata.agentCreatedBy)) {
      // Recover old promoted workers and real threads from one known parent
      // fleet snapshot. No label heuristics, project-wide scans or history deletion.
      const file = path.join(chat.storageProject || chat.project, '.zyra', 'agent-runs', metadata.agentCreatedBy, 'fleet.snapshot.json');
      // Validate the cache against the current file; missing/changed snapshots
      // must not keep a legacy independent conversation hidden until restart.
      let kinds = new Map();
      try {
        const stat = statSync(file, { bigint: true });
        const stamp = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${stat.ino}`;
        const cached = this.legacyAgentKinds.get(file);
        if (cached?.stamp === stamp) kinds = cached.kinds;
        else {
          const snapshot = JSON.parse(readFileSync(file, 'utf8'));
          for (const run of Object.values(snapshot.agents || {})) if (run?.providerSessionId) kinds.set(run.providerSessionId, getAgentConversationKind(run));
          if (this.legacyAgentKinds.size >= 128) this.legacyAgentKinds.delete(this.legacyAgentKinds.keys().next().value);
          this.legacyAgentKinds.set(file, { stamp, kinds });
        }
      } catch { this.legacyAgentKinds.delete(file); /* Missing private fleet state never promotes a worker into a chat. */ }
      kind = kinds.get(chat.canonicalChatId);
    }
    return applyMetadata(chat, { ...metadata, agentConversationKind: kind || (chat.agentThread || metadata.agentCreatedBy ? 'subagent' : null) }, this.record);
  }

  async history(selector, options = {}) {
    const chat = await this.find(selector, { project: options.project, allProjects: true });
    if (!chat) return null;
    if (this.loadSessionManager) {
      const SessionManager = await this.loadSessionManager();
      const manager = SessionManager.open(chat.sessionPath, getProjectSessionsDir(chat.storageProject || chat.project));
      const entries = typeof manager.getEntries === "function" ? manager.getEntries() : [];
      const limit = Math.max(1, Math.min(2000, Number(options.limit) || 500));
      const end = options.before == null ? entries.length : Math.max(0, Math.min(entries.length, Number(options.before) || 0));
      let start = Math.max(0, end - limit);
      if ([HISTORY_TOOL_RESULT_BODY_POLICY, HISTORY_ON_DEMAND_BODY_POLICY].includes(options.toolResultBodies)) {
        while (start > 0 && entries[start]?.type === "message" && entries[start].message?.role === "toolResult") start -= 1;
      }
      if (options.toolResultBodies === "lazy-mobile-v1" && options.before == null) {
        start = mobileHistoryStart({ start, end,
          bytesAt: index => Buffer.byteLength(JSON.stringify(entries[index]), "utf8"),
          isDeferredTool: index => entries[index]?.message?.role === "toolResult" && Boolean(entries[index]?.id && entries[index]?.message?.toolCallId && chat.canonicalChatId),
          readEntry: index => entries[index] });
      }
      const toolResultEntryIndexes = [];
      for (let entryIndex = entries.length - 1; entryIndex >= 0 && toolResultEntryIndexes.length < EAGER_HISTORY_TOOL_RESULTS; entryIndex -= 1) {
        if (entries[entryIndex]?.type === "message" && entries[entryIndex].message?.role === "toolResult") {
          toolResultEntryIndexes.unshift(entryIndex);
        }
      }
      const projected = projectLoadedHistoryEntries(entries.slice(start, end), start, {
        ...options,
        canonicalChatId: chat.canonicalChatId,
        questionCallIds: options.toolResultBodies === HISTORY_ON_DEMAND_BODY_POLICY ? historyQuestionCallIds(entries, start) : [],
        toolResultEntryIndexes
      });
      return {
        chat,
        entries: projected,
        pageInfo: {
          startCursor: String(start),
          endCursor: String(end),
          oldestCursor: start > 0 ? String(start) : null,
          hasOlder: start > 0,
          totalEntries: entries.length
        }
      };
    }
    const history = this.index.history(chat.canonicalChatId, options);
    return history ? { ...history, chat: this.projectChatMetadata(history.chat) } : null;
  }

  async searchToolResults(selector, query, options = {}) {
    const chat = await this.find(selector, { project: options.project, allProjects: true });
    if (!chat) return null;
    if (!this.loadSessionManager) return this.index.searchToolResults(chat.canonicalChatId, query, options.limit);
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
    const SessionManager = await this.loadSessionManager();
    const manager = SessionManager.open(chat.sessionPath, getProjectSessionsDir(chat.storageProject || chat.project));
    const entries = typeof manager.getEntries === "function" ? manager.getEntries() : [];
    const matches = [];
    for (let entryIndex = entries.length - 1; entryIndex >= 0 && matches.length < limit; entryIndex -= 1) {
      const entry = entries[entryIndex];
      const message = entry?.type === "message" ? entry.message : null;
      if (!toolResultMatches(entry, needle)) continue;
      matches.push({
        entryIndex,
        entryId: String(entry.id || ""),
        toolCallId: String(message.toolCallId || message.tool_call_id || ""),
        toolName: String(message.toolName || "tool")
      });
    }
    return matches;
  }

  async historyEntryBody(selector, ref = {}, options = {}) {
    const chat = await this.find(selector, { project: options.project, allProjects: true });
    if (!chat) return null;
    if (!this.loadSessionManager) return this.index.entryBody(chat.canonicalChatId, ref);
    const SessionManager = await this.loadSessionManager();
    const manager = SessionManager.open(chat.sessionPath, getProjectSessionsDir(chat.storageProject || chat.project));
    const entries = typeof manager.getEntries === "function" ? manager.getEntries() : [];
    const entryIndex = Number(ref.entryIndex);
    const entry = Number.isSafeInteger(entryIndex) ? entries[entryIndex] : null;
    const rawLine = JSON.stringify(entry ?? null);
    const record = inspectToolResultEntry(entry, entryIndex, Buffer.byteLength(rawLine, "utf8"), {
      canonicalChatId: chat.canonicalChatId,
      rawLine
    });
    validateHistoryBodyRef(record, ref);
    return { entry: cloneJson(entry) };
  }

  async listInjectedSessions(projects) {
    const SessionManager = await this.loadSessionManager();
    const groups = await Promise.all(projects.map(async (project) => {
      try {
        const sessions = await SessionManager.list(project, getProjectSessionsDir(project));
        return sessions.map((session) => projectInjectedSession(project, session));
      } catch {
        return [];
      }
    }));
    return groups.flat();
  }

  async find(selector, options = {}) {
    const normalized = this.resolveAlias(selector);
    const direct = this.loadSessionManager
      ? null
      : this.index.get(normalized) || (path.isAbsolute(normalized) ? this.index.findByPath(normalized) : null);
    if (direct) {
      const chat = this.projectChatMetadata(direct);
      return chat.deleted && options.includeDeleted !== true ? null : chat;
    }
    const chats = await this.list({
      ...options,
      allProjects: options.allProjects === true || path.isAbsolute(normalized),
      includeArchived: true,
      includeSubagents: true,
      includeDeleted: options.includeDeleted === true,
      limit: 2000
    });
    return chats.find((chat) => chat.canonicalChatId === normalized || pathKey(chat.sessionPath) === pathKey(normalized))
      || chats.find((chat) => chat.canonicalChatId.startsWith(normalized))
      || null;
  }

  async appendCanonicalMessage(selector, input) {
    const chat = await this.find(selector, { allProjects: true });
    if (!chat) throw new Error("Canonical chat was not found.");
    const manager = await this.openSessionManager(chat);
    const receipt = appendCanonicalMessage(manager, input);
    if (!this.loadSessionManager) await this.index.refreshProject(chat.storageProject || chat.project);
    return receipt;
  }

  async findCanonicalMessageReceipt(selector, operationId) {
    const chat = await this.find(selector, { allProjects: true });
    if (!chat) return null;
    const manager = await this.openSessionManager(chat);
    return findCanonicalMessageReceipt(manager, operationId);
  }

  async openSessionManager(chat) {
    const sessionDirectory = getProjectSessionsDir(chat.storageProject || chat.project);
    if (!this.loadSessionManager) {
      return ZyraSessionManager.open(chat.sessionPath, sessionDirectory, chat.cwd || chat.project);
    }
    const SessionManager = await this.loadSessionManager();
    return SessionManager.open(chat.sessionPath, sessionDirectory);
  }

  setWorkContext(selector, input) {
    const canonicalChatId = this.resolveAlias(selector);
    const next = normalizeWorkContextInput(input);
    // Preserve arrival order even when indexing/find awaits filesystem work.
    const previous = this.workContextUpdates.get(canonicalChatId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const saved = readChatWorkContext(this.record.metadata[canonicalChatId]?.workContext);
      if (saved && saved.folderPath === next.folderPath && saved.kind === next.kind) return this.find(canonicalChatId, { allProjects: true });
      return this.updateChat(canonicalChatId, { workContext: { ...next, updatedAt: new Date().toISOString() } });
    });
    this.workContextUpdates.set(canonicalChatId, pending);
    void pending.finally(() => { if (this.workContextUpdates.get(canonicalChatId) === pending) this.workContextUpdates.delete(canonicalChatId); }).catch(() => {});
    return pending;
  }

  async updateChat(selector, patch = {}) {
    const canonicalChatId = this.resolveAlias(selector);
    const chat = await this.find(canonicalChatId, { allProjects: true, includeDeleted: true });
    if (patch.settled !== undefined && typeof patch.settled !== 'boolean') throw new TypeError('Choose whether to settle this chat.');
    if (patch.settled !== undefined && !chat) throw new Error('Chat not found.');
    if (patch.workContext !== undefined && !readChatWorkContext(patch.workContext)) throw new Error('Invalid work context metadata.');
    if (patch.project !== undefined) this.registerProject(patch.project);
    const existing = this.record.metadata[canonicalChatId] || {};
    if (!patch.initialTitleOnly && patch.expectedTitle !== undefined && String(existing.title || chat?.title || '') !== patch.expectedTitle) throw new Error('The Chat title changed before this rename. Read it again.');
    if (patch.initializeTitle && (existing.titleSource || existing.title)) return chat;
    if (patch.titleSource === 'refresh' && (!existing.titleSource || existing.titleSource === 'manual')) throw new Error('The manually named or unclassified chat title is protected.');
    // Recheck after the history read: a manual rename may have won while an
    // initial-title event was in flight. Never let that event overwrite it.
    if (patch.initialTitleOnly && (
      !['initial', 'provisional'].includes(existing.titleSource)
      || String(existing.title || chat?.title || '') !== patch.expectedTitle
    )) return null;
    const next = {
      ...existing,
      ...(patch.workContext !== undefined ? { workContext: readChatWorkContext(patch.workContext) } : {}),
      ...(patch.settled !== undefined && !(patch.settlementIfAbsent && currentChatSettlementChoice(chat, existing)) ? { settlement: {
        state: patch.settled ? 'settled' : 'active', messageCount: Math.max(0, Number(chat.messageCount) || 0), changedAt: new Date().toISOString()
      } } : {}),
      ...(patch.title !== undefined ? { title: normalizeTitle(patch.title), titleSource: patch.titleSource || 'manual' } : {}),
      ...(patch.titleSource !== undefined && patch.title === undefined ? { titleSource: patch.titleSource } : {}),
      ...(patch.agentCreatedBy !== undefined ? { agentCreatedBy: String(patch.agentCreatedBy).slice(0, 192) } : {}),
      ...(patch.agentLabel !== undefined ? { agentLabel: String(patch.agentLabel).slice(0, 120) } : {}),
      ...(patch.agentRunId !== undefined ? { agentRunId: String(patch.agentRunId).slice(0, 192) } : {}),
      ...(['thread', 'subagent'].includes(patch.agentConversationKind) ? { agentConversationKind: patch.agentConversationKind } : {}),
      ...(patch.project !== undefined ? { project: normalizeProject(patch.project) } : {}),
      ...(patch.cwd !== undefined ? { cwd: normalizeProject(patch.cwd) } : {}),
      ...(typeof patch.forkPending === 'boolean' ? { forkPending: patch.forkPending } : {}),
      ...(patch.forkOrigin ? { forkOrigin: { canonicalChatId: String(patch.forkOrigin.canonicalChatId), namespaceId: patch.forkOrigin.namespaceId || null, entryId: String(patch.forkOrigin.entryId), messageId: String(patch.forkOrigin.messageId || patch.forkOrigin.entryId), worktree: patch.forkOrigin.worktree === 'isolated' ? 'isolated' : 'shared', createdAt: String(patch.forkOrigin.createdAt) } } : {}),
      ...(patch.archived !== undefined ? {
        archived: patch.archived === true,
        archivedAt: patch.archived === true ? new Date().toISOString() : null
      } : {}),
      ...(patch.deleted !== undefined ? {
        deleted: patch.deleted === true,
        deletedAt: patch.deleted === true ? new Date().toISOString() : null
      } : {}),
      updatedAt: new Date().toISOString()
    };
    this.record.metadata[canonicalChatId] = next;
    this.index.update(canonicalChatId, next);
    this.persist();
    return applyMetadata(chat || this.index.get(canonicalChatId) || { canonicalChatId }, next, this.record);
  }

  snapshot() {
    return structuredClone(this.record);
  }

  markSettlementActive(canonicalChatId) {
    const existing = this.record.metadata[canonicalChatId];
    if (existing?.settlement?.state !== 'settled') return false;
    this.record.metadata[canonicalChatId] = { ...existing, settlement: { ...existing.settlement, state: 'active', changedAt: new Date().toISOString() } };
    this.persist();
    return true;
  }

  markCompletionSeen(canonicalChatId, turnId, completedAt) {
    const existing = this.record.metadata[canonicalChatId] || {};
    if (existing.lastSeenCompletedTurnId === turnId) return false;
    const timestamp = Date.parse(completedAt);
    if (!Number.isFinite(timestamp) || timestamp < (Date.parse(existing.lastSeenCompletedAt) || 0)) return false;
    this.record.metadata[canonicalChatId] = { ...existing, lastSeenCompletedTurnId: turnId, lastSeenCompletedAt: completedAt };
    this.persist();
    return true;
  }

  persist() {
    trimRecord(this.record);
    writeCatalog(this.paths.catalogFile, this.record);
  }
}

function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return []; }
}

function projectInjectedSession(project, session) {
  const canonicalChatId = String(session.id || "");
  return {
    version: 1,
    canonicalChatId,
    sessionPath: path.resolve(session.path),
    storageProject: normalizeProject(project),
    project: normalizeProject(project),
    cwd: normalizeProject(session.cwd || project),
    title: normalizeTitle(session.name || session.firstMessage),
    model: normalizeChatModel(session.model, session.provider),
    createdAt: toIso(session.created),
    modifiedAt: toIso(session.modified),
    messageCount: Math.max(0, Number(session.messageCount) || 0),
    displayMessageCount: Math.max(0, Number(session.messageCount) || 0),
    toolCallCount: 0,
    errorCount: 0,
    imageCount: 0,
    entryCount: Math.max(0, Number(session.messageCount) || 0),
    parentSessionPath: session.parentSessionPath ? path.resolve(session.parentSessionPath) : null
  };
}

function applyMetadata(chat, metadata = {}, record = {}) {
  const canonicalChatId = String(chat.canonicalChatId || "");
  return {
    ...chat,
    title: normalizeTitle(metadata.title || chat.title),
    titleSource: metadata.titleSource || null,
    forkPending: metadata.forkPending === true,
    forkOrigin: metadata.forkOrigin || null,
    workContext: readChatWorkContext(metadata.workContext),
    agentCreatedBy: metadata.agentCreatedBy || null,
    agentLabel: metadata.agentLabel || null,
    agentRunId: metadata.agentRunId || null,
    agentConversationKind: metadata.agentConversationKind || null,
    project: metadata.project || chat.project || chat.storageProject || chat.cwd,
    cwd: metadata.cwd || metadata.project || chat.cwd || chat.project,
    archived: metadata.archived === true,
    settled: projectChatSettlement(chat, metadata),
    settlementManual: Boolean(currentChatSettlementChoice(chat, metadata)),
    archivedAt: metadata.archivedAt || null,
    deleted: metadata.deleted === true,
    deletedAt: metadata.deletedAt || null,
    aliases: Object.entries(record.aliases || {}).filter(([, id]) => id === canonicalChatId).map(([alias]) => alias).slice(0, 32),
    surfaces: [...new Set(record.surfaces?.[canonicalChatId] || [])],
    lastSeenCompletedTurnId: metadata.lastSeenCompletedTurnId || null
  };
}

function normalizeTitle(value) {
  return stripSidebarBrowserContext(value).replace(/\s+/g, " ").trim().slice(0, 240) || "New chat";
}

function normalizeProject(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Chat project path is required.");
  return path.resolve(raw);
}

function pathKey(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function emptyCatalog() {
  return { version: CATALOG_VERSION, projects: [], aliases: {}, surfaces: {}, metadata: {}, updatedAt: new Date().toISOString() };
}

function readCatalog(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== CATALOG_VERSION) return emptyCatalog();
    return {
      version: CATALOG_VERSION,
      projects: Array.isArray(parsed.projects) ? parsed.projects.filter((entry) => entry?.path).slice(-MAX_KNOWN_PROJECTS) : [],
      aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {},
      surfaces: parsed.surfaces && typeof parsed.surfaces === "object" ? parsed.surfaces : {},
      metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {},
      updatedAt: String(parsed.updatedAt || new Date().toISOString())
    };
  } catch {
    return emptyCatalog();
  }
}

function trimRecord(record) {
  record.projects = record.projects.slice(-MAX_KNOWN_PROJECTS);
  const aliases = Object.entries(record.aliases).slice(-MAX_ALIASES);
  record.aliases = Object.fromEntries(aliases);
  record.surfaces = Object.fromEntries(Object.entries(record.surfaces).slice(-MAX_ALIASES));
  record.metadata = Object.fromEntries(Object.entries(record.metadata || {}).slice(-MAX_ALIASES));
  record.updatedAt = new Date().toISOString();
}

function writeCatalog(file, record) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
  replaceFileWithRetry(temporary, file);
}
