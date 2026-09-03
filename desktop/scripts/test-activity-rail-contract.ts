import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantActivity, AssistantMessage, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
import { AssistantInlineDiffPreview } from '../src/renderer/src/pages/assistant/AssistantInlineDiffPreview'
import { TimelineToolCallCard } from '../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard'
import {
    AssistantFileChangeStatusPill,
    resolveAssistantFileChangeStatus
} from '../src/renderer/src/pages/assistant/AssistantFileChangeStatusPill'
import {
    buildBaseCheckpoints,
    resolveTimelineMinimapHeight,
    resolveTimelineMinimapIndexFromPointer,
    resolveTimelineMinimapMarkerWidth,
    resolveTimelineMinimapWindow,
    TIMELINE_MINIMAP_MAX_MARKERS
} from '../src/renderer/src/pages/assistant/AssistantTimelineCheckpointRail'
import { TimelineTurnWorkSummary } from '../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { TimelineVoiceTaskStatus } from '../src/renderer/src/pages/assistant/AssistantTimelineVoiceTask'
import { AssistantTimelineNetworkRecovery } from '../src/renderer/src/pages/assistant/AssistantTimelineNetworkRecovery'
import { IssueLogRow } from '../src/renderer/src/pages/assistant/AssistantPageHelpers'
import { TimelineContextCompactionMarker, TimelineMessage, TimelineWorkingIndicator } from '../src/renderer/src/pages/assistant/AssistantTimelineRows'
import { COLLAPSED_TOOL_CALL_COUNT, TimelineToolCallList } from '../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { stripProposedPlanBlocks } from '../src/renderer/src/pages/assistant/assistant-proposed-plan'
import { getTerminalOutputHeightClass } from '../src/renderer/src/pages/assistant/assistant-timeline-layout'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { isAssistantQueuedComposerSessionBusy } from '../src/renderer/src/pages/assistant/useAssistantQueuedComposer'
import {
    didAssistantTimelineWorkComplete,
    resolveAssistantTimelineDisclosureAnchorMode
} from '../src/renderer/src/pages/assistant/assistant-timeline-scroll-events'
import {
    buildCommandCheckpointDisplayActivity,
    buildTimelineRows,
    countRunningCommandActivities,
    findRelatedCommandActivityId,
    getActivityAgentSurface,
    getActivityElapsed,
    getActivityStatus,
    getCommandCheckpointAction,
    getCommandJobId,
    getContextCompactionStatus,
    getTimelineEntries,
    isCommandCheckpointActivity,
    isModelNoticeActivity
} from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const iso = (millisecond: number) => new Date(Date.parse('2026-07-10T09:52:00.000Z') + millisecond).toISOString()

function message(input: {
    id: string
    role: AssistantMessage['role']
    turnId: string
    millisecond: number
    text: string
    timelineSequence?: number
}): AssistantMessage {
    return {
        id: input.id,
        role: input.role,
        text: input.text,
        turnId: input.turnId,
        streaming: false,
        timelineSequence: input.timelineSequence,
        createdAt: iso(input.millisecond),
        updatedAt: iso(input.millisecond)
    }
}

function activity(input: {
    id: string
    turnId: string
    millisecond: number
    internal?: boolean
    tone?: AssistantActivity['tone']
    timelineSequence?: number
}): AssistantActivity {
    return {
        id: input.id,
        kind: input.internal ? 'assistant.internal' : 'command',
        tone: input.tone || 'tool',
        summary: input.internal ? 'Internal message' : 'Ran command',
        detail: input.internal ? `Thought ${input.id}` : `Command ${input.id}`,
        turnId: input.turnId,
        timelineSequence: input.timelineSequence,
        createdAt: iso(input.millisecond),
        payload: input.internal
            ? { category: 'assistant-internal', output: `Thought ${input.id}`, status: 'completed' }
            : { command: `echo ${input.id}`, output: input.id, status: 'completed' }
    }
}

const runningCompactionActivity: AssistantActivity = {
    id: 'context-compaction-lifecycle',
    kind: 'context.compaction',
    tone: 'tool',
    summary: 'AUTO-COMPACTING',
    detail: 'Conversation context is being compacted.',
    turnId: 'turn-compaction',
    createdAt: iso(0),
    payload: { category: 'context-compaction', status: 'running', startedAt: iso(0) }
}
const completedCompactionActivity: AssistantActivity = {
    ...runningCompactionActivity,
    summary: 'AUTO-COMPACTED',
    payload: { ...runningCompactionActivity.payload, status: 'completed', completedAt: iso(1200) }
}
const cancelledCompactionActivity: AssistantActivity = {
    ...completedCompactionActivity,
    tone: 'warning',
    summary: 'AUTO-COMPACTION CANCELLED',
    payload: { ...completedCompactionActivity.payload, status: 'cancelled' }
}
assert.equal(getContextCompactionStatus(runningCompactionActivity), 'running')
assert.equal(getContextCompactionStatus(completedCompactionActivity), 'completed')
assert.equal(getContextCompactionStatus(cancelledCompactionActivity), 'cancelled')
assert.equal(renderToStaticMarkup(createElement(TimelineContextCompactionMarker, { activity: runningCompactionActivity })).includes('AUTO-COMPACTING'), true)
assert.equal(renderToStaticMarkup(createElement(TimelineContextCompactionMarker, { activity: completedCompactionActivity })).includes('AUTO-COMPACTED'), true)
assert.equal(renderToStaticMarkup(createElement(TimelineContextCompactionMarker, { activity: cancelledCompactionActivity })).includes('AUTO-COMPACTION CANCELLED'), true)

const compactWarningMarkup = renderToStaticMarkup(createElement(IssueLogRow, {
    activity: cancelledCompactionActivity,
    activities: [
        cancelledCompactionActivity,
        { ...cancelledCompactionActivity, id: 'context-compaction-lifecycle-2' },
        { ...cancelledCompactionActivity, id: 'context-compaction-lifecycle-3' }
    ],
    count: 3,
    compact: true,
    onDismiss: () => {},
    onShowMore: () => {}
}))
assert.equal(compactWarningMarkup.includes('min-h-8'), true, 'chat warning rows use the slim compact layout')
assert.equal(compactWarningMarkup.includes('line-clamp-2'), false, 'chat warning rows remain on one line')
assert.equal(compactWarningMarkup.includes('>Details<'), false, 'the compact warning row itself opens details without a redundant action')
assert.equal(compactWarningMarkup.indexOf('x3') < compactWarningMarkup.indexOf('Dismiss warning options'), true, 'the repeat count appears before the warning actions menu')

const turnId = 'turn-devscope-sequence'
const messages = [
    message({ id: 'user', role: 'user', turnId, millisecond: 0, text: 'Run the harness checks.' }),
    message({ id: 'progress-one', role: 'assistant', turnId, millisecond: 100, text: 'I’ll inspect the repository and run a few safe commands.' }),
    message({ id: 'progress-two', role: 'assistant', turnId, millisecond: 400, text: 'The first batch passed. I’m running the project tests now.' }),
    message({ id: 'final', role: 'assistant', turnId, millisecond: 700, text: '## Harness results\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |' })
]
const activities = [
    activity({ id: 'tool-build', turnId, millisecond: 600 }),
    activity({ id: 'tool-tests', turnId, millisecond: 500 }),
    activity({ id: 'thought-hidden', turnId, millisecond: 350, internal: true }),
    activity({ id: 'tool-files', turnId, millisecond: 300 }),
    activity({ id: 'tool-location', turnId, millisecond: 200 })
]

const entries = getTimelineEntries(messages, activities)
assert.deepEqual(
    entries.map((entry) => {
        if (entry.type === 'message') return entry.message.id
        if (entry.type === 'activity-group') return entry.activities.map((item) => item.id)
        if (entry.type === 'activity') return entry.activity.id
        return entry.id
    }),
    [
        'user',
        'progress-one',
        ['tool-location', 'tool-files'],
        'progress-two',
        ['tool-tests', 'tool-build'],
        'final'
    ],
    'the timeline must preserve narration -> tool batch -> narration -> tool batch -> final Markdown'
)
assert.equal(
    entries.some((entry) => entry.type === 'activity' && entry.activity.id === 'thought-hidden'),
    false,
    'internal model thoughts stay out of the visible chat timeline'
)
assert.deepEqual(
    entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').map((entry) => entry.type === 'message' ? entry.message.id : ''),
    ['progress-one', 'progress-two', 'final'],
    'intermediate assistant narration and the final answer must remain distinct visible messages'
)

const completedRows = buildTimelineRows(entries, false, null)
assert.equal(completedRows.map((row) => String(row.kind)).includes('turn-work-summary'), false, 'the conversation must not collapse into a turn summary rail')
assert.equal(completedRows.some((row) => row.kind === 'working'), false)

const workingRows = buildTimelineRows(entries.slice(0, -1), true, iso(0))
assert.equal(workingRows[1]?.kind, 'working', 'active work places its timer directly after the user request and before live work')
const waitingForFirstWorkRows = buildTimelineRows(getTimelineEntries([messages[0]], []), true, iso(0))
const waitingForFirstWorkDisplayRows = groupTimelineRowsIntoWorkSummaries({
    rows: waitingForFirstWorkRows,
    messages: [messages[0]],
    latestAssistantMessageId: null,
    latestTurnStartedAt: iso(0),
    isWorking: true
})
assert.deepEqual(
    waitingForFirstWorkDisplayRows.map((row) => row.kind),
    ['message', 'working'],
    'a first send keeps the lightweight working indicator visible until real work exists instead of rendering an empty disclosure'
)
const initialWorkingMarkup = renderToStaticMarkup(createElement(TimelineWorkingIndicator, { startedAt: iso(0) }))
assert.equal(initialWorkingMarkup.includes('data-assistant-work-summary-shell="true"'), true, 'the first working state uses the same compact shell as Worked for')
assert.equal(initialWorkingMarkup.includes('data-assistant-working-dots="true"'), true, 'the shared shell indicates active work with three dots')
assert.equal(initialWorkingMarkup.includes('mr-0.5 inline-flex'), true, 'the Working label keeps a quiet two-pixel breath after its activity dots')
assert.equal(initialWorkingMarkup.includes('animate-spin'), false, 'the first working state does not switch to a separate spinner layout')
const activeTurnRows = groupTimelineRowsIntoWorkSummaries({
    rows: workingRows,
    messages: messages.slice(0, -1),
    latestAssistantMessageId: 'progress-two',
    latestTurnStartedAt: iso(0),
    isWorking: true
})
assert.deepEqual(
    activeTurnRows.map((row) => row.kind),
    ['message', 'turn-work-summary'],
    'live turns keep work and its state-aware narration in one disclosure shell'
)
const activeWorkSummary = activeTurnRows[1]
assert.equal(activeWorkSummary?.kind === 'turn-work-summary' && activeWorkSummary.running, true)
assert.equal(
    activeWorkSummary?.kind === 'turn-work-summary'
        ? activeWorkSummary.rows.some((row) => row.kind === 'working')
        : true,
    false,
    'the old standalone working indicator is absorbed by the live disclosure header'
)
assert.equal(
    activeWorkSummary?.kind === 'turn-work-summary' ? activeWorkSummary.liveNarrationRow : null,
    null,
    'collapsed work never replaces the chronological sequence with one narration at a time'
)
const expandedNarrationIndex = activeWorkSummary?.kind === 'turn-work-summary'
    ? activeWorkSummary.rows.findIndex((row) => row.kind === 'message' && row.message.id === 'progress-two')
    : -1
