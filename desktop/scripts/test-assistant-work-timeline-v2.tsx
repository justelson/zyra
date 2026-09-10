import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { settleActivityAtTurnEnd } from '../src/shared/assistant/activity-settlement'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { AssistantActivity, AssistantMessage } from '../src/shared/assistant/contracts'
import { TimelineToolCallList } from '../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { AssistantTimelineActionShell } from '../src/renderer/src/pages/assistant/AssistantTimelineActionShell'
import { AssistantQuestionResponse } from '../src/renderer/src/pages/assistant/AssistantQuestionResponse'
import { AssistantCapturedReadPreview } from '../src/renderer/src/pages/assistant/AssistantTimelineReadAction'
import { AssistantSkillSnapshotPreview } from '../src/renderer/src/pages/assistant/AssistantTimelineSkillAction'
import { AssistantWebResultPreviewCard } from '../src/renderer/src/pages/assistant/AssistantTimelineWebAction'
import { TimelineTurnInterruptionMarker } from '../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { TimelineMessage } from '../src/renderer/src/pages/assistant/AssistantTimelineRows'
import {
    getAssistantActionFamily,
    getAssistantActionTitle,
    getAssistantCapturedRead,
    getAssistantWebEvidence,
    stripAssistantCommandEnvelope
} from '../src/renderer/src/pages/assistant/assistant-action-presentation'
import { parseAssistantSkillSnapshot } from '../src/renderer/src/pages/assistant/assistant-skill-snapshot'
import { groupAssistantControlActionRuns } from '../src/renderer/src/pages/assistant/assistant-control-action-runs'
import { getTerminalOutputHeightClass } from '../src/renderer/src/pages/assistant/assistant-timeline-layout'
import { areActivitiesEquivalent, estimateTimelineRowHeight, getTimelineEntries, getActivityStatus } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { SettingsProvider, loadSettings } from '../src/renderer/src/lib/settings'
import {
    acknowledgeAssistantInspectorNavigation,
    requestAssistantInspectorNavigation,
    subscribeAssistantInspectorNavigation
} from '../src/renderer/src/pages/assistant/assistant-inspector-navigation'

assert.equal(loadSettings({}).assistantShowActionStats, false)
assert.equal(loadSettings({ assistantShowActionStats: true }).assistantShowActionStats, true)
assert.equal(loadSettings({ assistantShowActionStats: 'true' }).assistantShowActionStats, false)

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(createElement(SettingsProvider, null, node))

const createdAt = '2026-09-03T12:00:00.000Z'
function activity(input: Partial<AssistantActivity> & Pick<AssistantActivity, 'id' | 'kind'>): AssistantActivity {
    return {
        tone: 'tool',
        summary: input.kind,
        turnId: 'turn:work-v2',
        createdAt,
        ...input
    }
}

