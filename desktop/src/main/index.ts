import { KEYBINDING_DISPATCH_CHANNEL, configureShortcutOverrides, shortcutAccelerator, type AppNavigationCommand, type ShortcutPlatform } from '../shared/keybindings'
import { prepareAppShortcutInput, registerKeybindingRecording } from './keybindings'
import { assistantUtilityProvisionalUrl } from './assistant-utility-provisional-document'
import { defaultThemeTokens, resolveDefaultAppearance } from '../shared/preferences/default-theme-tokens'
import { browserRecordingCapture } from './browser-recording-capture'
/**
 * Zyra
 * Main Process Entry Point
 */

import { app, BrowserWindow, Menu, dialog, shell, nativeTheme, protocol, globalShortcut, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { initializeProtectedMedia } from './protected-media-service'
import { dirname, isAbsolute, join } from 'path'
import { existsSync, statSync } from 'fs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { electronApp, is } from './utils'
import log from 'electron-log'
import { registerIpcHandlers } from './ipc'
import { ipcMain, registerTrustedIpcSender } from './ipc/trusted-ipc'
import { configurePreviewTerminalWorkspaceAuthorizer, disposePreviewTerminalRuntime } from './ipc/handlers/preview-terminal-handlers'
import { configureProjectOpenAnalytics } from './ipc/handlers/project-details-handlers'
import { configureAssistantService, disposeAssistantService, getAssistantService } from './assistant'
import { AssistantUtilityWindowManager, type ResolvedUtilityChat, type UtilityWindowCreationOptions } from './assistant/assistant-utility-window-manager'
import { persistAssistantClipboardImage, resolveAssistantClipboardAttachment } from './assistant/clipboard-attachments'
import { getCodexVoiceTranscriptionState } from './assistant/codex-voice-transcription'
import { deleteVoiceHistory, getFailedVoiceRecording, listVoiceHistory, saveVoiceHistory, transcribeVoiceAndSave } from './assistant/voice-history'
import { BrowserClientRuntime } from './browser-client-runtime'
import { configureUpdateAnalytics, disposeUpdater, initializeUpdater, registerUpdateWindow } from './update/manager'
import { registerFileProtocol } from './file-protocol'
import { configureBrowserActionAnalytics, configureBrowserPermissionAnalytics, flushGlobalBrowserProfileStorage, isSafeBrowserNavigationUrl } from './ipc/handlers/browser-preview-handlers'
import {
    configureWindowsControlOverlayAppearance,
    configureChromeBrowserAppearance,
    refreshChromeBrowserAppearance,
    disposeAgentControlBroker,
    getAgentControlBroker,
    refreshWindowsControlOverlayAppearance
} from './agent-control'
import { trustedBrowserGuests } from './agent-control/trusted-guest-registry'
import { resolveZyraWindowChromePolicy, type ZyraDesktopPlatform } from '../shared/platform-window-chrome'
import { attachWindowStateEvents } from './window-state-events'
import {
    BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL,
    type DevScopeBrowserOpenTabRequest
} from '../shared/contracts/devscope-api'
import { BrowserPopupManager } from './browser-popup-manager'
import { BrowserViewManager } from './browser-view-manager'
import { AccessoryWindowManager } from './accessory-window-manager'
import { BrowserRecordingOverlayManager } from './browser-recording-overlay'
import { NativeOverlayManager } from './native-overlay-manager'
import { disposeBrowserThreatProtectionService, getBrowserThreatProtectionService } from './browser-threat-protection-service'
import { createDesktopSetupServices } from './setup'
import { initializeDesktopStartup } from './setup/startup-initialization'
import { resolveZyraRoot } from './zyra/zyra-root'
import { registerInstalledDesktop } from './desktop-install-registration'
import { dispatchDesktopTui, isDesktopTuiDispatch } from './desktop-tui-dispatcher'
import { createRendererHangRecorder } from './diagnostics/renderer-hang-recorder'
import { BROWSER_POPUP_PRELOAD_ARGUMENT } from '../shared/preload-surfaces'
import { configureBrowserDownloadAnalytics } from './browser-download-service'
import { inspectProjectAnalyticsCapabilities } from './analytics/project-capabilities'
import { normalizeAnalyticsOnboardingStep } from '../shared/analytics/contracts'
import { buildAssistantFilesShellLaunchRoute } from '../shared/assistant/files-shell-launch-route'
import { buildQuickPreviewRoute } from '../shared/file-preview-route'
import { BROWSER_LOCAL_FILE_SCHEME } from '../shared/browser-view'
import type { AccessoryWindowState } from '../shared/accessories'
import { configureRuntimeInstallation } from './assistant/runtime-activation'
import { configureDesktopTerminalEnvironment, desktopNamespaceId } from './assistant/agent-server-namespace'
import { buildMetadata, isPreviewDistribution, resolveDistributionIdentity } from '../shared/distribution-identity'

const __dirname = dirname(fileURLToPath(import.meta.url))

app.enableSandbox()

type RuntimeIdentity = ReturnType<typeof resolveDistributionIdentity>
const runtimeIdentity = resolveDistributionIdentity(is.dev, buildMetadata, process.env.ZYRA_DEV_INSTANCE_SUFFIX)
const APP_NAME = runtimeIdentity.appName

function applyRuntimeIdentity(identity: RuntimeIdentity): void {
    app.setName(identity.appName)

    if (!identity.isolated) return

    const userDataPath = join(app.getPath('appData'), identity.userDataDirectoryName)
    app.setPath('userData', userDataPath)
    app.setPath('sessionData', join(userDataPath, 'session'))
}

applyRuntimeIdentity(runtimeIdentity)
configureDesktopTerminalEnvironment(app.getPath('userData'))
configureRuntimeInstallation({
    kind: runtimeIdentity.isDevRuntime ? 'development' : 'installed',
    namespaceId: desktopNamespaceId(app.getPath('userData')),
    label: runtimeIdentity.isDevRuntime ? runtimeIdentity.appName.replace('Zyra-dev', 'Development') : runtimeIdentity.appName,
    appVersion: app.getVersion()
})

let mainWindow: BrowserWindow | null = null

async function readMainRendererOverlayAppearance(): Promise<Record<string, unknown>> {
    const window = mainWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isLoading()) return {}
    try {
        const appearance = await window.webContents.executeJavaScript(`(() => {
            const root = document.documentElement
            const styles = getComputedStyle(root)
            const token = (name) => styles.getPropertyValue(name).trim()
            return {
                accentPrimary: token('--accent-primary'),
                accentSecondary: token('--accent-secondary'),
                themeBackground: token('--color-bg'),
                themeSurface: token('--color-card'),
                themeText: token('--color-text'),
                themeTextSecondary: token('--color-text-secondary'),
                themeBorder: token('--color-border-secondary') || token('--color-border'),
                themeAppearance: styles.colorScheme === 'light' || root.classList.contains('light') ? 'light' : 'dark',
                uiFont: token('--font-ui') || getComputedStyle(document.body).fontFamily
            }
        })()`, true)
        return appearance && typeof appearance === 'object' && !Array.isArray(appearance)
            ? appearance as Record<string, unknown>
            : {}
    } catch {
        return {}
    }
}

