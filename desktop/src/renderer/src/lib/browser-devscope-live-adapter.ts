import { isNativeOverlayMethod } from '@shared/contracts/native-overlay'
import { browserBridgeJsonReviver } from '@shared/browser-bridge-json'
import type { RuntimeActivationStatus } from '@shared/runtime-activation'
import type { ControlCursorState, ControlStateSnapshot } from '@shared/agent-control/contracts'
import type { OnboardingSnapshot } from '@shared/onboarding/contracts'
import type { DevicePreferencesChangedEvent } from '@shared/preferences/contracts'
import type {
    DevScopeApi,
    DevScopeGitCloneProgressEvent,
    DevScopePreviewTerminalEvent,
    DevScopePythonPreviewEvent
} from '@shared/contracts/devscope-api'
import {
    BROWSER_ASSISTANT_BRIDGE_HEADER,
    BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
    BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX,
    BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH,
    BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH,
    isBrowserDevscopeRelayEvent,
    isBrowserDevscopeStreamEvent,
    type BrowserAssistantBridgeInvokeResponse,
    type BrowserDevscopeEventName
} from '@shared/browser-assistant-bridge'

const MAX_CONCURRENT_BROWSER_ACTIONS = 2
const MAX_CONCURRENT_BACKGROUND_BROWSER_ACTIONS = 1
const DEFAULT_BROWSER_ACTION_TIMEOUT_MS = 2 * 60_000
const INTERACTIVE_BROWSER_ACTION_TIMEOUT_MS = 10 * 60_000
const BROWSER_EVENT_RECONNECT_DELAY_MS = 1_000
const MAX_BROWSER_EVENT_BUFFER_CHARS = 2 * 1024 * 1024
const PRIORITY_ACTION_PREFIXES = [
    'select', 'open', 'launch', 'install', 'save', 'write', 'create', 'update',
    'delete', 'remove', 'rename', 'move', 'copy', 'check', 'generate', 'test',
    'set', 'add', 'clear', 'stop', 'start', 'run', 'execute', 'import', 'export',
    'apply', 'cancel', 'respond'
]

const BROWSER_EVENT_METHODS = {
    onGitCloneProgress: 'gitCloneProgress',
    onPreviewTerminalEvent: 'previewTerminal',
    onPythonPreviewEvent: 'pythonPreview'
} as const

const BROWSER_NAMESPACE_EVENT_METHODS = {
    'agentControl.onCursorChange': 'agentControlCursor',
    'agentControl.onStateChange': 'agentControlState',
    'preferences.onChanged': 'preferencesChanged',
    'onboarding.onChanged': 'onboardingChanged',
    'runtimeActivation.onStateChange': 'runtimeActivationChanged'
} as const

const AGENT_CONTROL_GUEST_ONLY_METHODS = new Set([
    'acknowledgeBrowserSurfaceRequest',
    'bindBrowserTab',
    'claimBrowserSurfaceRequest',
    'completeBrowserSurfaceRequest',
    'updateWorkspaceState'
])

const LIVE_RELAY_NAMESPACES = new Set(['preferences', 'onboarding', 'runtimeActivation'])