const narration: AssistantMessage = {
    id: 'message:purpose',
    role: 'assistant',
    text: "I'll verify the question handoff before changing presentation.",
    turnId: 'turn:work-v2',
    streaming: false,
    createdAt,
    updatedAt: createdAt
}
const command = activity({
    id: 'action:command',
    kind: 'command',
    detail: 'bun test',
    payload: { toolName: 'bash', command: 'bun test', output: 'ok', status: 'completed', startedAt: createdAt, completedAt: createdAt }
})
const inlineNarrationMarkup = renderToStaticMarkup(createElement(TimelineMessage, {
    message: narration,
    inlineWorkNarration: true
}))
assert.match(inlineNarrationMarkup, /I&#x27;ll verify the question handoff before changing presentation\./, 'Work preserves the original inline narration verbatim')
assert.match(inlineNarrationMarkup, /data-assistant-inline-work-narration="true"/)
assert.match(inlineNarrationMarkup, /text-\[13px\]/, 'Work narration uses final-response typography')
assert.doesNotMatch(inlineNarrationMarkup, /assistant-live-narration-muted/, 'settled narration is no longer styled as muted status copy')
assert.doesNotMatch(inlineNarrationMarkup, /data-assistant-message-timestamp/, 'inline narration keeps its chronology without duplicate final-answer metadata')
assert.equal(getAssistantActionTitle(command), 'Running tests', 'Actions use their own short actual intent rather than rewritten narration')
assert.equal(getAssistantActionTitle(activity({
    id: 'action:search-command', kind: 'command', payload: { toolName: 'bash', command: 'rg -n "test" src', status: 'completed' }
})), 'Searching code', 'command intent follows the operation instead of incidental words in its arguments')

const webSearch = activity({
    id: 'action:web-search',
    kind: 'web-search',
    payload: {
        toolName: 'web_search',
        query: 'Pi SDK event hooks',
        status: 'completed',
        webResults: [
            { title: 'Pi SDK', url: 'https://example.com/pi', snippet: 'Agent loop documentation.' },
            { title: 'Tool hooks', url: 'https://docs.example.org/hooks', snippet: 'Lifecycle reference.' }
        ]
    }
})
assert.equal(getAssistantActionFamily(webSearch), 'web-search')
assert.equal(getAssistantWebEvidence(webSearch).length, 2)
const webMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [webSearch] }))
assert.match(webMarkup, /data-assistant-web-results="structured"/)
assert.match(webMarkup, /Pi SDK/)
assert.match(webMarkup, /docs\.example\.org\/favicon\.ico/, 'site pills resolve page-specific favicon candidates')
assert.doesNotMatch(webMarkup, /Web search results for:/, 'web evidence is not rendered as terminal output')
const webPreviewMarkup = renderToStaticMarkup(createElement(AssistantWebResultPreviewCard, {
    item: getAssistantWebEvidence(webSearch)[0]!
}))
assert.match(webPreviewMarkup, /data-assistant-web-preview="structured"/)
assert.match(webPreviewMarkup, /Agent loop documentation/)
assert.match(webPreviewMarkup, /example\.com\/favicon\.ico/)