const launchStartedAt = performance.now()
const setupServices = createDesktopSetupServices(app.getPath('userData'))
configureShortcutOverrides(() => setupServices.preferences.getKeyboardShortcuts())
registerKeybindingRecording(
    command => { if (setupServices.onboarding.isAccessAllowed()) sendAppMenuCommand(command) },
    command => { if (setupServices.onboarding.isAccessAllowed()) sendMainRendererCommand(KEYBINDING_DISPATCH_CHANNEL, command) }
)
let startupThemeMode: unknown = 'system'
async function refreshStartupTheme(): Promise<void> {
    try { startupThemeMode = (await setupServices.preferences.get({ surface: 'desktop' })).settings.appearanceThemeMode }
    catch (error) { log.warn('[Appearance] could not load startup appearance', error) }
}
function startupTheme() {
    return defaultThemeTokens(resolveDefaultAppearance(startupThemeMode, nativeTheme.shouldUseDarkColors))
}
configureChromeBrowserAppearance(async () => {
    const { settings } = await setupServices.preferences.get({ surface: 'desktop' })
    return Object.fromEntries(['appearanceThemeMode', 'appearanceLightTheme', 'appearanceDarkTheme', 'accentColor', 'appearanceCustomTheme', 'appearanceCustomThemeActive', 'accessibilityReduceMotion'].map((key) => [key, settings[key]]))
})
configureWindowsControlOverlayAppearance(async () => {
    const settings = (await setupServices.preferences.get({ surface: 'desktop' })).settings
    const accent = settings.accentColor && typeof settings.accentColor === 'object' && !Array.isArray(settings.accentColor)
        ? settings.accentColor as Record<string, unknown>
        : {}
    const themeAppearance = resolveDefaultAppearance(settings.appearanceThemeMode, nativeTheme.shouldUseDarkColors)
    const tokens = defaultThemeTokens(themeAppearance)
    const themeFallback = { themeBackground: tokens.bg, themeSurface: tokens.card, themeText: tokens.text, themeTextSecondary: tokens.textSecondary, themeBorder: tokens.borderSecondary }
    return {
        accentPrimary: typeof accent.primary === 'string' ? accent.primary : undefined,
        accentSecondary: typeof accent.secondary === 'string' ? accent.secondary : undefined,
        ...themeFallback,
        themeAppearance,
        ...await readMainRendererOverlayAppearance(),
        reduceMotion: settings.accessibilityReduceMotion === true,
        compact: settings.compactMode === true
    }
})
const WINDOWS_OVERLAY_APPEARANCE_KEYS = new Set([
    'accentColor', 'appearanceThemeMode', 'appearanceLightTheme', 'appearanceDarkTheme',
    'appearanceCustomTheme', 'appearanceCustomThemeActive', 'appearanceUiFont',
    'accessibilityReduceMotion', 'compactMode'
])
setupServices.preferences.subscribe((event) => {
    if (event.changedKeys.includes('assistantMemoryEnabled')) {
        void setupServices.preferences.getAssistantMemoryEnabled().then((enabled) => getAssistantService()?.setMemoryEnabled(enabled)).catch(() => undefined)
    }
    if (event.changedKeys.includes('keyboardShortcuts')) configureApplicationMenu(setupServices.onboarding.isAccessAllowed())
    if (event.changedKeys.includes('appearanceThemeMode')) void refreshStartupTheme()
    if (event.changedKeys.includes('appearanceInterfaceScale')) void refreshInterfaceZoom()
    if (event.changedKeys.some((key) => WINDOWS_OVERLAY_APPEARANCE_KEYS.has(key))) {
        setTimeout(refreshWindowsControlOverlayAppearance, 50).unref?.()
        void refreshChromeBrowserAppearance().catch(() => undefined)
    }
})
void refreshInterfaceZoom()
configureProjectOpenAnalytics((projectPath, outcome) => captureProjectOpenAnalytics(projectPath, outcome))
configureUpdateAnalytics((properties) => setupServices.analytics.capture({ event: 'zyra_v1_app_lifecycle', properties }))
configureBrowserDownloadAnalytics((properties) => setupServices.analytics.capture({ event: 'zyra_v1_browser', properties }))
configureBrowserPermissionAnalytics((outcome) => setupServices.analytics.capture({ event: 'zyra_v1_browser', properties: { action: 'permission', outcome } }))

// Configure logging
const verboseMainLogs = process.env.ZYRA_VERBOSE_LOGS === '1'
log.transports.file.level = 'info'
log.transports.console.level = verboseMainLogs ? 'debug' : 'warn'
console.log = log.log
console.error = log.error
console.warn = log.warn

let isIncognitoBrowserWebContents = (_webContentsId: number): boolean => false
let hasIncognitoBrowserContents = (): boolean => false

const rendererHangRecorder = createRendererHangRecorder({
    userDataPath: app.getPath('userData'),
    getAssistantContext: () => getAssistantService().getHangDiagnosticContext(),
    onIncident: (incident) => {
        if (incident.reason.includes('process-gone')) return
        if (incident.webContentsId !== null && isIncognitoBrowserWebContents(incident.webContentsId)) return
        if (hasIncognitoBrowserContents()) return
        setupServices.analytics.capture({
            event: 'zyra_v1_app_lifecycle',
            properties: {
                action: 'hang',
                outcome: 'completed',
                process_kind: incident.processKind,
                ...(incident.durationMs === undefined ? {} : { duration_ms: incident.durationMs })
            }
        })
    }
})

let quickPreviewWindow: BrowserWindow | null = null
let browserClientRuntime: BrowserClientRuntime | null = null
let hasRegisteredIpcHandlers = false
let normalDesktopRuntimeStarted = false
let quitCleanupStarted = false
let quitCleanupComplete = false
const pendingShellLaunchTargets: ShellLaunchTarget[] = []
const FILE_PROTOCOL = 'zyra'

type ShellLaunchTarget = {
    kind: 'file' | 'directory'
    path: string
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: FILE_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true
        }
    },
    {
        scheme: BROWSER_LOCAL_FILE_SCHEME,
        privileges: {
            secure: true,
            stream: true
        }
    }
])

const getPreloadPath = (): string => {
    const preloadCjs = join(__dirname, '../preload/index.cjs')
    const preloadJs = join(__dirname, '../preload/index.js')
    return existsSync(preloadCjs) ? preloadCjs : preloadJs
}

