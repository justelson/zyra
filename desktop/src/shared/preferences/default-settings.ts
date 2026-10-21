import { ACCENT_COLORS } from './accent-presets'
import { DEFAULT_ASSISTANT_AUTO_TITLE_TURNS, DEFAULT_ASSISTANT_TITLE_MODEL } from '../assistant/title-generation'
import { DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS, DEFAULT_ASSISTANT_REASONING_SUMMARY } from '../assistant/runtime-policy'

/** Leaf defaults shared by the UI and agent settings. Secrets are empty placeholders, never values from storage. */
export const DEFAULT_DEVICE_SETTINGS = {
    settingsSchemaVersion: 5, keyboardShortcuts: {}, theme: 'vercel',
    appearanceThemeMode: 'system', appearanceLightTheme: 'paper-light', appearanceDarkTheme: 'vercel', appearanceResolvedMode: 'dark',
    appearanceCustomTheme: null, appearanceCustomThemeActive: false, appearanceUiFont: 'bricolage', appearanceCodeFont: 'jetbrains',
    appearanceInterfaceScale: 100, appearanceCodeScale: 100, appearanceContrastScale: 100, appearanceAnimationSpeed: 'normal', appearanceAnimationScale: 100,
    accentColor: ACCENT_COLORS.find(accent => accent.name === 'Sky') || ACCENT_COLORS[0], compactMode: false,
    sidebarCollapsed: false, sidebarHoverPreviewEnabled: true, assistantAgentInboxSidebarEnabled: true, explorerTabEnabled: false, explorerHomePath: '',
    defaultShell: 'powershell', startMinimized: false, startWithWindows: false, browserViewMode: 'finder', browserContentLayout: 'explorer',
    filePreviewOpenInFullscreen: false, filePreviewFullscreenShowLeftPanel: true, filePreviewFullscreenShowRightPanel: false,
    filePreviewDefaultMode: 'preview', filePreviewPythonRunMode: 'terminal', filePreviewExplorerNameLayout: 'wrap', fileEditorWordWrap: 'on',
    fileEditorMinimapEnabled: true, fileEditorFontSize: 13, fileCsvDistinctColorsEnabled: true, fileDiffRenderMode: 'stacked', packageRuntimePreference: 'auto',
    filePreviewTerminalPanelHeight: 220, terminalFontSize: 12, terminalCursorBlink: true, terminalScrollback: 5000,
    assistantBrowserRestoreTabs: true, assistantBrowserGoogleSuggestions: true, assistantBrowserAdBlockEnabled: false, assistantBrowserAdBlockPromptDismissed: false,
    assistantBrowserNewTabBackgroundMode: 'built-in', assistantBrowserNewTabBackgroundCategory: 'all', assistantBrowserNewTabBackgroundRotation: 'every-tab', assistantBrowserNewTabBackgroundId: '',
    projectsFolder: '', additionalFolders: [], gitAutoRefreshOnProjectOpen: true, gitInitDefaultBranch: 'main', gitInitCreateGitignore: true,
    gitInitCreateInitialCommit: false, gitWarnOnAuthorMismatch: true, gitBulkActionScope: 'repo',
    gitPullRequestGlobalGuide: { mode: 'text', text: '', filePath: '' }, gitPullRequestDefaultGuideSource: 'global', gitPullRequestDefaultTargetBranch: 'main',
    gitPullRequestDefaultDraft: true, gitPullRequestDefaultChangeSource: 'all-local-work', gitProjectPullRequestConfigs: {}, gitAutoCreateBranchWhenTargetMatches: false,
    groqApiKey: '', geminiApiKey: '', groqApiKeyConfigured: false, geminiApiKeyConfigured: false,
    gitCommitCodexModel: '', gitPullRequestCodexModel: '', commitAIProvider: 'codex', assistantUsageDisplayMode: 'remaining',
    assistantTextStreamingMode: 'stream', assistantToolOutputDefaultMode: 'minimized', assistantAllowCollapseWhileWorking: false,
    assistantShowActionStats: false, assistantChatDisplayMode: 'minimal', assistantDefaultModel: '', assistantTitleModel: DEFAULT_ASSISTANT_TITLE_MODEL,
    assistantTitleAutoRegenerate: false, assistantTitleAutoRegenerateTurns: DEFAULT_ASSISTANT_AUTO_TITLE_TURNS, assistantDefaultPromptTemplate: '',
    assistantProductProfile: 'concise', assistantDefaultRuntimeMode: 'approval-required', assistantDefaultEffort: 'medium', assistantDefaultFastMode: false,
    assistantReasoningSummary: DEFAULT_ASSISTANT_REASONING_SUMMARY, assistantContextCompactionThresholdTokens: DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
    assistantDefaultWebSearch: true, assistantDefaultWebFetch: true, assistantBusyMessageMode: 'queue', assistantAutoReconnect: true, assistantHistoryPrefetch: false,
    assistantShowStatusDetails: true, assistantShowDiagnostics: false, accessibilityReduceMotion: false, projectIconOverrides: {},
    assistantTranscriptionEnabled: false, assistantMemoryEnabled: false, assistantTranscriptionEngine: 'browser',
}
