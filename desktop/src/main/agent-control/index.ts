import { app, BrowserWindow, screen, type WebContents } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'
import { AgentControlBroker } from './agent-control-broker'
import { ChromePairingServer } from './chrome-pairing-server'
import { ChromeExtensionDriver } from './drivers/chrome-extension-driver'
import { WindowsDesktopDriver } from './drivers/windows-desktop-driver'
import { ZyraBrowserDriver } from './drivers/zyra-browser-driver'
import { trustedBrowserGuests } from './trusted-guest-registry'
import { controlInteractionCategory } from './interaction-arbiter'
import {
    WindowsControlOverlayManager,
    type WindowsControlOverlayAppearance
} from './windows-control-overlay'

let broker: AgentControlBroker | null = null
let chromeDriver: ChromeExtensionDriver | null = null
let browserDriver: ZyraBrowserDriver | null = null
let trustedGuestUnsubscribe: (() => void) | null = null
let windowsControlOverlay: WindowsControlOverlayManager | null = null
let windowsControlOverlayAppearance: (() => WindowsControlOverlayAppearance | Promise<WindowsControlOverlayAppearance>) | undefined
const browserTargetByGuestIdentity = new Map<string, string>()

export function configureWindowsControlOverlayAppearance(
    provider: () => WindowsControlOverlayAppearance | Promise<WindowsControlOverlayAppearance>
): void {
    windowsControlOverlayAppearance = provider
    windowsControlOverlay?.refreshAppearance()
}

export function refreshWindowsControlOverlayAppearance(): void {
    windowsControlOverlay?.refreshAppearance()
}

export function getAgentControlBroker(): AgentControlBroker {
    if (broker) return broker
    const userData = app.getPath('userData')
    const artifactRoot = join(userData, 'agent-control', 'artifacts')
    rmSync(artifactRoot, { recursive: true, force: true })
    const pairing = new ChromePairingServer()
    browserDriver = new ZyraBrowserDriver(join(artifactRoot, 'browser'))
    chromeDriver = new ChromeExtensionDriver(pairing, join(artifactRoot, 'chrome'))
    const windowsDriver = new WindowsDesktopDriver(join(userData, 'agent-control', 'artifacts', 'windows'))
    broker = new AgentControlBroker({ userDataPath: userData, drivers: [browserDriver, chromeDriver, windowsDriver], pairing })
    windowsControlOverlay = new WindowsControlOverlayManager(broker, {
        loadAppearance: () => windowsControlOverlayAppearance?.() || {}
    })
    chromeDriver.setRegistrationHandlers({
        register: ({ target, trustedIdentity }) => {
            const targetId = broker!.targets.createTargetId('chrome-tab')
            broker!.registerTarget({ target: { ...target, targetId }, driver: chromeDriver!, trustedIdentity })
            return targetId
        },
        remove: (targetId, reason) => broker!.removeTarget(targetId, reason)
    })
    trustedGuestUnsubscribe = trustedBrowserGuests.onRemoved((entry) => {
        const targetId = browserTargetByGuestIdentity.get(entry.guestIdentity)
        if (targetId) broker?.removeTarget(targetId, 'Integrated Browser tab closed.')
        browserTargetByGuestIdentity.delete(entry.guestIdentity)
    })
    return broker
}

export function bindTrustedBrowserTarget(ownerWebContentsId: number, guestWebContentsId: number, tabId: string, ownerThreadId: string, sessionMode: 'normal' | 'incognito') {
    const controlBroker = getAgentControlBroker()
    const guestEntry = trustedBrowserGuests.bind(ownerWebContentsId, guestWebContentsId, tabId, ownerThreadId, sessionMode)
    const existingTargetId = browserTargetByGuestIdentity.get(guestEntry.guestIdentity)
    if (existingTargetId) return controlBroker.targets.get(existingTargetId).target
    if (!browserDriver) throw new Error('Integrated Browser control driver is unavailable.')
    const targetId = controlBroker.targets.createTargetId('zyra-browser')
    const url = guestEntry.guest.getURL()
    const origin = /^https?:/.test(url) ? new URL(url).origin : null
    const target = controlBroker.registerTarget({
        target: {
            kind: 'zyra-browser', targetId, tabId, sessionMode, ownerThreadId, guestIdentity: guestEntry.guestIdentity, origin,
            url: /^https?:/.test(url) ? url : null,
            title: guestEntry.guest.getTitle().slice(0, 512) || null
        },
        driver: browserDriver,
        trustedIdentity: guestEntry.guest,
        ownerWebContentsId
    })
    browserTargetByGuestIdentity.set(guestEntry.guestIdentity, targetId)
    installGuestLifecycle(guestEntry.guest, targetId, controlBroker)
    return target
}

export function transferTrustedBrowserTargetOwner(
    guestWebContentsId: number,
    previousOwnerWebContentsId: number,
    ownerWebContentsId: number
): void {
    if (previousOwnerWebContentsId === ownerWebContentsId) return
    const entry = trustedBrowserGuests.transferOwner(guestWebContentsId, previousOwnerWebContentsId, ownerWebContentsId)
    const targetId = browserTargetByGuestIdentity.get(entry.guestIdentity)
    if (!targetId || !broker) return
    try {
        broker.transferTargetOwner(targetId, previousOwnerWebContentsId, ownerWebContentsId)
    } catch (error) {
        try { broker.transferTargetOwner(targetId, ownerWebContentsId, previousOwnerWebContentsId) } catch {}
        trustedBrowserGuests.transferOwner(guestWebContentsId, ownerWebContentsId, previousOwnerWebContentsId)
        throw error
    }
}

function installGuestLifecycle(guest: WebContents, targetId: string, controlBroker: AgentControlBroker): void {
    const navigation = (_event: unknown, url: string, _isInPlace?: boolean, isMainFrame?: boolean) => {
        if (isMainFrame === false || !/^https?:\/\//.test(url)) return
        controlBroker.handleTargetNavigation(targetId, url)
    }
    const title = (_event: unknown, value: string) => controlBroker.handleTargetTitle(targetId, value)
    const input = (_event: unknown, value: Electron.InputEvent) => {
        const category = controlInteractionCategory(value.type)
        if (!category) return
        const ownerWebContentsId = trustedBrowserGuests.findByGuestId(guest.id)?.ownerWebContentsId
        const owner = ownerWebContentsId
            ? BrowserWindow.getAllWindows().find((window) => window.webContents.id === ownerWebContentsId)
            : null
        const contentBounds = owner?.getContentBounds()
        const cursor = category === 'pointer-action' || category === 'scroll' || category === 'gesture'
            ? screen.getCursorScreenPoint()
            : null
        const point = cursor && contentBounds
            ? { x: cursor.x - contentBounds.x, y: cursor.y - contentBounds.y }
            : undefined
        controlBroker.recordUserInteraction(targetId, category, value.type, point)
    }
    guest.on('did-start-navigation', navigation)
    guest.on('page-title-updated', title)
    guest.on('input-event', input)
    guest.once('destroyed', () => {
        guest.removeListener('did-start-navigation', navigation)
        guest.removeListener('page-title-updated', title)
        guest.removeListener('input-event', input)
    })
}

export async function disposeAgentControlBroker(): Promise<void> {
    trustedGuestUnsubscribe?.()
    trustedGuestUnsubscribe = null
    browserTargetByGuestIdentity.clear()
    const current = broker
    broker = null
    chromeDriver = null
    browserDriver = null
    windowsControlOverlay?.dispose()
    windowsControlOverlay = null
    await current?.dispose()
}
