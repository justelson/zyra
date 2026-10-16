/** Keep resolved skill instructions in model context, not in a visible user message. */
export function prepareSkillPromptContext(prompt, expandedPrompt) {
  const invocation = String(prompt).match(/^\/skill:[^\s]+(?:\s+([\s\S]*))?$/i);
  if (!invocation || expandedPrompt === prompt) return null;
  const request = invocation[1]?.trim() || 'Start the skill workflow for the current request.';
  const suffix = `\n\nUser: ${request}`;
  if (!expandedPrompt.endsWith(suffix)) throw new Error('Resolved skill context has an unexpected request boundary.');
  const instructions = expandedPrompt.slice(0, -suffix.length);
  return {
    customType: 'zyra_skill_context',
    display: false,
    content: instructions,
    details: { originalPrompt: prompt },
  };
}
