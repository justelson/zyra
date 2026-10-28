import { appShortcut } from './lib/keybindings'
import { AppMenuCommandHost } from './components/layout/AppMenuCommandHost'
import { ShortcutHints } from './components/layout/ShortcutHints'
import { AgentAppOperations } from './components/layout/AgentAppOperations'
import { isBrowserExtension } from './lib/browser-extension'
import { ExtensionSidebarHeader } from './components/layout/ExtensionSidebarHeader'
import { RuntimeActivationNotice } from './components/updates/RuntimeActivationNotice'
import { AssistantBrowserRecordingHost } from './pages/assistant/AssistantBrowserRecordingHost'
import { AssistantVoiceProvider } from './pages/assistant/useAppVoiceSession'
import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { migrateLegacyExplorerShellLaunchRoute } from '@shared/assistant/files-shell-launch-route'
import { isQuickPreviewRoute } from '@shared/file-preview-route'
import QuickOpenWindow from './pages/QuickOpenWindow'
import TitleBar from './components/layout/TitleBar'
import { AppBootSkeleton, AppRouteSkeleton } from './components/ui/AppRouteSkeleton'
import { SettingsProvider, useSettings } from './lib/settings'
import { ZYRA_THEME_CHANGED_EVENT } from './lib/theme-events'
import { CommandPaletteProvider } from './lib/commandPalette'
import CommandPalette from './components/CommandPalette'
import QuickOpenDialog from './components/QuickOpenDialog'
import LinkHoverStatus from './components/ui/LinkHoverStatus'
import { DesktopLinkHost } from './components/ui/DesktopLinkHost'
import { UpdatePromptCenter } from './components/updates/UpdatePromptCenter'
import { AppUpdatesProvider } from './lib/app-updates'
import { ProjectCreationProvider } from './lib/projects/project-creation'
import { AssistantTitleBarProvider } from './lib/assistant/assistant-title-bar'
import { OnboardingProvider } from './lib/onboarding'
import { OnboardingGate } from './onboarding/OnboardingGate'
import { AssistantRouteShell } from './pages/assistant/AssistantRouteShell'
import { AssistantWorkspaceLifetime } from './pages/assistant/AssistantWorkspaceLifetime'
import {
    loadAboutSettings,
    loadAppearanceSettings,
    loadArchivedChatsSettings,
    loadAssistantSettings,
    loadBrowserControlSettings,
    loadConnectionsSettings,
    loadDataPrivacySettings,
    loadDiagnosticsSettings,
    loadFilesEditorSettings,
    loadGeneralSettings,
    loadKeyboardShortcutsSettings,
    loadMemorySettings,
    loadProjectsSettings,
    loadProviderSettings,
    loadProviderWritingSettings,
    loadSettingsShell,
    loadSkillsSettings,
    loadPluginsSettings,
    loadSourceControlSettings,
    loadTerminalRuntimeSettings,
    loadVoiceSettings
} from './pages/settings/settings-route-loaders'
import { SettingsCategoryRedirect, SettingsRedirect } from './pages/settings/SettingsRedirect'

const loadAssistantRoute = () => import('./pages/Assistant')
const Assistant = lazy(loadAssistantRoute)
const InstructorVoiceLab = lazy(() => import('./pages/assistant/InstructorVoiceLab'))
const AssistantVoiceWidget = lazy(() => import('./pages/assistant/AssistantVoiceWidget').then(module => ({ default: module.AssistantVoiceWidget })))
const PluginWorkspace = lazy(() => import('./pages/plugins/PluginWorkspace'))
const AccessoryWindowPage = lazy(() => import('./pages/accessories/AccessoryWindowPage'))
const SettingsShell = lazy(loadSettingsShell)
const GeneralSettings = lazy(loadGeneralSettings)
const KeyboardShortcutsSettings = lazy(loadKeyboardShortcutsSettings)
const AppearanceSettings = lazy(loadAppearanceSettings)
const VoiceSettings = lazy(loadVoiceSettings)
const ConnectionsSettings = lazy(loadConnectionsSettings)
const BrowserControlSettings = lazy(loadBrowserControlSettings)
const FilesEditorSettings = lazy(loadFilesEditorSettings)
const TerminalRuntimeSettings = lazy(loadTerminalRuntimeSettings)
const AssistantSettings = lazy(loadAssistantSettings)
const SkillsSettings = lazy(loadSkillsSettings)
const PluginsSettings = lazy(loadPluginsSettings)
const ProvidersSettings = lazy(loadProviderSettings)
const ProviderWritingSettings = lazy(loadProviderWritingSettings)
const GitSettings = lazy(loadSourceControlSettings)
const ProjectsSettings = lazy(loadProjectsSettings)
const MemorySettings = lazy(loadMemorySettings)
const ArchivedChatsSettings = lazy(loadArchivedChatsSettings)
const LogsSettings = lazy(loadDiagnosticsSettings)
const DataPrivacySettings = lazy(loadDataPrivacySettings)
const AboutSettings = lazy(loadAboutSettings)
const AssistantBrowserPopupWindow = lazy(() => import('./pages/assistant/AssistantBrowserPopupWindow').then((module) => ({ default: module.AssistantBrowserPopupWindow })))
const AssistantUtilityWindow = lazy(() => import('./pages/assistant/utility/AssistantUtilityWindow').then((module) => ({ default: module.AssistantUtilityWindow })))