const getAppIconPath = (): string | undefined => {
    const family = runtimeIdentity.isDevRuntime ? 'dev' : 'prod'
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    const extension = process.platform === 'win32' ? 'ico' : 'png'
    const variantName = `zyra-${family}-${theme}.${extension}`
    const masterName = `zyra-${family}.${extension}`
    const fallbackName = runtimeIdentity.isDevRuntime
        ? `icon-dev.${extension}`
        : `icon.${extension}`
    const candidates = [
        join(process.cwd(), 'resources/branding/icons', variantName),
        join(app.getAppPath(), 'resources/branding/icons', variantName),
        join(process.cwd(), 'resources/branding/icons', masterName),
        join(app.getAppPath(), 'resources/branding/icons', masterName),
        join(process.resourcesPath, fallbackName),
        join(app.getAppPath(), 'resources', fallbackName),
        join(process.cwd(), 'resources', fallbackName)
    ]
    return candidates.find((candidate) => existsSync(candidate))
}

function syncOpenWindowIcons(): void {
    if (process.platform === 'darwin') return
    const iconPath = getAppIconPath()
    if (!iconPath) return
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.setIcon(iconPath)
    }
}

function getWindowChromeOptions(): Pick<Electron.BrowserWindowConstructorOptions, 'frame' | 'titleBarStyle' | 'trafficLightPosition' | 'autoHideMenuBar'> {
    const platform = process.platform as ZyraDesktopPlatform
    const policy = resolveZyraWindowChromePolicy(platform)

    if (platform === 'darwin') {
        return {
            frame: policy.nativeFrame,
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 14, y: 10 },
            autoHideMenuBar: false
        }
    }

    return {
        frame: policy.nativeFrame,
        titleBarStyle: 'default',
        autoHideMenuBar: true
    }
}

function sendAppMenuCommand(command: 'new-chat' | 'search' | 'settings' | 'reload' | 'about'): void {
    sendMainRendererCommand('window:app-menu-command', command)
}

function sendMainRendererCommand(channel: 'window:app-menu-command' | typeof KEYBINDING_DISPATCH_CHANNEL, command: string | AppNavigationCommand): void {
    const openingWindow = !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()
    if (openingWindow) {
        mainWindow = createWindow(true)
        ensureIpcHandlersRegistered(mainWindow)
    }
    const target = mainWindow!
    if (target.isMinimized()) target.restore()
    if (!target.isVisible()) target.show()
    target.focus()
    const deliver = () => {
        if (!target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send(channel, command)
    }
    if (openingWindow || target.webContents.isLoadingMainFrame()) target.webContents.once('did-finish-load', deliver)
    else deliver()
}

// Fixed destination only. Browser clients never receive arbitrary window control.
ipcMain.handle('desktop:open-settings', () => {
    sendAppMenuCommand('settings')
    return { success: true }
})

function configureApplicationMenu(setupComplete = true): void {
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null)
        return
    }

    if (!setupComplete) {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {
                label: APP_NAME,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            { role: 'editMenu' },
            { role: 'windowMenu' }
        ]))
        return
    }

    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: APP_NAME,
            submenu: [
                { role: 'about' },
                {
                    label: 'Settings…',
                    accelerator: shortcutAccelerator('app.settings', process.platform as ShortcutPlatform),
                    registerAccelerator: false,
                    click: () => sendAppMenuCommand('settings')
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Chat',
                    accelerator: shortcutAccelerator('app.newChat', process.platform as ShortcutPlatform),
                    registerAccelerator: false,
                    click: () => sendAppMenuCommand('new-chat')
                },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Search',
                    accelerator: shortcutAccelerator('app.search', process.platform as ShortcutPlatform),
                    registerAccelerator: false,
                    click: () => sendAppMenuCommand('search')
                },
                { type: 'separator' },
                { label: 'Reload UI', accelerator: shortcutAccelerator('app.reload', process.platform as ShortcutPlatform), registerAccelerator: false, click: () => sendAppMenuCommand('reload') },
                ...(is.dev ? [{ role: 'toggleDevTools' as const, accelerator: shortcutAccelerator('app.devtools', process.platform as ShortcutPlatform), registerAccelerator: false }] : []),
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                {
                    label: 'About Zyra',
                    click: () => sendAppMenuCommand('about')
                },
                {
                    label: 'Zyra on GitHub',
                    click: () => void shell.openExternal('https://github.com/justelson/zyra')
                },
                {
                    label: 'Report an issue',
                    click: () => void shell.openExternal('https://github.com/justelson/zyra/issues')
                }
            ]
        }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

let interfaceZoomFactor = 1

function lockWindowZoom(window: BrowserWindow): void {
    const { webContents } = window

    // Chromium page zoom adjusts the logical viewport, so fixed-height app
    // shells reflow instead of CSS zoom enlarging and clipping them.
    webContents.setZoomLevel(0)
    webContents.setZoomFactor(interfaceZoomFactor)
    void webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
}

async function refreshInterfaceZoom(): Promise<void> {
    try {
        const value = Number((await setupServices.preferences.get({ surface: 'desktop' })).settings.appearanceInterfaceScale)
        interfaceZoomFactor = Number.isFinite(value) ? Math.max(0.85, Math.min(1.3, value / 100)) : 1
        for (const window of BrowserWindow.getAllWindows()) lockWindowZoom(window)
    } catch (error) {
        log.warn('[Appearance] could not load interface scale', error)
    }
}

function isSafeBrowserWindowOpenUrl(url: string): boolean {
    return url === 'about:blank' || isSafeBrowserNavigationUrl(url)
}

function requestBrowserTab(
    ownerWindow: BrowserWindow,
    sourceGuestWebContentsId: number,
    url: string,
    activate: boolean
): void {
    if (ownerWindow.isDestroyed() || !isSafeBrowserWindowOpenUrl(url)) return
    const threatProtection = getBrowserThreatProtectionService()
    if (url !== 'about:blank' && threatProtection && !threatProtection.consumeOneTimeAllowance(sourceGuestWebContentsId, url)) {
        const sourceGuest = trustedBrowserGuests.findByGuestId(sourceGuestWebContentsId)?.guest
        const warning = threatProtection.blockNavigation({
            ownerWebContentsId: ownerWindow.webContents.id,
            sourceGuestWebContentsId,
            blockedGuestWebContentsId: sourceGuestWebContentsId,
            navigationKind: 'new-tab',
            previousUrl: sourceGuest?.getURL() || '',
            url,
            proceed: () => requestBrowserTab(ownerWindow, sourceGuestWebContentsId, url, activate)
        })
        if (warning) return
    }
    const payload: DevScopeBrowserOpenTabRequest = {
        sourceGuestWebContentsId,
        url: url === 'about:blank' ? '' : url,
        activate
    }
    ownerWindow.webContents.send(BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL, payload)
}

const browserPopupManager = new BrowserPopupManager({
    createShellWindow: createBrowserPopupShellWindow,
    requestTab: requestBrowserTab,
    captureAnalytics: (properties) => setupServices.analytics.capture({ event: 'zyra_v1_browser', properties })
})
browserPopupManager.registerIpc()