const ELECTRON_GUEST_ONLY_METHODS = new Set([
    'registerPreviewTerminalWorkspace',
    'releasePreviewTerminalWorkspace',
    'getBrowserPreviewConfig',
    'getBrowserHistory',
    'getBrowserSearchSuggestions',
    'scanExternalBrowserHistoryProfiles',
    'importExternalBrowserHistory',
    'recordBrowserHistory',
    'clearBrowserHistory',
    'getBrowserAdBlockStatus',
    'setBrowserAdBlockEnabled',
    'onBrowserAdDetected',
    'getBrowserBackgroundProviderStatus',
    'validateBrowserUnsplashAccessKey',
    'getBrowserRemoteBackgrounds',
    'trackBrowserRemoteBackground',
    'getRunningLocalServers',
    'clearBrowserPreviewData',
    'clearBrowserPreviewCache',
    'clearBrowserPreviewCookies',
    'hardReloadBrowserPreview',
    'setBrowserPreviewZoom',
    'setBrowserPreviewColorScheme',
    'openBrowserPreviewDevTools',
    'captureBrowserPreviewScreenshot',
    'stageBrowserPreviewArtifactForAssistant',
    'attachBrowserCaptureToChat',
    'readBrowserCaptureDraft',
    'acknowledgeBrowserCaptureDraft',
    'listBrowserCaptures',
    'deleteBrowserCapture',
    'openBrowserPreviewArtifact',
    'revealBrowserPreviewArtifact',
    'copyBrowserPreviewArtifact',
    'startBrowserPreviewAnnotation',
    'cancelBrowserPreviewAnnotation',
    'startBrowserPreviewRecording',
    'stopBrowserPreviewRecording',
    'saveBrowserPreviewRecording',
    'onBrowserPreviewRecordingFrame'
])

type BrowserEventPayloadByName = {
    agentControlCursor: ControlCursorState
    agentControlState: ControlStateSnapshot
    gitCloneProgress: DevScopeGitCloneProgressEvent
    previewTerminal: DevScopePreviewTerminalEvent
    pythonPreview: DevScopePythonPreviewEvent
    preferencesChanged: DevicePreferencesChangedEvent
    onboardingChanged: OnboardingSnapshot
    runtimeActivationChanged: RuntimeActivationStatus
}

type BrowserActionTask = {
    priority: boolean
    run: () => void
}

const browserActionQueue: BrowserActionTask[] = []
const inFlightBackgroundBrowserActions = new Map<string, Promise<unknown>>()
let activeBrowserActions = 0
let activeBackgroundBrowserActions = 0

class BrowserDevscopeEventHub {
    private readonly listeners = new Map<BrowserDevscopeEventName, Set<(payload: unknown) => void>>()
    private controller: AbortController | null = null
    private streamId: string | null = null
    private lastSequence = 0
    private runtimeStatus: RuntimeActivationStatus = { phase: 'idle', connection: 'unknown' }

    private publishRuntimeStatus(status: RuntimeActivationStatus): void {
        this.runtimeStatus = status
        for (const listener of this.listeners.get('runtimeActivationChanged') || []) {
            try { listener(status) } catch { /* isolate subscribers */ }
        }
    }

    subscribe<Name extends BrowserDevscopeEventName>(
        event: Name,
        callback: (payload: BrowserEventPayloadByName[Name]) => void
    ): () => void {
        const listeners = this.listeners.get(event) || new Set<(payload: unknown) => void>()
        listeners.add(callback as (payload: unknown) => void)
        this.listeners.set(event, listeners)
        this.ensureConnected()
        return () => {
            listeners.delete(callback as (payload: unknown) => void)
            if (listeners.size === 0) this.listeners.delete(event)
            if (this.listeners.size === 0) {
                this.controller?.abort()
                this.controller = null
            }
        }
    }

    private ensureConnected(): void {
        if (this.controller || this.listeners.size === 0) return
        const controller = new AbortController()
        this.controller = controller
        void this.consume(controller.signal).finally(() => {
            if (this.controller === controller) this.controller = null
            if (this.listeners.size > 0) this.ensureConnected()
        })
    }

