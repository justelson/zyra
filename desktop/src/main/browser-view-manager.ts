import { captureBrowserPage } from './browser-page-capture'
import {
    BrowserWindow,
    WebContentsView,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    type Session
} from 'electron'
import { ipcMain } from './ipc/trusted-ipc'
import log from 'electron-log'
import {
    BROWSER_LOCAL_FILE_SCHEME,
    BROWSER_VIEW_IPC,
    type BrowserViewBounds,
    type BrowserViewCommand,
    type BrowserViewControlOverlay,
    type BrowserViewEnsureInput,
    type BrowserViewEvent,
    type BrowserViewSlotInput,
    type BrowserViewState,
    type BrowserViewStateCause,
    type BrowserSessionMode
} from '../shared/browser-view'
import {
    BROWSER_PREVIEW_SHORTCUT_CHANNEL,
    type DevScopeBrowserShortcutEvent
} from '../shared/contracts/devscope-api'
import { resolveBrowserShortcut } from '../shared/browser-shortcuts'
import { isTrustedBrowserTabId, trustedBrowserGuests } from './agent-control/trusted-guest-registry'
import { transferTrustedBrowserTargetOwner } from './agent-control'
import type { BrowserPopupManager } from './browser-popup-manager'
import { getBrowserThreatProtectionService } from './browser-threat-protection-service'
import {
    createIncognitoBrowserSession,
    disposeIncognitoBrowserSession,
    getGlobalBrowserSession,
    isSafeBrowserNavigationUrl,
    registerBrowserPermissionTarget,
    scheduleGlobalBrowserProfileFlush,
    transferBrowserPermissionTargetOwner
} from './ipc/handlers/browser-preview-handlers'
import { assertBrowserPreviewDeveloperTransferable, transferBrowserPreviewDeveloperOwner } from './ipc/handlers/browser-preview-developer-handlers'
import { registerManagedBrowserPresentation, setManagedBrowserPresentationScale } from './browser-view-presentation'
import { classifyAnalyticsErrorCode as browserAnalyticsErrorCode } from '../shared/analytics/error-code'
import {
    chooseBrowserLocalFile,
    getBrowserLocalFilePresentation,
    isAuthorizedBrowserLocalFileUrl,
    revokeBrowserLocalFilesForTab
} from './browser-local-file-service'

const TRANSFER_TIMEOUT_MS = 8_000
const RELEASE_GRACE_MS = 750
const MAX_BROWSER_VIEW_BOUNDS = 32_768
const MAX_BROWSER_SNAPSHOT_WIDTH = 1_920
const MAX_BROWSER_SNAPSHOT_HEIGHT = 1_200
const MAX_BROWSER_SNAPSHOT_BYTES = 2 * 1024 * 1024

type BrowserViewRecord = {
    tabId: string
    threadId: string
    sessionMode: BrowserSessionMode
    view: WebContentsView
    ownerWindow: BrowserWindow
    ownerId: string
    revision: number
    status: BrowserViewState['status']
    url: string
    error: string | null
    faviconUrl: string | null
    fullscreen: boolean
    mainFrameFailed: boolean
    navigationGeneration: number
    stoppedNavigationGeneration: number
    navigationAttempt: number
    reportedNavigationAttempt: number
    navigationStartedAt: number
    allowedNavigationUrl: string | null
    controlOverlay: BrowserViewControlOverlay
    disposed: boolean
}

type ReportedSlot = {
    revision: number
    bounds: BrowserViewBounds | null
    contentSize: { width: number; height: number } | null
    active: boolean
    visible: boolean
}

type PendingTransfer = {
    tabId: string
    destinationWindow: BrowserWindow
    destinationOwnerId: string
    promise: Promise<BrowserViewTransferResult>
    resolve: (result: BrowserViewTransferResult) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
}

export type BrowserViewTransferResult = {
    tabId: string
    guestWebContentsId: number
    ownerId: string
}

export type BrowserViewTransferHost = {
    transferTo(tabId: string, destinationWindow: BrowserWindow): Promise<BrowserViewTransferResult>
    closeIfOwned(tabId: string, ownerWindow: BrowserWindow | null): boolean
}

type BrowserViewManagerOptions = {
    popupManager: Pick<BrowserPopupManager, 'registerGuest' | 'transferGuestOwner'>
    resolveOwnerId: (window: BrowserWindow) => string | null
    canUseBrowser?: () => boolean
    captureAnalytics?: (properties: {
        action: 'tab_create' | 'new_tab' | 'navigation' | 'threat' | 'permission' | 'transfer'
        outcome: 'started' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'allowed' | 'denied' | 'unknown'
        destination?: 'blank' | 'search' | 'documentation' | 'code_host' | 'local' | 'media' | 'commerce' | 'social' | 'other' | 'unknown'
        transfer_target?: 'main' | 'utility' | 'external' | 'unknown'
        duration_ms?: number
        error_code?: string
    }) => void
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

function browserShortcutPlatform(): 'darwin' | 'win32' | 'linux' {
    return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}

function normalizeThreadId(value: unknown): string {
    const threadId = String(value || '')
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/.test(threadId)) throw new Error('Browser owner thread identity is invalid.')
    return threadId
}

function normalizeSessionMode(value: unknown): BrowserSessionMode {
    if (value == null || value === '') return 'normal'
    if (value === 'normal' || value === 'incognito') return value
    throw new Error('Browser session mode is invalid.')
}

