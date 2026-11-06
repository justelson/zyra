/** Native V2 HTTP/SSE shapes. No process, model provider or filesystem tools. */
export function harnessV2Fixture({ tool, permissionSource = true, hold = false, noEvents = false, fail = false, paginate = false, lateTool = false, brokenSnapshots = false, slowPoll = false } = {}) {
  const sessions = new Map(), calls = [], replies = [];
  let events, eventCounter = 0, counter = 0, release, snapshotReads = 0, cancelledPolls = 0;
  const json = data => Response.json(data);
  const emit = (type, data, id = `evt_${++eventCounter}`) => {
    if (events) events.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id, type, data })}\n\n`));
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url), route = parsed.pathname.replace(/^\/api/, ''), method = init.method ?? 'GET';
    calls.push({ route, method, body: init.body && JSON.parse(init.body), query: parsed.search });
    if (!init.headers?.Authorization?.startsWith('Basic ') || init.redirect !== 'error') throw new Error('missing private transport guards');
    if (route === '/event') {
      if (noEvents) return new Response('unavailable', { status: 404 });
      return new Response(new ReadableStream({ start(controller) {
        events = controller;
        init.signal.addEventListener('abort', () => { try { controller.close(); } catch {} events = undefined; }, { once: true });
      }, cancel() { events = undefined; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (route === '/info') return json({ version: '2.2.5', pid: 123, urls: [], paths: { tmp: '/tmp' } });
    if (route === '/session' && method === 'POST') {
      const id = `ses_${++counter}`;
      sessions.set(id, { messages: [{ id: 'old', type: 'assistant', content: [{ type: 'text', text: 'OLD TURN' }] }], permissions: [], wait: Promise.resolve() });
      return json({ data: { id } });
    }
    const match = route.match(/\/session\/([^/]+)(.*)/);
    if (!match) throw new Error(`unexpected fixture route ${method} ${route}`);
    const [, sessionId, suffix] = match, session = sessions.get(sessionId), body = init.body && JSON.parse(init.body);
    if (suffix === '' && method === 'DELETE') { sessions.delete(sessionId); return new Response(null, { status: 204 }); }
    if (suffix === '/model' || suffix.includes('/instructions/entries/') || suffix === '' && method === 'PATCH') return new Response(null, { status: 204 });
    if (suffix === '/synthetic') {
      session.messages.push({ id: `history_${session.messages.length}`, type: 'synthetic', text: body.text });
      return json({ data: { id: session.messages.at(-1).id } });
    }
    if (suffix === '/prompt') {
      session.messages.push({ id: body.id, type: 'user', text: body.text });
      session.wait = new Promise(resolve => { session.resolve = resolve; release = resolve; });
      const assistant = { id: `assistant_${session.messages.length}`, type: 'assistant', model: { id: 'fixture', providerID: 'opencode' }, finish: 'stop',
        tokens: { input: 4, output: 2, cache: { read: 1, write: 0 } }, content: [{ type: 'text', text: 'hello' }] };
      if (fail) assistant.error = { type: 'FixtureFailure', message: 'fixture generation failed' };
      session.messages.push(assistant);
      session.assistant = assistant;
      // Admission and execution events can precede the HTTP acknowledgement.
      emit('session.text.delta', { sessionID: sessionId, assistantMessageID: 'old', ordinal: 0, delta: 'OLD TURN' });
      emit('session.inbox.delivered', { sessionID: sessionId, inboxID: body.id });
      emit('session.text.delta', { sessionID: 'foreign', assistantMessageID: 'foreign', ordinal: 0, delta: 'FOREIGN' });
      const textEvent = `evt_${++eventCounter}`;
      emit('session.text.delta', { sessionID: sessionId, assistantMessageID: assistant.id, ordinal: 0, delta: 'hello' }, textEvent);
      emit('session.text.delta', { sessionID: sessionId, assistantMessageID: assistant.id, ordinal: 0, delta: 'hello' }, textEvent);
      if (tool) {
        assistant.content.push({ type: 'tool', id: 'call', name: tool, state: { status: 'running', input: { command: 'fixture only' } }, time: { created: 1 } });
        session.permissions = [{ id: 'request', sessionID: sessionId, action: 'shell', resources: ['fixture only'],
          ...(permissionSource ? { source: { type: 'tool', messageID: assistant.id, id: 'call' } } : {}) }];
        setTimeout(() => emit('permission.asked', session.permissions[0]), 20);
      } else if (!hold) { if (slowPoll) setTimeout(session.resolve, 800); else session.resolve(); }
      return json({ data: { id: body.id } });
    }
    if (suffix === '/wait') {
      if (init.signal?.aborted) throw init.signal.reason;
      await Promise.race([session.wait, new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))]);
      return new Response(null, { status: 204 });
    }
    if (suffix === '/message') {
      if (brokenSnapshots) return new Response('', { status: 503 });
      if (slowPoll && snapshotReads++ === 0) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        init.signal.addEventListener('abort', () => { cancelledPolls++; clearTimeout(timer); reject(init.signal.reason); }, { once: true });
      });
      const items = structuredClone([...session.messages].reverse());
      if (lateTool && snapshotReads++ === 0) for (const message of items) if (message.type === 'assistant') message.content = message.content.filter(part => part.type !== 'tool');
      return json({ data: paginate ? parsed.searchParams.has('cursor') ? items.slice(1) : items.slice(0, 1) : items,
        cursor: { next: paginate && !parsed.searchParams.has('cursor') ? 'opaque cursor&2' : null } });
    }
    if (suffix === '/permission') {
      if (lateTool && snapshotReads === 1) setTimeout(() => emit('permission.asked', session.permissions[0]), 20);
      return json({ data: session.permissions });
    }
    if (suffix === '/permission/request/reply') {
      replies.push(body.decision);
      session.permissions = [];
      const part = session.assistant.content.find(part => part.type === 'tool');
      part.state = { ...part.state, status: body.decision === 'once' ? 'completed' : 'error', content: [{ type: 'text', text: 'fixture result' }], error: body.decision === 'reject' ? { message: 'denied' } : undefined };
      session.resolve();
      return new Response(null, { status: 204 });
    }
    if (suffix === '/interrupt') { session.resolve(); return json({ interrupted: true }); }
    throw new Error(`unexpected fixture route ${method} ${route}`);
  };
  return { client: { apiVersion: 2, baseUrl: 'http://127.0.0.1:1234', password: 'fixture', cwd: '/fixture', fetch: fetchImpl },
    calls, replies, sessions, get cancelledPolls() { return cancelledPolls }, release: () => release?.() };
}
