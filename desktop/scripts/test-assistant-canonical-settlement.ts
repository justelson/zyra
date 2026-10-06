import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { mock } from 'bun:test'
import { CanonicalChatIndex } from '../../src/agent-server/chat-index.mjs'
import { getProjectSessionsDir } from '../../src/project-paths.mjs'
import { getSidebarSettlementActivityKey, isSidebarSettlementCurrent } from '../src/renderer/src/pages/assistant/assistant-sidebar-settlement'
import { materializeAssistantShellSnapshot } from '../src/renderer/src/lib/assistant/assistant-history-state'
import { recoverPersistedSnapshot } from '../src/main/assistant/projector'
import { createRunningLatestTurn } from '../src/main/assistant/service-records'

const root = mkdtempSync(join(tmpdir(), 'zyra-canonical-settlement-'))
const noop = () => undefined
mock.module('electron', () => ({
    app: { getPath: () => join(root, 'profile'), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] }; static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))

const project = join(root, 'project')
const sessionDirectory = getProjectSessionsDir(project)
mkdirSync(sessionDirectory, { recursive: true })
const sessionPath = join(sessionDirectory, 'past.jsonl')
const createdAt = '2026-08-01T12:00:00.000Z'
const entry = (id: string, role: string, content: unknown[], offset: number, extra = {}) => ({
    type: 'message', id, timestamp: new Date(Date.parse(createdAt) + offset).toISOString(),
    message: { id, role, timestamp: Date.parse(createdAt) + offset, content, ...extra }
})
const oldEntries = [
    { type: 'session', id: 'canonical-settlement-fixture', timestamp: createdAt, cwd: project },
    entry('user', 'user', [{ type: 'text', text: 'Inspect the fixture.' }], 0),
    entry('tool-call', 'assistant', [{ type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'fixture.txt' } }], 1000),
    entry('tool-result', 'toolResult', [{ type: 'text', text: 'Fixture contents.' }], 2000, { toolCallId: 'call', toolName: 'read' }),
    entry('answer', 'assistant', [{ type: 'text', text: 'Inspection complete.' }], 3000),
    { type: 'session_info', name: 'Past fixture' }
]
writeFileSync(sessionPath, oldEntries.map(value => JSON.stringify(value)).join('\n') + '\n')
writeFileSync(join(sessionDirectory, 'other.jsonl'), [
    { type: 'session', id: 'other-canonical-fixture', timestamp: createdAt, cwd: project },
    entry('other-user', 'user', [{ type: 'text', text: 'Inspect another fixture.' }], 0),
    entry('other-answer', 'assistant', [{ type: 'text', text: 'Other inspection complete.' }], 1000),
    { type: 'session_info', name: 'Other fixture' }
].map(value => JSON.stringify(value)).join('\n') + '\n')
const index = new CanonicalChatIndex({ stateDirectory: join(root, 'state') })
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
let heldHistoryRead: { started: () => void; release: Promise<void> } | null = null
ZyraRuntime.prototype.listCanonicalChats = () => index.listProjects([project])
ZyraRuntime.prototype.readCanonicalChatHistory = async (id, _project, options = {}) => {
    const history = index.history(id, options)
    const held = heldHistoryRead
    heldHistoryRead = null
    if (held) {
        held.started()
        await held.release
    }
    return history
}
ZyraRuntime.prototype.prewarm = async () => []
const { AssistantService } = await import('../src/main/assistant/service')
const service = new AssistantService()
try {
    const catalogSnapshot = materializeAssistantShellSnapshot(await service.getSnapshot())
    const past = catalogSnapshot.sessions.find(session => session.threads.some(thread => thread.providerThreadId === 'canonical-settlement-fixture'))!
    const other = catalogSnapshot.sessions.find(session => session.id !== past.id)!
    const threadId = past.activeThreadId!
    const catalogCount = past.threads[0].messageCount
    assert.equal(catalogCount, 3, 'The real canonical index counts the user, tool-call assistant and final assistant records')
    await service.getThreadDetailBootstrap(threadId)
    const focused = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!
    const override = { state: 'settled' as const, activityAt: focused.updatedAt, activityKey: getSidebarSettlementActivityKey(focused) }
    const hydrated = await (service as any).persistence.hydrateSelectedSession(catalogSnapshot, past.id)
    const switched = await (service as any).persistence.hydrateSelectedSession({ ...catalogSnapshot, selectedSessionId: other.id }, other.id)
    await (service as any).importCanonicalChats()
    const refreshed = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!
    console.log(JSON.stringify({
        catalogCount, afterHistoricalProjection: focused.threads[0].messageCount,
        afterPersistedHydration: hydrated.sessions.find((session: any) => session.id === past.id).threads[0].messageCount,
        afterOtherSelection: switched.sessions.find((session: any) => session.id === past.id).threads[0].messageCount,
        afterUnchangedCatalogRefresh: refreshed.threads[0].messageCount,
        settlementSurvives: isSidebarSettlementCurrent(refreshed, override),
        latestTurnUnchanged: JSON.stringify(focused.threads[0].latestTurn) === JSON.stringify(refreshed.threads[0].latestTurn)
    }))
    assert.equal(focused.threads[0].messageCount, catalogCount, 'Projecting unchanged historical records must preserve authoritative catalog count')
    assert.equal(hydrated.sessions.find((session: any) => session.id === past.id).threads[0].messageCount, catalogCount, 'Hydration must not replace catalog metadata with loaded row count')
    assert.equal(switched.sessions.find((session: any) => session.id === past.id).threads[0].messageCount, catalogCount, 'Selecting a different persisted chat preserves the settled chat metadata')
    assert.equal(isSidebarSettlementCurrent(refreshed, override), true, 'Unchanged catalog refresh must preserve a manually settled past chat')

    // A fresh attachment may request history before its next catalog import.
    const pendingAttachment = (service as any).state.snapshot.sessions.find((session: any) => session.id === past.id).threads[0]
    pendingAttachment.messageCount = 0
    ;(service as any).markCanonicalHistoryDirty('canonical-settlement-fixture')
    const bootstrap = await service.getThreadDetailBootstrap(threadId)
    const attached = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!
    assert.equal(attached.threads[0].messageCount, catalogCount, 'History response catalog metadata populates a fresh attachment without waiting for catalog import')
    const legacySnapshot = materializeAssistantShellSnapshot(await service.getSnapshot())
    const legacyThread = legacySnapshot.sessions.find(session => session.id === past.id)!.threads[0]
    legacyThread.messages = bootstrap.detail.history.messages
    legacyThread.messageCount = undefined as unknown as number
    assert.equal(recoverPersistedSnapshot(legacySnapshot).sessions.find(session => session.id === past.id)!.threads[0].messageCount,
        bootstrap.detail.history.messages.length, 'Legacy restore still derives a missing count from loaded messages')
    appendFileSync(sessionPath, [
        entry('next-user', 'user', [{ type: 'text', text: 'Inspect the next fixture.' }], 4000),
        entry('next-answer', 'assistant', [{ type: 'text', text: 'Next inspection complete.' }], 5000)
    ].map(value => JSON.stringify(value)).join('\n') + '\n')
    await (service as any).importCanonicalChats()
    const updated = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!
    assert.equal(updated.threads[0].messageCount, catalogCount + 2)
    assert.equal(isSidebarSettlementCurrent(updated, override), false, 'Genuinely appended messages still revive a settled chat')

    // Capture the old real index response, then project a new local prompt before
    // releasing it. Its count must not replace the active turn's newer count.
    let releaseHistory!: () => void
    let historyStarted!: () => void
    const started = new Promise<void>(resolve => { historyStarted = resolve })
    heldHistoryRead = { started: historyStarted, release: new Promise<void>(resolve => { releaseHistory = resolve }) }
    ;(service as any).markCanonicalHistoryDirty('canonical-settlement-fixture')
    const deferredBootstrap = service.getThreadDetailBootstrap(threadId)
    try {
        await started
        const promptAt = new Date(Date.parse(createdAt) + 6000).toISOString()
        ;(service as any).appendEvent('thread.latest-turn.updated', promptAt, {
            threadId, latestTurn: createRunningLatestTurn('local-running-turn', promptAt)
        }, past.id, threadId)
        ;(service as any).appendEvent('thread.message.user', promptAt, {
            threadId, message: { id: 'assistant-message-new-local-prompt', role: 'user', text: 'A genuinely newer local prompt.',
                turnId: 'local-running-turn', streaming: false, createdAt: promptAt, updatedAt: promptAt }
        }, past.id, threadId)
        const activeCount = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!.threads[0].messageCount
        assert.equal(activeCount, catalogCount + 3, 'The normal message event increments the count while history is pending')
        releaseHistory()
        await deferredBootstrap
        const afterDeferred = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!.threads[0]
        assert.equal(afterDeferred.messageCount, activeCount, 'A deferred old history count cannot overwrite a newer active-turn count')
        ;(service as any).appendEvent('thread.latest-turn.updated', promptAt, {
            threadId, latestTurn: { ...afterDeferred.latestTurn, state: 'completed', completedAt: promptAt }
        }, past.id, threadId)
        ;(service as any).markCanonicalHistoryDirty('canonical-settlement-fixture')
        await service.getThreadDetailBootstrap(threadId)
        const terminal = (await service.getSnapshot()).sessions.find(session => session.id === past.id)!.threads[0]
        assert.equal(terminal.messageCount, catalogCount + 2, 'Completed chats still accept the lower authoritative count instead of retaining an active high-water mark')
    } finally {
        releaseHistory()
        await deferredBootstrap
    }
    console.log('Canonical catalog, persisted hydration and settlement continuity: ok')
} finally {
    try {
        await service.dispose()
    } finally {
        await index.closeModelBackfill()
        if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('zyra-canonical-settlement-')) throw new Error('Unexpected fixture cleanup path')
        rmSync(root, { recursive: true, force: true })
    }
}