function normalizeSlotBounds(value: BrowserViewBounds | null, ownerWindow: BrowserWindow): BrowserViewBounds | null {
    if (!value) return null
    const raw = [value.x, value.y, value.width, value.height].map(Number)
    if (!raw.every(Number.isFinite) || raw[2] < 1 || raw[3] < 1) return null
    if (raw.some((entry) => Math.abs(entry) > MAX_BROWSER_VIEW_BOUNDS)) return null
    const content = ownerWindow.getContentBounds()
    const x = Math.max(0, Math.round(raw[0]))
    const y = Math.max(0, Math.round(raw[1]))
    const width = Math.max(1, Math.min(Math.round(raw[2]), Math.max(1, content.width - x)))
    const height = Math.max(1, Math.min(Math.round(raw[3]), Math.max(1, content.height - y)))
    return { x, y, width, height }
}

export class BrowserViewManager implements BrowserViewTransferHost {
    private readonly records = new Map<string, BrowserViewRecord>()
    private readonly slotsByOwner = new Map<number, Map<string, ReportedSlot>>()
    private readonly pendingTransfers = new Map<string, PendingTransfer>()
    private readonly releaseTimers = new Map<string, NodeJS.Timeout>()
    private readonly observedWindows = new WeakSet<BrowserWindow>()
    private incognitoSession: { session: Session; tabIds: Set<string> } | null = null
    private registered = false
    private disposed = false

    constructor(private readonly options: BrowserViewManagerOptions) {}

    isIncognitoWebContents(webContentsId: number): boolean {
        return [...this.records.values()].some((record) => !record.disposed && record.sessionMode === 'incognito' && record.view.webContents.id === webContentsId)
    }

    hasIncognitoContents(): boolean {
        return [...this.records.values()].some((record) => !record.disposed && record.sessionMode === 'incognito')
    }

    isAnalyticsAllowedForGuest(guestWebContentsId: number): boolean {
        const record = [...this.records.values()].find((candidate) => !candidate.disposed && candidate.view.webContents.id === guestWebContentsId)
        return record?.sessionMode === 'normal'
    }

    isAnalyticsAllowedForOwner(ownerWebContentsId: number): boolean {
        const slots = this.slotsByOwner.get(ownerWebContentsId)
        if (!slots) return false
        const activeTabId = [...slots.entries()].find(([, slot]) => slot.active && slot.visible)?.[0]
        if (!activeTabId) return false
        return this.records.get(activeTabId)?.sessionMode === 'normal'
    }

    registerIpc(): void {
        if (this.registered) return
        this.registered = true
        ipcMain.handle(BROWSER_VIEW_IPC.ensure, (event, input: BrowserViewEnsureInput) => this.result(() => this.ensure(event, input)))
        ipcMain.handle(BROWSER_VIEW_IPC.command, (event, command: BrowserViewCommand) => this.result(() => this.command(event, command)))
        ipcMain.handle(BROWSER_VIEW_IPC.close, (event, tabId: string) => this.result(() => this.closeFromRenderer(event, tabId)))
        ipcMain.on(BROWSER_VIEW_IPC.release, (event, tabId: string) => this.releaseFromRenderer(event, tabId))
        ipcMain.on(BROWSER_VIEW_IPC.reportSlot, (event, input: BrowserViewSlotInput) => this.reportSlot(event, input))
    }

    async transferTo(tabId: string, destinationWindow: BrowserWindow): Promise<BrowserViewTransferResult> {
        if (this.disposed) throw new Error('The Browser view manager is closed.')
        if (!isTrustedBrowserTabId(tabId)) throw new Error('Browser tab identity is invalid.')
        if (destinationWindow.isDestroyed() || destinationWindow.webContents.isDestroyed()) throw new Error('The destination window is unavailable.')
        const destinationOwnerId = this.options.resolveOwnerId(destinationWindow)
        if (!destinationOwnerId) throw new Error('The destination is not a Browser-capable Zyra window.')
        this.observeWindow(destinationWindow)

        const record = this.records.get(tabId)
        if (!record || record.disposed) throw new Error('The live Browser source view is unavailable.')
        if (record.ownerWindow === destinationWindow) {
            this.cancelRelease(tabId)
            this.applyCurrentSlot(record)
            return { tabId, guestWebContentsId: record.view.webContents.id, ownerId: record.ownerId }
        }
        const existing = this.pendingTransfers.get(tabId)
        if (existing) {
            if (existing.destinationWindow === destinationWindow) return existing.promise
            this.rejectTransfer(existing, new Error('A newer Browser tab transfer replaced the pending destination.'))
        }

        let resolveTransfer!: (result: BrowserViewTransferResult) => void
        let rejectTransfer!: (error: Error) => void
        const promise = new Promise<BrowserViewTransferResult>((resolve, reject) => {
            resolveTransfer = resolve
            rejectTransfer = reject
        })
        const analyticsAllowed = record.sessionMode === 'normal'
        const pending: PendingTransfer = {
            tabId,
            destinationWindow,
            destinationOwnerId,
            promise,
            resolve: resolveTransfer,
            reject: rejectTransfer,
            timer: setTimeout(() => {
                this.rejectTransfer(pending, new Error('The destination window did not report a live Browser slot.'))
            }, TRANSFER_TIMEOUT_MS)
        }
        this.pendingTransfers.set(tabId, pending)
        this.attemptTransfer(pending)
        return promise.then((result) => {
            if (analyticsAllowed) this.options.captureAnalytics?.({
                action: 'transfer',
                outcome: 'completed',
                transfer_target: destinationOwnerId === 'main' ? 'main' : destinationOwnerId.startsWith('utility:') ? 'utility' : 'unknown'
            })
            return result
        }, (error) => {
            if (analyticsAllowed) this.options.captureAnalytics?.({ action: 'transfer', outcome: 'failed', error_code: browserAnalyticsErrorCode(error) })
            throw error
        })
    }