const laterToolIndex = activeWorkSummary?.kind === 'turn-work-summary'
    ? activeWorkSummary.rows.findIndex((row) => row.kind === 'activity-group' && row.activities.some((activity) => activity.id === 'tool-tests'))
    : -1
assert.equal(
    expandedNarrationIndex >= 0 && laterToolIndex > expandedNarrationIndex,
    true,
    'expanded work keeps narration in arrival order instead of forcing the latest narration to the bottom'
)

const streamingFinalMessages = messages.map((entry) => entry.id === 'final'
    ? { ...entry, streaming: true, updatedAt: iso(750) }
    : entry)
const streamingFinalRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(streamingFinalMessages, activities), true, iso(0)),
    messages: streamingFinalMessages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: true
})
assert.deepEqual(
    streamingFinalRows.map((row) => row.kind),
    ['message', 'turn-work-summary'],
    'assistant narration never guesses that a still-running turn has reached its final response'
)
assert.equal(
    streamingFinalRows[1]?.kind === 'turn-work-summary'
        ? streamingFinalRows[1].rows.at(-1)?.id
        : null,
    'final',
    'the complete live sequence accumulates inside the remembered work disclosure until terminal completion'
)

const endCompactionActivity: AssistantActivity = {
    ...runningCompactionActivity,
    id: 'context-compaction-after-final',
    turnId,
    createdAt: iso(800),
    payload: { ...runningCompactionActivity.payload, startedAt: iso(800) }
}
const compactingAfterFinalRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(messages, [...activities, endCompactionActivity]), true, iso(0)),
    messages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: true
})
const visibleFinalIndex = compactingAfterFinalRows.findIndex((row) => row.kind === 'message' && row.message.id === 'final')
const liveCompactionIndex = compactingAfterFinalRows.findIndex((row) => row.kind === 'activity' && row.activity.id === endCompactionActivity.id)
assert.equal(visibleFinalIndex > 0, true, 'a completed final response becomes a full timeline row before end-of-turn auto-compaction finishes')
assert.equal(liveCompactionIndex > visibleFinalIndex, true, 'running auto-compaction remains a separate marker after the already-visible final response')
assert.equal(
    compactingAfterFinalRows.some((row) => row.kind === 'turn-work-summary' && row.running && row.terminalResponseVisible),
    true,
    'an explicit post-final compaction signal may collapse work without treating ordinary narration as terminal'
)

const collapsedTurnRows = groupTimelineRowsIntoWorkSummaries({
    rows: completedRows,
    messages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: false
})
assert.deepEqual(
    collapsedTurnRows.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'the request and final response remain visible while the entire working phase collapses between them'
)
const workSummary = collapsedTurnRows[1]
assert.equal(workSummary?.kind === 'turn-work-summary' ? workSummary.rows.length : 0, 4)

const persistedTurnId = 'persisted-local-turn-id'
const persistedProviderNarrationId = 'pi-message:assistant:100'
const persistedProviderFinalId = 'pi-message:assistant:200'
const persistedPrompt = {
    ...message({ id: 'persisted-user', role: 'user', turnId: persistedTurnId, millisecond: 0, text: 'Inspect the persisted thread.' }),
    turnId: null
}
const persistedNarration = message({
    id: `assistant-message-${persistedProviderNarrationId}`,
    role: 'assistant',
    turnId: persistedTurnId,
    millisecond: 100,
    text: 'I am inspecting the persisted thread.'
})
const persistedFinal = message({
    id: `assistant-message-${persistedProviderFinalId}`,
    role: 'assistant',
    turnId: persistedTurnId,
    millisecond: 300,
    text: 'The persisted thread is correct.'
})
const persistedUsage: AssistantSessionTurnUsageEntry = {
    id: persistedTurnId,
    sessionId: 'persisted-session',
    threadId: 'persisted-thread',
    model: 'test-model',
    state: 'completed',
    requestedAt: persistedPrompt.createdAt,
    startedAt: persistedPrompt.createdAt,
    completedAt: persistedFinal.updatedAt,
    assistantMessageId: persistedProviderFinalId,
    usage: null,
    updatedAt: persistedFinal.updatedAt
}
const persistedReferenceRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(
        getTimelineEntries(
            [persistedPrompt, persistedNarration, persistedFinal],
            [activity({ id: 'persisted-tool', turnId: persistedTurnId, millisecond: 200 })]
        ),
        false,
        null
    ),
    messages: [persistedPrompt, persistedNarration, persistedFinal],
    turnUsageById: new Map([[persistedTurnId, persistedUsage]]),
    latestAssistantMessageId: persistedProviderFinalId,
    latestTurnStartedAt: persistedPrompt.createdAt,
    isWorking: false
})
assert.deepEqual(
    persistedReferenceRows.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'hydrated provider message references resolve to the canonical Desktop message id before final-response classification'
)
assert.equal(
    persistedReferenceRows.at(-1)?.kind === 'message' ? persistedReferenceRows.at(-1)?.message.id : null,
    persistedFinal.id,
    'existing chats retain the actual final response outside the collapsed work disclosure'
)

const recoveredTurnId = 'shared-turn:canonical-chat:recovered-after-transport-error'
const recoveredUser = message({
    id: 'recovered-user',
    role: 'user',
    turnId: recoveredTurnId,
    millisecond: 500,
    text: 'Finish the deployment after reconnecting.'
})
const recoveredProgress = message({
    id: 'recovered-progress',
    role: 'assistant',
    turnId: recoveredTurnId,
    millisecond: 600,
    text: 'The connection dropped; I am resuming the deployment.'
})
const recoveredTransportError: AssistantActivity = {
    id: 'shared-error:recovered-transport-error',
    kind: 'error',
    tone: 'error',
    summary: 'Assistant error',
    detail: 'WebSocket closed 1006',
    turnId: recoveredTurnId,
    createdAt: iso(700),
    payload: { stopReason: 'error', status: 'failed', completedAt: iso(700) }
}
const recoveredFinal = message({
    id: 'recovered-final',
    role: 'assistant',
    turnId: recoveredTurnId,
    millisecond: 900,
    text: 'Deployment completed and verified.'
})
const recoveredUsage: AssistantSessionTurnUsageEntry = {
    id: 'persisted-recovered-turn',
    sessionId: 'recovered-session',
    threadId: 'recovered-thread',
    model: 'test-model',
    state: 'completed',
    requestedAt: recoveredUser.createdAt,
    startedAt: recoveredUser.createdAt,
    completedAt: recoveredFinal.updatedAt,
    assistantMessageId: recoveredFinal.id,
    usage: null,
    updatedAt: recoveredFinal.updatedAt
}
const recoveredRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(
        [recoveredUser, recoveredProgress, recoveredFinal],
        [
            activity({ id: 'recovered-tool-before-error', turnId: recoveredTurnId, millisecond: 650 }),
            recoveredTransportError,
            activity({ id: 'recovered-tool-after-error', turnId: recoveredTurnId, millisecond: 800 })
        ]
    ), false, null),
    messages: [recoveredUser, recoveredProgress, recoveredFinal],
    turnUsageById: new Map([[recoveredTurnId, recoveredUsage]]),
    latestAssistantMessageId: recoveredFinal.id,
    latestTurnStartedAt: recoveredUser.createdAt,
    isWorking: false
})
assert.deepEqual(
    recoveredRows.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'a recovered turn keeps its completed final answer visible after an earlier transient transport error'
)
assert.equal(
    recoveredRows[1]?.kind === 'turn-work-summary' ? recoveredRows[1].outcome : null,
    'completed',
    'authoritative completed usage wins over an earlier transient error activity'
)

const unresolvedTransientTurnId = 'turn-with-recoverable-error'
const unresolvedTransientUser = message({
    id: 'recoverable-error-user',
    role: 'user',
    turnId: unresolvedTransientTurnId,
    millisecond: 910,
    text: 'Keep going after a recoverable error.'
})
const unresolvedTransientError: AssistantActivity = {
    id: 'recoverable-error-activity',
    kind: 'error',
    tone: 'error',
    summary: 'Provider request error',
    detail: 'fetch failed',
    turnId: unresolvedTransientTurnId,
    createdAt: iso(920),
    payload: { status: 'failed' }
}
const unresolvedTransientNextUser = message({
    id: 'recoverable-error-next-user',
    role: 'user',
    turnId: 'turn-after-recoverable-error',
    millisecond: 940,
    text: 'What happened?'
})
const unresolvedTransientRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(
        [unresolvedTransientUser, unresolvedTransientNextUser],
        [unresolvedTransientError]
    ), false, null),
    messages: [unresolvedTransientUser, unresolvedTransientNextUser],
    latestAssistantMessageId: null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.equal(
    unresolvedTransientRows[1]?.kind === 'turn-work-summary' ? unresolvedTransientRows[1].outcome : null,
    'no-response',
    'an error activity without an explicit terminal turn marker cannot label the whole turn failed'
)

