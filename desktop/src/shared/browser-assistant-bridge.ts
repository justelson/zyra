export const BROWSER_ASSISTANT_BRIDGE_HOST = '127.0.0.1'
export const BROWSER_ASSISTANT_BRIDGE_PORT = 47_831
export const BROWSER_ASSISTANT_BRIDGE_PORT_CANDIDATES = Array.from(
    { length: 10 },
    (_value, index) => BROWSER_ASSISTANT_BRIDGE_PORT + index
)
export const BROWSER_CLIENT_HOST_PORT = 47_821
export const BROWSER_CLIENT_HOST_ORIGIN = `http://${BROWSER_ASSISTANT_BRIDGE_HOST}:${BROWSER_CLIENT_HOST_PORT}`
export const BROWSER_ASSISTANT_BRIDGE_HEADER = 'x-zyra-browser-client'
export const BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE = 'assistant-v1'
export const BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER = 'x-zyra-browser-capability'
export const BROWSER_ASSISTANT_CLIENT_ID_HEADER = 'x-zyra-browser-client-id'
export const BROWSER_ASSISTANT_BRIDGE_PROXY_PREFIX = '/__zyra_browser_assistant'
export const BROWSER_ASSISTANT_BRIDGE_DESCRIPTOR_NAME = 'browser-assistant-bridge.json'
export const BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH = '/v1/assistant/invoke'
export const BROWSER_ASSISTANT_BRIDGE_EVENTS_PATH = '/v1/assistant/events'
export const BROWSER_REALTIME_VOICE_EVENTS_PATH = '/v1/assistant/realtime-voice/events'
export const BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH = '/v1/devscope/invoke'
export const BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH = '/v1/devscope/events'
export const BROWSER_FILE_BRIDGE_PATH = '/v1/files/content'
export const BROWSER_DEVSCOPE_RELAY_REQUEST_CHANNEL = 'zyra:browser-devscope:request'
export const BROWSER_DEVSCOPE_RELAY_RESPONSE_CHANNEL = 'zyra:browser-devscope:response'
export const BROWSER_DEVSCOPE_RELAY_EVENT_CHANNEL = 'zyra:browser-devscope:event'
export const BROWSER_DEVSCOPE_RELAY_READY_CHANNEL = 'zyra:browser-devscope:ready'
export const BROWSER_ASSISTANT_BRIDGE_HEALTH_PATH = '/v1/health'

export const BROWSER_ASSISTANT_BRIDGE_METHODS = [
    'bootstrap',
    'getSnapshot',
    'getFleetSnapshot',
    'agentAction',
    'workflowAction',
    'getStatus',
    'getAccountOverview',
    'redeemAccountReset',
    'getSessionTurnUsage',
    'listModels',
    'listProjects',
    'createProject',
    'associateProjectFolder',
    'removeProjectFolder',
    'updateProject',
    'dismissProjectCandidate',
    'connect',
    'disconnect',
    'createSession',
    'seedDevelopmentChatFixtures',
    'selectSession',
    'selectThread',
    'getThreadDetailBootstrap',
    'getHistoryPage',
    'getHistoryAroundMessage',
    'hydrateHistoryBody',
    'getReviewIndex',
    'getTurnDetail',
    'searchChats',
    'searchTurns',
    'renameSession',
    'regenerateSessionTitle',
    'archiveSession',
    'deleteSession',
    'deleteMessage',
    'clearLogs',
    'setSessionProject',
    'setSessionProjectPath',
    'setPlaygroundRoot',
    'createPlaygroundLab',
    'deletePlaygroundLab',
    'attachSessionToPlaygroundLab',
    'approvePendingPlaygroundLabRequest',
    'declinePendingPlaygroundLabRequest',
    'persistClipboardImage',
    'resolveClipboardAttachment',
    'newThread',
    'sendPrompt',
    'interruptTurn',
    'respondApproval',
    'respondUserInput',
    'startRealtimeVoice',
    'sendRealtimeVoiceMessage',
    'ingestRealtimeVoiceEvent',
    'stopRealtimeVoice',
    'getVoiceTranscriptionState',
    'transcribeVoice'
] as const

export type BrowserAssistantBridgeMethod = typeof BROWSER_ASSISTANT_BRIDGE_METHODS[number]

export type BrowserAssistantBridgeDescriptor = {
    host: typeof BROWSER_ASSISTANT_BRIDGE_HOST
    port: number
    capability: string
    pid: number
    createdAt: string
}

export type BrowserDevscopeBridgeInvokeRequest = {
    path: string[]
    args: unknown[]
}

export type BrowserDevscopeRelayRequest = BrowserDevscopeBridgeInvokeRequest & {
    requestId: string
}

export type BrowserDevscopeRelayResponse = {
    requestId: string
    ok: boolean
    value?: unknown
    error?: string
}

