import { createHash } from 'node:crypto';

export const TOOL_RPC = 'zyra.tools';
const object = { type: 'object', additionalProperties: true };
export const toolRpcDefinition = {
  id: TOOL_RPC,
  methods: Object.fromEntries(['bind', 'poll', 'results', 'unbind'].map(name => [name, { input: object, output: object }])),
  events: { ready: { schema: { type: 'object', properties: { sessionID: { type: 'string' } }, required: ['sessionID'], additionalProperties: false } } },
};
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Keep model-bound signatures from native conversion for this exact call.
 * Never synthesize signatures, copy another call's proof or replace Zyra input.
 * Native conversion has already removed metadata after model switches/errors.
 */
export function preserveNativeToolReplay(messages, nativeMessages) {
  const byCall = new Map();
  for (const message of nativeMessages) if (message.role === 'assistant') {
    for (const part of message.content ?? []) if (part.type === 'tool-call') byCall.set(part.id, message);
  }
  return messages.map(message => {
    const call = message.role === 'assistant' && message.content.find(part => part.type === 'tool-call');
    const native = call && byCall.get(call.id);
    if (!native) return message;
    const reasoning = native.content.filter(part => part.type === 'reasoning' && (part.providerMetadata || part.encrypted));
    const content = message.content.filter(part => !reasoning.length || part.type !== 'reasoning').map(part => {
      const original = native.content.find(item => item.type === part.type && (part.type === 'tool-call'
        ? item.id === part.id && item.name === part.name : item.text === part.text));
      if (!original) return part;
      return { ...part, ...(original.providerMetadata ? { providerMetadata: original.providerMetadata } : {}),
        ...(typeof original.encrypted === 'string' ? { encrypted: original.encrypted } : {}) };
    });
    // Opaque/redacted reasoning may have no visible Pi text at all. Replay the
    // exact signed native blocks instead of fabricating or joining their text.
    return { ...message, content: [...reasoning, ...content] };
  });
}

/** Only exchanges requests/results. Every actual tool executes in Zyra's agent loop. */
export class ToolMailbox {
  constructor() { this.sessions = new Map(); }

  require({ sessionID, token }) {
    const binding = this.sessions.get(sessionID);
    if (!binding || binding.token !== token) throw new Error('Zyra tool binding is unavailable.');
    return binding;
  }

  bind(input) {
    if (typeof input.sessionID !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
      || !Array.isArray(input.tools) || input.tools.length > 512 || !Array.isArray(input.messages)) throw new Error('Invalid Zyra tool binding.');
    const previous = this.sessions.get(input.sessionID);
    if (previous && previous.token !== input.token) throw new Error('Zyra tool binding is already owned.');
    const tools = new Map();
    for (const tool of input.tools) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tool.name) || tools.has(tool.name)
        || typeof tool.description !== 'string' || !tool.input || typeof tool.input !== 'object') throw new Error('Invalid Zyra tool definition.');
      tools.set(tool.name, tool);
    }
    const binding = previous ?? { token: input.token, pending: new Map(), settled: new Map(), media: new Map() };
    const needed = new Set(input.messages.flatMap(message => (message.content ?? []).filter(part => part.type === 'zyra-image').map(part => `${part.mimeType.toLowerCase()}:${part.data}`)));
    for (const key of binding.media.keys()) if (!needed.has(key)) binding.media.delete(key);
    binding.mediaKeys = needed;
    Object.assign(binding, { tools, messages: input.messages, system: input.system || '' });
    this.sessions.set(input.sessionID, binding);
    return { bound: true };
  }

  poll(input) {
    const binding = this.require(input);
    return { calls: [...binding.pending.values()].map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) };
  }

  invoke(name, args, context) {
    const binding = this.sessions.get(context.sessionID);
    if (!binding?.tools.has(name) || context.signal?.aborted) throw new Error('This Zyra tool is unavailable in this chat.');
    const key = String(context.id);
    const signature = fingerprint([name, args]);
    const existing = binding.pending.get(key);
    if (existing) {
      if (existing.signature !== signature) throw new Error('Zyra tool identity changed.');
      return existing.promise;
    }
    if (binding.settled.has(key)) throw new Error('Zyra already delivered this tool result.');
    if (binding.pending.size >= 128 || binding.settled.size >= 4096) throw new Error('Zyra tool binding exceeded its call limit.');
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const call = { id: key, name, arguments: args, signature, promise, resolve, reject };
    binding.pending.set(key, call);
    this.onPending?.(context.sessionID);
    const cancel = () => {
      binding.pending.delete(key);
      reject(new Error('Zyra tool request was cancelled.'));
    };
    context.signal?.addEventListener('abort', cancel, { once: true });
    return promise.finally(() => context.signal?.removeEventListener('abort', cancel));
  }

  results(input) {
    const binding = this.require(input);
    if (!Array.isArray(input.results)) throw new Error('Invalid Zyra tool results.');
    // Validate the whole batch before releasing any executor.
    for (const result of input.results) {
      const call = binding.pending.get(result.id) ?? binding.settled.get(result.id);
      if (!call || call.name !== result.name || !Array.isArray(result.content)) throw new Error('Unowned Zyra tool result.');
      const signature = fingerprint(result);
      if (call.resultSignature && call.resultSignature !== signature) throw new Error('Zyra tool result changed after delivery.');
    }
    for (const result of input.results) {
      const call = binding.pending.get(result.id);
      if (!call) continue;
      call.resultSignature = fingerprint(result);
      binding.pending.delete(call.id);
      // Keep only delivery identities. Resolved promises retain potentially
      // large tool output and must not accumulate for the lifetime of a chat.
      binding.settled.set(call.id, { name: call.name, resultSignature: call.resultSignature });
      // Errors are returned as ordinary model context. The canonical Zyra record
      // retains isError, details and permission outcomes in their original form.
      call.resolve({ content: result.content });
    }
    return { delivered: true };
  }

  unbind(input) {
    const binding = this.require(input);
    this.sessions.delete(input.sessionID);
    for (const call of binding.pending.values()) call.reject(new Error('Zyra tool binding ended.'));
    binding.pending.clear(); binding.settled.clear(); binding.media.clear();
    return { removed: true };
  }

  dispose() {
    for (const [sessionID, binding] of this.sessions) this.unbind({ sessionID, token: binding.token });
  }
}