const explicitFailedActivity: AssistantActivity = {
    ...unresolvedTransientError,
    id: 'explicit-terminal-failure',
    turnTerminalOutcome: 'failed'
}
const explicitFailedRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(
        [unresolvedTransientUser, unresolvedTransientNextUser],
        [explicitFailedActivity]
    ), false, null),
    messages: [unresolvedTransientUser, unresolvedTransientNextUser],
    latestAssistantMessageId: null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.equal(
    explicitFailedRows[1]?.kind === 'turn-work-summary' ? explicitFailedRows[1].outcome : null,
    'failed',
    'an explicit terminal turn marker can label the whole turn failed'
)

const networkRecoveryActivity: AssistantActivity = {
    id: 'network-recovery-turn-1',
    kind: 'connection.recovery',
    tone: 'warning',
    summary: 'Reconnecting 6 of 10',
    turnId: 'turn-network-recovery',
    createdAt: '2026-08-10T10:00:00.000Z',
    payload: { category: 'connection-recovery', status: 'retrying', attempt: 6, maxAttempts: 10 }
}
const networkRecoveryMarkup = renderToStaticMarkup(createElement(AssistantTimelineNetworkRecovery, { activity: networkRecoveryActivity }))
assert.match(networkRecoveryMarkup, /Reconnecting 6 of 10/, 'Desktop renders network recovery as a compact live status')
assert.doesNotMatch(networkRecoveryMarkup, /fetch failed/i)
const pausedNetworkMarkup = renderToStaticMarkup(createElement(AssistantTimelineNetworkRecovery, {
    activity: {
        ...networkRecoveryActivity,
        summary: 'Paused · Network issue',
        payload: { ...networkRecoveryActivity.payload, status: 'paused', attempt: 10 }
    }
}))
assert.match(pausedNetworkMarkup, /Paused · Network issue/)

const providerAliasedMessages = messages.map((entry) => entry.role === 'user'
    ? { ...entry, turnId: 'local-optimistic-turn-id' }
    : entry)
const providerAliasedRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(providerAliasedMessages, activities), false, null),
    messages: providerAliasedMessages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: false
})
assert.deepEqual(
    providerAliasedRows.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'a provider turn alias still collapses live work against the nearest canonical user boundary'
)
const providerAliasedActiveRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(providerAliasedMessages, activities), true, iso(0)),
    messages: providerAliasedMessages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: true
})
const providerAliasedActiveSummary = providerAliasedActiveRows.find((row) => row.kind === 'turn-work-summary')
const providerAliasedCompletedSummary = providerAliasedRows.find((row) => row.kind === 'turn-work-summary')
assert.equal(
    providerAliasedActiveSummary?.id,
    providerAliasedCompletedSummary?.id,
    'the work component keeps one identity while a local turn transitions to its provider alias'
)
assert.deepEqual(
    providerAliasedActiveSummary?.kind === 'turn-work-summary'
        ? providerAliasedActiveSummary.rows.map((row) => row.id)
        : [],
    ['progress-one', 'tool-group-tool-location', 'progress-two', 'tool-group-tool-tests', 'final'],
    'expanded active work accumulates narration, tools, and response without internal model thoughts'
)

const aliasedCompletedCompaction: AssistantActivity = {
    ...completedCompactionActivity,
    id: 'context-compaction-app-server-turn-alias',
    turnId: 'app-server-turn-alias',
    createdAt: iso(450),
    payload: {
        ...completedCompactionActivity.payload,
        startedAt: iso(425),
        completedAt: iso(450)
    }
}
const collapsedRowsWithTurnAlias = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(messages, [...activities, aliasedCompletedCompaction]), false, null),
    messages,
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: false
})
assert.deepEqual(
    collapsedRowsWithTurnAlias.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'a live app-server compaction ID inside one canonical user/final boundary cannot expose the completed work'
)
assert.equal(
    collapsedRowsWithTurnAlias[1]?.kind === 'turn-work-summary'
        ? collapsedRowsWithTurnAlias[1].rows.some((row) => row.id === aliasedCompletedCompaction.id)
        : false,
    true,
    'the aliased lifecycle row remains available inside the completed work disclosure'
)

const pendingNextUser: AssistantMessage = {
    ...message({ id: 'pending-next-user', role: 'user', turnId: 'pending-next-turn', millisecond: 800, text: 'Start the next task.' }),
    turnId: null
}
const rowsAfterSendingNextMessage = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries([...messages, pendingNextUser], activities), true, pendingNextUser.createdAt),
    messages: [...messages, pendingNextUser],
    latestAssistantMessageId: null,
    latestTurnStartedAt: pendingNextUser.createdAt,
    isWorking: true
})
const summariesAfterSendingNextMessage = rowsAfterSendingNextMessage.filter((row) => row.kind === 'turn-work-summary')
assert.equal(summariesAfterSendingNextMessage.length, 1, 'sending a new message keeps the previous Worked for disclosure without creating an empty working disclosure')
assert.equal(
    summariesAfterSendingNextMessage[0]?.kind === 'turn-work-summary' ? summariesAfterSendingNextMessage[0].turnId : null,
    turnId,
    'the preserved historical disclosure remains attached to its completed turn'
)
assert.equal(rowsAfterSendingNextMessage.at(-1)?.kind, 'working', 'the optimistic next turn uses the responsive standalone working indicator until real work arrives')

const freshTurnId = 'turn-after-stale-running-ledger'
const freshTurnStartedAt = iso(900)
const freshUser = message({
    id: 'fresh-user-after-stale-running-ledger',
    role: 'user',
    turnId: freshTurnId,
    millisecond: 900,
    text: 'Run one more independent task.'
})
const staleRunningUsage: AssistantSessionTurnUsageEntry = {
    id: turnId,
    sessionId: 'session-activity-rail',
    threadId: 'thread-activity-rail',
    model: 'openai-codex/gpt-5.5',
    state: 'running',
    requestedAt: iso(0),
    startedAt: iso(0),
    completedAt: null,
    assistantMessageId: 'final',
    effort: 'high',
    serviceTier: null,
    usage: null,
    updatedAt: iso(800)
}
const rowsWithStaleRunningLedger = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries([...messages, freshUser], activities), true, freshTurnStartedAt),
    messages: [...messages, freshUser],
    turnUsageById: new Map([[turnId, staleRunningUsage]]),
    latestAssistantMessageId: null,
    latestTurnStartedAt: freshTurnStartedAt,
    isWorking: true
})
const freshWorkingIndicator = rowsWithStaleRunningLedger.find((row) => row.kind === 'working')
assert.equal(freshWorkingIndicator?.kind === 'working' ? freshWorkingIndicator.createdAt : null, freshTurnStartedAt, 'the newest visible prompt must outrank a stale running turn ledger entry')
assert.equal(
    rowsWithStaleRunningLedger.some((row) => row.kind === 'turn-work-summary' && row.running),
    false,
    'a new prompt does not create a running disclosure until real work arrives'
)
assert.equal(
    rowsWithStaleRunningLedger.some((row) => (
        row.kind === 'turn-work-summary' && !row.running && row.turnId === turnId
    )),
    true,
    'completed work remains collapsed while the independent next turn is running'
)
const workSummaryMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: iso(0),
    completedAt: iso(60_000),
    renderChildren: () => createElement('div', null, 'Chronological work')
}))
assert.equal(workSummaryMarkup.includes('Worked for 1m'), true)
assert.equal(workSummaryMarkup.includes('aria-expanded="false"'), true, 'completed work is collapsed by default')
assert.equal(workSummaryMarkup.includes('Chronological work'), false, 'collapsed work does not mount hidden tool and Markdown trees')
assert.equal(workSummaryMarkup.includes('grid-template-rows'), true, 'work disclosure retains a visible expand and collapse height transition')
assert.equal(workSummaryMarkup.includes('Collapse work'), false, 'work uses one disclosure control instead of repeating a footer action')
const workSummarySource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary.tsx', import.meta.url), 'utf8')
assert.equal(workSummarySource.includes("expanded && 'sticky top-0 z-10 bg-sparkle-bg/95 backdrop-blur-md'"), true, 'the expanded work header remains reachable while scrolling through long work')
assert.equal(workSummarySource.includes('collapseWhenResponseVisible'), false, 'intermediate narration can never masquerade as a terminal collapse signal')
assert.equal(workSummarySource.includes('collapseForTerminalResponse'), true, 'only an explicit terminal-response state may collapse a still-running work sequence')
assert.equal(workSummarySource.includes('statusTextRef.current.textContent = formatWorkSummaryStatus'), true, 'the live work timer updates its own text without reconciling the expanded work subtree')
assert.equal(workSummarySource.includes('<AnimatedHeight isOpen={contentVisible} duration={WORK_SUMMARY_MOTION_MS} crispContent>'), true, 'work disclosures animate both expansion and collapse')
assert.equal(workSummarySource.includes('window.requestAnimationFrame(() =>'), true, 'the heavier work subtree mounts closed before its expansion frame begins')
assert.match(
    workSummarySource,
    /window\.cancelAnimationFrame\(contentRevealFrameRef\.current\)\s+contentRevealFrameRef\.current = null/,
    'Strict Mode cleanup releases the cancelled reveal frame so the replayed mount can open on its first frame'
)
assert.match(
    workSummarySource,
    /window\.clearTimeout\(contentUnmountTimerRef\.current\)\s+contentUnmountTimerRef\.current = null/,
    'Strict Mode cleanup releases the content timer instead of leaving the disclosure in a stale mounted state'
)
assert.equal(workSummarySource.includes('startTransition(() => setContentMounted(true))'), true, 'the heavier work subtree remains interruptible while preparing the animation')
assert.equal(workSummarySource.includes('setContentVisible(false)'), true, 'collapse keeps the mounted content in a closed animation state')
assert.equal(workSummarySource.includes('}, WORK_SUMMARY_UNMOUNT_DELAY_MS)'), true, 'collapsed work unmounts only after the animation completes')
assert.equal(workSummarySource.includes('setNowIso'), false, 'the shared work disclosure does not schedule a React render every second')
const runningWorkSummaryMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: new Date().toISOString(),
    completedAt: null,
    running: true,
    renderChildren: () => createElement('div', null, 'Live implementation work')
}))
assert.equal(runningWorkSummaryMarkup.includes('Working for'), true, 'the shared disclosure presents its live elapsed state')
assert.equal(runningWorkSummaryMarkup.includes('data-assistant-working-dots="true"'), true, 'live work adds the compact three-dot activity cue to the finished-state row')
assert.equal(runningWorkSummaryMarkup.includes('aria-expanded="true"'), true, 'active work restores the remembered expansion preference, defaulting to the chronological sequence')
assert.equal(runningWorkSummaryMarkup.includes('Live implementation work'), true, 'expanded active work mounts the complete chronological sequence')
assert.equal(workSummarySource.includes('WORK_SUMMARY_EXPANDED_PREFERENCE_KEY'), true, 'manual active-work expansion is remembered across turns')

