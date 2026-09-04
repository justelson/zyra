import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
    AGENT_CONTROL_IPC,
    type BrowserSurfaceClaim,
    type BrowserSurfaceOpenAcknowledgement,
    type BrowserSurfaceOpenCompletion,
    type RendererControlGrantInput
} from '../../../shared/agent-control/protocol'
import { AgentControlError } from '../../agent-control/control-errors'
import { bindTrustedBrowserTarget, getAgentControlBroker } from '../../agent-control'
import { BrowserSurfaceHost } from '../../agent-control/browser-surface-host'
import { isWindowsControlOverlayWindow } from '../../agent-control/windows-control-overlay'

function isTrustedAssistantRenderer(window: BrowserWindow | null, mainWindow: BrowserWindow): boolean {
    if (!window || window.isDestroyed() || isWindowsControlOverlayWindow(window)) return false
    if (window.id === mainWindow.id) return true
    try {
        const hash = new URL(window.webContents.getURL()).hash
        return hash.startsWith('#/assistant-utility/') || (!hash.startsWith('#/browser-popup/') && !hash.startsWith('#/quick-open'))
    } catch {
        return false
    }
}

function assertTrustedRenderer(event: IpcMainInvokeEvent, mainWindow: BrowserWindow): void {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!isTrustedAssistantRenderer(senderWindow, mainWindow)) {
        throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Control Center requests must come from a trusted Zyra Assistant window.')
    }
}

async function result<T>(operation: () => T | Promise<T>) {
    try {
        return { success: true as const, ...(await operation() as object) } as { success: true } & T
    } catch (error) {
        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Control request failed.',
            code: error instanceof AgentControlError ? error.code : 'CONTROL_ERROR'
        }
    }
}

