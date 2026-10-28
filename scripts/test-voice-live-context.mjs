// Real production bridge handler + owned SDK, offline synthetic provider, disposable history.
// Run: bun scripts/test-voice-live-context.mjs
// Or:  node scripts/test-voice-live-context.mjs --compiled (uses existing runtime JS; no build).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootIndex = process.argv.indexOf('--runtime-root');
if (rootIndex >= 0 && !process.argv[rootIndex + 1]) throw new Error('--runtime-root requires a path');
const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : fileURLToPath(new URL('..', import.meta.url));
const compiled = process.argv.includes('--compiled');
const layer = compiled ? 'src' : 'source';
const ext = compiled ? 'js' : 'ts';
const load = file => import(pathToFileURL(path.join(root, file)).href);
const { createAgentSession } = await load(`src/runtime/engine/${layer}/core/sdk.${ext}`);
const { DefaultResourceLoader } = await load(`src/runtime/engine/${layer}/core/resource-loader.${ext}`);
const { SettingsManager } = await load(`src/runtime/engine/${layer}/core/settings-manager.${ext}`);
const { SessionManager } = await load(`src/runtime/engine/${layer}/core/session-manager.${ext}`);
const { AssistantMessageEventStream } = await load(`src/runtime/providers/${layer}/utils/event-stream.${ext}`);
const { appendCanonicalMessage, findCanonicalMessageReceipt } = await load('src/agent-server/canonical-message-ledger.mjs');
const bridge = await readFile(path.join(root, 'src/zyra-ui-bridge.mjs'), 'utf8');
const start = bridge.indexOf('async function handleCanonicalMessageOperation(');
const end = bridge.indexOf('\nasync function handleSessionOperation(', start);
assert.ok(start >= 0 && end > start, 'Extract the actual production handler, not a copied implementation');
const handlerSource = bridge.slice(start, end);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'zyra-voice-live-context-'));
const sessions = [];
const completed = [];
const json = value => JSON.parse(JSON.stringify(value));
const contains = (messages, text) => JSON.stringify(messages).includes(text);
const model = { id: 'fixture', provider: 'fixture', api: 'fixture', name: 'Fixture', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 1024, contextWindow: 64000 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const response = () => ({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic typed completion.' }], stopReason: 'stop', usage, api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: Date.now() });
const finish = stream => { const message = response(); stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); stream.end(); };
function input(id, role = 'user', text = `VOICE_MARKER_${id}`) {
  return {
    operationId: `operation_${id}`, idempotencyKey: `voice:${id}`, conversationId: 'voice-context-fixture', messageId: `message_${id}`,
    role, producer: role === 'user' ? 'user' : 'realtime_foreground', modality: 'voice', text, attachmentIds: [], providerItemId: `provider_${id}`,
    providerStartedAt: '2026-08-09T04:00:00.000Z', providerCompletedAt: '2026-08-09T04:00:01.000Z',
    payloadSha256: createHash('sha256').update(`${id}:${role}:${text}`).digest('hex'),
    routeClaim: { foregroundRouteId: 'route_fixture', routeEpoch: 2, ownerClaimId: 'owner_fixture' },
  };
}
async function fixture(name, existingManager) {
  const directory = path.join(temporaryDirectory, name);
  await mkdir(directory, { recursive: true });
  const manager = existingManager ?? SessionManager.create(directory, directory, { id: name });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Offline synthetic Voice continuity regression.' });
  await resourceLoader.reload();
  const modelRuntime = { hasConfiguredAuth: () => true, checkAuth: async () => undefined, isUsingOAuth: () => false, getAuth: async () => undefined };
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, model, modelRuntime, settingsManager, resourceLoader, sessionManager: manager, tools: [] });
  sessions.push(session);
  const contexts = [];
  const sdkEvents = [];
  session.subscribe(event => sdkEvents.push(event));
  const result = { directory, manager, session, contexts, sdkEvents, hold: undefined };
  session.agent.streamFunction = (_model, context) => {
    contexts.push(structuredClone(context.messages));
    const stream = new AssistantMessageEventStream();
    if (result.hold) result.hold(stream);
    else queueMicrotask(() => finish(stream));
    return stream;
  };
  return result;
}
function harness(fixture) {
  const state = { runtime: { session: fixture.session }, events: [], failPublish: false };
  const send = event => {
    // Assert the observable commit boundary, not only state after the call.
    assert.equal(event.event.canonicalCommit, true);
    const message = event.event.message;
    const saved = readFileSync(fixture.manager.getSessionFile(), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(saved.filter(entry => entry.type === 'message' && entry.message.id === message.id).length, 1, 'UI commit requires exactly one durable entry');
    assert.deepEqual(json(state.runtime.session.agent.state.messages), json(fixture.manager.buildSessionContext().messages), 'Live SDK context must be synchronized before the UI commit');
    if (state.failPublish) throw new Error('Synthetic publication failure');
    state.events.push(event);
  };
  state.handle = vm.runInNewContext(`(${handlerSource})`, { runtime: state.runtime, appendCanonicalMessage, findCanonicalMessageReceipt, send });
  state.append = payload => state.handle('canonical_message.append', payload);
  return state;
}
function snapshot(fixture, harness) {
  return json({ entries: fixture.manager.getEntries(), live: fixture.session.messages, events: harness.events, providerCalls: fixture.contexts.length, sdkEvents: fixture.sdkEvents.length });
}
async function rejectedUnchanged(fixture, harness, payload, pattern) {
  const before = snapshot(fixture, harness);
  await assert.rejects(harness.append(payload), pattern);
  assert.deepEqual(snapshot(fixture, harness), before, 'Rejected operation must not mutate history/live state, publish, or invoke the provider');
}
async function prompt(fixture, text = 'What is this conversation about?') {
  const calls = fixture.contexts.length;
  await fixture.session.prompt(text, { expandPromptTemplates: false });
  assert.equal(fixture.contexts.length, calls + 1, 'Only the explicit typed prompt invokes a provider turn');
  return fixture.contexts.at(-1);
}

try {
  // Voice-first user/assistant, replay repair, typed continuation, and real disk reopen.
  {
    const f = await fixture('continuity');
    const h = harness(f);
    const user = input('continuity_user');
    const assistant = input('continuity_assistant', 'assistant');
    const initialEntries = f.manager.getEntries().length;
    assert.equal(existsSync(f.manager.getSessionFile()), false, 'A new SDK session has not yet created durable history');
    const first = await h.append(user);
    const replay = await h.append(structuredClone(user));
    assert.deepEqual(json(replay), json(first));
    await h.append(assistant);
    await h.append(structuredClone(assistant));
    assert.equal(f.manager.getEntries().length, initialEntries + 2, 'Canonical delivery/replay never double-persists through SDK events');
    assert.equal(f.sdkEvents.length, 0, 'Canonical synchronization emits no SDK lifecycle events');
    assert.equal(f.contexts.length, 0, 'Canonical synchronization never starts a model turn');
    assert.equal(f.session.messages.filter(message => message.id === user.messageId).length, 1);
    assert.equal(f.session.messages.filter(message => message.id === assistant.messageId).length, 1);
    // Simulate an interrupted earlier sync: even a durable receipt replay must repair all context.
    f.session.agent.state.messages = [];
    await h.append(user);
    assert.equal(contains(f.session.messages, assistant.text), true, 'Replay repairs the entire resolved live context');
    const next = await prompt(f);
    const userIndex = next.findIndex(message => contains(message, user.text));
    const assistantIndex = next.findIndex(message => contains(message, assistant.text));
    assert.ok(userIndex >= 0 && assistantIndex > userIndex && assistantIndex < next.length - 1, 'Next typed provider request includes both Voice roles in order');
    assert.equal(f.manager.getEntries().length, initialEntries + 4, 'Only the typed user and synthetic completion add further entries');
    const reopened = await fixture('reopened', SessionManager.open(f.manager.getSessionFile(), f.directory));
    const rh = harness(reopened);
    const persistedCount = reopened.manager.getEntries().length;
    await rh.append(user);
    await rh.append(assistant);
    assert.equal(reopened.manager.getEntries().length, persistedCount, 'Replay after reopening leaves disk entries unchanged');
    const restoredContext = await prompt(reopened);
    assert.equal(contains(restoredContext, user.text), true);
    assert.equal(contains(restoredContext, assistant.text), true);
    completed.push('Voice-first user + assistant, idempotent live repair, typed provider context, disk reopen');

    await rejectedUnchanged(f, h, { ...user, payloadSha256: 'f'.repeat(64) }, /different message payload/);
    await rejectedUnchanged(f, h, { ...input('identity_collision'), messageId: user.messageId }, /identity is already bound/);
    await rejectedUnchanged(f, h, { ...input('invalid'), role: 'system' }, /role must be user or assistant/);
    const beforeFind = snapshot(f, h);
    const found = await h.handle('canonical_message.find', { operationId: user.operationId });
    assert.deepEqual(json(found), json(first));
    assert.deepEqual(snapshot(f, h), beforeFind, 'Receipt lookup remains read-only');
    completed.push('Invalid/conflicting append and read-only receipt lookup boundaries');
  }

  // Replaying a committed receipt must resolve the current compacted branch, not flatten the ledger.
  {
    const f = await fixture('compacted-branch');
    const h = harness(f);
    const summarized = input('summarized');
    const kept = input('kept');
    await h.append(summarized);
    await h.append(kept);
    const keepEntry = f.manager.getEntries().find(entry => entry.message?.id === kept.messageId);
    f.manager.appendCompaction('Synthetic summary of prior context.', keepEntry.id, 100);
    const active = input('after_compaction');
    await h.append(active);
    await h.append(summarized);
    assert.equal(contains(f.session.messages, summarized.text), false, 'Receipt replay cannot resurrect summarized messages');
    assert.equal(contains(f.session.messages, kept.text), true);
    assert.ok(f.session.messages.some(message => message.role === 'compactionSummary'));
    const anchor = f.manager.getEntries().find(entry => entry.message?.id === active.messageId);
    const abandoned = input('abandoned_branch');
    await h.append(abandoned);
    f.manager.branch(anchor.id);
    const current = input('current_branch');
    await h.append(current);
    const count = f.manager.getEntries().length;
    await h.append(abandoned);
    assert.equal(f.manager.getEntries().length, count);
    assert.equal(contains(f.session.messages, abandoned.text), false, 'Receipt replay cannot select an abandoned branch');
    const context = await prompt(f);
    assert.equal(contains(context, summarized.text), false);
    assert.equal(contains(context, abandoned.text), false);
    assert.equal(contains(context, active.text), true);
    assert.equal(contains(context, current.text), true);
    completed.push('Compaction-aware and active-branch replay through the real provider context');
  }

  // Production guard rejects busy sessions BEFORE append; a held real provider exercises streaming.
  {
    const f = await fixture('busy-guard');
    const h = harness(f);
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.hold = stream => { release = () => finish(stream); entered(); };
    const run = f.session.prompt('Held synthetic typed request.', { expandPromptTemplates: false });
    try {
      await Promise.race([started, run.then(() => { throw new Error('SDK run ended before the held provider started'); })]);
      assert.equal(f.session.isStreaming, true);
      await rejectedUnchanged(f, h, input('while_streaming'), /current response or compaction/);
    } finally {
      release?.();
      await run;
    }
    f.hold = undefined;
    // Compaction is a separate SDK busy flag; no real summary/provider turn is needed for the guard.
    Object.defineProperty(f.session, 'isCompacting', { configurable: true, value: true });
    try { await rejectedUnchanged(f, h, input('while_compacting'), /current response or compaction/); }
    finally { delete f.session.isCompacting; }
    await h.append(input('after_busy'));
    assert.equal(f.contexts.length, 1, 'Retry once idle synchronizes without a second provider turn');
    completed.push('Real streaming and synthetic compaction busy guards leave history/context untouched');
  }

  // Fail the first durable flush AFTER appendMessage. A receipt exists in memory, but retry must flush it.
  {
    const f = await fixture('durability-retry');
    const h = harness(f);
    const payload = input('flush_retry');
    const beforeLive = json(f.session.messages);
    const getSessionDir = f.manager.getSessionDir;
    f.manager.getSessionDir = () => { throw new Error('Synthetic durability failure'); };
    try { await assert.rejects(h.append(payload), /Synthetic durability failure/); }
    finally { f.manager.getSessionDir = getSessionDir; }
    assert.equal(existsSync(f.manager.getSessionFile()), false, 'Failed first-user flush has no durable file');
    assert.deepEqual(json(f.session.messages), beforeLive, 'No live sync before durability succeeds');
    assert.equal(h.events.length, 0, 'No successful UI commit before durability succeeds');
    assert.ok(findCanonicalMessageReceipt(f.manager, payload.operationId), 'Failure left a receipt in memory');
    const count = f.manager.getEntries().length;
    await h.append(payload);
    assert.equal(f.manager.getEntries().length, count, 'Durability retry does not append again');
    const reopened = SessionManager.open(f.manager.getSessionFile(), f.directory);
    assert.ok(findCanonicalMessageReceipt(reopened, payload.operationId), 'Replayed receipt is now truly durable');
    assert.equal(contains(f.session.messages, payload.text), true);
    assert.equal(f.contexts.length, 0);
    assert.equal(f.sdkEvents.length, 0);
    completed.push('First-user durable-flush failure followed by receipt replay repairs disk before acknowledgment');
  }

  // Durable append can succeed while projection/publication fails. Retrying repairs without duplication.
  {
    const f = await fixture('sync-publication-retry');
    const h = harness(f);
    const payload = input('projection_retry');
    const beforeLive = json(f.session.messages);
    const build = f.manager.buildSessionContext;
    f.manager.buildSessionContext = () => { throw new Error('Synthetic projection failure'); };
    try { await assert.rejects(h.append(payload), /Synthetic projection failure/); }
    finally { f.manager.buildSessionContext = build; }
    assert.deepEqual(json(f.session.messages), beforeLive);
    assert.equal(h.events.length, 0);
    assert.ok(findCanonicalMessageReceipt(SessionManager.open(f.manager.getSessionFile(), f.directory), payload.operationId));
    const count = f.manager.getEntries().length;
    await h.append(payload);
    assert.equal(f.manager.getEntries().length, count);
    const missing = input('missing_live_state');
    h.runtime.session = { sessionManager: f.manager, agent: null };
    try { await assert.rejects(h.append(missing), /live canonical context is unavailable/); }
    finally { h.runtime.session = f.session; }
    assert.equal(h.events.length, 1, 'Missing SDK context cannot acknowledge another commit');
    await h.append(missing);
    assert.equal(contains(f.session.messages, missing.text), true);
    const publish = input('publication_retry', 'assistant');
    h.failPublish = true;
    try { await assert.rejects(h.append(publish), /Synthetic publication failure/); }
    finally { h.failPublish = false; }
    const persisted = f.manager.getEntries().length;
    await h.append(publish);
    assert.equal(f.manager.getEntries().length, persisted);
    assert.equal(f.session.messages.filter(message => message.id === publish.messageId).length, 1);
    assert.equal(f.contexts.length, 0);
    assert.equal(f.sdkEvents.length, 0, 'Failure recovery must not use prompt/sendCustomMessage SDK paths');
    completed.push('Projection, unavailable live state, and publication failures recover from durable receipts');
  }

  // Conversation-owned task outcomes accompany the next typed turn as hidden data, not a second answer.
  {
    const { hiddenTurnContext, skillTurnContext } = await load('src/turn-context.mjs');
    const sdkSource = await readFile(path.join(root, 'src/zyra-sdk.mjs'), 'utf8');
    const contextStart = sdkSource.indexOf('function prepareZyraTurnContext(');
    const contextEnd = sdkSource.indexOf('\nexport async function runZyraPrompt(', contextStart);
    const prepare = vm.runInNewContext(`(${sdkSource.slice(contextStart, contextEnd)})`, { hiddenTurnContext, skillTurnContext, injectLayeredMemory: () => '', defaults: { dataRoot: temporaryDirectory } });
    const f = await fixture('private-outcome-turn-context');
    const runtime = { session: f.session, memoryEnabled: false };
    const prompt = 'What happened to the task started in Voice?';
    const outcome = 'Private task completed. Verified output is stored at the requested path.';
    const options = { privateVoiceTaskContext: outcome };
    const contextMessages = prepare(runtime, prompt, prompt, options);
    assert.equal(contextMessages.length, 1);
    assert.equal(contextMessages[0].customType, 'zyra_voice_task_context');
    assert.equal(contextMessages[0].display, false);
    await f.session.prompt(prompt, { contextMessages, expandPromptTemplates: false });
    assert.equal(contains(f.contexts.at(-1), outcome), true);
    assert.equal(f.session.messages.filter(message => message.role === 'user' && contains(message.content, prompt)).length, 1);
    assert.equal(f.session.messages.filter(message => message.role === 'user' && contains(message.content, outcome)).length, 0);
    assert.equal(prepare(runtime, prompt, prompt, options).length, 0, 'Unchanged retained task context does not duplicate history');
    assert.equal(prepare(runtime, prompt, prompt, { privateVoiceTaskContext: 'Task interrupted, verify effects before retrying.' }).length, 1);
    assert.throws(() => prepare(runtime, prompt, prompt, { privateVoiceTaskContext: {} }), /Invalid private Voice task context/);
    let forwarded;
    const sdk = { setZyraMemoryEnabled() {}, setZyraReasoningSummary() {}, async runZyraPrompt(_runtime, userPrompt, actualOptions) { forwarded = { userPrompt, actualOptions }; } };
    const promptStart = bridge.indexOf('async function handlePrompt(');
    const promptEnd = bridge.indexOf('\nfunction messageTextForTitle(', promptStart);
    const handle = vm.runInNewContext(`(${bridge.slice(promptStart, promptEnd)})`, { runtime, loadSdk: async () => sdk, applyChatConfig: async () => {}, normalizePromptImages: () => [] });
    await handle({ prompt, privateVoiceTaskContext: outcome });
    assert.equal(forwarded.userPrompt, prompt);
    assert.equal(forwarded.actualOptions.privateVoiceTaskContext, outcome);
    completed.push('Private task outcomes reach the next typed provider request as atomic, hidden, deduplicated context');
  }

  console.log(JSON.stringify({ runtime: layer, provider: 'offline synthetic stream through the real SDK', passed: completed }, null, 2));
} finally {
  for (const session of sessions) session.dispose();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
