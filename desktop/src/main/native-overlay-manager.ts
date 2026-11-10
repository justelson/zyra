import { prepareAppShortcutInput } from './keybindings'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, dialog, screen, type IpcMainInvokeEvent, type WebContents, type WebFrameMain, type WindowOpenHandlerResponse, type HandlerDetails } from 'electron'
import { ipcMain } from './ipc/trusted-ipc'
import { addNativeWindowView } from './native-view-layers'
import { NATIVE_OVERLAY_FRAME_PREFIX, NATIVE_OVERLAY_IPC as IPC, type NativeOverlayDismissReason, type NativeOverlayKind, type NativeOverlayVisibility, type NativeOverlayBounds } from '../shared/contracts/native-overlay'

type LinkActivation = {
    expiresAt: number
    frame: WebFrameMain
    target: Promise<string | null>
    resolvedTarget?: string | null
    mousePoint?: { x: number; y: number }
}
type OverlaySlot = {
    kind: NativeOverlayKind
    view: WebContentsView | null
    companion: BrowserWindow | null
    contents: WebContents | null
    frameName: string | null
    armedUntil: number
    frame: WebContents['mainFrame'] | null
    previewFrame: WebFrameMain | null
    linkActivation: LinkActivation | null
    revision: number
    visible: boolean
    focus: boolean
    bounds: NativeOverlayBounds | null
}
type Owner = {
    window: BrowserWindow
    contents: WebContents
    slots: Record<NativeOverlayKind, OverlaySlot>
    recovery: Promise<boolean> | null
    cancelRecovery: (() => void) | null
    dispose: () => void
}
const isKind = (kind: unknown): kind is NativeOverlayKind => kind === 'interactive' || kind === 'passive'
const createSlot = (kind: NativeOverlayKind): OverlaySlot => ({ kind, view: null, companion: null, contents: null, frameName: null, armedUntil: 0, frame: null, previewFrame: null, linkActivation: null, revision: -1, visible: false, focus: false, bounds: null })

const LINK_ACTIVATION_WINDOW_MS = 1_000
const LINK_CAPTURE_WORLD_ID = 1007

function sameFrame(left: WebFrameMain | null | undefined, right: WebFrameMain | null | undefined): boolean {
    return Boolean(left && right && left.processId === right.processId && left.routingId === right.routingId)
}

function isDeliverablePreviewLink(value: string): boolean {
    try { return ['zyra:', 'file:', 'http:', 'https:'].includes(new URL(value).protocol) }
    catch { return false }
}

function samePreviewDocument(target: string, source: string): boolean {
    try {
        const targetUrl = new URL(target)
        const sourceUrl = new URL(source)
        targetUrl.hash = ''
        sourceUrl.hash = ''
        return targetUrl.href === sourceUrl.href
    } catch { return false }
}

function isSameDocumentFragment(target: string, source: string): boolean {
    return target.includes('#') && samePreviewDocument(target, source)
}

function isInitialLocalHtmlPreviewNavigation(contents: WebContents, details: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): boolean {
    const frame = details.frame
    if (details.isMainFrame || !frame || frame.parent !== contents.mainFrame) return false
    if (frame.url && frame.url !== 'about:blank') return false
    try {
        const url = new URL(details.url)
        return url.protocol === 'zyra:' && url.searchParams.has('devscope-preview')
    } catch {
        return false
    }
}

/** Native portal documents share their trusted opener's React ownership, never its IPC authority. */
export class NativeOverlayManager {
    private readonly owners = new Map<number, Owner>()
    private watchingDisplays = false
    private readonly displayMetricsChanged = () => {
        for (const owner of this.owners.values()) for (const slot of Object.values(owner.slots)) this.resize(owner, slot)
    }

    constructor(private readonly options: { showRecoveryDialog?: (owner: BrowserWindow) => Promise<boolean> } = {}) {}