    private async consume(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            try {
                const response = await fetch(`${BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX}${BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH}`, {
                    headers: {
                        [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE
                    },
                    cache: 'no-store',
                    signal
                })
                if (!response.ok || !response.body) throw new Error(`Browser event bridge returned ${response.status}.`)
                if (this.listeners.has('runtimeActivationChanged')) {
                    const status = await invokeBrowserDevscope(['runtimeActivation', 'getState'], []) as RuntimeActivationStatus
                    if (!signal.aborted) this.publishRuntimeStatus(status)
                }
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''
                while (!signal.aborted) {
                    const chunk = await reader.read()
                    if (chunk.done) break
                    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
                    if (buffer.length > MAX_BROWSER_EVENT_BUFFER_CHARS) throw new Error('Browser event bridge payload is too large.')
                    let boundary = buffer.indexOf('\n\n')
                    while (boundary >= 0) {
                        const block = buffer.slice(0, boundary)
                        buffer = buffer.slice(boundary + 2)
                        const data = block
                            .split('\n')
                            .filter((line) => line.startsWith('data:'))
                            .map((line) => line.slice(5).trimStart())
                            .join('\n')
                        if (data) {
                            try {
                                const event = JSON.parse(data) as unknown
                                if (isBrowserDevscopeRelayEvent(event)) {
                                    if (isBrowserDevscopeStreamEvent(event)) {
                                        if (event.streamId !== this.streamId) {
                                            this.streamId = event.streamId
                                            this.lastSequence = 0
                                        }
                                        if (event.sequence <= this.lastSequence) {
                                            boundary = buffer.indexOf('\n\n')
                                            continue
                                        }
                                        this.lastSequence = event.sequence
                                    }
                                    if (event.event === 'runtimeActivationChanged') this.runtimeStatus = event.payload as RuntimeActivationStatus
                                    for (const listener of this.listeners.get(event.event) || []) {
                                        try { listener(event.payload) } catch { /* isolate renderer subscribers */ }
                                    }
                                }
                            } catch {
                                // A malformed event is isolated; the supervised stream stays connected.
                            }
                        }
                        boundary = buffer.indexOf('\n\n')
                    }
                }
            } catch (error) {
                if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
            }
            if (signal.aborted) return
            this.publishRuntimeStatus({ ...this.runtimeStatus, phase: 'failed', connection: 'disconnected', errorCode: 'BROWSER_HOST_DISCONNECTED' })
            if (signal.aborted) return
            await new Promise<void>((resolve) => {
                const timer = window.setTimeout(done, BROWSER_EVENT_RECONNECT_DELAY_MS)
                function done() {
                    window.clearTimeout(timer)
                    signal.removeEventListener('abort', done)
                    resolve()
                }
                signal.addEventListener('abort', done, { once: true })
            })
        }
    }
}

const browserDevscopeEventHub = new BrowserDevscopeEventHub()

function isPriorityBrowserAction(path: string[]): boolean {
    const method = path[path.length - 1] || ''
    return path[0] === 'runtimeActivation' || method === 'getUserHomePath'
        || method.startsWith('listInstalled')
        || PRIORITY_ACTION_PREFIXES.some((prefix) => method.startsWith(prefix))
}

function drainBrowserActionQueue(): void {
    while (activeBrowserActions < MAX_CONCURRENT_BROWSER_ACTIONS && browserActionQueue.length > 0) {
        const priorityIndex = browserActionQueue.findIndex((task) => task.priority)
        const taskIndex = priorityIndex >= 0
            ? priorityIndex
            : activeBackgroundBrowserActions < MAX_CONCURRENT_BACKGROUND_BROWSER_ACTIONS ? 0 : -1
        if (taskIndex < 0) return
        const [task] = browserActionQueue.splice(taskIndex, 1)
        activeBrowserActions += 1
        if (!task.priority) activeBackgroundBrowserActions += 1
        task.run()
    }
}

function getBrowserActionTimeout(path: string[]): number {
    if (path[0] === 'runtimeActivation') return 5_000
    return ['selectFolder', 'selectMarkdownFile', 'selectProjectIconFile'].includes(path[path.length - 1])
        ? INTERACTIVE_BROWSER_ACTION_TIMEOUT_MS
        : DEFAULT_BROWSER_ACTION_TIMEOUT_MS
}