export function createAgentControlHandlers(mainWindow: BrowserWindow) {
    const broker = getAgentControlBroker()
    const surfaceRequestWindows = new Map<string, BrowserWindow>()
    const currentMainWindow = () => BrowserWindow.getAllWindows().find((window) => {
        if (window.isDestroyed()) return false
        try {
            const hash = new URL(window.webContents.getURL()).hash
            return !hash.startsWith('#/assistant-utility/') && !hash.startsWith('#/browser-popup/') && !hash.startsWith('#/quick-open')
        } catch { return false }
    }) || (!mainWindow.isDestroyed() ? mainWindow : null)
    const browserSurface = new BrowserSurfaceHost({
        send: (request) => {
            const targetOwnerId = request.targetId
                ? broker.targets.list().find((entry) => entry.target.targetId === request.targetId)?.ownerWebContentsId
                : undefined
            const ownerWindow = targetOwnerId
                ? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.webContents.id === targetOwnerId) || null
                : null
            const destination = ownerWindow || currentMainWindow()
            if (!destination) throw new Error('The Zyra Browser window is closed.')
            surfaceRequestWindows.set(request.requestId, destination)
            destination.webContents.send(AGENT_CONTROL_IPC.browserSurfaceRequested, request)
        },
        cancel: (requestId) => {
            const destination = surfaceRequestWindows.get(requestId) || currentMainWindow()
            surfaceRequestWindows.delete(requestId)
            if (destination && !destination.isDestroyed()) destination.webContents.send(AGENT_CONTROL_IPC.browserSurfaceCancelled, requestId)
        },
        resolveTarget: (targetId) => broker.targets.get(targetId).target
    })
    broker.setBrowserSurfaceController(browserSurface)
    const trustedWindows = () => BrowserWindow.getAllWindows().filter((window) => isTrustedAssistantRenderer(window, mainWindow) && !window.webContents.isDestroyed())
    const sendSafely = (window: BrowserWindow, channel: string, payload: unknown) => {
        try { window.webContents.send(channel, payload) } catch { /* A renderer reload can dispose its frame between enumeration and send. */ }
    }
    const broadcast = () => {
        for (const window of trustedWindows()) sendSafely(window, AGENT_CONTROL_IPC.stateChanged, broker.state(window.webContents.id))
    }
    const broadcastCursor = (cursor: unknown) => {
        for (const window of trustedWindows()) sendSafely(window, AGENT_CONTROL_IPC.cursorChanged, cursor)
    }
    broker.on('changed', broadcast)
    broker.on('cursor', broadcastCursor)
    return {
        getState: (event: IpcMainInvokeEvent) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { state: broker.state(event.sender.id) }
        }),
        bindBrowserTab: (event: IpcMainInvokeEvent, input: { guestWebContentsId?: number; tabId?: string; threadId?: string; sessionMode?: 'normal' | 'incognito' }) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            const guestWebContentsId = Number(input?.guestWebContentsId)
            if (!Number.isInteger(guestWebContentsId) || guestWebContentsId < 1) throw new Error('Browser guest identity is invalid.')
            const target = bindTrustedBrowserTarget(event.sender.id, guestWebContentsId, String(input?.tabId || ''), String(input?.threadId || ''), input?.sessionMode === 'incognito' ? 'incognito' : 'normal')
            browserSurface.completeRegisteredTarget(target)
            return { target }
        }),
        acknowledgeBrowserSurfaceRequest: (event: IpcMainInvokeEvent, input: BrowserSurfaceOpenAcknowledgement) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { accepted: browserSurface.acknowledge(input) }
        }),
        completeBrowserSurfaceRequest: (event: IpcMainInvokeEvent, input: BrowserSurfaceOpenCompletion) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { completed: browserSurface.complete(input) }
        }),
        claimBrowserSurfaceRequest: (event: IpcMainInvokeEvent, input: BrowserSurfaceClaim) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { claimed: browserSurface.claim(input) }
        }),
        updateWorkspaceState: (event: IpcMainInvokeEvent, input: unknown) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { workspace: broker.updateWorkspaceState(input, event.sender.id) }
        }),
        approveGrant: (event: IpcMainInvokeEvent, input: RendererControlGrantInput) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            return { grant: broker.approvePendingGrant(input) }
        }),
        rejectGrant: (event: IpcMainInvokeEvent, requestId: string) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            broker.rejectPendingGrant(requestId)
            return { rejected: true }
        }),
        approveAction: (event: IpcMainInvokeEvent, requestId: string) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            broker.approvePendingAction(requestId)
            return { approved: true }
        }),
        rejectAction: (event: IpcMainInvokeEvent, requestId: string) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            broker.rejectPendingAction(requestId)
            return { rejected: true }
        }),
        revokeGrant: (event: IpcMainInvokeEvent, grantId: string) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            broker.revokeGrant(grantId)
            return { revoked: true }
        }),
        emergencyStop: (event: IpcMainInvokeEvent) => result(async () => {
            assertTrustedRenderer(event, mainWindow)
            await broker.emergencyStop()
            return { stopped: true }
        }),
        clearAudit: (event: IpcMainInvokeEvent) => result(() => {
            assertTrustedRenderer(event, mainWindow)
            broker.clearAudit()
            return { cleared: true }
        }),
        startChromePairing: (event: IpcMainInvokeEvent) => result(async () => {
            assertTrustedRenderer(event, mainWindow)
            return { pairing: await broker.startChromePairing() }
        }),
        stopChromePairing: (event: IpcMainInvokeEvent) => result(async () => {
            assertTrustedRenderer(event, mainWindow)
            await broker.stopChromePairing()
            return { pairing: broker.state().pairing }
        }),
        listWindows: (event: IpcMainInvokeEvent) => result(async () => {
            assertTrustedRenderer(event, mainWindow)
            return { windows: await broker.listWindows() }
        }),
        selectWindow: (event: IpcMainInvokeEvent, windowToken: string) => result(async () => {
            assertTrustedRenderer(event, mainWindow)
            return { target: await broker.selectWindow(windowToken) }
        })
    }
}
