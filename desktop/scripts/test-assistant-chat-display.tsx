import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantActivity, AssistantMessage } from '../src/shared/assistant/contracts'
import { TimelineMessage } from '../src/renderer/src/pages/assistant/AssistantTimelineRows'
import { TimelineToolCallList } from '../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { TimelineTurnWorkSummary } from '../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'

const createdAt = '2026-08-25T10:00:00.000Z'
const completedAt = '2026-08-25T10:00:04.000Z'
const activities: AssistantActivity[] = [
    {
        id: 'display-command-one',
        kind: 'command',
        tone: 'tool',
        summary: 'Ran checks',
        detail: 'bun test',
        createdAt,
        payload: {
            command: 'bun test',
            output: 'display-mode-output-one',
            status: 'running',
            startedAt: createdAt
        }
    },
    {
        id: 'display-command-two',
        kind: 'command',
        tone: 'tool',
        summary: 'Checked types',
        detail: 'bun run typecheck',
        createdAt,
        payload: {
            command: 'bun run typecheck',
            output: 'display-mode-output-two',
            status: 'completed',
            startedAt: createdAt,
            completedAt
        }
    }
]

const detailedToolsMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, {
    activities,
    displayMode: 'detailed',
    toolOutputDefaultMode: 'expanded'
}))
const minimalToolsMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, {
    activities,
    displayMode: 'minimal',
    toolOutputDefaultMode: 'expanded'
}))

assert.match(detailedToolsMarkup, /data-assistant-tool-call-list="detailed"/)
assert.match(detailedToolsMarkup, /Tool Calls \(2\)/, 'Detailed preserves the existing tool group heading')
assert.match(detailedToolsMarkup, /rounded-xl/, 'Detailed preserves the existing bordered tool group anatomy')
assert.match(minimalToolsMarkup, /data-assistant-tool-call-list="minimal"/)
assert.match(minimalToolsMarkup, />2 actions</, 'Minimal summarizes grouped work without tool-centric language')
assert.doesNotMatch(minimalToolsMarkup, /Tool Calls/, 'Minimal removes the detailed tool group heading')
assert.match(minimalToolsMarkup, /data-assistant-tool-call="minimal"/, 'Minimal reaches each collapsed activity row')
assert.match(minimalToolsMarkup, /min-h-7/, 'Minimal activity rows retain a compact 28px interaction target')
assert.match(minimalToolsMarkup, /display-mode-output-one/, 'Minimal preserves expanded command output')
assert.match(detailedToolsMarkup, /display-mode-output-one/, 'Detailed preserves expanded command output')

const minimalWorkMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: createdAt,
    completedAt,
    outcome: 'completed',
    displayMode: 'minimal',
    actionCount: activities.length,
    renderChildren: () => createElement('span', null, 'shared-work-details')
}))
const detailedWorkMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: createdAt,
    completedAt,
    outcome: 'completed',
    displayMode: 'detailed',
    actionCount: activities.length,
    renderChildren: () => createElement('span', null, 'shared-work-details')
}))

assert.match(minimalWorkMarkup, /data-assistant-work-summary-display="minimal"/)
assert.match(minimalWorkMarkup, /Worked 4s · 2 actions/, 'Minimal combines duration and action count on one quiet line')
assert.doesNotMatch(detailedWorkMarkup, /2 actions/, 'Detailed keeps the current work summary copy')
assert.match(detailedWorkMarkup, /Worked for 4s/, 'Detailed keeps the current elapsed-time wording')

const minimalExpandedWorkMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: createdAt,
    completedAt: null,
    running: true,
    displayMode: 'minimal',
    actionCount: activities.length,
    renderChildren: () => createElement('span', null, 'shared-work-details')
}))
const detailedExpandedWorkMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: createdAt,
    completedAt: null,
    running: true,
    displayMode: 'detailed',
    actionCount: activities.length,
    renderChildren: () => createElement('span', null, 'shared-work-details')
}))
assert.match(minimalExpandedWorkMarkup, /shared-work-details/, 'Minimal keeps the shared disclosure content')
assert.match(detailedExpandedWorkMarkup, /shared-work-details/, 'Detailed keeps the shared disclosure content')

const assistantMessage: AssistantMessage = {
    id: 'display-assistant-message',
    role: 'assistant',
    text: 'The underlying conversation remains unchanged.',
    streaming: false,
    createdAt,
    updatedAt: createdAt
}
const minimalAssistantMarkup = renderToStaticMarkup(createElement(TimelineMessage, {
    message: assistantMessage,
    displayMode: 'minimal'
}))
const detailedAssistantMarkup = renderToStaticMarkup(createElement(TimelineMessage, {
    message: assistantMessage,
    displayMode: 'detailed'
}))

assert.match(minimalAssistantMarkup, /data-assistant-message-surface="minimal"/)
assert.match(minimalAssistantMarkup, /The underlying conversation remains unchanged\./)
assert.match(detailedAssistantMarkup, /data-assistant-message-surface="detailed"/)
assert.match(detailedAssistantMarkup, /The underlying conversation remains unchanged\./)

console.log('Assistant chat display modes: ok')
