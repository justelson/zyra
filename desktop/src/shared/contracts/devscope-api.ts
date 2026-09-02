import type {
    AssistantApprovalResponseInput,
    AssistantAccountOverviewPayload,
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantAttachSessionToPlaygroundLabInput,
    AssistantBootstrapPayload,
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantDeletePlaygroundLabInput,
    AssistantDeleteMessageInput,
    AssistantEventStreamPayload,
    AssistantFleetOperationResultPayload,
    AssistantFleetSnapshotPayload,
    AssistantGetHistoryPageInput,
    AssistantHistoryBodyResultPayload,
    AssistantHydrateHistoryBodyInput,
    AssistantGetReviewIndexInput,
    AssistantGetSessionTurnUsageInput,
    AssistantGetTurnDetailInput,
    AssistantIngestRealtimeVoiceEventInput,
    AssistantModelInfo,
    AssistantPlaygroundResultPayload,
    AssistantPromptResourcesPayload,
    AssistantPersistClipboardImageInput,
    AssistantRealtimeVoiceEvent,
    AssistantRedeemAccountResetInput,
    AssistantRedeemAccountResetPayload,
    AssistantReviewIndexResultPayload,
    AssistantRuntimeStatus,
    AssistantSearchTurnsInput,
    AssistantSearchTurnsResultPayload,
    AssistantSendPromptOptions,
    AssistantSendRealtimeVoiceMessageInput,
    AssistantSelectThreadInput,
    AssistantSkillSourceOverviewPayload,
    AssistantSkillSourceSettings,
    AssistantStartRealtimeVoiceInput,
    AssistantSetPlaygroundRootInput,
    AssistantSessionTurnUsageResultPayload,
    AssistantShellSnapshot,
    AssistantSnapshot,
    AssistantThreadDetailResultPayload,
    AssistantHistoryPageResultPayload,
    AssistantTurnDetailResultPayload,
    AssistantTranscribeVoiceInput,
    AssistantVoiceTranscriptionState,
    AssistantUserInputResponseInput,
    FleetOperationInput
} from '../assistant/contracts'
import type {
    DevScopeGitBranchSummary,
    DevScopeGitCommit,
    DevScopeGitFileStatus,
    DevScopeGitHistoryCount,
    DevScopeGitHubPublishContext,
    DevScopeGitRemoteSummary,
    DevScopeGitStashSummary,
    DevScopeGitStatusDetail,
    DevScopeGitStatusEntryStats,
    DevScopeGitSyncStatus,
    DevScopeGitTagSummary,
    DevScopeProjectGitOverviewItem,
    DevScopePullRequestDraftSource,
    DevScopePullRequestProvider,
    DevScopePullRequestSummary,
    DevScopeCreatePullRequestInput,
    DevScopeCommitPushPullRequestInput,
    DevScopeGitTextProvider
} from './devscope-git-contracts'
import type {
    DevScopeFileItem,
    DevScopeFileTreeNode,
    DevScopeFolderItem,
    DevScopeIndexedPathSearchInput,
    DevScopeIndexedPathSearchResult,
    DevScopeIndexedProject,
    DevScopeInstalledIde,
    DevScopeLocalServer,
    DevScopePathInfo,
    DevScopeProcessInfo,
    DevScopeProject,
    DevScopeProjectDetails,
    DevScopePythonPreviewEvent
} from './devscope-project-contracts'
import type { ZyraMemoryApi } from './memory-contracts'
import type { DevScopeFontsApi } from './font-contracts'
import type {
    ControlCursorState,
    ControlGrant,
    ControlStateSnapshot,
    ControlTarget,
    ControlWorkspaceSnapshot,
    ControlWindowCandidate
} from '../agent-control/contracts'
import type {
    BrowserSurfaceClaim,
    BrowserSurfaceOpenAcknowledgement,
    BrowserSurfaceOpenCompletion,
    BrowserSurfaceOpenRequest,
    RendererControlGrantInput
} from '../agent-control/protocol'
import type { ZyraClientPlatform } from '../platform-window-chrome'
import type { BrowserShortcutAction } from '../browser-shortcuts'
import type { BrowserPopupCommand, BrowserPopupState, BrowserPopupSummary } from '../browser-popup'
import type { BrowserDownloadAction, BrowserDownloadActionResult, BrowserDownloadPreviewTarget, BrowserDownloadRecord, BrowserDownloadsFolderAction, BrowserDownloadsFolderActionResult, BrowserDownloadsFolderEntry } from '../browser-downloads'
import type { BrowserViewApi } from '../browser-view'
import type { AssistantUtilityApi } from '../assistant/utility-window'
import type {
    ExternalBrowserHistoryImportInput,
    ExternalBrowserHistoryImportResult,
    ExternalBrowserHistoryScanResult
} from '../external-browser-history-contracts'
import type {
    AccountConnectionAnalyticsInput,
    AccountConnectionStatusInput,
    BeginOnboardingReviewInput,
    CancelOnboardingReviewInput,
    CommitOnboardingStepInput,
    DisconnectOpenAIInput,
    NavigateOnboardingInput,
    OnboardingAuthStatus,
    OnboardingSnapshot,
    OpenAIConnectionsStatus,
    UpdateOnboardingAppearanceInput
} from '../onboarding/contracts'
import type {
    DevicePreferencesChangedEvent,
    DevicePreferencesSnapshot,
    GetDevicePreferencesInput,
    UpdateDevicePreferencesInput
} from '../preferences/contracts'
import type {
    BrowserIntegrationSecretStatus,
    HostedAiSecretStatus,
    UpdateBrowserIntegrationSecretsInput,
    UpdateHostedAiSecretsInput
} from '../preferences/secrets-contracts'

export * from './devscope-git-contracts'
export * from './devscope-project-contracts'
export * from './memory-contracts'
export * from './font-contracts'
export * from '../browser-downloads'

export type DevScopeOk<T = Record<string, unknown>> = { success: true } & T
export type DevScopeErr = { success: false; error: string }
export type DevScopeResult<T = Record<string, unknown>> = DevScopeOk<T> | DevScopeErr

export type DevScopeProtectedMediaStatus = {
    supported: boolean
    ready: boolean
    restartRequired: boolean
    componentVersion: string | null
    vmpLevel: 'development' | 'production'
    message: string | null
}

export type DevScopeBrowserPreviewConfig = {
    partition: string
    webPreferences: string
    profileScope: 'global'
    persistent: true
    protectedMedia: DevScopeProtectedMediaStatus
}

