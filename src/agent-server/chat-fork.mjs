import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getProjectSessionsDir } from '../project-paths.mjs';
import { normalizeChatModel } from './chat-model.mjs';
import { normalizeCanonicalMessageSourceId } from '../message-identity.mjs';

const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const digest = value => createHash('sha256').update(value).digest('hex');
function fail(message, code = 'CHAT_FORK_INVALID') { throw Object.assign(new Error(message), { code, retryable: false }); }

/**
 * Offline canonical fork. Does not open a SessionManager (opening legacy sources
 * can migrate/rewrite them), attach a provider, prompt, or restore any files.
 * input: { operationId, entryId, title?, model?, effort?, profile?, worktree? }
 * model uses the normal provider/model string. worktree is omitted or 'shared'.
 * A durable pending receipt deliberately blocks automatic recovery after a crash
 * or partial catalog failure: retrying an uncertain operation must not duplicate it.
 */
export function preflightCanonicalChatFork(server, sourceChat, input) {
  return forkCanonicalChat(server, sourceChat, input, { preflight: true });
}

export async function forkCanonicalChat(server, sourceChat, input = {}, ownerContext = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid fork request.');
  for (const key of Object.keys(input)) {
    if (!['operationId', 'entryId', 'title', 'model', 'effort', 'profile', 'worktree'].includes(key)) fail(`Unsupported fork option: ${key}.`);
  }
  const operationId = identifier(input.operationId, 'operation ID', 192);
  let entryId = identifier(input.entryId, 'persisted message entry ID', 256);
  if (!sourceChat?.canonicalChatId || !sourceChat.sessionPath || !sourceChat.project || sourceChat.deleted) fail('Source chat is unavailable.');
  const isolated = input.worktree === 'isolated';
  if (input.worktree !== undefined && !['shared', 'isolated'].includes(input.worktree)) fail('Choose shared working files or an isolated worktree.');
  if (isolated && !ownerContext.preflight && (!ownerContext.workingRoot || !ownerContext.scope || ownerContext.scope.workingRoot !== ownerContext.workingRoot)) fail('An isolated fork requires preparation by the authorized Project/worktree owner.', 'CHAT_FORK_WORKTREE_UNSUPPORTED');
  const workingRoot = path.resolve(isolated && !ownerContext.preflight ? ownerContext.workingRoot : sourceChat.cwd || sourceChat.project);
  const overrides = {};
  if (own(input, 'title')) overrides.title = title(input.title);
  if (own(input, 'model')) {
    overrides.model = normalizeChatModel(input.model);
    if (typeof input.model !== 'string' || !overrides.model || !overrides.model.includes('/')) fail('Choose a provider/model for the fork.');
  }
  if (own(input, 'effort')) {
    if (!['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.effort)) fail('Invalid fork effort.');
    overrides.effort = input.effort;
  }
  if (own(input, 'profile')) {
    if (typeof input.profile !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.profile)) fail('Invalid fork profile.');
    overrides.profile = input.profile;
  }
  if (!server?.paths?.stateDirectory || !server.catalog) fail('Canonical fork storage is unavailable.');
  const sourcePath = path.resolve(sourceChat.sessionPath);
  const request = { sourceChatId: sourceChat.canonicalChatId, sourcePath, entryId, ...overrides, worktree: isolated ? 'isolated' : 'shared', workingRoot, desktopOwned: ownerContext.desktopOwned === true };
  const fingerprint = digest(JSON.stringify(request));
  const receiptDirectory = path.join(server.paths.stateDirectory, 'chat-forks');
  const receiptPath = path.join(receiptDirectory, `${digest(operationId)}.json`);
  if (!ownerContext.preflight && existsSync(receiptPath)) {
    if (ownerContext.effects) ownerContext.effects.historyMayExist = true;
    return replayReceipt(server, receiptPath, fingerprint);
  }

  // Strict, bounded, read-only snapshot. No lenient JSONL parser or SDK migration.
  const storageProject = path.resolve(sourceChat.storageProject || sourceChat.project);
  assertWithin(storageProject, sourcePath);
  const snapshot = readSnapshot(sourcePath);
  if (snapshot.header.id !== sourceChat.canonicalChatId) fail('Source chat identity changed.');
  entryId = resolvePersistedEntryId(snapshot.entries, entryId);
  const branch = selectedBranch(snapshot.entries, entryId);
  validateTools(branch);
  const inherited = inheritedSettings(branch, sourceChat, server);
  const settings = { ...inherited, ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'title')) };
  const forkTitle = overrides.title || title(`Fork of ${sourceChat.title || 'chat'}`);
  if (ownerContext.preflight) return { sourceCanonicalChatId: sourceChat.canonicalChatId, entryId, sourceSnapshotSha256: snapshot.sha256 };
  const createdAt = new Date().toISOString();
  const canonicalChatId = `zyra_fork_${digest(`${path.resolve(server.paths.stateDirectory)}\0${operationId}`).slice(0, 32)}`;
  const sessionDirectory = getProjectSessionsDir(storageProject);
  mkdirSync(sessionDirectory, { recursive: true });
  assertWithin(storageProject, sessionDirectory);
  const sessionPath = path.join(sessionDirectory, `${canonicalChatId}.jsonl`);
  const origin = {
    canonicalChatId: sourceChat.canonicalChatId,
    namespaceId: server.paths.namespaceId || null,
    sessionPath: sourcePath,
    entryId,
    messageId: desktopMessageReference(branch.at(-1)),
    worktree: isolated ? 'isolated' : 'shared',
    sourceSnapshotSha256: snapshot.sha256,
    operationId,
    createdAt,
  };
  const header = { type: 'session', version: 3, id: canonicalChatId, timestamp: createdAt,
    cwd: workingRoot, parentSession: sourcePath };
  const entries = structuredClone(branch);
  let parentId = entries.at(-1).id;
  const append = values => {
    const entry = { ...values, id: `fork_${randomUUID()}`, parentId, timestamp: createdAt };
    entries.push(entry);
    parentId = entry.id;
  };
  append({ type: 'custom', customType: 'zyra_chat_fork', data: { version: 1, origin, settings, filesystemRestored: false, worktree: isolated ? 'isolated' : 'shared' } });
  if (settings.model) {
    const separator = settings.model.indexOf('/');
    if (separator > 0) append({ type: 'model_change', provider: settings.model.slice(0, separator), modelId: settings.model.slice(separator + 1) });
  }
  if (settings.effort) append({ type: 'thinking_level_change', thinkingLevel: settings.effort });
  if (settings.profile) append({ type: 'custom', customType: 'zyra.profile.v1', data: { profile: settings.profile, source: 'session', savedAt: createdAt } });
  append({ type: 'custom', customType: 'zyra.chat-config.v1', data: {
    model: settings.model, thinking: settings.effort, profile: settings.profile, runtimeMode: settings.runtimeMode,
    webSearch: settings.webSearch, webFetch: settings.webFetch, savedAt: createdAt,
  } });
  append({ type: 'session_info', name: forkTitle });

  mkdirSync(receiptDirectory, { recursive: true });
  // wx is the cross-process admission lock; no awaited work occurs before it.
  if (ownerContext.effects) ownerContext.effects.historyMayExist = true;
  try {
    durableCreate(receiptPath, { version: 1, status: 'pending', fingerprint, canonicalChatId, sessionPath, createdAt });
  } catch (error) {
    if (error.code === 'EEXIST') return replayReceipt(server, receiptPath, fingerprint);
    throw error;
  }
  // From this point onwards any failure leaves the pending claim in place.
  // Never remove it or retry a possibly successful catalog mutation blindly.
  durableCreate(sessionPath, `${[header, ...entries].map(entry => JSON.stringify(entry)).join('\n')}\n`);
  server.catalog.registerProject(storageProject);
  await server.catalog.index?.refreshProject(storageProject);
  let chat = await server.catalog.find(canonicalChatId, { project: storageProject, allProjects: true });
  if (!chat || chat.canonicalChatId !== canonicalChatId) fail('The fork was saved but catalog registration is unconfirmed.', 'CHAT_FORK_UNCERTAIN');
  chat = await server.catalog.updateChat(canonicalChatId, {
    title: forkTitle, titleSource: own(overrides, 'title') ? 'manual' : 'initial', project: sourceChat.project, cwd: header.cwd,
    forkPending: ownerContext.desktopOwned === true,
    forkOrigin: { canonicalChatId: origin.canonicalChatId, namespaceId: origin.namespaceId, entryId: origin.entryId, messageId: origin.messageId, worktree: origin.worktree, createdAt },
  });
  if (!chat || chat.canonicalChatId !== canonicalChatId) fail('The fork title registration is unconfirmed.', 'CHAT_FORK_UNCERTAIN');
  server.catalog.recordAttachment({ canonicalChatId, project: storageProject, surface: 'fork' });
  const result = { chat, canonicalChatId, sessionPath, origin, ...settings, title: forkTitle,
    titleSource: own(overrides, 'title') ? 'manual' : 'initial', filesystemRestored: false, worktree: isolated ? 'isolated' : 'shared' };
  const temporaryReceipt = `${receiptPath}.${randomUUID()}.tmp`;
  durableCreate(temporaryReceipt, { version: 1, status: 'complete', fingerprint, result });
  renameSync(temporaryReceipt, receiptPath);
  return result;
}

