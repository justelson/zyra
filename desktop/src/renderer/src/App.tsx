import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { migrateLegacyExplorerShellLaunchRoute } from '@shared/assistant/files-shell-launch-route'
import TitleBar from './components/layout/TitleBar'
import { AppBootSkeleton, AppRouteSkeleton } from './components/ui/AppRouteSkeleton'
import { SettingsProvider, useSettings } from './lib/settings'
import { CommandPaletteProvider } from './lib/commandPalette'
import CommandPalette from './components/CommandPalette'
import LinkHoverStatus from './components/ui/LinkHoverStatus'
import { UpdatePromptCenter } from './components/updates/UpdatePromptCenter'
import { AppUpdatesProvider } from './lib/app-updates'
import { AssistantTitleBarProvider } from './lib/assistant/assistant-title-bar'
import { OnboardingProvider } from './lib/onboarding'
import { OnboardingGate } from './onboarding/OnboardingGate'
import { AssistantRouteShell } from './pages/assistant/AssistantRouteShell'
import {
    ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY,
    resolveStoredAssistantLeftSidebarWidth
} from './pages/assistant/assistant-pane-layout'
import {
    loadAboutSettings,
    loadAccountSettings,
    loadAppearanceSettings,
    loadArchivedChatsSettings,
    loadAssistantSettings,
    loadBrowserControlSettings,
    loadConnectionsSettings,
    loadDataPrivacySettings,
    loadDiagnosticsSettings,
    loadFilesEditorSettings,
    loadGeneralSettings,
    loadMemorySettings,
    loadProjectsSettings,
    loadProviderSettings,
    loadSettingsOverview,
    loadSettingsShell,
    loadSkillsSettings,
    loadSourceControlSettings,
    loadTerminalRuntimeSettings,
    loadVoiceSettings
} from './pages/settings/settings-route-loaders'

