import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsProvider, type AssistantChatDisplayMode } from '../src/renderer/src/lib/settings'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
import { getAssistantActionTitle, isAssistantToolDiscoveryActivity } from '../src/renderer/src/pages/assistant/assistant-action-presentation'
import { groupAssistantControlActionRuns } from '../src/renderer/src/pages/assistant/assistant-control-action-runs'

const { TimelineToolCallList } = await import('../src/renderer/src/pages/assistant/AssistantTimelineToolCalls')
const activity = (toolName: string, status = 'completed'): AssistantActivity => ({
    id: toolName, kind: toolName.includes('browser') ? 'browser-control' : 'tool-call', tone: 'tool',
    summary: 'Technical loader result', createdAt: '2026-10-27T12:00:00Z', turnId: 'fixture-turn',
    payload: { toolName, args: { action: 'load', query: 'computer use' }, status, output: 'PRIVATE TOOL SCHEMAS', result: { details: { tools: ['private-tool'] } } }
})
const render = (activities: AssistantActivity[], displayMode: AssistantChatDisplayMode = 'detailed') => renderToStaticMarkup(createElement(SettingsProvider, null, <TimelineToolCallList activities={activities} displayMode={displayMode} />))
for (const name of ['tool_search', 'zyra_tool_search', 'browser_use', 'mcp__zyra__tool_search']) {
    assert.equal(isAssistantToolDiscoveryActivity(activity(name)), true)
    assert.equal(getAssistantActionTitle(activity(name)), 'Getting available tools')
    for (const mode of ['detailed', 'minimal'] as const) {
        const html = render([activity(name)], mode)
        assert.match(html, /Getting available tools/)
        assert.doesNotMatch(html, /aria-expanded|PRIVATE TOOL SCHEMAS|private-tool|Technical loader result|Loading action details/)
    }
}
assert.match(render([activity('tool_search', 'running')]), /Getting available tools/)
assert.match(render([activity('tool_search', 'running')]), /animate-spin/)
assert.match(render([activity('tool_search', 'failed')]), /Couldn&#x27;t get available tools/)
assert.match(render([activity('tool_search', 'failed')]), /aria-label="Failed"/)
assert.doesNotMatch(render([activity('tool_search'), activity('browser_use')]), /aria-expanded/, 'Consecutive loaders cannot create an outer discovery disclosure')
const browserAction = { ...activity('browser_act'), id: 'click', payload: { toolName: 'browser_act', status: 'completed', args: { action: { type: 'click' } } } }
assert.equal(isAssistantToolDiscoveryActivity(browserAction), false)
assert.equal(isAssistantToolDiscoveryActivity(activity('mcp__another_plugin__tool_search')), false, 'A plugin search result must keep its own details')
assert.match(render([browserAction]), /aria-expanded="false"/, 'Real control actions keep their details')
assert.deepEqual(groupAssistantControlActionRuns([activity('browser_use'), browserAction]).map(run => run.length), [1, 1], 'Discovery is never swallowed by a control-action disclosure')
const ordinary = (id: string): AssistantActivity => ({ ...activity('exec_command'), id, kind: 'command', payload: {
    toolName: 'exec_command', command: 'echo fixture', status: 'completed', actionBatchIntent: 'Checking fixture actions', output: 'CLOSED ACTION EVIDENCE'
} })
const before = [ordinary('before-one'), ordinary('before-two')]
const after = [ordinary('after-one'), ordinary('after-two')]
const batchCount = (html: string) => (html.match(/data-assistant-action-batch-trigger="true"/g) || []).length
for (const name of ['tool_search', 'zyra_tool_search', 'browser_use', 'mcp__zyra__tool_search']) {
    for (const mode of ['detailed', 'minimal'] as const) {
        for (const [label, activities, expected] of [
            ['trailing', [...before, activity(name)], 1],
            ['leading', [activity(name), ...after], 1],
            ['middle', [...before, activity(name), ...after], 2],
            ['consecutive', [...before, activity(name), { ...activity(name), id: 'second-loader' }, ...after], 2]
        ] as const) {
            const html = render([...activities], mode)
            assert.equal(batchCount(html), expected, `${name}/${mode}/${label}: ordinary actions keep their own collapsed groups`)
            assert.match(html, /Getting available tools/, 'The loader stays visible outside collapsed actions')
            assert.doesNotMatch(html, /CLOSED ACTION EVIDENCE|PRIVATE TOOL SCHEMAS/, 'Neither ordinary outputs nor loader schemas mount by default')
        }
    }
}
assert.equal(batchCount(render([before[0]!, activity('tool_search'), after[0]!])), 0, 'A boundary does not manufacture single-action batches')
assert.equal(batchCount(render([...before, ...after])), 1, 'No-boundary grouping is unchanged')
assert.equal(batchCount(render([
    { ...browserAction, id: 'browser-one' }, { ...browserAction, id: 'browser-two' }, activity('tool_search'),
    { ...browserAction, id: 'browser-three' }, { ...browserAction, id: 'browser-four' }
])), 2, 'Existing nested browser/control runs are preserved on either side')
console.log('Tool discovery rows: standalone loaders, mixed-run boundaries, display modes and preserved control groups: ok')
