import assert from 'node:assert/strict'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
import { describePluginActivity, isPluginActivity, readPluginResult } from '../src/shared/assistant/plugin-activity-presentation'
import { fitDiagram, zoomDiagram } from '../src/renderer/src/components/ui/markdown/diagram-transform'

const activity = (payload: Record<string, unknown>, kind = 'tool') => ({ kind, payload } as AssistantActivity)
const args = { action: 'call', server: 'notion.workspace', tool: 'API-post-search', arguments: { query: 'Weekly progress', filter: { value: 'page' } } }
const legacy = activity({ toolName: 'notion.plugin_mcp', status: 'completed', args })
assert(isPluginActivity(legacy), 'Older saved calls retain specialized plugin presentation')
assert(!isPluginActivity(activity({ toolName: 'bash' })))
const description = describePluginActivity(legacy)
assert.equal(description.title, 'Searched items')
assert.equal(description.plugin, 'Notion')
assert.deepEqual(description.fields, [{ label: 'query', value: 'Weekly progress' }])
assert.deepEqual(description.arguments.filter, { value: 'page' }, 'Nested request arguments remain available')
assert.equal(describePluginActivity(activity({ ...legacy.payload, status: 'running' })).title, 'Searching items')
assert.equal(describePluginActivity(activity({ status: 'error', args: { ...args, tool: 'API-retrieve-a-page' } })).title, 'Could not read pages')
assert.equal(describePluginActivity(activity({ args: { action: 'servers' }, status: 'completed' })).title, 'Found available plugins')
assert.equal(describePluginActivity(activity({ args: { action: 'tools' }, status: 'running' })).title, 'Listing available tools')

const result = { results: [{ object: 'page', properties: { Name: { title: [{ plain_text: 'Weekly ' }, { text: { content: 'plan' } }] } }, url: 'https://example.test/plan' }] }
for (const envelope of [result, { details: { result } }, { structuredContent: result }, { content: [{ type: 'text', text: JSON.stringify(result) }] }, { details: { result: { content: [{ type: 'text', text: JSON.stringify(result) }] } } }]) {
    assert.deepEqual(readPluginResult(envelope), { items: [{ title: 'Weekly plan', type: 'page', url: 'https://example.test/plan' }], count: 1, text: null })
}
assert.deepEqual(readPluginResult(undefined, JSON.stringify({ pluginId: 'notion', result })), readPluginResult(result), 'Legacy raw envelopes are unwrapped too')
assert.equal(readPluginResult({ results: [] }).count, 0, 'Empty search results are recorded as zero')
assert.equal(readPluginResult({ error: { message: 'Page unavailable' } }).text, 'Page unavailable')
assert.equal(readPluginResult({ content: [{ type: 'text', text: 'Readable text response' }] }).text, 'Readable text response')
assert.equal(readPluginResult({ results: [{ title: 'Unsafe link', url: 'javascript:alert(1)' }] }).items[0].url, null)
assert.equal(readPluginResult({ results: Array.from({ length: 25 }, (_, i) => ({ title: `Page ${i}` })) }).items.length, 6, 'Summaries are bounded while the raw response retains all records')
assert.equal(readPluginResult({ results: Array.from({ length: 25 }, (_, i) => ({ title: `Page ${i}` })) }).count, 25)
assert.deepEqual(readPluginResult(undefined, 'malformed response'), { items: [], count: null, text: null }, 'Unknown formats do not invent structured results')

const fit = fitDiagram(1000, 800, 900, 700)
assert(fit.scale > 0 && fit.scale <= 1)
const before = { x: 40, y: 80, scale: .5 }, anchor = { x: 300, y: 250 }
const after = zoomDiagram(before, 1.2, anchor.x, anchor.y)
assert(Math.abs((anchor.x - before.x) / before.scale - (anchor.x - after.x) / after.scale) < .00001, 'Zoom keeps the point under the pointer stationary')
assert(Math.abs((anchor.y - before.y) / before.scale - (anchor.y - after.y) / after.scale) < .00001)
assert.equal(zoomDiagram(before, 100, 0, 0).scale, 5)
assert.equal(zoomDiagram(before, .001, 0, 0).scale, .05)
console.log('Plugin requests, MCP envelopes, saved calls, empty/error results, safe links and anchored diagram zoom passed.')
