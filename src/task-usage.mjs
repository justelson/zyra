const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'requests', 'cost'];
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const empty = () => Object.fromEntries(keys.map(key => [key, 0]));
const rootUsage = value => ({ inputTokens: count(value.input), outputTokens: count(value.output), cacheReadTokens: count(value.cacheRead), cacheWriteTokens: count(value.cacheWrite), reasoningTokens: count(value.reasoning), totalTokens: count(value.total), requests: count(value.assistantMessages), cost: count(value.cost) });
const copy = value => Object.fromEntries(keys.map(key => [key, count(value?.[key])]));
export function taskUsageBaseline(primary, agents = {}) {
  return { primary: rootUsage(primary), agents: Object.fromEntries(Object.entries(agents).map(([id, agent]) => [id, copy(agent.usage)])) };
}
export function summarizeTaskUsage(primary, agents = {}, baseline = taskUsageBaseline({})) {
  const delta = (current, previous) => Object.fromEntries(keys.map(key => [key, Math.max(0, count(current[key]) - count(previous?.[key]))]));
  const primaryDelta = delta(rootUsage(primary), baseline.primary);
  const supporting = Object.entries(agents).reduce((total, [id, agent]) => {
    const usage = delta(copy(agent.usage), baseline.agents[id]);
    for (const key of keys) total[key] += usage[key]; return total;
  }, empty());
  return { scope: 'current-task-since-submission', primary: primaryDelta, supporting,
    total: Object.fromEntries(keys.map(key => [key, primaryDelta[key] + supporting[key]])),
    costSource: 'api-equivalent-or-recorded; not subscription billing',
    observation: 'Completed metered responses only. Active requests and unreported provider work remain unknown.' };
}
