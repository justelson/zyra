/** Remove Zyra's explicit thinking override while retaining other output options.
 * This runs only for Provider default, before provider-specific request hooks. */
export function applyProviderDefaultReasoning(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const result = { ...payload };
  for (const key of ['reasoning_effort', 'thinking', 'enable_thinking', 'thinkingConfig']) delete result[key];
  for (const [key, fields] of [['reasoning', ['effort', 'enabled']], ['output_config', ['effort']], ['generationConfig', ['thinkingConfig']], ['chat_template_kwargs', ['enable_thinking', 'thinking_mode']]]) {
    if (!result[key] || typeof result[key] !== 'object' || Array.isArray(result[key])) continue;
    const nested = { ...result[key] };
    for (const field of fields) delete nested[field];
    if (Object.keys(nested).length) result[key] = nested;
    else delete result[key];
  }
  return result;
}
