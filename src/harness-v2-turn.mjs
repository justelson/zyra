import { randomBytes } from 'node:crypto';
import { requestV2 } from './harness-v2-client.mjs';
import { subscribeHarnessEvents } from './harness-events.mjs';

const toolName = name => name === 'shell' ? 'bash' : name;
const encoded = encodeURIComponent;

// HarnessConversation retains its remover between turns. Keep that closure
// independent of the completed turn's callbacks, metrics and mapped history.
function sessionRemover(client, fetchImpl, timeoutMs) {
  return id => requestV2(client, `/session/${encoded(id)}`, { method: 'DELETE', fetchImpl, timeoutMs });
}

export function v2ToolPart(part, messageID) {
  const state = part.state ?? {};
  return { type: 'tool', id: part.id, callID: part.id, tool: toolName(part.name), messageID,
    state: { ...state, output: state.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n') ?? '',
      error: state.error?.message, time: { start: part.time?.ran ?? part.time?.created, end: part.time?.completed } } };
}

/** Read only the current admitted input's suffix; follow real opaque pagination. */
export async function currentV2Messages(client, sessionId, inputId, options) {
  const messages = [];
  let cursor;
  const seen = new Set();
  for (let page = 0; page < 64; page++) {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : { order: 'desc' }) });
    const payload = await requestV2(client, `/session/${encoded(sessionId)}/message?${query}`, options);
    if (!Array.isArray(payload?.data)) throw new Error('OpenCode 2 returned an invalid message page.');
    for (const message of payload.data) {
      if (message.id === options.includeBoundaryId) return { found: true, messages: [message, ...messages.reverse()] };
      if (message.id === inputId) return { found: true, messages: messages.reverse() };
      messages.push(message);
    }
    cursor = payload.cursor?.next;
    if (!cursor) return { found: false, messages: [] };
    if (seen.has(cursor)) throw new Error('OpenCode 2 repeated a message cursor.');
    seen.add(cursor);
  }
  throw new Error('OpenCode 2 exceeded the current-turn recovery limit.');
}

