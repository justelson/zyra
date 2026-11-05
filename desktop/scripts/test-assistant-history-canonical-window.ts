import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mock } from 'bun:test'
import { withCanonicalAssistantHistoryAvailability } from '../src/main/assistant/canonical-history-availability'
import { parseAssistantCanonicalHistoryWindow } from '../src/main/assistant/canonical-history-window'
import { createAssistantDevelopmentChatFixtures } from '../src/main/assistant/development-chat-fixtures'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'

const userDataPath = mkdtempSync(join(tmpdir(), 'zyra-history-window-'))
const noop = () => undefined
mock.module('electron', () => ({
    app: { getPath: () => userDataPath, isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))

try {
    const { AssistantService } = await import('../src/main/assistant/service')
    const { AssistantPersistence } = await import('../src/main/assistant/persistence')
    const { CanonicalHistoryRefreshTracker } = await import('../src/main/assistant/canonical-history-refresh-policy')
    const fixture = createAssistantDevelopmentChatFixtures({ cwd: 'C:/fixture', now: 1_800_000_000_000 })
    const session = fixture.sessions[0]!
    const thread = session.threads[0]!
    thread.providerThreadId = 'canonical-window-fixture'
    thread.canonicalHistoryModifiedAt = thread.updatedAt
    thread.canonicalHistoryEntryCount = 200
    const persistedWindow = { before: '160', hasOlder: true, modifiedAt: thread.updatedAt, entryCount: 200 }
    const persistence = new AssistantPersistence()
    const snapshot = { ...createDefaultAssistantSnapshot(), snapshotSequence: 2, sessions: [session], selectedSessionId: session.id }
    persistence.appendEvent({ sequence: 1, eventId: 'created', type: 'session.created', occurredAt: thread.createdAt, sessionId: session.id, payload: { session } }, { ...snapshot, snapshotSequence: 1 })
    persistence.appendEvent({ sequence: 2, eventId: 'imported', type: 'thread.updated', occurredAt: thread.updatedAt, sessionId: session.id, threadId: thread.id, payload: { threadId: thread.id, patch: { messages: thread.messages } } }, snapshot)
    await persistence.writeCanonicalHistoryWindow(thread.id, persistedWindow)
    assert.equal((persistence as any).pendingEvents.length, 0, 'import events commit before the durable continuation cursor')
    assert.equal(Number((persistence as any).requireDb().exec('SELECT COUNT(*) FROM assistant_messages WHERE thread_id = ?', [thread.id])[0]?.values?.[0]?.[0]), thread.messages.length, 'cursor advancement cannot precede its imported rows')
    assert.equal((await persistence.readThreadDetail(thread.id)).history.snapshotSequence, 2, 'history rows carry their exact persisted event watermark')
    assert.deepEqual(await persistence.readCanonicalHistoryWindow(thread.id), persistedWindow, 'canonical paging position uses the existing SQLite metadata store')
    await persistence.flush()
    await persistence.close()
    const reopened = new AssistantPersistence()
    assert.deepEqual(await reopened.readCanonicalHistoryWindow(thread.id), persistedWindow, 'cold process restart restores the unimported canonical prefix')
    assert.equal(parseAssistantCanonicalHistoryWindow({ ...persistedWindow, before: null }), null, 'an incomplete older cursor is never trusted')

    const history = { threadId: thread.id, snapshotSequence: 0, messages: thread.messages.slice(-2), activities: [], proposedPlans: [],
        pageInfo: { oldestCursor: 'local-oldest', newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 1 },
        initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: true }
    const service = Object.create(AssistantService.prototype) as any
    service.ensureReady = async () => undefined
    service.state = { snapshot: { sessions: [session] } }
    service.canonicalHistoryRefresh = new CanonicalHistoryRefreshTracker()
    service.canonicalHistoryState = new Map()
    service.canonicalHistoryLoadPromises = new Map()
    service.canonicalMessagePhaseRecovery = { recover: async (_thread: unknown, messages: unknown) => messages }
    service.getSessionRuntimeCwd = () => 'C:/fixture'
    let imports = 0
    service.loadCanonicalHistoryPage = async () => { imports++; return true }
    service.persistence = { readCanonicalHistoryWindow: (id: string) => reopened.readCanonicalHistoryWindow(id), readThreadDetail: async () => ({ threadId: thread.id, history: { ...history }, pendingApprovals: [], pendingUserInputs: [], activePlan: null }) }
    const result = await service.getThreadDetailBootstrap(thread.id)
    assert.equal(imports, 0, 'fresh persisted cursor recovery needs no provider/network history reread')
    assert.equal(result.detail.history.pageInfo.hasOlder, true, 'local exhaustion cannot hide canonical history')
    assert.equal(result.detail.history.fullyLoaded, false)
    assert.equal(service.canonicalHistoryState.get(thread.providerThreadId).before, '160')
    assert.equal(withCanonicalAssistantHistoryAvailability(history, false), history, 'a complete canonical transcript keeps the ordinary fast path')
    assert.equal(withCanonicalAssistantHistoryAvailability({ ...history, pageInfo: { ...history.pageInfo, oldestCursor: null } }, true, 'requested-cursor').pageInfo.oldestCursor, 'requested-cursor', 'an empty filtered canonical page retains its continuation cursor')
    thread.canonicalHistoryEntryCount++
    service.canonicalHistoryState.clear()
    await service.ensureCanonicalHistoryLoaded(session, thread)
    assert.equal(imports, 1, 'a stale cursor revision is rebuilt from the canonical source')
    await reopened.close()
    console.log('Canonical history: durable cold cursor, source availability, no redundant import, stale revision recovery: ok')
} finally {
    assert.equal(resolve(userDataPath).startsWith(resolve(tmpdir()) + '\\') || resolve(userDataPath).startsWith(resolve(tmpdir()) + '/'), true)
    rmSync(userDataPath, { recursive: true, force: true })
}
