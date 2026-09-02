import type { AssistantEventStreamPayload, AssistantRealtimeVoiceEvent } from '@shared/assistant/contracts'
import type { DevScopeApi, DevScopeAssistantApi } from '@shared/contracts/devscope-api'
import {
    BROWSER_ASSISTANT_BRIDGE_EVENTS_PATH,
    BROWSER_ASSISTANT_BRIDGE_HEADER,
    BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
    BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH,
    BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX,
    BROWSER_ASSISTANT_CLIENT_ID_HEADER,
    BROWSER_REALTIME_VOICE_EVENTS_PATH,
    type BrowserAssistantBridgeInvokeResponse,
    type BrowserAssistantBridgeMethod
} from '@shared/browser-assistant-bridge'

const RECONNECT_DELAY_MS = 1_000
const MAX_EVENT_STREAM_BUFFER_CHARS = 2 * 1024 * 1024
const VOICE_STREAM_READY_TIMEOUT_MS = 4_000
const BROWSER_ASSISTANT_CLIENT_ID_STORAGE_KEY = 'zyra:browser-assistant-client-id:v1'
const BROWSER_VOICE_METHODS = new Set<BrowserAssistantBridgeMethod>([
    'startRealtimeVoice',
    'sendRealtimeVoiceMessage',
    'ingestRealtimeVoiceEvent',
    'stopRealtimeVoice'
])

type BrowserRealtimeVoiceStreamEvent = {
    streamId: string
    sequence: number
    event: AssistantRealtimeVoiceEvent
}

type BrowserVoiceStreamWaiter = {
    resolve: () => void
    reject: (error: Error) => void
    timer: number
}

function getBrowserAssistantClientId(): string {
    try {
        const existing = sessionStorage.getItem(BROWSER_ASSISTANT_CLIENT_ID_STORAGE_KEY)
        if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing
        const created = crypto.randomUUID().replace(/-/g, '')
        sessionStorage.setItem(BROWSER_ASSISTANT_CLIENT_ID_STORAGE_KEY, created)
        return created
    } catch {
        return crypto.randomUUID().replace(/-/g, '')
    }
}

const browserAssistantClientId = getBrowserAssistantClientId()