const interruptedTurnId = 'turn-interrupted-without-final'
const interruptedPrompt: AssistantMessage = {
    ...message({ id: 'interrupted-user', role: 'user', turnId: interruptedTurnId, millisecond: 800, text: 'Start work, then stop.' }),
    turnId: null
}
const interruptedNarration = message({ id: 'interrupted-progress', role: 'assistant', turnId: interruptedTurnId, millisecond: 850, text: 'I am working on it.' })
const interruptedTool = activity({ id: 'interrupted-tool', turnId: interruptedTurnId, millisecond: 900 })
const raceTaggedTool = activity({ id: 'interrupted-tool-with-next-turn-id', turnId: 'next-turn-id', millisecond: 910 })
const interruptedUsage: AssistantSessionTurnUsageEntry = {
    id: interruptedTurnId,
    sessionId: 'session-interrupted',
    threadId: 'thread-interrupted',
    model: 'test-model',
    state: 'interrupted',
    requestedAt: interruptedPrompt.createdAt,
    startedAt: interruptedPrompt.createdAt,
    completedAt: iso(1800),
    assistantMessageId: interruptedNarration.id,
    usage: null,
    updatedAt: iso(1800)
}
const interruptedRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries([interruptedPrompt, interruptedNarration], [raceTaggedTool, interruptedTool]), false, null),
    messages: [interruptedPrompt, interruptedNarration],
    turnUsageById: new Map([[interruptedTurnId, interruptedUsage]]),
    latestAssistantMessageId: null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.deepEqual(interruptedRows.map((row) => row.kind), ['message', 'turn-work-summary'], 'legacy interrupted turns collapse even when the user prompt has no turn ID and only progress narration exists')
const interruptedSummary = interruptedRows[1]
assert.equal(interruptedSummary?.kind === 'turn-work-summary' ? interruptedSummary.outcome : null, 'interrupted')
assert.equal(interruptedSummary?.kind === 'turn-work-summary'
    ? interruptedSummary.rows.some((row) => (
        (row.kind === 'activity' && row.activity.id === raceTaggedTool.id)
        || (row.kind === 'activity-group' && row.activities.some((entry) => entry.id === raceTaggedTool.id))
    ))
    : false, true, 'legacy prompt boundaries retain work rows that were race-tagged with the following turn ID')
const interruptedMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: interruptedPrompt.createdAt,
    completedAt: iso(1800),
    outcome: 'interrupted',
    renderChildren: () => createElement('div', null, 'Interrupted work')
}))
assert.equal(interruptedMarkup.includes('Worked for'), true)
assert.equal(interruptedMarkup.includes('Interrupted'), true)
assert.equal(interruptedMarkup.includes('aria-expanded="false"'), true)
assert.equal(interruptedMarkup.includes('Interrupted work'), false)

const projectedInterruptedTurnId = 'shared-turn:canonical-chat:stopped-user-message'
const projectedInterruptedUser = message({
    id: 'projected-interrupted-user',
    role: 'user',
    turnId: projectedInterruptedTurnId,
    millisecond: 1820,
    text: 'Research the release.',
    timelineSequence: 1
})
const projectedInterruptedProgress = message({
    id: 'projected-interrupted-progress',
    role: 'assistant',
    turnId: projectedInterruptedTurnId,
    millisecond: 1840,
    text: 'I am checking the announcement.',
    timelineSequence: 2
})
const projectedInterruptedPartialFinal = message({
    id: 'projected-interrupted-partial-final',
    role: 'assistant',
    turnId: projectedInterruptedTurnId,
    millisecond: 1880,
    text: 'The release exists. I am opening the remaining sources now.',
    timelineSequence: 4
})
const projectedInterruptedToolBefore = activity({
    id: 'projected-interrupted-tool-before',
    turnId: projectedInterruptedTurnId,
    millisecond: 1860,
    timelineSequence: 3
})
const projectedInterruptedToolAfter = activity({
    id: 'projected-interrupted-tool-after',
    turnId: projectedInterruptedTurnId,
    millisecond: 1900,
    timelineSequence: 5
})
const projectedInterruptedTerminal: AssistantActivity = {
    id: 'shared-error:projected-interrupted-terminal',
    kind: 'error',
    tone: 'warning',
    summary: 'Assistant interrupted',
    turnTerminalOutcome: 'interrupted',
    detail: 'Request was aborted',
    turnId: projectedInterruptedTurnId,
    timelineSequence: 6,
    createdAt: iso(1920),
    payload: { stopReason: 'aborted', status: 'cancelled', completedAt: iso(1920) }
}
const projectedNextUser = message({
    id: 'projected-next-user',
    role: 'user',
    turnId: 'shared-turn:canonical-chat:next-user-message',
    millisecond: 2000,
    text: 'Use a different source.',
    timelineSequence: 7
})
const projectedInterruptedMessages = [
    projectedInterruptedUser,
    projectedInterruptedProgress,
    projectedInterruptedPartialFinal,
    projectedNextUser
]
const projectedInterruptedRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(projectedInterruptedMessages, [
        projectedInterruptedToolBefore,
        projectedInterruptedToolAfter,
        projectedInterruptedTerminal
    ]), false, null),
    messages: projectedInterruptedMessages,
    latestAssistantMessageId: null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.deepEqual(
    projectedInterruptedRows.map((row) => row.kind),
    ['message', 'turn-work-summary', 'message'],
    'an externally stopped TUI turn must collapse every partial response, tool, and terminal notice before the next prompt'
)
const projectedInterruptedSummary = projectedInterruptedRows[1]
assert.equal(projectedInterruptedSummary?.kind === 'turn-work-summary' ? projectedInterruptedSummary.outcome : null, 'interrupted')
assert.equal(
    projectedInterruptedSummary?.kind === 'turn-work-summary'
        ? projectedInterruptedSummary.rows.some((row) => row.id === projectedInterruptedToolAfter.id)
        : false,
    true,
    'tools emitted after the last partial assistant narration must remain inside the stopped work disclosure'
)
assert.equal(
    projectedInterruptedSummary?.kind === 'turn-work-summary'
        ? projectedInterruptedSummary.rows.some((row) => row.id === projectedInterruptedTerminal.id)
        : false,
    true,
    'the interruption notice must collapse with the stopped work instead of remaining exposed in the timeline'
)

const orphanTurnId = 'turn-no-final-response'
const orphanPrompt = message({ id: 'orphan-user', role: 'user', turnId: orphanTurnId, millisecond: 2000, text: 'Do work without a final response.' })
const orphanTool = activity({ id: 'orphan-tool', turnId: orphanTurnId, millisecond: 2200 })
const orphanRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries([orphanPrompt], [orphanTool]), false, null),
    messages: [orphanPrompt],
    latestAssistantMessageId: null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.equal(orphanRows[1]?.kind === 'turn-work-summary' ? orphanRows[1].outcome : null, 'no-response', 'historical orphan turns receive a truthful no-response work summary')

const timelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimeline.tsx', import.meta.url), 'utf8')
const conversationWorkingSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const queuedComposerTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantQueuedComposer.ts', import.meta.url), 'utf8')
const virtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const historyStoreSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
const historyStateSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-history-state.ts', import.meta.url), 'utf8')
assert.equal(timelineSource.includes('<AssistantVirtualTimeline'), true, 'the timeline delegates mounting and measurement to the virtual list owner')
assert.match(conversationWorkingSource, /timelineIsWorking = \(isThreadWorking \|\| optimisticPromptSending\)/u, 'prompt submission enters working state immediately instead of waiting for the runtime turn event')
assert.match(conversationWorkingSource, /timelinePresentationIsWorking = timelineIsWorking && !optimisticPromptAwaitingUserMessage/u, 'the temporary working row waits for the newly sent user message instead of attaching to the previous prompt')
assert.match(queuedComposerTimelineSource, /onSendingChange\?\.\(true\)[\s\S]{0,120}await dispatchPrompt/u, 'the optimistic working state starts before the prompt IPC')
assert.match(conversationWorkingSource, /latestTurnState: activeThread\?\.latestTurn\?\.state \|\| null/u, 'background queue state includes the explicit turn ledger')
assert.match(queuedComposerTimelineSource, /sessionState\.latestTurnState === 'running'/u, 'queued prompts cannot drain during a running turn just because its connection state changed')
assert.equal(isAssistantQueuedComposerSessionBusy({
    sessionId: 'recovering-session',
    threadState: 'error',
    latestTurnState: 'running',
    pendingApprovalCount: 0,
    pendingUserInputCount: 0
}), true, 'queue draining obeys the running turn ledger during a connection error')
assert.equal(isAssistantQueuedComposerSessionBusy({
    sessionId: 'failed-session',
    threadState: 'ready',
    latestTurnState: 'error',
    pendingApprovalCount: 0,
    pendingUserInputCount: 0
}), false, 'an explicitly terminal turn releases its queued follow-up')
assert.equal(virtualTimelineSource.includes('<LegendList'), true, 'long histories render through LegendList rather than renderer-only slicing')
assert.match(virtualTimelineSource, /const maintainVisibleContentPosition = useMemo\(\(\) => \(\{[\s\S]{0,180}data: true,[\s\S]{0,180}size: startupSettled && scrollMode === 'free-scrolling'/u, 'database-page prepends and settled measured row sizes preserve the visible anchor')
assert.match(virtualTimelineSource, /maintainVisibleContentPosition=\{maintainVisibleContentPosition\}/u, 'LegendList receives the bounded anchor policy')
assert.equal(virtualTimelineSource.includes('itemLayout: !disclosureLayoutActive'), true, 'user disclosures suspend item-layout end-follow while their row height animates')
assert.equal(virtualTimelineSource.includes('layout: !disclosureLayoutActive'), true, 'viewport layout follow cannot compete with an active disclosure anchor')
assert.equal(virtualTimelineSource.includes("addEventListener('pointerdown', handleTimelinePointerDown"), true, 'timeline controls suspend layout follow before their React click changes row height')
assert.equal(virtualTimelineSource.includes('ASSISTANT_TIMELINE_DISCLOSURE_TOGGLE_EVENT'), true, 'automatic work collapse uses the same bounded disclosure window')
assert.equal(virtualTimelineSource.includes('completionFollowTimerRef'), true, 'turn completion owns one bounded post-layout end correction through work collapse and Markdown handoff')
assert.equal(virtualTimelineSource.includes("scrollModeRef.current !== 'following-end'"), true, 'completion follow only activates when the viewer was already following the response end')
assert.equal(virtualTimelineSource.includes('COMPLETION_END_FOLLOW_DELAYS_MS'), false, 'turn completion cannot replay a viewport correction ladder')
assert.equal(historyStoreSource.includes('getHistoryPage({'), true, 'earlier history comes from the main-process SQLite page contract')
assert.equal(historyStateSource.includes('5 * 60_000'), true, 'recent thread detail is retained for a bounded five-minute idle window')
assert.equal(timelineSource.includes('compactLiveNarration: true'), false, 'collapsed work does not replace the sequence with a one-at-a-time narration preview')
assert.equal(timelineSource.includes('renderLiveNarration'), false, 'one stable disclosure owns all live work presentation')
const compactNarrationMarkup = renderToStaticMarkup(createElement(TimelineMessage, {
    message: messages[1],
    compactLiveNarration: true
}))
assert.equal(compactNarrationMarkup.includes('line-clamp-3'), true, 'collapsed narration is capped at three lines')
assert.equal(compactNarrationMarkup.includes('Show full narration'), false, 'compact narration is a preview rather than a second disclosure')
assert.equal(compactNarrationMarkup.includes('aria-expanded'), false, 'compact narration cannot create a duplicate expandable control')
const streamingCompactNarrationMarkup = renderToStaticMarkup(createElement(TimelineMessage, {
    message: { ...messages[1], text: 'Narrating live work', streaming: true },
    compactLiveNarration: true
}))
assert.equal(streamingCompactNarrationMarkup.includes('Narrating live work'), true, 'compact work narration paints its paced live text before settlement')
const activeWorkMarkup = renderToStaticMarkup(createElement(TimelineTurnWorkSummary, {
    startedAt: messages[0].createdAt,
    completedAt: null,
    running: true,
    renderChildren: () => createElement('div', null, 'Active work')
}))
assert.equal((activeWorkMarkup.match(/aria-expanded=/g) || []).length, 1, 'an active turn exposes exactly one work disclosure')

assert.equal(didAssistantTimelineWorkComplete(
    [{ id: 'active-summary', kind: 'turn-work-summary', running: true, turnId: 'turn-live' }],
    [{ id: 'active-summary', kind: 'turn-work-summary', running: false, turnId: 'turn-live' }]
), true, 'the same work summary detects its running-to-completed transition')
assert.equal(didAssistantTimelineWorkComplete(
    [{ id: 'active-fallback', kind: 'turn-work-summary', running: true, turnId: 'turn-live' }],
    [{ id: 'persisted-turn-live', kind: 'turn-work-summary', running: false, turnId: 'turn-live' }]
), true, 'turn identity preserves completion detection when projection changes the summary row id')
assert.equal(didAssistantTimelineWorkComplete(
    [{ id: 'older-summary', kind: 'turn-work-summary', running: false, turnId: 'turn-old' }],
    [{ id: 'new-summary', kind: 'turn-work-summary', running: false, turnId: 'turn-new' }]
), false, 'ordinary historical row changes never force end-follow')

assert.equal(resolveAssistantTimelineDisclosureAnchorMode({
    expanding: true,
    hasWorkRow: true,
    userMessageVisibilityRatio: 0.7,
    dominantMessageVisibleHeight: 0,
    viewportHeight: 800
}), 'preserve-user', 'expansion keeps a meaningfully visible user prompt fixed in the viewport')
assert.equal(resolveAssistantTimelineDisclosureAnchorMode({
    expanding: true,
    hasWorkRow: true,
    userMessageVisibilityRatio: 0,
    dominantMessageVisibleHeight: 500,
    viewportHeight: 800
}), 'center-work', 'expansion from lower in the turn settles around the work region instead of the final message')
assert.equal(resolveAssistantTimelineDisclosureAnchorMode({
    expanding: false,
    hasWorkRow: true,
    userMessageVisibilityRatio: 0,
    dominantMessageVisibleHeight: 320,
    viewportHeight: 800
}), 'preserve-message', 'collapse preserves the message occupying a substantial part of the viewport')
assert.equal(resolveAssistantTimelineDisclosureAnchorMode({
    expanding: false,
    hasWorkRow: true,
    userMessageVisibilityRatio: 0,
    dominantMessageVisibleHeight: 80,
    viewportHeight: 800
}), 'preserve-trigger', 'collapse falls back to the disclosure header when no message dominates the viewport')

assert.equal(resolveTimelineMinimapHeight(8, 800), 56, 'the minimap uses compact eight-pixel checkpoint spacing')
assert.deepEqual(
    resolveTimelineMinimapWindow(100, 50),
    { startIndex: 36, endIndex: 64, hiddenBefore: 36, hiddenAfter: 36 },
    'long chats expose a centered rolling minimap window'
)
assert.equal(TIMELINE_MINIMAP_MAX_MARKERS, 28, 'the minimap never accumulates an unbounded dash field')
assert.equal(resolveTimelineMinimapIndexFromPointer({ itemCount: 8, railTop: 100, railHeight: 56, pointerY: 124 }), 3)
assert.deepEqual(
    [0, 1, 2, 3].map((distance) => resolveTimelineMinimapMarkerWidth(distance)),
    [24, 17, 14, 12],
    'every checkpoint, including the current one, follows the same hover wave'
)

const legacyUserMessage: AssistantMessage = { ...messages[0], turnId: null }
const legacyFailedCommand = activity({ id: 'legacy-failed-command', turnId, millisecond: 250, tone: 'error' })
const legacyRows = buildTimelineRows(
    getTimelineEntries([legacyUserMessage, ...messages.slice(1)], [legacyFailedCommand, ...activities]),
    false,
    null
)
const legacyCollapsedRows = groupTimelineRowsIntoWorkSummaries({
    rows: legacyRows,
    messages: [legacyUserMessage, ...messages.slice(1)],
    latestAssistantMessageId: 'final',
    latestTurnStartedAt: iso(0),
    isWorking: false
})
assert.equal(
    legacyCollapsedRows.some((row) => row.kind === 'turn-work-summary'),
    true,
    'legacy prompts without turn IDs still collapse completed narration, checks, and failed commands into their work summary'
)
assert.equal(
    buildBaseCheckpoints(legacyRows).length,
    1,
    'legacy prompts without turn IDs remain eligible minimap checkpoints'
)

const voiceTurnId = 'shared-turn:voice-conversation'
const simpleVoiceMessages: AssistantMessage[] = [
    { ...message({ id: 'voice_user_simple', role: 'user', turnId: voiceTurnId, millisecond: 3000, text: 'How are you?' }), modality: 'voice' },
    { ...message({ id: 'voice_assistant_progress', role: 'assistant', turnId: voiceTurnId, millisecond: 3100, text: 'I am doing well.' }), modality: 'voice' },
    { ...message({ id: 'voice_assistant_final', role: 'assistant', turnId: voiceTurnId, millisecond: 3200, text: 'How can I help?' }), modality: 'voice' }
]
const simpleVoiceDisplayRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(simpleVoiceMessages, []), false, null),
    messages: simpleVoiceMessages,
    latestAssistantMessageId: 'voice_assistant_final',
    latestTurnStartedAt: iso(3000),
    isWorking: false
})
assert.equal(
    simpleVoiceDisplayRows.some((row) => row.kind === 'turn-work-summary'),
    false,
    'ordinary Voice back-and-forth must remain conversational even when more than one assistant transcript item lands in the turn'
)

const voiceTaskActivity: AssistantActivity = {
    id: 'voice-strong-task:task-voice-action',
    kind: 'voice.strong-task',
    tone: 'tool',
    summary: 'Primary agent finished',
    detail: 'Verified result',
    turnId: 'task-voice-action',
    createdAt: iso(3050),
    payload: {
        status: 'completed',
        source: 'voice',
        sourceProviderItemId: 'provider-voice-action',
        startedAt: iso(3050),
        completedAt: iso(3650)
    }
}
const actionableVoiceMessages: AssistantMessage[] = [
    {
        ...message({ id: 'voice_user_action', role: 'user', turnId: 'voice-action-turn', millisecond: 3000, text: 'Run the check.' }),
        modality: 'voice',
        providerItemId: 'provider-voice-action'
    },
    { ...message({ id: 'voice_assistant_action', role: 'assistant', turnId: 'voice-action-turn', millisecond: 3700, text: 'The check passed.' }), modality: 'voice' }
]
const actionableVoiceRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(actionableVoiceMessages, [voiceTaskActivity]), false, null),
    messages: actionableVoiceMessages,
    latestAssistantMessageId: 'voice_assistant_action',
    latestTurnStartedAt: iso(3000),
    isWorking: false
})
assert.deepEqual(
    actionableVoiceRows.map((row) => row.kind),
    ['message', 'activity', 'message'],
    'actionable Voice work uses its explicit primary-agent lifecycle row instead of the generic turn timer'
)
const voiceTaskMarkup = renderToStaticMarkup(createElement(TimelineVoiceTaskStatus, { activity: voiceTaskActivity }))
assert.equal(voiceTaskMarkup.includes('Primary agent finished'), true)
assert.equal(voiceTaskMarkup.includes('Worked for'), false, 'Voice task status must describe the owner and state instead of showing an ambiguous generic timer')

const sameTimeEntries = getTimelineEntries(
    [message({ id: 'same-time-user', role: 'user', turnId: 'same-time', millisecond: 900, text: 'Keep source order.' })],
    [
        activity({ id: 'a-third', turnId: 'same-time', millisecond: 1000 }),
        activity({ id: 'm-second', turnId: 'same-time', millisecond: 1000 }),
        activity({ id: 'z-first', turnId: 'same-time', millisecond: 1000 })
    ]
)
const sameTimeGroup = sameTimeEntries.find((entry) => entry.type === 'activity-group')
assert.deepEqual(
    sameTimeGroup?.type === 'activity-group' ? sameTimeGroup.activities.map((item) => item.id) : [],
    ['a-third', 'm-second', 'z-first'],
    'legacy equal-timestamp activities use the canonical ID tiebreaker when no timeline sequence exists'
)

