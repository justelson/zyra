import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getBrowserExtensionManager } from '../../browser-extension-manager'

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) throw new Error('The Zyra settings window is unavailable.')
    return window
}

export async function handleListBrowserExtensions(_event: IpcMainInvokeEvent) {
    try { return { success: true as const, extensions: await getBrowserExtensionManager().list() } }
    catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not list Browser extensions.' } }
}

export async function handleInstallBrowserExtension(event: IpcMainInvokeEvent) {
    try { return { success: true as const, extension: await getBrowserExtensionManager().chooseAndInstall(ownerWindow(event)) } }
    catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not install the Browser extension.' } }
}

export async function handleInspectBrowserExtensionFromWebStore(_event: IpcMainInvokeEvent, input: { urlOrId?: string }) {
    try {
        if (typeof input?.urlOrId !== 'string') throw new Error('A Chrome Web Store URL or extension ID is required.')
        return { success: true as const, extension: await getBrowserExtensionManager().inspectWebStore(input.urlOrId) }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not inspect the Chrome Web Store extension.' } }
}

export async function handleApproveBrowserExtensionFromWebStore(_event: IpcMainInvokeEvent, id: string) {
    try {
        if (typeof id !== 'string' || !id) throw new Error('Invalid extension review.')
        return { success: true as const, extension: await getBrowserExtensionManager().approveWebStore(id) }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not install the approved extension.' } }
}

export async function handleDiscardBrowserExtensionFromWebStore(_event: IpcMainInvokeEvent, id: string) {
    try {
        if (typeof id !== 'string' || !id) throw new Error('Invalid extension review.')
        await getBrowserExtensionManager().discardWebStore(id)
        return { success: true as const, discarded: true }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not discard the extension review.' } }
}

export async function handleSetBrowserExtensionEnabled(_event: IpcMainInvokeEvent, input: { id?: string; enabled?: boolean }) {
    try {
        if (typeof input?.id !== 'string' || typeof input?.enabled !== 'boolean') throw new Error('Invalid Browser extension selection.')
        return { success: true as const, extension: await getBrowserExtensionManager().setEnabled(input.id, input.enabled) }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not update the Browser extension.' } }
}

export async function handleRemoveBrowserExtension(_event: IpcMainInvokeEvent, id: string) {
    try {
        if (typeof id !== 'string' || !id) throw new Error('Invalid Browser extension selection.')
        await getBrowserExtensionManager().remove(id)
        return { success: true as const, removed: true }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not remove the Browser extension.' } }
}

export async function handleReloadBrowserExtension(_event: IpcMainInvokeEvent, id: string) {
    try {
        if (typeof id !== 'string' || !id) throw new Error('Invalid Browser extension selection.')
        return { success: true as const, extension: await getBrowserExtensionManager().reload(id) }
    } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Could not reload the Browser extension.' } }
}

export async function handleOpenBrowserExtensionPopup(event: IpcMainInvokeEvent, id: string) {
    let popup: BrowserWindow | undefined
    try {
        const owner = ownerWindow(event)
        const action = getBrowserExtensionManager().actionPopup(id)
        if (!action) throw new Error('This extension has no available popup.')
        const bounds = owner.getContentBounds()
        const width = Math.min(380, bounds.width)
        popup = new BrowserWindow({
            parent: owner, width, height: Math.min(510, bounds.height),
            x: bounds.x + bounds.width - width, y: bounds.y + 64,
            show: false, frame: false, skipTaskbar: true, fullscreenable: false,
            webPreferences: { session: action.session, sandbox: true, contextIsolation: true, nodeIntegration: false }
        })
        popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        const restrictNavigation = (e: Electron.Event, target: string) => {
            const url = new URL(target)
            if (url.protocol !== action.url.protocol || url.host !== action.url.host) e.preventDefault()
        }
        popup.webContents.on('will-navigate', restrictNavigation)
        popup.webContents.on('will-redirect', restrictNavigation)
        await popup.loadURL(action.url.href)
        popup.once('blur', () => popup?.close())
        popup.show()
        return { success: true as const }
    } catch (error) {
        popup?.destroy()
        return { success: false as const, error: error instanceof Error ? error.message : 'Could not open the extension popup.' }
    }
}
