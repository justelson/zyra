import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    deriveAssistantRuntimeStatus,
    type AssistantStoreState
} from '../src/renderer/src/lib/assistant/assistant-store-runtime'
import { selectAssistantStoreSession } from '../src/renderer/src/lib/assistant/assistant-store-session-selection'
import {
    applyCachedSessionSelection,
    cacheHydratedThreads,
    estimateAssistantTimelineCollectionsCharacters,
    hasCachedSessionSelection,
    HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS,
    HYDRATED_THREAD_CACHE_MAX_TIMELINE_RECORDS,
    type CachedHydratedThreadState
} from '../src/renderer/src/lib/assistant/session-hydration-cache'
import { resolveAssistantThreadStatusPill } from '../src/renderer/src/pages/assistant/assistant-sessions-rail-utils'
import {
    mergeAssistantShellSnapshot,
    shouldHideAssistantRowsForSelection
} from '../src/renderer/src/lib/assistant/assistant-history-state'
import { getAssistantThreadHydrationRevision } from '../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'
import {
    applyAssistantWarmSelection,
    prepareAssistantWarmSelection
} from '../src/renderer/src/lib/assistant/assistant-warm-selection'
import { AssistantStore } from '../src/renderer/src/lib/assistant/assistant-store-core'

function thread(id: string, messageText: string) {
    return {
        id,
        providerThreadId: null,
        source: 'main',
        parentThreadId: null,
        providerParentThreadId: null,
        subagentDepth: 0,
        agentNickname: null,
        agentRole: null,
        model: 'test-model',
        cwd: null,
        messageCount: 1,
        activityCount: 0,
        proposedPlanCount: 0,
        hasActivePlan: false,
        hasPendingApprovals: false,
        hasPendingUserInputs: false,
        lastSeenCompletedTurnId: null,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        state: 'idle',
        lastError: null,
        createdAt: '2026-07-24T10:00:00.000Z',
        updatedAt: '2026-07-24T10:00:00.000Z',
        latestTurn: null,
        activePlan: null,
        messages: [{
            id: `message-${id}`,
            threadId: id,
            turnId: null,
            role: 'user',
            text: messageText,
            createdAt: '2026-07-24T10:00:00.000Z',
            updatedAt: '2026-07-24T10:00:00.000Z',
            streaming: false
        }],
        proposedPlans: [],
        activities: [],
        pendingApprovals: [],
        pendingUserInputs: []
    }
}

function session(id: string) {
    const activeThread = thread(`thread-${id}`, `content-${id}`)
    return {
        id,
        title: `Chat ${id}`,
        mode: 'work',
        projectPath: null,
        playgroundLabId: null,
        pendingLabRequest: null,
        archived: false,
        createdAt: '2026-07-24T10:00:00.000Z',
        updatedAt: '2026-07-24T10:00:00.000Z',
        activeThreadId: activeThread.id,
        threads: [activeThread]
    }
}

const sessions = [session('a'), session('b'), session('c')]
let state = {
    snapshot: {
        selectedSessionId: 'a',
        sessions,
        knownModels: [],
        playground: { rootPath: null, labs: [] }
    },
    historyByThreadId: {},
    status: {
        available: true,
        connected: true,
        selectedSessionId: 'a',
        activeThreadId: 'thread-a',
        state: 'idle',
        reason: null
    },
    hydrating: false,
    hydrated: true,
    modelsLoading: false,
    commandPending: false,
    pendingCreateSessionInput: null,
    selectionHydrationKey: null,
    selectionTransitionKey: null,
    selectionRequestId: 0,
    selectionRequestSessionId: null,
    error: null
} as unknown as AssistantStoreState

const liveShell = {
    ...state.snapshot,
    selectedSessionId: 'b',
    sessions: state.snapshot.sessions.map((entry) => ({
        ...entry,
        threads: entry.threads.map(({ activePlan: _activePlan, messages: _messages, proposedPlans: _proposedPlans, activities: _activities, pendingApprovals: _pendingApprovals, pendingUserInputs: _pendingUserInputs, ...shell }) => (
            entry.id === 'b' ? { ...shell, model: 'live-model' } : shell
        ))
    }))
}
const mergedLiveShell = mergeAssistantShellSnapshot(state.snapshot, liveShell as any)
assert.equal(mergedLiveShell.sessions.find((entry) => entry.id === 'b')?.threads[0]?.model, 'live-model', 'fresh shell metadata replaces cached selected-thread configuration')
assert.equal(mergedLiveShell.sessions.find((entry) => entry.id === 'b')?.threads[0]?.messages[0]?.text, 'content-b', 'selected-thread rows remain available while canonical detail refreshes their overlapping newest range')
assert.equal(mergedLiveShell.sessions.find((entry) => entry.id === 'a')?.threads[0]?.messages[0]?.text, 'content-a', 'unselected hydrated rows remain available in the bounded cache')