/** V2 prompt admission is asynchronous; idle wait and snapshots are authoritative. */
export async function runHarnessV2Turn({ client, modelId, mapped, signal, variant, fetchImpl, sessionIdRef, onProgress, onPermission, conversation, onMetric, extract, managedTools, historyTimeoutMs = 30_000, finalTimeoutMs = 300_000 }) {
  const slash = modelId.indexOf('/');
  if (slash < 1 || slash === modelId.length - 1) throw new Error('Harness model id must look like <provider>/<model>.');
  const model = { providerID: modelId.slice(0, slash), id: modelId.slice(slash + 1), ...(variant ? { variant } : {}) };
  const started = performance.now();
  let requestCount = 0, firstTextMs;
  const options = { signal, timeoutMs: historyTimeoutMs, fetchImpl: (...args) => { requestCount++; return (fetchImpl ?? client.fetch ?? fetch)(...args); } };
  const request = (route, extra = {}) => requestV2(client, route, { ...options, ...extra });
  const remove = sessionRemover(client, fetchImpl ?? client.fetch, historyTimeoutMs);
  const create = async () => {
    const payload = await request('/session', { method: 'POST', body: { title: 'Zyra conversation', agent: 'zyra-managed', model, location: { directory: client.cwd } } });
    if (typeof payload?.data?.id !== 'string' || !payload.data.id) throw new Error('OpenCode 2 did not return a session id.');
    return payload.data.id;
  };
  const attachment = conversation ? await conversation.acquire({ client, identity: [modelId, variant, mapped.system, Boolean(onPermission)], history: mapped.history, create, remove })
    : { id: await create(), history: mapped.history, reused: false };
  const id = attachment.id, base = `/session/${encoded(id)}`;
  const metric = (phase, details) => { try { onMetric?.({ phase, elapsedMs: Math.round(performance.now() - started), ...details }); } catch {} };
  metric('native-session', { reused: attachment.reused, replayedMessages: attachment.history.length });
  if (sessionIdRef) sessionIdRef.current = id;
  const inputId = `msg_${randomBytes(16).toString('hex')}`;
  const pollAbort = new AbortController();
  const pollSignal = signal ? AbortSignal.any([signal, pollAbort.signal]) : pollAbort.signal;
  let stream, completed, stopped = false, delivered = false, failure, wake, poll, failedPolls = 0;
  const handledPermissions = new Set(), unresolvedPermissions = new Map(), streamed = new Map(), seenEvents = new Set();
  const publish = event => {
    if (stopped || signal?.aborted) return;
    if (event.type === 'text' && firstTextMs === undefined && event.text) { firstTextMs = Math.round(performance.now() - started); metric('first-text', { firstTextMs }); }
    onProgress?.(event);
  };
  const partsOf = messages => messages.filter(message => message.type === 'assistant').flatMap(message => (message.content ?? []).map(part => part.type === 'tool' ? v2ToolPart(part, message.id) : part));
  const recover = async (recoverySignal = signal) => {
    const snapshot = await currentV2Messages(client, id, inputId, { ...options, signal: recoverySignal });
    if (!snapshot.found || stopped) return snapshot;
    const parts = partsOf(snapshot.messages);
    for (const type of ['reasoning', 'text']) {
      const text = parts.filter(part => part.type === type).map(part => part.text ?? '').join('');
      if (text) publish({ type, text });
    }
    for (const part of parts) if (part.type === 'tool') publish({ type: 'tool', part });
    if (onPermission) {
      const pending = await request(`${base}/permission`, { timeoutMs: 4000, signal: recoverySignal });
      if (!Array.isArray(pending?.data)) throw new Error('OpenCode 2 returned an invalid permission list.');
      for (const permission of pending.data) {
        if (permission.sessionID !== id || !permission.id || handledPermissions.has(permission.id)) continue;
        const part = parts.find(part => part.type === 'tool' && part.callID === permission.source?.id && part.messageID === permission.source?.messageID);
        if (permission.source?.type === 'tool' && (!part || !part.state.input)) {
          const attempts = (unresolvedPermissions.get(permission.id) ?? 0) + 1;
          unresolvedPermissions.set(permission.id, attempts);
          if (attempts < 5) continue;
        }
        handledPermissions.add(permission.id);
        const approval = (async () => {
          let approved = false;
          if (permission.source?.type === 'tool' && part && managedTools.includes(part.tool) && part.state.input && !signal?.aborted && !stopped) {
            approved = await onPermission({ toolName: part.tool, input: { ...part.state.input, paths: permission.resources }, toolCallId: part.callID, permission: permission.action }) === true;
          }
          await request(`${base}/permission/${encoded(permission.id)}/reply`, { method: 'POST', signal: undefined,
            timeoutMs: 10_000, body: { decision: approved && !signal?.aborted && !stopped ? 'once' : 'reject' } });
        })().catch(error => { failure = error; void request(`${base}/interrupt`, { method: 'POST', signal: undefined }).catch(() => {}); });
        void approval;
      }
    }
    return snapshot;
  };
  try {
    await request(`${base}/model`, { method: 'POST', body: { model } });
    if (mapped.system) await request(`/experimental${base}/instructions/entries/zyra-system`, { method: 'PUT', body: { value: mapped.system } });
    else if (attachment.reused) await request(`/experimental${base}/instructions/entries/zyra-system`, { method: 'DELETE' });
    if (!onPermission) await request(base, { method: 'PATCH', body: { permissions: [{ action: '*', resource: '*', effect: 'deny' }] } });
    for (const text of attachment.history) await request(`${base}/synthetic`, { method: 'POST', body: { text, resume: false } });
    stream = subscribeHarnessEvents(client, { fetchImpl: options.fetchImpl, signal, onEvent: event => {
      const data = event?.data;
      if (data?.sessionID !== id) return;
      if (event.id) {
        if (seenEvents.has(event.id)) return;
        seenEvents.add(event.id);
        if (seenEvents.size > 8192) seenEvents.delete(seenEvents.values().next().value);
      }
      if (event.type === 'session.inbox.delivered' && data.inboxID === inputId) delivered = true;
      if (!delivered) return;
      if (event.type === 'session.text.delta' || event.type === 'session.reasoning.delta') {
        if (typeof data.delta !== 'string' || !data.assistantMessageID || !Number.isSafeInteger(data.ordinal)) return;
        const type = event.type === 'session.text.delta' ? 'text' : 'reasoning';
        const key = `${data.assistantMessageID}:${data.ordinal}:${type}`;
        if (streamed.size >= 2048 && !streamed.has(key)) return;
        const part = streamed.get(key) ?? { type, text: '' };
        part.text += data.delta; streamed.set(key, part);
        publish({ type, text: [...streamed.values()].filter(item => item.type === type).map(item => item.text).join('') });
      }
      if (event.type.startsWith('session.tool.') || event.type === 'permission.asked') wake?.();
    } });
    // Event connection is optional. Do not delay admission when it is unavailable.
    await Promise.race([stream.ready, new Promise(resolve => setTimeout(resolve, 100))]);
    const admitted = await request(`${base}/prompt`, { method: 'POST', body: { id: inputId, text: mapped.input } });
    if (admitted?.data?.id !== inputId) throw new Error('OpenCode 2 did not acknowledge the requested input identity.');
    poll = (async () => {
      while (!stopped && !signal?.aborted) {
        await new Promise(resolve => { const timer = setTimeout(resolve, stream.connected ? 2000 : 500); wake = () => { clearTimeout(timer); resolve(); }; });
        if (stopped || signal?.aborted) break;
        try { await recover(pollSignal); failedPolls = 0; } catch (error) {
          if (stopped || pollSignal.aborted) break;
          if (++failedPolls < 3) continue;
          failure = error;
          await request(`${base}/interrupt`, { method: 'POST', signal: undefined, timeoutMs: 4000 }).catch(() => {});
          break;
        }
      }
    })();
    await request(`/experimental${base}/wait`, { method: 'POST', timeoutMs: onPermission ? Math.max(finalTimeoutMs, 11 * 60_000) : finalTimeoutMs });
    if (failure) throw failure;
    const snapshot = await recover();
    if (!snapshot?.found) throw new Error('OpenCode 2 completed without the admitted input in its transcript.');
    const assistants = snapshot.messages.filter(message => message.type === 'assistant');
    if (!assistants.length) throw new Error('OpenCode 2 completed without an assistant reply.');
    const failed = assistants.find(message => message.error);
    if (failed) throw new Error(failed.error.message || 'OpenCode 2 generation failed.');
    const last = assistants.at(-1);
    const tokens = assistants.reduce((total, message) => {
      for (const name of ['input', 'output']) total[name] += message.tokens?.[name] ?? 0;
      for (const name of ['read', 'write']) total.cache[name] += message.tokens?.cache?.[name] ?? 0;
      return total;
    }, { input: 0, output: 0, cache: { read: 0, write: 0 } });
    completed = extract({ info: { tokens, model: `${last.model?.providerID}/${last.model?.id}` }, parts: [...partsOf(assistants), { type: 'step-finish', reason: last.finish ?? 'stop' }] }, { allowTools: Boolean(onPermission) });
    return completed;
  } finally {
    stopped = true; pollAbort.abort(); wake?.(); stream?.close();
    if (!completed) await request(`${base}/interrupt`, { method: 'POST', signal: undefined, timeoutMs: 4000 }).catch(() => {});
    await poll;
    if (sessionIdRef) sessionIdRef.current = null;
    if (conversation) await conversation.finish([...mapped.history, mapped.input, `${completed?.thinking ?? ''}${completed?.text ?? ''}`].filter(Boolean), Boolean(completed) && !signal?.aborted);
    else await remove(id).catch(() => {});
    metric('finished', { requestCount, firstTextMs, success: Boolean(completed), reused: attachment.reused, replayedMessages: attachment.history.length });
  }
}