interface TerminalContextType {
    isOpen: boolean
    openTerminal: (tool?: { id: string; category: string; displayName: string } | null, cwd?: string, initialCommand?: string) => void
    closeTerminal: () => void
    contextTool: { id: string; category: string; displayName: string } | null
    terminalCwd: string | null
    terminalCommand: string | null
    activeSessionCount: number
}

const BASE_TERMINAL_CONTEXT: TerminalContextType = {
    isOpen: false,
    openTerminal: () => { },
    closeTerminal: () => { },
    contextTool: null,
    terminalCwd: null,
    terminalCommand: null,
    activeSessionCount: 0
}

const TerminalContext = createContext<TerminalContextType>(BASE_TERMINAL_CONTEXT)

export const useTerminal = () => useContext(TerminalContext)

function PageLoader() {
    const location = useLocation()
    return <AppRouteSkeleton pathname={location.pathname} />
}

function AssistantRoute() {
    const { settings } = useSettings()
    return (
        <Suspense fallback={(
            <AssistantRouteShell
                sidebarCollapsed
                sidebarWidth={0}
                agentInboxEnabled={settings.assistantAgentInboxSidebarEnabled}
            />
        )}>
            <Assistant />
        </Suspense>
    )
}

function RetiredExplorerRedirect() {
    const location = useLocation()
    return <Navigate to={migrateLegacyExplorerShellLaunchRoute(location.pathname, location.search)} replace />
}