const read = activity({
    id: 'action:read',
    kind: 'file-read',
    payload: {
        toolName: 'read', paths: ['C:/workspace/src/app.ts'], output: 'const one = 1\nconst two = 2\n[Showing lines 20-21 of 80]',
        readStartLine: 20, readEndLine: 21, readTotalLines: 80, status: 'completed'
    }
})
assert.deepEqual(getAssistantCapturedRead(read), {
    path: 'C:/workspace/src/app.ts', content: 'const one = 1\nconst two = 2', startLine: 20, endLine: 21, totalLines: 80
}, 'read evidence contains only the exact captured range')
assert.equal(getAssistantCapturedRead(activity({
    id: 'action:read-with-blank-lines',
    kind: 'file-read',
    payload: {
        paths: ['C:/workspace/src/blank.ts'],
        output: '\nconst middle = true\n\n[Showing lines 20-22 of 80]',
        readStartLine: 20,
        readEndLine: 22,
        readTotalLines: 80
    }
}))?.content, '\nconst middle = true\n', 'captured reads preserve leading and trailing blank source lines')
const readMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [read], projectRootPath: 'C:/workspace' }))
assert.match(readMarkup, /data-assistant-typed-action="action:read"/)
assert.match(readMarkup, /Reading app\.ts/, 'file Actions use a short actual -ing title')
assert.match(readMarkup, /src\/app\.ts · L20–21/, 'the exact path and captured range stay available as secondary evidence')
assert.doesNotMatch(readMarkup, /const one/, 'captured source waits for the dedicated preview instead of duplicating its row')
const readPreviewMarkup = renderToStaticMarkup(createElement(SettingsProvider, null, createElement(AssistantCapturedReadPreview, {
    activity: read, projectRootPath: 'C:/workspace', onClose: () => undefined
})))
assert.match(readPreviewMarkup, /data-file-preview-custom-body="true"/, 'Read uses the shared file-preview shell')
assert.match(readPreviewMarkup, /data-assistant-read-snapshot="exact"/)
assert.match(readPreviewMarkup, /data-syntax-preview-line-start="20"/, 'the shared source preview starts at the exact captured line')
assert.match(readPreviewMarkup, /data-syntax-preview-model-path="inmemory:\/\/zyra\/captured-read\//, 'captured evidence cannot alias a live file editor model')
assert.match(readPreviewMarkup, /Lines 20–21 of 80/, 'the shared preview labels the exact captured range')
assert.doesNotMatch(readPreviewMarkup, /Showing lines/, 'the expanded read preview cannot leak continuation bookkeeping')

const skill = activity({
    id: 'action:skill',
    kind: 'skill',
    payload: {
        toolName: 'read', paths: ['C:/Users/example/.agents/skills/diagnose/SKILL.md'],
        output: '---\nname: diagnose\ndescription: >-\n  Reproduce and trace failures\n  before editing.\nenabled: true\npriority: 3\n---\n# Diagnose\n\nTrace the failure.', status: 'completed'
    }
})
assert.equal(getAssistantActionFamily(skill), 'skill')
assert.equal(parseAssistantSkillSnapshot('---\nname: compact-skill\n---').name, 'compact-skill', 'Skill frontmatter also parses when the closing delimiter ends the capture')
assert.deepEqual(parseAssistantSkillSnapshot(String(skill.payload?.output)), {
    frontmatter: [
        { key: 'name', value: 'diagnose', valueKind: 'string' },
        { key: 'description', value: 'Reproduce and trace failures before editing.', valueKind: 'string' },
        { key: 'enabled', value: 'true', valueKind: 'boolean' },
        { key: 'priority', value: '3', valueKind: 'number' }
    ],
    frontmatterSource: 'name: diagnose\ndescription: >-\n  Reproduce and trace failures\n  before editing.\nenabled: true\npriority: 3',
    name: 'diagnose',
    description: 'Reproduce and trace failures before editing.',
    metadata: [
        { key: 'enabled', value: 'true', valueKind: 'boolean' },
        { key: 'priority', value: '3', valueKind: 'number' }
    ],
    body: '# Diagnose\n\nTrace the failure.'
})
const skillMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [skill] }))
assert.match(skillMarkup, /Loading diagnose/)
assert.doesNotMatch(skillMarkup, /Trace the failure/, 'skill instructions open in their captured snapshot viewer')
const skillPreviewMarkup = renderToStaticMarkup(createElement(SettingsProvider, null, createElement(AssistantSkillSnapshotPreview, {
    activity: skill, onClose: () => undefined
})))
assert.match(skillPreviewMarkup, /data-file-preview-custom-body="true"/, 'Skill uses the shared file-preview shell')
assert.match(skillPreviewMarkup, /data-assistant-skill-frontmatter="structured"/)
assert.match(skillPreviewMarkup, /Reproduce and trace failures before editing\./)
assert.match(skillPreviewMarkup, /enabled/)
assert.match(skillPreviewMarkup, /View source/)
assert.doesNotMatch(skillPreviewMarkup, /description: &gt;-/, 'literal YAML stays behind View source')
assert.match(skillPreviewMarkup, /Trace the failure/)

