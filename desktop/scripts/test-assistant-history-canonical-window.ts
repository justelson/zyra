import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mock } from 'bun:test'
import { withCanonicalAssistantHistoryAvailability } from '../src/main/assistant/canonical-history-availability'
import { parseAssistantCanonicalHistoryWindow } from '../src/main/assistant/canonical-history-window'
import { createAssistantDevelopmentChatFixtures } from '../src/main/assistant/development-chat-fixtures'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { replaceAssistantSnapshot, upsertAssistantCanonicalTimelineProjection } from '../src/main/assistant/persistence-write'
import { readAssistantHistoryPage, readAssistantThreadDetail } from '../src/main/assistant/persistence-history'

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
    let olderImports = 0
    service.persistence.readHistoryPage = async () => history
    service.loadOlderCanonicalHistory = async () => { olderImports++; throw new Error('Provider offline') }
    const savedPage = await service.getHistoryPage({ threadId: thread.id, before: 'requested-cursor' })
    assert.deepEqual(savedPage.page.messages, history.messages, 'locally saved history remains readable while the provider is offline')
    assert.equal(olderImports, 0, 'local paging does not fetch an unnecessary canonical page')
    const partialHistory = { ...history, messages: history.messages.filter(message => message.role !== 'user') }
    assert.ok(partialHistory.messages.length > 0)
    service.persistence.readHistoryPage = async () => partialHistory
    const partialOffline = await service.getHistoryPage({ threadId: thread.id, before: 'requested-cursor' })
    assert.deepEqual(partialOffline.page.messages, partialHistory.messages, 'a provider failure preserves the available partial local prefix')
    assert.equal(olderImports, 1, 'a mid-turn prefix requests its missing prompt boundary')
    service.loadOlderCanonicalHistory = async () => { olderImports++; service.persistence.readHistoryPage = async () => history }
    const completedPrefix = await service.getHistoryPage({ threadId: thread.id, before: 'requested-cursor' })
    assert.ok(completedPrefix.page.messages.some((message: { role: string }) => message.role === 'user'), 'an available canonical prefix restores the missing prompt before returning the page')
    assert.equal(olderImports, 2)

    // Reproduce the real SQL shape when the latest canonical import begins in
    // the middle of an earlier turn: older assistant/tool rows, missing prompt.
    const SQL = await initSqlJs()
    const partialDb = new SQL.Database()
    try {
        initializeAssistantPersistenceSchema(partialDb)
        const latestPrompt = thread.messages.findLast(message => message.role === 'user')!
        const partialThread = { ...thread, messages: thread.messages.filter(message => message.role !== 'user' || message.id === latestPrompt.id) }
        replaceAssistantSnapshot(partialDb, { ...snapshot, sessions: [{ ...session, threads: [partialThread] }] })
        const before = readAssistantThreadDetail(partialDb, thread.id).history.pageInfo.oldestCursor!
        const fragment = readAssistantHistoryPage(partialDb, { threadId: thread.id, before })
        assert.ok(fragment.messages.length > 0)
        assert.equal(fragment.messages.some(message => message.role === 'user'), false, 'SQL fallback can return a nonempty mid-turn prefix')
        service.persistence.readHistoryPage = async (input: { threadId: string; before?: string }) => readAssistantHistoryPage(partialDb, input)
        service.loadOlderCanonicalHistory = async () => {
            olderImports++
            upsertAssistantCanonicalTimelineProjection(partialDb, { threadId: thread.id, messages: thread.messages, activities: thread.activities })
        }
        const recovered = await service.getHistoryPage({ threadId: thread.id, before })
        assert.ok(recovered.page.messages.some((message: { role: string }) => message.role === 'user'), 'service completes a real partial SQL turn from canonical history before returning it')
        assert.equal(olderImports, 3)
    } finally { partialDb.close() }
    service.loadOlderCanonicalHistory = async () => { olderImports++; throw new Error('Provider offline') }
    service.persistence.readHistoryPage = async () => ({ ...history, messages: [] })
    await assert.rejects(() => service.getHistoryPage({ threadId: thread.id, before: 'requested-cursor' }), /Provider offline/, 'an unavailable uncached prefix still exposes a retryable error')
    assert.equal(olderImports, 4)
    assert.equal(withCanonicalAssistantHistoryAvailability(history, false), history, 'a complete canonical transcript keeps the ordinary fast path')
    assert.equal(withCanonicalAssistantHistoryAvailability({ ...history, pageInfo: { ...history.pageInfo, oldestCursor: null } }, true, 'requested-cursor').pageInfo.oldestCursor, 'requested-cursor', 'an empty filtered canonical page retains its continuation cursor')
    thread.canonicalHistoryEntryCount++
    service.canonicalHistoryState.clear()
    await service.ensureCanonicalHistoryLoaded(session, thread)
    assert.equal(imports, 1, 'a stale cursor revision is rebuilt from the canonical source')
    service.canonicalHistoryState.clear()
    service.persistence.readCanonicalHistoryWindow = async () => null
    await service.ensureCanonicalHistoryLoaded(session, thread)
    assert.equal(imports, 2, 'legacy databases without a saved cursor recover their prefix from the canonical source')
    await reopened.close()
    console.log('Canonical history: durable cold cursor, source availability, no redundant import, stale revision recovery: ok')
} finally {
    assert.equal(resolve(userDataPath).startsWith(resolve(tmpdir()) + '\\') || resolve(userDataPath).startsWith(resolve(tmpdir()) + '/'), true)
    rmSync(userDataPath, { recursive: true, force: true })
}