function MainContent() {
    useEffect(() => {
        const preload = () => {
            void loadAssistantRoute().catch(() => undefined)
        }
        if (typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(preload, { timeout: 800 })
            return () => window.cancelIdleCallback(idleId)
        }
        const timerId = window.setTimeout(preload, 120)
        return () => window.clearTimeout(timerId)
    }, [])

    return (
        <main
            className="flex-1 min-h-0 overflow-hidden overflow-x-hidden p-0 theme-adaptive focus:outline-none"
            tabIndex={0}
        >
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/" element={<Navigate to="/assistant" replace />} />
                    <Route element={<AssistantWorkspaceLifetime />}>
                        <Route path="/assistant" element={<AssistantRoute />} />
                        <Route path="/assistant/*" element={<AssistantRoute />} />
                        <Route path="/plugins" element={<PluginWorkspace />} />
                    </Route>
                    <Route path="/assistant/instructor" element={<InstructorVoiceLab />} />
                    <Route path="/settings" element={<SettingsShell />}>
                        <Route index element={<SettingsRedirect to="/settings/app/general" />} />
                        <Route path="app" element={<SettingsCategoryRedirect categoryId="app" />} />
                        <Route path="account" element={<SettingsCategoryRedirect categoryId="account" />} />
                        <Route path="assistant" element={<SettingsCategoryRedirect categoryId="assistant" />} />
                        <Route path="workspace" element={<SettingsCategoryRedirect categoryId="workspace" />} />
                        <Route path="data" element={<SettingsCategoryRedirect categoryId="data" />} />
                        <Route path="app/general" element={<GeneralSettings />} />
                        <Route path="app/keyboard-shortcuts" element={<KeyboardShortcutsSettings />} />
                        <Route path="app/appearance" element={<AppearanceSettings />} />
                        <Route path="app/appearance/typography" element={<AppearanceSettings view="typography" />} />
                        <Route path="app/appearance/layout" element={<AppearanceSettings view="layout" />} />
                        <Route path="app/appearance/colors" element={<AppearanceSettings view="colors" />} />
                        <Route path="providers" element={<ProvidersSettings />} />
                        <Route path="providers/models" element={<ProvidersSettings view="models" />} />
                        <Route path="usage" element={<SettingsRedirect to="/settings/providers/usage" />} />
                        <Route path="providers/limits" element={<ProvidersSettings view="limits" />} />
                        <Route path="providers/usage" element={<ProvidersSettings view="usage" />} />
                        <Route path="providers/writing" element={<ProviderWritingSettings />} />
                        <Route path="account/openai" element={<SettingsRedirect to="/settings/providers/usage" />} />
                        <Route path="account/providers" element={<SettingsRedirect to="/settings/providers/writing" />} />
                        <Route path="assistant/providers" element={<SettingsRedirect to="/settings/providers/writing" />} />
                        <Route path="account/devices" element={<ConnectionsSettings />} />
                        <Route path="account/devices/chrome" element={<ConnectionsSettings view="chrome" />} />
                        <Route path="account/devices/mobile" element={<ConnectionsSettings view="mobile" />} />
                        <Route path="assistant/defaults" element={<AssistantSettings />} />
                        <Route path="assistant/chat-defaults" element={<AssistantSettings view="defaults" />} />
                        <Route path="assistant/display" element={<AssistantSettings view="display" />} />
                        <Route path="assistant/archived" element={<ArchivedChatsSettings />} />
                        <Route path="assistant/permissions" element={<SettingsRedirect to="/settings/assistant/defaults" />} />
                        <Route path="assistant/skills" element={<SkillsSettings />} />
                        <Route path="assistant/plugins" element={<PluginsSettings />} />
                        <Route path="assistant/skills/conflicts" element={<SkillsSettings view="conflicts" />} />
                        <Route path="assistant/voice" element={<VoiceSettings />} />
                        <Route path="assistant/voice/history" element={<VoiceSettings view="history" />} />
                        <Route path="assistant/voice/conversation" element={<VoiceSettings view="conversation" />} />
                        <Route path="assistant/memory" element={<MemorySettings />} />
                        <Route path="assistant/memory/inspect" element={<MemorySettings view="inspect" />} />
                        <Route path="workspace/browser" element={<BrowserControlSettings />} />
                        <Route path="workspace/browser/privacy" element={<BrowserControlSettings view="privacy" />} />
                        <Route path="workspace/browser/data" element={<BrowserControlSettings view="data" />} />
                        <Route path="workspace/browser/extensions" element={<BrowserControlSettings view="extensions" />} />
                        <Route path="workspace/files" element={<FilesEditorSettings />} />
                        <Route path="workspace/files/editor" element={<FilesEditorSettings view="editor" />} />
                        <Route path="workspace/files/run" element={<Navigate to="/settings/workspace/files" replace />} />
                        <Route path="workspace/terminal" element={<TerminalRuntimeSettings />} />
                        <Route path="workspace/projects" element={<ProjectsSettings />} />
                        <Route path="workspace/projects/discovery" element={<ProjectsSettings view="discovery" />} />
                        <Route path="workspace/projects/presentation" element={<Navigate to="/settings/workspace/projects" replace />} />
                        <Route path="workspace/source-control" element={<GitSettings />} />
                        <Route path="workspace/source-control/pull-requests" element={<GitSettings view="pull-requests" />} />
                        <Route path="workspace/source-control/writing" element={<GitSettings view="writing" />} />
                        <Route path="workspace/source-control/writing/connections" element={<ProviderWritingSettings backTo="/settings/workspace/source-control/writing" backLabel="AI writing" />} />
                        <Route path="workspace/source-control/writing/logs" element={<LogsSettings context="writing" />} />
                        <Route path="data/privacy" element={<DataPrivacySettings />} />
                        <Route path="data/memory" element={<SettingsRedirect to="/settings/assistant/memory" />} />
                        <Route path="data/archived" element={<SettingsRedirect to="/settings/assistant/archived" />} />
                        <Route path="data/diagnostics" element={<LogsSettings />} />
                        <Route path="about" element={<AboutSettings />} />
                        <Route path="general" element={<SettingsRedirect to="/settings/app/general" />} />
                        <Route path="appearance" element={<SettingsRedirect to="/settings/app/appearance" />} />
                        <Route path="connections" element={<SettingsRedirect to="/settings/account/devices" />} />
                        <Route path="skills" element={<SettingsRedirect to="/settings/assistant/skills" />} />
                        <Route path="voice" element={<SettingsRedirect to="/settings/assistant/voice" />} />
                        <Route path="browser-control" element={<SettingsRedirect to="/settings/workspace/browser" />} />
                        <Route path="files-editor" element={<SettingsRedirect to="/settings/workspace/files" />} />
                        <Route path="terminal-runtime" element={<SettingsRedirect to="/settings/workspace/terminal" />} />
                        <Route path="source-control" element={<SettingsRedirect to="/settings/workspace/source-control" />} />
                        <Route path="projects" element={<SettingsRedirect to="/settings/workspace/projects" />} />
                        <Route path="memory" element={<SettingsRedirect to="/settings/data/memory" />} />
                        <Route path="diagnostics" element={<SettingsRedirect to="/settings/data/diagnostics" />} />
                        <Route path="archived" element={<SettingsRedirect to="/settings/data/archived" />} />
                        <Route path="beta" element={<SettingsRedirect to="/settings/workspace/projects" />} />
                        <Route path="chat" element={<SettingsRedirect to="/settings/assistant/defaults" />} />
                        <Route path="behavior" element={<SettingsRedirect to="/settings/app/general" />} />
                        <Route path="ai" element={<SettingsRedirect to="/settings/providers/writing" />} />
                        <Route path="git" element={<SettingsRedirect to="/settings/workspace/source-control" />} />
                        <Route path="explorer" element={<SettingsRedirect to="/settings/workspace/projects" />} />
                        <Route path="logs" element={<SettingsRedirect to="/settings/data/diagnostics" />} />
                        <Route path="*" element={<SettingsRedirect to="/settings/app/general" />} />
                    </Route>

                    <Route path="/home" element={<Navigate to="/assistant" replace />} />
                    <Route path="/home/*" element={<Navigate to="/assistant" replace />} />
                    <Route path="/projects" element={<Navigate to="/assistant" replace />} />
                    <Route path="/projects/*" element={<Navigate to="/assistant" replace />} />
                    <Route path="/folder-browse/*" element={<Navigate to="/assistant" replace />} />
                    <Route path="/explorer" element={<RetiredExplorerRedirect />} />
                    <Route path="/explorer/*" element={<RetiredExplorerRedirect />} />
                    <Route path="/tasks" element={<Navigate to="/assistant" replace />} />
                    <Route path="/tasks/*" element={<Navigate to="/assistant" replace />} />
                    <Route path="/terminals" element={<Navigate to="/assistant" replace />} />
                    <Route path="/terminals/*" element={<Navigate to="/assistant" replace />} />
                    <Route path="/skills" element={<Navigate to="/assistant" replace />} />
                    <Route path="*" element={<Navigate to="/assistant" replace />} />
                </Routes>
            </Suspense>
        </main>
    )
}

