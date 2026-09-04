import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
import { getTerminalOutputHeightClass } from '../src/renderer/src/pages/assistant/assistant-timeline-layout'
import { areActivitiesEquivalent } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { SettingsProvider } from '../src/renderer/src/lib/settings'
import {
    acknowledgeAssistantInspectorNavigation,
    requestAssistantInspectorNavigation,
    subscribeAssistantInspectorNavigation
} from '../src/renderer/src/pages/assistant/assistant-inspector-navigation'

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

console.log('Assistant Work Timeline v2 contract: ok')