export type DevScopeBrowserHistoryEntry = {
    url: string
    title: string
    faviconUrl: string | null
    lastVisitedAt: string
    visitCount: number
}

export type DevScopeBrowserHistoryRecordInput = {
    url: string
    title?: string | null
    faviconUrl?: string | null
    incrementVisit?: boolean
}

export type DevScopeBrowserAdBlockStatus = {
    enabled: boolean
    ready: boolean
    engine: 'Ghostery'
    error: string | null
}

export type DevScopeBrowserAdDetection = {
    pageOrigin: string
    guestWebContentsId: number | null
    detectedAt: string
}

export const BROWSER_ADBLOCK_DETECTED_CHANNEL = 'devscope:browserPreview:adDetected'
export const BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL = 'devscope:browserPreview:openTabRequested'
export const BROWSER_PREVIEW_SHORTCUT_CHANNEL = 'devscope:browserPreview:shortcut'
export const BROWSER_THREAT_BLOCKED_CHANNEL = 'devscope:browserPreview:threatBlocked'

export type DevScopeBrowserThreatNavigationKind = 'current-tab' | 'new-tab' | 'popup'

export type DevScopeBrowserThreatWarning = {
    decisionId: string
    url: string
    hostname: string
    threatType: 'phishing'
    source: 'phishtank' | 'test'
    sourceGuestWebContentsId: number
    blockedGuestWebContentsId: number
    navigationKind: DevScopeBrowserThreatNavigationKind
    previousUrl: string
    blockedAt: string
}

export type DevScopeBrowserOpenTabRequest = {
    sourceGuestWebContentsId: number
    url: string
    activate: boolean
}

export type DevScopeBrowserShortcutEvent = {
    sourceGuestWebContentsId: number
    action: BrowserShortcutAction
}

export type DevScopeBrowserBackgroundCategory = 'all' | 'forest-paths' | 'mountain-highs' | 'ocean-moods' | 'desert-dreams' | 'water-in-motion' | 'wildflower-party' | 'animal-cameos' | 'ice-aurora' | 'earth-above'

export type DevScopeBrowserRemoteBackground = {
    id: string
    provider: 'unsplash'
    category: DevScopeBrowserBackgroundCategory
    imageUrl: string
    thumbnailUrl: string
    color: string | null
    alt: string
    photographer: string
    photographerUrl: string
    photoUrl: string
    downloadLocation: string
}

export type DevScopeBrowserBackgroundProviderStatus = {
    unsplashConfigured: boolean
    persistenceAvailable: boolean
}

export type DevScopeBrowserLinkPreview = {
    url: string
    title: string | null
    description: string | null
    imageUrl: string | null
    siteName: string | null
}

export type DevScopeBrowserGuestTargetInput = {
    guestWebContentsId: number
    tabId: string
}

export type DevScopeBrowserThreatCheckInput = DevScopeBrowserGuestTargetInput & {
    url: string
}

export type DevScopeBrowserColorScheme = 'system' | 'light' | 'dark'

export type DevScopeBrowserCaptureArtifact = {
    artifactId: string
    tabId: string
    kind: 'screenshot' | 'recording'
    mimeType: string
    sizeBytes: number
    createdAt: string
    width?: number
    height?: number
    thumbnailDataUrl?: string
}

export type DevScopeBrowserRecordingFrame = {
    tabId: string
    data: string
    width: number
    height: number
    receivedAt: string
}

export type DevScopeBrowserAnnotationPoint = { x: number; y: number }
export type DevScopeBrowserAnnotationRect = { x: number; y: number; width: number; height: number }

export type DevScopeBrowserPickedElement = {
    id: string
    tabId: string
    url: string | null
    title: string | null
    selector: string
    tagName: string
    attributes: Record<string, string>
    bounds: DevScopeBrowserAnnotationRect | null
    createdAt: string
}

export type DevScopeBrowserAnnotationRegion = {
    id: string
    rect: DevScopeBrowserAnnotationRect
}

export type DevScopeBrowserAnnotationStroke = {
    id: string
    color: string
    width: number
    points: DevScopeBrowserAnnotationPoint[]
    bounds: DevScopeBrowserAnnotationRect
}

export type DevScopeBrowserAnnotationStyleChange = {
    targetId: string
    selector: string | null
    property: string
    previousValue: string
    value: string
}

export type DevScopeBrowserAnnotationDraft = {
    tabId: string
    url: string | null
    title: string | null
    comment: string
    elements: DevScopeBrowserPickedElement[]
    regions: DevScopeBrowserAnnotationRegion[]
    strokes: DevScopeBrowserAnnotationStroke[]
    styleChanges: DevScopeBrowserAnnotationStyleChange[]
}

export type DevScopeBrowserAnnotationPayload = DevScopeBrowserAnnotationDraft & {
    id: string
    createdAt: string
}

export type DevScopeBrowserAnnotationTheme = {
    colorScheme: 'light' | 'dark'
    background: string
    foreground: string
    popover: string
    mutedForeground: string
    border: string
    primary: string
    primaryForeground: string
    fontFamily: string
}

export type DevScopeBrowserAnnotationInput = DevScopeBrowserGuestTargetInput & {
    theme: DevScopeBrowserAnnotationTheme
}

export const BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL = 'devscope:browserPreview:recordingFrame'

export type DevScopePreviewTerminalWorkspaceOwner =
    | { kind: 'main-workspace'; runtimeId: string }
    | { kind: 'utility-tab'; tabId: string }

export type DevScopePreviewTerminalAccess = {
    workspaceCapability?: string
}

export type DevScopePreviewTerminalEvent = {
    sessionId: string
    type: 'started' | 'output' | 'exit' | 'error' | 'title' | 'clear'
    data?: string
    message?: string
    shell?: string
    cwd?: string
    title?: string
    groupKey?: string
    status?: 'running' | 'exited' | 'error'
    exitCode?: number
}

export const GIT_CLONE_PROGRESS_CHANNEL = 'devscope:gitClone:progress'

export type DevScopeGitCloneStatus = 'running' | 'success' | 'error'

export type DevScopeGitCloneInput = {
    cloneId: string
    repoUrl: string
    destinationDirectory: string
    targetName?: string
}

export type DevScopeGitCloneProgressEvent = {
    cloneId: string
    status: DevScopeGitCloneStatus
    message: string
    repoName?: string
    clonePath?: string
    phase?: string
    percent?: number
    error?: string
}

export type DevScopeGitCloneResult = {
    cloneId: string
    repoName: string
    clonePath: string
}

