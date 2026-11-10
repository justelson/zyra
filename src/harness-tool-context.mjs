import { createHash } from 'node:crypto';

const imageFile = part => ({ type: 'file', mime: part.mimeType, uri: `data:${part.mimeType};base64,${part.data}` });

export function harnessImageFiles(context, known = new Set()) {
  const files = [], keys = new Set();
  for (const message of context.messages ?? []) for (const part of message.role === 'user' && Array.isArray(message.content) ? message.content : []) {
    if (part.type !== 'image') continue;
    const key = createHash('sha256').update(part.mimeType).update('\0').update(part.data).digest('hex');
    if (keys.has(key)) continue;
    keys.add(key);
    if (!known.has(key)) files.push({ uri: imageFile(part).uri });
  }
  return { files, keys };
}

function resultContent(content = []) {
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image') return imageFile(part);
    throw new Error(`Unsupported OpenCode tool result: ${part.type}`);
  });
}

/** Structured canonical history. Native media instances are supplied by its prompt decoder. */
export function harnessToolContext(context = {}) {
  const textParts = content => typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []).map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'thinking') return { type: 'reasoning', text: part.thinking };
    if (part.type === 'toolCall') return { type: 'tool-call', id: part.id, name: part.name, input: part.arguments };
    if (part.type === 'image') return { type: 'zyra-image', data: part.data, mimeType: part.mimeType };
    throw new Error(`Unsupported OpenCode context part: ${part.type}`);
  });
  const messages = (context.messages ?? []).map(message => message.role === 'toolResult'
    ? { role: 'tool', content: [{ type: 'tool-result', id: message.toolCallId, name: message.toolName,
      result: message.isError
        ? { type: 'error', value: (message.content ?? []).map(part => part.text ?? '').join('\n') }
        : { type: 'content', value: resultContent(message.content) } }] }
    : { role: message.role, content: textParts(message.content) });
  const tools = (context.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, input: tool.parameters }));
  return { system: context.systemPrompt ?? '', messages, tools };
}

export function harnessToolResults(context, pending) {
  const owned = new Map(pending.map(call => [call.id, call]));
  const results = [];
  for (const message of context.messages ?? []) {
    if (message.role !== 'toolResult' || !owned.has(message.toolCallId)) continue;
    const call = owned.get(message.toolCallId);
    if (call.name !== message.toolName) throw new Error('OpenCode tool result changed its owner.');
    results.push({ id: call.id, name: call.name, isError: Boolean(message.isError),
      content: resultContent(message.content) });
    owned.delete(call.id);
  }
  if (owned.size) throw new Error('OpenCode cannot resume before the requested Zyra tools finish.');
  return results;
}