function TerminalContextProvider({ children }: { children: ReactNode }) {
    const { settings } = useSettings()

    const openTerminal: TerminalContextType['openTerminal'] = (_tool, cwd, initialCommand) => {
        if (!cwd) {
            window.alert('Terminal can only be opened from a folder path in Zyra.')
            return
        }

        void window.devscope
            .openInTerminal(cwd, settings.defaultShell, initialCommand)
            .then((result) => {
                if (!result?.success) {
                    window.alert(result?.error || 'Failed to open terminal.')
                }
            })
            .catch((err: any) => {
                window.alert(err?.message || 'Failed to open terminal.')
            })
    }

    return (
        <TerminalContext.Provider value={{ ...BASE_TERMINAL_CONTEXT, openTerminal }}>
            {children}
        </TerminalContext.Provider>
    )
}

function DevLoadingPreviewOverlay() {
    const [visible, setVisible] = useState(false)
    const location = useLocation()

    useEffect(() => {
        if (!import.meta.env.DEV) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (appShortcut(event) !== 'app.loadingPreview') return
            event.preventDefault()
            setVisible((current) => !current)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    if (!import.meta.env.DEV || !visible) return null

    return (
        <div className="fixed bottom-0 left-0 right-0 top-[34px] z-40 bg-sparkle-bg">
            <AppRouteSkeleton pathname={location.pathname} />
        </div>
    )
}

function AppContent() {
    const { settings } = useSettings()

    return (
        <div className={`flex h-screen flex-col overflow-hidden bg-sparkle-bg text-sparkle-text ${settings.compactMode ? 'compact-mode' : ''}`}>
            {isBrowserExtension ? <ExtensionSidebarHeader /> : <TitleBar />}
            <div className={`flex min-h-0 flex-1 ${isBrowserExtension ? '' : 'pt-[34px]'}`}>
                <MainContent />
            </div>
            <DevLoadingPreviewOverlay />
            <LinkHoverStatus />
        </div>
    )
}

function NormalDesktopApp() {
    return (
        <AppUpdatesProvider>
            <CommandPaletteProvider>
                <TerminalContextProvider>
                    <HashRouter>
                        <AssistantTitleBarProvider>
                            <ProjectCreationProvider>
                                <AppMenuCommandHost />
                                <ShortcutHints />
                                <AgentAppOperations />
                                <AppContent />
                                <CommandPalette />
                                <QuickOpenDialog />
                                <UpdatePromptCenter />
            <RuntimeActivationNotice />
                            </ProjectCreationProvider>
                        </AssistantTitleBarProvider>
                    </HashRouter>
                </TerminalContextProvider>
            </CommandPaletteProvider>
        </AppUpdatesProvider>
    )
}

function AppSurface() {
    if (/^#\/voice-widget(?:[/?]|$)/.test(window.location.hash)) {
        return <Suspense fallback={null}><AssistantVoiceWidget /></Suspense>
    }
    if (/^#\/accessories(?:[/?]|$)/.test(window.location.hash)) {
        return <SettingsProvider><TerminalContextProvider><HashRouter><Suspense fallback={<div className="flex h-screen items-center justify-center bg-sparkle-bg text-sm text-sparkle-text-secondary">Opening Accessories…</div>}><AccessoryWindowPage /></Suspense></HashRouter></TerminalContextProvider></SettingsProvider>
    }
    if (isQuickPreviewRoute(window.location.hash)) return <QuickOpenWindow />
    const assistantUtilityWindow = /^#\/assistant-utility(?:[/?]|$)/.test(window.location.hash)
    if (assistantUtilityWindow) {
        return (
            <SettingsProvider>
                <Suspense fallback={<AppRouteSkeleton pathname="/assistant-utility" />}>
                    <AssistantUtilityWindow />
                </Suspense>
            </SettingsProvider>
        )
    }
    const browserPopupWindow = /^#\/browser-popup(?:[/?]|$)/.test(window.location.hash)
    if (browserPopupWindow) {
        return (
            <SettingsProvider>
                <Suspense fallback={<AppRouteSkeleton pathname="/browser-popup" />}>
                    <AssistantBrowserPopupWindow />
                </Suspense>
            </SettingsProvider>
        )
    }
    return (
        <SettingsProvider>
            <OnboardingProvider>
                <OnboardingGate loadingFallback={<AppBootSkeleton />}>
                    <AssistantVoiceProvider><NormalDesktopApp /></AssistantVoiceProvider>
                </OnboardingGate>
            </OnboardingProvider>
        </SettingsProvider>
    )
}

function App() {
    useEffect(() => {
        if (typeof window.devscope.browserView?.refreshTheme !== 'function') return
        const refreshBrowserTheme = () => window.devscope.browserView.refreshTheme()
        window.addEventListener(ZYRA_THEME_CHANGED_EVENT, refreshBrowserTheme)
        return () => window.removeEventListener(ZYRA_THEME_CHANGED_EVENT, refreshBrowserTheme)
    }, [])
    return <><AppSurface /><AssistantBrowserRecordingHost /><DesktopLinkHost /></>
}

export default App
