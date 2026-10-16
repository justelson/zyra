import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { createDefaultSnapshot } from '../src/main/assistant/projector'
import type { AssistantActivity, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'

const root = mkdtempSync(join(tmpdir(), 'zyra-compaction-restart-'))
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: console.error, debug: noop } }))
mock.module('electron', () => ({
    app: { getPath: () => join(root, 'profile'), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] }; static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
ZyraRuntime.prototype.listCanonicalChats = async () => []
ZyraRuntime.prototype.readCanonicalChatHistory = async () => null
ZyraRuntime.prototype.prewarm = async () => []
let activeCompactions: Array<{ sequence: number; occurredAt?: string }> = []
const connected = new Set<string>()
ZyraRuntime.prototype.hasSession = id => connected.has(id)
ZyraRuntime.prototype.connect = async function(thread) {
    connected.add(thread.providerThreadId || thread.id)
    this.emit('runtime', { eventId: 'fixture-attachment', type: 'thread.started', createdAt: '2026-10-01T01:00:00Z', threadId: thread.id,
        payload: { providerThreadId: thread.providerThreadId, state: 'ready', activeCompactions } })
}
const { AssistantService } = await import('../src/main/assistant/service')
const { applyAssistantDomainEvent } = await import('../src/shared/assistant/projector')
const { hasActiveAssistantCompaction } = await import('../src/shared/assistant/compaction-state')
const createdAt = '2026-10-01T00:00:00Z'
const stale: AssistantActivity = { id: 'persisted-start', kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTING', turnId: 'old-turn', createdAt,
    payload: { status: 'running', sourceSequence: 50, startedSequence: 50 } }
const canonical: AssistantActivity = { id: 'shared-activity:completed', kind: 'context-compaction', tone: 'info', summary: 'Context compacted', turnId: 'canonical-turn', createdAt,
    payload: { canonicalEntry: { type: 'compaction', firstKeptEntryId: 'kept-entry', tokensBefore: 4000 } } }
const timedLegacy: AssistantActivity = { ...stale, id: 'timed-legacy', summary: 'AUTO-COMPACTED', payload: { status: 'completed', completedAt: createdAt, firstKeptEntryId: 'legacy-kept', tokensBefore: 6000 } }
const thread: AssistantThread = {
    id: 'local-thread', providerThreadId: 'canonical-thread', source: 'root', parentThreadId: null, providerParentThreadId: null, subagentDepth: null,
    agentNickname: null, agentRole: null, model: 'fixture/model', cwd: root, messageCount: 2, lastSeenCompletedTurnId: null,
    runtimeMode: 'full-access', interactionMode: 'default', state: 'ready', lastError: null, createdAt, updatedAt: createdAt, latestTurn: null, activePlan: null,
    messages: [{ id: 'prior-user', role: 'user', text: 'Preserve this message.', turnId: 'visible-turn', streaming: false, createdAt: '2026-09-30T23:59:00Z', updatedAt: '2026-09-30T23:59:00Z' }, { id: 'current-user', role: 'user', text: 'Current fixture request.', turnId: 'current-request', streaming: false, createdAt: '2026-09-30T23:59:30Z', updatedAt: '2026-09-30T23:59:30Z' }],
    activities: [stale, canonical, timedLegacy, { ...stale, id: 'duplicate-completed-start', turnId: 'duplicate-turn', payload: { status: 'running', sourceSequence: 70, startedSequence: 70 } }, { ...stale, id: 'current-start', turnId: 'current-turn', createdAt: '2026-10-01T00:59:00Z', payload: { status: 'running', sourceSequence: 80, startedSequence: 80 } }], proposedPlans: [], pendingApprovals: [], pendingUserInputs: []
}
const session: AssistantSession = { id: 'session', title: 'Compaction fixture', mode: 'work', projectPath: null, playgroundLabId: null, pendingLabRequest: null,
    archived: false, createdAt, updatedAt: createdAt, activeThreadId: thread.id, threadIds: [thread.id], threads: [thread] }
const snapshot = createDefaultSnapshot()
snapshot.sessions = [session]
let service: InstanceType<typeof AssistantService> | null = null
try {
    service = new AssistantService()
    await service.getSnapshot()
    ;(service as any).state.snapshot = snapshot
    ;(service as any).persistence.replaceSnapshot(snapshot)
    await (service as any).persistence.flush()
    await service.dispose()
    for (let visit = 0; visit < 3; visit++) {
        connected.clear()
        service = new AssistantService()
        await service.getSnapshot()
        const coldSession = (service as any).state.snapshot.sessions[0]
        const coldThread = coldSession.threads[0]
        assert.equal((await (service as any).persistence.readCompactionActivities("foreign' OR 1=1--")).length, 0, 'saved lookup is bound to the exact owning thread')
        assert.equal(coldThread.activities.length, 0, 'startup uses the real activity-free shell')
        const { page } = await (service as any).persistence.readHistoryAroundMessage({ threadId: thread.id, messageId: 'prior-user', turnLimit: 1 })
        let renderer = structuredClone((service as any).state.snapshot)
        renderer.sessions[0].threads[0].messages = page.messages
        renderer.sessions[0].threads[0].activities = page.activities
        assert.equal(page.activities.length, 0, 'the actual bounded page contains only the selected older message turn')
        const activityCount = renderer.sessions[0].threads[0].activityCount
        const firstEvent = (service as any).state.events.length
        activeCompactions = visit === 0 ? [{ sequence: 80 }] : []
        await (service as any).connectSessionRuntime(coldSession, coldThread)
        for (const event of (service as any).state.events.slice(firstEvent)) renderer = applyAssistantDomainEvent(renderer, event)
        assert.equal(renderer.sessions[0].threads[0].activities.length, 0, 'reconciliation cannot inject off-page compactions into a bounded renderer page')
        assert.equal(renderer.sessions[0].threads[0].activityCount, activityCount, 'already-counted compactions do not inflate renderer totals')
        if (visit === 0) {
            await (service as any).persistence.flush()
            const active = (await service.getThreadDetailBootstrap(thread.id)).detail.history
            assert.equal(hasActiveAssistantCompaction(active.activities), true, 'authoritative active maintenance survives a cold attachment')
            activeCompactions = []
            await (service as any).connectSessionRuntime(coldSession, coldThread)
        }
        for (let replay = 0; replay < 4; replay++) {
            ;(service as any).runtime.emit('runtime', { eventId: `completed-replay-${visit}-${replay}`, type: 'activity', threadId: thread.id,
                createdAt, turnId: 'reopened-alias', payload: { activityId: `replay-${visit}-${replay}`, kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTED',
                    data: { replay: true, status: 'completed', sourceSequence: 71, startedSequence: 70, firstKeptEntryId: 'kept-entry', tokensBefore: 4000 } } })
        }
        ;(service as any).runtime.emit('runtime', { eventId: `legacy-end-only-${visit}`, type: 'activity', threadId: thread.id,
            createdAt: '2026-10-01T00:59:59Z', turnId: 'current-turn', payload: { activityId: `end-only-${visit}`, kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTED',
                data: { replay: true, status: 'completed', sourceSequence: 81, completedAt: '2026-10-01T00:59:59Z', firstKeptEntryId: 'current-kept', tokensBefore: 5000 } } })
        ;(service as any).runtime.emit('runtime', { eventId: `distinct-legacy-completion-${visit}`, type: 'activity', threadId: thread.id,
            createdAt: '2026-10-01T00:58:00Z', turnId: 'later-legacy-turn', payload: { activityId: `later-legacy-${visit}`, kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTED',
                data: { replay: true, status: 'completed', sourceSequence: 66, completedAt: '2026-10-01T00:58:00Z', firstKeptEntryId: 'legacy-kept', tokensBefore: 6000 } } })
        await (service as any).persistence.flush()
        const rows = (await service.getThreadDetailBootstrap(thread.id)).detail.history
        assert.equal(rows.activities.find((row: AssistantActivity) => row.id === stale.id)?.payload?.status, 'cancelled', 'cold attachment must settle the persisted orphan outside the resident shell')
        assert.equal(hasActiveAssistantCompaction(rows.activities), false, 'a saved orphan cannot indefinitely queue the next message')
        assert.equal(rows.activities.find((row: AssistantActivity) => row.id === canonical.id)?.kind, canonical.kind)
        const preserved = await (service as any).persistence.readTimelineProjectionRows(thread.id)
        assert.equal(preserved.messages.find((message: any) => message.id === 'prior-user')?.text, 'Preserve this message.')
        assert.equal(preserved.messages.length, 2, 'both original prompt turns remain in SQLite')
        assert.equal(rows.activities.length, 5)
        assert.equal(rows.activities.filter((row: AssistantActivity) => row.payload?.firstKeptEntryId === 'legacy-kept').length, 2, 'actual persisted history retains both known legacy completion times')
        assert.equal(rows.activities.find((row: AssistantActivity) => row.id === 'current-start')?.payload?.status, 'completed', 'end-only legacy replay updates the persisted start after early orphan recovery')
        await service.dispose()
    }
    console.log('Real service cold shells, native SQLite restart, compaction reconciliation and preserved history: ok')
} finally {
    await service?.dispose()
    rmSync(root, { recursive: true, force: true })
}