const agent = activity({
    id: 'action:agent',
    kind: 'agent',
    payload: {
        toolName: 'agent', action: 'spawn', status: 'completed', requestedAgent: 'code-reviewer', prompt: 'Audit replay identity',
        agentRunId: 'agent:run:42', run: { agentRunId: 'agent:run:42', definitionName: 'code-reviewer', label: 'audit', goal: 'Audit replay identity', status: 'completed' }
    }
})
const agentMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [agent] }))
assert.match(agentMarkup, /data-dicebear-style="bottts"/, 'agent actions use the assigned internal identity avatar')
assert.doesNotMatch(agentMarkup, />code-reviewer</, 'generic definition labels are not the visible agent identity')
assert.match(agentMarkup, /Starting audit/, 'agent Actions use the short running intent')
assert.doesNotMatch(agentMarkup, /Audit replay identity/, 'the full agent goal stays in the inspector instead of becoming a long Action title')
const inspectorRequests: string[] = []
const inspectorRequest = { workspace: 'agents' as const, agentRunId: 'agent:run:42' }
requestAssistantInspectorNavigation(inspectorRequest)
const unsubscribeInspector = subscribeAssistantInspectorNavigation((request) => {
    inspectorRequests.push('agentRunId' in request ? request.agentRunId : request.workflowRunId)
    acknowledgeAssistantInspectorNavigation(request)
})
unsubscribeInspector()
const unsubscribeLateInspector = subscribeAssistantInspectorNavigation(() => inspectorRequests.push('stale'))
unsubscribeLateInspector()
assert.deepEqual(inspectorRequests, ['agent:run:42'], 'opening an agent run is replayed once while the inspector mounts, then consumed')

const browser = activity({ id: 'action:browser', kind: 'browser-control', payload: { toolName: 'browser_observe', operation: 'observe', url: 'https://example.com/page', status: 'completed' } })
const computer = activity({ id: 'action:computer', kind: 'computer-control', payload: { toolName: 'computer_control', operation: 'click', targetId: 'save-button', status: 'completed' } })
const controlMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [browser, computer] }))
assert.match(controlMarkup, /example\.com\/favicon\.ico/)
assert.match(controlMarkup, /save-button/)