const failedToolEntries = getTimelineEntries([], [
    activity({ id: 'failed-tool', turnId: 'failed-turn', millisecond: 1200, tone: 'error' }),
    activity({ id: 'successful-tool', turnId: 'failed-turn', millisecond: 1100 })
])
assert.deepEqual(
    failedToolEntries.length === 1 && failedToolEntries[0]?.type === 'activity-group'
        ? failedToolEntries[0].activities.map((item) => item.id)
        : [],
    ['successful-tool', 'failed-tool'],
    'failed command rows must remain inside the same chronological tool-call batch'
)

const boundaryEntries = getTimelineEntries([], [
    activity({ id: 'turn-two-tool', turnId: 'turn-two', millisecond: 1400 }),
    activity({ id: 'turn-one-tool', turnId: 'turn-one', millisecond: 1300 })
])
assert.equal(boundaryEntries.length, 2, 'adjacent tools from different turns must never merge into one batch')
assert.equal(boundaryEntries.every((entry) => entry.type === 'activity'), true)

const managedCommand = activity({ id: 'managed-command', turnId: 'managed-turn', millisecond: 1500 })
managedCommand.payload = {
    command: 'npm run check',
    result: { details: { jobId: 'cmd-7', status: 'running' } },
    status: 'completed'
}
const commandCheckpoint: AssistantActivity = {
    ...activity({ id: 'managed-checkpoint', turnId: 'managed-turn', millisecond: 1600 }),
    kind: 'command.checkpoint',
    summary: 'Checked command',
    detail: 'cmd-7',
    payload: {
        category: 'command-checkpoint',
        args: { action: 'status', jobId: 'cmd-7' },
        commandAction: 'status',
        jobId: 'cmd-7',
        status: 'completed'
    }
}
const checkpointEntries = getTimelineEntries([], [commandCheckpoint, managedCommand])
assert.deepEqual(
    checkpointEntries.map((entry) => entry.type === 'activity' ? entry.activity.id : entry.id),
    ['managed-command', 'managed-checkpoint'],
    'a command follow-up keeps its current chronological position instead of merging into the original tool-call batch'
)
assert.equal(isCommandCheckpointActivity(commandCheckpoint), true)
assert.equal(getCommandCheckpointAction(commandCheckpoint), 'status')
assert.equal(
    findRelatedCommandActivityId(commandCheckpoint, [commandCheckpoint, managedCommand]),
    managedCommand.id,
    'the checkpoint link must resolve to the originating managed command'
)
const commandCheckpointDisplay = buildCommandCheckpointDisplayActivity(commandCheckpoint, [commandCheckpoint, managedCommand])
assert.equal(commandCheckpointDisplay.payload?.command, 'npm run check', 'the follow-up card repeats the original command label')
assert.equal(commandCheckpointDisplay.payload?.relatedCommandActivityId, managedCommand.id)
const commandCheckpointMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, {
    activities: [commandCheckpointDisplay],
    onRevealActivity: () => undefined
}))
assert.equal(commandCheckpointMarkup.includes('Tool Calls'), true, 'command follow-ups use the existing tool-call card container')
assert.equal(commandCheckpointMarkup.includes('npm run check'), true)
assert.equal(commandCheckpointMarkup.includes('Follow-up'), true)
assert.equal(commandCheckpointMarkup.includes('Done'), true)
assert.equal(commandCheckpointMarkup.includes('Go to original command'), true, 'the follow-up card exposes its jump back to the referenced command')
assert.equal(commandCheckpointMarkup.includes('Checked on command'), false, 'the old divider copy is gone')

const legacyCheckpoint: AssistantActivity = {
    ...commandCheckpoint,
    id: 'legacy-managed-checkpoint',
    kind: 'command',
    payload: { args: { action: 'status', jobId: 'cmd-7' }, status: 'completed' }
}
assert.equal(isCommandCheckpointActivity(legacyCheckpoint), true, 'persisted pre-fix status rows must upgrade in the renderer')
assert.equal(findRelatedCommandActivityId(legacyCheckpoint, [legacyCheckpoint, managedCommand]), managedCommand.id)

const secondCommandCheckpoint: AssistantActivity = {
    ...commandCheckpoint,
    id: 'managed-checkpoint-two',
    createdAt: iso(1650),
    payload: {
        ...commandCheckpoint.payload,
        jobId: 'cmd-8',
        args: { action: 'status', jobId: 'cmd-8' },
        status: 'running'
    }
}
const checkpointRows = buildTimelineRows(
    getTimelineEntries([], [commandCheckpoint, secondCommandCheckpoint]),
    false,
    null
)
assert.equal(checkpointRows.length, 1)
assert.equal(checkpointRows[0]?.kind, 'command-checkpoint-group')
assert.equal(
    checkpointRows[0]?.kind === 'command-checkpoint-group' ? checkpointRows[0].activities.length : 0,
    2,
    'adjacent completed and running command checks collapse into one expandable row'
)
const checkpointGroupMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, {
    activities: [
        buildCommandCheckpointDisplayActivity(commandCheckpoint, [commandCheckpoint, managedCommand]),
        buildCommandCheckpointDisplayActivity(secondCommandCheckpoint, [secondCommandCheckpoint, managedCommand])
    ],
    onRevealActivity: () => undefined
}))
assert.equal(checkpointGroupMarkup.includes('Tool Calls (2)'), true, 'adjacent follow-ups use the existing multi-tool card')
assert.equal(checkpointGroupMarkup.includes('Follow-up'), true)
assert.equal(checkpointGroupMarkup.includes('Done'), true)
assert.equal(checkpointGroupMarkup.includes('Running'), true, 'each reused tool card carries its own follow-up state')

const unrelatedOutput = activity({ id: 'unrelated-output', turnId: 'managed-turn', millisecond: 1700 })
unrelatedOutput.payload = { command: 'echo cmd-7', output: 'cmd-7', status: 'completed' }
assert.equal(getCommandJobId(unrelatedOutput), '', 'command-looking output text must not create a managed-job link')
assert.equal(isCommandCheckpointActivity(unrelatedOutput), false)

const firstRunningCommand = activity({ id: 'running-one', turnId: 'adaptive-output', millisecond: 1710 })
firstRunningCommand.payload = { command: 'first', output: '1\n2\n3\n4\n5\n6', status: 'running' }
const secondRunningCommand = activity({ id: 'running-two', turnId: 'adaptive-output', millisecond: 1720 })
secondRunningCommand.payload = { command: 'second', output: '1\n2', status: 'running' }
const runningCommandCheckpoint: AssistantActivity = {
    ...commandCheckpoint,
    id: 'running-command-checkpoint',
    payload: {
        ...commandCheckpoint.payload,
        toolName: 'bash',
        status: 'running'
    }
}
assert.equal(countRunningCommandActivities([firstRunningCommand]), 1)
assert.equal(countRunningCommandActivities([firstRunningCommand, secondRunningCommand]), 2)
assert.equal(
    countRunningCommandActivities([firstRunningCommand, runningCommandCheckpoint]),
    1,
    'running status/stop checkpoints do not represent additional command output previews'
)
assert.equal(getTerminalOutputHeightClass('running', 1), 'h-[6.875rem]', 'one running command shows five output lines')
assert.equal(getTerminalOutputHeightClass('running', 2), 'h-[1.875rem]', 'concurrent running commands collapse to one output line each')
assert.equal(getTerminalOutputHeightClass('success', 2), 'h-32 sm:h-36', 'completed output keeps its normal review height')

const sharedSurfaceActivity = activity({ id: 'shared-surface', turnId: 'surface-contract', millisecond: 1695 })
sharedSurfaceActivity.kind = 'search'
sharedSurfaceActivity.payload = {
    surface: {
        version: 1,
        kind: 'search',
        lifecycle: 'running',
        toolName: 'web_search',
        toolKey: 'web search',
        primaryText: 'Pi SDK',
        query: 'Pi SDK',
        paths: [],
        summary: 'Searching'
    }
}
assert.equal(getActivityAgentSurface(sharedSurfaceActivity)?.kind, 'search')
assert.equal(getActivityStatus(sharedSurfaceActivity), 'running', 'renderer status falls back to the shared surface descriptor')