const accessoryWindowManager = new AccessoryWindowManager({
    rootPath: app.getPath('home'),
    createWindow: createAccessoryShellWindow,
    canOpen: () => setupServices.onboarding.isAccessAllowed(),
    onTerminalWindowClosed: disposePreviewTerminalRuntime
})
accessoryWindowManager.registerIpc()

let assistantUtilityWindowManager!: AssistantUtilityWindowManager
const browserViewManager = new BrowserViewManager({
    popupManager: browserPopupManager,
    resolveOwnerId: (window) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow === window) return 'main'
        const utilityWindowId = assistantUtilityWindowManager?.windowIdForWebContents(window.webContents.id)
        if (utilityWindowId) return `utility:${utilityWindowId}`
        const accessoryWindowId = accessoryWindowManager.windowIdForWebContents(window.webContents.id)
        return accessoryWindowId ? `accessory:${accessoryWindowId}` : null
    },
    canUseBrowser: () => setupServices.onboarding.isAccessAllowed(),
    captureAnalytics: (properties) => setupServices.analytics.capture({ event: 'zyra_v1_browser', properties })
})
accessoryWindowManager.setBrowserViews(browserViewManager)
browserViewManager.registerIpc()
const browserRecordingOverlayManager = new BrowserRecordingOverlayManager({ browserViews: browserViewManager, preloadPath: getPreloadPath() })
browserRecordingOverlayManager.registerIpc()
const nativeOverlayManager = new NativeOverlayManager()
nativeOverlayManager.registerIpc()
isIncognitoBrowserWebContents = (webContentsId) => (
    browserViewManager.isIncognitoWebContents(webContentsId)
    || browserPopupManager.isIncognitoWebContents(webContentsId)
)
hasIncognitoBrowserContents = () => browserViewManager.hasIncognitoContents() || browserPopupManager.hasIncognitoContents()
configureBrowserActionAnalytics(
    (properties) => setupServices.analytics.capture({ event: 'zyra_v1_browser', properties }),
    (ownerWebContentsId, guestWebContentsId) => guestWebContentsId === undefined
        ? browserViewManager.isAnalyticsAllowedForOwner(ownerWebContentsId)
        : browserViewManager.isAnalyticsAllowedForGuest(guestWebContentsId)
)

assistantUtilityWindowManager = new AssistantUtilityWindowManager({
    userDataPath: app.getPath('userData'),
    createWindow: createAssistantUtilityShellWindow,
    activateWindow: (window, windowId) => loadRendererRoute(window, `/assistant-utility/${encodeURIComponent(windowId)}`),
    resolveChat: resolveAssistantUtilityChat,
    getMainWindow: () => mainWindow,
    browserViews: browserViewManager,
    captureAnalytics: (properties) => setupServices.analytics.capture({ event: 'zyra_v1_utility_window', properties })
})
assistantUtilityWindowManager.registerIpc()
configurePreviewTerminalWorkspaceAuthorizer(async (event, owner) => {
    if (owner?.kind === 'main-workspace') {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== event.sender.id) {
            throw new Error('Main terminal workspace registration requires the main Zyra renderer.')
        }
        return owner.runtimeId
    }
    if (owner?.kind === 'utility-tab') {
        const runtimeId = await assistantUtilityWindowManager.resolveOwnedTerminalRuntimeId(event.sender.id, owner.tabId)
        if (runtimeId) return runtimeId
        throw new Error('Terminal tab identity does not belong to this Zyra window.')
    }
    if (owner?.kind === 'accessory-window') {
        const runtimeId = accessoryWindowManager.resolveOwnedTerminalRuntimeId(event.sender.id, owner.workspaceId)
        if (runtimeId) return runtimeId
        throw new Error('Terminal accessory identity does not belong to this Zyra window.')
    }
    throw new Error('Preview terminal workspace owner is invalid.')
})

function registerEditableContextMenu(window: BrowserWindow): void {
    window.webContents.on('context-menu', (_event, params) => {
        if (!params.isEditable) return

        const template: Electron.MenuItemConstructorOptions[] = []

        if (params.misspelledWord) {
            if (params.dictionarySuggestions.length > 0) {
                template.push(
                    ...params.dictionarySuggestions.slice(0, 6).map((suggestion) => ({
                        label: suggestion,
                        click: () => window.webContents.replaceMisspelling(suggestion)
                    }))
                )
            } else {
                template.push({
                    label: 'No spelling suggestions',
                    enabled: false
                })
            }

            template.push({
                label: 'Add to Dictionary',
                click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            })
            template.push({ type: 'separator' })
        }

        template.push(
            { role: 'undo', enabled: params.editFlags.canUndo },
            { role: 'redo', enabled: params.editFlags.canRedo },
            { type: 'separator' },
            { role: 'cut', enabled: params.editFlags.canCut },
            { role: 'copy', enabled: params.editFlags.canCopy },
            { role: 'paste', enabled: params.editFlags.canPaste },
            { role: 'selectAll', enabled: params.editFlags.canSelectAll }
        )

        Menu.buildFromTemplate(template).popup({ window })
    })
}

function resolveShellLaunchTarget(arg: string): ShellLaunchTarget | null {
    const trimmed = String(arg || '').trim()
    if (!trimmed || trimmed.startsWith('-')) return null
    if (!existsSync(trimmed)) return null

    try {
        const stat = statSync(trimmed)
        if (stat.isDirectory()) {
            return { kind: 'directory', path: trimmed }
        }
        if (stat.isFile()) {
            return { kind: 'file', path: trimmed }
        }
    } catch {
        return null
    }

    return null
}

function extractShellLaunchTargetFromArgv(argv: string[]): ShellLaunchTarget | null {
    const startIndex = app.isPackaged ? 1 : 2
    for (let i = startIndex; i < argv.length; i += 1) {
        const candidate = String(argv[i] || '').trim()
        const shellLaunchTarget = resolveShellLaunchTarget(candidate)
        if (shellLaunchTarget) {
            return shellLaunchTarget
        }
    }
    return null
}

function ensureIpcHandlersRegistered(targetWindow: BrowserWindow): void {
    if (hasRegisteredIpcHandlers) return
    registerIpcHandlers(targetWindow, setupServices, () => mainWindow, browserViewManager)
    hasRegisteredIpcHandlers = true
}

function loadRendererRoute(window: BrowserWindow, routeWithSearch: string): void {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const url = new URL(process.env['ELECTRON_RENDERER_URL'])
        url.hash = routeWithSearch
        void window.loadURL(url.toString())
        return
    }
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: routeWithSearch })
}

function isTrustedRendererLocation(value: string): boolean {
    try {
        const candidate = new URL(value)
        const expected = is.dev && process.env['ELECTRON_RENDERER_URL']
            ? new URL(process.env['ELECTRON_RENDERER_URL'])
            : pathToFileURL(join(__dirname, '../renderer/index.html'))
        return candidate.protocol === expected.protocol
            && candidate.host === expected.host
            && candidate.pathname === expected.pathname
    } catch {
        return false
    }
}