const hydratedThreadCache = new Map<string, CachedHydratedThreadState>()
for (const selectedSession of sessions) {
    const activeThread = selectedSession.threads[0]
    hydratedThreadCache.set(activeThread.id, {
        sessionId: selectedSession.id,
        threadId: activeThread.id,
        revision: getAssistantThreadHydrationRevision(activeThread),
        activePlan: activeThread.activePlan,
        messages: activeThread.messages,
        proposedPlans: activeThread.proposedPlans,
        activities: activeThread.activities,
        pendingApprovals: activeThread.pendingApprovals,
        pendingUserInputs: activeThread.pendingUserInputs
    })
}

const retainedOnlyThread = sessions[1]!.threads[0]!
const retainedOnlyShell = {
    ...state.snapshot,
    sessions: state.snapshot.sessions.map((entry) => entry.id !== 'b' ? entry : {
        ...entry,
        threads: entry.threads.map((entryThread) => ({
            ...entryThread,
            messages: [],
            activities: [],
            proposedPlans: []
        }))
    })
}
const retainedOnlySelection = applyAssistantWarmSelection({
    snapshot: retainedOnlyShell,
    sessionId: 'b',
    threadId: retainedOnlyThread.id,
    hydratedThreadCache: new Map(),
    historyByThreadId: {
        [retainedOnlyThread.id]: {
            threadId: retainedOnlyThread.id,
            messages: retainedOnlyThread.messages,
            activities: retainedOnlyThread.activities,
            proposedPlans: retainedOnlyThread.proposedPlans,
            pageInfo: {
                oldestCursor: null,
                newestCursor: null,
                hasOlder: true,
                hasNewer: false,
                turnCount: 1
            },
            initialLoading: false,
            loadingOlder: false,
            loadingNewer: false,
            loadOlderError: null,
            loadNewerError: null,
            fullyLoaded: false,
            lastUsedAt: Date.now(),
            shellRevision: getAssistantThreadHydrationRevision(retainedOnlyThread)
        }
    }
})
assert.equal(
    retainedOnlySelection.sessions.find((entry) => entry.id === 'b')?.threads[0]?.messages[0]?.text,
    'content-b',
    'a revision-matched retained window is restored in the click task when the duplicate hydrated cache omitted the active chat'
)

const selectionCalls: string[] = []
const connectionCalls: string[] = []
const hydrationCalls: Array<{ sessionId: string; threadId: string | null; force: boolean; resetLoadedRange: boolean }> = []
const originalWindow = (globalThis as { window?: unknown }).window
;(globalThis as any).window = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0),
    devscope: {
        assistant: {
            selectSession: async (sessionId: string) => {
                selectionCalls.push(sessionId)
                return {
                    success: true as const,
                    sessionId,
                    snapshot: state.snapshot,
                    status: {
                        available: true,
                        connected: true,
                        selectedSessionId: sessionId,
                        activeThreadId: `thread-${sessionId}`,
                        state: 'ready' as const,
                        reason: null
                    }
                }
            },
            connect: async ({ sessionId }: { sessionId: string }) => {
                connectionCalls.push(sessionId)
                return { success: true as const, threadId: `thread-${sessionId}` }
            },
            getStatus: async () => ({
                available: true,
                connected: true,
                selectedSessionId: state.snapshot.selectedSessionId,
                activeThreadId: `thread-${state.snapshot.selectedSessionId}`,
                state: 'idle',
                reason: null
            })
        }
    }
}

function createContext() {
    return {
        state,
        hydratedThreadCache,
        getState: () => state,
        setState: (nextState: Partial<AssistantStoreState> | ((current: AssistantStoreState) => Partial<AssistantStoreState>)) => {
            const partial = typeof nextState === 'function' ? nextState(state) : nextState
            state = { ...state, ...partial }
        },
        requestSessionHydration: async (sessionId: string, threadId: string | null, options?: { force?: boolean; resetLoadedRange?: boolean }) => {
            hydrationCalls.push({ sessionId, threadId, force: options?.force === true, resetLoadedRange: options?.resetLoadedRange === true })
        },
        warmSessionConnection: (sessionId: string, threadId: string) => {
            connectionCalls.push(sessionId)
            state = {
                ...state,
                status: {
                    available: true,
                    connected: true,
                    selectedSessionId: sessionId,
                    activeThreadId: threadId,
                    state: 'idle',
                    reason: null
                }
            }
        }
    }
}

