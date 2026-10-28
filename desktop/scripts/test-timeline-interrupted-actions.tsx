import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { AssistantActivity, AssistantMessage, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { TimelineToolCallList } from '../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { SettingsProvider } from '../src/renderer/src/lib/settings'

const renderToStaticMarkup = (node: ReactNode) => renderMarkup(createElement(SettingsProvider, null, node))
const createdAt = '2026-09-03T12:00:00.000Z'
function activity(input: Partial<AssistantActivity> & Pick<AssistantActivity, 'id' | 'kind'>): AssistantActivity {
    return { tone: 'tool', summary: input.kind, turnId: 'turn:work-v2', createdAt, ...input }
}
const userBoundary: AssistantMessage = {
    id: 'stop:user', role: 'user', text: 'Edit the file', turnId: 'turn:work-v2',
    streaming: false, createdAt, updatedAt: createdAt
}
const backgroundJob = activity({ id: 'background:1', kind: 'command', payload: { status: 'running', jobId: 'job:1' } })

const interruptedUsage: AssistantSessionTurnUsageEntry = {
    id: 'turn:work-v2', sessionId: 'session', threadId: 'thread', model: 'fixture',
    state: 'interrupted', requestedAt: createdAt, startedAt: createdAt,
    completedAt: '2026-09-03T12:01:00.000Z', assistantMessageId: null, usage: null,
    updatedAt: '2026-09-03T12:01:00.000Z'
}
for (const interruption of [
    { metadata: undefined, label: 'Interrupted' },
    { metadata: { kind: 'stopped', source: 'user' }, label: 'Stopped' },
    { metadata: { kind: 'stopped', source: 'agent' }, label: 'Stopped by another agent' }
]) {
    for (const layout of ['single', 'batch', 'background']) {
        const unfinished = activity({
            id: 'stop:edit', kind: 'file-change',
            payload: { toolName: 'edit', paths: ['src/app.ts'], status: 'running' }
        })
        const completed = activity({
            id: 'stop:completed', kind: 'file-change',
            payload: { toolName: 'edit', paths: ['src/done.ts'], status: 'completed' }
        })
        const actions = layout === 'single' ? [unfinished]
            : layout === 'batch' ? [completed, unfinished] : [unfinished, backgroundJob]
        const terminal = activity({
            id: 'stop:terminal', kind: 'error', tone: 'warning',
            turnTerminalOutcome: 'interrupted',
            payload: { status: 'cancelled', interruption: interruption.metadata }
        })
        const stoppedRows = groupTimelineRowsIntoWorkSummaries({
            rows: [
                { kind: 'message', id: userBoundary.id, createdAt, message: userBoundary },
                ...[...actions, terminal].map(item => ({ kind: 'activity' as const, id: item.id, createdAt, activity: item }))
            ],
            messages: [userBoundary], turnUsageById: new Map([[interruptedUsage.id, interruptedUsage]]),
            latestAssistantMessageId: null, latestTurnStartedAt: createdAt, isWorking: false
        })
        const stoppedWork = stoppedRows.find(row => row.kind === 'turn-work-summary')
        assert.ok(stoppedWork?.kind === 'turn-work-summary')
        assert.equal(stoppedWork.running, false)
        assert.equal(stoppedWork.outcome, 'interrupted')
        assert.equal(stoppedWork.interruptionLabel, interruption.label)
        const stoppedActions = stoppedWork.rows.flatMap(row => row.kind === 'activity'
            ? [row.activity] : 'activities' in row ? row.activities : [])
        assert.deepEqual(stoppedActions.map(item => item.id), actions.map(item => item.id))
        const stoppedEdit = stoppedActions.find(item => item.id === unfinished.id)!
        assert.equal(stoppedEdit.payload?.status, 'interrupted', `${layout}: interrupted turns settle unfinished edits`)
        assert.equal(stoppedEdit.payload?.completionSource, 'turn-boundary')
        assert.equal(stoppedEdit.payload?.completedAt, interruptedUsage.completedAt)
        assert.equal(unfinished.payload?.status, 'running', 'rendering does not mutate saved evidence')
        if (layout === 'batch') assert.equal(stoppedActions[0], completed, 'completed edits stay completed')
        if (layout === 'background') assert.equal(stoppedActions[1], backgroundJob, 'managed jobs retain their independent lifecycle')
        if (layout !== 'background') {
            const stoppedMarkup = renderToStaticMarkup(createElement(TimelineToolCallList, { activities: stoppedActions }))
            assert.doesNotMatch(stoppedMarkup, /animate-spin|assistant-title-shimmer/, 'stopped edits and their action batch no longer animate')
        }
    }
}

console.log('Interrupted timeline actions: settlement, labels, background jobs and rendered indicators: ok')