function configureTrustedRendererWindow(window: BrowserWindow): void {
    registerTrustedIpcSender(window.webContents, isTrustedRendererLocation)
    nativeOverlayManager.registerOwner(window)
    window.webContents.on('before-input-event', (_event, input) => {
        prepareAppShortcutInput(window.webContents, input)
    })
    window.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedRendererLocation(url)) event.preventDefault()
    })
}

function buildExternalExplorerRoute(folderPath: string): string {
    return buildAssistantFilesShellLaunchRoute(folderPath)
}

function configureMainRendererMediaPermissions(): void {
    const isTrustedMainRenderer = (webContents: Electron.WebContents | null) => (
        Boolean(webContents && mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id)
    )

    // A recording grant opens only the exact owner frame's display request.
    // Ordinary microphone access stays audio-only, including detached recorders.
    const canUseMicrophone = (contents: Electron.WebContents | null) => (
        isTrustedMainRenderer(contents) || browserRecordingCapture.hasRecording(contents)
    )
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => (
        details.isMainFrame && (
            (permission === 'media' && browserRecordingCapture.hasGrant(contents))
            || (permission === 'media' && details.mediaType === 'audio' && canUseMicrophone(contents))
        )
    ))
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
        const mediaTypes = permission === 'media' && 'mediaTypes' in details && Array.isArray(details.mediaTypes)
            ? details.mediaTypes
            : []
        const audioOnly = mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === 'audio')
        callback(details.isMainFrame && (
            ((permission === 'display-capture' || permission === 'media') && browserRecordingCapture.hasGrant(contents))
            || (permission === 'media' && audioOnly && canUseMicrophone(contents))
        ))
    })
}

function createWindow(showOnReady = true, initialRoute = '/'): BrowserWindow {
    const iconPath = getAppIconPath()
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,
        ...getWindowChromeOptions(),
        backgroundColor: startupTheme().bg,
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            preload: getPreloadPath(),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            // Pause renderer presentation while hidden; visibility reconciliation
            // snaps transient queues to current Assistant state on restore.
            backgroundThrottling: true,
            devTools: true
        }
    })
    configureTrustedRendererWindow(window)

    window.on('ready-to-show', () => {
        if (showOnReady) window.show()
    })
    window.on('focus', () => {
        lockWindowZoom(window)
    })
    window.webContents.on('did-finish-load', () => {
        lockWindowZoom(window)
    })

    window.webContents.setWindowOpenHandler((details) => {
        const overlay = nativeOverlayManager.handleWindowOpen(window, details)
        if (overlay) return overlay
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    registerEditableContextMenu(window)
    attachWindowStateEvents(window)
    lockWindowZoom(window)
    loadRendererRoute(window, initialRoute)
    registerUpdateWindow(window)

    return window
}

function createAccessoryShellWindow(state: AccessoryWindowState): BrowserWindow {
    const iconPath = getAppIconPath()
    const title = state.kind === 'browser'
        ? state.sessionMode === 'incognito' ? 'Zyra Incognito Browser' : 'Zyra Browser'
        : state.kind === 'terminal' ? 'Zyra Terminal' : state.kind === 'devscope' ? 'Zyra DevScope' : 'Zyra File Explorer'
    const window = new BrowserWindow({
        width: state.kind === 'browser' || state.kind === 'devscope' ? 1200 : 1120,
        height: 800,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title,
        ...getWindowChromeOptions(),
        backgroundColor: startupTheme().bg,
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            preload: getPreloadPath(),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            backgroundThrottling: false,
            devTools: is.dev
        }
    })
    configureTrustedRendererWindow(window)
    window.setMenu(null)
    window.setMenuBarVisibility(false)
    window.on('ready-to-show', () => {
        if (!window.isDestroyed()) {
            if (state.provisional) window.showInactive()
            else {
                window.show()
                window.focus()
            }
        }
    })
    window.on('focus', () => lockWindowZoom(window))
    window.webContents.on('did-finish-load', () => lockWindowZoom(window))
    window.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedRendererLocation(url)) event.preventDefault()
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) log.error('[AccessoryRenderer] load failed', { code, description, url, kind: state.kind })
    })
    window.webContents.setWindowOpenHandler((details) => nativeOverlayManager.handleWindowOpen(window, details) || { action: 'deny' })
    registerEditableContextMenu(window)
    attachWindowStateEvents(window)
    lockWindowZoom(window)
    loadRendererRoute(window, `/accessories?workspaceId=${encodeURIComponent(state.id)}&kind=${state.kind}&sessionMode=${state.sessionMode}`)
    registerUpdateWindow(window)
    return window
}

function createAssistantUtilityShellWindow(windowId: string, creationOptions: UtilityWindowCreationOptions = {}): BrowserWindow {
    const iconPath = getAppIconPath()
    const window = new BrowserWindow({
        width: 1120,
        height: 760,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title: APP_NAME,
        ...getWindowChromeOptions(),
        backgroundColor: startupTheme().bg,
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            preload: getPreloadPath(),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            backgroundThrottling: false,
            devTools: is.dev
        }
    })
    configureTrustedRendererWindow(window)
    window.setMenu(null)
    window.setMenuBarVisibility(false)
    window.on('focus', () => lockWindowZoom(window))
    window.webContents.on('did-finish-load', () => lockWindowZoom(window))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) log.error('[AssistantUtilityRenderer] load failed', { code, description, url })
    })
    window.webContents.setWindowOpenHandler(details => nativeOverlayManager.handleWindowOpen(window, details) || { action: 'deny' })
    registerEditableContextMenu(window)
    attachWindowStateEvents(window)
    lockWindowZoom(window)
    if (creationOptions.provisional) {
        void window.loadURL(assistantUtilityProvisionalUrl(creationOptions, resolveDefaultAppearance(startupThemeMode, nativeTheme.shouldUseDarkColors)))
    } else {
        loadRendererRoute(window, `/assistant-utility/${encodeURIComponent(windowId)}`)
    }
    return window
}

async function resolveAssistantUtilityChat(canonicalChatId: string): Promise<ResolvedUtilityChat | null> {
    if (!await getAssistantService().ensureCanonicalChatAvailable(canonicalChatId)) return null
    const snapshot = await getAssistantService().getSnapshot()
    for (const session of snapshot.sessions) {
        for (const thread of session.threads) {
            if (thread.providerThreadId !== canonicalChatId && thread.id !== canonicalChatId) continue
            const filesystem = await getAssistantService().getChatFilesystemContext(thread.id)
            if (!filesystem) return null
            return {
                canonicalChatId,
                sessionId: session.id,
                threadId: thread.id,
                chatTitle: session.title || 'Untitled chat',
                projectPath: filesystem.workingRoot,
                projectRoots: filesystem.roots
            }
        }
    }
    return null
}