async function invokeBrowserAssistantBridge<T>(method: BrowserAssistantBridgeMethod, args: unknown[]): Promise<T> {
    const response = await fetch(`${BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE
        },
        body: JSON.stringify({
            method,
            args,
            ...(BROWSER_VOICE_METHODS.has(method) ? { clientId: browserAssistantClientId } : {})
        })
    })
    const payload = await response.json() as BrowserAssistantBridgeInvokeResponse
    if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? `Browser bridge request failed (${response.status}).` : payload.error)
    }
    return payload.value as T
}

type RemoteAssistantMethod = BrowserAssistantBridgeMethod & keyof DevScopeAssistantApi
type AssistantMethod<M extends RemoteAssistantMethod> = DevScopeAssistantApi[M] extends (...args: infer A) => infer R
    ? (...args: A) => R
    : never

function remoteAssistantMethod<M extends RemoteAssistantMethod>(method: M): AssistantMethod<M> {
    return ((...args: unknown[]) => invokeBrowserAssistantBridge(method, args)) as AssistantMethod<M>
}

type BrowserAssistantSnapshot = Awaited<ReturnType<DevScopeAssistantApi['getSnapshot']>>
type BrowserAssistantBootstrap = Awaited<ReturnType<DevScopeAssistantApi['bootstrap']>>

function decodeRoutePart(value: string | undefined): string | null {
    if (!value) return null
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

function projectBrowserRouteSnapshot(snapshot: BrowserAssistantSnapshot): BrowserAssistantSnapshot {
    const parts = window.location.hash.replace(/^#/, '').split('/').filter(Boolean)
    if (parts[0] !== 'assistant' || parts[1] !== 'chat') return snapshot
    const sessionId = decodeRoutePart(parts[2])
    const requestedThreadId = parts[3] === 'thread' ? decodeRoutePart(parts[4]) : null
    const sessionIndex = sessionId
        ? snapshot.sessions.findIndex((session) => session.id === sessionId)
        : -1
    if (sessionIndex < 0) return snapshot

    const session = snapshot.sessions[sessionIndex]
    const threadId = requestedThreadId && session.threads.some((thread) => thread.id === requestedThreadId)
        ? requestedThreadId
        : session.activeThreadId
    const sessions = threadId && session.activeThreadId !== threadId
        ? snapshot.sessions.map((entry, index) => index === sessionIndex ? { ...entry, activeThreadId: threadId } : entry)
        : snapshot.sessions
    if (snapshot.selectedSessionId === session.id && sessions === snapshot.sessions) return snapshot
    return { ...snapshot, selectedSessionId: session.id, sessions }
}

async function getBrowserBootstrap(): Promise<BrowserAssistantBootstrap> {
    const bootstrap = await invokeBrowserAssistantBridge<BrowserAssistantBootstrap>('bootstrap', [])
    const snapshot = projectBrowserRouteSnapshot(bootstrap.snapshot)
    const session = snapshot.sessions.find((entry) => entry.id === snapshot.selectedSessionId) || null
    const statusMatchesRoute = Boolean(
        session
        && bootstrap.status.selectedSessionId === session.id
        && bootstrap.status.activeThreadId === session.activeThreadId
    )
    return {
        ...bootstrap,
        snapshot,
        status: statusMatchesRoute
            ? bootstrap.status
            : {
                ...bootstrap.status,
                connected: false,
                selectedSessionId: session?.id || null,
                activeThreadId: session?.activeThreadId || null,
                state: 'disconnected'
            }
    }
}

async function getBrowserSnapshot(): Promise<BrowserAssistantSnapshot> {
    return projectBrowserRouteSnapshot(
        await invokeBrowserAssistantBridge<BrowserAssistantSnapshot>('getSnapshot', [])
    )
}

function waitForReconnect(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve()
            return
        }
        const timer = window.setTimeout(done, RECONNECT_DELAY_MS)
        function done() {
            window.clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
        signal.addEventListener('abort', done, { once: true })
    })
}

async function consumeServerSentEvents<T>(
    path: string,
    callback: (payload: T) => void,
    signal: AbortSignal,
    onConnectionChanged?: (connected: boolean) => void,
    clientId?: string
): Promise<void> {
    while (!signal.aborted) {
        let connected = false
        try {
            const response = await fetch(`${BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX}${path}`, {
                headers: {
                    [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
                    ...(clientId ? { [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: clientId } : {})
                },
                cache: 'no-store',
                signal
            })
            if (!response.ok || !response.body) throw new Error(`Browser event bridge returned ${response.status}.`)
            connected = true
            onConnectionChanged?.(true)
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (!signal.aborted) {
                const result = await reader.read()
                if (result.done) break
                buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n')
                if (buffer.length > MAX_EVENT_STREAM_BUFFER_CHARS) {
                    throw new Error('Browser Assistant event stream payload is too large.')
                }
                let boundary = buffer.indexOf('\n\n')
                while (boundary >= 0) {
                    const block = buffer.slice(0, boundary)
                    buffer = buffer.slice(boundary + 2)
                    const data = block
                        .split('\n')
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trimStart())
                        .join('\n')
                    if (data) callback(JSON.parse(data) as T)
                    boundary = buffer.indexOf('\n\n')
                }
            }
        } catch (error) {
            if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        } finally {
            if (connected) onConnectionChanged?.(false)
        }
        await waitForReconnect(signal)
    }
}

async function consumeAssistantEventStream(
    callback: (payload: AssistantEventStreamPayload) => void,
    signal: AbortSignal
): Promise<void> {
    return consumeServerSentEvents(
        BROWSER_ASSISTANT_BRIDGE_EVENTS_PATH,
        callback,
        signal,
        // An empty payload is a renderer-local stream-ready signal. It lets
        // the browser reclaim its routed session only after the main-process
        // lease is active, without inventing a domain event.
        (connected) => {
            if (connected) callback({ events: [] })
        }
    )
}

async function consumeRealtimeVoiceEventStream(
    callback: (event: AssistantRealtimeVoiceEvent) => void,
    signal: AbortSignal,
    onConnectionChanged: (connected: boolean) => void
): Promise<void> {
    let streamId: string | null = null
    let lastSequence = 0
    return consumeServerSentEvents<BrowserRealtimeVoiceStreamEvent>(
        BROWSER_REALTIME_VOICE_EVENTS_PATH,
        (payload) => {
            if (!payload || typeof payload.streamId !== 'string' || !Number.isSafeInteger(payload.sequence)) return
            if (payload.streamId !== streamId) {
                streamId = payload.streamId
                lastSequence = 0
            }
            if (payload.sequence <= lastSequence) return
            lastSequence = payload.sequence
            callback(payload.event)
        },
        signal,
        onConnectionChanged,
        browserAssistantClientId
    )
}

export function createBrowserAssistantBridgeAdapter(): DevScopeApi['assistant'] {
    const connectedVoiceStreams = new Set<number>()
    const voiceStreamWaiters = new Set<BrowserVoiceStreamWaiter>()
    let nextVoiceStreamId = 0
    let realtimeVoiceIngestQueue: Promise<void> = Promise.resolve()
    const startRealtimeVoiceRemote = remoteAssistantMethod('startRealtimeVoice')
    const ingestRealtimeVoiceEventRemote = remoteAssistantMethod('ingestRealtimeVoiceEvent')
    const stopRealtimeVoiceRemote = remoteAssistantMethod('stopRealtimeVoice')

    const updateVoiceStreamConnection = (streamId: number, connected: boolean) => {
        if (connected) connectedVoiceStreams.add(streamId)
        else connectedVoiceStreams.delete(streamId)
        if (connectedVoiceStreams.size === 0) return
        for (const waiter of voiceStreamWaiters) {
            window.clearTimeout(waiter.timer)
            waiter.resolve()
        }
        voiceStreamWaiters.clear()
    }

    const waitForVoiceStream = (): Promise<void> => {
        if (connectedVoiceStreams.size > 0) return Promise.resolve()
        return new Promise((resolve, reject) => {
            let waiter: BrowserVoiceStreamWaiter
            const timer = window.setTimeout(() => {
                voiceStreamWaiters.delete(waiter)
                reject(new Error('Voice could not connect to the Zyra browser event stream. Try again.'))
            }, VOICE_STREAM_READY_TIMEOUT_MS)
            waiter = { resolve, reject, timer }
            voiceStreamWaiters.add(waiter)
        })
    }

    const startRealtimeVoice = (async (...args: Parameters<typeof startRealtimeVoiceRemote>) => {
        await waitForVoiceStream()
        await realtimeVoiceIngestQueue.catch(() => undefined)
        return startRealtimeVoiceRemote(...args)
    }) as typeof startRealtimeVoiceRemote

    const ingestRealtimeVoiceEvent = ((...args: Parameters<typeof ingestRealtimeVoiceEventRemote>) => {
        const result = realtimeVoiceIngestQueue
            .catch(() => undefined)
            .then(() => ingestRealtimeVoiceEventRemote(...args))
        realtimeVoiceIngestQueue = result.then(() => undefined, () => undefined)
        return result
    }) as typeof ingestRealtimeVoiceEventRemote

    const stopRealtimeVoice = (async (...args: Parameters<typeof stopRealtimeVoiceRemote>) => {
        await realtimeVoiceIngestQueue.catch(() => undefined)
        return stopRealtimeVoiceRemote(...args)
    }) as typeof stopRealtimeVoiceRemote

    return {
        subscribe: async () => ({ success: true as const }),
        unsubscribe: async () => ({ success: true as const }),
        bootstrap: getBrowserBootstrap,
        getSnapshot: getBrowserSnapshot,
        getFleetSnapshot: remoteAssistantMethod('getFleetSnapshot'),
        agentAction: remoteAssistantMethod('agentAction'),
        workflowAction: remoteAssistantMethod('workflowAction'),
        getStatus: remoteAssistantMethod('getStatus'),
        getAccountOverview: remoteAssistantMethod('getAccountOverview'),
        redeemAccountReset: remoteAssistantMethod('redeemAccountReset'),
        getSessionTurnUsage: remoteAssistantMethod('getSessionTurnUsage'),
        listModels: remoteAssistantMethod('listModels'),
        listProjects: remoteAssistantMethod('listProjects'),
        createProject: remoteAssistantMethod('createProject'),
        associateProjectFolder: remoteAssistantMethod('associateProjectFolder'),
        removeProjectFolder: remoteAssistantMethod('removeProjectFolder'),
        updateProject: remoteAssistantMethod('updateProject'),
        dismissProjectCandidate: remoteAssistantMethod('dismissProjectCandidate'),
        listPromptResources: async () => ({
            success: false,
            error: 'Commands and skills are available only in trusted Zyra Desktop windows.'
        }),
        getSkillSourceOverview: async () => ({
            success: false,
            error: 'Skill sources can be managed only in Zyra Desktop.'
        }),
        updateSkillSourceSettings: async () => ({
            success: false,
            error: 'Skill sources can be managed only in Zyra Desktop.'
        }),
        connect: remoteAssistantMethod('connect'),
        disconnect: remoteAssistantMethod('disconnect'),
        createSession: remoteAssistantMethod('createSession'),
        selectSession: remoteAssistantMethod('selectSession'),
        selectThread: remoteAssistantMethod('selectThread'),
        getThreadDetailBootstrap: remoteAssistantMethod('getThreadDetailBootstrap'),
        getHistoryPage: remoteAssistantMethod('getHistoryPage'),
        getHistoryAroundMessage: remoteAssistantMethod('getHistoryAroundMessage'),
        hydrateHistoryBody: remoteAssistantMethod('hydrateHistoryBody'),
        getReviewIndex: remoteAssistantMethod('getReviewIndex'),
        getTurnDetail: remoteAssistantMethod('getTurnDetail'),
        searchChats: remoteAssistantMethod('searchChats'),
        searchTurns: remoteAssistantMethod('searchTurns'),
        renameSession: remoteAssistantMethod('renameSession'),
        regenerateSessionTitle: remoteAssistantMethod('regenerateSessionTitle'),
        archiveSession: remoteAssistantMethod('archiveSession'),
        deleteSession: remoteAssistantMethod('deleteSession'),
        deleteMessage: remoteAssistantMethod('deleteMessage'),
        clearLogs: remoteAssistantMethod('clearLogs'),
        setSessionProject: remoteAssistantMethod('setSessionProject'),
        setSessionProjectPath: remoteAssistantMethod('setSessionProjectPath'),
        setPlaygroundRoot: remoteAssistantMethod('setPlaygroundRoot'),
        createPlaygroundLab: remoteAssistantMethod('createPlaygroundLab'),
        deletePlaygroundLab: remoteAssistantMethod('deletePlaygroundLab'),
        attachSessionToPlaygroundLab: remoteAssistantMethod('attachSessionToPlaygroundLab'),
        approvePendingPlaygroundLabRequest: remoteAssistantMethod('approvePendingPlaygroundLabRequest'),
        declinePendingPlaygroundLabRequest: remoteAssistantMethod('declinePendingPlaygroundLabRequest'),
        getPathForFile: () => '',
        persistClipboardImage: remoteAssistantMethod('persistClipboardImage'),
        resolveClipboardAttachment: remoteAssistantMethod('resolveClipboardAttachment'),
        newThread: remoteAssistantMethod('newThread'),
        sendPrompt: remoteAssistantMethod('sendPrompt'),
        interruptTurn: remoteAssistantMethod('interruptTurn'),
        respondApproval: remoteAssistantMethod('respondApproval'),
        respondUserInput: remoteAssistantMethod('respondUserInput'),
        startRealtimeVoice,
        sendRealtimeVoiceMessage: remoteAssistantMethod('sendRealtimeVoiceMessage'),
        ingestRealtimeVoiceEvent,
        stopRealtimeVoice,
        onRealtimeVoiceEvent: (callback: (event: AssistantRealtimeVoiceEvent) => void) => {
            const controller = new AbortController()
            const streamId = ++nextVoiceStreamId
            void consumeRealtimeVoiceEventStream(
                callback,
                controller.signal,
                (connected) => updateVoiceStreamConnection(streamId, connected)
            )
            return () => {
                controller.abort()
                updateVoiceStreamConnection(streamId, false)
            }
        },
        getVoiceTranscriptionState: remoteAssistantMethod('getVoiceTranscriptionState'),
        transcribeVoice: remoteAssistantMethod('transcribeVoice'),
        onEvent: (callback: (payload: AssistantEventStreamPayload) => void) => {
            const controller = new AbortController()
            void consumeAssistantEventStream(callback, controller.signal)
            return () => controller.abort()
        }
    }
}