const runningTimedCommand = activity({ id: 'running-timed-command', turnId: 'terminal-timing', millisecond: 1700 })
runningTimedCommand.payload = {
    command: 'npm test',
    status: 'running',
    startedAt: iso(1700)
}
assert.equal(
    getActivityElapsed(runningTimedCommand, iso(5200)),
    '3s',
    'running command elapsed time advances from its runtime start timestamp'
)
const completedTimedCommand = {
    ...runningTimedCommand,
    payload: {
        ...runningTimedCommand.payload,
        status: 'completed',
        completedAt: iso(5200),
        durationMs: 3500
    }
}
assert.equal(getActivityElapsed(completedTimedCommand, iso(9000)), '3.5s', 'completed command elapsed time freezes at the runtime duration')
const toolCardSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard.tsx', import.meta.url), 'utf8')
const toolCallListSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineToolCalls.tsx', import.meta.url), 'utf8')
const inlineDiffPreviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantInlineDiffPreview.tsx', import.meta.url), 'utf8')
const inlineDiffSyntaxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantInlineDiffSyntax.tsx', import.meta.url), 'utf8')
const animatedHeightSource = readFileSync(new URL('../src/renderer/src/components/ui/AnimatedHeight.tsx', import.meta.url), 'utf8')
assert.equal(resolveAssistantFileChangeStatus({ kind: 'update' }), 'modified')
assert.equal(resolveAssistantFileChangeStatus({ kind: 'add' }), 'untracked')
assert.equal(resolveAssistantFileChangeStatus({ kind: 'delete' }), 'deleted')
assert.equal(resolveAssistantFileChangeStatus({ kind: 'move' }), 'renamed')
assert.match(renderToStaticMarkup(createElement(AssistantFileChangeStatusPill, { status: 'modified' })), />M<\/span>/)
assert.match(renderToStaticMarkup(createElement(AssistantFileChangeStatusPill, { status: 'untracked' })), />U<\/span>/)
assert.match(renderToStaticMarkup(createElement(AssistantFileChangeStatusPill, { status: 'deleted' })), />D<\/span>/)
const newFileActivity = activity({ id: 'new-file-status', turnId: 'file-status', millisecond: 1690 })
newFileActivity.kind = 'file-change'
newFileActivity.summary = 'Edited file'
newFileActivity.detail = 'src/new-file.ts'
newFileActivity.payload = {
    category: 'file-change',
    status: 'completed',
    paths: ['src/new-file.ts'],
    createdPaths: ['src/new-file.ts'],
    changes: [{ path: 'src/new-file.ts', kind: 'add', isNew: true }],
    additions: 4,
    deletions: 2,
    startedAt: iso(200),
    completedAt: iso(1500),
    durationMs: 1300,
    authoritative: true
}
const newFileMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, { activity: newFileActivity }))
assert.equal(newFileMarkup.includes('Edited file'), false, 'file rows use path and Git-style status instead of a repeated action label')
assert.equal(newFileMarkup.includes('aria-label="New / untracked"'), true, 'new files use a U status pill')
assert.equal(newFileMarkup.indexOf('aria-label="New / untracked"') < newFileMarkup.indexOf('+4'), true, 'the status pill stays attached to the path before right-side metrics')
assert.equal(newFileMarkup.indexOf('+4') < newFileMarkup.indexOf('1.3s'), true, 'diff counts sit beside and before the far-right elapsed time')
const partialReadActivity = activity({ id: 'partial-read', turnId: 'read-presentation', millisecond: 1692 })
partialReadActivity.kind = 'file-read'
partialReadActivity.summary = 'Read file'
partialReadActivity.detail = 'src/large-file.ts'
partialReadActivity.payload = {
    status: 'completed',
    toolName: 'read',
    paths: ['src/large-file.ts'],
    output: `${Array.from({ length: 50 }, (_, index) => `line ${index + 51}`).join('\n')}\n\n[Showing lines 51-100 of 240. Use offset=101 to continue.]`,
    readStartLine: 51,
    readEndLine: 100,
    readLineCount: 50,
    readTotalLines: 240,
    readComplete: false,
    readTruncated: true,
    readIsImage: false,
    durationMs: 4
}
const partialReadMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, { activity: partialReadActivity }))
assert.equal(partialReadMarkup.includes('src/large-file.ts'), true, 'collapsed Read rows lead with the file path')
assert.equal(partialReadMarkup.includes('(line 51 to 100)'), true, 'partial Read rows put a plain parenthetical line range beside the path')
assert.equal(partialReadMarkup.includes('bg-sky-400/[0.04]'), false, 'Read line ranges are plain text rather than pills')
assert.match(partialReadMarkup, />Read<\/span>/, 'collapsed Read rows identify the operation instead of showing elapsed time')
assert.equal(partialReadMarkup.includes('4ms'), false, 'Read rows do not spend their quiet right edge on millisecond timing')
assert.equal(toolCardSource.includes('buildAssistantReadPreview(authoritativeRawOutput)'), true, 'expanded Read output uses the bounded specialized preview')
assert.equal(toolCardSource.includes('Showing first ${readPreview.displayedLines} of ${readPreview.totalReadLines} lines returned by Read.'), true, 'expanded long reads explain the 50-line presentation cap')
const deferredReadActivity = activity({ id: 'deferred-read', turnId: 'read-presentation', millisecond: 1693 })
deferredReadActivity.kind = 'file-read'
deferredReadActivity.summary = 'Read file'
deferredReadActivity.detail = 'src/deferred.ts'
deferredReadActivity.payload = {
    status: 'completed',
    toolName: 'read',
    paths: ['src/deferred.ts'],
    historyBodyRef: {
        version: 1,
        canonicalChatId: 'canonical:test',
        entryIndex: 10,
        entryId: 'entry:deferred',
        entrySha256: 'a'.repeat(64),
        toolCallId: 'tool:deferred',
        toolName: 'read',
        bodyBytes: 500_000,
        contentTypes: ['text'],
        imageCount: 0
    }
}
const deferredReadMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, { activity: deferredReadActivity }))
assert.equal(deferredReadMarkup.includes('src/deferred.ts'), true, 'deferred reads retain their compact metadata row')
assert.equal(deferredReadMarkup.includes('data-state="closed"'), true, 'deferred bodies stay closed until the user asks for them')
assert.equal(deferredReadMarkup.includes('no output'), false, 'a deferred body is not mislabeled as an empty tool result')
assert.equal(toolCardSource.includes('assistant.hydrateHistoryBody'), true, 'expanding a deferred tool card requests its canonical body on demand')
assert.equal(toolCardSource.includes('Loading historical output…'), true, 'deferred tool expansion has an explicit loading state')
assert.equal(toolCardSource.includes('bg-sky-400 shadow-'), false, 'new-file blue dots are removed')
assert.equal(toolCardSource.includes('TimelineEditedFileRow'), false, 'expanded file changes do not add a duplicate file row')
assert.equal(toolCardSource.includes('Diff preview'), false, 'expanded file changes do not add a wrapper heading above the native diff header')
assert.equal(toolCardSource.includes("'relative mt-1 h-60 min-h-0 overflow-hidden'"), true, 'expanded file changes use a tight bounded diff viewport')
assert.equal(toolCardSource.includes('<AssistantInlineDiffPreview'), true, 'timeline cards use the lightweight inline diff instead of the rich sidebar renderer')
assert.equal(toolCardSource.includes('LazyPatchDiffViewer'), false, 'timeline cards do not load the worker-backed rich diff renderer')
assert.equal(toolCardSource.includes("duration={activity.kind === 'file-change' ? 220 : 240}"), true, 'inline diffs retain a short expand and collapse animation')
assert.equal(toolCardSource.includes("crispContent={activity.kind === 'file-change'}"), true, 'file diffs request the crisp disclosure path')
assert.equal(animatedHeightSource.includes("'grid transition-[grid-template-rows] ease-[cubic-bezier(0.2,0.8,0.2,1)]"), true, 'crisp disclosures animate grid height without opacity or transforms')
assert.equal(animatedHeightSource.includes('inert={!isOpen ? true : undefined}'), true, 'closed disclosures remove hidden controls from keyboard navigation')
assert.match(toolCallListSource, /setExpanded\(false\)[\s\S]{0,260}setOlderMounted\(false\)/, 'older tool cards unmount after their closing animation')
assert.equal(toolCardSource.includes('className="shrink-0 font-mono text-[9px]'), true, 'file elapsed time no longer reserves an oversized fixed-width gap')
assert.equal(inlineDiffPreviewSource.includes('MAX_INLINE_DIFF_ROWS = 100'), true, 'inline diff DOM work is capped at 100 lines')
assert.equal(inlineDiffPreviewSource.includes("[text-rendering:auto] [-webkit-font-smoothing:auto]"), true, 'inline diff text uses native crisp rendering')
assert.equal(inlineDiffPreviewSource.includes('@pierre/diffs'), false, 'inline diff has no rich-renderer dependency')
assert.equal(inlineDiffPreviewSource.includes("lazy(() => import('./AssistantInlineDiffSyntax')"), true, 'syntax grammars load only when an inline preview opens')
assert.equal(inlineDiffPreviewSource.includes('More lines — open full diff'), true, 'the truncation row opens the full sidebar diff')
assert.equal(inlineDiffSyntaxSource.includes('PrismLight as SyntaxHighlighter'), true, 'capped inline rows retain syntax highlighting')
assert.equal(inlineDiffSyntaxSource.includes("textShadow: 'none'"), true, 'syntax tokens explicitly remove theme text shadows')
const inlineDiffMarkup = renderToStaticMarkup(createElement(AssistantInlineDiffPreview, {
    patch: 'diff --git a/src/new-file.ts b/src/new-file.ts\n--- a/src/new-file.ts\n+++ b/src/new-file.ts\n@@ -1 +1 @@\n-old\n+new',
    displayPath: 'src/new-file.ts',
    additions: 1,
    deletions: 1,
    onOpenFullDiff: () => undefined
}))
assert.equal(inlineDiffMarkup.includes('src/new-file.ts'), true, 'inline diff keeps its compact file header')
assert.equal(inlineDiffMarkup.includes('Open full diff for src/new-file.ts in side panel'), true, 'inline diff keeps the sidebar action beside its counts')
assert.equal(inlineDiffMarkup.includes('&gt;+1&lt;'), false, 'inline diff count text is rendered as ordinary text rather than serialized markup')
assert.match(inlineDiffMarkup, />\+1<\/span>/)
assert.match(inlineDiffMarkup, />-1<\/span>/)
assert.equal(toolCardSource.includes('commandTimestamp'), false, 'collapsed command rows do not expose calendar date or time')
assert.equal(toolCardSource.includes('formatAssistantDateTime(activityStartedAt)'), true, 'expanded command details show the real command start timestamp')
assert.equal(toolCardSource.includes("window.setInterval(() => setNowIso(new Date().toISOString()), 1000)"), true, 'running command cards refresh elapsed time once per second')
assert.equal(toolCardSource.includes("'shrink-0 text-right font-mono text-[9px] tabular-nums transition-colors'"), true, 'command durations stay right-aligned and tabular in both chat displays')
assert.equal(toolCardSource.includes("minimal ? 'w-auto' : 'w-14'"), true, 'Detailed keeps the fixed duration column while Minimal uses compact intrinsic width')
assert.equal(toolCardSource.includes("'text-sparkle-text-muted group-hover:text-sparkle-text-secondary'"), true, 'completed command durations stay visually quiet until row hover')
assert.equal(toolCardSource.includes("{elapsed || ''}"), true, 'commands without timing data still reserve the duration column')
assert.equal(toolCardSource.includes('inline-flex w-4 shrink-0 items-center justify-center'), true, 'every tool row reserves the same trailing chevron endpoint')
assert.equal(
    toolCardSource.indexOf('{completedWithoutOutput ? (') < toolCardSource.indexOf('{isRead ? ('),
    true,
    'variable status badges stay before the final operation/status column instead of shifting its endpoint'
)