assert.equal(areActivitiesEquivalent(command, {
    ...command,
    payload: { ...(command.payload || {}), actionBatchIntent: 'Reviewing timeline behavior' }
}), false, 'late replay enrichment of a batch intent invalidates memoized Action rows')
const declaredBatchActivities = [command, webSearch, read, skill, agent, browser, computer].map((entry) => ({
    ...entry,
    payload: { ...(entry.payload || {}), actionBatchIntent: 'Reviewing timeline behavior' }
}))
const allMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: declaredBatchActivities }))
assert.doesNotMatch(allMarkup, /Tool Calls/)
assert.doesNotMatch(allMarkup, /Show (?:all|last)/)
assert.match(allMarkup, /data-assistant-action-batch="true"/, 'consecutive Actions share one disclosure block')
assert.match(allMarkup, /data-state="closed"/, 'the Action batch starts collapsed rather than leaking a last-five preview')
assert.match(allMarkup, /data-settled-action-intent="Reviewing timeline behavior"/, 'a settled Action batch uses the agent-declared block intent')
assert.match(allMarkup, /Reviewing timeline behavior/, 'the settled block title describes the shared intent')
assert.equal((allMarkup.match(/data-assistant-(?:tool-call|typed-action)=/g) || []).length, 7, 'expanding the batch reveals every real Action without a last-five slice')
const runningBatchMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [
    { ...command, payload: { ...(command.payload || {}), actionBatchIntent: 'Reviewing timeline behavior' } },
    activity({
        id: 'action:browser-running', kind: 'browser-control',
        payload: { toolName: 'browser_observe', operation: 'observe', url: 'https://example.com/live', status: 'running', actionBatchIntent: 'Reviewing timeline behavior' }
    })
] }))
assert.match(runningBatchMarkup, /data-current-action-intent="Inspecting example\.com"/, 'a live batch follows the currently running Action')
assert.doesNotMatch(runningBatchMarkup, /data-settled-action-intent="Reviewing timeline behavior"/, 'the shared block intent waits until every Action settles')
assert.match(runningBatchMarkup, /assistant-title-shimmer/, 'the current Action uses the full title-regeneration shimmer')
assert.match(runningBatchMarkup, /data-action-batch-intent="Reviewing timeline behavior"/, 'live and settled batches both show their recorded purpose')
const mixedActions = [command, activity({ id: 'check', kind: 'command.checkpoint', payload: { commandAction: 'status', jobId: 'job-1' } }), computer, agent]
const mixedEntries = getTimelineEntries([], mixedActions.map((entry, index) => ({ ...entry, timelineSequence: index + 1 })).reverse())
assert.equal(mixedEntries.length, 1, 'checks, computer use, and agent actions stay in one consecutive block')
assert.deepEqual(mixedEntries[0]?.type === 'activity-group' ? mixedEntries[0].activities.map((entry) => entry.id) : [], mixedActions.map((entry) => entry.id))
const drawingActions = [1, 2, 3].map((index) => activity({ id: `drawing:${index}`, kind: 'computer-control', payload: { actionBatchIntent: 'Drawing an owl in Paint', status: index === 3 ? 'running' : 'completed' } }))
const drawingMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [webSearch, ...drawingActions] }))
assert.equal((drawingMarkup.match(/data-assistant-control-run="true"/g) || []).length, 1, 'repeated computer calls become one collapsed intent row inside Actions')
assert.match(drawingMarkup, /Drawing an owl in Paint/)
assert.equal((drawingMarkup.match(/data-assistant-typed-action="drawing:/g) || []).length, 3, 'individual calls remain available within the disclosure')
assert.deepEqual(groupAssistantControlActionRuns([drawingActions[0]!, command, drawingActions[1]!]).map((run) => run.length), [1, 1, 1], 'unrelated actions cannot be moved inside a computer run')
assert.deepEqual(groupAssistantControlActionRuns([drawingActions[0]!, { ...drawingActions[1]!, payload: { actionBatchIntent: 'Saving the drawing' } }, { ...drawingActions[2]!, turnId: 'next-turn' }]).map((run) => run.length), [1, 1, 1], 'a new purpose or turn starts its own computer run')
const browsingActions = [1, 2, 3].map(index => activity({ id: `browsing:${index}`, kind: 'browser-control', payload: { toolName: index === 1 ? 'browser_observe' : 'browser_perform', actionBatchIntent: 'Drawing a fish in the browser', status: 'completed' } }))
const browsingMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [webSearch, ...browsingActions] }))
assert.equal((browsingMarkup.match(/data-assistant-control-run="true"/g) || []).length, 1, 'browser observations and input share a collapsed intent row')
assert.equal((browsingMarkup.match(/data-assistant-typed-action="browsing:/g) || []).length, 3, 'all individual browser actions remain accessible')
assert.deepEqual(groupAssistantControlActionRuns([browsingActions[0]!, drawingActions[0]!, browsingActions[1]!]).map(run => run.length), [1, 1, 1], 'different surfaces do not merge across each other')
assert.doesNotMatch(browsingMarkup.split('data-assistant-action-batch-trigger="true"')[1]?.split('</button>')[0] || '', /3 actions|tabular-nums/, 'aggregate stats are hidden by default')
const onlyDrawingMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: drawingActions }))
assert.equal((onlyDrawingMarkup.match(/data-assistant-action-batch="true"/g) || []).length, 1, 'a computer-only block avoids a redundant outer disclosure')
const recovery = activity({ id: 'recovery', kind: 'connection.recovery', payload: { status: 'recovered' } })
assert.equal(getTimelineEntries([], [command, recovery, computer].map((entry, index) => ({ ...entry, timelineSequence: index + 1 })).reverse()).length, 3, 'recovery stays at its own chronological boundary')
assert.equal(getAssistantActionTitle(activity({ id: 'stroke', kind: 'computer-control', payload: { toolName: 'computer_sequence', args: { steps: [{ type: 'stroke' }, { type: 'drag' }] } } })), 'Drawing strokes', 'computer sequence details describe the actual input')
assert.equal(getAssistantActionTitle(activity({ id: 'observe', kind: 'computer-control', payload: { toolName: 'computer_observe' } })), 'Inspecting app', 'named computer tools do not fall back to generic control rows')
assert.equal(getAssistantActionTitle(activity({ id: 'drag', kind: 'computer-control', payload: { toolName: 'computer_sequence', args: { steps: [{ type: 'drag' }] } } })), 'Dragging', 'a generic drag does not imply drawing')
assert.equal(estimateTimelineRowHeight({ kind: 'activity-group', id: 'mixed', createdAt, activities: mixedActions }), 36, 'the virtual list reserves one collapsed header for a mixed action block')
const failedSettledBatchMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [
    { ...command, payload: { ...(command.payload || {}), actionBatchIntent: 'Checking failure handling' } },
    activity({ id: 'action:failed-settled', kind: 'web-fetch', tone: 'error', payload: { status: 'failed', url: 'https://example.com/fail', actionBatchIntent: 'Checking failure handling' } })
] }))
assert.match(failedSettledBatchMarkup, /data-settled-action-intent="Checking failure handling"/, 'failed Actions count as settled for the declared block title')
assert.match(failedSettledBatchMarkup, /aria-label="Failed action in batch"/, 'the settled intent does not hide a failed Action state')
const repeatedEditMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [
    activity({ id: 'action:edit-one', kind: 'file-change', payload: { paths: ['C:/workspace/src/app.ts'], patch: '@@ -1 +1 @@\n-a\n+b', status: 'completed' } }),
    activity({ id: 'action:edit-two', kind: 'file-change', payload: { paths: ['C:/workspace/src/app.ts'], patch: '@@ -1 +1 @@\n-b\n+c', status: 'completed' } })
] }))
assert.equal((repeatedEditMarkup.match(/data-assistant-tool-call=/g) || []).length, 2, 'two real edits to the same file remain two actions')
const runningEditMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [
    activity({ id: 'action:edit-running', kind: 'file-change', payload: { paths: ['C:/workspace/src/app.ts'], status: 'running' } })
] }))
assert.match(runningEditMarkup, /Editing app\.ts/, 'a lone Action keeps the same short -ing title contract')
assert.match(runningEditMarkup, /assistant-title-shimmer/, 'a lone running Action uses the title-regeneration shimmer')
const compactCommandMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: [command] }))
assert.match(compactCommandMarkup, /min-h-6 gap-1\.5 rounded-md px-1 py-0\.5/, 'command Action rows use the compact header dimensions')
assert.equal(getTerminalOutputHeightClass('success', 0), 'max-h-32 sm:max-h-36', 'short settled command output is no longer forced into a tall fixed container')
assert.equal(stripAssistantCommandEnvelope('Command completed (cmd-42) after 2s.\nCommand: bun test\n\nok', 'bun test'), 'ok')
assert.equal(stripAssistantCommandEnvelope([
    '[Zyra managed command update]',
    'Command still running (cmd-42). Elapsed: 2s.',
    'Last output: 1s ago',
    'Command: bun test',
    '',
    'Current output:',
    'halfway',
    '',
    'To check again, call bash with action=status and jobId=cmd-42.'
].join('\n'), 'bun test'), 'halfway', 'managed command instructions never enter visible evidence')
assert.equal(
    stripAssistantCommandEnvelope('Command completed successfully inside the fixture', 'bun test'),
    'Command completed successfully inside the fixture',
    'ordinary command output that resembles a status line remains evidence'
)
const failedActionMarkup = renderToStaticMarkup(createElement(AssistantTimelineActionShell, {
    activityId: 'action:failed', icon: createElement('span', null, '!'), title: 'Run focused checks', createdAt,
    status: 'failed', elapsed: '2s'
}))
assert.match(failedActionMarkup, /aria-label="Failed"/)
assert.match(failedActionMarkup, /var\(--status-danger\)/, 'failed Actions use the semantic danger token')
const interruptionMarkup = renderToStaticMarkup(createElement(TimelineTurnInterruptionMarker))
assert.match(interruptionMarkup, /data-assistant-turn-interruption="true"/)
assert.equal((interruptionMarkup.match(/Interrupted/g) || []).length, 2, 'the interruption boundary has one visible and one accessible label')