function identifier(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(`A valid ${label} is required.`);
  return value;
}
function title(value) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail('A nonempty fork title is required.');
  return value.trim().slice(0, 240);
}
function assertWithin(directory, file) {
  const relative = path.relative(realpathSync.native(directory), realpathSync.native(file));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('Fork storage must stay inside its source project.');
}
function durableCreate(file, value) {
  const descriptor = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(descriptor, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}
function readSnapshot(file) {
  if (statSync(file).size > MAX_SESSION_BYTES) fail('Source chat exceeds the 64 MiB offline fork limit.');
  const descriptor = openSync(file, 'r');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SESSION_BYTES + 1 - total));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      chunks.push(buffer.subarray(0, count));
      total += count;
      if (total > MAX_SESSION_BYTES) fail('Source chat exceeds the 64 MiB offline fork limit.');
    }
  } finally { closeSync(descriptor); }
  const bytes = Buffer.concat(chunks);
  let records;
  try {
    records = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  } catch { fail('Source chat contains incomplete or invalid persisted entries.'); }
  const [header, ...entries] = records;
  if (header?.type !== 'session' || typeof header.id !== 'string' || !header.id || Number(header.version || 1) < 2 || Number(header.version) > 3) fail('Source chat needs stable persisted entry identities before it can be forked.');
  return { header, entries, sha256: digest(bytes) };
}
function desktopMessageReference(entry) {
  const message = entry.message, role = message.role;
  const canonical = message.zyraCanonicalMessage?.canonicalMessageId;
  const timestamp = Number(message.timestamp);
  const sourceId = canonical ? normalizeCanonicalMessageSourceId(String(canonical)) : Number.isFinite(timestamp) && timestamp > 0 ? `zyra-message:${role}:${Math.trunc(timestamp)}` : String(message.id || entry.id);
  return sourceId.startsWith('voice_') ? sourceId : role === 'assistant' ? `assistant-message-${sourceId}` : role === 'user' ? `assistant-message-user-${sourceId}` : sourceId;
}
function resolvePersistedEntryId(entries, reference) {
  if (entries.some(entry => entry.type === 'message' && entry.id === reference)) return reference;
  const matches = entries.filter(entry => {
    if (entry.type !== 'message' || !entry.message) return false;
    const message = entry.message, role = message.role;
    const canonical = message.zyraCanonicalMessage?.canonicalMessageId;
    const timestamp = Number(message.timestamp);
    const sourceId = canonical ? normalizeCanonicalMessageSourceId(String(canonical)) : Number.isFinite(timestamp) && timestamp > 0 ? `zyra-message:${role}:${Math.trunc(timestamp)}` : String(message.id || entry.id);
    const desktopId = sourceId.startsWith('voice_') ? sourceId : role === 'assistant' ? `assistant-message-${sourceId}` : role === 'user' ? `assistant-message-user-${sourceId}` : sourceId;
    return [sourceId, desktopId, String(message.id || '')].includes(reference);
  });
  if (matches.length !== 1) fail('Choose one exact persisted message boundary; that source reference is unavailable or ambiguous.');
  return matches[0].id;
}