function createBrowserPopupShellWindow(input: {
    id: string
    width: number
    height: number
}): BrowserWindow {
    const iconPath = getAppIconPath()
    let popupWindow: BrowserWindow | null = null
    try {
        popupWindow = new BrowserWindow({
            modal: false,
            skipTaskbar: false,
            width: input.width,
            height: input.height,
            minWidth: 420,
            minHeight: 520,
            show: false,
            title: `${APP_NAME} Browser`,
            ...getWindowChromeOptions(),
            backgroundColor: startupTheme().bg,
            ...(iconPath ? { icon: iconPath } : {}),
            webPreferences: {
                preload: getPreloadPath(),
                additionalArguments: [BROWSER_POPUP_PRELOAD_ARGUMENT],
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                webviewTag: false,
                backgroundThrottling: false,
                devTools: is.dev
            }
        })
        configureTrustedRendererWindow(popupWindow)
        popupWindow.setMenu(null)
        popupWindow.setMenuBarVisibility(false)
        popupWindow.on('focus', () => popupWindow && lockWindowZoom(popupWindow))
        popupWindow.webContents.on('did-finish-load', () => popupWindow && lockWindowZoom(popupWindow))
        popupWindow.webContents.on('will-navigate', (event) => event.preventDefault())
        popupWindow.webContents.setWindowOpenHandler(details => popupWindow ? nativeOverlayManager.handleWindowOpen(popupWindow, details) || { action: 'deny' } : { action: 'deny' })
        registerEditableContextMenu(popupWindow)
        attachWindowStateEvents(popupWindow)
        lockWindowZoom(popupWindow)
        loadRendererRoute(popupWindow, `/browser-popup/${encodeURIComponent(input.id)}`)
        return popupWindow
    } catch (error) {
        if (popupWindow && !popupWindow.isDestroyed()) popupWindow.destroy()
        throw error
    }
}

function createQuickPreviewWindow(filePath: string): BrowserWindow {
    const iconPath = getAppIconPath()
    const route = buildQuickPreviewRoute(filePath)

    if (quickPreviewWindow && !quickPreviewWindow.isDestroyed()) {
        loadRendererRoute(quickPreviewWindow, route)
        if (quickPreviewWindow.isMinimized()) quickPreviewWindow.restore()
        quickPreviewWindow.maximize()
        quickPreviewWindow.show()
        quickPreviewWindow.focus()
        return quickPreviewWindow
    }

    const window = new BrowserWindow({
        width: 1160,
        height: 860,
        minWidth: 760,
        minHeight: 520,
        show: false,
        ...getWindowChromeOptions(),
        backgroundColor: startupTheme().bg,
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            preload: getPreloadPath(),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            devTools: true
        }
    })
    configureTrustedRendererWindow(window)

    window.on('ready-to-show', () => {
        window.maximize()
        window.show()
    })
    window.on('focus', () => {
        lockWindowZoom(window)
    })
    window.on('closed', () => {
        quickPreviewWindow = null
    })
    window.webContents.on('did-finish-load', () => {
        lockWindowZoom(window)
    })
    window.webContents.setWindowOpenHandler((details) => {
        const overlay = nativeOverlayManager.handleWindowOpen(window, details)
        if (overlay) return overlay
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    registerEditableContextMenu(window)
    attachWindowStateEvents(window)
    lockWindowZoom(window)
    loadRendererRoute(window, route)
    quickPreviewWindow = window
    return window
}

function captureProjectOpenAnalytics(projectPath: string, outcome: 'completed' | 'failed' = 'completed'): void {
    if (outcome === 'failed') {
        setupServices.analytics.capture({ event: 'zyra_v1_project', properties: { action: 'open', outcome: 'failed', error_code: 'unknown' } })
        return
    }
    void inspectProjectAnalyticsCapabilities(projectPath).then((capabilities) => {
        setupServices.analytics.capture({ event: 'zyra_v1_project', properties: { action: 'open', outcome: 'completed', ...capabilities } })
    }).catch(() => {
        setupServices.analytics.capture({ event: 'zyra_v1_project', properties: { action: 'open', outcome: 'failed', error_code: 'unknown' } })
    })
}

function openFolderInMainWindow(folderPath: string): BrowserWindow {
    if (!setupServices.onboarding.isAccessAllowed()) {
        pendingShellLaunchTargets.push({ kind: 'directory', path: folderPath })
        if (!mainWindow || mainWindow.isDestroyed()) {
            mainWindow = createWindow(true)
            ensureIpcHandlersRegistered(mainWindow)
        }
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        return mainWindow
    }
    const route = buildExternalExplorerRoute(folderPath)
    captureProjectOpenAnalytics(folderPath)

    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createWindow(true, route)
        ensureIpcHandlersRegistered(mainWindow)
        return mainWindow
    }

    loadRendererRoute(mainWindow, route)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
}

function handleShellLaunchTarget(shellLaunchTarget: ShellLaunchTarget): void {
    if (!setupServices.onboarding.isAccessAllowed()) {
        pendingShellLaunchTargets.push(shellLaunchTarget)
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.show()
            mainWindow.focus()
        }
        return
    }
    if (shellLaunchTarget.kind === 'directory') {
        openFolderInMainWindow(shellLaunchTarget.path)
        return
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createWindow(false)
        ensureIpcHandlersRegistered(mainWindow)
    }
    createQuickPreviewWindow(shellLaunchTarget.path)
}

function revealPendingShellLaunchTargets(): void {
    if (!setupServices.onboarding.isAccessAllowed()) return
    const pending = pendingShellLaunchTargets.splice(0, pendingShellLaunchTargets.length)
    for (const target of pending) handleShellLaunchTarget(target)
}

function startNormalDesktopRuntime(): void {
    if (normalDesktopRuntimeStarted || !setupServices.onboarding.isAccessAllowed()) return
    normalDesktopRuntimeStarted = true
    void initializeUpdater()
    if (!launchAsBackgroundHost) void assistantUtilityWindowManager.restorePersistedWindows(true)
    revealPendingShellLaunchTargets()
}

function stopNormalDesktopRuntimeForSetup(): void {
    if (!normalDesktopRuntimeStarted) return
    normalDesktopRuntimeStarted = false
    void disposeAssistantService()
    disposeUpdater()
}

function resolveSenderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
    return BrowserWindow.fromWebContents(event.sender)
}

async function runPackagedLaunchSmoke(): Promise<void> {
    const markerPath = String(process.env.ZYRA_PACKAGED_SMOKE_MARKER || '').trim()
    if (!isAbsolute(markerPath) || markerPath.length > 2_048) {
        throw new Error('Packaged launch smoke requires a bounded absolute marker path.')
    }
    const root = resolveZyraRoot()
    await Promise.all([
        import(/* @vite-ignore */ pathToFileURL(join(root, 'src', 'zyra-sdk.mjs')).href),
        import(/* @vite-ignore */ pathToFileURL(join(root, 'src', 'chatgpt-account.mjs')).href)
    ])
    await writeFile(markerPath, `${JSON.stringify({
        version: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        resourcesPath: process.resourcesPath,
        runtimeRoot: root,
        distribution: buildMetadata.distribution,
        sourceSha: buildMetadata.sourceSha,
        appName: app.getName(),
        userDataPath: app.getPath('userData'),
        namespaceId: desktopNamespaceId(app.getPath('userData'))
    })}\n`, { encoding: 'utf8', mode: 0o600 })
}