try {
    const mismatchedStatus = deriveAssistantRuntimeStatus(
        { ...state.snapshot, selectedSessionId: 'b' },
        { ...state.status, connected: true, selectedSessionId: 'a', activeThreadId: 'thread-a' }
    )
    assert.equal(mismatchedStatus.connected, false, 'connection state from the previous chat cannot leak into a newly selected chat')

    const originalSessions = state.snapshot.sessions
    const selectB = selectAssistantStoreSession(createContext(), 'b')
    assert.equal(state.snapshot.selectedSessionId, 'b', 'the target chat becomes selected in the click task')
    assert.equal(state.snapshot.sessions, originalSessions, 'the immediate shell switch does not clone or scan timeline collections')
    assert.equal(state.selectionTransitionKey, 'b:thread-b', 'a cached target stays in transition until canonical state and detail hydration converge')
    const switchingThread = state.snapshot.sessions.find((entry) => entry.id === 'b')!.threads[0]
    assert.equal(switchingThread.messages[0]?.text, 'content-b', 'cached target rows are available in the click task')
    assert.equal(shouldHideAssistantRowsForSelection({
        selectionTransitioning: true,
        selectionHydrating: false,
        thread: switchingThread
    }), false, 'a revision-matched cached chat is visible in the first switching frame')
    assert.equal(shouldHideAssistantRowsForSelection({
        selectionTransitioning: true,
        selectionHydrating: false,
        thread: { ...switchingThread, messages: [], activities: [], proposedPlans: [] }
    }), true, 'an uncached chat keeps the loading state until detail hydration supplies real rows')
    const switchingPill = resolveAssistantThreadStatusPill(switchingThread, true, undefined, {
        connecting: Boolean(state.commandPending && !['starting', 'running', 'waiting'].includes(switchingThread.state))
    })
    assert.notEqual(switchingPill?.label, 'Connecting', 'selecting an idle chat must not classify it as active work')
    assert.deepEqual(selectionCalls, [], 'authoritative selection waits one microtask so a same-task newer click can supersede it')
    await selectB
    assert.deepEqual(selectionCalls, ['b'], 'the selected chat is persisted after the shell transition')
    assert.deepEqual(connectionCalls, [], 'renderer selection does not start a second provider attachment outside the authoritative main-process handoff')
    assert.equal(state.status.connected, true, 'selection installs the authoritative status returned with the live shell instead of scheduling a duplicate reconnect')
    assert.deepEqual(hydrationCalls, [{ sessionId: 'b', threadId: 'thread-b', force: false, resetLoadedRange: false }], 'a revision-matched visible cache skips forced detail replacement')
    assert.equal(state.selectionTransitionKey, null, 'the shell transition clears only after canonical detail hydration finishes')

    selectionCalls.length = 0
    connectionCalls.length = 0
    hydrationCalls.length = 0
    state = {
        ...state,
        snapshot: { ...state.snapshot, selectedSessionId: 'a' },
        status: { ...state.status, selectedSessionId: 'a', activeThreadId: 'thread-a' }
    }
    const supersededB = selectAssistantStoreSession(createContext(), 'b')
    const latestC = selectAssistantStoreSession(createContext(), 'c')
    assert.equal(state.snapshot.selectedSessionId, 'c', 'a second click replaces the first selection immediately')
    await Promise.all([supersededB, latestC])
    assert.deepEqual(selectionCalls, ['c'], 'a superseded chat never reaches the authoritative selection IPC')
    assert.deepEqual(connectionCalls, [], 'rapid history navigation never starts renderer-owned provider sessions')
    assert.deepEqual(hydrationCalls, [{ sessionId: 'c', threadId: 'thread-c', force: false, resetLoadedRange: false }], 'only the newest chat validates its revision-matched visible cache')
    assert.equal(state.selectionRequestSessionId, null, 'the current selection request releases its event guard after completion')

    const raceSession = session('race')
    const raceThread = raceSession.threads[0]!
    let olderPageCalls = 0
    const olderPageTurnLimits: number[] = []
    let newerPageCalls = 0
    ;(globalThis as any).window.devscope.assistant.getHistoryPage = async (input: { before?: string; after?: string; turnLimit?: number }) => {
        if (input.after) newerPageCalls += 1
        else {
            olderPageCalls += 1
            olderPageTurnLimits.push(input.turnLimit || 0)
        }
        return {
            success: true as const,
            page: {
                threadId: raceThread.id,
                messages: [],
                activities: [],
                proposedPlans: [],
                pageInfo: {
                    oldestCursor: input.after || 'fixture-older-cursor',
                    newestCursor: input.after ? null : 'fixture-cursor',
                    hasOlder: true,
                    hasNewer: !input.after,
                    turnCount: 0
                }
            }
        }
    }
    const raceStore = new AssistantStore()
    const raceHydrationKey = `${raceSession.id}:${raceThread.id}`
    ;(raceStore as any).state = {
        ...state,
        snapshot: {
            ...state.snapshot,
            selectedSessionId: raceSession.id,
            sessions: [raceSession]
        },
        historyByThreadId: {
            [raceThread.id]: {
                threadId: raceThread.id,
                messages: raceThread.messages,
                activities: [],
                proposedPlans: [],
                pageInfo: { oldestCursor: 'fixture-cursor', newestCursor: null, hasOlder: true, hasNewer: false, turnCount: 1 },
                initialLoading: false,
                loadingOlder: false,
                loadingNewer: false,
                loadOlderError: null,
                loadNewerError: null,
                fullyLoaded: false,
                lastUsedAt: Date.now(),
                shellRevision: getAssistantThreadHydrationRevision(raceThread)
            }
        },
        selectionTransitionKey: raceHydrationKey,
        selectionHydrationKey: null
    }
    await raceStore.loadOlderHistory(raceThread.id)
    assert.equal(olderPageCalls, 0, 'a pending selection transition blocks an already-scheduled history prefetch')
    ;(raceStore as any).state = { ...(raceStore as any).state, selectionTransitionKey: null, selectionHydrationKey: raceHydrationKey }
    await raceStore.loadOlderHistory(raceThread.id)
    assert.equal(olderPageCalls, 0, 'newest-page hydration blocks an overlapping older-page request')
    ;(raceStore as any).state = { ...(raceStore as any).state, selectionHydrationKey: null }
    await raceStore.loadOlderHistory(raceThread.id, 2)
    assert.equal(olderPageCalls, 1, 'older history remains available after selection and newest-page hydration settle')
    assert.deepEqual(olderPageTurnLimits, [2], 'the scroll policy controls a bounded page size')
    await raceStore.loadOlderHistory(raceThread.id, 99)
    assert.equal(olderPageCalls, 2, 'fresh upward demand can continue immediately after the prior serial page settles')
    assert.deepEqual(olderPageTurnLimits, [2, 3], 'renderer requests are defensively capped at three turns')
    const newerHistory = (raceStore as any).state.historyByThreadId[raceThread.id]
    ;(raceStore as any).state = {
        ...(raceStore as any).state,
        historyByThreadId: {
            ...(raceStore as any).state.historyByThreadId,
            [raceThread.id]: {
                ...newerHistory,
                pageInfo: { ...newerHistory.pageInfo, newestCursor: 'fixture-newer-cursor', hasNewer: true }
            }
        }
    }
    await raceStore.loadNewerHistory(raceThread.id, 2)
    assert.equal(newerPageCalls, 1, 'a bounded older window can page back toward the latest turn')

    let releaseConcurrentPage!: () => void
    let concurrentPageCalls = 0
    ;(globalThis as any).window.devscope.assistant.getHistoryPage = async (input: { before?: string; after?: string }) => {
        concurrentPageCalls += 1
        await new Promise<void>((resolve) => { releaseConcurrentPage = resolve })
        return {
            success: true as const,
            page: {
                threadId: raceThread.id,
                messages: [], activities: [], proposedPlans: [],
                pageInfo: {
                    oldestCursor: input.before || 'fixture-oldest',
                    newestCursor: input.after || 'fixture-newest',
                    hasOlder: true, hasNewer: true, turnCount: 0
                }
            }
        }
    }
    const concurrentHistory = (raceStore as any).state.historyByThreadId[raceThread.id]
    ;(raceStore as any).state = {
        ...(raceStore as any).state,
        historyByThreadId: {
            ...(raceStore as any).state.historyByThreadId,
            [raceThread.id]: {
                ...concurrentHistory,
                pageInfo: {
                    ...concurrentHistory.pageInfo,
                    oldestCursor: 'fixture-concurrent-oldest',
                    newestCursor: 'fixture-concurrent-newest',
                    hasOlder: true,
                    hasNewer: true
                }
            }
        }
    }
    const concurrentOlder = raceStore.loadOlderHistory(raceThread.id, 1)
    const concurrentNewer = raceStore.loadNewerHistory(raceThread.id, 1)
    await Promise.resolve()
    assert.equal(concurrentPageCalls, 1, 'opposite directions share one cursor owner per thread')
    releaseConcurrentPage()
    await Promise.all([concurrentOlder, concurrentNewer])

    const hookSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-hooks.ts', import.meta.url), 'utf8')
    const pageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
    const coreSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
    const sessionSelectionSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-session-selection.ts', import.meta.url), 'utf8')
    const hydrationCacheSource = readFileSync(new URL('../src/renderer/src/lib/assistant/session-hydration-cache.ts', import.meta.url), 'utf8')
    const agentInboxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx', import.meta.url), 'utf8')
    const legacyRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
    const serviceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
    const canonicalSyncSource = serviceSource.split('private async synchronizeSelectedCanonicalSession')[1]?.split('private async refreshSelectedCanonicalPresence')[0] || ''
    const canonicalSyncScheduleSource = serviceSource.split('private scheduleSelectedCanonicalSessionSynchronization')[1]?.split('private async synchronizeSelectedCanonicalSession')[0] || ''
    assert.equal(hookSource.includes('shouldHideAssistantRowsForSelection'), true, 'conversation switching distinguishes a safe materialized cache from an empty shell')
    assert.equal(pageSource.includes('shouldHideAssistantRowsForSelection'), true, 'Inspector projections share the same immediate cached-frame policy')
    assert.equal(coreSource.includes('current.selectionRequestSessionId'), true, 'delayed domain events preserve the newest local chat selection')
    assert.equal(coreSource.includes('previousState.snapshot.sessions !== mergedState.snapshot.sessions'), true, 'selection-only snapshots skip full hydrated-thread cache scans')
    assert.equal(coreSource.includes('resetLoadedRange ? undefined : current.historyByThreadId[threadId]'), true, 'authoritative refresh can preserve a validated loaded range while still replacing uncached shells')
    assert.equal(sessionSelectionSource.includes('force: !warmSelectionMatchesLatestShell'), true, 'session switching trusts revision-matched retained history as well as the fallback preview cache')
    assert.equal(sessionSelectionSource.includes('resetLoadedRange: !warmSelectionMatchesLatestShell'), true, 'session switching resets the visible range only when neither retained history nor the fallback preview matches')
    assert.equal(coreSource.includes('dematerializeAssistantHistories(applied.snapshot, runningThreadIds)'), true, 'inactive cached chats do not remain materialized in the live renderer snapshot')
    assert.equal(hydrationCacheSource.includes('if (remainsMaterialized) continue'), true, 'the active long thread is not rescanned into a duplicate cache on every timeline event')
    const threadSelectionSource = coreSource.split('async selectThread')[1]?.split('async deletePlaygroundLab')[0] || ''
    assert.match(threadSelectionSource, /selectionRequestId[\s\S]{0,6000}restorePreviousSelection/, 'sub-thread selection uses a latest-intent transaction with rollback')
    assert.match(serviceSource, /async selectSession[\s\S]{0,180}await this\.ensureReady\(\)[\s\S]{0,500}generation !== this\.navigationSelectionGeneration/, 'main-process selection establishes latest intent only after shared startup work has settled')
    assert.match(serviceSource, /selectAssistantSessionAction[\s\S]{0,180}generation !== this\.navigationSelectionGeneration/, 'main-process navigation rechecks latest intent after authoritative selection mutation')
    assert.match(canonicalSyncScheduleSource, /setImmediate[\s\S]{0,300}synchronizeSelectedCanonicalSession/, 'canonical attachment begins after the selection response can return to the renderer')
    assert.match(canonicalSyncSource, /await this\.runtime\.connect/, 'background synchronization still attaches the selected canonical chat')
    assert.match(canonicalSyncSource, /return toAssistantShellSnapshot/, 'background synchronization still converges on the live canonical shell')
    assert.match(serviceSource, /const snapshot = toAssistantShellSnapshot\(this\.state\.snapshot\)[\s\S]{0,180}scheduleSelectedCanonicalSessionSynchronization/, 'the selection handoff carries an immediate authoritative shell and defers live attachment')
    assert.match(serviceSource, /currentThread\?\.id !== thread\.id\) this\.runtime\.disconnect\(thread\.id\)/, 'a superseded canonical attachment is detached unless the newer intent selected the same thread')
    assert.match(serviceSource, /async getThreadDetailBootstrap[\s\S]{0,500}await this\.ensureCanonicalHistoryLoaded[\s\S]{0,300}readThreadDetail/, 'detail bootstrap refreshes canonical history before reading persisted rows')
    assert.equal(agentInboxSource.includes('props.commandPending && !isThreadBusy'), false, 'Agent Inbox selection pending cannot masquerade as active work')
    assert.equal(agentInboxSource.includes('if (item.active || item.status !== \'ready\') return false'), false, 'opening a settled chat cannot remove it from Settled without new activity')
    assert.equal(agentInboxSource.includes("label: settle ? 'Settle chat' : 'Un-settle chat'"), true, 'Agent Inbox menus expose the local settlement action')
    assert.equal(agentInboxSource.includes('...props.getSessionMenuItems(item.session)'), true, 'Agent Inbox menus retain the shared pin, rename, archive, and delete actions')
    assert.equal(agentInboxSource.includes('<FileActionsMenu'), true, 'Agent Inbox rows expose their complete action set from a visible dropdown')
    assert.equal(legacyRailSource.includes('getSessionMenuItems(session, !agentInboxEnabled)'), false, 'Agent Inbox no longer strips pinning from the shared action menu')
    assert.equal(legacyRailSource.includes('commandPending && !isThreadBusy'), false, 'legacy sidebar selection pending cannot masquerade as active work')

    const manySessions = Array.from({ length: 16 }, (_, index) => session(`cache-${index}`))
    const boundedCache = new Map<string, CachedHydratedThreadState>()
    cacheHydratedThreads(boundedCache, {
        ...state.snapshot,
        selectedSessionId: manySessions[15]!.id,
        sessions: manySessions
    })
    assert.equal(boundedCache.size, 12, 'hydrated renderer history uses a bounded recent-chat cache')
    assert.equal(boundedCache.has(manySessions[15]!.activeThreadId), false, 'the selected chat stays materialized without duplicating its timeline in the switching cache')

    const oversizedSession = session('oversized')
    const oversizedThread = oversizedSession.threads[0]!
    oversizedThread.messages = Array.from({ length: 420 }, (_, index) => ({
        id: `oversized-message-${index}`,
        threadId: oversizedThread.id,
        turnId: `oversized-turn-${Math.floor(index / 3)}`,
        role: index % 3 === 0 ? 'user' as const : 'assistant' as const,
        text: `${index}:${'message '.repeat(180)}`,
        timelineSequence: index * 2,
        createdAt: new Date(Date.UTC(2026, 6, 24, 10, 0, index)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 6, 24, 10, 0, index)).toISOString(),
        streaming: false
    }))
    oversizedThread.activities = Array.from({ length: 640 }, (_, index) => ({
        id: `oversized-activity-${index}`,
        kind: 'tool',
        tone: 'info' as const,
        summary: `Tool ${index}`,
        detail: 'detail '.repeat(80),
        payload: { output: 'payload '.repeat(240) },
        turnId: `oversized-turn-${Math.floor(index / 5)}`,
        timelineSequence: index * 2 + 1,
        createdAt: new Date(Date.UTC(2026, 6, 24, 10, 0, index)).toISOString()
    }))
    oversizedThread.messageCount = oversizedThread.messages.length
    oversizedThread.activityCount = oversizedThread.activities.length
    const oversizedSnapshot = {
        ...state.snapshot,
        sessions: [...state.snapshot.sessions, oversizedSession]
    }
    const oversizedCache = new Map<string, CachedHydratedThreadState>()
    cacheHydratedThreads(oversizedCache, oversizedSnapshot)
    const cachedOversizedThread = oversizedCache.get(oversizedThread.id)!
    assert.ok(cachedOversizedThread, 'the newest bounded shell remains available for an oversized chat')
    assert.equal(
        cachedOversizedThread.messages.length + cachedOversizedThread.activities.length + cachedOversizedThread.proposedPlans.length <= HYDRATED_THREAD_CACHE_MAX_TIMELINE_RECORDS + 2,
        true,
        'switching away from a long chat cannot retain its complete timeline in the immediate-selection cache'
    )
    assert.equal(
        estimateAssistantTimelineCollectionsCharacters(cachedOversizedThread) <= HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS + cachedOversizedThread.messages.findLast((message) => message.role === 'user')!.text.length,
        true,
        'the immediate-selection cache has a per-thread content budget'
    )
    assert.equal(cachedOversizedThread.messages.some((message) => message.id === oversizedThread.messages.at(-1)!.id), true, 'the bounded cache keeps the newest message')
    assert.equal(cachedOversizedThread.messages.some((message) => message.role === 'user'), true, 'the bounded cache keeps a prompt boundary for the newest response')
    const rematerializedOversized = applyCachedSessionSelection(oversizedSnapshot, oversizedSession.id, oversizedThread.id, oversizedCache)
    const selectedOversizedThread = rematerializedOversized.sessions.find((entry) => entry.id === oversizedSession.id)!.threads[0]!
    assert.equal(selectedOversizedThread.messages.length, cachedOversizedThread.messages.length, 'reopening a long chat paints only the bounded newest cache before authoritative hydration')

    const oversizedShell = {
        ...oversizedSnapshot,
        sessions: oversizedSnapshot.sessions.map((entry) => entry.id !== oversizedSession.id ? entry : {
            ...entry,
            threads: entry.threads.map((entryThread) => ({
                ...entryThread,
                messages: [],
                activities: [],
                proposedPlans: []
            }))
        })
    }
    const oversizedRetainedHistory = {
        threadId: oversizedThread.id,
        messages: oversizedThread.messages,
        activities: oversizedThread.activities,
        proposedPlans: oversizedThread.proposedPlans,
        pageInfo: {
            oldestCursor: 'retained-oldest-cursor',
            newestCursor: null,
            hasOlder: true,
            hasNewer: false,
            turnCount: oversizedThread.messages.filter((message) => message.role === 'user').length
        },
        initialLoading: false,
        loadingOlder: false,
        loadingNewer: false,
        loadOlderError: null,
        loadNewerError: null,
        fullyLoaded: false,
        lastUsedAt: Date.now() - 60_000,
        shellRevision: getAssistantThreadHydrationRevision(oversizedThread)
    }
    const oversizedWarmSelection = prepareAssistantWarmSelection({
        snapshot: oversizedShell,
        sessionId: oversizedSession.id,
        threadId: oversizedThread.id,
        hydratedThreadCache: new Map(),
        historyByThreadId: { [oversizedThread.id]: oversizedRetainedHistory }
    })
    const warmOversizedThread = oversizedWarmSelection.snapshot.sessions
        .find((entry) => entry.id === oversizedSession.id)!.threads[0]!
    const warmOversizedHistory = oversizedWarmSelection.historyByThreadId[oversizedThread.id]!
    assert.equal(warmOversizedThread.messages, oversizedRetainedHistory.messages, 'switching back restores every message already loaded for that chat')
    assert.equal(warmOversizedThread.activities, oversizedRetainedHistory.activities, 'switching back restores every activity already loaded for that chat')
    assert.equal(warmOversizedHistory.messages, oversizedRetainedHistory.messages, 'chat switching cannot replace the retained paging window with a preview-sized copy')
    assert.equal(warmOversizedHistory.activities, oversizedRetainedHistory.activities)
    assert.equal(warmOversizedHistory.pageInfo, oversizedRetainedHistory.pageInfo, 'chat switching preserves the complete paging boundary')
    assert.ok(warmOversizedHistory.lastUsedAt > oversizedRetainedHistory.lastUsedAt, 'reopening a retained chat refreshes its cache age')

    let retainedSwitchState = {
        ...state,
        snapshot: { ...oversizedShell, selectedSessionId: 'a' },
        historyByThreadId: { [oversizedThread.id]: oversizedRetainedHistory },
        selectionTransitionKey: null,
        selectionHydrationKey: null,
        selectionRequestId: 0,
        selectionRequestSessionId: null
    } as unknown as AssistantStoreState
    const retainedSwitchHydrationCalls: Array<{ force: boolean; resetLoadedRange: boolean }> = []
    const originalSelectSession = (globalThis as any).window.devscope.assistant.selectSession
    ;(globalThis as any).window.devscope.assistant.selectSession = async (sessionId: string) => ({
        success: true as const,
        sessionId,
        snapshot: { ...oversizedShell, selectedSessionId: sessionId },
        status: {
            available: true,
            connected: true,
            selectedSessionId: sessionId,
            activeThreadId: oversizedThread.id,
            state: 'ready' as const,
            reason: null
        }
    })
    try {
        const retainedSwitch = selectAssistantStoreSession({
            state: retainedSwitchState,
            hydratedThreadCache: new Map(),
            getState: () => retainedSwitchState,
            setState: (nextState) => {
                const partial = typeof nextState === 'function' ? nextState(retainedSwitchState) : nextState
                retainedSwitchState = { ...retainedSwitchState, ...partial }
            },
            requestSessionHydration: async (_sessionId, _threadId, options) => {
                retainedSwitchHydrationCalls.push({
                    force: options?.force === true,
                    resetLoadedRange: options?.resetLoadedRange === true
                })
            }
        }, oversizedSession.id)
        const immediateRetainedThread = retainedSwitchState.snapshot.sessions
            .find((entry) => entry.id === oversizedSession.id)!.threads[0]!
        assert.equal(immediateRetainedThread.messages, oversizedRetainedHistory.messages, 'the click task paints the retained timeline without shrinking it first')
        await retainedSwitch
        assert.deepEqual(
            retainedSwitchHydrationCalls,
            [{ force: false, resetLoadedRange: false }],
            'a revision-matched retained timeline cannot trigger a forced newest-page replacement'
        )
    } finally {
        ;(globalThis as any).window.devscope.assistant.selectSession = originalSelectSession
    }

    const staleCache = new Map(hydratedThreadCache)
    const staleSessionB = state.snapshot.sessions.find((entry) => entry.id === 'b')!
    const staleThreadB = {
        ...staleSessionB.threads[0]!,
        updatedAt: '2026-07-24T10:01:00.000Z',
        messageCount: 0,
        messages: []
    }
    const staleSnapshot = {
        ...state.snapshot,
        sessions: state.snapshot.sessions.map((entry) => entry.id === 'b'
            ? { ...entry, threads: [staleThreadB] }
            : entry)
    }
    cacheHydratedThreads(staleCache, staleSnapshot)
    assert.equal(hasCachedSessionSelection(staleSnapshot, 'b', staleThreadB.id, staleCache), false, 'newer shell metadata invalidates stale hydrated rows')

    const canonicalThread = {
        ...thread('canonical-cache', 'cached content'),
        canonicalHistoryModifiedAt: '2026-07-24T10:00:00.000Z',
        canonicalHistoryEntryCount: 1,
        canonicalPresence: { state: 'ready', latestSequence: 10, observedSequence: 10 },
        latestTurn: {
            id: 'turn-canonical-cache',
            state: 'completed',
            requestedAt: '2026-07-24T09:59:00.000Z',
            startedAt: '2026-07-24T09:59:01.000Z',
            completedAt: '2026-07-24T10:00:01.000Z',
            assistantMessageId: 'message-canonical-cache',
            usage: { totalTokens: 100, modelContextWindow: 1_000 }
        }
    }
    const runtimeOnlyUpdate = {
        ...canonicalThread,
        updatedAt: '2026-07-24T10:01:00.000Z',
        model: 'new-runtime-model',
        runtimeMode: 'full-access',
        canonicalPresence: { ...canonicalThread.canonicalPresence, latestSequence: 99, observedSequence: 100 },
        latestTurn: {
            ...canonicalThread.latestTurn,
            completedAt: '2026-07-24T10:00:05.000Z',
            usage: { totalTokens: 200, modelContextWindow: 2_000 }
        }
    }
    assert.equal(
        getAssistantThreadHydrationRevision(runtimeOnlyUpdate as any),
        getAssistantThreadHydrationRevision(canonicalThread as any),
        'runtime presence and usage updates cannot evict unchanged canonical chat rows'
    )
    assert.notEqual(
        getAssistantThreadHydrationRevision({ ...runtimeOnlyUpdate, canonicalHistoryModifiedAt: '2026-07-24T10:02:00.000Z' } as any),
        getAssistantThreadHydrationRevision(canonicalThread as any),
        'a canonical history revision change still invalidates cached rows'
    )

    console.log('Assistant immediate session switching contract: ok')
} finally {
    if (originalWindow === undefined) delete (globalThis as any).window
    else (globalThis as any).window = originalWindow
}