const waitingCommand = activity({ id: 'waiting-command', turnId: 'terminal-details', millisecond: 1730 })
waitingCommand.detail = 'npm test'
waitingCommand.payload = { command: 'npm test', toolName: 'bash', status: 'running' }
const waitingCommandMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, {
    activity: waitingCommand,
    runningCommandCount: 1
}))
assert.equal(waitingCommandMarkup.includes('waiting for output...'), true)
const minimizedWaitingCommandMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, {
    activity: waitingCommand,
    runningCommandCount: 1,
    toolOutputDefaultMode: 'minimized'
}))
assert.equal(minimizedWaitingCommandMarkup.includes('data-state="closed"'), true, 'Minimized live tool output keeps running tools closed')
assert.equal(
    waitingCommandMarkup.includes('>bash</p>'),
    false,
    'command tool names must not consume a standalone line beneath terminal output'
)

const runningRawTool = activity({ id: 'running-raw-tool', turnId: 'terminal-details', millisecond: 1740 })
runningRawTool.kind = 'tool'
runningRawTool.summary = 'Running raw tool'
runningRawTool.detail = 'custom_tool'
runningRawTool.payload = { toolName: 'custom_tool', output: 'raw non-command output remains visible', status: 'running' }
const runningRawToolMarkup = renderToStaticMarkup(createElement(TimelineToolCallCard, {
    activity: runningRawTool,
    runningCommandCount: 1
}))
assert.equal(
    runningRawToolMarkup.includes('raw non-command output remains visible'),
    true,
    'raw non-command tool output stays inside its terminal output body'
)

const modelNotice = activity({ id: 'usage-notice', turnId: 'notice-turn', millisecond: 1750, tone: 'warning' })
modelNotice.kind = 'model.notice'
modelNotice.payload = { category: 'model-notice', noticeKind: 'usage-limit', model: 'gpt-5.5' }
assert.equal(isModelNoticeActivity(modelNotice), true)

assert.equal(COLLAPSED_TOOL_CALL_COUNT, 5)
const tenToolActivities = Array.from({ length: 10 }, (_, index) => activity({
    id: `collapsed-tool-${index + 1}`,
    turnId: 'collapsed-tools',
    millisecond: 1800 + index
}))
const collapsedToolsMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: tenToolActivities }))
assert.equal(collapsedToolsMarkup.includes('Show all 10'), true, 'tool batches over five expose the DevScope-style expansion control')
assert.equal(collapsedToolsMarkup.includes('data-state="closed"'), true, 'older tool calls remain mounted inside the collapsed animated section')

const timelineRowsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineRows.tsx', import.meta.url), 'utf8')
assert.equal(timelineRowsSource.includes('Loading chat...'), true)
assert.equal(timelineRowsSource.includes('h-full min-h-0'), true, 'chat loading state fills the conversation viewport before centering')
assert.equal(timelineRowsSource.includes("'mt-2 flex items-center justify-between gap-3 px-1 transition-opacity'"), true, 'user message metadata keeps a stable action row')
assert.equal(timelineRowsSource.includes("minimal ? 'opacity-0 focus-within:opacity-100 group-hover/user-message:opacity-100' : 'opacity-100'"), true, 'Detailed keeps metadata visible while Minimal reveals it on hover or keyboard focus')
assert.equal(timelineRowsSource.includes('statusTextRef.current.textContent = formatWorkingIndicatorStatus'), true, 'the standalone working timer updates without a once-per-second React commit')

const conversationTimelinePaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationTimelinePane.tsx', import.meta.url), 'utf8')
const mountedVirtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const conversationPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
assert.equal(mountedVirtualTimelineSource.includes('className="assistant-chat-scrollbar h-full w-full overflow-x-hidden [overflow-anchor:none]"'), true, 'the virtual chat viewport owns the dedicated thin scrollbar without a detached rail')
assert.equal(mountedVirtualTimelineSource.includes('AssistantVirtualTimelineMinimap'), false, 'the minimap stays out of the mounted chat path while scrolling is being tuned')
assert.equal(conversationTimelinePaneSource.includes('timelineRailHostRef'), false, 'the hidden minimap does not leave a portal host or resize observer mounted')
assert.equal(conversationPaneSource.includes('suppressMinimap='), false, 'the conversation no longer carries dead minimap visibility state')
assert.equal(mountedVirtualTimelineSource.includes('[overflow-anchor:none]'), true, 'older-message prepends use LegendList anchoring instead of browser scroll anchoring')

const chatSessionsRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
assert.equal(chatSessionsRailSource.includes('resolveAssistantThreadStatusPill('), true, 'the mounted chat sidebar derives tags from real thread phase state')
assert.equal(chatSessionsRailSource.includes("'inline-flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5"), true, 'actionable chat states render as compact pills')
assert.equal(chatSessionsRailSource.includes('inline-flex shrink-0 items-center gap-1.5'), true, 'the status pill and time form one closely spaced metadata group')
assert.equal(chatSessionsRailSource.includes('mr-0.5 w-8 shrink-0 text-right text-[11px]'), false, 'the time uses its natural width instead of preserving an invisible gap before its text')
assert.equal(
    chatSessionsRailSource.indexOf('<span>{statusPill.label}</span>') < chatSessionsRailSource.lastIndexOf('{timeLabel}'),
    true,
    'the status pill sits immediately before the chat time'
)
assert.equal(chatSessionsRailSource.includes('{busy ? ('), false, 'the mounted sidebar no longer uses a detached left busy dot')
assert.equal(chatSessionsRailSource.includes('.sort(compareSessionsByCreatedAtDescending)'), true, 'chat ranking uses session creation time instead of mutable activity time')
assert.equal(chatSessionsRailSource.includes('right.newestCreatedAt) - getSortableTimestamp(left.newestCreatedAt)'), true, 'project groups rank by their newest-created chat')
assert.equal(
    chatSessionsRailSource.includes('.sort((left, right) => getSortableTimestamp(getSessionLastActivityAt(right))'),
    false,
    'new messages and background activity cannot reshuffle the chat list'
)

const markdownRendererSource = readFileSync(new URL('../src/renderer/src/components/ui/MarkdownRenderer.tsx', import.meta.url), 'utf8')
assert.equal(markdownRendererSource.includes('const compiledMarkdown = new Map'), true, 'completed Markdown survives virtual-row remounts in a bounded compiled cache')
assert.equal(markdownRendererSource.includes('window.requestIdleCallback(drainMarkdownPreparation)'), true, 'newly loaded history prewarms immutable Markdown outside the scrolling hot path')
assert.equal(markdownRendererSource.includes('MAX_COMPILED_ENTRIES = 192'), true, 'the compiled Markdown cache has a tighter explicit retention bound')
assert.equal(timelineSource.includes('ASSISTANT_MARKDOWN_PREWARM_MAX_LENGTH = 32_000'), true, 'idle Markdown prewarming skips large chat-entry bodies')
assert.equal(timelineSource.includes('prewarmCodeBlocks: false'), true, 'chat-entry prewarming leaves syntax highlighting to visible code blocks')
assert.equal(mountedVirtualTimelineSource.includes('markAssistantTimelineMotion'), false, 'scrolling does not downgrade or delay formatted Markdown')

const assistantPageHelpersSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPageHelpers.tsx', import.meta.url), 'utf8')
assert.equal(assistantPageHelpersSource.includes('return createPortal('), true, 'error details render outside the chat rail')
assert.equal(assistantPageHelpersSource.includes('fixed inset-0 z-[2147482000]'), true, 'error details use an app-level modal backdrop')
assert.equal(assistantPageHelpersSource.includes('aria-modal="true"'), true, 'error details expose modal semantics')

const hiddenThoughtActivity = activity({ id: 'thought-motion', turnId: 'thought-turn', millisecond: 1760, internal: true })
hiddenThoughtActivity.detail = '**Planning quietly**\n\nA secondary thought body.'
hiddenThoughtActivity.payload = { ...hiddenThoughtActivity.payload, output: hiddenThoughtActivity.detail }
const secondHiddenThoughtActivity = activity({ id: 'thought-motion-two', turnId: 'thought-turn', millisecond: 1775, internal: true })
const visibleCheckpoint: AssistantActivity = {
    ...commandCheckpoint,
    id: 'thought-checkpoint',
    turnId: 'thought-turn',
    createdAt: iso(1768),
    payload: {
        ...commandCheckpoint.payload,
        jobId: 'cmd-thought',
        args: { action: 'status', jobId: 'cmd-thought' },
        status: 'completed'
    }
}
const entriesWithoutThoughts = getTimelineEntries([], [secondHiddenThoughtActivity, visibleCheckpoint, hiddenThoughtActivity])
assert.deepEqual(
    entriesWithoutThoughts.map((entry) => entry.type === 'activity' ? entry.activity.id : entry.id),
    ['thought-checkpoint'],
    'internal thoughts never create chat rows or absorb an adjacent command checkpoint'
)
const rowsWithoutThoughts = buildTimelineRows(entriesWithoutThoughts, false, null)
assert.equal(rowsWithoutThoughts.length, 1)
assert.equal(
    rowsWithoutThoughts[0]?.kind === 'activity' ? rowsWithoutThoughts[0].activity.id : null,
    'thought-checkpoint',
    'the visible command checkpoint remains available after thought rows are removed'
)

const crossTypeSameTimeEntries = getTimelineEntries(
    [
        message({ id: 'same-time-progress', role: 'assistant', turnId: 'same-time-cross-type', millisecond: 1800, timelineSequence: 100, text: 'Starting.' }),
        message({ id: 'same-time-final', role: 'assistant', turnId: 'same-time-cross-type', millisecond: 1800, timelineSequence: 300, text: '## Finished' })
    ],
    [activity({ id: 'same-time-tool', turnId: 'same-time-cross-type', millisecond: 1800, timelineSequence: 200 })]
)
assert.deepEqual(
    crossTypeSameTimeEntries.map((entry) => entry.type === 'message' ? entry.message.id : entry.type === 'activity' ? entry.activity.id : entry.id),
    ['same-time-progress', 'same-time-tool', 'same-time-final'],
    'shared causal sequence must order messages and tool activity when timestamps are identical'
)

const exactMarkdown = '    indented code\n\n\n\nnext\n'
assert.equal(
    stripProposedPlanBlocks(exactMarkdown),
    exactMarkdown,
    'assistant Markdown without a proposed-plan control block must remain byte-for-byte unchanged'
)

console.log('DevScope-style activity timeline contract: ok')