export async function installToolMailbox(ctx) {
  const mailbox = new ToolMailbox();
  // One stable transform; rebuild only when the union of tool names changes.
  // Per-chat schemas are supplied by the request hook below, never by this union.
  const registration = await ctx.tool.transform(editor => {
    const names = new Set([...mailbox.sessions.values()].flatMap(binding => [...binding.tools.keys()]));
    for (const name of names) editor.add({ name, description: 'Zyra managed tool', input: object, options: { codemode: false },
      execute: (input, context) => mailbox.invoke(name, input, context) });
  });
  let names = '';
  const reload = async () => {
    const next = [...new Set([...mailbox.sessions.values()].flatMap(binding => [...binding.tools.keys()]))].sort().join('\0');
    if (next !== names) { names = next; await ctx.tool.reload(); }
  };
  const rpc = await ctx.rpc.register(toolRpcDefinition, {
    bind: async input => { const result = mailbox.bind(input); await reload(); return result; },
    poll: async input => mailbox.poll(input),
    results: async input => mailbox.results(input),
    unbind: async input => { const result = mailbox.unbind(input); await reload(); return result; },
  });
  mailbox.onPending = sessionID => { void rpc.events?.emit('ready', { sessionID }).catch(() => {}); };
  const hook = await ctx.session.hook('context', event => {
    const binding = mailbox.sessions.get(event.sessionID);
    if (!binding) { if (event.agent === 'zyra-managed') event.tools = {}; return; }
    event.system = binding.system ? [{ type: 'text', text: binding.system }] : [];
    // Reuse media decoded by OpenCode's public prompt/file API. Do not create
    // competing media classes or introduce an AI SDK dependency in the plugin.
    for (const message of event.messages) for (const part of message.content ?? []) {
      if (part.type !== 'media') continue;
      const inline = part.media?.inline?.();
      const key = inline && `${inline.mime}:${inline.base64}`;
      if (key && binding.mediaKeys.has(key)) binding.media.set(key, part.media);
    }
    const messages = preserveNativeToolReplay(binding.messages, event.messages);
    event.messages = messages.map(message => ({ ...message, content: message.content.map(part => {
      if (part.type !== 'zyra-image') return part;
      const asset = binding.media.get(`${part.mimeType.toLowerCase()}:${part.data}`);
      if (!asset) throw new Error('OpenCode did not decode the chat image.');
      return { type: 'media', media: asset };
    }) }));
    event.tools = Object.fromEntries([...binding.tools].map(([name, tool]) => [name, { description: tool.description, input: tool.input }]));
  });
  return async () => { mailbox.dispose(); await hook.dispose(); await rpc.dispose(); await registration.dispose(); };
}