const loadAssistantRoute = () => import('./pages/Assistant')
const Assistant = lazy(loadAssistantRoute)
const InstructorVoiceLab = lazy(() => import('./pages/assistant/InstructorVoiceLab'))
const SettingsShell = lazy(loadSettingsShell)
const SettingsOverview = lazy(loadSettingsOverview)
const GeneralSettings = lazy(loadGeneralSettings)
const AppearanceSettings = lazy(loadAppearanceSettings)
const VoiceSettings = lazy(loadVoiceSettings)
const ConnectionsSettings = lazy(loadConnectionsSettings)
const BrowserControlSettings = lazy(loadBrowserControlSettings)
const FilesEditorSettings = lazy(loadFilesEditorSettings)
const TerminalRuntimeSettings = lazy(loadTerminalRuntimeSettings)
const AssistantSettings = lazy(loadAssistantSettings)
const SkillsSettings = lazy(loadSkillsSettings)
const AccountSettings = lazy(loadAccountSettings)
const AISettings = lazy(loadProviderSettings)
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
    const sidebarWidth = resolveStoredAssistantLeftSidebarWidth(
        localStorage.getItem(ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY)
    )

    return (
        <Suspense fallback={(
            <AssistantRouteShell
                sidebarCollapsed={settings.sidebarCollapsed}
                sidebarWidth={sidebarWidth}
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
                    <Route path="/assistant" element={<AssistantRoute />} />
                    <Route path="/assistant/instructor" element={<InstructorVoiceLab />} />
                    <Route path="/assistant/*" element={<AssistantRoute />} />
                    <Route path="/settings" element={<SettingsShell />}>
                        <Route index element={<Navigate to="/settings/app" replace />} />
                        <Route path="app" element={<SettingsOverview />} />
                        <Route path="account" element={<SettingsOverview />} />
                        <Route path="assistant" element={<SettingsOverview />} />
                        <Route path="workspace" element={<SettingsOverview />} />
                        <Route path="data" element={<SettingsOverview />} />
                        <Route path="app/general" element={<GeneralSettings />} />
                        <Route path="app/appearance" element={<AppearanceSettings />} />
                        <Route path="account/openai" element={<AccountSettings />} />
                        <Route path="account/devices" element={<ConnectionsSettings />} />
                        <Route path="assistant/defaults" element={<AssistantSettings />} />
                        <Route path="assistant/skills" element={<SkillsSettings />} />
                        <Route path="assistant/voice" element={<VoiceSettings />} />
                        <Route path="assistant/providers" element={<AISettings />} />
                        <Route path="workspace/browser" element={<BrowserControlSettings />} />
                        <Route path="workspace/files" element={<FilesEditorSettings />} />
                        <Route path="workspace/terminal" element={<TerminalRuntimeSettings />} />
                        <Route path="workspace/projects" element={<ProjectsSettings />} />
                        <Route path="workspace/source-control" element={<GitSettings />} />
                        <Route path="data/privacy" element={<DataPrivacySettings />} />
                        <Route path="data/memory" element={<MemorySettings />} />
                        <Route path="data/archived" element={<ArchivedChatsSettings />} />
                        <Route path="data/diagnostics" element={<LogsSettings />} />
                        <Route path="about" element={<AboutSettings />} />
                        <Route path="general" element={<Navigate to="/settings/app/general" replace />} />
                        <Route path="appearance" element={<Navigate to="/settings/app/appearance" replace />} />
                        <Route path="connections" element={<Navigate to="/settings/account/devices" replace />} />
                        <Route path="skills" element={<Navigate to="/settings/assistant/skills" replace />} />
                        <Route path="voice" element={<Navigate to="/settings/assistant/voice" replace />} />
                        <Route path="browser-control" element={<Navigate to="/settings/workspace/browser" replace />} />
                        <Route path="files-editor" element={<Navigate to="/settings/workspace/files" replace />} />
                        <Route path="terminal-runtime" element={<Navigate to="/settings/workspace/terminal" replace />} />
                        <Route path="providers" element={<Navigate to="/settings/assistant/providers" replace />} />
                        <Route path="source-control" element={<Navigate to="/settings/workspace/source-control" replace />} />
                        <Route path="projects" element={<Navigate to="/settings/workspace/projects" replace />} />
                        <Route path="memory" element={<Navigate to="/settings/data/memory" replace />} />
                        <Route path="diagnostics" element={<Navigate to="/settings/data/diagnostics" replace />} />
                        <Route path="archived" element={<Navigate to="/settings/data/archived" replace />} />
                        <Route path="beta" element={<Navigate to="/settings/workspace/projects" replace />} />
                        <Route path="chat" element={<Navigate to="/settings/assistant/defaults" replace />} />
                        <Route path="behavior" element={<Navigate to="/settings/app/general" replace />} />
                        <Route path="ai" element={<Navigate to="/settings/assistant/providers" replace />} />
                        <Route path="git" element={<Navigate to="/settings/workspace/source-control" replace />} />
                        <Route path="explorer" element={<Navigate to="/settings/workspace/projects" replace />} />
                        <Route path="logs" element={<Navigate to="/settings/data/diagnostics" replace />} />
                        <Route path="*" element={<Navigate to="/settings" replace />} />
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
                    <Route path="/quick-open" element={<Navigate to="/assistant" replace />} />
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
            const isModifier = event.ctrlKey || event.metaKey
            if (!isModifier || !event.shiftKey || event.key.toLowerCase() !== 'l') return
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
            <TitleBar />
            <div className="flex min-h-0 flex-1 pt-[34px]">
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
                            <AppContent />
                            <CommandPalette />
                            <UpdatePromptCenter />
                        </AssistantTitleBarProvider>
                    </HashRouter>
                </TerminalContextProvider>
            </CommandPaletteProvider>
        </AppUpdatesProvider>
    )
}

function App() {
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
                    <NormalDesktopApp />
                </OnboardingGate>
            </OnboardingProvider>
        </SettingsProvider>
    )
}

export default App