const pendingQuestions = {
    id: 'questions:1', requestId: 'request:1', status: 'pending' as const, answers: null, responseMessageId: null,
    turnId: 'turn:work-v2', createdAt, resolvedAt: null,
    questions: [
        { id: 'scope', header: 'Scope', question: 'Which surface?', type: 'single_select' as const, options: [{ label: 'Desktop' }, { label: 'Both' }], required: true, allowOther: false },
        { id: 'note', header: 'Note', question: 'Anything else?', type: 'text' as const, options: [], required: false, allowOther: false }
    ]
}
const answeredMarkup = renderToStaticMarkup(createElement(AssistantQuestionResponse, {
    input: { ...pendingQuestions, status: 'resolved', answers: { scope: 'Both', note: '' }, responseMessageId: 'message:answer', resolvedAt: createdAt }
}))
assert.match(answeredMarkup, /Responded to agent question/)
assert.match(answeredMarkup, /Which surface\?/)
assert.match(answeredMarkup, /Both/)
assert.match(answeredMarkup, /Show more \(1 more\)/)
assert.doesNotMatch(answeredMarkup, /Anything else\?/, 'multiple answers stay compact until the dedicated modal opens')

const recoverySequence = [
    activity({ id:'sequence:first', kind:'browser', payload:{toolName:'browser_act',status:'completed',actionBatchIntent:'Drawing an illustration'} }),
    activity({ id:'sequence:error', kind:'error', tone:'error', summary:'Temporary provider failure' }),
    activity({ id:'sequence:lost', kind:'browser', payload:{toolName:'browser_act',status:'running',actionBatchIntent:'Drawing details'} }),
    activity({ id:'sequence:reconnect', kind:'connection.recovery', summary:'Reconnecting', payload:{status:'retrying'} }),
    activity({ id:'sequence:last', kind:'browser', payload:{toolName:'browser_act',status:'completed',actionBatchIntent:'Finishing the illustration'} })
]
const userBoundary = {...narration,id:'sequence:user',role:'user' as const,text:'Draw something'}
const finalBoundary = {...narration,id:'sequence:final',text:'Finished',updatedAt:'2026-09-03T12:01:00.000Z'}
const recoveredRows = groupTimelineRowsIntoWorkSummaries({
    rows:[{kind:'message',id:userBoundary.id,createdAt,message:userBoundary}, ...recoverySequence.map(item => ({kind:'activity' as const,id:item.id,createdAt,activity:item})),{kind:'message',id:finalBoundary.id,createdAt,message:finalBoundary}],
    messages:[userBoundary,finalBoundary], latestAssistantMessageId:finalBoundary.id,latestTurnStartedAt:createdAt,isWorking:false
})
const recoveredWork = recoveredRows.find(row => row.kind === 'turn-work-summary')!
assert.equal(recoveredWork.kind, 'turn-work-summary')
if (recoveredWork.kind === 'turn-work-summary') {
    assert.equal(recoveredWork.rows.length, 1, 'errors and reconnects do not split consecutive actions')
    const batch = recoveredWork.rows[0]!
    assert.equal(batch.kind, 'activity-group')
    if (batch.kind === 'activity-group') {
        assert.deepEqual(batch.activities.map(item => item.id), recoverySequence.map(item => item.id), 'evidence stays in chronological order')
        assert.equal(getActivityStatus(batch.activities[2]!), 'failed', 'a completed turn cannot retain a running foreground action')
        assert.equal(batch.activities[2]!.payload?.completionSource, 'turn-boundary', 'missing completion is not presented as successful execution')
        assert.equal(batch.activities[3]!.payload?.status, 'recovered', 'historical reconnects stop spinning after completion')
    }
}
const backgroundJob = activity({id:'background:1',kind:'command',payload:{status:'running',jobId:'job:1'}})
assert.equal(settleActivityAtTurnEnd(backgroundJob, createdAt,'completed'),backgroundJob,'independent managed jobs retain their actual status')

console.log('Assistant Work Timeline v2 contract: ok')
