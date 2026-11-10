import { findSettingsDestination, getSettingsCategoryEntry, SETTINGS_NAVIGATION_ITEMS } from './settings-navigation'

export const loadSettingsShell = () => import('./SettingsShell')
export const loadSettingsOverview = () => import('./SettingsOverview')
export const loadGeneralSettings = () => import('../Settings')
export const loadKeyboardShortcutsSettings = () => import('./KeyboardShortcutsSettings')
export const loadAppearanceSettings = () => import('./AppearanceSettings')
export const loadAccountSettings = () => import('./AccountSettings')
export const loadAssistantSettings = () => import('./AssistantSettings')
export const loadPermissionsSettings = () => import('./PermissionsSettings')
export const loadSkillsSettings = () => import('./SkillsSettings')
export const loadPluginsSettings = () => import('./PluginsSettings')
export const loadVoiceSettings = () => import('./VoiceSettings')
export const loadConnectionsSettings = () => import('./ConnectionsSettings')
export const loadBrowserCapturesSettings = () => import('./BrowserCapturesSettings')
export const loadBrowserControlSettings = () => import('./BrowserControlSettings')
export const loadFilesEditorSettings = () => import('./FilesEditorSettings')
export const loadTerminalRuntimeSettings = () => import('./TerminalRuntimeSettings')
export const loadProviderSettings = () => import('./ProvidersSettings')
export const loadProviderWritingSettings = () => import('./AISettings')
export const loadSourceControlSettings = () => import('./GitSettings')
export const loadProjectsSettings = () => import('./ProjectsSettings')
export const loadMemorySettings = () => import('./MemorySettings')
export const loadArchivedChatsSettings = () => import('./ArchivedChatsSettings')
export const loadDiagnosticsSettings = () => import('./LogsSettings')
export const loadResponseTimingSettings = () => import('./ResponseTimingSettings')
export const loadDataPrivacySettings = () => import('./DataPrivacySettings')
export const loadAboutSettings = () => import('./AboutSettings')

const destinationLoaders: Record<string, () => Promise<unknown>> = {
    general: loadGeneralSettings,
    'keyboard-shortcuts': loadKeyboardShortcutsSettings,
    appearance: loadAppearanceSettings,
    'appearance-typography': loadAppearanceSettings,
    'appearance-layout': loadAppearanceSettings,
    'appearance-colors': loadAppearanceSettings,
    usage: loadProviderSettings,
    providers: loadProviderSettings,
    'provider-models': loadProviderSettings,
    account: loadProviderSettings,
    'provider-writing': loadProviderWritingSettings,
    assistant: loadAssistantSettings,
    'chat-defaults': loadAssistantSettings,
    'chat-display': loadAssistantSettings,
    permissions: loadPermissionsSettings,
    archived: loadArchivedChatsSettings,
    skills: loadSkillsSettings,
    plugins: loadPluginsSettings,
    'skill-conflicts': loadSkillsSettings,
    voice: loadVoiceSettings,
    'voice-history': loadVoiceSettings,
    'voice-lab': loadVoiceSettings,
    connections: loadConnectionsSettings,
    'device-chrome': loadConnectionsSettings,
    'device-mobile': loadConnectionsSettings,
    'browser-control': loadBrowserControlSettings,
    'browser-privacy': loadBrowserControlSettings,
    'browser-data': loadBrowserControlSettings,
    'browser-captures': loadBrowserCapturesSettings,
    'browser-extensions': loadBrowserControlSettings,
    'files-editor': loadFilesEditorSettings,
    'file-editor': loadFilesEditorSettings,
    'terminal-runtime': loadTerminalRuntimeSettings,
    projects: loadProjectsSettings,
    'project-discovery': loadProjectsSettings,
    'source-control': loadSourceControlSettings,
    'git-pull-requests': loadSourceControlSettings,
    'git-writing': loadSourceControlSettings,
    'git-writing-connections': loadProviderWritingSettings,
    'git-writing-logs': loadDiagnosticsSettings,
    memory: loadMemorySettings,
    'memory-inspect': loadMemorySettings,
    privacy: loadDataPrivacySettings,
    diagnostics: loadDiagnosticsSettings,
    'response-timings': loadResponseTimingSettings,
    about: loadAboutSettings
}

export function preloadSettingsRoute(value: string): void {
    const pathname = value.split(/[?#]/, 1)[0] || '/settings'
    const category = SETTINGS_NAVIGATION_ITEMS.find(item => item.to === pathname)
    const destination = category ? getSettingsCategoryEntry(category.id) : findSettingsDestination(pathname)
    const loader = destinationLoaders[destination?.id || 'general']
    void loadSettingsShell().catch(() => undefined)
    void loader?.().catch(() => undefined)
}
