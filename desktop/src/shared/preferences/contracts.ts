export const DEVICE_PREFERENCES_SCHEMA_VERSION = 1 as const

export type DevicePreferenceSurface = 'desktop' | 'browser'

export const SHARED_DEVICE_PREFERENCE_KEYS = [
    'appearanceThemeMode',
    'appearanceLightTheme',
    'appearanceDarkTheme',
    'appearanceCustomTheme',
    'appearanceCustomThemeActive',
    'appearanceUiFont',
    'appearanceCodeFont',
    'accentColor',
    'compactMode',
    'accessibilityReduceMotion',
    'explorerTabEnabled',
    'explorerHomePath',
    'defaultShell',
    'filePreviewOpenInFullscreen',
    'filePreviewDefaultMode',
    'filePreviewPythonRunMode',
    'filePreviewExplorerNameLayout',
    'fileEditorWordWrap',
    'fileEditorMinimapEnabled',
    'fileEditorFontSize',
    'fileCsvDistinctColorsEnabled',
    'fileDiffRenderMode',
    'packageRuntimePreference',
    'terminalFontSize',
    'terminalCursorBlink',
    'terminalScrollback',
    'projectsFolder',
    'additionalFolders',
    'projectIconOverrides',
    'gitAutoRefreshOnProjectOpen',
    'gitInitDefaultBranch',
    'gitInitCreateGitignore',
    'gitInitCreateInitialCommit',
    'gitWarnOnAuthorMismatch',
    'gitBulkActionScope',
    'gitPullRequestGlobalGuide',
    'gitPullRequestDefaultGuideSource',
    'gitPullRequestDefaultTargetBranch',
    'gitPullRequestDefaultDraft',
    'gitPullRequestDefaultChangeSource',
    'gitProjectPullRequestConfigs',
    'gitAutoCreateBranchWhenTargetMatches',
    'gitCommitCodexModel',
    'gitPullRequestCodexModel',
    'commitAIProvider',
    'assistantDefaultModel',
    'assistantTitleModel',
    'assistantTitleAutoRegenerate',
    'assistantTitleAutoRegenerateTurns',
    'assistantDefaultPromptTemplate',
    'assistantProductProfile',
    'assistantDefaultRuntimeMode',
    'assistantDefaultEffort',
    'assistantDefaultFastMode',
    'assistantReasoningSummary',
    'assistantContextCompactionThresholdTokens',
    'assistantDefaultWebSearch',
    'assistantDefaultWebFetch',
    'assistantBusyMessageMode'
] as const

export const SURFACE_DEVICE_PREFERENCE_KEYS = [
    'sidebarCollapsed',
    'sidebarHoverPreviewEnabled',
    'assistantAgentInboxSidebarEnabled',
    'browserViewMode',
    'browserContentLayout',
    'filePreviewFullscreenShowLeftPanel',
    'filePreviewFullscreenShowRightPanel',
    'filePreviewTerminalPanelHeight',
    'assistantBrowserRestoreTabs',
    'assistantBrowserGoogleSuggestions',
    'assistantBrowserAdBlockEnabled',
    'assistantBrowserAdBlockPromptDismissed',
    'assistantBrowserNewTabBackgroundMode',
    'assistantBrowserNewTabBackgroundCategory',
    'assistantBrowserNewTabBackgroundRotation',
    'assistantBrowserNewTabBackgroundId',
    'assistantUsageDisplayMode',
    'assistantTextStreamingMode',
    'assistantToolOutputDefaultMode',
    'assistantChatDisplayMode',
    'assistantAutoReconnect',
    'assistantHistoryPrefetch',
    'assistantShowStatusDetails',
    'assistantShowDiagnostics',
    'assistantTranscriptionEnabled',
    'assistantTranscriptionEngine'
] as const

export const OS_DEVICE_PREFERENCE_KEYS = [
    'startMinimized',
    'startWithWindows'
] as const

export const SECRET_DEVICE_PREFERENCE_KEYS = [
    'groqApiKey',
    'geminiApiKey'
] as const

export const DERIVED_DEVICE_PREFERENCE_KEYS = [
    'settingsSchemaVersion',
    'theme',
    'appearanceResolvedMode'
] as const

export type SharedDevicePreferenceKey = typeof SHARED_DEVICE_PREFERENCE_KEYS[number]
export type SurfaceDevicePreferenceKey = typeof SURFACE_DEVICE_PREFERENCE_KEYS[number]
export type OsDevicePreferenceKey = typeof OS_DEVICE_PREFERENCE_KEYS[number]
export type SecretDevicePreferenceKey = typeof SECRET_DEVICE_PREFERENCE_KEYS[number]
export type DerivedDevicePreferenceKey = typeof DERIVED_DEVICE_PREFERENCE_KEYS[number]
export type ManagedDevicePreferenceKey = SharedDevicePreferenceKey | SurfaceDevicePreferenceKey

export type DevicePreferencesChangedEvent = {
    schemaVersion: typeof DEVICE_PREFERENCES_SCHEMA_VERSION
    revision: number
    changedKeys: ManagedDevicePreferenceKey[]
    sourceSurface: DevicePreferenceSurface | 'main'
}

export type DevicePreferencesSnapshot = {
    schemaVersion: typeof DEVICE_PREFERENCES_SCHEMA_VERSION
    revision: number
    surface: DevicePreferenceSurface
    settings: Record<string, unknown>
    desktopLegacyMigrationComplete: boolean
    updatedAt: string
}

export type GetDevicePreferencesInput = {
    surface: DevicePreferenceSurface
    legacySettings?: Record<string, unknown> | null
}

export type UpdateDevicePreferencesInput = {
    surface: DevicePreferenceSurface
    expectedRevision: number
    patch: Record<string, unknown>
}

export const DEVICE_PREFERENCES_IPC = {
    get: 'zyra:preferences:get',
    update: 'zyra:preferences:update',
    changed: 'zyra:preferences:changed'
} as const

export function isDevicePreferenceSurface(value: unknown): value is DevicePreferenceSurface {
    return value === 'desktop' || value === 'browser'
}

const sharedKeys = new Set<string>(SHARED_DEVICE_PREFERENCE_KEYS)
const surfaceKeys = new Set<string>(SURFACE_DEVICE_PREFERENCE_KEYS)
const osKeys = new Set<string>(OS_DEVICE_PREFERENCE_KEYS)
const secretKeys = new Set<string>(SECRET_DEVICE_PREFERENCE_KEYS)
const derivedKeys = new Set<string>(DERIVED_DEVICE_PREFERENCE_KEYS)

export function getDevicePreferenceOwnership(key: string): 'shared' | 'surface' | 'os' | 'secret' | 'derived' | 'unknown' {
    if (sharedKeys.has(key)) return 'shared'
    if (surfaceKeys.has(key)) return 'surface'
    if (osKeys.has(key)) return 'os'
    if (secretKeys.has(key)) return 'secret'
    if (derivedKeys.has(key)) return 'derived'
    return 'unknown'
}

export function isSharedDevicePreferenceKey(key: string): key is SharedDevicePreferenceKey {
    return sharedKeys.has(key)
}

export function isSurfaceDevicePreferenceKey(key: string): key is SurfaceDevicePreferenceKey {
    return surfaceKeys.has(key)
}