export type DevScopePreviewTerminalSessionSummary = {
    sessionId: string
    title: string
    shell: string
    cwd: string
    groupKey: string
    status: 'running' | 'exited' | 'error'
    startedAt: number
    lastActivityAt: number
    exitCode?: number | null
    recentOutput?: string
}

export type DevScopeReleaseChannel = 'alpha' | 'beta' | 'stable'
export type DevScopeUpdateStatus =
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'up-to-date'
    | 'error'

export type DevScopeUpdateErrorContext = 'check' | 'download' | 'install' | null

export type DevScopeUpdateState = {
    enabled: boolean
    status: DevScopeUpdateStatus
    currentVersion: string
    currentDisplayVersion: string
    channel: DevScopeReleaseChannel
    repository: string
    releasePageUrl: string
    disabledReason: string | null
    availableVersion: string | null
    availableDisplayVersion: string | null
    downloadedVersion: string | null
    downloadedDisplayVersion: string | null
    downloadPercent: number | null
    checkedAt: string | null
    message: string | null
    errorContext: DevScopeUpdateErrorContext
    canRetry: boolean
}

export type DevScopeUpdateActionResult = {
    accepted: boolean
    completed: boolean
    state: DevScopeUpdateState
}

export type DevScopeAppMenuCommand = 'new-chat' | 'search' | 'settings' | 'reload' | 'about'

export type DevScopeWindowRuntimeInfo = {
    platform: ZyraClientPlatform
    architecture: string
    appVersion: string
    electronVersion: string | null
    isPackaged: boolean
    nativeFrame: boolean
    customWindowControls: boolean
}

export type DevScopeTerminalCommandStatus = {
    path: string
    installed: boolean
    managed: boolean
    pathConfigured: boolean
}

export interface DevScopeWindowApi {
    minimize: () => void
    maximize: () => void
    close: () => void
    setFullScreen: (enabled: boolean) => void
    isFullScreen: () => Promise<boolean>
    isMaximized: () => Promise<boolean>
    getRuntimeInfo: () => Promise<DevScopeWindowRuntimeInfo>
    getTerminalCommandStatus: () => Promise<DevScopeResult<{ status: DevScopeTerminalCommandStatus }>>
    installTerminalCommand: () => Promise<DevScopeResult<{ status: DevScopeTerminalCommandStatus }>>
    removeTerminalCommand: () => Promise<DevScopeResult<{ status: DevScopeTerminalCommandStatus }>>
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
    onFullScreenChange: (callback: (fullscreen: boolean) => void) => () => void
    onAppMenuCommand: (callback: (command: DevScopeAppMenuCommand) => void) => () => void
}

export interface DevScopeBrowserPopupApi {
    getState: () => Promise<DevScopeResult<{ state: BrowserPopupState }>>
    command: (command: BrowserPopupCommand) => Promise<DevScopeResult<{ state: BrowserPopupState }>>
    listOpenWindows: () => Promise<DevScopeResult<{ windows: BrowserPopupSummary[] }>>
    focusWindow: (id: string) => Promise<DevScopeResult>
    listDownloads: () => Promise<DevScopeResult<{ downloads: BrowserDownloadRecord[] }>>
    actOnDownload: (action: BrowserDownloadAction) => Promise<DevScopeResult<BrowserDownloadActionResult>>
    onDownloadsChanged: (callback: (downloads: BrowserDownloadRecord[]) => void) => () => void
    onStateChange: (callback: (state: BrowserPopupState) => void) => () => void
    onFocusAddress: (callback: () => void) => () => void
    onOpenWindowsChange: (callback: (windows: BrowserPopupSummary[]) => void) => () => void
}

export interface DevScopePreferencesApi {
    get: (input: GetDevicePreferencesInput) => Promise<DevScopeResult<{ snapshot: DevicePreferencesSnapshot }>>
    update: (input: UpdateDevicePreferencesInput) => Promise<DevScopeResult<{ snapshot: DevicePreferencesSnapshot }>>
    onChanged: (callback: (event: DevicePreferencesChangedEvent) => void) => () => void
}

export interface DevScopeSecretsApi {
    updateHostedAiKeys: (input: UpdateHostedAiSecretsInput) => Promise<DevScopeResult<{ status: HostedAiSecretStatus }>>
    migrateLegacyHostedAiKeys: (input: UpdateHostedAiSecretsInput) => Promise<DevScopeResult<{ status: HostedAiSecretStatus }>>
    updateBrowserIntegrationSecrets: (input: UpdateBrowserIntegrationSecretsInput) => Promise<DevScopeResult<{ status: BrowserIntegrationSecretStatus }>>
}

export interface DevScopeOnboardingApi {
    getState: () => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    getAuthStatus: () => Promise<DevScopeResult<{ status: OnboardingAuthStatus }>>
    getConnectionsStatus: (input?: AccountConnectionStatusInput) => Promise<DevScopeResult<{ status: OpenAIConnectionsStatus }>>
    connectChatGpt: (input?: AccountConnectionAnalyticsInput) => Promise<DevScopeResult<{ status: OnboardingAuthStatus }>>
    connectApiKey: (apiKey: string, input?: AccountConnectionAnalyticsInput) => Promise<DevScopeResult<{ status: OnboardingAuthStatus }>>
    disconnectOpenAI: (input: DisconnectOpenAIInput) => Promise<DevScopeResult<{ status: OpenAIConnectionsStatus }>>
    updateAppearance: (input: UpdateOnboardingAppearanceInput) => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    commitStep: (input: CommitOnboardingStepInput) => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    navigate: (input: NavigateOnboardingInput) => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    beginReview: (input: BeginOnboardingReviewInput) => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    cancelReview: (input: CancelOnboardingReviewInput) => Promise<DevScopeResult<{ snapshot: OnboardingSnapshot }>>
    onChanged: (callback: (snapshot: OnboardingSnapshot) => void) => () => void
}

export interface DevScopeUpdatesApi {
    getState: () => Promise<DevScopeUpdateState>
    checkForUpdates: () => Promise<DevScopeUpdateActionResult>
    downloadUpdate: () => Promise<DevScopeUpdateActionResult>
    installUpdate: () => Promise<DevScopeUpdateActionResult>
    onStateChange: (callback: (state: DevScopeUpdateState) => void) => () => void
}

export interface DevScopeTerminalApi {
    [method: string]: (...args: any[]) => any
}

export interface DevScopeAgentScopeApi {
    [method: string]: (...args: any[]) => any
}

