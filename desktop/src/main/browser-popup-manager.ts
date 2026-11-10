import { handleGuestAppShortcut, isRecordingShortcut } from './keybindings'
import { randomUUID } from 'node:crypto'
import { addNativeWindowView } from './native-view-layers'
import {
    BrowserWindow,
    Menu,
    WebContentsView,
    clipboard,
    type BrowserWindowConstructorOptions,
    type Input,
    type WebContents,
    type WebContentsViewConstructorOptions,
    type WindowOpenHandlerResponse
} from 'electron'
import { ipcMain } from './ipc/trusted-ipc'
import log from 'electron-log'
import { resolveBrowserWindowOpenIntent } from './browser-window-open-policy'
import {
    getGlobalBrowserSession,
    isSafeBrowserNavigationUrl,
    recordGlobalBrowserHistory,
    registerBrowserPermissionTarget,
    scheduleGlobalBrowserProfileFlush
} from './ipc/handlers/browser-preview-handlers'
import { inheritBrowserPreviewPresentation, openBrowserPreviewDevTools } from './ipc/handlers/browser-preview-developer-handlers'
import { trustedBrowserGuests } from './agent-control/trusted-guest-registry'
import { getBrowserThreatProtectionService } from './browser-threat-protection-service'
import { isAuthenticationBrowserUrl } from '../shared/browser-url-sanitization'
import { isBrowserShortcutAction, resolveBrowserShortcut, type BrowserShortcutAction, type BrowserShortcutPlatform } from '../shared/browser-shortcuts'
import {
    BROWSER_PREVIEW_SHORTCUT_CHANNEL,
    type DevScopeBrowserShortcutEvent
} from '../shared/contracts/devscope-api'
import {
    BROWSER_POPUP_COMMAND_CHANNEL,
    BROWSER_POPUP_FOCUS_ADDRESS_CHANNEL,
    BROWSER_POPUP_FOCUS_WINDOW_CHANNEL,
    BROWSER_POPUP_GET_STATE_CHANNEL,
    BROWSER_POPUP_LIST_CHANGED_CHANNEL,
    BROWSER_POPUP_LIST_CHANNEL,
    BROWSER_POPUP_STATE_CHANGED_CHANNEL,
    type BrowserPopupCommand,
    type BrowserPopupState,
    type BrowserPopupSummary
} from '../shared/browser-popup'

export const BROWSER_POPUP_CHROME_HEIGHT = 74
const MAX_MANAGED_BROWSER_POPUPS = 4
const POPUP_RESERVATION_TTL_MS = 5_000

type PopupWindowOptionsWithContents = BrowserWindowConstructorOptions & {
    webContents?: WebContents
}

type ManagedBrowserPopup = {
    id: string
    ownerWindow: BrowserWindow
    sourceContents: WebContents
    sourceGuestWebContentsId: number
    onSourceDestroyed: (() => void) | null
    shellWindow: BrowserWindow
    shellWebContentsId: number
    pageView: WebContentsView
    pageContents: WebContents
    lastRecordedUrl: string
    activateOnReady: boolean
    disposed: boolean
}

type BrowserPopupManagerOptions = {
    createShellWindow: (input: {
        id: string
        width: number
        height: number
    }) => BrowserWindow
    requestTab: (ownerWindow: BrowserWindow, sourceGuestWebContentsId: number, url: string, activate: boolean) => void
    captureAnalytics?: (properties: { action: 'popup'; outcome: 'completed' | 'failed' | 'blocked' | 'allowed'; error_code?: string }) => void
}

function popupPlatform(): BrowserShortcutPlatform {
    return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}

function safePopupDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
    const numeric = Math.round(Number(value))
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback
}

function isSafePopupUrl(value: string): boolean {
    return value === 'about:blank' || isSafeBrowserNavigationUrl(value)
}

function popupFallbackTitle(url: string): string {
    if (!url || url === 'about:blank') return 'New window'
    try {
        return new URL(url).hostname || 'Browser window'
    } catch {
        return 'Browser window'
    }
}

function hardenPopupWebPreferences(sourceContents: WebContents): Electron.WebPreferences {
    return {
        session: sourceContents.session,
        preload: undefined,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        backgroundThrottling: false,
        devTools: false
    }
}

export class BrowserPopupManager {
    private readonly activeByOwner = new WeakMap<BrowserWindow, Set<ManagedBrowserPopup>>()
    private readonly pendingByOwner = new WeakMap<BrowserWindow, Set<symbol>>()
    private readonly popupByShellContentsId = new Map<number, ManagedBrowserPopup>()
    private ipcRegistered = false