export const BROWSER_DEVSCOPE_EVENT_NAMES = [
    'agentControlCursor',
    'agentControlState',
    'gitCloneProgress',
    'previewTerminal',
    'pythonPreview',
    'preferencesChanged',
    'onboardingChanged'
] as const

export type BrowserDevscopeEventName = typeof BROWSER_DEVSCOPE_EVENT_NAMES[number]

export type BrowserDevscopeRelayEvent = {
    event: BrowserDevscopeEventName
    payload: unknown
}

export type BrowserDevscopeStreamEvent = BrowserDevscopeRelayEvent & {
    streamId: string
    sequence: number
}

export function isBrowserDevscopeRelayEvent(value: unknown): value is BrowserDevscopeRelayEvent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidate = value as Partial<BrowserDevscopeRelayEvent>
    return typeof candidate.event === 'string'
        && (BROWSER_DEVSCOPE_EVENT_NAMES as readonly string[]).includes(candidate.event)
        && Object.prototype.hasOwnProperty.call(candidate, 'payload')
}

export function isBrowserDevscopeStreamEvent(value: unknown): value is BrowserDevscopeStreamEvent {
    if (!isBrowserDevscopeRelayEvent(value)) return false
    const candidate = value as Partial<BrowserDevscopeStreamEvent>
    return typeof candidate.streamId === 'string'
        && candidate.streamId.length > 0
        && candidate.streamId.length <= 128
        && Number.isSafeInteger(candidate.sequence)
        && Number(candidate.sequence) > 0
}

export type BrowserAssistantBridgeInvokeRequest = {
    method: BrowserAssistantBridgeMethod
    args: unknown[]
    clientId?: string
}

export type BrowserAssistantBridgeInvokeResponse =
    | { ok: true; value: unknown }
    | { ok: false; error: string }

export function isBrowserAssistantBridgeMethod(value: unknown): value is BrowserAssistantBridgeMethod {
    return typeof value === 'string'
        && (BROWSER_ASSISTANT_BRIDGE_METHODS as readonly string[]).includes(value)
}

const FORBIDDEN_BROWSER_DEVSCOPE_METHODS = new Set([
    'registerPreviewTerminalWorkspace',
    'releasePreviewTerminalWorkspace',
    'createPreviewTerminal',
    'listPreviewTerminalSessions',
    'writePreviewTerminal',
    'setPreviewTerminalTitle',
    'resizePreviewTerminal',
    'clearPreviewTerminal',
    'closePreviewTerminal',
    'listBrowserDownloads',
    'actOnBrowserDownload',
    'getBrowserDownloadPreviewTarget',
    'listBrowserDownloadsFolder',
    'actOnBrowserDownloadsFolderEntry',
    'getBrowserPageIcon',
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
    'openBrowserPreviewArtifact',
    'revealBrowserPreviewArtifact',
    'copyBrowserPreviewArtifact',
    'startBrowserPreviewAnnotation',
    'cancelBrowserPreviewAnnotation',
    'startBrowserPreviewRecording',
    'stopBrowserPreviewRecording',
    'saveBrowserPreviewRecording'
])

const FORBIDDEN_BROWSER_AGENT_CONTROL_METHODS = new Set([
    'acknowledgeBrowserSurfaceRequest',
    'bindBrowserTab',
    'claimBrowserSurfaceRequest',
    'completeBrowserSurfaceRequest',
    'updateWorkspaceState'
])

const FORBIDDEN_BROWSER_DEVSCOPE_PATH_SEGMENTS = new Set([
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    'apply',
    'bind',
    'call'
])

export function isBrowserDevscopeBridgePath(value: unknown): value is string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) return false
    if (!value.every((segment) => (
        typeof segment === 'string'
        && /^[A-Za-z][A-Za-z0-9]*$/.test(segment)
        && !FORBIDDEN_BROWSER_DEVSCOPE_PATH_SEGMENTS.has(segment)
    ))) return false
    if (value[0] === 'window' || value[0] === 'assistant' || value[0] === 'assistantUtility' || value[0] === 'browserView' || value[0] === 'secrets' || value[0] === 'analytics') return false
    const method = value[value.length - 1]
    if (FORBIDDEN_BROWSER_DEVSCOPE_METHODS.has(method)) return false
    if (value[0] === 'agentControl' && FORBIDDEN_BROWSER_AGENT_CONTROL_METHODS.has(method)) return false
    if (value[0] === 'onboarding') return value.length === 2 && method === 'getState'
    return method !== 'getPathForFile' && !method.startsWith('on')
}

export function isBrowserDevscopePathAllowedBeforeOnboarding(path: readonly string[]): boolean {
    return path.length === 2
        && (
            (path[0] === 'onboarding' && path[1] === 'getState')
            || (path[0] === 'preferences' && path[1] === 'get')
        )
}