const tuiDispatchRequested = isDesktopTuiDispatch()
const initialShellLaunchTarget = tuiDispatchRequested ? null : extractShellLaunchTargetFromArgv(process.argv)
const launchAsBackgroundHost = process.argv.includes('--zyra-background-host')
const hasSingleInstanceLock = tuiDispatchRequested || app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
    app.quit()
}

app.on('open-file', (event, filePath) => {
    event.preventDefault()
    const shellLaunchTarget = resolveShellLaunchTarget(filePath)
    if (shellLaunchTarget) handleShellLaunchTarget(shellLaunchTarget)
})

app.on('second-instance', (_event, argv) => {
    if (argv.includes('--zyra-background-host')) return
    setupServices.analytics.capture({
        event: 'zyra_v1_app_lifecycle',
        properties: { action: 'launch_ready', outcome: 'ready', launch_bucket: 'warm' }
    })
    const shellLaunchTarget = extractShellLaunchTargetFromArgv(argv)
    if (shellLaunchTarget) {
        handleShellLaunchTarget(shellLaunchTarget)
        return
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createWindow(true)
        ensureIpcHandlersRegistered(mainWindow)
        return
    }

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
})

app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    rendererHangRecorder.attach(contents)
})

app.whenReady().then(async () => {
    if (tuiDispatchRequested) {
        try {
            app.exit(await dispatchDesktopTui())
        } catch (error) {
            log.error('[DesktopTui] launch failed', error)
            app.exit(1)
        }
        return
    }
    if (process.env.ZYRA_PACKAGED_SMOKE === '1') {
        try {
            await runPackagedLaunchSmoke()
            app.exit(0)
        } catch (error) {
            log.error('[ReleaseSmoke] packaged launch failed', error)
            app.exit(1)
        }
        return
    }
    void initializeProtectedMedia()
    if (!isPreviewDistribution()) {
        void registerInstalledDesktop().catch((error) => log.warn('[DesktopInstall] could not register this installation', error))
    }

    electronApp.setAppUserModelId(runtimeIdentity.appUserModelId)
    const initialOnboardingSnapshot = await initializeDesktopStartup({
        refreshTheme: refreshStartupTheme,
        initializeAnalytics: () => setupServices.analytics.initialize(),
        initializeOnboarding: () => setupServices.onboarding.initialize().catch((error) => {
            log.error('[Onboarding] failed to hydrate mandatory setup state', error)
            return null
        })
    })
    if (initialOnboardingSnapshot?.record?.status === 'in-progress') {
        setupServices.analytics.capture({
            event: 'zyra_v1_onboarding',
            properties: {
                action: 'step_started',
                step: normalizeAnalyticsOnboardingStep(initialOnboardingSnapshot.record.currentStep),
                outcome: 'started'
            }
        })
    }
    void setupServices.auth.prewarm().catch((error) => {
        log.warn('[OpenAI] connection prewarm failed', error)
    })
    configureAssistantService({
        openNotificationChat: async (canonicalChatId) => {
            const chat = await resolveAssistantUtilityChat(canonicalChatId)
            if (!chat) return
            await getAssistantService().selectThread(chat.sessionId, chat.threadId)
            const route = `/assistant/chat/${encodeURIComponent(chat.sessionId)}/thread/${encodeURIComponent(chat.threadId)}`
            if (!mainWindow || mainWindow.isDestroyed()) {
                mainWindow = createWindow(true, route)
                ensureIpcHandlersRegistered(mainWindow)
            } else {
                loadRendererRoute(mainWindow, route)
                if (mainWindow.isMinimized()) mainWindow.restore()
                mainWindow.show()
                mainWindow.focus()
            }
        },
        getDefaultProjectsFolder: () => setupServices.preferences.getConfiguredProjectsFolder(),
        getNewChatExecutionDefaults: () => setupServices.preferences.getNewChatWebDefaults(),
        getNewChatPreparationModel: async () => String(
            (await setupServices.preferences.get({ surface: 'desktop' })).settings.assistantDefaultModel || ''
        ) || null,
        getProjectDiscoveryRoots: () => setupServices.preferences.getProjectDiscoveryRoots(),
        openDesktopWorkspace: (request) => assistantUtilityWindowManager.openFromTui(request),
        cancelDesktopWorkspace: (requestId) => assistantUtilityWindowManager.cancelFromTui(requestId),
        handleDesktopWorkspaceTurn: (canonicalChatId, turnId) => assistantUtilityWindowManager.handleTuiTurn(canonicalChatId, turnId),
        handleDetachedControl: (input) => assistantUtilityWindowManager.handleDetachedControl(input),
        handleDesktopWorkspaceTurnEnded: (canonicalChatId, turnId) => assistantUtilityWindowManager.handleTuiTurnEnded(canonicalChatId, turnId),
        getTitleGenerationModel: () => setupServices.preferences.getAssistantTitleModel(),
        getTitleAutomation: () => setupServices.preferences.getAssistantTitleAutomation(),
        getRuntimePolicy: () => setupServices.preferences.getAssistantRuntimePolicy(),
        getAssistantMemoryEnabled: () => setupServices.preferences.getAssistantMemoryEnabled(),
        captureAnalytics: (input) => setupServices.analytics.capture(input)
    })
    configureApplicationMenu(setupServices.onboarding.isAccessAllowed())
    setupServices.onboarding.subscribe((snapshot) => {
        configureApplicationMenu(snapshot.accessAllowed)
        if (snapshot.accessAllowed) startNormalDesktopRuntime()
        else stopNormalDesktopRuntimeForSetup()
    })

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    try {
        const runtime = new BrowserClientRuntime({
            getAssistantService: () => setupServices.onboarding.isAccessAllowed() ? getAssistantService() : null,
            getDevscopeTarget: () => mainWindow?.webContents || null,
            userDataPath: app.getPath('userData'),
            staticRoot: join(__dirname, '../renderer'),
            ...(is.dev && rendererUrl ? { rendererUrl } : {}),
            persistClipboardImage: persistAssistantClipboardImage,
            resolveClipboardAttachment: resolveAssistantClipboardAttachment,
            getVoiceTranscriptionState: getCodexVoiceTranscriptionState,
            transcribeVoice: transcribeVoiceAndSave,
            saveVoiceHistory: async input => { if (input.engine !== 'browser') throw new Error('Invalid voice history engine.'); await saveVoiceHistory(input) },
            listVoiceHistory,
            getFailedVoiceRecording,
            deleteVoiceHistory,
            isOnboardingComplete: () => setupServices.onboarding.isAccessAllowed(),
            ...(is.dev ? { clientPort: 47_822 } : {})
        })
        browserClientRuntime = runtime
        void runtime.start().then((address) => {
            if (browserClientRuntime === runtime) log.info('[BrowserClientHost] ready', address.origin)
        }).catch((error) => {
            log.warn('[BrowserClientHost] failed to start', error)
            if (browserClientRuntime === runtime) browserClientRuntime = null
        })
    } catch (error) {
        log.warn('[BrowserClientHost] could not initialize', error)
        browserClientRuntime = null
    }
    registerFileProtocol(FILE_PROTOCOL, is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined)
    configureMainRendererMediaPermissions()
    nativeTheme.on('updated', () => {
        syncOpenWindowIcons()
        refreshWindowsControlOverlayAppearance()
    })
    globalShortcut.register('CommandOrControl+Alt+Escape', () => {
        void getAgentControlBroker().emergencyStop('Global emergency-stop shortcut pressed.')
    })

    const setupComplete = setupServices.onboarding.isAccessAllowed()
    if (initialShellLaunchTarget && !setupComplete) pendingShellLaunchTargets.push(initialShellLaunchTarget)
    // Keep the full app alive in background for completed shell file-preview launches.
    const launchHidden = launchAsBackgroundHost || (setupComplete && initialShellLaunchTarget?.kind === 'file')
    const initialRoute = setupComplete && initialShellLaunchTarget?.kind === 'directory'
        ? buildExternalExplorerRoute(initialShellLaunchTarget.path)
        : '/'
    mainWindow = createWindow(!launchHidden, initialRoute)
    ensureIpcHandlersRegistered(mainWindow)
    if (setupComplete && initialShellLaunchTarget?.kind === 'file') {
        createQuickPreviewWindow(initialShellLaunchTarget.path)
    }
    startNormalDesktopRuntime()
    setupServices.analytics.capture({
        event: 'zyra_v1_app_lifecycle',
        properties: {
            action: 'launch_ready',
            outcome: 'ready',
            launch_bucket: 'cold',
            duration_ms: performance.now() - launchStartedAt
        }
    })

    app.on('activate', function () {
        if (!mainWindow || mainWindow.isDestroyed()) {
            mainWindow = createWindow(true)
            ensureIpcHandlersRegistered(mainWindow)
            return
        }
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
    })

    app.on('render-process-gone', (_event, webContents, details) => {
        rendererHangRecorder.captureRendererGone(webContents, {
            reason: details.reason,
            exitCode: details.exitCode
        })
        if (!quitCleanupStarted && details.reason !== 'clean-exit' && !isIncognitoBrowserWebContents(webContents.id) && !hasIncognitoBrowserContents()) {
            setupServices.analytics.capture({
                event: 'zyra_v1_app_lifecycle',
                properties: { action: 'crash', outcome: 'failed', process_kind: 'renderer', error_code: 'renderer_gone' }
            })
        }
        log.error('[Process] Renderer gone', {
            id: webContents.id,
            reason: details.reason,
            exitCode: details.exitCode
        })
    })

    app.on('child-process-gone', (_event, details) => {
        rendererHangRecorder.captureChildProcessGone({ ...details })
        if (!quitCleanupStarted && details.reason !== 'clean-exit' && !hasIncognitoBrowserContents()) {
            setupServices.analytics.capture({
                event: 'zyra_v1_app_lifecycle',
                properties: {
                    action: 'crash',
                    outcome: 'failed',
                    process_kind: details.type === 'GPU' ? 'gpu' : details.type === 'Utility' ? 'utility' : 'other',
                    error_code: 'unknown'
                }
            })
        }
        log.error('[Process] Child process gone', details)
    })
})

