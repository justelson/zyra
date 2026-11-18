import { randomUUID, createHash } from 'node:crypto';
import { forkCanonicalChat, preflightCanonicalChatFork } from './chat-fork.mjs';
import { isAppAreaOperation, isAppChatRead, isRoutineChatConfiguration } from '../app-area-operations.mjs';

const READS = new Set(['list', 'get', 'inspect', 'search', 'read', 'preview', 'history', 'refresh']);
const DOMAINS = new Set(['settings', 'settings_action', 'app', 'usage']);
const MUTATIONS = new Set(['apply', 'reset', 'undo', 'open', 'run', 'rename', 'refresh_title', 'move', 'reorder', 'pin', 'unpin', 'settle', 'restore', 'archive', 'unarchive', 'create', 'fork', 'update', 'hold', 'resume', 'remove', 'stop']);
const OPERATIONS = {
  settings: new Set(['list', 'get', 'preview', 'apply', 'reset', 'history', 'undo', 'open']),
  settings_action: new Set(['list', 'preview', 'run']), usage: new Set(['get', 'refresh']),
  app: new Set(['list', 'inspect', 'search', 'read', 'preview', ...MUTATIONS].filter(value => !['apply', 'reset', 'run'].includes(value))),
};
function describeAppPermission({ domain, operation, params = {} }, undo, namedAction) {
  const words = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').toLowerCase();
  const target = params.target && params.target !== 'current' ? String(params.target) : '';
  const keys = undo?.keys || (Array.isArray(params.keys) ? params.keys : Object.keys(params.patch || {}));
  const labels = { appearanceUiParts: 'interface appearance', assistantMemoryEnabled: 'assistant memory',
    assistantDefaultRuntimeMode: 'default chat permissions', runtimeMode: 'chat permissions' };
  const settings = keys.map(key => Object.hasOwn(labels, key) ? labels[key] : words(key)).join(', ');
  const scope = target || (params.area === 'chat' ? 'this chat' : undo?.surface || params.surface || 'this device');
  if (domain === 'settings' && settings) {
    const title = operation === 'undo' ? `Restore the previous ${settings} ${keys.length === 1 ? 'setting' : 'settings'} on ${scope}?`
      : operation === 'reset' ? `Reset ${settings} to ${keys.length === 1 ? 'its default' : 'their defaults'} on ${scope}?` : `Change ${settings} on ${scope}?`;
    const detail = operation === 'reset' ? `Remove the saved override for ${keys.join(', ')} and use the default value.`
      : operation === 'undo' ? `Restore the saved state from the original change to ${keys.join(', ')}.` : JSON.stringify(params.patch, null, 2);
    return { title, detail: params.input?.appScope === 'installation' ? `${detail}\nThis request uses installation-wide scope.` : detail };
  }
  if (namedAction) {
    const values = params.input || {};
    if (params.area === 'accounts.redeem_reset') return {
      title: `Use one banked reset credit for account ${values.accountId}?`,
      detail: `This spends reset credit ${values.creditId} on that account. It can only be used once.`,
    };
    const args = Object.entries(values).map(([key, value]) => `${words(key)}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    return { title: `${namedAction.label}${target ? ` for ${target}` : ''}?`, detail: [namedAction.effect, ...args].filter(Boolean).join('\n') };
  }
  const action = `${words(operation)} ${words(params.area || domain)}`;
  const scopeSuffix = params.input?.appScope === 'installation' ? ' across this installation' : '';
  return { title: `${action[0].toUpperCase()}${action.slice(1)}${target ? ` for ${target}` : ''}${scopeSuffix}?`,
    detail: operation === 'fork' ? `Copy chat history using ${params.input?.worktree || 'shared'} working files at current HEAD. Historical files are never restored. Source: ${target || 'this chat'}. Entry: ${params.input?.entryId}.`
      : Object.entries(params).map(([key, value]) => `${words(key)}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n') };

}

export function appOperationPolicy(input, mode = 'approval-required', child = false) {
  if (!DOMAINS.has(input?.domain) || !OPERATIONS[input.domain].has(input?.operation)) throw new Error('Unknown Zyra app operation.');
  const params = input.params || {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('App parameters must be an object.');
  if (input.domain === 'app' && !isAppAreaOperation(params.area, input.operation)) throw new Error('Unsupported operation for this app area. Discover its explicit actions first.');
  const encoded = JSON.stringify(params);
  if (encoded.length > 96_000) throw new Error('App request exceeds its bounded payload limit.');
  if (/"(?:__proto__|prototype|constructor|apiKey|accessToken|refreshToken|password|secret|authorityProof|userApproved|approved|approval|userConfirmed|confirmed)"\s*:/i.test(encoded)) throw new Error('Secrets and approval claims are not accepted as app arguments. Use the secure owning UI.');
  const scopeIntent = params.input?.appScope;
  if (scopeIntent !== undefined && !['project', 'installation'].includes(scopeIntent)) throw new Error('Choose project or installation app scope. Scope requests are not approval.');
  const chatRead = isAppChatRead(input);
  if (scopeIntent === 'installation' && child && !chatRead) throw new Error('Supporting agents cannot expand app scope. Ask the parent to make the user-directed request.');
  if (scopeIntent !== undefined && !(input.domain === 'app' || input.domain === 'usage' || input.domain === 'settings' && params.area === 'chat')) throw new Error('This owner does not support an app-scope request.');
  const mutation = MUTATIONS.has(input.operation);
  if (mutation && mode === 'read-only') throw new Error('This agent cannot change app state in read-only mode.');
  if (mutation && child) throw new Error('Supporting agents cannot mutate installation-wide app state. Ask the parent to perform this user-directed change.');
  // Inspect setting names and selectors. Literal values (including chat titles)
  // can contain words such as "permissions" without changing access.
  const sensitiveFields = JSON.stringify([Object.keys(params.patch || {}), params.keys, params.key, params.area, Object.keys(params.input || {})]);
  const protectedChange = input.domain === 'settings' && ['undo', 'reset'].includes(input.operation)
    || input.domain === 'settings_action' && input.operation === 'run'
    || mutation && /(?:permission|runtimeMode|MemoryEnabled|WebSearch|WebFetch|GoogleSuggestions|startWithWindows|analytics|consent|additionalFolders|projectsFolder|explorerHomePath|Skill|endpoint|baseUrl)/i.test(sensitiveFields)
    || mutation && ['plugins', 'connections', 'devices', 'skills', 'runtime', 'privacy', 'providers', 'memory', 'project_folders', 'projects', 'chat'].includes(String(params.area || ''))
    || ['remove', 'fork', 'stop', 'resume', 'rename', 'refresh_title'].includes(input.operation)
    || input.domain === 'app' && input.operation === 'update';
  if (input.domain === 'settings' && input.operation === 'apply' && isRoutineChatConfiguration(params, mode, child)) return { mutation, needsApproval: false };
  return { mutation, needsApproval: scopeIntent === 'installation' && !chatRead || mutation && (mode !== 'full-access' || protectedChange) };
}

/** Only the server creates the principal. Neither tool arguments nor Desktop selection establish identity. */
export async function requestAgentAppOperation(server, source, message) {
  const input = message.input;
  const sender = server.threads.sender(source, message.agentRunId);
  const mode = sender.agent?.permissionMode || source.connectedResult?.config?.runtimeMode || source.connectedResult?.runtimeMode || 'approval-required';
  const policy = appOperationPolicy(input, mode, Boolean(sender.agent));
  if (!String(input.dedupeKey || '').trim()) throw new Error('A stable app operation ID is required.');
  const turnId = source.activeRequestContext?.turnId || null;
  const stopEpoch = source.userInputContinuationEpoch;
  const desktop = [...server.clients.values()].find(client => client.authenticated && client.canOperateApp && client.socket.writable);
  if (!desktop) throw Object.assign(new Error('The owning Zyra Desktop is not connected. No app state was changed.'), { code: 'APP_OWNER_UNAVAILABLE' });
  const operationId = createHash('sha256').update(`${sender.senderCanonicalThreadId}\0${input.dedupeKey}`).digest('hex');
  const actor = { canonicalChatId: sender.senderCanonicalThreadId, parentChatId: source.sessionKey, project: sender.project,
    permissionMode: mode, child: Boolean(sender.agent), turnId, namespaceId: server.paths.namespaceId,
    approved: false, appScope: input.params?.input?.appScope === 'installation' ? 'installation' : 'project' };
  const request = { domain: input.domain, operation: input.operation, params: input.params || {}, operationId, actor };
  const assertCurrent = () => {
    if (source.disposed || source.revocationPromise || source.userInputContinuationEpoch !== stopEpoch || turnId && source.activeRequestContext?.turnId !== turnId) throw new Error('The originating turn ended or was stopped. Inspect completed receipts before retrying.');
  };
  let needsApproval = policy.needsApproval;
  let undoPreview;
  if (input.domain === 'settings' && input.operation === 'undo') {
    const undoOperationId = input.params?.input?.operationId;
    if (!undoOperationId) throw new Error('Choose a completed settings change to undo.');
    undoPreview = await deliverAppOperation(server, desktop, source, { ...request, operation: 'preview',
      params: { input: { undoOperationId } }, actor: { ...actor, appScope: 'project' } });
    assertCurrent();
    if (undoPreview.undoOperationId !== undoOperationId || typeof undoPreview.requiresApproval !== 'boolean'
        || !Array.isArray(undoPreview.keys) || !undoPreview.keys.length) throw new Error('The desktop could not verify the settings change to undo.');
    // Only Desktop's verified same-chat receipt can classify a cosmetic reversal.
    // The owner still checks both revisions and rejects stale or mixed changes.
    const cosmeticOnly = undoPreview.keys.every(key => key === 'appearanceUiParts' || key === 'appearanceChatWallpaper');
    needsApproval = undoPreview.requiresApproval || actor.appScope === 'installation' || (mode !== 'full-access' && !(mode === 'approval-required' && cosmeticOnly));
  }
  if (needsApproval) {
    let namedAction;
    if (input.domain === 'settings_action' && input.operation === 'run') {
      const preview = await deliverAppOperation(server, desktop, source, { ...request, operation: 'preview' });
      assertCurrent();
      namedAction = preview.operation;
      if (!namedAction?.label || !namedAction.effect || namedAction.id !== request.params.area) throw new Error('The desktop could not verify this settings action.');
    }
    const question = describeAppPermission(input, undoPreview, namedAction);
    const authorization = await source.worker.request('app.authorize', { toolCallId: input.dedupeKey, ...question });
    if (authorization.allowed !== true) throw new Error('The user did not approve this app operation.');
    actor.approved = true;
  }
  assertCurrent();
  if (input.domain !== 'app' || input.operation !== 'fork') return deliverAppOperation(server, desktop, source, request);
  if (request.params.area !== 'chats') throw new Error('Choose the chats area for a history fork.');
  const rawForkInput = request.params.input || {};
  if (!rawForkInput || typeof rawForkInput !== 'object' || Array.isArray(rawForkInput)) throw new Error('Choose supported fork configuration.');
  const { appScope: _scopeIntent, ...forkInput } = rawForkInput;
  if (Object.keys(forkInput).some(key => !['entryId', 'title', 'model', 'effort', 'profile', 'worktree'].includes(key))) throw new Error('Choose an exact persisted entryId and supported fork configuration.');
  if (typeof forkInput.entryId !== 'string' || !forkInput.entryId.trim() || forkInput.entryId.length > 256 || forkInput.worktree && !['shared', 'isolated'].includes(forkInput.worktree)) throw new Error('Choose an exact persisted entryId and shared or isolated working files.');
  const phaseId = phase => createHash('sha256').update(`${operationId}\0${phase}`).digest('hex');
  // Resolve the authorized source without preparing any working files. Use the
  // same bounded canonical reader and boundary/tool validation as the save path.
  const authorized = await deliverAppOperation(server, desktop, source, { ...request, operationId: phaseId('source'), operation: 'fork_source' });
  assertCurrent();
  const sourceChat = await server.catalog.find(authorized.sourceCanonicalChatId, { allProjects: true });
  if (!sourceChat || sourceChat.deleted) throw new Error('The authorized fork source is unavailable.');
  await preflightCanonicalChatFork(server, sourceChat, { ...forkInput, operationId });
  assertCurrent();
  const prepared = await deliverAppOperation(server, desktop, source, { ...request, operationId: phaseId('prepare'), operation: 'fork_prepare', params: { ...request.params, input: { ...forkInput, expectedSourceCanonicalChatId: sourceChat.canonicalChatId } } });
  const effects = { historyMayExist: false };
  let fork;
  try {
    assertCurrent();
    if (prepared.sourceCanonicalChatId !== sourceChat.canonicalChatId) throw new Error('The authorized fork source changed before preparation.');
    fork = await forkCanonicalChat(server, sourceChat, { ...forkInput, operationId }, { desktopOwned: true, scope: prepared.scope, workingRoot: prepared.workingRoot, effects });
  } catch (error) {
    if (!effects.historyMayExist && prepared.rollbackToken) {
      try {
        assertCurrent();
        await deliverAppOperation(server, desktop, source, { ...request, operationId: phaseId('rollback'), operation: 'fork_rollback', params: { ...request.params, input: { rollbackToken: prepared.rollbackToken, prepareOperationId: phaseId('prepare') } } });
      } catch {
        throw new Error(`${error.message} Fork workspace cleanup is unconfirmed; inspect the retained preparation. Do not automatically recreate it.`);
      }
    }
    if (effects.historyMayExist) throw Object.assign(new Error(`${error.message} Fork history may be saved; its workspace was retained. Inspect the operation receipt before retrying.`), { code: error.code, retryable: false });
    throw error;
  }
  try {
    assertCurrent();
    const imported = await deliverAppOperation(server, desktop, source, { ...request, operationId: phaseId('attach'), operation: 'fork_attach', params: { ...request.params, input: { canonicalChatId: fork.canonicalChatId, scope: prepared.scope || null, model: fork.model, effort: fork.effort, runtimeMode: fork.runtimeMode, expectedProjectPath: fork.chat.project, expectedWorkingRoot: fork.chat.cwd, rollbackToken: prepared.rollbackToken, prepareOperationId: phaseId('prepare') } } });
    await server.catalog.updateChat(fork.canonicalChatId, { forkPending: false });
    server.broadcastCatalogChanged?.('chat-fork');
    return { ...fork, chat: { ...fork.chat, forkPending: false }, desktop: imported, scopeConfirmed: true, selectionUnchanged: true, autoPrompted: false };
  } catch {
    return { canonicalChatId: fork.canonicalChatId, origin: fork.origin, filesystemRestored: false, scopeConfirmed: false, pending: true, autoPrompted: false, warning: 'History is saved, but this request could not reconfirm its Desktop scope. Do not run or automatically recreate the fork. Inspect its owning UI and operation receipt.' };
  }
}

function deliverAppOperation(server, desktop, source, request) {
  const requestId = `app:${randomUUID()}`;
  if (!desktop.socket.writable || !desktop.authenticated || !desktop.canOperateApp) return Promise.reject(new Error('The exact app owner disconnected. No other device was substituted.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.appRequests.delete(requestId); reject(new Error('The app owner did not acknowledge the operation. Check its receipt before retrying.')); }, 30_000);
    timer.unref?.();
    server.appRequests.set(requestId, { owner: desktop, resolve, reject, timer, source, operationId: request.operationId, stopEpoch: source.userInputContinuationEpoch, turnId: request.actor.turnId });
    server.send(desktop, { type: 'desktop.app.request', requestId, request: { ...request, ownerRequestId: requestId } });
  });
}

export function validateAgentAppOperation(server, client, params) {
  if (!client.authenticated || !client.canOperateApp) throw new Error('Only the authenticated app owner can validate a pending operation.');
  const candidate = server.appRequests.get(params.requestId);
  const pending = candidate?.owner === client && candidate.operationId === params.operationId ? candidate : null;
  const source = pending?.source;
  return { valid: Boolean(pending && source && !source.disposed && !source.revocationPromise && source.userInputContinuationEpoch === pending.stopEpoch && (!pending.turnId || source.activeRequestContext?.turnId === pending.turnId)) };
}

export function completeAgentAppOperation(server, client, message) {
  const pending = server.appRequests.get(message.requestId);
  if (!pending || pending.owner !== client || !client.canOperateApp) throw new Error('App response does not belong to this authenticated owner.');
  server.appRequests.delete(message.requestId); clearTimeout(pending.timer);
  if (message.ok === true) pending.resolve(message.result || {});
  else pending.reject(Object.assign(new Error(message.error?.message || 'App operation failed.'), { code: message.error?.code || 'APP_OPERATION_FAILED' }));
}
