import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFleetModelCatalog } from '../src/agents/model-catalog.mjs';
import { ModelRouter } from '../src/agents/model-router.mjs';
import {
  HARNESS_PROVIDER_ID,
  buildHarnessExtensionConfig,
  createHarnessStreamSimple,
  detectHarness,
  ensureHarnessServe,
  prepareHarnessServe,
  extractHarnessReply,
  findHarnessExecutable,
  harnessServeStatus,
  listHarnessModels,
  mapPiContextToHarness,
  mapProviderCatalog,
  managedHarnessConfig,
  readHarnessVersion,
  runHarnessTextTurn,
  stopHarnessServe,
} from '../src/opencode-harness.mjs';
import { connectHarnessProvider, disconnectHarnessProvider, listModelProviders, restoreHarnessProvider } from '../src/provider-connections.mjs';
import { coerceThinkingLevelForModel, getModelThinkingLevels } from '../src/thinking-levels.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'zyra-harness-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  assert.equal(managedHarnessConfig(JSON.stringify({ provider: { example: { baseURL: 'https://example.test' } }, permission: { bash: 'allow' } })).provider.example.baseURL, 'https://example.test');
  assert.equal(managedHarnessConfig(JSON.stringify({ permission: { bash: 'allow' } })).permission.bash, 'ask');
  assert.equal(managedHarnessConfig(JSON.stringify({ permission: { bash: { '*': 'ask', 'rm *': 'deny', 'git *': 'allow' } } })).agent['zyra-managed'].permission.bash['rm *'], 'deny');
  assert.equal(managedHarnessConfig(JSON.stringify({ permission: 'deny' })).agent['zyra-managed'].permission.bash, 'deny');
  assert.equal(managedHarnessConfig().agent['zyra-managed'].permission.skill, 'deny', 'unsupported native skill catalog is not advertised alongside Zyra skills');
  assert.throws(() => managedHarnessConfig('{bad json'), /could not be safely merged/);
  /* Detection: pure PATH scan, no subprocess. */
  const winEnv = { PATH: 'C:\\tools;C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1' };
  assert.equal(findHarnessExecutable({ env: winEnv, platform: 'win32', exists: (p) => p === path.win32.join('C:\\bin', 'opencode.exe') }), path.win32.join('C:\\bin', 'opencode.exe'));
  assert.equal(findHarnessExecutable({ env: winEnv, platform: 'win32', exists: (p) => p === path.win32.join('C:\\bin', 'opencode.ps1') }), null, 'Shim scripts cannot be spawned headless');
  assert.equal(findHarnessExecutable({ env: { PATH: '/usr/bin:/bin' }, platform: 'linux', exists: (p) => p === path.posix.join('/usr/bin', 'opencode') }), path.posix.join('/usr/bin', 'opencode'));
  assert.equal(findHarnessExecutable({ env: {}, platform: 'linux', exists: () => true }), null);
  const winFullEnv = { ...winEnv, APPDATA: 'C:\\Users\\test\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\test' };
  assert.equal(
    findHarnessExecutable({ env: winFullEnv, platform: 'win32', exists: (p) => p === path.win32.join(winFullEnv.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe') || p === path.win32.join('C:\\bin', 'opencode.cmd') }),
    path.win32.join(winFullEnv.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    'The native binary wins over PATH shims',
  );
  assert.equal(
    findHarnessExecutable({ env: { ...winEnv, USERPROFILE: 'C:\\Users\\test' }, platform: 'win32', exists: (p) => p === path.win32.join('C:\\bin', 'opencode.cmd') }),
    path.win32.join('C:\\bin', 'opencode.cmd'),
    'A .cmd shim remains usable when no native binary exists',
  );
  const { isHarnessScriptExecutable } = await import('../src/opencode-harness.mjs');
  assert.equal(isHarnessScriptExecutable('C:\\x\\opencode.cmd', 'win32'), true);
  assert.equal(isHarnessScriptExecutable('C:\\x\\opencode.exe', 'win32'), false);
  assert.equal(isHarnessScriptExecutable('/usr/bin/opencode', 'linux'), false);

  const goodExec = (out) => (file, args, opts, callback) => callback(null, out, '');
  assert.equal(await readHarnessVersion({ executable: '/bin/opencode', execFile: goodExec('opencode 1.18.31\n') }), '1.18.31');
  assert.equal(await readHarnessVersion({ executable: '/bin/opencode', execFile: (f, a, o, cb) => cb(new Error('missing')) }), null);
  const detected = await detectHarness({ executable: '/bin/opencode', execFile: goodExec('1.18.31') });
  assert.deepEqual(detected, { executable: '/bin/opencode', version: '1.18.31' });
  assert.equal(await detectHarness({ executable: '/bin/opencode', execFile: goodExec('not-opencode') }), null);

  /* Catalog mapping from a canned /provider payload. */
  const providerPayload = {
    connected: ['opencode', 'google'],
    all: [
      {
        id: 'opencode', models: {
          'big-pickle': { id: 'big-pickle', name: 'Big Pickle', capabilities: { reasoning: true, toolcall: true, input: { text: true } }, cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, variants: { medium: { reasoningEffort: 'medium' } }, limit: { context: 200000, output: 32000 }, status: 'active' },
          'paid-model': { id: 'paid-model', name: 'Paid', capabilities: { reasoning: false, toolcall: true }, cost: { input: 1, output: 2, cache: { read: 0, write: 0 } }, limit: { context: 50000, output: 8000 }, status: 'active' },
          'unknown-price': { id: 'unknown-price', name: 'Unknown price', capabilities: {}, limit: {}, status: 'active' },
          'retired-model': { id: 'retired-model', capabilities: {}, cost: {}, limit: {}, status: 'disabled' },
        },
      },
      { id: 'google', models: { 'gemini-x': { id: 'gemini-x', capabilities: { reasoning: true }, cost: { input: 1, output: 2 }, limit: {}, status: 'active' } } },
      { id: 'unconnected', models: { 'ghost': { id: 'ghost', capabilities: {}, cost: {}, limit: {}, status: 'active' } } },
    ],
  };
  const defs = mapProviderCatalog(providerPayload);
  assert.deepEqual(defs.map((model) => model.id), ['google/gemini-x', 'opencode/big-pickle', 'opencode/paid-model', 'opencode/unknown-price']);
  const pickle = defs.find((model) => model.id === 'opencode/big-pickle');
  assert.equal(pickle.api, 'openai-completions');
  assert.equal(pickle.reasoning, true);
  assert.equal(pickle.toolUse, true);
  assert.deepEqual(pickle.input, ['text']);
  assert.equal(pickle.contextWindow, 200000);
  assert.equal(pickle.maxTokens, 32000);
  assert.deepEqual(pickle.harness, { innerProvider: 'opencode', innerModel: 'big-pickle', toolcall: true, free: true, variants: ['medium'] });
  assert.deepEqual(getModelThinkingLevels({ provider: 'opencode-harness', ...pickle }), ['medium']);
  assert.deepEqual(getModelThinkingLevels({ provider: 'opencode-harness', ...defs.find((model) => model.id === 'opencode/paid-model') }), []);
  assert.equal(coerceThinkingLevelForModel('none', { provider: 'opencode-harness', id: 'openai/gpt-5.6-sol', reasoning: true, harness: { variants: ['none', 'high'] } }), 'none');
  assert.equal(defs.find((model) => model.id === 'opencode/paid-model').harness.free, false);
  assert.equal(defs.find((model) => model.id === 'google/gemini-x').toolUse, false);
  assert.equal(defs.find((model) => model.id === 'opencode/unknown-price').harness.free, false, 'Missing price data must not be treated as free');
  assert.equal(defs.find((model) => model.id === 'google/gemini-x').harness.free, false);
  assert.throws(() => mapProviderCatalog({ all: 'nope' }), /unrecognized provider catalog/);
  const listed = await listHarnessModels(
    { baseUrl: 'http://127.0.0.1:9', password: 'pw', fetch: async () => ({ ok: true, status: 200, json: async () => providerPayload }) },
  );
  assert.equal(listed.length, 4, 'The live list path maps through the same pure function');

  /* Context mapping. */
  const mapped = mapPiContextToHarness({
    systemPrompt: 'Be brief.',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ],
  });
  assert.deepEqual(mapped, { system: 'Be brief.', history: ['first', 'answer'], input: 'second' });
  assert.equal(mapPiContextToHarness({ messages: [{ role: 'user', content: 'hi' }] }).system, undefined);
  assert.equal(mapPiContextToHarness({ messages: [{ role: 'user', content: 'hi' }, { role: 'toolResult', toolCallId: '1', toolName: 'read', content: [{ type: 'text', text: 'data' }], isError: false, timestamp: 0 }] }).input.includes('tool read result'), true);
  assert.throws(() => mapPiContextToHarness({ messages: [{ role: 'user', content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }] }), /does not carry images/);
  assert.throws(() => mapPiContextToHarness({ messages: [] }), /at least one user message/);
  assert.throws(() => mapPiContextToHarness({ messages: [{ role: 'user', content: '  ' }] }), /non-empty user text/);

  /* Reply extraction. */
  const reply = extractHarnessReply({ info: { tokens: { input: 10, output: 5, total: 15 }, model: 'opencode/big-pickle' }, parts: [{ type: 'step-start', id: 's' }, { type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'step-finish', reason: 'stop' }] });
  assert.equal(reply.text, 'ab');
  assert.equal(reply.thinking, 'hmm');
  assert.equal(reply.stopReason, 'stop');
  assert.deepEqual(reply.usage, { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.equal(reply.responseModel, 'opencode/big-pickle');
  assert.equal(extractHarnessReply({ info: {}, parts: [{ type: 'step-finish', reason: 'length' }] }).stopReason, 'length');
  assert.throws(() => extractHarnessReply({ info: {}, parts: [{ type: 'step-finish', reason: 'aborted' }] }), /does not handle/);
  assert.throws(() => extractHarnessReply({ info: {}, parts: [{ type: 'tool', id: '1' }] }), /cannot execute or translate/);
  assert.equal(extractHarnessReply({ info: {}, parts: [{ type: 'tool', tool: 'read', state: { status: 'completed' } }] }, { allowTools: true }).text, '');
  assert.throws(() => extractHarnessReply({ info: {}, parts: [{ type: 'tool', tool: 'mcp_external', state: { status: 'completed' } }] }, { allowTools: true }), /unapproved tool/);
  assert.throws(() => extractHarnessReply({ info: {}, parts: [{ type: 'patch', id: '1' }] }), /cannot execute or translate/);
  assert.throws(() => extractHarnessReply({ info: {} }), /without parts/);

  /* Routing fetch: serves canned harness HTTP without any socket. */
  const calls = [];
  const ok = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  const routingFetch = (routes) => async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    const key = `${init.method ?? 'GET'} ${pathname}`;
    calls.push({ key, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[key];
    if (!handler) return { ok: false, status: 404, json: async () => { throw new Error('no json'); }, text: async () => 'not found' };
    return handler();
  };
  const sessionRoutes = (finalParts) => ({
    'GET /global/health': () => ok({ healthy: true, version: '9.9.9' }),
    'GET /provider': () => ok(providerPayload),
    'POST /session': () => ok({ id: 'ses_test' }),
    'POST /session/ses_test/message': () => ok({ info: { tokens: { input: 3, output: 7, total: 10 } }, parts: finalParts ?? [{ type: 'step-start', id: 's' }, { type: 'text', text: 'hello from harness' }, { type: 'step-finish', reason: 'stop' }] }),
    'DELETE /session/ses_test': () => ok(true),
    'POST /session/ses_test/abort': () => ok(true),
  });

  const preparationCalls = [];
  await prepareHarnessServe({ cwd: path.join(root, 'prepared-transport'), executable: 'fixture-opencode',
    spawnImpl: () => {
      const child = new EventEmitter(); child.pid = 123456;
      child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true; };
      return child;
    },
    fetchImpl: async (url, init = {}) => {
      const key = `${init.method || 'GET'} ${new URL(url).pathname}`;
      preparationCalls.push(key);
      if (key === 'GET /global/health') return ok({ healthy: true });
      if (key === 'GET /provider') return ok(providerPayload);
      if (key === 'GET /experimental/tool/ids') return ok(['read', 'bash']);
      if (key === 'POST /session') {
        await new Promise(resolve => setTimeout(resolve, 5_200));
        assert.equal(init.signal.aborted, false, 'project initialization outlives the five-second health deadline');
        return ok({ id: 'preparation-session' });
      }
      if (key === 'DELETE /session/preparation-session') return ok(null, 204);
      throw new Error(`Preparation made a model request: ${key}`);
    }
  });
  assert.deepEqual(preparationCalls, ['GET /global/health', 'GET /provider', 'GET /experimental/tool/ids', 'POST /session', 'DELETE /session/preparation-session'], 'preparation initializes providers/tools and cleans up an empty session without spending model quota');
  assert.equal(harnessServeStatus(path.join(root, 'prepared-transport')).running, true);
  await stopHarnessServe(path.join(root, 'prepared-transport'));

  /* Serve manager against a real stub HTTP server: proves loopback HTTP + auth. */
  const stubCalls = [];
  const stub = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      stubCalls.push({ method: request.method, url: request.url, auth: request.headers.authorization });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ healthy: true, version: 'stub' }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubPort = stub.address().port;
  const stubFetch = async (url, init = {}) => {
    const rewritten = String(url).replace(/http:\/\/127\.0\.0\.1:\d+/, `http://127.0.0.1:${stubPort}`);
    return fetch(rewritten, init);
  };
  const spawns = [];
  const makeChild = () => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.kill = () => { setImmediate(() => child.emit('exit', 0)); return true; };
    return child;
  };
  const recoveryCwd = path.join(root, 'recovering-project');
  const previousChild = makeChild();
  const previousLease = await ensureHarnessServe({ cwd: recoveryCwd, executable: '/bin/opencode', spawnImpl: () => previousChild, fetchImpl: stubFetch });
  previousChild.emit('exit', 0);
  const replacementLease = await ensureHarnessServe({ cwd: recoveryCwd, executable: '/bin/opencode', spawnImpl: makeChild, fetchImpl: stubFetch });
  previousLease.release();
  assert.equal(harnessServeStatus(recoveryCwd).active, 1, 'a delayed release from an exited server cannot release the replacement lease');
  replacementLease.release();
  assert.equal(harnessServeStatus(recoveryCwd).active, 0);
  await stopHarnessServe(recoveryCwd);
  try {
    const cwd = path.join(root, 'project-a');
    const leaseA = await ensureHarnessServe({ cwd, executable: '/bin/opencode', spawnImpl: (exe, args, opts) => { spawns.push({ exe, args, opts }); return makeChild(); }, fetchImpl: stubFetch, idleMs: 60 });
    const leaseB = await ensureHarnessServe({ cwd, executable: '/bin/opencode', spawnImpl: () => { throw new Error('must not spawn twice'); }, fetchImpl: stubFetch, idleMs: 60 });
    assert.equal(spawns.length, 1, 'Concurrent ensures share one owned instance');
    const [spawned] = spawns;
    assert.equal(spawned.exe, '/bin/opencode');
    assert.ok(spawned.args.includes('127.0.0.1') && !spawned.args.includes('0.0.0.0'), 'Serve binds loopback only');
    assert.ok(!spawned.args.join(' ').includes('mdns'), 'mDNS is never enabled');
    assert.equal(typeof spawned.opts.env.OPENCODE_SERVER_PASSWORD, 'string');
    assert.equal(spawned.opts.env.OPENCODE_SERVER_PASSWORD.length, 64);
    assert.deepEqual(JSON.parse(spawned.opts.env.OPENCODE_CONFIG_CONTENT), managedHarnessConfig());
    assert.equal(JSON.parse(spawned.opts.env.OPENCODE_CONFIG_CONTENT).agent['zyra-managed'].permission.task, 'deny');
    assert.equal(process.env.OPENCODE_SERVER_PASSWORD, undefined, 'The session password never leaks into the process environment');
    assert.match(leaseA.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(typeof leaseA.client.password, 'string');
    assert.ok(stubCalls.length >= 1 && stubCalls.every((call) => typeof call.auth === 'string' && call.auth.startsWith('Basic ')), 'Every probe carries basic auth');
    assert.equal(harnessServeStatus(cwd).running, true);
    leaseA.release();
    leaseB.release();
    leaseB.release();
    await sleep(250);
    assert.equal(harnessServeStatus(cwd).running, false, 'The idle instance stops itself');
  } finally {
    await stopHarnessServe();
    await new Promise((resolve) => stub.close(resolve));
  }

  /* Text turn + stream against routed fetch (no sockets, no processes). */
  const turnFetch = routingFetch(sessionRoutes());
  const turn = await runHarnessTextTurn({
    client: { baseUrl: 'http://127.0.0.1:9', password: 'pw', fetch: turnFetch },
    modelId: 'opencode/big-pickle',
    context: { systemPrompt: 'sys', messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'prior' }, { role: 'user', content: 'new' }] },
  });
  assert.equal(turn.text, 'hello from harness');
  let finishSlowReply;
  const progress = [];
  const progressiveFetch = routingFetch({
    ...sessionRoutes(),
    'POST /session/ses_test/message': () => new Promise((resolve) => { finishSlowReply = () => resolve(ok({ info: {}, parts: [{ type: 'text', text: 'hello world' }] })); }),
    'GET /session/ses_test/message': () => ok([{ info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'checking' }, { type: 'text', text: 'hello' }] }]),
  });
  const pendingProgressTurn = runHarnessTextTurn({
    client: { baseUrl: 'http://127.0.0.1:9', password: 'pw', fetch: progressiveFetch },
    modelId: 'opencode/big-pickle', context: { messages: [{ role: 'user', content: 'go' }] }, onProgress: (entry) => progress.push(entry),
  });
  await sleep(850);
  assert.deepEqual(progress, [{ type: 'reasoning', text: 'checking' }, { type: 'text', text: 'hello' }], 'reasoning and answer text are visible before the blocking POST completes');
  finishSlowReply();
  assert.equal((await pendingProgressTurn).text, 'hello world');
  const posted = calls.filter((call) => call.key === 'POST /session/ses_test/message').slice(0, 3);
  assert.equal(posted.length, 3, 'Two replayed turns plus the final message');
  assert.deepEqual(posted[0].body, { system: 'sys', model: { providerID: 'opencode', modelID: 'big-pickle' }, parts: [{ type: 'text', text: 'old' }], noReply: true });
  assert.deepEqual(posted[1].body.parts, [{ type: 'text', text: 'prior' }]);
  assert.equal(posted[1].body.noReply, true);
  assert.deepEqual(posted[2].body.tools, { '*': false }, 'The final text-only message explicitly denies every native tool');
  assert.equal(posted[2].body.noReply, undefined);
  assert.ok(calls.some((call) => call.key === 'DELETE /session/ses_test'), 'Private sessions are deleted');
  const toolPart = { type: 'tool', callID: 'call_1', tool: 'read', state: { status: 'running', input: { filePath: 'README.md' }, time: { start: 123 } } };
  let finishToolTurn;
  const permissionDecisions = [];
  const toolProgress = [];
  const toolFetch = routingFetch({
    ...sessionRoutes(),
    'POST /session/ses_test/message': () => new Promise((resolve) => { finishToolTurn = resolve; }),
    'GET /session/ses_test/message': () => ok([{ info: { role: 'assistant' }, parts: [toolPart] }]),
    'GET /permission': () => ok([{ id: 'permission_1', sessionID: 'ses_test', permission: 'read', patterns: ['README.md'], metadata: { callID: 'call_1' } }]),
    'POST /permission/permission_1/reply': () => {
      finishToolTurn(ok({ info: {}, parts: [{ ...toolPart, state: { ...toolPart.state, status: 'completed', output: 'contents', time: { start: 123, end: 456 } } }] }));
      return ok(true);
    },
  });
  const pendingToolTurn = runHarnessTextTurn({
    client: { baseUrl: 'http://127.0.0.1:9', password: 'pw', fetch: toolFetch },
    modelId: 'opencode/big-pickle', context: { messages: [{ role: 'user', content: 'read it' }] },
    onProgress: (entry) => toolProgress.push(entry),
    onPermission: async (request) => { permissionDecisions.push(request); return true; },
  });
  await sleep(850);
  const toolTurn = await pendingToolTurn;
  assert.equal(toolTurn.text, '');
  assert.deepEqual(permissionDecisions.map((request) => [request.toolName, request.input.filePath, request.toolCallId]), [['read', 'README.md', 'call_1']]);
  assert.ok(toolProgress.some((entry) => entry.type === 'tool' && entry.part.callID === 'call_1'));
  const toolPost = calls.findLast((call) => call.key === 'POST /session/ses_test/message' && call.body?.agent === 'zyra-managed');
  assert.equal(toolPost.body.tools, undefined, 'managed tools retain ask permission rather than granting allow');
  assert.deepEqual(calls.findLast((call) => call.key === 'POST /permission/permission_1/reply').body, { reply: 'once' });
  let finishDeniedTurn;
  const deniedFetch = routingFetch({
    ...sessionRoutes(),
    'POST /session/ses_test/message': () => new Promise((resolve) => { finishDeniedTurn = resolve; }),
    'GET /session/ses_test/message': () => ok([{ info: { role: 'assistant' }, parts: [toolPart] }]),
    'GET /permission': () => ok([{ id: 'permission_2', sessionID: 'ses_test', permission: 'read', patterns: ['README.md'], metadata: { callID: 'call_1' } }]),
    'POST /permission/permission_2/reply': () => {
      finishDeniedTurn(ok({ info: {}, parts: [{ ...toolPart, state: { ...toolPart.state, status: 'error', error: 'Permission denied' } }] }));
      return ok(true);
    },
  });
  const activities = [];
  const deniedStream = createHarnessStreamSimple({ executable: '/bin/opencode', fetchImpl: deniedFetch,
    onPermission: async () => false, onActivity: (event) => activities.push(event),
    ensureServe: async () => ({ baseUrl: 'http://127.0.0.1:9', client: { baseUrl: 'http://127.0.0.1:9', password: 'pw' }, release() {} }),
  })({ id: 'opencode/big-pickle' }, { messages: [{ role: 'user', content: 'read it' }] });
  const consumeDenied = (async () => { for await (const _event of deniedStream) { /* Drain Pi stream. */ } })();
  await sleep(850);
  await consumeDenied;
  assert.deepEqual(calls.findLast((call) => call.key === 'POST /permission/permission_2/reply').body, { reply: 'reject' });
  assert.deepEqual(activities.map((event) => event.type), ['tool_execution_start', 'tool_execution_end']);
  assert.equal(activities[1].isError, true);
  await assert.rejects(runHarnessTextTurn({
    client: { baseUrl: 'http://127.0.0.1:9', password: 'pw', fetch: routingFetch(sessionRoutes([{ type: 'text', text: 'x' }, { type: 'step', id: '1' }])) },
    modelId: 'opencode/big-pickle',
    context: { messages: [{ role: 'user', content: 'go' }] },
  }), /cannot execute or translate/);

  const streamFetch = routingFetch(sessionRoutes());
  const streamSimple = createHarnessStreamSimple({
    executable: '/bin/opencode',
    fetchImpl: streamFetch,
    ensureServe: async () => ({ baseUrl: 'http://127.0.0.1:9', client: { baseUrl: 'http://127.0.0.1:9', password: 'pw' }, release() {} }),
  });
  const stream = streamSimple({ id: 'opencode/big-pickle', harness: { innerProvider: 'opencode', innerModel: 'big-pickle', variants: ['medium'] } }, { messages: [{ role: 'user', content: 'stream me' }] }, { reasoning: 'medium' });
  const events = [];
  for await (const event of stream) events.push(event.type);
  assert.deepEqual(events, ['start', 'text_start', 'text_delta', 'text_end', 'done']);
  const final = await stream.result();
  assert.equal(final.role, 'assistant');
  assert.equal(final.provider, HARNESS_PROVIDER_ID);
  assert.equal(final.model, 'opencode/big-pickle');
  assert.deepEqual(final.content, [{ type: 'text', text: 'hello from harness' }]);
  assert.equal(final.usage.totalTokens, 10);
  assert.equal(final.stopReason, 'stop');
  assert.equal(calls.filter((call) => call.key === 'POST /session/ses_test/message').at(-1).body.variant, 'medium', 'The Pi reasoning level reaches OpenCode as a per-message variant');
  let finishStreamingReply;
  const liveStream = createHarnessStreamSimple({
    executable: '/bin/opencode',
    fetchImpl: routingFetch({
      ...sessionRoutes(),
      'POST /session/ses_test/message': () => new Promise((resolve) => { finishStreamingReply = () => resolve(ok({ info: {}, parts: [{ type: 'reasoning', text: 'checking' }, { type: 'text', text: 'hello world' }] })); }),
      'GET /session/ses_test/message': () => ok([{ info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'checking' }, { type: 'text', text: 'hello' }] }]),
    }),
    ensureServe: async () => ({ baseUrl: 'http://127.0.0.1:9', client: { baseUrl: 'http://127.0.0.1:9', password: 'pw' }, release() {} }),
  })({ id: 'opencode/big-pickle' }, { messages: [{ role: 'user', content: 'stream now' }] });
  const liveEvents = [];
  const consumeLive = (async () => { for await (const event of liveStream) liveEvents.push(event); })();
  await sleep(850);
  assert.ok(liveEvents.some((event) => event.type === 'thinking_delta' && event.delta === 'checking'));
  assert.ok(liveEvents.some((event) => event.type === 'text_delta' && event.delta === 'hello'), 'chat text arrives while OpenCode is still working');
  finishStreamingReply();
  await consumeLive;
  assert.ok(liveEvents.some((event) => event.type === 'text_delta' && event.delta === ' world'));
  const aborted = streamSimple({ id: 'opencode/big-pickle' }, { messages: [{ role: 'user', content: 'x' }] }, { signal: AbortSignal.abort() });
  const abortedEvents = [];
  for await (const event of aborted) abortedEvents.push(event.type);
  assert.deepEqual(abortedEvents, ['error']);
  assert.equal((await aborted.result()).stopReason, 'aborted');

  const extensionConfig = buildHarnessExtensionConfig({ models: defs });
  assert.equal(extensionConfig.name, 'OpenCode harness');
  assert.equal(extensionConfig.api, 'openai-completions');
  assert.equal(extensionConfig.authHeader, false);
  assert.equal(typeof extensionConfig.streamSimple, 'undefined');
  assert.ok(extensionConfig.models.length > 0);

  /* Provider wiring with fakes: no credentials persisted, registry fed. */
  const file = path.join(root, 'providers.json');
  const registered = new Map();
  const fakeRuntime = { modelRegistry: { registerProvider: (id, config) => registered.set(id, config), unregisterProvider: (id) => registered.delete(id) }, authStorage: { hasAuth: () => false } };
  const wireFetch = routingFetch(sessionRoutes());
  const wireSpawns = [];
  const wireHarness = {
    detect: { execFile: goodExec('opencode 1.18.31') },
    executable: '/bin/opencode',
    fetch: wireFetch,
    spawn: (exe, args, opts) => { wireSpawns.push({ exe, args }); return makeChild(); },
  };
  const connected = await connectHarnessProvider({}, { file, runtime: fakeRuntime, harness: wireHarness });
  assert.equal(connected.provider, HARNESS_PROVIDER_ID);
  assert.equal(connected.model, `${HARNESS_PROVIDER_ID}/opencode/big-pickle`, 'A free model is preferred by default');
  assert.equal(connected.verified, true);
  const saved = await readFile(file, 'utf8');
  assert.ok(!saved.includes('apiKey') && !saved.includes('local-harness-loopback'), 'No credential material is persisted');
  assert.ok(registered.has(HARNESS_PROVIDER_ID), 'The live registry receives the harness provider');
  assert.equal(typeof registered.get(HARNESS_PROVIDER_ID).streamSimple, 'function');
  const explicit = await connectHarnessProvider({ model: 'google/gemini-x' }, { file, runtime: fakeRuntime, harness: wireHarness });
  assert.equal(explicit.model, `${HARNESS_PROVIDER_ID}/google/gemini-x`);
  await assert.rejects(connectHarnessProvider({ model: 'nope/missing' }, { file, runtime: fakeRuntime, harness: wireHarness }), /not offered/);
  const listedProviders = await listModelProviders({ file, runtime: fakeRuntime, harness: { findExecutable: async () => '/bin/opencode' } });
  assert.equal(listedProviders.find((entry) => entry.provider === HARNESS_PROVIDER_ID)?.verified, true);
  const unlistedProviders = await listModelProviders({ file, runtime: fakeRuntime, harness: { findExecutable: async () => null } });
  assert.equal(unlistedProviders.find((entry) => entry.provider === HARNESS_PROVIDER_ID)?.verified, false, 'A removed binary reads as unverified');

  const restored = new Map();
  restoreHarnessProvider({ registerProvider: (id, config) => restored.set(id, config) }, { config: { models: defs } }, { executable: '/bin/opencode' });
  assert.ok(restored.has(HARNESS_PROVIDER_ID));
  assert.equal(typeof restored.get(HARNESS_PROVIDER_ID).refreshModels, 'function');
  assert.throws(() => restoreHarnessProvider({ registerProvider: () => {} }, { config: { models: [] } }), /no models/);
  assert.throws(() => restoreHarnessProvider({ registerProvider: () => {} }, { config: { models: [{ id: 'x' }] } }), /invalid/);

  await disconnectHarnessProvider({ file, runtime: fakeRuntime });
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[HARNESS_PROVIDER_ID], undefined);
  assert.ok(!registered.has(HARNESS_PROVIDER_ID), 'Disconnect unregisters the provider');
  await assert.rejects(disconnectHarnessProvider({ file, runtime: fakeRuntime }), /not found/);
  // Damaged metadata must fail before any process starts.
  const damaged = path.join(root, 'damaged.json');
  await writeFile(damaged, 'null');
  let spawnedAfterDamage = 0;
  await assert.rejects(connectHarnessProvider({}, {
    file: damaged, runtime: fakeRuntime,
    harness: { executable: '/bin/opencode', fetch: wireFetch, spawn: () => { spawnedAfterDamage += 1; return makeChild(); } },
  }), /could not be read/);
  assert.equal(spawnedAfterDamage, 0);
  // Missing binary fails before any verification traffic.
  let fetchAfterMissing = 0;
  const countingFetch = async (...args) => { fetchAfterMissing += 1; return wireFetch(...args); };
  await assert.rejects(connectHarnessProvider({}, {
    file, runtime: fakeRuntime,
    harness: { detect: { execFile: (f, a, o, cb) => cb(new Error('missing')) }, fetch: countingFetch, spawn: () => makeChild() },
  }), /not installed/);
  assert.equal(fetchAfterMissing, 0);

  /* The real Pi registry accepts the restored harness provider, with no credential. */
  const { createZyraRuntime } = await import('../src/zyra-runtime.mjs');
  const harnessAuthPath = path.join(root, 'harness-auth.json');
  const harnessModelsPath = path.join(root, 'harness-models.json');
  const harnessRuntime = await createZyraRuntime({ authPath: harnessAuthPath, modelsPath: harnessModelsPath, loadSavedProviders: false });
  restoreHarnessProvider(harnessRuntime.modelRegistry, { config: { models: defs } }, { executable: '/bin/opencode' });
  const piModels = harnessRuntime.modelRegistry.getAll().filter((model) => model.provider === HARNESS_PROVIDER_ID);
  assert.ok(piModels.length === defs.length, 'Every stored harness model registers with Pi');
  assert.equal(piModels.find((model) => model.id === 'opencode/big-pickle')?.toolUse, true, 'Tool-capable models use the ordinary Zyra tool executor');
  restoreHarnessProvider(harnessRuntime.modelRegistry, { config: { models: defs } }, {
    executable: '/bin/opencode', onPermission: async () => true, onActivity: () => {},
  });
  assert.equal(harnessRuntime.modelRegistry.getAll().find((model) => model.provider === HARNESS_PROVIDER_ID && model.id === 'opencode/big-pickle')?.toolUse, true);
  assert.ok(harnessRuntime.modelRegistry.getAvailable().some((model) => model.provider === HARNESS_PROVIDER_ID && model.id === 'opencode/big-pickle'), 'The auth marker satisfies Pi without any stored credential');
  assert.equal(harnessRuntime.authStorage.get(HARNESS_PROVIDER_ID), undefined, 'Pi holds no harness credential');
  harnessRuntime.modelRegistry.unregisterProvider(HARNESS_PROVIDER_ID);
  assert.ok(!harnessRuntime.modelRegistry.getAll().some((model) => model.provider === HARNESS_PROVIDER_ID), 'Unregister removes harness models');

  /* A stale stored catalog heals with one live re-list, then matches. */
  const { createZyraRuntime: createPiRuntime } = await import('../src/zyra-runtime.mjs');
  const { resolveHarnessModelSelection } = await import('../src/provider-connections.mjs');
  const { setModel, listAvailableModels } = await import('../src/zyra-sdk.mjs');
  const staleFile = path.join(root, 'stale-providers.json');
  const staleModels = defs.filter((model) => model.id !== 'opencode/big-pickle');
  await writeFile(staleFile, JSON.stringify({ 'opencode-harness': { label: 'OpenCode harness', model: 'opencode-harness/google/gemini-x', verifiedAt: new Date().toISOString(), config: { name: 'OpenCode harness', api: 'openai-completions', authHeader: false, baseUrl: 'http://127.0.0.1/opencode-harness', models: staleModels } } }));
  const staleRuntime = await createPiRuntime({ authPath: path.join(root, 'stale-auth.json'), modelsPath: path.join(root, 'stale-models.json'), providerConfigPath: staleFile });
  assert.ok(!staleRuntime.modelRegistry.getAvailable().some((model) => model.provider === HARNESS_PROVIDER_ID && model.id === 'opencode/big-pickle'), 'The stale store misses the model');
  const liveHarness = {
    detect: { execFile: goodExec('opencode 1.18.31') },
    executable: '/bin/opencode',
    fetch: routingFetch(sessionRoutes()),
    spawn: () => makeChild(),
  };
  const refreshedOptions = await listAvailableModels({
    authPath: path.join(root, 'stale-auth.json'),
    modelsPath: path.join(root, 'stale-models.json'),
    providerConfigPath: staleFile,
    forceRefresh: true,
    skipAvailability: true,
    harness: liveHarness,
    cwd: root,
  });
  assert.ok(refreshedOptions.some((model) => model.id === 'opencode-harness/opencode/big-pickle'), 'Explicit catalog refresh starts the harness and exposes its current model without a model request');
  const healed = await resolveHarnessModelSelection(staleRuntime.modelRegistry, 'opencode-harness/opencode/big-pickle', { file: staleFile, project: root, harness: liveHarness });
  assert.ok(healed && `${healed.provider}/${healed.id}` === 'opencode-harness/opencode/big-pickle', 'The live refresh heals the stale catalog');
  const healedFile = JSON.parse(await readFile(staleFile, 'utf8'));
  assert.ok(healedFile['opencode-harness'].config.models.some((model) => model.id === 'opencode/big-pickle'), 'A successful refresh converges stored metadata');
  assert.equal(await resolveHarnessModelSelection(staleRuntime.modelRegistry, 'opencode-harness/opencode/long-gone', { file: staleFile, project: root, harness: liveHarness }), null, 'A truly retired model stays missing');
  assert.equal(await resolveHarnessModelSelection(staleRuntime.modelRegistry, 'openai-codex/gpt-9', { project: root, harness: liveHarness }), null, 'Other providers never trigger the harness path');
  let borrowedLeases = 0;
  const borrowedHarness = { executable: 'server-owned-harness', fetch: routingFetch(sessionRoutes()),
    spawn: () => { throw Error('Borrowed discovery must not spawn another service'); },
    detect: { execFile: () => { throw Error('A bound transport needs no additional binary probe'); } },
    ensureServe: async () => { borrowedLeases++; return { baseUrl: 'http://127.0.0.1:9', client: { baseUrl: 'http://127.0.0.1:9', password: 'fixture-borrowed' }, release() {} }; } };
  const borrowedOptions = { authPath: path.join(root, 'stale-auth.json'), modelsPath: path.join(root, 'stale-models.json'), providerConfigPath: staleFile,
    forceRefresh: true, skipAvailability: true, harness: borrowedHarness, cwd: root };
  assert.ok((await listAvailableModels(borrowedOptions)).some(model => model.id === 'opencode-harness/opencode/big-pickle'));
  assert.ok(await resolveHarnessModelSelection(staleRuntime.modelRegistry, 'opencode-harness/opencode/big-pickle', { file: staleFile, project: root, harness: borrowedHarness }));
  assert.equal(borrowedLeases, 2, 'catalog refresh and missing-model recovery reuse the server transport');
  let refreshSpawns = 0;
  assert.equal(await resolveHarnessModelSelection(staleRuntime.modelRegistry, 'opencode-harness/opencode/big-pickle', {
    project: root,
    harness: { detect: { execFile: (f, a, o, cb) => cb(new Error('missing')) }, fetch: async () => { throw new Error('must not fetch'); }, spawn: () => { refreshSpawns += 1; return makeChild(); } },
  }), null, 'Without a binary the fallback stays quiet');
  assert.equal(refreshSpawns, 0, 'Without a binary the fallback never spawns');
  // setModel surfaces actionable detail instead of a bare miss.
  const fakeSessionRuntime = {
    project: path.join(root, 'stale-project'),
    thinkingState: { value: 'off' },
    session: { modelRegistry: staleRuntime.modelRegistry, model: undefined, setModel: async () => {} },
  };
  await assert.rejects(setModel(fakeSessionRuntime, 'zz-top/model-x', {}), /zz-top\/model-x.*models available from:/s);

  /* Picker mapping: friendly slash-free labels with the full address in id. */
  const mapFile = path.join(root, 'map-providers.json');
  await writeFile(mapFile, JSON.stringify({ 'opencode-harness': { label: 'OpenCode harness', model: 'opencode-harness/opencode/big-pickle', verifiedAt: new Date().toISOString(), config: { name: 'OpenCode harness', api: 'openai-completions', authHeader: false, baseUrl: 'http://127.0.0.1/opencode-harness', models: defs } } }));
  const pickerOptions = await listAvailableModels({ authPath: path.join(root, 'picker-auth.json'), providerConfigPath: mapFile, skipAvailability: true });
  const pickerPickle = pickerOptions.find((model) => model.id === 'opencode-harness/opencode/big-pickle');
  assert.equal(pickerPickle.label, 'Big Pickle');
  assert.equal(pickerPickle.description, 'OpenCode harness');
  assert.ok(!pickerPickle.label.includes('/'), 'Picker rows never show harness address slashes');
  const pickerHarness = pickerOptions.filter((model) => model.id.startsWith('opencode-harness/'));
  assert.ok(pickerHarness.length > 0, 'Harness options survive listing');
  assert.ok(pickerHarness.every((model) => (model.id.match(/\//g) || []).length >= 2), 'Harness option ids stay fully qualified');

  /* Fleet catalog reflects upstream tool support. */
  const registry = {
    getAll: () => [
      { provider: HARNESS_PROVIDER_ID, id: 'opencode/big-pickle', name: 'Big Pickle', reasoning: true, toolUse: true, contextWindow: 200000 },
      { provider: HARNESS_PROVIDER_ID, id: 'google/gemini-x', name: 'Gemini X', reasoning: true, toolUse: false, contextWindow: 200000 },
      { provider: 'openai-codex', id: 'gpt-5.6-terra', name: 'Terra', reasoning: true, contextWindow: 400000 },
    ],
    getAvailable: function () { return this.getAll(); },
  };
  const catalog = buildFleetModelCatalog(registry);
  const harnessEntry = catalog.find((entry) => entry.key === `${HARNESS_PROVIDER_ID}/opencode/big-pickle`);
  assert.equal(harnessEntry.toolUse, true, 'Tool-capable OpenCode models can handle tool-requiring work');
  assert.equal(catalog.find((entry) => entry.key === `${HARNESS_PROVIDER_ID}/google/gemini-x`).toolUse, false);
  assert.equal(harnessEntry.eligible, true);
  const router = new ModelRouter({ catalog });
  const simple = router.route({ model: `${HARNESS_PROVIDER_ID}/opencode/big-pickle`, envelope: { task: 'implementation', tools: [] }, inheritModel: `${HARNESS_PROVIDER_ID}/opencode/big-pickle` });
  assert.equal(simple.selectedKey, `${HARNESS_PROVIDER_ID}/opencode/big-pickle`);
  const harnessOnly = new ModelRouter({ catalog: catalog.filter((entry) => entry.provider === HARNESS_PROVIDER_ID) });
  assert.equal(harnessOnly.route({ model: `${HARNESS_PROVIDER_ID}/opencode/big-pickle`, envelope: { task: 'implementation', tools: ['read'] }, inheritModel: `${HARNESS_PROVIDER_ID}/opencode/big-pickle` }).selectedKey, `${HARNESS_PROVIDER_ID}/opencode/big-pickle`);

  console.log('OpenCode harness contracts passed.');
} finally {
  await stopHarnessServe().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