    constructor(private readonly options: BrowserPopupManagerOptions) {}

    isIncognitoWebContents(webContentsId: number): boolean {
        return [...this.popupByShellContentsId.values()].some((popup) => (
            !popup.disposed
            && popup.sourceContents.session !== getGlobalBrowserSession()
            && (popup.shellWebContentsId === webContentsId || popup.pageContents.id === webContentsId)
        ))
    }

    hasIncognitoContents(): boolean {
        return [...this.popupByShellContentsId.values()].some((popup) => !popup.disposed && popup.sourceContents.session !== getGlobalBrowserSession())
    }

    registerIpc(): void {
        if (this.ipcRegistered) return
        this.ipcRegistered = true
        ipcMain.handle(BROWSER_POPUP_GET_STATE_CHANNEL, (event) => {
            const popup = this.popupByShellContentsId.get(event.sender.id)
            if (!popup || popup.disposed) return { success: false as const, error: 'This Browser window is no longer available.' }
            return { success: true as const, state: this.readState(popup) }
        })
        ipcMain.handle(BROWSER_POPUP_COMMAND_CHANNEL, (event, input: unknown) => {
            const popup = this.popupByShellContentsId.get(event.sender.id)
            if (!popup || popup.disposed) return { success: false as const, error: 'This Browser window is no longer available.' }
            const command = this.parseCommand(input)
            if (!command) return { success: false as const, error: 'The Browser window command is invalid.' }
            try {
                this.runCommand(popup, command)
                return { success: true as const, state: this.readState(popup) }
            } catch (error: unknown) {
                return { success: false as const, error: error instanceof Error ? error.message : 'The Browser window command failed.' }
            }
        })
        ipcMain.handle(BROWSER_POPUP_LIST_CHANNEL, (event) => {
            const ownerWindow = BrowserWindow.fromWebContents(event.sender)
            if (!ownerWindow) return { success: false as const, error: 'The Browser window owner is unavailable.' }
            return { success: true as const, windows: this.listWindows(ownerWindow) }
        })
        ipcMain.handle(BROWSER_POPUP_FOCUS_WINDOW_CHANNEL, (event, input: unknown) => {
            const ownerWindow = BrowserWindow.fromWebContents(event.sender)
            const id = String(input || '').trim()
            if (!ownerWindow || !id || id.length > 100) return { success: false as const, error: 'The Browser window identity is invalid.' }
            const popup = [...(this.activeByOwner.get(ownerWindow) || [])].find((candidate) => candidate.id === id && !candidate.disposed)
            if (!popup || popup.shellWindow.isDestroyed()) return { success: false as const, error: 'That Browser window has closed.' }
            if (popup.shellWindow.isMinimized()) popup.shellWindow.restore()
            popup.shellWindow.show()
            popup.shellWindow.focus()
            popup.pageContents.focus()
            return { success: true as const }
        })
    }

    registerGuest(ownerWindow: BrowserWindow, sourceContents: WebContents, sourceGuestWebContentsId: number): void {
        this.registerWindowOpenHandler(ownerWindow, sourceContents, sourceGuestWebContentsId)
        this.registerContextMenu(ownerWindow, sourceContents, sourceGuestWebContentsId, ownerWindow)
    }

    transferGuestOwner(sourceGuestWebContentsId: number, previousOwner: BrowserWindow, owner: BrowserWindow): void {
        if (previousOwner === owner) return
        const previousSet = this.activeByOwner.get(previousOwner)
        const ownerSet = this.activeByOwner.get(owner) || new Set<ManagedBrowserPopup>()
        this.activeByOwner.set(owner, ownerSet)
        for (const popup of [...(previousSet || [])]) {
            if (popup.sourceGuestWebContentsId !== sourceGuestWebContentsId || popup.disposed) continue
            previousSet?.delete(popup)
            popup.ownerWindow = owner
            ownerSet.add(popup)
        }
        this.publishWindowList(previousOwner)
        this.publishWindowList(owner)
    }