export interface DevScopeAgentControlApi {
    getState: () => Promise<DevScopeResult<{ state: ControlStateSnapshot }>>
    bindBrowserTab: (input: { guestWebContentsId: number; tabId: string; threadId: string; sessionMode: 'normal' | 'incognito' }) => Promise<DevScopeResult<{ target: ControlTarget }>>
    acknowledgeBrowserSurfaceRequest: (input: BrowserSurfaceOpenAcknowledgement) => Promise<DevScopeResult<{ accepted: boolean }>>
    completeBrowserSurfaceRequest: (input: BrowserSurfaceOpenCompletion) => Promise<DevScopeResult<{ completed: boolean }>>
    claimBrowserSurfaceRequest: (input: BrowserSurfaceClaim) => Promise<DevScopeResult<{ claimed: boolean }>>
    updateWorkspaceState: (input: ControlWorkspaceSnapshot | null) => Promise<DevScopeResult<{ workspace: ControlWorkspaceSnapshot | null }>>
    approveGrant: (input: RendererControlGrantInput) => Promise<DevScopeResult<{ grant: ControlGrant }>>
    rejectGrant: (requestId: string) => Promise<DevScopeResult<{ rejected: boolean }>>
    approveAction: (requestId: string) => Promise<DevScopeResult<{ approved: boolean }>>
    rejectAction: (requestId: string) => Promise<DevScopeResult<{ rejected: boolean }>>
    revokeGrant: (grantId: string) => Promise<DevScopeResult<{ revoked: boolean }>>
    emergencyStop: () => Promise<DevScopeResult<{ stopped: boolean }>>
    clearAudit: () => Promise<DevScopeResult<{ cleared: boolean }>>
    startChromePairing: () => Promise<DevScopeResult<{ pairing: ControlStateSnapshot['pairing'] }>>
    stopChromePairing: () => Promise<DevScopeResult<{ pairing: ControlStateSnapshot['pairing'] }>>
    listWindows: () => Promise<DevScopeResult<{ windows: ControlWindowCandidate[] }>>
    selectWindow: (windowToken: string) => Promise<DevScopeResult<{ target: ControlTarget }>>
    onBrowserSurfaceRequest: (callback: (request: BrowserSurfaceOpenRequest) => void) => () => void
    onBrowserSurfaceCancel: (callback: (requestId: string) => void) => () => void
    onStateChange: (callback: (state: ControlStateSnapshot) => void) => () => void
    onCursorChange: (callback: (cursor: ControlCursorState) => void) => () => void
}

export interface DevScopeAssistantApi {
    subscribe: () => Promise<DevScopeResult>
    unsubscribe: () => Promise<DevScopeResult>
    bootstrap: () => Promise<AssistantBootstrapPayload>
    getSnapshot: () => Promise<AssistantShellSnapshot>
    getFleetSnapshot: (threadId: string) => Promise<DevScopeResult<AssistantFleetSnapshotPayload>>
    agentAction: (input: FleetOperationInput) => Promise<DevScopeResult<AssistantFleetOperationResultPayload>>
    workflowAction: (input: FleetOperationInput) => Promise<DevScopeResult<AssistantFleetOperationResultPayload>>
    getStatus: () => Promise<AssistantRuntimeStatus>
    getAccountOverview: (forceRefresh?: boolean) => Promise<DevScopeResult<AssistantAccountOverviewPayload>>
    redeemAccountReset: (input: AssistantRedeemAccountResetInput) => Promise<DevScopeResult<AssistantRedeemAccountResetPayload>>
    getSessionTurnUsage: (input?: AssistantGetSessionTurnUsageInput) => Promise<DevScopeResult<AssistantSessionTurnUsageResultPayload>>
    listModels: (forceRefresh?: boolean) => Promise<DevScopeResult<{ models: AssistantModelInfo[] }>>
    listPromptResources: (projectPath?: string | null, forceRefresh?: boolean) => Promise<DevScopeResult<AssistantPromptResourcesPayload>>
    getSkillSourceOverview: (projectPath?: string | null) => Promise<DevScopeResult<AssistantSkillSourceOverviewPayload>>
    updateSkillSourceSettings: (settings: AssistantSkillSourceSettings, projectPath?: string | null) => Promise<DevScopeResult<AssistantSkillSourceOverviewPayload>>
    connect: (options?: AssistantConnectOptions) => Promise<DevScopeResult<{ threadId: string }>>
    disconnect: (sessionId?: string) => Promise<DevScopeResult>
    createSession: (input?: AssistantCreateSessionInput) => Promise<DevScopeResult<{ sessionId: string }>>
    selectSession: (sessionId: string) => Promise<DevScopeResult<{ sessionId: string; snapshot?: AssistantShellSnapshot; status?: AssistantRuntimeStatus }>>
    selectThread: (input: AssistantSelectThreadInput) => Promise<DevScopeResult<{ sessionId: string; threadId: string; snapshot?: AssistantShellSnapshot; status?: AssistantRuntimeStatus }>>
    getThreadDetailBootstrap: (threadId: string) => Promise<DevScopeResult<AssistantThreadDetailResultPayload>>
    getHistoryPage: (input: AssistantGetHistoryPageInput) => Promise<DevScopeResult<AssistantHistoryPageResultPayload>>
    hydrateHistoryBody: (input: AssistantHydrateHistoryBodyInput) => Promise<DevScopeResult<AssistantHistoryBodyResultPayload>>
    getReviewIndex: (input: AssistantGetReviewIndexInput) => Promise<DevScopeResult<AssistantReviewIndexResultPayload>>
    getTurnDetail: (input: AssistantGetTurnDetailInput) => Promise<DevScopeResult<AssistantTurnDetailResultPayload>>
    searchTurns: (input: AssistantSearchTurnsInput) => Promise<DevScopeResult<AssistantSearchTurnsResultPayload>>
    renameSession: (sessionId: string, title: string) => Promise<DevScopeResult>
    regenerateSessionTitle: (sessionId: string) => Promise<DevScopeResult<{ title: string }>>
    archiveSession: (sessionId: string, archived?: boolean) => Promise<DevScopeResult>
    deleteSession: (sessionId: string) => Promise<DevScopeResult>
    deleteMessage: (input: AssistantDeleteMessageInput) => Promise<DevScopeResult>
    clearLogs: (input?: AssistantClearLogsInput) => Promise<DevScopeResult>
    setSessionProjectPath: (sessionId: string, projectPath: string | null) => Promise<DevScopeResult>
    setPlaygroundRoot: (input: AssistantSetPlaygroundRootInput) => Promise<DevScopeResult<AssistantPlaygroundResultPayload>>
    createPlaygroundLab: (input: AssistantCreatePlaygroundLabInput) => Promise<DevScopeResult<{ labId: string; sessionId?: string | null } & AssistantPlaygroundResultPayload>>
    deletePlaygroundLab: (input: AssistantDeletePlaygroundLabInput) => Promise<DevScopeResult<AssistantPlaygroundResultPayload>>
    attachSessionToPlaygroundLab: (input: AssistantAttachSessionToPlaygroundLabInput) => Promise<DevScopeResult<AssistantPlaygroundResultPayload>>
    approvePendingPlaygroundLabRequest: (input: AssistantApprovePendingPlaygroundLabRequestInput) => Promise<DevScopeResult<{ sessionId: string; labId: string } & AssistantPlaygroundResultPayload>>
    declinePendingPlaygroundLabRequest: (input: AssistantDeclinePendingPlaygroundLabRequestInput) => Promise<DevScopeResult>
    getPathForFile: (file: File) => string
    persistClipboardImage: (input: AssistantPersistClipboardImageInput) => Promise<DevScopeResult<{ path: string }>>
    resolveClipboardAttachment: (input: { reference: string }) => Promise<DevScopeResult<{ path: string | null }>>
    newThread: (sessionId?: string) => Promise<DevScopeResult<{ threadId: string }>>
    sendPrompt: (prompt: string, options?: AssistantSendPromptOptions) =>
        Promise<DevScopeResult<{ sessionId: string; threadId: string; turnId: string }>>
    interruptTurn: (turnId?: string, sessionId?: string) => Promise<DevScopeResult>
    respondApproval: (input: AssistantApprovalResponseInput) => Promise<DevScopeResult>
    respondUserInput: (input: AssistantUserInputResponseInput) => Promise<DevScopeResult>
    startRealtimeVoice: (input: AssistantStartRealtimeVoiceInput) => Promise<DevScopeResult<{
        threadId: string
        conversationId?: string
        adapterSessionId?: string
        realtimeSessionId?: string
        realtimeSessionGeneration?: number
        sdp: string
        realtimeVersion: string
    }>>
    sendRealtimeVoiceMessage: (input: AssistantSendRealtimeVoiceMessageInput) => Promise<DevScopeResult<{ mode: 'text-turn' | 'vision-turn' }>>
    ingestRealtimeVoiceEvent: (input: AssistantIngestRealtimeVoiceEventInput) => Promise<DevScopeResult>
    stopRealtimeVoice: () => Promise<DevScopeResult>
    onRealtimeVoiceEvent: (callback: (event: AssistantRealtimeVoiceEvent) => void) => () => void
    getVoiceTranscriptionState: () => Promise<DevScopeResult<{ state: AssistantVoiceTranscriptionState }>>
    transcribeVoice: (input: AssistantTranscribeVoiceInput) => Promise<DevScopeResult<{ text: string }>>
    onEvent: (callback: (event: AssistantEventStreamPayload) => void) => () => void
}

