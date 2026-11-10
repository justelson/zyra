import { setTimeout as paceTransfer } from 'node:timers/promises';
import { UsageIndex } from './usage-index.mjs';
import { UploadStore } from './uploads.mjs';
import { MobileOutbound } from './outbound.mjs';
import { acquireHostLock } from './process-lock.mjs';
import https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { DeviceStore } from './device-store.mjs';
import { OperationLedger } from './operations.mjs';
import { BodyCache, MAX_FRAME_BYTES, mobileEvent } from './projection.mjs';
import { HostRouter, isRead } from './router.mjs';
import { assert, fault, publicError } from './errors.mjs';

import { projectRuntimeStatus, mobileRuntimeStatus } from './runtime-status.mjs';

export function createGateway(options) {
  const release = acquireHostLock(options.directory);
  try {
    const gateway = createGatewayRuntime(options);
    const close = gateway.close.bind(gateway);
    let closing;
    gateway.close = () => closing ||= close().finally(release);
    return gateway;
  } catch (error) { release(); throw error; }
}
function createGatewayRuntime({ tls, directory, projects, allProjects = false, hiddenProjects = [], name = 'Zyra', clientFactory, prepareChat, regenerateTitle, review, fleet, accountLimits, resolveScope, searchChats, searchContext, projectPresentation, terminalFactory, voiceFactory, pluginFactory, runtimeStatus, captures, timingSummary }) {
  const readRuntimeStatus = () => { try { return projectRuntimeStatus(runtimeStatus?.()); } catch { return undefined; } };
  const usage = new UsageIndex({ directory });
  const devices = new DeviceStore(directory), ledger = new OperationLedger(directory), cache = new BodyCache(), uploads = new UploadStore(directory);
  const pruneCaches = setInterval(() => { cache.prune(); cache.media.prune(); }, 60000); pruneCaches.unref();
  const voiceCleanups = new Set();
  const voiceSessions = new Map();
  const pluginSessions = new Map();
  const stopConnectionWork = ws => {
    pluginSessions.get(ws)?.close(); pluginSessions.delete(ws);
    const voice = voiceSessions.get(ws);
    if (!voice) return;
    voiceSessions.delete(ws);
    const cleanup = Promise.resolve().then(() => voice.close()).catch(() => {}).finally(() => voiceCleanups.delete(cleanup));
    voiceCleanups.add(cleanup);
  };
  const connections = new Map();
  let pairAttempts = 0, attemptWindow = Date.now();
  const http = https.createServer(tls, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/pair' || req.headers.origin) { res.writeHead(404).end('{}'); return; }
    if (Date.now() - attemptWindow > 60000) { attemptWindow = Date.now(); pairAttempts = 0; }
    if (++pairAttempts > 12) { res.writeHead(429).end('{}'); req.resume(); return; }
    let bytes = 0; const chunks = [];
    req.setTimeout(5000, () => req.destroy());
    try {
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) throw new Error('Pairing request is too large.'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const paired = devices.pair(body.secret, body.name, body.previous);
      res.end(JSON.stringify({ ...paired, name, version: 1 }));
    } catch (error) { if (!res.destroyed) res.writeHead(400).end(JSON.stringify({ error: publicError(error) })); }
  });
  http.requestTimeout = 10000; http.headersTimeout = 5000; http.maxConnections = 24;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: { threshold: 2048, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 1 } });
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/connect' || req.headers.origin || wss.clients.size >= 16) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let terminal = null, voice = null, plugins = null, inputQueue = Promise.resolve(), bulkNext = 0, voiceTokens = 40, voiceRefill = Date.now();
    let device = null, client = null, router = null, authenticating = false, active = 0, ordinaryActive = 0, catalogTimer, tokens = 60, refill = Date.now();
    const authTimer = setTimeout(() => ws.close(1008, 'Authenticate first'), 5000); authTimer.unref();
    const outbound = new MobileOutbound(ws);
    const send = value => outbound.send(value);
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 30000);
    heartbeat.unref();
    ws.on('message', async data => {
      let message;
      try {
        message = JSON.parse(data.toString());
        if (!device) {
          if (authenticating || message.type !== 'hello' || message.version !== 1) throw fault('UNSUPPORTED_PROTOCOL', 'Update Zyra on this phone and PC to connect.');
          authenticating = true;
          const authenticated = devices.authenticate(message.deviceId, message.token);
          if (!authenticated) throw fault('DEVICE_REVOKED', 'Device access was revoked. Pair again from your PC.');
          const previous = connections.get(authenticated.id);
          if (previous) { stopConnectionWork(previous); previous.close(1000, 'Connected from another window'); }
          assert(typeof clientFactory === 'function', 'The host runtime is not configured.');
          client = await clientFactory(authenticated);
          await client.connect();
          if (ws.readyState !== WebSocket.OPEN) { client.close(); return; }
          device = authenticated;
          terminal = terminalFactory?.(device, event => send({ type: 'terminal.event', ...event }));
          voice = voiceFactory?.(device, payload => send({ type: 'voice.event', ...payload }));
          if (voice) voiceSessions.set(ws, voice);
          plugins = pluginFactory?.(device, () => send({ type: 'plugins.changed' }));
          if (plugins) pluginSessions.set(ws, plugins);
          router = new HostRouter({ client, owner: device.id, cache, projects, allProjects, hiddenProjects: [...hiddenProjects, ...(device.hiddenProjects || [])], prepareChat, regenerateTitle, review, fleet, accountLimits, usage, resolveScope, searchChats, searchContext, projectPresentation, terminal, voice, plugins, uploads, captures, timingSummary, runtimeStatus: () => mobileRuntimeStatus(client.connectionStatus, readRuntimeStatus()) });
          connections.set(device.id, ws);
          client.on('session-event', event => send(mobileEvent(event, device.id, cache)));
          client.on('runtime-status', event => {
            const status = mobileRuntimeStatus(event, readRuntimeStatus());
            if (status) send({ type: 'host.runtime-status', serverTime: Date.now(), ...status });
          });
          client.on('catalog-changed', () => {
            if (catalogTimer) return;
            catalogTimer = setTimeout(() => { catalogTimer = null; send({ type: 'catalog.changed' }); }, 250);
            catalogTimer.unref();
          });
          client.on('disconnect', () => ws.close(1012, 'Host service disconnected'));
          clearTimeout(authTimer);
          const initialRuntimeStatus = mobileRuntimeStatus(client.connectionStatus, readRuntimeStatus());
          send({ type: 'hello.ok', version: 1, serverTime: Date.now(), hostId: devices.state.hostId, name, projects: await router.visibleProjects(),
            ...(initialRuntimeStatus ? { runtimeStatus: initialRuntimeStatus } : {}), limits: { frameBytes: MAX_FRAME_BYTES, inlineBytes: 32768, historyPage: 60 },
            capabilities: ['chats', 'account-usage', ...(review?.details ? ['session-details'] : []), ...(regenerateTitle ? ['title-generation'] : []), ...(review ? ['turn-review'] : []), ...(accountLimits ? ['account-limits'] : []), 'approvals', 'questions', 'models', 'agents', 'workflows', 'lazy-bodies', 'image-uploads', 'project-images', 'media-playback', ...(timingSummary ? ['timing-summaries'] : []), ...(captures && allProjects && router.hiddenProjects.length === 0 ? ['browser-captures'] : []), 'file-links', 'files', 'file-move', 'git-review', ...(terminal ? ['terminal', ...(terminal.supportsSplit === true ? ['terminal-split'] : [])] : []), ...(voice ? ['voice', ...(voice.supportsDictation === true ? ['dictation'] : [])] : []), ...(plugins ? ['plugins', ...(plugins.supportsMachineScope === true ? ['plugins-machine'] : [])] : [])] });
          return;
        }
        if (!devices.list().some(item => item.id === device.id)) { ws.close(1008, 'Device access revoked'); return; }
        assert(message.type === 'request' && typeof message.id === 'string' && /^[a-zA-Z0-9:._-]{1,100}$/.test(message.id), 'Invalid request.');
        tokens = Math.min(60, tokens + (Date.now() - refill) / 1000 * 10); refill = Date.now();
        const bulk = ['upload.chunk', 'media.chunk', 'workspace.image.chunk', 'workspace.media.chunk', 'captures.chunk', 'voice.recovery.chunk', 'dictation.chunk'].includes(message.method);
        const voiceBatch = message.method === 'voice.ingest';
        if (voiceBatch) {
          voiceTokens = Math.min(40, voiceTokens + (Date.now() - voiceRefill) / 1000 * 20); voiceRefill = Date.now();
          assert(voiceTokens >= 1, 'Voice events are arriving too quickly.'); voiceTokens--;
        }
        const urgent = (message.method === 'session.request' && ['abort', 'approval.respond', 'user_input.respond'].includes(message.params?.type))
          || message.method === 'voice.stop' || message.method === 'voice.recovery.cancel' || message.method === 'dictation.cancel' || (message.method === 'terminal.input' && message.params?.data === '\x03');
        assert(tokens >= (urgent || bulk || voiceBatch ? 0 : 1) && active < 8 && (urgent || ordinaryActive < 6), 'Too many requests. Please wait.');
        if (!urgent && !bulk && !voiceBatch) tokens--; active++; if (!urgent) ordinaryActive++;
        try {
          // One 48 KiB bulk chunk every 24 ms (~2 MiB/s) per phone. Pacing
          // happens within bounded request slots, leaving approvals independent.
          if (bulk) {
            const delay = Math.max(0, bulkNext - Date.now()); bulkNext = Date.now() + delay + 24;
            if (delay) await paceTransfer(delay);
            assert(ws.readyState === WebSocket.OPEN, 'The phone disconnected.');
          }
          const run = () => {
            if (message.method !== 'operation.status') return router.dispatch(message.method, message.params, message.id);
            if (message.params?.ids !== undefined) {
              assert(Array.isArray(message.params.ids) && message.params.ids.length <= 100 && message.params.ids.every(id => typeof id === 'string' && id.length <= 100), 'Invalid operation identifiers.');
              return { operations: message.params.ids.map(id => ({ id, ...ledger.status(device.id, id) })) };
            }
            return ledger.status(device.id, message.params?.id);
          };
          const execute = () => { if (message.method !== 'terminal.input') return run(); const next = inputQueue.then(run, run); inputQueue = next.catch(() => {}); return next; };
          const result = isRead(message.method, message.params) ? await execute() : await ledger.run(device.id, message.id, { method: message.method, params: message.params || {} }, run);
          send({ type: 'response', id: message.id, ok: true, result });
        } finally { active--; if (!urgent) ordinaryActive--; }
      } catch (error) {
        send({ type: 'response', id: message?.id, ok: false, error: publicError(error) });
        if (!device) ws.close(1008, 'Pair with this host first');
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      outbound.close(); clearTimeout(authTimer); clearTimeout(catalogTimer); clearInterval(heartbeat); terminal?.close(); plugins?.close(); client?.close();
      stopConnectionWork(ws);
      if (device && connections.get(device.id) === ws) connections.delete(device.id);
    });
  });
  return {
    devices, cache,
    connectedDeviceIds() { return [...connections].filter(([, ws]) => ws.readyState === WebSocket.OPEN).map(([id]) => id); },
    async listen(host = '127.0.0.1', port = 0) {
      await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); });
      return http.address();
    },
    setAccess(id, access) {
      devices.setAccess(id, access);
      cache.clearOwner(id);
      // Recreate only this phone's router/subscriptions with its new policy.
      // Terminating prevents queued private output from escaping after the change.
      const ws = connections.get(id); if (ws) { stopConnectionWork(ws); ws.terminate(); }
    },
    revoke(id) { devices.revoke(id); cache.clearOwner(id); const ws = connections.get(id); if (ws) { stopConnectionWork(ws); ws.close(1008, 'Device access revoked'); } },
    async close() {
      clearInterval(pruneCaches);
      for (const ws of wss.clients) { stopConnectionWork(ws); ws.terminate(); }
      await new Promise(resolve => wss.close(resolve));
      await Promise.allSettled([...voiceCleanups]);
      await new Promise(resolve => http.close(resolve)); http.closeAllConnections?.();
    }
  };
}