function selectedBranch(entries, entryId) {
  const byId = new Map();
  let previous = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || byId.has(entry.id)) fail('Source chat contains missing or duplicate persisted entry identities.');
    // Legacy v2 linear records can omit parentId. Normalize the copy only.
    byId.set(entry.id, { ...entry, parentId: own(entry, 'parentId') ? entry.parentId : previous });
    previous = entry.id;
  }
  const selected = byId.get(entryId);
  if (!selected || selected.type !== 'message' || !['user', 'assistant', 'toolResult'].includes(selected.message?.role)) fail('Choose an exact persisted user, assistant, or tool-result message.');
  const branch = [], visited = new Set();
  let entry = selected;
  while (entry) {
    if (visited.has(entry.id)) fail('Source chat ancestry contains a cycle.');
    visited.add(entry.id);
    branch.push(entry);
    if (entry.parentId === null) break;
    if (typeof entry.parentId !== 'string' || !byId.has(entry.parentId)) fail('Source chat ancestry is incomplete.');
    entry = byId.get(entry.parentId);
  }
  return branch.reverse();
}
function validateTools(branch) {
  const pending = new Set();
  const seen = new Set();
  for (const entry of branch) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (!message || !['user', 'assistant', 'toolResult', 'custom', 'hookMessage'].includes(message.role)) fail('Unsupported role in source chat ancestry.');
    if (message.role === 'toolResult') {
      const id = message.toolCallId || message.tool_call_id;
      if (typeof id !== 'string' || !pending.delete(id)) fail('Tool result has no matching pending assistant call.', 'CHAT_FORK_UNSAFE_BOUNDARY');
      continue;
    }
    if (pending.size && ['user', 'assistant'].includes(message.role)) fail('Source chat has an unfinished tool-call group.', 'CHAT_FORK_UNSAFE_BOUNDARY');
    if (message.role !== 'assistant') continue;
    const calls = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'toolCall' || block?.type === 'tool_use') : [];
    if (Array.isArray(message.tool_calls)) calls.push(...message.tool_calls);
    for (const call of calls) {
      if (typeof call.id !== 'string' || !call.id || seen.has(call.id)) fail('Source chat has an invalid tool-call identity.', 'CHAT_FORK_UNSAFE_BOUNDARY');
      seen.add(call.id);
      pending.add(call.id);
    }
  }
  if (pending.size) fail('Choose a message after all tool calls in this group have results.', 'CHAT_FORK_UNSAFE_BOUNDARY');
}
function inheritedSettings(branch, sourceChat, server) {
  const connected = server.sessions?.get(sourceChat.canonicalChatId)?.connectedResult;
  const config = connected?.config || {};
  let model = null, effort = null, profile = null, storedConfig = {};
  for (const entry of branch) {
    if (entry.type === 'model_change') model = normalizeChatModel(entry.modelId, entry.provider) || model;
    if (entry.type === 'message' && entry.message?.role === 'assistant') model = normalizeChatModel(entry.message.model, entry.message.provider) || model;
    if (entry.type === 'thinking_level_change') effort = entry.thinkingLevel;
    if (entry.type === 'custom' && entry.customType === 'zyra_chat_fork') profile = entry.data?.settings?.profile || profile;
    if (entry.type === 'custom' && entry.customType === 'zyra.profile.v1') profile = entry.data?.profile || profile;
    if (entry.type === 'custom' && entry.customType === 'zyra.chat-config.v1') storedConfig = entry.data || {};
  }
  return {
    model: model || normalizeChatModel(storedConfig.model || config.model || connected?.model || sourceChat.model),
    effort: effort || storedConfig.thinking || config.effort || config.thinking || config.thinkingLevel || sourceChat.effort || null,
    profile: profile || storedConfig.profile || config.profile || connected?.profile || sourceChat.profile || null,
    runtimeMode: storedConfig.runtimeMode || config.runtimeMode || connected?.runtimeMode || 'approval-required',
    webSearch: typeof storedConfig.webSearch === 'boolean' ? storedConfig.webSearch : config.webSearch !== false,
    webFetch: typeof storedConfig.webFetch === 'boolean' ? storedConfig.webFetch : config.webFetch !== false,
  };
}
async function replayReceipt(server, file, fingerprint) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(file, 'utf8')); }
  catch { fail('Fork receipt is unreadable; inspect it before retrying.', 'CHAT_FORK_UNCERTAIN'); }
  if (receipt.fingerprint !== fingerprint) fail('This fork operation ID was already used for a different request.', 'CHAT_FORK_OPERATION_CONFLICT');
  if (receipt.version !== 1 || receipt.status !== 'complete' || !receipt.result?.canonicalChatId || !receipt.result.sessionPath) fail('Fork completion is uncertain; inspect the saved operation before retrying.', 'CHAT_FORK_UNCERTAIN');
  const result = receipt.result;
  let header;
  try { header = readSnapshot(result.sessionPath).header; }
  catch { fail('The saved fork is unavailable; automatic retry is blocked.', 'CHAT_FORK_UNCERTAIN'); }
  const chat = await server.catalog.find(result.canonicalChatId, { allProjects: true });
  if (header.id !== result.canonicalChatId || !chat || chat.deleted || path.resolve(chat.sessionPath) !== path.resolve(result.sessionPath)) fail('The saved fork is unavailable; automatic retry is blocked.', 'CHAT_FORK_UNCERTAIN');
  // An idempotency replay returns the original authorized creation snapshot,
  // never fresh metadata from a fork the user may since have moved elsewhere.
  return { ...result, chat: result.chat, replayed: true };
}