    closeIfOwned(tabId: string, ownerWindow: BrowserWindow | null): boolean {
        const record = this.records.get(tabId)
        if (!record || !ownerWindow || record.ownerWindow !== ownerWindow) return false
        this.closeRecord(record)
        return true
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        for (const pending of [...this.pendingTransfers.values()]) {
            this.rejectTransfer(pending, new Error('The Browser view manager closed during transfer.'))
        }
        for (const timer of this.releaseTimers.values()) clearTimeout(timer)
        this.releaseTimers.clear()
        for (const record of [...this.records.values()]) this.closeRecord(record)
        this.slotsByOwner.clear()
    }

    private async ensure(event: IpcMainInvokeEvent, input: BrowserViewEnsureInput): Promise<{ created: boolean; state: BrowserViewState }> {
        const { window, ownerId } = this.resolveSender(event)
        const tabId = String(input?.tabId || '')
        if (!isTrustedBrowserTabId(tabId)) throw new Error('Browser tab identity is invalid.')
        const threadId = normalizeThreadId(input?.threadId)
        const sessionMode = normalizeSessionMode(input?.sessionMode)
        let existing = this.records.get(tabId)
        if (existing && existing.threadId !== threadId && existing.ownerWindow === window) {
            this.closeRecord(existing)
            existing = undefined
        }
        if (existing) {
            if (existing.threadId !== threadId) throw new Error('The Browser tab belongs to another chat thread.')
            if (existing.sessionMode !== sessionMode) throw new Error('An existing Browser tab cannot change between normal and incognito mode.')
            const pending = this.pendingTransfers.get(tabId)
            if (existing.ownerWindow !== window && pending?.destinationWindow !== window) {
                throw new Error('The Browser tab belongs to another Zyra window.')
            }
            this.cancelRelease(tabId)
            return { created: false, state: this.readState(existing) }
        }

        const pending = this.pendingTransfers.get(tabId)
        if (pending && pending.destinationWindow === window) {
            throw new Error('The live Browser source has not finished preparing its view.')
        }
        const record = this.createRecord({ tabId, threadId, sessionMode, ownerWindow: window, ownerId })
        const initialUrl = String(input?.initialUrl || '').trim()
        if (sessionMode === 'normal') this.options.captureAnalytics?.({
            action: initialUrl ? 'tab_create' : 'new_tab',
            outcome: 'completed',
            destination: initialUrl ? classifyBrowserDestination(initialUrl) : 'blank'
        })
        if (initialUrl) setImmediate(() => {
            if (record.disposed || record.view.webContents.getURL() !== 'about:blank') return
            void this.navigate(record, initialUrl).catch((error) => {
                if (record.disposed) return
                record.status = 'error'
                record.error = errorMessage(error, 'The page could not be opened.')
                this.publishState(record, 'error')
            })
        })
        return { created: true, state: this.readState(record) }
    }

    private createRecord(input: { tabId: string; threadId: string; sessionMode: BrowserSessionMode; ownerWindow: BrowserWindow; ownerId: string }): BrowserViewRecord {
        const browserSession = input.sessionMode === 'incognito'
            ? this.acquireIncognitoSession(input.tabId)
            : getGlobalBrowserSession()
        let view: WebContentsView
        try {
            view = new WebContentsView({
                webPreferences: {
                    session: browserSession,
                    preload: undefined,
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                    nodeIntegrationInSubFrames: false,
                    nodeIntegrationInWorker: false,
                    backgroundThrottling: false,
                    webSecurity: true,
                    allowRunningInsecureContent: false,
                    navigateOnDragDrop: false,
                    safeDialogs: true
                }
            })
        } catch (error) {
            this.releaseIncognitoSession(input.tabId)
            throw error
        }
        const record: BrowserViewRecord = {
            ...input,
            view,
            revision: 0,
            status: 'idle',
            url: '',
            error: null,
            faviconUrl: null,
            fullscreen: false,
            mainFrameFailed: false,
            navigationGeneration: 0,
            stoppedNavigationGeneration: 0,
            navigationAttempt: 0,
            reportedNavigationAttempt: 0,
            navigationStartedAt: 0,
            allowedNavigationUrl: null,
            controlOverlay: { controlled: false, cursor: null },
            disposed: false
        }
        const page = view.webContents
        try {
            this.records.set(record.tabId, record)
            this.observeWindow(record.ownerWindow)
            record.ownerWindow.contentView.addChildView(view)
            view.setBackgroundColor('#ffffff')
            view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
            view.setVisible(false)
            trustedBrowserGuests.register(record.ownerWindow.webContents.id, page)
            registerManagedBrowserPresentation(page)
            registerBrowserPermissionTarget(page, record.ownerWindow.webContents)
            this.options.popupManager.registerGuest(record.ownerWindow, page, page.id)
            this.installPageLifecycle(record)
            this.applyCurrentSlot(record)
            return record
        } catch (error) {
            this.records.delete(record.tabId)
            try { record.ownerWindow.contentView.removeChildView(view) } catch {}
            if (!page.isDestroyed()) page.close({ waitForBeforeUnload: false })
            this.releaseIncognitoSession(record.tabId)
            throw error
        }
    }

    private acquireIncognitoSession(tabId: string): Session {
        if (!this.incognitoSession) {
            this.incognitoSession = { session: createIncognitoBrowserSession(), tabIds: new Set() }
        }
        this.incognitoSession.tabIds.add(tabId)
        return this.incognitoSession.session
    }

    private releaseIncognitoSession(tabId: string): void {
        const group = this.incognitoSession
        if (!group || !group.tabIds.delete(tabId) || group.tabIds.size > 0) return
        this.incognitoSession = null
        void disposeIncognitoBrowserSession(group.session).catch((error) => {
            log.warn('[BrowserView] Could not clear the closed incognito session.', error)
        })
    }

