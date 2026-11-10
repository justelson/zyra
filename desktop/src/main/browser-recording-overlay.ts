import { ipcMain as rawIpcMain, WebContentsView, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { ipcMain as trustedIpcMain } from './ipc/trusted-ipc'
import { addNativeWindowView } from './native-view-layers'
import { trustedBrowserGuests } from './agent-control/trusted-guest-registry'
import type { BrowserViewManager, BrowserViewPresentation } from './browser-view-manager'
import { buildBrowserRecordingOverlayDocument } from './browser-recording-overlay-document'
import { BROWSER_RECORDING_OVERLAY_PRELOAD_ARGUMENT } from '../shared/preload-surfaces'
import { BROWSER_RECORDING_OVERLAY_IPC as IPC, isBrowserRecordingOverlayCommand, type BrowserRecordingOverlayState } from '../shared/contracts/browser-recording-overlay'

type Overlay = {
    owner: WebContents
    view: WebContentsView
    contents: WebContents
    host: BrowserWindow | null
    state: BrowserRecordingOverlayState
    width: number
    height: number
    loaded: boolean
    bounds: Electron.Rectangle | null
    visible: boolean
    error: string | null
    lastPresentation: string
    disposeOwner: () => void
}

/** A small trusted surface above the guest, never part of the captured page. */
export class BrowserRecordingOverlayManager {
    private readonly overlays = new Map<number, Overlay>()
    private readonly presentations = new Map<number, BrowserViewPresentation>()
    private readonly unsubscribe: () => void

    constructor(private readonly options: { browserViews: Pick<BrowserViewManager, 'observePresentation'>; preloadPath: string }) {
        this.unsubscribe = options.browserViews.observePresentation(presentation => {
            const id = presentation.guestWebContents.id
            if (presentation.disposed) this.presentations.delete(id)
            else this.presentations.set(id, presentation)
            for (const overlay of this.overlays.values()) {
                if (overlay.state.target.guestWebContentsId === id) this.present(overlay)
            }
        })
    }

    registerIpc() {
        trustedIpcMain.handle(IPC.update, (event, state: BrowserRecordingOverlayState | null) => {
            try { this.update(event.sender, state); return { success: true } }
            catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Recording controls could not open.' } }
        })
        // Only this manager's sandboxed control view receives these four capabilities.
        rawIpcMain.handle(IPC.read, event => this.fromOverlay(event)?.state || null)
        rawIpcMain.on(IPC.action, this.onAction)
        rawIpcMain.on(IPC.resize, this.onResize)
    }

    private fromOverlay(event: IpcMainEvent | IpcMainInvokeEvent): Overlay | undefined {
        const overlay = [...this.overlays.values()].find(entry => entry.contents.id === event.sender.id)
        if (!overlay || event.senderFrame !== event.sender.mainFrame || overlay.owner.isDestroyed()) return undefined
        return overlay
    }

    private readonly onAction = (event: IpcMainEvent, command: unknown) => {
        const overlay = this.fromOverlay(event)
        if (!overlay || !isBrowserRecordingOverlayCommand(command)) return
        if (command.kind === 'start') {
            const presentation = this.presentations.get(overlay.state.target.guestWebContentsId)
            if (overlay.state.status !== 'ready' || presentation?.ownerWindow?.webContents.id !== overlay.owner.id) return
        }
        if (command.kind === 'audio' && command.source === 'system' && !overlay.state.systemAudioSupported) return
        if (command.kind === 'audio' && command.source === 'tab' && !overlay.state.tabAudioSupported) return
        overlay.owner.send(IPC.command, command)
    }

    private readonly onResize = (event: IpcMainEvent, size: unknown) => {
        const overlay = this.fromOverlay(event)
        if (!overlay || !size || typeof size !== 'object') return
        const { width, height } = size as Record<string, unknown>
        if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return
        const nextWidth = Math.max(120, Math.min(440, Math.ceil(width)))
        const nextHeight = Math.max(48, Math.min(340, Math.ceil(height)))
        if (overlay.width === nextWidth && overlay.height === nextHeight) return
        overlay.width = nextWidth
        overlay.height = nextHeight
        this.present(overlay)
    }

    private update(owner: WebContents, state: BrowserRecordingOverlayState | null) {
        let overlay = this.overlays.get(owner.id)
        if (!state) { if (overlay) this.destroy(overlay); return }
        if (!state.target || !['ready', 'starting', 'recording', 'paused', 'stopping', 'saved', 'error'].includes(state.status)) {
            throw new Error('Invalid recording controls state.')
        }
        const fontChanged = state.theme.fontCss !== undefined && state.theme.fontCss !== overlay?.state.theme.fontCss
        if (state.theme.fontCss === undefined && overlay?.state.theme.fontCss !== undefined) state = { ...state, theme: { ...state.theme, fontCss: overlay.state.theme.fontCss } }
        const sameTarget = overlay?.state.target.guestWebContentsId === state.target.guestWebContentsId
            && overlay.state.target.tabId === state.target.tabId
        // Once bound, recording controls may follow a transferred tab or finish saving
        // after that tab closes. A different target must establish ownership again.
        if (!sameTarget) trustedBrowserGuests.resolveOwned(owner.id, state.target.guestWebContentsId, state.target.tabId)
        if (overlay && !sameTarget) { this.destroy(overlay); overlay = undefined }
        if (!overlay) {
            const view = new WebContentsView({ webPreferences: {
                preload: this.options.preloadPath,
                additionalArguments: [BROWSER_RECORDING_OVERLAY_PRELOAD_ARGUMENT],
                partition: 'zyra-recording-controls',
                sandbox: true, contextIsolation: true, nodeIntegration: false,
                webSecurity: true, backgroundThrottling: false
            } })
            view.setBackgroundColor('#00000000')
            view.setVisible(false)
            view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
            view.webContents.session.setPermissionCheckHandler(() => false)
            view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
            view.webContents.on('will-navigate', event => event.preventDefault())
            const current: Overlay = { owner, view, contents: view.webContents, host: null, state, width: 260, height: 62, loaded: false, bounds: null, visible: false, error: null, lastPresentation: '', disposeOwner: () => {} }
            const onOwnerClosed = () => this.destroy(current)
            owner.once('destroyed', onOwnerClosed)
            owner.once('render-process-gone', onOwnerClosed)
            current.disposeOwner = () => {
                owner.removeListener('destroyed', onOwnerClosed)
                owner.removeListener('render-process-gone', onOwnerClosed)
            }
            this.overlays.set(owner.id, current)
            const failed = () => {
                if (this.overlays.get(owner.id) !== current) return
                current.error = 'Recording controls could not open. Your recording is still available.'
                current.loaded = false
                this.present(current)
            }
            view.webContents.once('render-process-gone', failed)
            view.webContents.once('did-finish-load', () => {
                if (this.overlays.get(owner.id) !== current) return
                current.loaded = true
                view.webContents.send(IPC.state, current.state)
                this.present(current)
            })
            void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildBrowserRecordingOverlayDocument())}`)
                .catch(failed)
            overlay = current
        }
        overlay.state = state
        if (overlay.loaded && !overlay.contents.isDestroyed()) overlay.contents.send(IPC.state, { ...state, theme: { ...state.theme, fontCss: fontChanged ? state.theme.fontCss : undefined } })
        this.present(overlay)
    }

    private present(overlay: Overlay) {
        const presentation = this.presentations.get(overlay.state.target.guestWebContentsId)
        const setupTransferred = overlay.state.status === 'ready' && presentation?.ownerWindow?.webContents.id !== overlay.owner.id
        const host = presentation?.ownerWindow || null
        const bounds = presentation?.bounds
        if (overlay.host !== host) {
            if (overlay.host && !overlay.host.isDestroyed()) overlay.host.contentView.removeChildView(overlay.view)
            overlay.host = host
        }
        const publish = () => {
            const next = { target: overlay.state.target, visible: overlay.visible, targetGone: !presentation || setupTransferred, error: overlay.error }
            const key = JSON.stringify(next)
            if (key === overlay.lastPresentation || overlay.owner.isDestroyed()) return
            overlay.lastPresentation = key
            overlay.owner.send(IPC.presentation, next)
        }
        const setVisible = (visible: boolean) => {
            if (overlay.visible === visible) return
            overlay.visible = visible
            if (!overlay.contents.isDestroyed()) overlay.view.setVisible(visible)
        }
        if (overlay.error || setupTransferred || !host || host.isDestroyed() || !bounds || !presentation?.visible || bounds.width < 120 || bounds.height < 48) {
            setVisible(false)
            publish()
            return
        }
        const inset = Math.min(12, Math.max(0, (bounds.width - 120) / 2))
        const width = Math.min(overlay.width, Math.floor(bounds.width - inset * 2))
        const height = Math.min(overlay.height, Math.floor(bounds.height - 8))
        const nextBounds = { x: Math.round(bounds.x + (bounds.width - width) / 2), y: Math.round(bounds.y + 8), width, height }
        if (!overlay.bounds || Object.keys(nextBounds).some(key => nextBounds[key as keyof typeof nextBounds] !== overlay.bounds?.[key as keyof typeof nextBounds])) {
            overlay.bounds = nextBounds
            overlay.view.setBounds(nextBounds)
        }
        addNativeWindowView(host, overlay.view, 'recording')
        setVisible(overlay.loaded)
        publish()
    }

    private destroy(overlay: Overlay) {
        if (this.overlays.get(overlay.owner.id) !== overlay) return
        this.overlays.delete(overlay.owner.id)
        overlay.disposeOwner()
        if (overlay.host && !overlay.host.isDestroyed()) overlay.host.contentView.removeChildView(overlay.view)
        if (!overlay.contents.isDestroyed()) overlay.contents.close()
    }

    dispose() {
        this.unsubscribe()
        for (const overlay of [...this.overlays.values()]) this.destroy(overlay)
        trustedIpcMain.removeHandler(IPC.update)
        rawIpcMain.removeHandler(IPC.read)
        rawIpcMain.removeListener(IPC.action, this.onAction)
        rawIpcMain.removeListener(IPC.resize, this.onResize)
    }
}