app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    app.quit()
})

app.on('before-quit', (event) => {
    if (quitCleanupComplete) return
    event.preventDefault()
    if (quitCleanupStarted) return
    quitCleanupStarted = true
    if (!setupServices.onboarding.isAccessAllowed()) {
        setupServices.analytics.capture({ event: 'zyra_v1_onboarding', properties: { action: 'abandoned', outcome: 'cancelled' } })
    }
    setupServices.analytics.capture({
        event: 'zyra_v1_app_lifecycle',
        properties: { action: 'shutdown', outcome: 'started' }
    })
    void flushGlobalBrowserProfileStorage().then(async () => {
        globalShortcut.unregisterAll()
        browserRecordingOverlayManager.dispose()
        nativeOverlayManager.dispose()
        browserViewManager.dispose()
        const browserRuntime = browserClientRuntime
        browserClientRuntime = null
        disposeUpdater()
        // Disconnect external callers before closing the assistant database.
        await Promise.all([
            browserRuntime?.stop().catch((error) => log.warn('[Shutdown] Browser runtime cleanup failed', error)),
            assistantUtilityWindowManager.dispose(),
            setupServices.auth.dispose().catch((error) => log.warn('[Shutdown] OpenAI auth worker cleanup failed', error)),
            disposeAgentControlBroker().catch((error) => log.warn('[Shutdown] Agent Control cleanup failed', error)),
            disposeBrowserThreatProtectionService().catch((error) => log.warn('[Shutdown] Browser phishing protection cleanup failed', error)),
            setupServices.analytics.flush(1_500)
        ])
        await disposeAssistantService()
    }).then(async () => {
        await setupServices.analytics.shutdown(250)
        rendererHangRecorder.dispose()
        quitCleanupComplete = true
        app.quit()
    }).catch((error) => {
        quitCleanupStarted = false
        log.error('[Shutdown] Zyra kept running because local state could not be committed.', error)
        if (!mainWindow || mainWindow.isDestroyed()) {
            mainWindow = createWindow(true)
            ensureIpcHandlersRegistered(mainWindow)
        } else if (!mainWindow.isVisible()) {
            mainWindow.show()
        }
        dialog.showErrorBox(
            'Zyra could not finish saving',
            'Zyra is still running so pending chat and Browser state are not discarded. Free some disk space or fix the storage error, then quit again.'
        )
    })
})

// Handle window control IPC
ipcMain.on('window:minimize', (event) => {
    log.info('Window minimize requested')
    resolveSenderWindow(event)?.minimize()
})

ipcMain.on('window:maximize', (event) => {
    log.info('Window maximize requested')
    const targetWindow = resolveSenderWindow(event)
    if (!targetWindow) return

    if (targetWindow.isMaximized()) {
        targetWindow.unmaximize()
    } else {
        targetWindow.maximize()
    }
})

ipcMain.on('window:close', (event) => {
    log.info('Window close requested')
    resolveSenderWindow(event)?.close()
})

ipcMain.on('window:setFullScreen', (event, enabled: unknown) => {
    resolveSenderWindow(event)?.setFullScreen(enabled === true)
})

ipcMain.handle('window:isFullScreen', (event) => resolveSenderWindow(event)?.isFullScreen() === true)

ipcMain.handle('window:isMaximized', (event) => {
    const targetWindow = resolveSenderWindow(event)
    return targetWindow ? targetWindow.isMaximized() || targetWindow.isFullScreen() : false
})