export interface DevScopeApi {
    // Settings + AI
    setStartupSettings: (settings: { openAtLogin: boolean; openAsHidden: boolean }) => Promise<DevScopeResult>
    getStartupSettings: () => Promise<DevScopeResult>
    listInstalledPackageRuntimes: () => Promise<DevScopeResult<{ runtimes: DevScopeInstalledPackageRuntime[] }>>
    getAiDebugLogs: (limit?: number) => Promise<DevScopeResult>
    clearAiDebugLogs: () => Promise<DevScopeResult>
    testGroqConnection: (apiKey: string) => Promise<DevScopeResult>
    testGeminiConnection: (apiKey: string) => Promise<DevScopeResult>
    testCodexConnection: (model?: string) => Promise<DevScopeResult>
    generateCommitMessage: (provider: DevScopeGitTextProvider, apiKey: string, diff: string, model?: string) => Promise<DevScopeResult<{ message: string }>>

    // Projects + Git
    selectFolder: () => Promise<DevScopeResult<{ folderPath?: string; cancelled?: boolean }>>
    selectMarkdownFile: () => Promise<DevScopeResult<{ filePath?: string; cancelled?: boolean }>>
    selectProjectIconFile: () => Promise<DevScopeResult<{ filePath?: string; cancelled?: boolean }>>
    getUserHomePath: () => Promise<DevScopeResult<{ path: string }>>
    scanProjects: (folderPath: string, options?: { forceRefresh?: boolean }) => Promise<DevScopeResult<{ projects: DevScopeProject[]; folders: DevScopeFolderItem[]; files: DevScopeFileItem[]; cached?: boolean; cachedAt?: number }>>
    openInExplorer: (path: string) => Promise<DevScopeResult>
    openInTerminal: (path: string, preferredShell?: 'powershell' | 'cmd', initialCommand?: string) => Promise<DevScopeResult>
    listInstalledIdes: () => Promise<DevScopeResult<{ ides: DevScopeInstalledIde[] }>>
    openProjectInIde: (projectPath: string, ideId: string) => Promise<DevScopeResult<{ ide: DevScopeInstalledIde }>>
    installProjectDependencies: (
        projectPath: string,
        options?: { onlyMissing?: boolean }
    ) => Promise<DevScopeResult<{
        manager: 'npm' | 'pnpm' | 'yarn' | 'bun'
        durationMs: number
        message?: string
        output?: string
        installStatus?: {
            installed: boolean | null
            checked: boolean
            ecosystem: 'node' | 'unknown'
            totalPackages: number
            installedPackages: number
            missingPackages: number
            missingDependencies?: string[]
            missingSample?: string[]
            reason?: string
        } | null
    }>>
    getProjectDetails: (projectPath: string) => Promise<DevScopeResult<{ project: DevScopeProjectDetails }>>
    recordProjectOpen: (projectPath: string) => Promise<DevScopeResult>
    getFileTree: (
        projectPath: string,
        options?: {
            showHidden?: boolean
            maxDepth?: number
            rootPath?: string
            includeGitStatus?: boolean
            includeFileSize?: boolean
            includeDirectoryChildHint?: boolean
        }
    ) => Promise<DevScopeResult<{ tree: DevScopeFileTreeNode[] }>>
    getGitHistory: (
        projectPath: string,
        limit?: number,
        options?: { all?: boolean; includeStats?: boolean }
    ) => Promise<DevScopeResult<{ commits: DevScopeGitCommit[] }>>
    getGitHistoryCount: (
        projectPath: string,
        options?: { all?: boolean }
    ) => Promise<DevScopeResult<DevScopeGitHistoryCount>>
    getGitCommitStats: (
        projectPath: string,
        commitHashes: string[]
    ) => Promise<DevScopeResult<{ commits: DevScopeGitCommit[] }>>
    getCommitDiff: (projectPath: string, commitHash: string) => Promise<DevScopeResult<{ diff: string }>>
    getWorkingDiff: (
        projectPath: string,
        filePath?: string,
        mode?: 'combined' | 'staged' | 'unstaged'
    ) => Promise<DevScopeResult<{ diff: string }>>
    getWorkingChangesForAI: (projectPath: string) => Promise<DevScopeResult<{ context: string }>>
    getGitStatus: (projectPath: string) => Promise<DevScopeResult<{ status: Record<string, DevScopeGitFileStatus | undefined> }>>
    getGitStatusDetailed: (
        projectPath: string,
        options?: { includeStats?: boolean }
    ) => Promise<DevScopeResult<{ entries: DevScopeGitStatusDetail[] }>>
    getGitStatusEntryStats: (
        projectPath: string,
        filePaths: string[]
    ) => Promise<DevScopeResult<{ entries: DevScopeGitStatusEntryStats[] }>>
    getGitSyncStatus: (projectPath: string) => Promise<DevScopeResult<{ sync: DevScopeGitSyncStatus }>>
    getIncomingCommits: (projectPath: string, limit?: number) => Promise<DevScopeResult<{ commits: DevScopeGitCommit[] }>>
    getUnpushedCommits: (projectPath: string) => Promise<DevScopeResult<{ commits: DevScopeGitCommit[] }>>
    getGitUser: (projectPath: string) => Promise<DevScopeResult<{ user: { name: string; email: string } | null }>>
    getGlobalGitUser: () => Promise<DevScopeResult<{ user: { name: string; email: string } | null }>>
    getRepoOwner: (projectPath: string) => Promise<DevScopeResult<{ owner: string | null }>>
    getGitHubPublishContext: (
        projectPath: string
    ) => Promise<DevScopeResult<{ context: DevScopeGitHubPublishContext }>>
    getCurrentBranchPullRequest: (
        projectPath: string
    ) => Promise<DevScopeResult<{ pullRequest: DevScopePullRequestSummary | null }>>
    createOrOpenPullRequest: (
        projectPath: string,
        input: DevScopeCreatePullRequestInput
    ) => Promise<DevScopeResult<{
        status: 'created' | 'opened_existing'
        draftSource: DevScopePullRequestDraftSource
        provider?: DevScopePullRequestProvider
        pullRequest: DevScopePullRequestSummary
    }>>
    commitPushAndCreatePullRequest: (
        projectPath: string,
        input: DevScopeCommitPushPullRequestInput
    ) => Promise<DevScopeResult<{
        status: 'created' | 'opened_existing'
        draftSource: DevScopePullRequestDraftSource
        provider?: DevScopePullRequestProvider
        pullRequest: DevScopePullRequestSummary
        commitMessage: string
    }>>
    hasRemoteOrigin: (projectPath: string) => Promise<DevScopeResult<{ hasRemote: boolean }>>
    getProjectsGitOverview: (projectPaths: string[]) => Promise<DevScopeResult<{ items: DevScopeProjectGitOverviewItem[] }>>
    stageFiles: (
        projectPath: string,
        files: string[],
        options?: { scope?: 'project' | 'repo' }
    ) => Promise<DevScopeResult>
    unstageFiles: (
        projectPath: string,
        files: string[],
        options?: { scope?: 'project' | 'repo' }
    ) => Promise<DevScopeResult>
    discardChanges: (
        projectPath: string,
        files: string[],
        options?: { scope?: 'project' | 'repo'; mode?: 'unstaged' | 'staged' | 'both' }
    ) => Promise<DevScopeResult>
    createCommit: (projectPath: string, message: string) => Promise<DevScopeResult>
    setGlobalGitUser: (user: { name: string; email: string }) => Promise<DevScopeResult>
    pushCommits: (
        projectPath: string,
        options?: { remoteName?: string; branchName?: string }
    ) => Promise<DevScopeResult>
    pushSingleCommit: (
        projectPath: string,
        commitHash: string,
        options?: { remoteName?: string; branchName?: string }
    ) => Promise<DevScopeResult>
    fetchUpdates: (projectPath: string, remoteName?: string) => Promise<DevScopeResult>
    pullUpdates: (
        projectPath: string,
        options?: {
            remoteName?: string
            branchName?: string
            pushRemoteName?: string
        }
    ) => Promise<DevScopeResult>
    listBranches: (projectPath: string) => Promise<DevScopeResult<{ branches: DevScopeGitBranchSummary[] }>>
    createBranch: (projectPath: string, branchName: string, checkout?: boolean) => Promise<DevScopeResult>
    checkoutBranch: (projectPath: string, branchName: string, options?: { autoStash?: boolean; autoCleanupLock?: boolean }) => Promise<DevScopeResult<{ stashed: boolean; cleanedLock?: boolean; stashRef?: string; stashMessage?: string }>>
    deleteBranch: (projectPath: string, branchName: string, force?: boolean) => Promise<DevScopeResult>
    addRemote: (projectPath: string, remoteName: string, remoteUrl: string) => Promise<DevScopeResult>
    listRemotes: (projectPath: string) => Promise<DevScopeResult<{ remotes: DevScopeGitRemoteSummary[] }>>
    setRemoteUrl: (projectPath: string, remoteName: string, remoteUrl: string) => Promise<DevScopeResult>
    removeRemote: (projectPath: string, remoteName: string) => Promise<DevScopeResult>
    listTags: (projectPath: string) => Promise<DevScopeResult<{ tags: DevScopeGitTagSummary[] }>>
    createTag: (projectPath: string, tagName: string, target?: string) => Promise<DevScopeResult>
    deleteTag: (projectPath: string, tagName: string) => Promise<DevScopeResult>
    listStashes: (projectPath: string) => Promise<DevScopeResult<{ stashes: DevScopeGitStashSummary[] }>>
    createStash: (projectPath: string, message?: string) => Promise<DevScopeResult>
    applyStash: (projectPath: string, stashRef?: string, pop?: boolean) => Promise<DevScopeResult>
    dropStash: (projectPath: string, stashRef?: string) => Promise<DevScopeResult>
    checkIsGitRepo: (projectPath: string) => Promise<DevScopeResult<{ isGitRepo: boolean }>>
    initGitRepo: (projectPath: string, branchName: string, createGitignore: boolean, gitignoreTemplate?: string) => Promise<DevScopeResult>
    createInitialCommit: (projectPath: string, message: string) => Promise<DevScopeResult>
    addRemoteOrigin: (projectPath: string, remoteUrl: string) => Promise<DevScopeResult>
    cloneGitRepository: (input: DevScopeGitCloneInput) => Promise<DevScopeResult<DevScopeGitCloneResult>>
    onGitCloneProgress: (callback: (event: DevScopeGitCloneProgressEvent) => void) => () => void
    getGitignoreTemplates: () => Promise<DevScopeResult<{ templates: string[] }>>
    generateGitignoreContent: (template: string) => Promise<DevScopeResult<{ content: string }>>
    getGitignorePatterns: () => Promise<DevScopeResult<{ patterns: Array<{ id: string; label: string; description: string; category: string; patterns: string[] }> }>>
    generateCustomGitignoreContent: (selectedPatternIds: string[]) => Promise<DevScopeResult<{ content: string }>>
    copyToClipboard: (text: string) => Promise<DevScopeResult>
    readFileContent: (filePath: string, options?: { knownSize?: number | null; knownModifiedAt?: number | null }) => Promise<DevScopeResult<{ content?: string; size: number; previewBytes?: number; truncated?: boolean; modifiedAt: number; notModified?: boolean }>>
    readBinaryFile: (filePath: string) => Promise<DevScopeResult<{ data: ArrayBuffer; size: number; modifiedAt: number }>>
    readTextFileFull: (filePath: string) => Promise<DevScopeResult<{ content: string; size: number; modifiedAt: number }>>
    getPathInfo: (targetPath: string) => Promise<DevScopeResult<DevScopePathInfo>>
    writeTextFile: (
        filePath: string,
        content: string,
        expectedModifiedAt?: number
    ) => Promise<DevScopeResult<{ size: number; modifiedAt: number }> | (DevScopeErr & { conflict?: boolean; currentModifiedAt?: number })>
    runPythonPreview: (input: { sessionId: string; filePath: string; projectPath?: string }) =>
        Promise<DevScopeResult<{ pid: number | null; interpreter: string; command: string }>>
    stopPythonPreview: (sessionId: string) => Promise<DevScopeResult<{ stopped: boolean }>>
    onPythonPreviewEvent: (callback: (event: DevScopePythonPreviewEvent) => void) => () => void
    registerPreviewTerminalWorkspace: (owner: DevScopePreviewTerminalWorkspaceOwner) =>
        Promise<DevScopeResult<{ workspaceCapability: string }>>
    releasePreviewTerminalWorkspace: (workspaceCapability: string) => Promise<DevScopeResult<{ released: boolean }>>
    createPreviewTerminal: (input: DevScopePreviewTerminalAccess & {
        sessionId: string
        targetPath?: string
        preferredShell?: 'powershell' | 'cmd'
        cols?: number
        rows?: number
        title?: string
    }) => Promise<DevScopeResult<{ shell: string; cwd: string; groupKey: string; session: DevScopePreviewTerminalSessionSummary }>>
    listPreviewTerminalSessions: (input?: DevScopePreviewTerminalAccess & { targetPath?: string }) =>
        Promise<DevScopeResult<{ groupKey?: string; cwd?: string; sessions: DevScopePreviewTerminalSessionSummary[] }>>
    writePreviewTerminal: (input: DevScopePreviewTerminalAccess & { sessionId: string; data: string }) => Promise<DevScopeResult>
    setPreviewTerminalTitle: (input: DevScopePreviewTerminalAccess & { sessionId: string; title: string }) => Promise<DevScopeResult<{ title: string }>>
    resizePreviewTerminal: (input: DevScopePreviewTerminalAccess & { sessionId: string; cols: number; rows: number }) => Promise<DevScopeResult>
    clearPreviewTerminal: (input: string | (DevScopePreviewTerminalAccess & { sessionId: string })) => Promise<DevScopeResult>
    closePreviewTerminal: (input: string | (DevScopePreviewTerminalAccess & { sessionId: string })) => Promise<DevScopeResult<{ closed: boolean }>>
    onPreviewTerminalEvent: (callback: (event: DevScopePreviewTerminalEvent) => void, workspaceCapability?: string) => () => void
    getBrowserPreviewConfig: () => Promise<DevScopeResult<DevScopeBrowserPreviewConfig>>
    getBrowserPageIcon: (pageUrl: string) => Promise<DevScopeResult<{ dataUrl: string | null }>>
    listBrowserDownloads: () => Promise<DevScopeResult<{ downloads: BrowserDownloadRecord[] }>>
    actOnBrowserDownload: (action: BrowserDownloadAction) => Promise<DevScopeResult<BrowserDownloadActionResult>>
    getBrowserDownloadPreviewTarget: (id: string) => Promise<DevScopeResult<{ target: BrowserDownloadPreviewTarget }>>
    onBrowserDownloadsChanged: (callback: (downloads: BrowserDownloadRecord[]) => void) => () => void
    listBrowserDownloadsFolder: () => Promise<DevScopeResult<{ entries: BrowserDownloadsFolderEntry[] }>>
    actOnBrowserDownloadsFolderEntry: (action: BrowserDownloadsFolderAction) => Promise<DevScopeResult<BrowserDownloadsFolderActionResult>>
    getBrowserHistory: (input?: { query?: string; limit?: number }) => Promise<DevScopeResult<{ entries: DevScopeBrowserHistoryEntry[] }>>
    getBrowserSearchSuggestions: (input: { query: string }) => Promise<DevScopeResult<{ suggestions: string[]; provider: 'Google' }>>
    scanExternalBrowserHistoryProfiles: () => Promise<DevScopeResult<ExternalBrowserHistoryScanResult>>
    importExternalBrowserHistory: (input: ExternalBrowserHistoryImportInput) => Promise<DevScopeResult<{ result: ExternalBrowserHistoryImportResult }>>
    recordBrowserHistory: (input: DevScopeBrowserHistoryRecordInput) => Promise<DevScopeResult<{ entry: DevScopeBrowserHistoryEntry | null }>>
    clearBrowserHistory: () => Promise<DevScopeResult<{ cleared: boolean }>>
    getBrowserAdBlockStatus: () => Promise<DevScopeResult<{ status: DevScopeBrowserAdBlockStatus }>>
    setBrowserAdBlockEnabled: (input: { enabled: boolean; promptDismissed?: boolean }) => Promise<DevScopeResult<{ status: DevScopeBrowserAdBlockStatus }>>
    onBrowserAdDetected: (callback: (event: DevScopeBrowserAdDetection) => void) => () => void
    onBrowserOpenTabRequested: (callback: (event: DevScopeBrowserOpenTabRequest) => void) => () => void
    onBrowserShortcut: (callback: (event: DevScopeBrowserShortcutEvent) => void) => () => void
    checkBrowserThreatNavigation: (input: DevScopeBrowserThreatCheckInput) => Promise<DevScopeResult<{ allowed: boolean }>>
    proceedBrowserThreatWarning: (decisionId: string) => Promise<DevScopeResult>
    dismissBrowserThreatWarning: (decisionId: string) => Promise<DevScopeResult>
    onBrowserThreatBlocked: (callback: (event: DevScopeBrowserThreatWarning) => void) => () => void
    getBrowserBackgroundProviderStatus: () => Promise<DevScopeResult<{ status: DevScopeBrowserBackgroundProviderStatus }>>
    validateBrowserUnsplashAccessKey: (input: { accessKey: string }) => Promise<DevScopeResult>
    getBrowserRemoteBackgrounds: (input: { category: DevScopeBrowserBackgroundCategory; refresh?: boolean; query?: string }) => Promise<DevScopeResult<{ backgrounds: DevScopeBrowserRemoteBackground[] }>>
    trackBrowserRemoteBackground: (input: { downloadLocation: string }) => Promise<DevScopeResult>
    clearBrowserPreviewData: () => Promise<DevScopeResult<{ cleared: boolean }>>
    clearBrowserPreviewCache: () => Promise<DevScopeResult<{ cleared: boolean }>>
    clearBrowserPreviewCookies: () => Promise<DevScopeResult<{ cleared: boolean }>>
    hardReloadBrowserPreview: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult>
    setBrowserPreviewZoom: (input: DevScopeBrowserGuestTargetInput & { factor: number }) => Promise<DevScopeResult<{ factor: number }>>
    setBrowserPreviewColorScheme: (input: DevScopeBrowserGuestTargetInput & { colorScheme: DevScopeBrowserColorScheme }) => Promise<DevScopeResult>
    openBrowserPreviewDevTools: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult>
    captureBrowserPreviewScreenshot: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult<{ artifact: DevScopeBrowserCaptureArtifact }>>
    stageBrowserPreviewArtifactForAssistant: (artifactId: string) => Promise<DevScopeResult<{ reference: string }>>
    openBrowserPreviewArtifact: (artifactId: string) => Promise<DevScopeResult>
    revealBrowserPreviewArtifact: (artifactId: string) => Promise<DevScopeResult>
    copyBrowserPreviewArtifact: (input: { artifactId: string; mode: 'image' | 'path' }) => Promise<DevScopeResult>
    startBrowserPreviewAnnotation: (input: DevScopeBrowserAnnotationInput) => Promise<DevScopeResult<{ annotation: DevScopeBrowserAnnotationPayload | null; artifact: DevScopeBrowserCaptureArtifact | null }>>
    cancelBrowserPreviewAnnotation: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult>
    startBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult<{ startedAt: string }>>
    stopBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput) => Promise<DevScopeResult>
    saveBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput & { mimeType: string; data: Uint8Array }) => Promise<DevScopeResult<{ artifact: DevScopeBrowserCaptureArtifact }>>
    onBrowserPreviewRecordingFrame: (callback: (frame: DevScopeBrowserRecordingFrame) => void) => () => void
    getBrowserLinkPreview: (input: { url: string }) => Promise<DevScopeResult<{ preview: DevScopeBrowserLinkPreview | null }>>
    openBrowserPreviewExternal: (url: string) => Promise<DevScopeResult>
    openFile: (filePath: string) => Promise<DevScopeResult>
    openWith: (filePath: string) => Promise<DevScopeResult>
    createFileSystemItem: (
        destinationDirectory: string,
        name: string,
        type: 'file' | 'directory'
    ) => Promise<DevScopeResult<{ path: string; name: string; type: 'file' | 'directory' }>>
    renameFileSystemItem: (targetPath: string, nextName: string) => Promise<DevScopeResult<{ path: string; name: string }>>
    deleteFileSystemItem: (targetPath: string) => Promise<DevScopeResult>
    pasteFileSystemItem: (sourcePath: string, destinationDirectory: string) => Promise<DevScopeResult<{ path: string; name: string }>>
    moveFileSystemItem: (sourcePath: string, destinationDirectory: string) => Promise<DevScopeResult<{ path: string; name: string }>>
    getProjectSessions: (projectPath: string) => Promise<DevScopeResult>
    getProjectProcesses: (projectPath: string) => Promise<DevScopeResult<{ isLive: boolean; processes: DevScopeProcessInfo[]; activePorts: number[] }>>
    getRunningLocalServers: (projectPath?: string) => Promise<DevScopeResult<{ servers: DevScopeLocalServer[] }>>
    indexAllFolders: (
        folders: string[],
        options?: { forceRefresh?: boolean }
    ) => Promise<DevScopeResult<{ projects: DevScopeIndexedProject[]; indexedCount: number; indexedFolders: number; indexedFiles: number; scannedFolderPaths: string[]; errors?: Array<{ folder: string; error: string }> }>>
    searchIndexedPaths: (
        input: DevScopeIndexedPathSearchInput
    ) => Promise<DevScopeResult<DevScopeIndexedPathSearchResult>>
    getFileSystemRoots: () => Promise<DevScopeResult<{ roots: string[] }>>

    terminal: DevScopeTerminalApi
    fonts: DevScopeFontsApi
    memory: ZyraMemoryApi
    assistant: DevScopeAssistantApi
    agentscope: DevScopeAgentScopeApi
    agentControl: DevScopeAgentControlApi
    preferences: DevScopePreferencesApi
    secrets: DevScopeSecretsApi
    onboarding: DevScopeOnboardingApi
    updates: DevScopeUpdatesApi
    window: DevScopeWindowApi
    browserPopup: DevScopeBrowserPopupApi
    browserView: BrowserViewApi
    assistantUtility: AssistantUtilityApi
}

export type DevScopePackageRuntimeId = 'node' | 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface DevScopeInstalledPackageRuntime {
    id: DevScopePackageRuntimeId
    name: string
    command: string
    installed: boolean
    version?: string
    path?: string
}
