import { installToolMailbox } from '../../src/harness-v2-plugin/tool-mailbox.js';

/** Runs the actual plugin against native-shaped HTTP without a model or real tools. */
export async function harnessToolsFixture({ steps = [], brokenReads = 0 } = {}) {
  const registry = new Map(), hooks = new Map(), sessions = new Map(), requests = [];
  let handlers, transform, counter = 0, generated = 0;
  const disposable = () => ({ dispose: async () => {} });
  const rebuild = () => {
    registry.clear(); transform({ add: tool => registry.set(tool.name, tool) });
  };
  const cleanup = await installToolMailbox({
    tool: { transform: async callback => { transform = callback; rebuild(); return disposable(); }, reload: async () => rebuild() },
    rpc: { register: async (_definition, callbacks) => { handlers = callbacks; return disposable(); } },
    session: { hook: async (name, callback) => { hooks.set(name, callback); return disposable(); } },
  });
  const run = async (id, session) => {
    try {
      for (const step of steps) {
        const event = { sessionID: id, tools: { native_unsafe: {} }, system: [], messages: [] };
        await hooks.get('context')(event);
        session.contexts.push(event); generated++;
        const message = { id: `assistant_${counter++}`, type: 'assistant', content: [],
          model: { providerID: 'fixture', id: 'model' }, tokens: { input: 2, output: 1 } };
        session.messages.push(message);
        if (step.text) message.content.push({ type: 'text', text: step.text });
        if (step.calls) {
          message.finish = 'tool-calls';
          await Promise.all(step.calls.map(async call => {
            const tool = registry.get(call.name);
            if (!event.tools[call.name] || !tool) throw new Error('Tool was not exposed by the bound context.');
            message.content.push({ type: 'tool', id: call.id, name: call.name, state: { status: 'running', input: call.arguments } });
            const result = await tool.execute(call.arguments, { id: call.id, sessionID: id, signal: session.abort.signal });
            session.results.push({ id: call.id, result });
          }));
        } else message.finish = 'stop';
        message.time = { completed: Date.now() };
      }
    } catch (error) { session.failure = error; }
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url), route = parsed.pathname.replace(/^\/api/, ''), method = init.method ?? 'GET';
    const body = init.body && JSON.parse(init.body);
    requests.push({ route, method, body });
    if (route.startsWith('/rpc/zyra.tools/')) {
      if (!parsed.searchParams.get('location[directory]')) throw new Error('Missing RPC location.');
      return Response.json({ output: await handlers[route.split('/').at(-1)](body.input) });
    }
    if (route === '/event') return new Response('', { status: 404 });
    if (route === '/session' && method === 'POST') {
      const id = `ses_${counter++}`;
      sessions.set(id, { messages: [], contexts: [], results: [], abort: new AbortController() });
      return Response.json({ data: { id } });
    }
    const match = route.match(/^\/session\/([^/]+)(.*)$/);
    if (!match) throw new Error(`Unexpected fixture route: ${route}`);
    const [, id, suffix] = match, session = sessions.get(id);
    if (!suffix && method === 'GET') return Response.json({ data: { id, time: {} } });
    if (!suffix && method === 'PATCH') return new Response(null, { status: 204 });
    if (!suffix && method === 'DELETE') { sessions.delete(id); return new Response(null, { status: 204 }); }
    if (suffix === '/interrupt') { session.abort.abort(); return Response.json({ interrupted: true }); }
    if (suffix === '/prompt') {
      session.messages.push({ id: body.id, type: 'user' });
      session.running = run(id, session);
      return Response.json({ data: { id: body.id } });
    }
    if (suffix === '/message') {
      if (brokenReads-- > 0) throw new TypeError('fetch failed');
      return Response.json({ data: [...session.messages].reverse(), cursor: {} });
    }
    throw new Error(`Unexpected fixture route: ${route}`);
  };
  return { client: { apiVersion: 2, baseUrl: 'http://127.0.0.1:1234', password: 'fixture', cwd: '/fixture', fetch: fetchImpl },
    sessions, requests, registry, cleanup, get generated() { return generated; } };
}
