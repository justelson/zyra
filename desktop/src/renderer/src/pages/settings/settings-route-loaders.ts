export const loadSettingsShell = () => import('./SettingsShell')
export const loadSettingsOverview = () => import('./SettingsOverview')
export const loadGeneralSettings = () => import('../Settings')
export const loadAppearanceSettings = () => import('./AppearanceSettings')
export const loadAccountSettings = () => import('./AccountSettings')
export const loadAssistantSettings = () => import('./AssistantSettings')
export const loadSkillsSettings = () => import('./SkillsSettings')
export const loadVoiceSettings = () => import('./VoiceSettings')
export const loadConnectionsSettings = () => import('./ConnectionsSettings')
export const loadBrowserControlSettings = () => import('./BrowserControlSettings')
export const loadFilesEditorSettings = () => import('./FilesEditorSettings')
export const loadTerminalRuntimeSettings = () => import('./TerminalRuntimeSettings')
export const loadProviderSettings = () => import('./AISettings')
export const loadSourceControlSettings = () => import('./GitSettings')
export const loadProjectsSettings = () => import('./ProjectsSettings')
export const loadMemorySettings = () => import('./MemorySettings')
export const loadArchivedChatsSettings = () => import('./ArchivedChatsSettings')
export const loadDiagnosticsSettings = () => import('./LogsSettings')
export const loadDataPrivacySettings = () => import('./DataPrivacySettings')
export const loadAboutSettings = () => import('./AboutSettings')

const routeLoaders: Record<string, () => Promise<unknown>> = {
    '/settings': loadSettingsOverview,
    '/settings/app': loadSettingsOverview,
    '/settings/account': loadSettingsOverview,
    '/settings/assistant': loadSettingsOverview,
    '/settings/workspace': loadSettingsOverview,
    '/settings/data': loadSettingsOverview,
    '/settings/app/general': loadGeneralSettings,
    '/settings/app/appearance': loadAppearanceSettings,
    '/settings/account/openai': loadAccountSettings,
    '/settings/account/devices': loadConnectionsSettings,
    '/settings/assistant/defaults': loadAssistantSettings,
    '/settings/assistant/skills': loadSkillsSettings,
    '/settings/assistant/voice': loadVoiceSettings,
    '/settings/assistant/providers': loadProviderSettings,
    '/settings/workspace/browser': loadBrowserControlSettings,
    '/settings/workspace/files': loadFilesEditorSettings,
    '/settings/workspace/terminal': loadTerminalRuntimeSettings,
    '/settings/workspace/projects': loadProjectsSettings,
    '/settings/workspace/source-control': loadSourceControlSettings,
    '/settings/data/privacy': loadDataPrivacySettings,
    '/settings/data/memory': loadMemorySettings,
    '/settings/data/archived': loadArchivedChatsSettings,
    '/settings/data/diagnostics': loadDiagnosticsSettings,
    '/settings/about': loadAboutSettings,
    '/settings/general': loadGeneralSettings,
    '/settings/appearance': loadAppearanceSettings,
    '/settings/connections': loadConnectionsSettings,
    '/settings/skills': loadSkillsSettings,
    '/settings/voice': loadVoiceSettings,
    '/settings/browser-control': loadBrowserControlSettings,
    '/settings/files-editor': loadFilesEditorSettings,
    '/settings/terminal-runtime': loadTerminalRuntimeSettings,
    '/settings/providers': loadProviderSettings,
    '/settings/source-control': loadSourceControlSettings,
    '/settings/projects': loadProjectsSettings,
    '/settings/memory': loadMemorySettings,
    '/settings/archived': loadArchivedChatsSettings,
    '/settings/diagnostics': loadDiagnosticsSettings
}

export function preloadSettingsRoute(value: string): void {
    const pathname = value.split(/[?#]/, 1)[0] || '/settings'
    const loader = routeLoaders[pathname] || null
    void loadSettingsShell().catch(() => undefined)
    void loader?.().catch(() => undefined)
}
