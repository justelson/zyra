import assert from 'node:assert/strict'
import type { AssistantDomainEvent } from '../src/shared/assistant/contracts'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'

const createdAt = '2026-08-17T18:20:39.292Z'
const session = (title: string, projectPath: string | null) => ({
    id: 'session-create-race',
    title,
    mode: 'work' as const,
    projectPath,
    playgroundLabId: null,
    pendingLabRequest: null,
    archived: false,
    createdAt,
    updatedAt: createdAt,
    activeThreadId: null,
    threadIds: [],
    threads: []
})
const initialSnapshot = createDefaultAssistantSnapshot()
const authoritativeSession = { ...session('General greeting', 'C:/workspace'), updatedAt: '2026-08-17T18:20:47.487Z' }
const authoritativeSnapshot = {
    ...createDefaultAssistantSnapshot(),
    snapshotSequence: 5,
    selectedSessionId: authoritativeSession.id,
    updatedAt: authoritativeSession.updatedAt,
    sessions: [authoritativeSession]
}
const staleCreation: AssistantDomainEvent = {
    eventId: 'event-create-race',
    sequence: 1,
    occurredAt: createdAt,
    type: 'session.created' as const,
    sessionId: authoritativeSession.id,
    threadId: undefined,
    payload: { session: session('New Session', null) }
}
const liveUpdate: AssistantDomainEvent = {
    eventId: 'event-live-after-refresh',
    sequence: 6,
    occurredAt: '2026-08-17T18:20:48.000Z',
    type: 'session.updated',
    sessionId: authoritativeSession.id,
    payload: {
        sessionId: authoritativeSession.id,
        patch: { title: 'Live authoritative update', updatedAt: '2026-08-17T18:20:48.000Z' }
    }
}
const status = {
    available: true,
    connected: false,
    connecting: false,
    selectedSessionId: null,
    activeThreadId: null,
    providerThreadId: null,
    message: null
}

let eventListener: ((payload: { event: AssistantDomainEvent }) => void) | null = null
let bootstrapCalls = 0
let modelListCalls = 0
let modelListForceRefresh: boolean | null = null
const refreshedModels = [{ id: 'opencode-harness/opencode/big-pickle', label: 'Big Pickle' }]
const animationFrames: FrameRequestCallback[] = []
const windowMock = {
    requestAnimationFrame(callback: FrameRequestCallback) {
        animationFrames.push(callback)
        return animationFrames.length
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    devscope: {
        assistant: {
            bootstrap: async () => {
                bootstrapCalls += 1
                return { snapshot: initialSnapshot, status }
            },
            listModels: async (forceRefresh = false) => {
                modelListCalls += 1
                modelListForceRefresh = forceRefresh
                return { success: true as const, models: refreshedModels }
            },
            onEvent: (listener: typeof eventListener) => {
                eventListener = listener
                return () => { eventListener = null }
            },
            createSession: async () => {
                eventListener?.({ event: staleCreation })
                return { success: true as const, sessionId: authoritativeSession.id }
            },
            getSnapshot: async () => authoritativeSnapshot,
            getStatus: async () => status
        }
    }
}
Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true })

const { AssistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
const store = new AssistantStore()
store.retain()
for (let attempt = 0; attempt < 20 && !store.getState().hydrated; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
}
assert.equal(store.getState().hydrated, true)
for (let attempt = 0; attempt < 20 && store.getState().modelsLoading; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
}
assert.equal(modelListCalls, 1, 'startup automatically requests a current provider-model catalog')
assert.equal(modelListForceRefresh, false, 'startup uses the automatic refresh policy rather than the manual force-refresh path')
assert.deepEqual(store.getState().snapshot.knownModels, refreshedModels, 'the refreshed harness catalog is exposed in the assistant store')

const result = await store.createSession()
assert.equal(result.success, true)
assert.equal(store.getState().snapshot.sessions.length, 1, 'the authoritative refresh installs one session before the queued event flush')
assert.equal(store.getState().snapshot.sessions[0]?.title, 'General greeting')
eventListener?.({ event: liveUpdate })

for (const callback of animationFrames.splice(0)) callback(performance.now())
await Promise.resolve()
const sessions = store.getState().snapshot.sessions
assert.equal(sessions.length, 1, 'the queued stale create event cannot append a second copy after snapshot refresh')
assert.equal(sessions[0]?.id, authoritativeSession.id)
assert.equal(sessions[0]?.title, 'Live authoritative update', 'the first live event after refresh must survive stale queued events')
assert.equal(sessions[0]?.projectPath, 'C:/workspace')
assert.equal(bootstrapCalls, 1, 'a represented queued event cannot manufacture a sequence gap and trigger another hydrate')
store.release()

// Plugin chats use a distinct IPC route, but must capture the same immediate choice.
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
} })
const { rememberComposerChoices } = await import('../src/renderer/src/pages/assistant/assistant-remembered-choices')
const chosen = { model: 'fixture/last-deliberate-model', effort: 'high' as const, runtimeMode: 'full-access' as const }
rememberComposerChoices(chosen)
let pluginInput: import('../src/shared/assistant/contracts').AssistantCreatePluginChatInput | null = null
let finishPluginCreation!: () => void
Object.assign(windowMock.devscope.assistant, { selectSession: async () => ({ success: true, sessionId: authoritativeSession.id }), createPluginChat: async (input: typeof pluginInput) => {
    pluginInput = structuredClone(input)
    await new Promise<void>(resolve => { finishPluginCreation = resolve })
    return { success: true, sessionId: authoritativeSession.id }
} })
const pluginCreation = store.createPluginChat({ pluginId: 'fixture-plugin', releaseId: 'fixture-release', contentDigest: 'a'.repeat(64) })
assert.deepEqual(pluginInput?.composer, chosen, 'Plugin chat IPC captures remembered choices immediately, not a later shared-settings flush')
rememberComposerChoices({ model: 'fixture/later-model', effort: 'low', runtimeMode: 'approval-required' })
assert.deepEqual(pluginInput?.composer, chosen, 'an already-created Plugin draft owns an immutable choice copy')
finishPluginCreation()
assert.equal((await pluginCreation).success, true)
console.log('Assistant create-session snapshot race and Plugin composer choice snapshot: ok')
