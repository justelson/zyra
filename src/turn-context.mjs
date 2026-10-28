import { prepareSkillPromptContext } from './skill-prompt-context.mjs';

/** Turn-specific app context is appended to history, never spliced into the reusable system prefix. */
export function hiddenTurnContext(customType, text, details = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return { role: 'custom', customType, content: [{ type: 'text', text }], display: false, details, timestamp: Date.now() };
}

export function skillTurnContext(prompt, expandedPrompt) {
  const context = prepareSkillPromptContext(prompt, expandedPrompt);
  return context ? hiddenTurnContext(context.customType, context.content, context.details) : null;
}

export function estimateContextContributions(session) {
  const size = value => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value ?? '')).length / 4);
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const totals = { instructions: size(session?.systemPrompt ?? ''), tools: size(session?.agent?.state?.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) ?? []), history: 0, toolOutputs: 0, memory: 0, skills: 0, applicationContext: 0 };
  for (const message of messages) {
    const key = message.role === 'toolResult' ? 'toolOutputs' : message.customType === 'zyra_layered_memory_context' ? 'memory' : message.customType === 'zyra_skill_context' ? 'skills' : message.role === 'custom' ? 'applicationContext' : 'history';
    totals[key] += size(message.content);
  }
  return { estimated: true, method: 'characters/4; excludes provider hidden content', tokens: totals };
}