function scheduleBrowserDevscope(path: string[], args: unknown[], priority: boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
        browserActionQueue.push({
            priority,
            run: () => {
                const controller = new AbortController()
                const timer = window.setTimeout(() => controller.abort(), getBrowserActionTimeout(path))
                void fetch(`${BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX}${BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE
                    },
                    body: JSON.stringify({ path, args }),
                    signal: controller.signal
                }).then(async (response) => {
                    const payload = JSON.parse(await response.text(), browserBridgeJsonReviver) as BrowserAssistantBridgeInvokeResponse
                    if (!response.ok || !payload.ok) {
                        throw new Error(payload.ok ? `Browser action failed (${response.status}).` : payload.error)
                    }
                    resolve(payload.value)
                }).catch((error) => {
                    reject(error instanceof DOMException && error.name === 'AbortError'
                        ? new Error(`Browser action ${path.join('.')} timed out.`)
                        : error)
                }).finally(() => {
                    window.clearTimeout(timer)
                    activeBrowserActions = Math.max(0, activeBrowserActions - 1)
                    if (!priority) activeBackgroundBrowserActions = Math.max(0, activeBackgroundBrowserActions - 1)
                    drainBrowserActionQueue()
                })
            }
        })
        drainBrowserActionQueue()
    })
}

function invokeBrowserDevscope(path: string[], args: unknown[]): Promise<unknown> {
    const priority = isPriorityBrowserAction(path)
    if (priority) return scheduleBrowserDevscope(path, args, true)

    let key: string | null = null
    try {
        key = JSON.stringify({ path, args })
    } catch {}
    if (key) {
        const existing = inFlightBackgroundBrowserActions.get(key)
        if (existing) return existing
    }
    const request = scheduleBrowserDevscope(path, args, false)
    if (key) {
        inFlightBackgroundBrowserActions.set(key, request)
        void request.finally(() => inFlightBackgroundBrowserActions.delete(key!)).catch(() => undefined)
    }
    return request
}

function eventFallback(value: unknown): (...args: unknown[]) => () => void {
    return typeof value === 'function'
        ? value as (...args: unknown[]) => () => void
        : () => () => {}
}

export function createLiveBrowserDevscopeAdapter(base: DevScopeApi): DevScopeApi {
    const namespaceCache = new Map<string, object>()
    return new Proxy(base as unknown as Record<string, unknown>, {
        get(target, property) {
            if (property === 'then' || isNativeOverlayMethod(property)) return undefined
            if (typeof property !== 'string') return Reflect.get(target, property)
            const value = target[property]
            if (property === 'window' || property === 'assistant' || property === 'updates' || property === 'secrets') return value
            const browserEventName = BROWSER_EVENT_METHODS[property as keyof typeof BROWSER_EVENT_METHODS]
            if (browserEventName) {
                return (callback: (payload: unknown) => void) => browserDevscopeEventHub.subscribe(browserEventName, callback)
            }
            if (ELECTRON_GUEST_ONLY_METHODS.has(property)) return value
            if ((value && typeof value === 'object') || LIVE_RELAY_NAMESPACES.has(property)) {
                const cached = namespaceCache.get(property)
                if (cached) return cached
                const namespaceTarget = value && typeof value === 'object'
                    ? value as Record<string, unknown>
                    : {}
                const namespace = new Proxy(namespaceTarget, {
                    get(namespaceTarget, method) {
                        if (method === 'then') return undefined
                        if (typeof method !== 'string') return Reflect.get(namespaceTarget, method)
                        const fallback = namespaceTarget[method]
                        const namespaceEventName = BROWSER_NAMESPACE_EVENT_METHODS[`${property}.${method}` as keyof typeof BROWSER_NAMESPACE_EVENT_METHODS]
                        if (namespaceEventName) {
                            return (callback: (payload: unknown) => void) => browserDevscopeEventHub.subscribe(namespaceEventName, callback)
                        }
                        if (property === 'agentControl' && AGENT_CONTROL_GUEST_ONLY_METHODS.has(method)) return fallback
                        if (method.startsWith('on')) return eventFallback(fallback)
                        return (...args: unknown[]) => invokeBrowserDevscope([property, method], args)
                    }
                })
                namespaceCache.set(property, namespace)
                return namespace
            }
            if (property.startsWith('on')) return eventFallback(value)
            return (...args: unknown[]) => invokeBrowserDevscope([property], args)
        }
    }) as unknown as DevScopeApi
}
