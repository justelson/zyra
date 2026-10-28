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
console.log('Tool discovery rows: non-expandable current/legacy loaders, running/failure states, display modes and preserved control details: ok')