    private resolveGuestOwner(sourceGuestWebContentsId: number, fallback: BrowserWindow): BrowserWindow {
        const ownerWebContentsId = trustedBrowserGuests.findByGuestId(sourceGuestWebContentsId)?.ownerWebContentsId
        return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.webContents.id === ownerWebContentsId) || fallback
    }

    private parseCommand(value: unknown): BrowserPopupCommand | null {
        if (!value || typeof value !== 'object') return null
        const input = value as Partial<BrowserPopupCommand> & { action?: unknown }
        if (input.type === 'shortcut') {
            return isBrowserShortcutAction(input.action) ? { type: 'shortcut', action: input.action } : null
        }
        if (input.type === 'navigate') {
            const url = String(input.url || '').trim()
            return isSafeBrowserNavigationUrl(url) ? { type: 'navigate', url } : null
        }
        if (
            input.type === 'back'
            || input.type === 'forward'
            || input.type === 'reload'
            || input.type === 'stop'
            || input.type === 'copy-address'
            || input.type === 'open-in-tab'
            || input.type === 'toggle-fullscreen'
            || input.type === 'show-menu'
        ) return { type: input.type }
        return null
    }

    private runCommand(popup: ManagedBrowserPopup, command: BrowserPopupCommand): void {
        const page = popup.pageContents
        if (page.isDestroyed()) throw new Error('The Browser page has closed.')
        if (command.type === 'back') {
            if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack()
        } else if (command.type === 'forward') {
            if (page.navigationHistory.canGoForward()) page.navigationHistory.goForward()
        } else if (command.type === 'reload') {
            page.reload()
        } else if (command.type === 'stop') {
            page.stop()
        } else if (command.type === 'navigate') {
            this.navigatePopup(popup, command.url)
        } else if (command.type === 'copy-address') {
            const url = page.getURL()
            if (isSafePopupUrl(url)) clipboard.writeText(url === 'about:blank' ? '' : url)
        } else if (command.type === 'open-in-tab') {
            const url = page.getURL()
            if (!isSafePopupUrl(url)) return
            this.options.requestTab(popup.ownerWindow, popup.sourceGuestWebContentsId, url === 'about:blank' ? '' : url, true)
            this.revealOwnerWindow(popup.ownerWindow)
        } else if (command.type === 'toggle-fullscreen') {
            popup.shellWindow.setFullScreen(!popup.shellWindow.isFullScreen())
        } else if (command.type === 'show-menu') {
            this.showPopupMenu(popup)
        } else if (command.type === 'shortcut') {
            this.runPopupShortcut(popup, command.action)
        }
        this.publishState(popup)
    }

    private navigatePopup(popup: ManagedBrowserPopup, url: string): boolean {
        const page = popup.pageContents
        const threatProtection = getBrowserThreatProtectionService()
        if (threatProtection?.checkUrl(url) && !threatProtection.consumeOneTimeAllowance(page.id, url)) {
            const warning = threatProtection.blockNavigation({
                ownerWebContentsId: popup.ownerWindow.webContents.id,
                sourceGuestWebContentsId: popup.sourceGuestWebContentsId,
                blockedGuestWebContentsId: page.id,
                navigationKind: 'popup',
                previousUrl: page.getURL(),
                url,
                proceed: () => {
                    if (!popup.disposed && !page.isDestroyed()) {
                        void page.loadURL(url).catch((error) => log.debug('[BrowserThreatProtection] Allowed popup navigation failed.', error))
                    }
                }
            })
            if (warning) return false
        }
        void page.loadURL(url).catch((error) => log.debug('[BrowserPopup] Navigation failed', error))
        return true
    }

    private readState(popup: ManagedBrowserPopup): BrowserPopupState {
        const page = popup.pageContents
        const url = page.isDestroyed() ? '' : page.getURL()
        let title = page.isDestroyed() ? 'Browser window' : page.getTitle() || popupFallbackTitle(url)
        if (!page.isDestroyed() && isAuthenticationBrowserUrl(url)) title = popupFallbackTitle(url)
        return {
            title,
            url: url === 'about:blank' ? '' : url,
            loading: !page.isDestroyed() && page.isLoading(),
            canGoBack: !page.isDestroyed() && page.navigationHistory.canGoBack(),
            canGoForward: !page.isDestroyed() && page.navigationHistory.canGoForward(),
            audible: !page.isDestroyed() && page.isCurrentlyAudible(),
            fullscreen: !popup.shellWindow.isDestroyed() && popup.shellWindow.isFullScreen(),
            profileShared: true
        }
    }

    private publishState(popup: ManagedBrowserPopup): void {
        if (popup.disposed || popup.shellWindow.isDestroyed() || popup.shellWindow.webContents.isDestroyed()) return
        const state = this.readState(popup)
        popup.shellWindow.setTitle(`${state.title} — Zyra`)
        popup.shellWindow.webContents.send(BROWSER_POPUP_STATE_CHANGED_CHANNEL, state)
        this.publishWindowList(popup.ownerWindow)
    }

    private listWindows(ownerWindow: BrowserWindow): BrowserPopupSummary[] {
        return [...(this.activeByOwner.get(ownerWindow) || [])].flatMap((popup): BrowserPopupSummary[] => {
            if (popup.disposed || popup.shellWindow.isDestroyed() || popup.pageContents.isDestroyed()) return []
            const state = this.readState(popup)
            let origin = 'Browser window'
            try {
                const url = new URL(state.url)
                origin = url.origin
            } catch {
                // Keep a neutral label for about:blank and provisional navigations.
            }
            const sourceBinding = trustedBrowserGuests.findByGuestId(popup.sourceGuestWebContentsId)
            return [{
                id: popup.id,
                ownerThreadId: sourceBinding?.ownerThreadId || null,
                sourceTabId: sourceBinding?.tabId || null,
                title: state.title,
                origin,
                minimized: popup.shellWindow.isMinimized(),
                audible: state.audible
            }]
        })
    }

    private publishWindowList(ownerWindow: BrowserWindow): void {
        if (ownerWindow.isDestroyed() || ownerWindow.webContents.isDestroyed()) return
        try { ownerWindow.webContents.send(BROWSER_POPUP_LIST_CHANGED_CHANNEL, this.listWindows(ownerWindow)) } catch {
            // The shell can close between the ownership check and publication.
        }
    }

    private managedCount(ownerWindow: BrowserWindow): number {
        return (this.activeByOwner.get(ownerWindow)?.size || 0) + (this.pendingByOwner.get(ownerWindow)?.size || 0)
    }

    private reserve(ownerWindow: BrowserWindow): symbol {
        const reservations = this.pendingByOwner.get(ownerWindow) || new Set<symbol>()
        this.pendingByOwner.set(ownerWindow, reservations)
        const reservation = Symbol('browser-popup')
        reservations.add(reservation)
        const timer = setTimeout(() => reservations.delete(reservation), POPUP_RESERVATION_TTL_MS)
        timer.unref?.()
        return reservation
    }

    private releaseReservation(ownerWindow: BrowserWindow, reservation: symbol): void {
        this.pendingByOwner.get(ownerWindow)?.delete(reservation)
    }

    private registerWindowOpenHandler(ownerWindow: BrowserWindow, sourceContents: WebContents, sourceGuestWebContentsId: number): void {
        sourceContents.setWindowOpenHandler((details): WindowOpenHandlerResponse => {
            ownerWindow = this.resolveGuestOwner(sourceGuestWebContentsId, ownerWindow)
            if (!isSafePopupUrl(details.url)) return { action: 'deny' }
            const intent = resolveBrowserWindowOpenIntent(details)
            const threatProtection = getBrowserThreatProtectionService()
            if (details.url !== 'about:blank' && threatProtection && !threatProtection.consumeOneTimeAllowance(sourceGuestWebContentsId, details.url)) {
                const warning = threatProtection.blockNavigation({
                    ownerWebContentsId: ownerWindow.webContents.id,
                    sourceGuestWebContentsId,
                    blockedGuestWebContentsId: sourceGuestWebContentsId,
                    navigationKind: intent.kind === 'tab' ? 'new-tab' : 'popup',
                    previousUrl: sourceContents.getURL(),
                    url: details.url,
                    proceed: () => this.options.requestTab(ownerWindow, sourceGuestWebContentsId, details.url, true)
                })
                if (warning) {
                    if (sourceContents.session === getGlobalBrowserSession()) this.options.captureAnalytics?.({ action: 'popup', outcome: 'blocked' })
                    return { action: 'deny' }
                }
            }
            if (intent.kind === 'tab') {
                this.options.requestTab(ownerWindow, sourceGuestWebContentsId, details.url === 'about:blank' ? '' : details.url, intent.activate)
                return { action: 'deny' }
            }
            if (this.managedCount(ownerWindow) >= MAX_MANAGED_BROWSER_POPUPS) {
                if (sourceContents.session === getGlobalBrowserSession()) this.options.captureAnalytics?.({ action: 'popup', outcome: 'blocked', error_code: 'unavailable' })
                return { action: 'deny' }
            }
            const reservation = this.reserve(ownerWindow)
            return {
                action: 'allow',
                outlivesOpener: false,
                overrideBrowserWindowOptions: {
                    show: false,
                    frame: false,
                    fullscreen: false,
                    kiosk: false,
                    autoHideMenuBar: true,
                    backgroundColor: '#111318',
                    webPreferences: hardenPopupWebPreferences(sourceContents)
                },
                createWindow: (windowOptions) => {
                    try {
                        return this.createPopup(
                            ownerWindow,
                            sourceContents,
                            sourceGuestWebContentsId,
                            details,
                            windowOptions as PopupWindowOptionsWithContents,
                            reservation
                        ).pageContents
                    } catch (error) {
                        this.releaseReservation(ownerWindow, reservation)
                        if (sourceContents.session === getGlobalBrowserSession()) this.options.captureAnalytics?.({ action: 'popup', outcome: 'failed', error_code: 'unknown' })
                        throw error
                    }
                }
            }
        })
    }

    private createPopup(
        ownerWindow: BrowserWindow,
        sourceContents: WebContents,
        sourceGuestWebContentsId: number,
        details: Electron.HandlerDetails,
        windowOptions: PopupWindowOptionsWithContents,
        reservation: symbol
    ): ManagedBrowserPopup {
        this.releaseReservation(ownerWindow, reservation)
        const id = randomUUID()
        const width = safePopupDimension(windowOptions.width, 720, 420, 1_280)
        const height = safePopupDimension(windowOptions.height, 760, 520, 1_080)
        const suppliedContents = windowOptions.webContents
        let shellWindow: BrowserWindow | null = null
        let pageContents: WebContents | null = null
        let popup: ManagedBrowserPopup | null = null
        try {
            shellWindow = this.options.createShellWindow({ id, width, height })
            if (suppliedContents && suppliedContents.session !== sourceContents.session) {
                throw new Error('Browser popup session isolation could not be preserved.')
            }

            let pageView: WebContentsView
            let manuallyLoad = false
            if (suppliedContents) {
                pageView = new WebContentsView({ webContents: suppliedContents })
            } else {
                const webPreferences = hardenPopupWebPreferences(sourceContents)
                pageView = new WebContentsView({ webPreferences })
                manuallyLoad = true
            }
            pageContents = pageView.webContents
            popup = {
                id,
                ownerWindow,
                sourceContents,
                sourceGuestWebContentsId,
                onSourceDestroyed: null,
                shellWindow,
                shellWebContentsId: shellWindow.webContents.id,
                pageView,
                pageContents,
                lastRecordedUrl: '',
                activateOnReady: details.disposition !== 'background-tab' && this.isForegroundSource(sourceContents, ownerWindow),
                disposed: false
            }
            const active = this.activeByOwner.get(ownerWindow) || new Set<ManagedBrowserPopup>()
            this.activeByOwner.set(ownerWindow, active)
            active.add(popup)
            this.popupByShellContentsId.set(shellWindow.webContents.id, popup)
            this.publishWindowList(ownerWindow)
            if (sourceContents.session === getGlobalBrowserSession()) this.options.captureAnalytics?.({ action: 'popup', outcome: 'allowed' })

            addNativeWindowView(shellWindow, pageView, 'browser')
            pageView.setBackgroundColor('#111318')
            this.layoutPopup(popup)
            this.configurePopupLifecycle(popup, sourceContents)
            this.registerWindowOpenHandler(ownerWindow, pageContents, sourceGuestWebContentsId)
            this.registerContextMenu(ownerWindow, pageContents, sourceGuestWebContentsId, shellWindow)
            registerBrowserPermissionTarget(pageContents, shellWindow.webContents)
            void inheritBrowserPreviewPresentation(sourceContents, pageContents).catch((error) => {
                log.debug('[BrowserPopup] Could not inherit page presentation', error)
            })

            if (manuallyLoad) {
                // Chromium intentionally withholds the provisional WebContents for a
                // background-tab disposition. Browsers also omit window.opener there.
                const postBody = details.postBody
                const rawContentType = String(postBody?.contentType || '').trim()
                const safeContentType = postBody && /^[A-Za-z0-9!#$&^_.+-]{1,64}\/[A-Za-z0-9!#$&^_.+-]{1,64}$/.test(rawContentType)
                    ? rawContentType
                    : null
                const safeBoundary = postBody?.boundary && /^[A-Za-z0-9'()+_,./:=?-]{1,70}$/.test(postBody.boundary)
                    ? postBody.boundary
                    : null
                if (postBody && !safeContentType) throw new Error('Browser popup POST content type is invalid.')
                if (safeContentType?.toLowerCase() === 'multipart/form-data' && !safeBoundary) {
                    throw new Error('Browser popup multipart boundary is invalid.')
                }
                const contentType = safeContentType
                    ? `${safeContentType}${safeContentType.toLowerCase() === 'multipart/form-data' ? `; boundary="${safeBoundary}"` : ''}`
                    : null
                void pageContents.loadURL(details.url, {
                    httpReferrer: details.referrer,
                    ...(postBody ? { postData: postBody.data } : {}),
                    ...(contentType ? { extraHeaders: `Content-Type: ${contentType}` } : {})
                }).catch((error) => {
                    log.debug('[BrowserPopup] Deferred page navigation failed', error)
                })
            }
            return popup
        } catch (error) {
            if (popup) this.disposePopup(popup, true)
            else if (pageContents && !pageContents.isDestroyed()) pageContents.close({ waitForBeforeUnload: false })
            else if (suppliedContents && !suppliedContents.isDestroyed()) suppliedContents.close({ waitForBeforeUnload: false })
            if (shellWindow && !shellWindow.isDestroyed()) shellWindow.destroy()
            throw error
        }
    }

    private isForegroundSource(sourceContents: WebContents, fallback: BrowserWindow): boolean {
        if (sourceContents.isDestroyed()) return false
        // Nested popups have their own physical window; ownership of the chat
        // alone does not grant permission to activate a new native window.
        const sourceWindow = BrowserWindow.fromWebContents(sourceContents) || fallback
        return !sourceWindow.isDestroyed() && sourceWindow.isFocused() && sourceWindow.isVisible()
            && !sourceWindow.isMinimized() && sourceContents.isFocused()
    }

    private configurePopupLifecycle(popup: ManagedBrowserPopup, sourceContents: WebContents): void {
        const { shellWindow, pageContents } = popup
        const publish = () => this.publishState(popup)
        const recordNavigation = (url: string, incrementVisit: boolean) => {
            if (!pageContents.session.isPersistent()) return
            if (!isSafeBrowserNavigationUrl(url)) return
            if (incrementVisit && popup.lastRecordedUrl === url) return
            if (incrementVisit) popup.lastRecordedUrl = url
            void recordGlobalBrowserHistory({
                url,
                title: pageContents.getTitle(),
                incrementVisit
            }).catch((error) => log.debug('[BrowserPopup] Could not record local history', error))
        }
        shellWindow.on('resize', () => this.layoutPopup(popup))
        shellWindow.on('maximize', () => this.layoutPopup(popup))
        shellWindow.on('unmaximize', () => this.layoutPopup(popup))
        shellWindow.on('minimize', () => this.publishWindowList(popup.ownerWindow))
        shellWindow.on('restore', () => this.publishWindowList(popup.ownerWindow))
        shellWindow.on('enter-full-screen', () => {
            this.layoutPopup(popup)
            publish()
        })
        shellWindow.on('leave-full-screen', () => {
            this.layoutPopup(popup)
            if (!pageContents.isDestroyed()) {
                void pageContents.executeJavaScript('if (document.fullscreenElement) void document.exitFullscreen()').catch(() => undefined)
            }
            publish()
        })
        shellWindow.webContents.on('did-finish-load', () => {
            publish()
            if (!shellWindow.isDestroyed()) {
                // The user may have switched apps while the popup shell loaded.
                if (popup.activateOnReady && this.isForegroundSource(sourceContents, popup.ownerWindow)) {
                    shellWindow.show()
                    pageContents.focus()
                } else {
                    shellWindow.showInactive()
                }
            }
        })
        shellWindow.on('closed', () => this.disposePopup(popup, true))

        pageContents.on('did-start-loading', publish)
        pageContents.on('did-stop-loading', () => {
            if (pageContents.session.isPersistent()) scheduleGlobalBrowserProfileFlush()
            publish()
        })
        pageContents.on('did-navigate', (_event, url) => {
            recordNavigation(url, true)
            publish()
        })
        pageContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
            if (!isMainFrame) return
            recordNavigation(url, true)
            publish()
        })
        pageContents.on('page-title-updated', () => {
            recordNavigation(pageContents.getURL(), false)
            publish()
        })
        pageContents.on('audio-state-changed', publish)
        pageContents.on('enter-html-full-screen', () => {
            if (!shellWindow.isDestroyed()) shellWindow.setFullScreen(true)
        })
        pageContents.on('leave-html-full-screen', () => {
            if (!shellWindow.isDestroyed() && shellWindow.isFullScreen()) shellWindow.setFullScreen(false)
        })
        pageContents.on('will-navigate', (event, url) => {
            if (!isSafePopupUrl(url)) {
                event.preventDefault()
                return
            }
            if (url === 'about:blank') return
            const threatProtection = getBrowserThreatProtectionService()
            if (!threatProtection || threatProtection.consumeOneTimeAllowance(pageContents.id, url)) return
            const warning = threatProtection.blockNavigation({
                ownerWebContentsId: popup.ownerWindow.webContents.id,
                sourceGuestWebContentsId: popup.sourceGuestWebContentsId,
                blockedGuestWebContentsId: pageContents.id,
                navigationKind: 'popup',
                previousUrl: pageContents.getURL(),
                url,
                proceed: () => { void pageContents.loadURL(url).catch((error) => log.debug('[BrowserThreatProtection] Allowed popup navigation failed.', error)) }
            })
            if (warning) event.preventDefault()
        })
        pageContents.on('will-redirect', (event, url) => {
            if (!isSafePopupUrl(url)) {
                event.preventDefault()
                return
            }
            if (url === 'about:blank') return
            const threatProtection = getBrowserThreatProtectionService()
            if (!threatProtection || threatProtection.consumeOneTimeAllowance(pageContents.id, url)) return
            const warning = threatProtection.blockNavigation({
                ownerWebContentsId: popup.ownerWindow.webContents.id,
                sourceGuestWebContentsId: popup.sourceGuestWebContentsId,
                blockedGuestWebContentsId: pageContents.id,
                navigationKind: 'popup',
                previousUrl: pageContents.getURL(),
                url,
                proceed: () => { void pageContents.loadURL(url).catch((error) => log.debug('[BrowserThreatProtection] Allowed popup redirect failed.', error)) }
            })
            if (warning) event.preventDefault()
        })
        pageContents.on('before-input-event', (event, input) => this.handlePageShortcut(event, input, popup))
        pageContents.once('destroyed', () => {
            if (!shellWindow.isDestroyed()) shellWindow.close()
            this.disposePopup(popup, false)
        })
        const closeWithSource = () => {
            if (!shellWindow.isDestroyed()) shellWindow.close()
        }
        popup.onSourceDestroyed = closeWithSource
        sourceContents.once('destroyed', closeWithSource)
    }

    private layoutPopup(popup: ManagedBrowserPopup): void {
        if (popup.disposed || popup.shellWindow.isDestroyed()) return
        const bounds = popup.shellWindow.getContentBounds()
        const chromeHeight = popup.shellWindow.isFullScreen() ? 0 : BROWSER_POPUP_CHROME_HEIGHT
        popup.pageView.setBounds({
            x: 0,
            y: chromeHeight,
            width: Math.max(1, bounds.width),
            height: Math.max(1, bounds.height - chromeHeight)
        })
    }

    private handlePageShortcut(event: Electron.Event, input: Input, popup: ManagedBrowserPopup): void {
        if (isRecordingShortcut(popup.ownerWindow.webContents)) return
        if (handleGuestAppShortcut(input, popup.ownerWindow.webContents)) { event.preventDefault(); return }
        if (input.type === 'keyDown' && input.key === 'Escape' && popup.shellWindow.isFullScreen()) {
            event.preventDefault()
            popup.shellWindow.setFullScreen(false)
            return
        }
        const action = resolveBrowserShortcut(input, popupPlatform())
        if (!action) {
            if (resolveBrowserShortcut(input, popupPlatform(), {})) event.preventDefault()
            return
        }
        event.preventDefault()
        try { this.runPopupShortcut(popup, action) }
        catch (error) { log.warn('[BrowserPopup] Shortcut unavailable:', error) }
    }

    private runPopupShortcut(popup: ManagedBrowserPopup, action: BrowserShortcutAction): void {
        if (action.type === 'close-tab') {
            popup.shellWindow.close()
        } else if (action.type === 'focus-address') {
            const focusAddress = () => {
                if (popup.shellWindow.isDestroyed() || popup.shellWindow.webContents.isDestroyed()) return
                popup.shellWindow.webContents.focus()
                popup.shellWindow.webContents.send(BROWSER_POPUP_FOCUS_ADDRESS_CHANNEL)
            }
            if (popup.shellWindow.isFullScreen()) {
                popup.shellWindow.once('leave-full-screen', focusAddress)
                popup.shellWindow.setFullScreen(false)
            } else {
                focusAddress()
            }
        } else if (action.type === 'devtools') {
            openBrowserPreviewDevTools(popup.pageContents, 'popout')
        } else if (action.type === 'reload') {
            if (action.bypassCache) popup.pageContents.reloadIgnoringCache()
            else popup.pageContents.reload()
        } else if (action.type === 'back') {
            if (popup.pageContents.navigationHistory.canGoBack()) popup.pageContents.navigationHistory.goBack()
        } else if (action.type === 'forward') {
            if (popup.pageContents.navigationHistory.canGoForward()) popup.pageContents.navigationHistory.goForward()
        } else if (action.type === 'toggle-fullscreen') {
            popup.shellWindow.setFullScreen(!popup.shellWindow.isFullScreen())
        } else if (action.type === 'new-tab') {
            this.options.requestTab(popup.ownerWindow, popup.sourceGuestWebContentsId, '', true)
            this.revealOwnerWindow(popup.ownerWindow)
        } else {
            const payload: DevScopeBrowserShortcutEvent = {
                sourceGuestWebContentsId: popup.sourceGuestWebContentsId,
                action
            }
            popup.ownerWindow.webContents.send(BROWSER_PREVIEW_SHORTCUT_CHANNEL, payload)
            this.revealOwnerWindow(popup.ownerWindow)
        }
        this.publishState(popup)
    }

    private showPopupMenu(popup: ManagedBrowserPopup): void {
        const page = popup.pageContents
        const url = page.isDestroyed() ? '' : page.getURL()
        Menu.buildFromTemplate([
            { label: 'Zyra Browser profile', enabled: false },
            { type: 'separator' },
            { label: 'Copy address', enabled: isSafePopupUrl(url), click: () => isSafePopupUrl(url) && clipboard.writeText(url === 'about:blank' ? '' : url) },
            { label: 'Open in Browser tab', enabled: isSafePopupUrl(url), click: () => {
                if (!isSafePopupUrl(url)) return
                this.options.requestTab(popup.ownerWindow, popup.sourceGuestWebContentsId, url === 'about:blank' ? '' : url, true)
                this.revealOwnerWindow(popup.ownerWindow)
            } },
            { type: 'separator' },
            { label: popup.shellWindow.isFullScreen() ? 'Exit full screen' : 'Enter full screen', click: () => popup.shellWindow.setFullScreen(!popup.shellWindow.isFullScreen()) },
            { label: 'Close window', click: () => popup.shellWindow.close() }
        ]).popup({ window: popup.shellWindow })
    }

    private registerContextMenu(ownerWindow: BrowserWindow, pageContents: WebContents, sourceGuestWebContentsId: number, menuWindow: BrowserWindow): void {
        pageContents.on('context-menu', (_event, params) => {
            const template: Electron.MenuItemConstructorOptions[] = []
            const activeOwnerWindow = this.resolveGuestOwner(sourceGuestWebContentsId, ownerWindow)
            if (params.linkURL && isSafeBrowserNavigationUrl(params.linkURL)) {
                template.push(
                    { label: 'Open link in new tab', click: () => this.options.requestTab(activeOwnerWindow, sourceGuestWebContentsId, params.linkURL, true) },
                    { label: 'Open link in background tab', click: () => this.options.requestTab(activeOwnerWindow, sourceGuestWebContentsId, params.linkURL, false) },
                    { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
                    { type: 'separator' }
                )
            } else if (params.selectionText) {
                template.push({ role: 'copy' }, { type: 'separator' })
            }
            template.push(
                { label: 'Back', enabled: pageContents.navigationHistory.canGoBack(), click: () => pageContents.navigationHistory.goBack() },
                { label: 'Forward', enabled: pageContents.navigationHistory.canGoForward(), click: () => pageContents.navigationHistory.goForward() },
                { label: 'Reload', click: () => pageContents.reload() }
            )
            const activeMenuWindow = pageContents.id === sourceGuestWebContentsId ? activeOwnerWindow : menuWindow
            Menu.buildFromTemplate(template).popup({ window: activeMenuWindow })
        })
    }

    private revealOwnerWindow(ownerWindow: BrowserWindow): void {
        if (ownerWindow.isDestroyed()) return
        if (ownerWindow.isMinimized()) ownerWindow.restore()
        if (!ownerWindow.isVisible()) ownerWindow.show()
        ownerWindow.focus()
    }

    private disposePopup(popup: ManagedBrowserPopup, closePage: boolean): void {
        if (popup.disposed) return
        popup.disposed = true
        this.popupByShellContentsId.delete(popup.shellWebContentsId)
        this.activeByOwner.get(popup.ownerWindow)?.delete(popup)
        if (popup.onSourceDestroyed && !popup.sourceContents.isDestroyed()) {
            popup.sourceContents.removeListener('destroyed', popup.onSourceDestroyed)
        }
        popup.onSourceDestroyed = null
        this.publishWindowList(popup.ownerWindow)
        if (closePage && !popup.pageContents.isDestroyed()) {
            popup.pageContents.close({ waitForBeforeUnload: false })
        }
    }
}
