import { handleGuestAppShortcut, isRecordingShortcut } from './keybindings'
import { browserControlOverlayScript } from './browser-control-overlay'
import { captureBrowserTabPreview } from './browser-page-capture'
import { addNativeWindowView } from './native-view-layers'
import {
    BrowserWindow,
    WebContentsView,
    dialog,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    type Session,
    type WebContents
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
import { bindTrustedBrowserTarget, transferTrustedBrowserTargetOwner } from './agent-control'
import type { BrowserSurfaceOpenRequest } from '../shared/agent-control/protocol'
import { AgentControlError } from './agent-control/control-errors'
import type { BrowserPopupManager } from './browser-popup-manager'
import { getBrowserThreatProtectionService } from './browser-threat-protection-service'
import { getBrowserExtensionManager } from './browser-extension-manager'
import { BrowserWebStoreInstall } from './browser-web-store-install'
import { renderWebStoreInstall } from './browser-web-store-page'
import { chromeWebStoreIdFromUrl, type WebStoreInstallTheme } from '../shared/browser-web-store'
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
import { registerManagedBrowserPresentation, setManagedBrowserPresentationScale, setManagedBrowserControlViewport, isManagedBrowserRetainedForAgent } from './browser-view-presentation'
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
    agentOwned: boolean
    ready: Promise<void>
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
    sourceWindow: BrowserWindow
    sourceOwnerId: string
    sourceThreadId: string
    sessionMode: BrowserSessionMode
    destinationWindow: BrowserWindow
    destinationOwnerId: string
    destinationThreadId: string
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

export type BrowserViewTransferOptions = {
    expectedSourceWindow?: BrowserWindow
    expectedSourceOwnerId?: string
    expectedSessionMode?: BrowserSessionMode
    destinationThreadId?: string
}

export type BrowserViewTransferHost = {
    transferTo(tabId: string, destinationWindow: BrowserWindow, options?: BrowserViewTransferOptions): Promise<BrowserViewTransferResult>
    closeIfOwned(tabId: string, ownerWindow: BrowserWindow | null): boolean
}

/** Native shell overlays follow the existing page without taking ownership of it. */
export type BrowserViewPresentation = {
    tabId: string
    guestWebContents: WebContents
    ownerWindow: BrowserWindow | null
    bounds: BrowserViewBounds | null
    visible: boolean
    disposed: boolean
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
    private readonly webStoreInstalls = new WeakMap<BrowserViewRecord, BrowserWebStoreInstall>()
    private readonly slotsByOwner = new Map<number, Map<string, ReportedSlot>>()
    private readonly pendingTransfers = new Map<string, PendingTransfer>()
    private readonly releaseTimers = new Map<string, NodeJS.Timeout>()
    private readonly observedWindows = new WeakSet<BrowserWindow>()
    private readonly presentationObservers = new Set<(presentation: BrowserViewPresentation) => void>()
    private incognitoSession: { session: Session; tabIds: Set<string> } | null = null
    private registered = false
    private disposed = false

    constructor(private readonly options: BrowserViewManagerOptions) {}

    async executeHiddenControlRequest(ownerWindow: BrowserWindow, request: BrowserSurfaceOpenRequest, signal?: AbortSignal) {
        const assertActive = () => {
            if (signal?.aborted) throw new AgentControlError('CONTROL_CANCELLED', 'The Browser request was cancelled.')
        }
        assertActive()
        if (request.reveal || !['open', 'navigate', 'refresh', 'close'].includes(request.mode || 'open')) throw new Error('This Browser command requires its visible workspace.')
        const threadId = normalizeThreadId(request.threadId)
        const principalThreadId = request.requestedBy.type === 'root' ? request.requestedBy.threadId : request.requestedBy.parentThreadId
        if (threadId !== principalThreadId || !isTrustedBrowserTabId(request.tabId)) throw new Error('Browser command ownership is invalid.')
        let record = this.records.get(request.tabId)
        if (!record) {
            if (request.mode !== 'open') throw new Error('The background Browser tab no longer exists.')
            const ownerId = this.options.resolveOwnerId(ownerWindow)
            if (!ownerId || ownerId.startsWith('accessory:') || ownerWindow.isDestroyed()) throw new Error('The Browser owner window is unavailable.')
            if (this.options.canUseBrowser?.() === false) throw new Error('Complete setup before using Browser.')
            record = this.createRecord({ tabId: request.tabId, threadId, sessionMode: normalizeSessionMode(request.sessionMode), ownerWindow, ownerId })
            record.view.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
            this.publishPresentation(record)
        }
        if (record.ownerWindow !== ownerWindow || record.threadId !== threadId) throw new Error('The Browser tab belongs to another owner.')
        record.agentOwned = true
        this.cancelRelease(record.tabId)
        await record.ready
        assertActive()
        const page = record.view.webContents
        const target = bindTrustedBrowserTarget(ownerWindow.webContents.id, page.id, record.tabId, threadId, record.sessionMode)
        if (target.kind !== 'zyra-browser' || (request.targetId && target.targetId !== request.targetId)) throw new Error('The Browser target changed.')
        assertActive()
        if (request.mode === 'close') {
            this.closeRecord(record)
        } else if (request.mode === 'navigate' || request.mode === 'refresh') {
            const generation = record.navigationGeneration + 1
            const abort = () => {
                if (!page.isDestroyed() && record!.navigationGeneration === generation) page.stop()
            }
            signal?.addEventListener('abort', abort, { once: true })
            try {
                await this.navigate(record, request.mode === 'refresh' ? page.getURL() : String(request.url || ''))
                assertActive()
            } catch (error) {
                assertActive()
                throw error
            } finally { signal?.removeEventListener('abort', abort) }
        }
        return target
    }

    observePresentation(observer: (presentation: BrowserViewPresentation) => void): () => void {
        this.presentationObservers.add(observer)
        for (const record of this.records.values()) observer(this.readPresentation(record))
        return () => this.presentationObservers.delete(observer)
    }

    private readPresentation(record: BrowserViewRecord): BrowserViewPresentation {
        const ownerWindow = record.ownerWindow.isDestroyed() ? null : record.ownerWindow
        const slot = ownerWindow ? this.slotsByOwner.get(ownerWindow.webContents.id)?.get(record.tabId) : undefined
        return {
            tabId: record.tabId,
            guestWebContents: record.view.webContents,
            ownerWindow,
            bounds: record.disposed ? null : slot?.bounds || null,
            visible: !record.disposed && Boolean(ownerWindow && slot?.active && slot.visible && slot.bounds),
            disposed: record.disposed
        }
    }

    private publishPresentation(record: BrowserViewRecord): void {
        const presentation = this.readPresentation(record)
        const bounds = record.view.getBounds()
        setManagedBrowserControlViewport(record.view.webContents, { width: bounds.width, height: bounds.height, visible: presentation.visible })
        for (const observer of this.presentationObservers) {
            try { observer(presentation) } catch (error) { log.warn('Browser presentation observer failed', error) }
        }
    }

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
        ipcMain.on(BROWSER_VIEW_IPC.refreshTheme, event => {
            try {
                const { window } = this.resolveSender(event)
                for (const record of this.records.values()) {
                    if (record.ownerWindow === window) void this.injectChromeWebStoreInstallControl(record)
                }
            } catch (error) {
                log.debug('[BrowserView] Could not refresh Web Store theme.', error)
            }
        })
    }

    async transferTo(tabId: string, destinationWindow: BrowserWindow, options: BrowserViewTransferOptions = {}): Promise<BrowserViewTransferResult> {
        if (this.disposed) throw new Error('The Browser view manager is closed.')
        if (!isTrustedBrowserTabId(tabId)) throw new Error('Browser tab identity is invalid.')
        if (destinationWindow.isDestroyed() || destinationWindow.webContents.isDestroyed()) throw new Error('The destination window is unavailable.')
        const destinationOwnerId = this.options.resolveOwnerId(destinationWindow)
        if (!destinationOwnerId) throw new Error('The destination is not a Browser-capable Zyra window.')
        this.observeWindow(destinationWindow)

        const record = this.records.get(tabId)
        if (!record || record.disposed) throw new Error('The live Browser source view is unavailable.')
        if (options.expectedSourceWindow && record.ownerWindow !== options.expectedSourceWindow) throw new Error('The Browser source window changed before transfer.')
        if (options.expectedSourceOwnerId && record.ownerId !== options.expectedSourceOwnerId) throw new Error('The Browser source owner changed before transfer.')
        if (options.expectedSessionMode && record.sessionMode !== options.expectedSessionMode) throw new Error('The Browser tab session mode does not match the transfer.')
        const destinationThreadId = options.destinationThreadId ? normalizeThreadId(options.destinationThreadId) : record.threadId
        if (destinationOwnerId.startsWith('accessory:') && destinationThreadId !== destinationOwnerId) {
            throw new Error('Accessory Browser destination ownership does not match this window.')
        }
        if (record.ownerWindow === destinationWindow) {
            if (record.threadId !== destinationThreadId) throw new Error('The Browser tab is already attached with another owner identity.')
            this.cancelRelease(tabId)
            this.applyCurrentSlot(record)
            return { tabId, guestWebContentsId: record.view.webContents.id, ownerId: record.ownerId }
        }
        const existing = this.pendingTransfers.get(tabId)
        if (existing) {
            if (existing.destinationWindow === destinationWindow && existing.destinationThreadId === destinationThreadId) return existing.promise
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
            sourceWindow: record.ownerWindow,
            sourceOwnerId: record.ownerId,
            sourceThreadId: record.threadId,
            sessionMode: record.sessionMode,
            destinationWindow,
            destinationOwnerId,
            destinationThreadId,
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
        this.presentationObservers.clear()
    }

    private async ensure(event: IpcMainInvokeEvent, input: BrowserViewEnsureInput): Promise<{ created: boolean; state: BrowserViewState }> {
        const { window, ownerId } = this.resolveSender(event)
        const tabId = String(input?.tabId || '')
        if (!isTrustedBrowserTabId(tabId)) throw new Error('Browser tab identity is invalid.')
        const threadId = normalizeThreadId(input?.threadId)
        if (ownerId.startsWith('accessory:') && threadId !== ownerId) {
            throw new Error('Accessory Browser ownership does not match this window.')
        }
        const sessionMode = normalizeSessionMode(input?.sessionMode)
        let existing = this.records.get(tabId)
        const pending = this.pendingTransfers.get(tabId)
        const isPendingDestination = pending?.destinationWindow === window
        if (existing && existing.threadId !== threadId && existing.ownerWindow === window) {
            this.closeRecord(existing)
            existing = undefined
        }
        if (existing) {
            if (existing.sessionMode !== sessionMode) throw new Error('An existing Browser tab cannot change between normal and incognito mode.')
            if (isPendingDestination) {
                if (pending!.sessionMode !== sessionMode || pending!.destinationThreadId !== threadId) {
                    throw new Error('The Browser transfer destination identity changed while preparing its slot.')
                }
            } else if (existing.threadId !== threadId) {
                throw new Error('The Browser tab belongs to another owner.')
            }
            if (existing.ownerWindow !== window && !isPendingDestination) {
                throw new Error('The Browser tab belongs to another Zyra window.')
            }
            this.cancelRelease(tabId)
            await existing.ready
            return { created: false, state: this.readState(existing) }
        }

        if (pending && pending.destinationWindow === window) {
            throw new Error('The live Browser source has not finished preparing its view.')
        }
        const record = this.createRecord({ tabId, threadId, sessionMode, ownerWindow: window, ownerId })
        await record.ready
        const initialUrl = String(input?.initialUrl || '').trim()
        if (sessionMode === 'normal') this.options.captureAnalytics?.({
            action: initialUrl ? 'tab_create' : 'new_tab',
            outcome: 'completed',
            destination: initialUrl ? classifyBrowserDestination(initialUrl) : 'blank'
        })
        if (initialUrl) setImmediate(() => {
            const currentUrl = record.view.webContents.getURL()
            if (record.disposed || (currentUrl && currentUrl !== 'about:blank')) return
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
            agentOwned: false,
            ready: Promise.resolve(),
            disposed: false
        }
        const page = view.webContents
        try {
            this.records.set(record.tabId, record)
            this.observeWindow(record.ownerWindow)
            addNativeWindowView(record.ownerWindow, view, 'browser')
            view.setBackgroundColor('#ffffff')
            view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
            view.setVisible(false)
            trustedBrowserGuests.register(record.ownerWindow.webContents.id, page)
            if (record.ownerId.startsWith('accessory:')) {
                // User browser tools need guest ownership, not an agent-control target or grant.
                trustedBrowserGuests.bind(record.ownerWindow.webContents.id, page.id, record.tabId, record.threadId, record.sessionMode)
            }
            registerManagedBrowserPresentation(page)
            registerBrowserPermissionTarget(page, record.ownerWindow.webContents)
            this.options.popupManager.registerGuest(record.ownerWindow, page, page.id)
            this.installPageLifecycle(record)
            this.applyCurrentSlot(record)
            // A new WebContentsView has no document yet. Start its blank document
            // before exposing it for control, and serialize the first navigation
            // behind initialization so it cannot race this internal load.
            record.ready = page.loadURL('about:blank').catch(error => {
                if (!record.disposed) this.closeRecord(record)
                throw error
            })
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
        page.on('update-target-url', (_event, url) => {
            this.publishEvent(record, { type: 'link-hover', tabId: record.tabId, url: /^https?:\/\//i.test(url) || /^(mailto:|tel:|file:)/i.test(url) || url.startsWith(`${BROWSER_LOCAL_FILE_SCHEME}:`) ? url.slice(0, 8192) : '' })
        })
        const pageSession = page.session
        page.on('focus', () => this.publishEvent(record, {
            type: 'focus',
            tabId: record.tabId,
            guestWebContentsId: page.id
        }))
        page.on('before-mouse-event', (_event, mouse) => {
            if (mouse.type !== 'mouseDown') return
            this.publishEvent(record, { type: 'focus', tabId: record.tabId, guestWebContentsId: page.id })
        })
        page.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
            if (isMainFrame) this.publishEvent(record, { type: 'link-hover', tabId: record.tabId, url: '' })
            // Install requests are intercepted in will-navigate, not document changes.
            if (!isMainFrame || url.startsWith('zyra-extension:') || url.startsWith('chrome-error:')) return
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
            if (url.startsWith('chrome-error:')) return
            record.url = url === 'about:blank' ? '' : url
            this.publishState(record, 'navigation')
        })
        page.on('did-navigate-in-page', (_event, url, isMainFrame) => {
            if (isMainFrame && !url.startsWith('chrome-error:')) {
                record.url = url === 'about:blank' ? '' : url
                this.publishState(record, 'navigation')
                void this.injectChromeWebStoreInstallControl(record)
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
            // Chromium can finish its internal error document after did-fail-load.
            // That document must not turn a failed site into a ready tab.
            if (record.mainFrameFailed) return
            record.mainFrameFailed = false
            record.status = page.getURL() === 'about:blank' ? 'idle' : 'ready'
            record.error = null
            this.publishState(record, 'navigation')
            if (record.reportedNavigationAttempt !== record.navigationAttempt) {
                record.reportedNavigationAttempt = record.navigationAttempt
                if (record.sessionMode === 'normal') this.options.captureAnalytics?.({ action: 'navigation', outcome: 'completed', destination: classifyBrowserDestination(page.getURL()), duration_ms: Date.now() - record.navigationStartedAt })
            }
            void this.applyControlOverlay(record)
            void this.injectChromeWebStoreInstallControl(record)
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
            if (isRecordingShortcut(record.ownerWindow.webContents)) return
            if (handleGuestAppShortcut(input, record.ownerWindow.webContents)) { event.preventDefault(); return }
            if (input.type === 'keyDown' && input.key === 'Escape' && record.ownerWindow.isFullScreen()) {
                event.preventDefault()
                record.ownerWindow.setFullScreen(false)
                return
            }
            const action = resolveBrowserShortcut(input, browserShortcutPlatform())
            if (!action) {
                if (resolveBrowserShortcut(input, browserShortcutPlatform(), {})) event.preventDefault()
                return
            }
            event.preventDefault()
            const payload: DevScopeBrowserShortcutEvent = { sourceGuestWebContentsId: page.id, action }
            if (!record.ownerWindow.isDestroyed()) record.ownerWindow.webContents.send(BROWSER_PREVIEW_SHORTCUT_CHANNEL, payload)
        })
        page.on('will-navigate', (event, url) => this.guardPageNavigation(record, event, url))
        page.on('will-redirect', (event, url) => this.guardPageNavigation(record, event, url, true))
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

    private guardPageNavigation(record: BrowserViewRecord, event: Electron.Event, url: string, redirect = false): void {
        if (url === 'about:blank') return
        if (url.startsWith('zyra-extension:')) {
            event.preventDefault()
            if (!redirect) void this.webStoreInstalls.get(record)?.request(url).catch(error => log.warn('[BrowserView] Web Store request failed.', error))
            return
        }
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
            if (record.status === 'error' && record.url) {
                void page.loadURL(record.url).catch(error => log.debug('[BrowserView] Failed page retry did not load.', error))
            } else page.reload()
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
            snapshotDataUrl = await captureBrowserTabPreview(page)
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
            if (record.controlOverlay.controlled) record.agentOwned = true
            await this.applyControlOverlay(record)
        } else {
            throw new Error('Browser command is invalid.')
        }
        return { accepted, state: this.readState(record), ...(snapshotDataUrl ? { snapshotDataUrl } : {}) }
    }

    private async applyControlOverlay(record: BrowserViewRecord): Promise<void> {
        if (record.disposed || record.view.webContents.isDestroyed()) return
        const code = browserControlOverlayScript(record.controlOverlay)
        await record.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }], false).catch((error) => {
            log.debug('[BrowserView] Could not update the native control overlay.', error)
        })
    }

    private async injectChromeWebStoreInstallControl(record: BrowserViewRecord): Promise<void> {
        const page = record.view.webContents
        if (record.disposed || page.isDestroyed()) return
        let install = this.webStoreInstalls.get(record)
        if (!install) {
            if (record.sessionMode !== 'normal' || !chromeWebStoreIdFromUrl(page.getURL())) return
            let presentationRevision = 0
            install = new BrowserWebStoreInstall({
                current: () => ({
                    url: page.isDestroyed() ? '' : page.getURL(),
                    document: record.navigationAttempt,
                    available: !record.disposed && !page.isDestroyed() && !record.ownerWindow.isDestroyed() && record.sessionMode === 'normal'
                }),
                installer: getBrowserExtensionManager(),
                present: async value => {
                    const revision = ++presentationRevision
                    if (record.disposed || page.isDestroyed()) return
                    // Read only the owning app renderer's theme, never colors supplied by the website.
                    const theme = await record.ownerWindow.webContents.executeJavaScript(`(() => {
                        const styles = getComputedStyle(document.documentElement);
                        return { accent: styles.getPropertyValue('--accent-primary').trim(),
                            background: styles.getPropertyValue('--color-card').trim(),
                            foreground: styles.getPropertyValue('--color-text').trim(),
                            fontFamily: getComputedStyle(document.body).fontFamily, colorScheme: styles.colorScheme };
                    })()`, false) as WebStoreInstallTheme
                    if (record.disposed || page.isDestroyed() || revision !== presentationRevision) return
                    const code = `(${renderWebStoreInstall.toString()})(${JSON.stringify(value)}, (${chromeWebStoreIdFromUrl.toString()}), ${JSON.stringify(theme)})`
                    await page.executeJavaScriptInIsolatedWorld(998, [{ code }], false).catch(error => log.debug('[BrowserView] Could not update the Web Store button.', error))
                },
                confirm: async review => {
                    const permissions = [...review.permissions, ...review.hostPermissions]
                    const result = await dialog.showMessageBox(record.ownerWindow, {
                        type: 'question', title: 'Add extension to Zyra?', message: `${review.name} v${review.version}`,
                        detail: [permissions.length ? `Requested permissions:\n${permissions.join('\n')}` : 'No declared permissions.', ...review.warnings, 'Only install extensions you trust. Some Chrome APIs may not work in Zyra.'].join('\n\n'),
                        buttons: ['Add to Zyra', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true
                    })
                    return result.response === 0
                },
                reportError: async message => {
                    if (!record.ownerWindow.isDestroyed()) await dialog.showMessageBox(record.ownerWindow, {
                        type: 'error', title: 'Extension not installed', message: 'Could not add this extension to Zyra.', detail: message.slice(0, 2000), buttons: ['OK']
                    })
                }
            })
            this.webStoreInstalls.set(record, install)
        }
        await install.refresh().catch(error => log.debug('[BrowserView] Could not prepare the Web Store button.', error))
    }

    private async navigate(record: BrowserViewRecord, rawUrl: string): Promise<boolean> {
        await record.ready
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
        if (record.ownerWindow !== pending.sourceWindow || record.ownerId !== pending.sourceOwnerId || record.threadId !== pending.sourceThreadId || record.sessionMode !== pending.sessionMode) {
            this.rejectTransfer(pending, new Error('The Browser source owner changed while preparing the destination.'))
            return
        }
        try {
            this.performTransfer(record, pending.destinationWindow, pending.destinationOwnerId, pending.destinationThreadId, slot)
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

    private performTransfer(record: BrowserViewRecord, destinationWindow: BrowserWindow, destinationOwnerId: string, destinationThreadId: string, slot: ReportedSlot): void {
        this.cancelRelease(record.tabId)
        if (record.ownerWindow === destinationWindow) {
            if (record.threadId !== destinationThreadId) throw new Error('The Browser destination owner identity does not match the live view.')
            this.applySlot(record, slot)
            return
        }
        const sourceWindow = record.ownerWindow
        const sourceOwnerId = record.ownerId
        const sourceThreadId = record.threadId
        const sourceWebContentsId = sourceWindow.webContents.id
        const destinationWebContentsId = destinationWindow.webContents.id
        const page = record.view.webContents
        assertBrowserPreviewDeveloperTransferable(page.id)

        record.view.setVisible(false)
        let viewRemovedFromSource = false
        let viewAddedToDestination = false
        let trustedOwnerMoved = false
        let permissionOwnerMoved = false
        let popupOwnerMoved = false
        let threatOwnerMoved = false
        let developerOwnerMoved = false
        const threatProtection = getBrowserThreatProtectionService()
        try {
            sourceWindow.contentView.removeChildView(record.view)
            viewRemovedFromSource = true
            addNativeWindowView(destinationWindow, record.view, 'browser')
            viewAddedToDestination = true
            record.ownerWindow = destinationWindow
            record.ownerId = destinationOwnerId
            record.threadId = destinationThreadId
            trustedOwnerMoved = true
            transferTrustedBrowserTargetOwner(page.id, sourceWebContentsId, destinationWebContentsId, destinationThreadId)
            permissionOwnerMoved = true
            transferBrowserPermissionTargetOwner(page, destinationWindow.webContents)
            popupOwnerMoved = true
            this.options.popupManager.transferGuestOwner(page.id, sourceWindow, destinationWindow)
            threatOwnerMoved = Boolean(threatProtection)
            threatProtection?.transferGuestOwner(page.id, sourceWebContentsId, destinationWebContentsId)
            developerOwnerMoved = true
            transferBrowserPreviewDeveloperOwner(page.id, sourceWebContentsId, destinationWebContentsId)
        } catch (error) {
            if (developerOwnerMoved) try { transferBrowserPreviewDeveloperOwner(page.id, destinationWebContentsId, sourceWebContentsId) } catch {}
            if (threatOwnerMoved) try { threatProtection?.transferGuestOwner(page.id, destinationWebContentsId, sourceWebContentsId) } catch {}
            if (popupOwnerMoved) try { this.options.popupManager.transferGuestOwner(page.id, destinationWindow, sourceWindow) } catch {}
            if (permissionOwnerMoved) try { transferBrowserPermissionTargetOwner(page, sourceWindow.webContents) } catch {}
            if (trustedOwnerMoved) try { transferTrustedBrowserTargetOwner(page.id, destinationWebContentsId, sourceWebContentsId, sourceThreadId) } catch {}
            record.ownerWindow = sourceWindow
            record.ownerId = sourceOwnerId
            record.threadId = sourceThreadId
            if (viewAddedToDestination) try { destinationWindow.contentView.removeChildView(record.view) } catch {}
            if (viewRemovedFromSource) addNativeWindowView(sourceWindow, record.view, 'browser')
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
            this.publishPresentation(record)
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
        this.publishPresentation(record)
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
        if (record.agentOwned || isManagedBrowserRetainedForAgent(record.view.webContents)) {
            this.slotsByOwner.get(ownerWindow.webContents.id)?.delete(record.tabId)
            record.view.setVisible(false)
            this.publishPresentation(record)
            return
        }
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
        this.publishPresentation(record)
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
        const rawUrl = (record.status === 'loading' || record.status === 'error') && record.url ? record.url : pageUrl || record.url
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
        const navigateActiveBrowser = (direction: 'back' | 'forward'): boolean => {
            const slots = this.slotsByOwner.get(ownerWebContentsId)
            const tabId = slots && [...slots.entries()].find(([, slot]) => slot.active && slot.visible && slot.bounds)?.[0]
            const record = tabId ? this.records.get(tabId) : null
            if (!record || record.disposed || record.ownerWindow !== window || !record.view.getVisible()) return false
            const history = record.view.webContents.navigationHistory
            if (direction === 'back' ? !history.canGoBack() : !history.canGoForward()) return false
            if (direction === 'back') history.goBack()
            else history.goForward()
            return true
        }
        window.on('app-command', (event, command) => {
            const direction = command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null
            if (direction && navigateActiveBrowser(direction)) event.preventDefault()
        })
        window.on('swipe', (event, direction) => {
            const historyDirection = direction === 'right' ? 'back' : direction === 'left' ? 'forward' : null
            if (historyDirection && navigateActiveBrowser(historyDirection)) event.preventDefault()
        })
        window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
            if (!isMainFrame || isInPlace) return
            this.slotsByOwner.delete(ownerWebContentsId)
            for (const record of this.records.values()) {
                if (record.ownerWindow !== window) continue
                record.view.setVisible(false)
                this.publishPresentation(record)
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