    registerIpc(): void {
        ipcMain.handle(IPC.prepare, (event, input: { kind?: unknown } | null) => {
            const owner = this.ownerFor(event)
            if (!owner || !isKind(input?.kind)) return { success: false, error: 'This window cannot open an app overlay.' }
            const slot = owner.slots[input.kind]
            if (!slot.contents) {
                slot.frameName = NATIVE_OVERLAY_FRAME_PREFIX + input.kind + '-' + randomUUID()
                slot.armedUntil = Date.now() + 5_000
                slot.frame = event.sender.mainFrame
            }
            return { success: true, frameName: slot.frameName }
        })
        ipcMain.handle(IPC.visibility, (event, input: NativeOverlayVisibility) => {
            const owner = this.ownerFor(event)
            if (!owner || !input || !isKind(input.kind)) return { success: false }
            const slot = owner.slots[input.kind]
            if (!slot.contents || input.frameName !== slot.frameName || typeof input.visible !== 'boolean'
                || !Number.isSafeInteger(input.revision) || input.revision < 0
                || input.revision <= slot.revision) return { success: false }
            if (input.bounds != null && (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(input.bounds?.[key as keyof NativeOverlayBounds]))
                || input.bounds.width < 0 || input.bounds.height < 0)) return { success: false }
            slot.bounds = input.bounds ?? null
            slot.revision = input.revision
            slot.visible = input.visible
            slot.focus = input.focus === true
            this.present(owner, slot)
            const applied = slot.visible && slot.bounds && slot.view ? slot.view.getBounds() : null
            const zoom = owner.contents.getZoomFactor()
            return { success: true, bounds: applied ? { x: applied.x / zoom, y: applied.y / zoom, width: applied.width / zoom, height: applied.height / zoom } : null }
        })
        ipcMain.handle(IPC.recover, async (event, input: { kind?: unknown } | null) => {
            const owner = this.ownerFor(event)
            if (!owner || !isKind(input?.kind)) return { success: false }
            const recoveryFrameName = owner.slots[input.kind].frameName
            if (!owner.recovery) {
                const cancelled = new Promise<boolean>(resolve => { owner.cancelRecovery = () => resolve(false) })
                const show = this.options.showRecoveryDialog
                    ? this.options.showRecoveryDialog(owner.window)
                    : dialog.showMessageBox(owner.window, {
                        type: 'error', title: 'Zyra', message: 'App controls could not open.',
                        detail: 'Try opening them again.', buttons: ['Retry', 'Close'], defaultId: 0, cancelId: 1
                    }).then(result => result.response === 0)
                owner.recovery = Promise.race([show.catch(() => false), cancelled]).finally(() => {
                    owner.recovery = null
                    owner.cancelRecovery = null
                })
            }
            const retry = await owner.recovery
            if (retry && !owner.window.isDestroyed() && owner.slots[input.kind].frameName === recoveryFrameName) this.closeSlot(owner, owner.slots[input.kind], true)
            return { success: true, retry: retry && !owner.window.isDestroyed() }
        })
    }

    registerOwner(window: BrowserWindow): void {
        if (this.owners.has(window.webContents.id)) return
        if (!this.watchingDisplays) { screen.on('display-metrics-changed', this.displayMetricsChanged); this.watchingDisplays = true }
        const contents = window.webContents
        const owner: Owner = { window, contents, slots: { interactive: createSlot('interactive'), passive: createSlot('passive') }, recovery: null, cancelRecovery: null, dispose: () => {} }
        this.owners.set(contents.id, owner)
        const resize = () => { for (const slot of Object.values(owner.slots)) this.resize(owner, slot) }
        const focus = () => { for (const slot of Object.values(owner.slots)) this.present(owner, slot) }
        const blur = () => {
            for (const slot of Object.values(owner.slots)) {
                this.present(owner, slot, false)
                if (slot.visible) this.notify(owner, slot, 'blur')
            }
        }
        const reset = () => {
            owner.cancelRecovery?.()
            for (const slot of Object.values(owner.slots)) { this.closeSlot(owner, slot, true); slot.revision = -1 }
        }
        const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) reset() }
        const destroyed = () => {
            owner.cancelRecovery?.()
            owner.dispose()
            this.owners.delete(contents.id)
            for (const slot of Object.values(owner.slots)) this.closeSlot(owner, slot, false)
        }
        window.on('resize', resize)
        window.on('move', resize)
        window.on('focus', focus)
        window.on('blur', blur)
        window.on('hide', blur)
        window.on('minimize', blur)
        window.once('closed', destroyed)
        contents.on('did-start-navigation', navigation)
        contents.on('render-process-gone', reset)
        contents.on('zoom-changed', resize)
        contents.once('destroyed', destroyed)
        owner.dispose = () => {
            window.removeListener('resize', resize)
            window.removeListener('move', resize)
            window.removeListener('focus', focus)
            window.removeListener('blur', blur)
            window.removeListener('hide', blur)
            window.removeListener('minimize', blur)
            window.removeListener('closed', destroyed)
            contents.removeListener('did-start-navigation', navigation)
            contents.removeListener('render-process-gone', reset)
            contents.removeListener('zoom-changed', resize)
            contents.removeListener('destroyed', destroyed)
        }
    }

    /** Null leaves ordinary popups with the existing external/browser routing. */
    handleWindowOpen(window: BrowserWindow, details: HandlerDetails): WindowOpenHandlerResponse | null {
        if (!details.frameName.startsWith(NATIVE_OVERLAY_FRAME_PREFIX)) return null
        const owner = this.owners.get(window.webContents.id)
        const slot = owner && Object.values(owner.slots).find(entry => entry.frameName === details.frameName)
        if (!owner || !slot || owner.window !== window || slot.contents || owner.contents.isDestroyed()
            || details.url !== 'about:blank' || slot.armedUntil < Date.now()
            || slot.frame !== owner.contents.mainFrame) return { action: 'deny' }
        slot.armedUntil = 0
        return {
            action: 'allow', outlivesOpener: false,
            createWindow: options => {
                // Electron's custom-window contract passes the window.open WebContents
                // in options (documented in its example, omitted from its options type).
                const supplied = (options as typeof options & { webContents?: WebContents }).webContents
                if (!supplied || window.isDestroyed() || owner.contents.isDestroyed() || slot.contents) {
                    throw new Error('The app overlay owner closed before creation.')
                }
                if (slot.kind === 'interactive') {
                    const view = new WebContentsView({ webContents: supplied, webPreferences: options.webPreferences })
                    slot.view = view
                    slot.contents = view.webContents
                    slot.contents.setBackgroundThrottling(false)
                    view.setBackgroundColor('#00000000')
                    view.setVisible(false)
                    addNativeWindowView(window, view, 'overlay')
                } else {
                    // A WebContentsView cannot ignore native mouse input.
                    const companion = new BrowserWindow({ ...options, parent: window, show: false,
                        // Disable Windows' native show animation; the preview owns its vertical motion.
                        frame: false, thickFrame: false, transparent: true, backgroundColor: '#00000000',
                        focusable: false, skipTaskbar: true, hasShadow: false, resizable: false,
                        minimizable: false, maximizable: false, fullscreenable: false, title: 'Zyra overlay' })
                    if (companion.webContents !== supplied) {
                        companion.destroy()
                        throw new Error('Electron did not adopt the passive overlay document.')
                    }
                    slot.companion = companion
                    slot.contents = companion.webContents
                    companion.setMenu(null)
                    companion.setIgnoreMouseEvents(true, { forward: true })
                }
                this.resize(owner, slot)
                // Present the empty click-through host before React inserts hover content.
                // Subsequent hovers animate their own content, never a Windows window.
                if (slot.companion) this.present(owner, slot)
                const contents = slot.contents
                contents.setWindowOpenHandler(details => {
                    void this.deliverActivatedLink(owner, slot, contents, details.url, slot.previewFrame)
                    return { action: 'deny' }
                })
                contents.on('before-mouse-event', (event, mouse) => {
                    const frame = slot.previewFrame
                    if (!frame || frame.isDestroyed() || mouse.button !== 'left') return
                    if (mouse.type === 'mouseDown') {
                        const activation: LinkActivation = {
                            expiresAt: Date.now() + LINK_ACTIVATION_WINDOW_MS,
                            frame,
                            target: this.captureMouseLink(contents, frame, mouse.x, mouse.y),
                            mousePoint: { x: mouse.x, y: mouse.y }
                        }
                        void activation.target.then(value => { activation.resolvedTarget = value })
                        slot.linkActivation = activation
                        return
                    }
                    const activation = slot.linkActivation
                    if (mouse.type !== 'mouseUp' || !activation?.mousePoint) return
                    if (Math.abs(activation.mousePoint.x - mouse.x) > 4 || Math.abs(activation.mousePoint.y - mouse.y) > 4) {
                        slot.linkActivation = null
                        return
                    }
                    if (activation.resolvedTarget === undefined) {
                        this.finishDelayedActivation(owner, slot, contents, activation)
                        return
                    }
                    slot.linkActivation = null
                    if (!activation.resolvedTarget || isSameDocumentFragment(activation.resolvedTarget, activation.frame.url)) return
                    event.preventDefault()
                    if (isDeliverablePreviewLink(activation.resolvedTarget)) this.emitActivatedLink(owner, slot, contents, activation, activation.resolvedTarget)
                })
                contents.on('before-input-event', (event, input) => {
                    prepareAppShortcutInput(contents, input, owner.contents)
                    const frame = slot.previewFrame
                    if (!frame || frame.isDestroyed() || input.key !== 'Enter' || !sameFrame(contents.focusedFrame, frame)) return
                    if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !input.isAutoRepeat) {
                        const activation: LinkActivation = {
                            expiresAt: Date.now() + LINK_ACTIVATION_WINDOW_MS,
                            frame,
                            target: this.captureFocusedLink(frame)
                        }
                        void activation.target.then(value => { activation.resolvedTarget = value })
                        slot.linkActivation = activation
                        return
                    }
                    const activation = slot.linkActivation
                    if (input.type !== 'keyUp' || !activation) return
                    if (activation.resolvedTarget === undefined) {
                        this.finishDelayedActivation(owner, slot, contents, activation)
                        return
                    }
                    slot.linkActivation = null
                    if (!activation.resolvedTarget || isSameDocumentFragment(activation.resolvedTarget, activation.frame.url)) return
                    event.preventDefault()
                    if (isDeliverablePreviewLink(activation.resolvedTarget)) this.emitActivatedLink(owner, slot, contents, activation, activation.resolvedTarget)
                })
                contents.on('will-navigate', event => event.preventDefault())
                contents.on('will-frame-navigate', event => {
                    if (isInitialLocalHtmlPreviewNavigation(contents, event)) {
                        slot.previewFrame = event.frame
                        event.frame?.once('dom-ready', () => { void this.installDangerousLinkGuard(slot, contents, event.frame) })
                        return
                    }
                    event.preventDefault()
                    void this.deliverActivatedLink(owner, slot, contents, event.url, event.frame, event.initiator)
                })
                contents.on('will-attach-webview', event => event.preventDefault())
                contents.on('content-bounds-updated', event => event.preventDefault())
                const lost = () => { if (slot.contents === contents) this.closeSlot(owner, slot, true) }
                contents.once('render-process-gone', lost)
                contents.once('destroyed', lost)
                return contents
            }
        }
    }

    private async captureMouseLink(contents: WebContents, frame: WebFrameMain, x: number, y: number): Promise<string | null> {
        const bounds = await contents.executeJavaScriptInIsolatedWorld(LINK_CAPTURE_WORLD_ID, [{ code: `(() => {
            const point = { x: ${JSON.stringify(x)}, y: ${JSON.stringify(y)} };
            const element = document.elementFromPoint(point.x, point.y);
            if (element?.tagName !== 'IFRAME') return null;
            const rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            return { x: point.x - rect.left, y: point.y - rect.top, src: element.src };
        })()` }], false).catch(() => null) as { x: number; y: number; src: string } | null
        if (!bounds || frame.isDestroyed() || !samePreviewDocument(bounds.src, frame.url)) return null
        return this.captureFrameLink(frame, `document.elementFromPoint(${JSON.stringify(bounds.x)}, ${JSON.stringify(bounds.y)})`)
    }

    private captureFocusedLink(frame: WebFrameMain): Promise<string | null> {
        return this.captureFrameLink(frame, 'document.activeElement')
    }

    private async captureFrameLink(frame: WebFrameMain, elementExpression: string): Promise<string | null> {
        if (frame.isDestroyed()) return null
        const value = await frame.executeJavaScript(`(() => {
            const element = ${elementExpression};
            const anchor = element?.closest?.('a[href]');
            if (!anchor || anchor.hasAttribute('download')) return null;
            try { return new URL(anchor.getAttribute('href'), document.baseURI).href; } catch { return null; }
        })()`, false).catch(() => null)
        return typeof value === 'string' ? value : null
    }

    private async installDangerousLinkGuard(slot: OverlaySlot, contents: WebContents, frame: WebFrameMain | null): Promise<void> {
        if (!frame || frame.isDestroyed() || slot.contents !== contents || !sameFrame(slot.previewFrame, frame)) return
        await frame.executeJavaScript(`(() => {
            document.addEventListener('click', event => {
                const anchor = event.target?.closest?.('a[href]');
                if (!anchor) return;
                let protocol = '';
                try { protocol = new URL(anchor.getAttribute('href'), document.baseURI).protocol; } catch {}
                if (!['zyra:', 'file:', 'http:', 'https:'].includes(protocol)) event.preventDefault();
            }, true);
        })()`, false).catch(() => undefined)
    }

    private finishDelayedActivation(owner: Owner, slot: OverlaySlot, contents: WebContents, activation: LinkActivation): void {
        void activation.target.then(target => {
            // Normal browser navigation may already have consumed this gesture.
            if (slot.linkActivation !== activation) return
            slot.linkActivation = null
            if (!target || activation.frame.isDestroyed() || isSameDocumentFragment(target, activation.frame.url)) return
            if (isDeliverablePreviewLink(target)) this.emitActivatedLink(owner, slot, contents, activation, target)
        }).catch(() => { if (slot.linkActivation === activation) slot.linkActivation = null })
    }

    private emitActivatedLink(owner: Owner, slot: OverlaySlot, contents: WebContents, activation: LinkActivation, targetUrl: string): void {
        if (Date.now() > activation.expiresAt || owner.contents.isDestroyed() || owner.window.isDestroyed()
            || slot.contents !== contents || !sameFrame(slot.previewFrame, activation.frame) || activation.frame.isDestroyed()) return
        owner.contents.send(IPC.linkActivated, {
            kind: 'interactive',
            frameName: slot.frameName,
            sourceUrl: activation.frame.url,
            targetUrl
        })
    }

    private async deliverActivatedLink(owner: Owner, slot: OverlaySlot, contents: WebContents, targetUrl: string, frame: WebFrameMain | null, initiator?: WebFrameMain | null): Promise<void> {
        const activation = slot.linkActivation
        slot.linkActivation = null
        if (!activation || Date.now() > activation.expiresAt || !sameFrame(frame, activation.frame)
            || (initiator && !sameFrame(initiator, activation.frame))) return
        const capturedTarget = await activation.target
        if (!capturedTarget || capturedTarget !== targetUrl || !isDeliverablePreviewLink(capturedTarget)) return
        this.emitActivatedLink(owner, slot, contents, activation, capturedTarget)
    }

    private ownerFor(event: IpcMainInvokeEvent): Owner | undefined {
        const owner = this.owners.get(event.sender.id)
        return owner && owner.contents === event.sender && !owner.window.isDestroyed()
            && event.senderFrame === event.sender.mainFrame ? owner : undefined
    }

    private resize(owner: Owner, slot: OverlaySlot): void {
        if (!slot.contents || owner.window.isDestroyed()) return
        const bounds = owner.window.getContentBounds()
        const zoom = owner.contents.getZoomFactor()
        slot.contents.setZoomFactor(zoom)
        const region = slot.bounds
        const x = region ? Math.max(0, Math.min(bounds.width, Math.floor(region.x * zoom))) : 0
        const y = region ? Math.max(0, Math.min(bounds.height, Math.floor(region.y * zoom))) : 0
        const right = region ? Math.max(x, Math.min(bounds.width, Math.ceil((region.x + region.width) * zoom))) : bounds.width
        const bottom = region ? Math.max(y, Math.min(bounds.height, Math.ceil((region.y + region.height) * zoom))) : bounds.height
        slot.view?.setBounds({ x, y, width: right - x, height: bottom - y })
        slot.companion?.setBounds(bounds, false)
    }

    private present(owner: Owner, slot: OverlaySlot, allowed = owner.window.isFocused() && owner.window.isVisible() && !owner.window.isMinimized()): void {
        const focusRequested = slot.focus
        // An explicit open may focus once. Bounds changes, streamed layout and
        // later owner focus events never renew that request.
        slot.focus = false
        if (!slot.contents || slot.contents.isDestroyed()) return
        const visible = slot.visible && (slot.kind === 'interactive' || allowed)
        if (visible) this.resize(owner, slot)
        if (slot.view) {
            if (visible) addNativeWindowView(owner.window, slot.view, 'overlay')
            const changed = slot.view.getVisible() !== visible
            const heldFocus = slot.contents.isFocused()
            if (changed) slot.view.setVisible(visible)
            if (visible && focusRequested && allowed && !slot.contents.isFocused()) slot.contents.focus()
            else if (changed && !visible && heldFocus && allowed && !owner.contents.isDestroyed()) owner.contents.focus()
        } else if (slot.companion) {
            // React removes passive content when its lease ends. Keep that transparent,
            // non-focusable host stable until the owner itself loses visibility/focus.
            if (allowed && !slot.companion.isVisible()) {
                this.resize(owner, slot)
                slot.companion.showInactive()
            } else if (!allowed && slot.companion.isVisible()) slot.companion.hide()
        }
    }

    private notify(owner: Owner, slot: OverlaySlot, reason: NativeOverlayDismissReason, frameName = slot.frameName): void {
        if (frameName && !owner.contents.isDestroyed()) owner.contents.send(IPC.dismissed, { kind: slot.kind, frameName, reason })
    }

    private closeSlot(owner: Owner, slot: OverlaySlot, notify: boolean): void {
        const { view, companion, contents, frameName } = slot
        slot.view = null
        slot.companion = null
        slot.contents = null
        slot.frameName = null
        slot.frame = null
        slot.previewFrame = null
        slot.linkActivation = null
        slot.armedUntil = 0
        slot.bounds = null
        slot.visible = false
        // Keep revisions across child loss; an old queued show must not revive it.
        if (view && !owner.window.isDestroyed()) owner.window.contentView.removeChildView(view)
        if (companion && !companion.isDestroyed()) companion.destroy()
        else if (contents && !contents.isDestroyed()) contents.close()
        if (contents && notify) this.notify(owner, slot, 'closed', frameName)
    }

    dispose(): void {
        if (this.watchingDisplays) screen.removeListener('display-metrics-changed', this.displayMetricsChanged)
        this.watchingDisplays = false
        ipcMain.removeHandler(IPC.prepare)
        ipcMain.removeHandler(IPC.visibility)
        ipcMain.removeHandler(IPC.recover)
        for (const owner of this.owners.values()) {
            owner.cancelRecovery?.()
            owner.dispose()
            for (const slot of Object.values(owner.slots)) this.closeSlot(owner, slot, false)
        }
        this.owners.clear()
    }
}