    private installPageLifecycle(record: BrowserViewRecord): void {
        const page = record.view.webContents
        const pageSession = page.session
        page.on('focus', () => this.publishEvent(record, {
            type: 'focus',
            tabId: record.tabId,
            guestWebContentsId: page.id
        }))
        page.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
            if (!isMainFrame) return
            record.url = url === 'about:blank' ? '' : url
            if (!isInPlace) {
                record.navigationAttempt += 1
                record.navigationStartedAt = Date.now()
                record.mainFrameFailed = false
                record.status = url === 'about:blank' ? 'idle' : 'loading'
                record.error = null
                record.faviconUrl = null
            }
            this.publishState(record, 'navigation')
        })
        page.on('did-navigate', (_event, url) => {
            record.url = url === 'about:blank' ? '' : url
            this.publishState(record, 'navigation')
        })
        page.on('did-navigate-in-page', (_event, url, isMainFrame) => {
            if (isMainFrame) {
                record.url = url === 'about:blank' ? '' : url
                this.publishState(record, 'navigation')
            }
        })
        page.on('did-stop-loading', () => {
            if (record.sessionMode === 'normal') scheduleGlobalBrowserProfileFlush()
            if (!record.mainFrameFailed) {
                record.status = page.getURL() === 'about:blank' ? 'idle' : 'ready'
                record.error = null
            }
            this.publishState(record, record.mainFrameFailed ? 'error' : 'navigation')
        })
        page.on('did-finish-load', () => {
            record.mainFrameFailed = false
            record.status = page.getURL() === 'about:blank' ? 'idle' : 'ready'
            record.error = null
            this.publishState(record, 'navigation')
            if (record.reportedNavigationAttempt !== record.navigationAttempt) {
                record.reportedNavigationAttempt = record.navigationAttempt
                if (record.sessionMode === 'normal') this.options.captureAnalytics?.({ action: 'navigation', outcome: 'completed', destination: classifyBrowserDestination(page.getURL()), duration_ms: Date.now() - record.navigationStartedAt })
            }
            void this.applyControlOverlay(record)
        })
        page.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) return
            record.mainFrameFailed = true
            record.url = validatedURL === 'about:blank' ? '' : validatedURL || record.url
            record.status = 'error'
            record.error = `${errorDescription || 'The page could not be loaded.'}${validatedURL ? ` (${validatedURL})` : ''}`.slice(0, 1_024)
            this.publishState(record, 'error')
            if (record.reportedNavigationAttempt !== record.navigationAttempt) {
                record.reportedNavigationAttempt = record.navigationAttempt
                if (record.sessionMode === 'normal') this.options.captureAnalytics?.({ action: 'navigation', outcome: 'failed', destination: classifyBrowserDestination(validatedURL), duration_ms: Date.now() - record.navigationStartedAt, error_code: browserAnalyticsErrorCode(errorDescription) })
            }
        })
        page.on('page-title-updated', () => this.publishState(record, 'metadata'))
        page.on('page-favicon-updated', (_event, favicons) => {
            record.faviconUrl = favicons.find((value) => typeof value === 'string' && value.length <= 4_096) || null
            this.publishState(record, 'metadata')
        })
        page.on('audio-state-changed', () => this.publishState(record, 'audio'))
        page.on('media-started-playing', () => this.publishState(record, 'audio'))
        page.on('media-paused', () => this.publishState(record, 'audio'))
        page.on('enter-html-full-screen', () => {
            record.fullscreen = true
            if (!record.ownerWindow.isDestroyed()) record.ownerWindow.setFullScreen(true)
            this.publishState(record, 'fullscreen')
        })
        page.on('leave-html-full-screen', () => {
            record.fullscreen = false
            if (!record.ownerWindow.isDestroyed() && record.ownerWindow.isFullScreen()) record.ownerWindow.setFullScreen(false)
            this.publishState(record, 'fullscreen')
        })
        page.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.key === 'Escape' && record.ownerWindow.isFullScreen()) {
                event.preventDefault()
                record.ownerWindow.setFullScreen(false)
                return
            }
            const action = resolveBrowserShortcut(input, browserShortcutPlatform())
            if (!action) return
            event.preventDefault()
            const payload: DevScopeBrowserShortcutEvent = { sourceGuestWebContentsId: page.id, action }
            if (!record.ownerWindow.isDestroyed()) record.ownerWindow.webContents.send(BROWSER_PREVIEW_SHORTCUT_CHANNEL, payload)
        })
        page.on('will-navigate', (event, url) => this.guardPageNavigation(record, event, url))
        page.on('will-redirect', (event, url) => this.guardPageNavigation(record, event, url))
        page.once('destroyed', () => {
            const wasDisposed = record.disposed
            record.disposed = true
            if (this.records.get(record.tabId) === record) this.records.delete(record.tabId)
            const pending = this.pendingTransfers.get(record.tabId)
            if (pending) this.rejectTransfer(pending, new Error('The live Browser tab closed during transfer.'))
            if (!wasDisposed) {
                revokeBrowserLocalFilesForTab(pageSession, record.tabId)
                this.releaseIncognitoSession(record.tabId)
            }
        })
    }

    private guardPageNavigation(record: BrowserViewRecord, event: Electron.Event, url: string): void {
        if (url === 'about:blank') return
        if (isAuthorizedBrowserLocalFileUrl(record.view.webContents.session, record.tabId, url)) return
        if (!isSafeBrowserNavigationUrl(url)) {
            event.preventDefault()
            return
        }
        if (record.allowedNavigationUrl === url) {
            record.allowedNavigationUrl = null
            return
        }
        const threatProtection = getBrowserThreatProtectionService()
        if (!threatProtection?.checkUrl(url) || threatProtection.consumeOneTimeAllowance(record.view.webContents.id, url)) return
        const warning = threatProtection.blockNavigation({
            ownerWebContentsId: record.ownerWindow.webContents.id,
            sourceGuestWebContentsId: record.view.webContents.id,
            blockedGuestWebContentsId: record.view.webContents.id,
            navigationKind: 'current-tab',
            previousUrl: record.view.webContents.getURL(),
            url,
            proceed: () => {
                if (!record.disposed) void record.view.webContents.loadURL(url).catch((error) => log.debug('[BrowserView] Allowed navigation failed.', error))
            }
        })
        if (warning) {
            event.preventDefault()
            if (record.sessionMode === 'normal') this.options.captureAnalytics?.({ action: 'threat', outcome: 'blocked', destination: classifyBrowserDestination(url) })
        }
    }

    private async command(event: IpcMainInvokeEvent, command: BrowserViewCommand): Promise<{ accepted: boolean; state: BrowserViewState; snapshotDataUrl?: string }> {
        const { window } = this.resolveSender(event)
        const tabId = String(command?.tabId || '')
        const record = this.requireOwnedRecord(tabId, window)
        const page = record.view.webContents
        let accepted = true
        let snapshotDataUrl: string | undefined
        if (command.type === 'navigate') {
            accepted = await this.navigate(record, String(command.url || ''))
        } else if (command.type === 'open-local-file') {
            const selection = await chooseBrowserLocalFile(record.ownerWindow, page.session, record.tabId)
            accepted = Boolean(selection)
            if (selection) await this.loadPage(record, selection.url)
        } else if (command.type === 'back') {
            if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack()
        } else if (command.type === 'forward') {
            if (page.navigationHistory.canGoForward()) page.navigationHistory.goForward()
        } else if (command.type === 'reload') {
            record.navigationGeneration += 1
            page.reload()
        } else if (command.type === 'new-tab') {
            const generation = ++record.navigationGeneration
            try {
                await page.loadURL('about:blank')
            } catch (error) {
                if (!record.disposed && generation === record.navigationGeneration && generation > record.stoppedNavigationGeneration) throw error
            }
        } else if (command.type === 'stop') {
            record.stoppedNavigationGeneration = ++record.navigationGeneration
            page.stop()
        } else if (command.type === 'focus') {
            page.focus()
        } else if (command.type === 'blur') {
            record.ownerWindow.webContents.focus()
        } else if (command.type === 'capture') {
            const captured = await captureBrowserPage(page)
            const size = captured.getSize()
            const scale = Math.min(
                1,
                MAX_BROWSER_SNAPSHOT_WIDTH / Math.max(1, size.width),
                MAX_BROWSER_SNAPSHOT_HEIGHT / Math.max(1, size.height)
            )
            const presentation = scale < 1
                ? captured.resize({
                    width: Math.max(1, Math.round(size.width * scale)),
                    height: Math.max(1, Math.round(size.height * scale)),
                    quality: 'good'
                })
                : captured
            let jpeg = presentation.toJPEG(72)
            if (jpeg.byteLength > MAX_BROWSER_SNAPSHOT_BYTES) jpeg = presentation.toJPEG(52)
            if (jpeg.byteLength <= MAX_BROWSER_SNAPSHOT_BYTES) {
                snapshotDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
            }
        } else if (command.type === 'control-overlay') {
            const phases = new Set(['idle', 'moving', 'pressing', 'dragging', 'typing', 'scrolling'])
            const cursor = command.cursor && command.cursor.visible && Number.isFinite(command.cursor.x) && Number.isFinite(command.cursor.y) && phases.has(command.cursor.phase)
                ? {
                    x: Math.max(-MAX_BROWSER_VIEW_BOUNDS, Math.min(MAX_BROWSER_VIEW_BOUNDS, command.cursor.x)),
                    y: Math.max(-MAX_BROWSER_VIEW_BOUNDS, Math.min(MAX_BROWSER_VIEW_BOUNDS, command.cursor.y)),
                    visible: true,
                    phase: command.cursor.phase,
                    label: command.cursor.label === 'Agent' ? 'Agent' as const : 'Zyra' as const
                }
                : null
            record.controlOverlay = { controlled: command.controlled === true, cursor }
            await this.applyControlOverlay(record)
        } else {
            throw new Error('Browser command is invalid.')
        }
        return { accepted, state: this.readState(record), ...(snapshotDataUrl ? { snapshotDataUrl } : {}) }
    }

    private async applyControlOverlay(record: BrowserViewRecord): Promise<void> {
        if (record.disposed || record.view.webContents.isDestroyed()) return
        const payload = JSON.stringify(record.controlOverlay)
        const code = `(() => {
            const payload = ${payload};
            const stateKey = '__zyraControlOverlayState';
            let state = globalThis[stateKey];
            if (!payload.controlled && !payload.cursor?.visible) {
                state?.host?.remove();
                delete globalThis[stateKey];
                return;
            }
            if (!state?.host?.isConnected) {
                const host = document.createElement('div');
                host.setAttribute('data-zyra-control-overlay', '');
                host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;contain:layout style paint;';
                const shadow = host.attachShadow({ mode: 'closed' });
                (document.documentElement || document.body).appendChild(host);
                state = { host, shadow };
                globalThis[stateKey] = state;
            }
            const cursor = payload.cursor;
            const active = cursor && cursor.phase !== 'idle';
            const cursorMarkup = cursor?.visible ? '<div class="cursor" style="transform:translate3d(' + cursor.x + 'px,' + cursor.y + 'px,0)"><span class="pulse ' + (active ? 'active' : '') + ' ' + (cursor.phase === 'pressing' ? 'pressing' : '') + '"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 3.5 19 13l-6.1 1.35L9.5 20z"/></svg><span class="label">' + cursor.label + (active ? ' · ' + cursor.phase : '') + '</span></div>' : '';
            state.shadow.innerHTML = '<style>:host{all:initial}.frame{position:absolute;inset:0;border:1px solid rgba(103,232,249,.42);box-shadow:inset 0 0 20px rgba(34,211,238,.08)}.cursor{position:absolute;left:0;top:0;will-change:transform;font-family:system-ui,sans-serif}.cursor svg{position:relative;width:19px;height:19px;transform:translate(-2px,-2px);fill:#67e8f9;stroke:#020617;stroke-width:1.7;filter:drop-shadow(0 1px 3px rgba(0,0,0,.85))}.pulse{position:absolute;left:-10px;top:-10px;width:20px;height:20px;border-radius:999px;border:1px solid rgba(165,243,252,.25);background:rgba(103,232,249,.06);transform:scale(.75)}.pulse.active{border-color:rgba(165,243,252,.58);background:rgba(103,232,249,.2);transform:scale(1)}.pulse.pressing{transform:scale(1.25);background:rgba(165,243,252,.3)}.label{position:absolute;left:12px;top:12px;white-space:nowrap;border:1px solid rgba(165,243,252,.28);border-radius:2px;background:rgba(2,6,23,.92);padding:2px 4px;color:#cffafe;font:600 7px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 3px 8px rgba(0,0,0,.35)}</style>' + (payload.controlled ? '<div class="frame"></div>' : '') + cursorMarkup;
        })()`
        await record.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }], false).catch((error) => {
            log.debug('[BrowserView] Could not update the native control overlay.', error)
        })
    }

    private async navigate(record: BrowserViewRecord, rawUrl: string): Promise<boolean> {
        const url = String(rawUrl || '').trim()
        if (isAuthorizedBrowserLocalFileUrl(record.view.webContents.session, record.tabId, url)) {
            return this.loadPage(record, url)
        }
        let protocol = ''
        try { protocol = new URL(url).protocol } catch {}
        if (protocol === `${BROWSER_LOCAL_FILE_SCHEME}:`) {
            throw new Error('Local file access expired. Choose Open file to grant access again.')
        }
        if (!isSafeBrowserNavigationUrl(url)) throw new Error('Only HTTP and HTTPS links can open in Browser.')
        const page = record.view.webContents
        const threatProtection = getBrowserThreatProtectionService()
        if (threatProtection?.checkUrl(url)) {
            const allowed = threatProtection.consumeOneTimeAllowance(page.id, url)
                || threatProtection.consumeOneTimeOwnerAllowance(record.ownerWindow.webContents.id, url)
            if (!allowed) {
                const warning = threatProtection.blockNavigation({
                    ownerWebContentsId: record.ownerWindow.webContents.id,
                    sourceGuestWebContentsId: page.id,
                    blockedGuestWebContentsId: page.id,
                    navigationKind: 'current-tab',
                    previousUrl: page.getURL(),
                    url,
                    proceed: () => {
                        if (!record.disposed) void page.loadURL(url).catch((error) => log.debug('[BrowserView] Allowed navigation failed.', error))
                    }
                })
                if (warning) return false
            } else {
                record.allowedNavigationUrl = url
            }
        }
        return this.loadPage(record, url)
    }

    private async loadPage(record: BrowserViewRecord, url: string): Promise<boolean> {
        const page = record.view.webContents
        const generation = ++record.navigationGeneration
        try {
            await page.loadURL(url)
        } catch (error) {
            if (record.disposed || generation !== record.navigationGeneration || generation <= record.stoppedNavigationGeneration) return true
            const message = errorMessage(error, 'The page could not be opened.')
            if (/ERR_ABORTED|aborted/i.test(message)) return true
            throw error
        }
        return true
    }

    private reportSlot(event: IpcMainEvent, input: BrowserViewSlotInput): void {
        try {
            const { window } = this.resolveSender(event)
            const tabId = String(input?.tabId || '')
            if (!isTrustedBrowserTabId(tabId)) return
            const revision = Math.max(0, Math.floor(Number(input?.revision) || 0))
            const ownerSlots = this.slotsByOwner.get(event.sender.id) || new Map<string, ReportedSlot>()
            this.slotsByOwner.set(event.sender.id, ownerSlots)
            const previous = ownerSlots.get(tabId)
            if (previous && revision < previous.revision) return
            const contentWidth = Math.round(Number(input?.contentSize?.width) || 0)
            const contentHeight = Math.round(Number(input?.contentSize?.height) || 0)
            ownerSlots.set(tabId, {
                revision,
                bounds: normalizeSlotBounds(input?.bounds || null, window),
                contentSize: contentWidth >= 1 && contentHeight >= 1 && contentWidth <= MAX_BROWSER_VIEW_BOUNDS && contentHeight <= MAX_BROWSER_VIEW_BOUNDS
                    ? { width: contentWidth, height: contentHeight }
                    : null,
                active: input?.active === true,
                visible: input?.visible === true
            })
            const record = this.records.get(tabId)
            if (record?.ownerWindow === window) this.applyCurrentSlot(record)
            const pending = this.pendingTransfers.get(tabId)
            if (pending?.destinationWindow === window) this.attemptTransfer(pending)
        } catch {
            // Slot reports are best-effort layout telemetry from trusted shell renderers.
        }
    }

    private attemptTransfer(pending: PendingTransfer): void {
        if (this.pendingTransfers.get(pending.tabId) !== pending) return
        const record = this.records.get(pending.tabId)
        const slot = this.slotsByOwner.get(pending.destinationWindow.webContents.id)?.get(pending.tabId)
        if (!record || !slot?.active || !slot.bounds) return
        try {
            this.performTransfer(record, pending.destinationWindow, pending.destinationOwnerId, slot)
            this.pendingTransfers.delete(pending.tabId)
            clearTimeout(pending.timer)
            pending.resolve({
                tabId: record.tabId,
                guestWebContentsId: record.view.webContents.id,
                ownerId: record.ownerId
            })
        } catch (error) {
            this.rejectTransfer(pending, error instanceof Error ? error : new Error('The Browser tab could not move to its destination.'))
        }
    }

    private performTransfer(record: BrowserViewRecord, destinationWindow: BrowserWindow, destinationOwnerId: string, slot: ReportedSlot): void {
        this.cancelRelease(record.tabId)
        if (record.ownerWindow === destinationWindow) {
            this.applySlot(record, slot)
            return
        }
        const sourceWindow = record.ownerWindow
        const sourceOwnerId = record.ownerId
        const sourceWebContentsId = sourceWindow.webContents.id
        const destinationWebContentsId = destinationWindow.webContents.id
        const page = record.view.webContents
        assertBrowserPreviewDeveloperTransferable(page.id)

        record.view.setVisible(false)
        sourceWindow.contentView.removeChildView(record.view)
        destinationWindow.contentView.addChildView(record.view)
        record.ownerWindow = destinationWindow
        record.ownerId = destinationOwnerId
        try {
            transferTrustedBrowserTargetOwner(page.id, sourceWebContentsId, destinationWebContentsId)
            transferBrowserPermissionTargetOwner(page, destinationWindow.webContents)
            this.options.popupManager.transferGuestOwner(page.id, sourceWindow, destinationWindow)
            getBrowserThreatProtectionService()?.transferGuestOwner(page.id, sourceWebContentsId, destinationWebContentsId)
            transferBrowserPreviewDeveloperOwner(page.id, sourceWebContentsId, destinationWebContentsId)
        } catch (error) {
            record.ownerWindow = sourceWindow
            record.ownerId = sourceOwnerId
            destinationWindow.contentView.removeChildView(record.view)
            sourceWindow.contentView.addChildView(record.view)
            this.applyCurrentSlot(record)
            throw error
        }

        if (record.fullscreen) {
            if (!sourceWindow.isDestroyed() && sourceWindow.isFullScreen()) sourceWindow.setFullScreen(false)
            if (!destinationWindow.isDestroyed()) destinationWindow.setFullScreen(true)
        }
        this.applySlot(record, slot)
        this.publishState(record, 'ownership')
    }

    private applyCurrentSlot(record: BrowserViewRecord): void {
        const slot = this.slotsByOwner.get(record.ownerWindow.webContents.id)?.get(record.tabId)
        if (!slot) {
            record.view.setVisible(false)
            return
        }
        this.applySlot(record, slot)
    }

    private applySlot(record: BrowserViewRecord, slot: ReportedSlot): void {
        if (record.disposed) return
        if (slot.bounds) {
            record.view.setBounds(slot.bounds)
            const scale = slot.contentSize
                ? Math.min(1, slot.bounds.width / slot.contentSize.width, slot.bounds.height / slot.contentSize.height)
                : 1
            setManagedBrowserPresentationScale(record.view.webContents, scale)
        }
        record.view.setVisible(Boolean(slot.active && slot.visible && slot.bounds))
    }

    private releaseFromRenderer(event: IpcMainEvent, rawTabId: string): void {
        try {
            const { window } = this.resolveSender(event)
            const tabId = String(rawTabId || '')
            const record = this.records.get(tabId)
            if (!record || record.ownerWindow !== window) return
            this.scheduleRelease(record, window)
        } catch {
            // A stale source renderer cannot release a view after authority moved.
        }
    }

    private scheduleRelease(record: BrowserViewRecord, ownerWindow: BrowserWindow): void {
        if (this.releaseTimers.has(record.tabId)) return
        const timer = setTimeout(() => {
            this.releaseTimers.delete(record.tabId)
            const current = this.records.get(record.tabId)
            if (current === record && current.ownerWindow === ownerWindow) this.closeRecord(current, false)
        }, RELEASE_GRACE_MS)
        this.releaseTimers.set(record.tabId, timer)
    }

    private cancelRelease(tabId: string): void {
        const timer = this.releaseTimers.get(tabId)
        if (timer) clearTimeout(timer)
        this.releaseTimers.delete(tabId)
    }

    private closeFromRenderer(event: IpcMainInvokeEvent, rawTabId: string): { closed: boolean } {
        const { window } = this.resolveSender(event)
        const tabId = String(rawTabId || '')
        const record = this.records.get(tabId)
        if (!record) return { closed: true }
        if (record.ownerWindow !== window) throw new Error('The Browser tab belongs to another Zyra window.')
        this.closeRecord(record)
        return { closed: true }
    }

    private closeRecord(record: BrowserViewRecord, revokeLocalFiles = true): void {
        if (record.disposed) return
        this.cancelRelease(record.tabId)
        if (revokeLocalFiles) revokeBrowserLocalFilesForTab(record.view.webContents.session, record.tabId)
        record.disposed = true
        this.records.delete(record.tabId)
        const pending = this.pendingTransfers.get(record.tabId)
        if (pending) this.rejectTransfer(pending, new Error('The Browser tab closed during transfer.'))
        try { record.ownerWindow.contentView.removeChildView(record.view) } catch {}
        const page = record.view.webContents
        if (!page.isDestroyed()) page.close({ waitForBeforeUnload: false })
        this.releaseIncognitoSession(record.tabId)
    }

    private rejectTransfer(pending: PendingTransfer, error: Error): void {
        if (this.pendingTransfers.get(pending.tabId) === pending) this.pendingTransfers.delete(pending.tabId)
        clearTimeout(pending.timer)
        pending.reject(error)
    }

    private readState(record: BrowserViewRecord): BrowserViewState {
        const page = record.view.webContents
        const pageUrl = page.isDestroyed() ? '' : page.getURL()
        const rawUrl = record.status === 'loading' && record.url ? record.url : pageUrl || record.url
        const blank = !rawUrl || rawUrl === 'about:blank'
        const localFile = blank ? null : getBrowserLocalFilePresentation(page.session, record.tabId, rawUrl)
        let title = blank ? 'New tab' : page.getTitle().trim().slice(0, 512)
        if (!title) {
            if (localFile) title = localFile.fileName
            else try { title = new URL(rawUrl).hostname || 'Browser' } catch { title = 'Browser' }
        }
        return {
            version: 1,
            revision: record.revision,
            tabId: record.tabId,
            sessionMode: record.sessionMode,
            guestWebContentsId: page.id,
            url: blank ? '' : rawUrl,
            displayAddress: localFile?.displayAddress || null,
            title,
            status: blank && record.status !== 'error' ? 'idle' : record.status,
            error: record.error,
            canGoBack: !page.isDestroyed() && page.navigationHistory.canGoBack(),
            canGoForward: !page.isDestroyed() && page.navigationHistory.canGoForward(),
            faviconUrl: record.faviconUrl,
            audible: !page.isDestroyed() && page.isCurrentlyAudible(),
            fullscreen: record.fullscreen
        }
    }

    private publishState(record: BrowserViewRecord, cause: BrowserViewStateCause): void {
        if (record.disposed) return
        record.revision += 1
        this.publishEvent(record, { type: 'state', cause, state: this.readState(record) })
    }

    private publishEvent(record: BrowserViewRecord, event: BrowserViewEvent): void {
        const owner = record.ownerWindow
        if (record.disposed || owner.isDestroyed() || owner.webContents.isDestroyed()) return
        owner.webContents.send(BROWSER_VIEW_IPC.event, event)
    }

    private requireOwnedRecord(tabId: string, ownerWindow: BrowserWindow): BrowserViewRecord {
        if (!isTrustedBrowserTabId(tabId)) throw new Error('Browser tab identity is invalid.')
        const record = this.records.get(tabId)
        if (!record || record.disposed) throw new Error('The Browser view is no longer available.')
        if (record.ownerWindow !== ownerWindow) throw new Error('The Browser tab belongs to another Zyra window.')
        return record
    }

    private resolveSender(event: IpcMainInvokeEvent | IpcMainEvent): { window: BrowserWindow; ownerId: string } {
        if (this.disposed || this.options.canUseBrowser?.() === false) throw new Error('Browser is unavailable until Zyra setup is complete.')
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || window.isDestroyed() || window.webContents.id !== event.sender.id) throw new Error('Browser requests require a trusted Zyra shell window.')
        const ownerId = this.options.resolveOwnerId(window)
        if (!ownerId) throw new Error('Browser requests require a trusted Zyra shell window.')
        this.observeWindow(window)
        return { window, ownerId }
    }

    private observeWindow(window: BrowserWindow): void {
        if (this.observedWindows.has(window)) return
        this.observedWindows.add(window)
        const ownerWebContentsId = window.webContents.id
        window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
            if (!isMainFrame || isInPlace) return
            this.slotsByOwner.delete(ownerWebContentsId)
            for (const record of this.records.values()) {
                if (record.ownerWindow !== window) continue
                record.view.setVisible(false)
                this.scheduleRelease(record, window)
            }
        })
        window.on('leave-full-screen', () => {
            for (const record of this.records.values()) {
                if (record.ownerWindow !== window || !record.fullscreen || record.view.webContents.isDestroyed()) continue
                void record.view.webContents.executeJavaScript('if (document.fullscreenElement) void document.exitFullscreen()').catch(() => undefined)
            }
        })
        window.once('closed', () => {
            this.slotsByOwner.delete(ownerWebContentsId)
            for (const pending of [...this.pendingTransfers.values()]) {
                if (pending.destinationWindow === window) this.rejectTransfer(pending, new Error('The Browser transfer destination closed.'))
            }
            for (const record of [...this.records.values()]) {
                if (record.ownerWindow === window) this.closeRecord(record)
            }
        })
    }

    private async result<T extends object>(operation: () => T | Promise<T>): Promise<({ success: true } & T) | { success: false; error: string }> {
        try {
            return { success: true, ...(await operation()) }
        } catch (error) {
            return { success: false, error: errorMessage(error, 'Browser view request failed.') }
        }
    }
}

function classifyBrowserDestination(value: unknown): 'blank' | 'search' | 'documentation' | 'code_host' | 'local' | 'media' | 'commerce' | 'social' | 'other' | 'unknown' {
    const raw = String(value || '').trim()
    if (!raw || raw === 'about:blank') return 'blank'
    let host = ''
    try {
        const parsed = new URL(raw)
        if (parsed.protocol === `${BROWSER_LOCAL_FILE_SCHEME}:`) return 'local'
        host = parsed.hostname.toLowerCase()
    } catch { return 'unknown' }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return 'local'
    if (/google\.|bing\.|duckduckgo\.|search\./.test(host)) return 'search'
    if (/github\.|gitlab\.|bitbucket\./.test(host)) return 'code_host'
    if (/docs\.|developer\.|readthedocs\.|mdn\./.test(host)) return 'documentation'
    if (/youtube\.|youtu\.be|vimeo\.|spotify\.|soundcloud\./.test(host)) return 'media'
    if (/amazon\.|shopify\.|ebay\.|etsy\./.test(host)) return 'commerce'
    return 'other'
}
