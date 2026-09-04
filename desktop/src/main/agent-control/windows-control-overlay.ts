import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { isAbsolute } from 'path'
import type { ControlCursorState, ControlStateSnapshot, ControlTarget } from '../../shared/agent-control/contracts'
import type { AgentControlBroker } from './agent-control-broker'
import { resolveWindowsControlBounds, type WindowsControlBounds } from './windows-control-geometry'
import { WINDOWS_CONTROL_CURSOR_HTML, WINDOWS_CONTROL_SAFETY_HTML } from './windows-control-overlay-document'

const DISPLAY_REFRESH_MS = 750
const DEFAULT_APPEARANCE: ResolvedWindowsControlOverlayAppearance = {
    accentPrimary: '#3b82f6',
    accentSecondary: '#60a5fa',
    accentPrimaryRgb: '59 130 246',
    accentSecondaryRgb: '96 165 250',
    reduceMotion: false,
    compact: false
}

export type WindowsControlOverlayAppearance = {
    accentPrimary?: string
    accentSecondary?: string
    reduceMotion?: boolean
    compact?: boolean
}

type ResolvedWindowsControlOverlayAppearance = Required<WindowsControlOverlayAppearance> & {
    accentPrimaryRgb: string
    accentSecondaryRgb: string
}

type WindowsControlOverlayOptions = {
    loadAppearance?: () => WindowsControlOverlayAppearance | Promise<WindowsControlOverlayAppearance>
    loadApplicationIcon?: (target: Extract<ControlTarget, { kind: 'windows-window' }>) => string | Promise<string>
}

const overlayWindows = new WeakSet<BrowserWindow>()
const overlayWindowReady = new WeakMap<BrowserWindow, Promise<void>>()

export function isWindowsControlOverlayWindow(window: BrowserWindow): boolean {
    return overlayWindows.has(window)
}

export class WindowsControlOverlayManager {
    private safetyWindow: BrowserWindow | null = null
    private cursorWindow: BrowserWindow | null = null
    private activeTargetId: string | null = null
    private activeApplication = 'this app'
    private escapeHint = 'Ctrl+Alt+Esc'
    private ownsEscapeShortcut = false
    private disposed = false
    private boundsRefreshActive = false
    private appearanceRequest = 0
    private iconRequest = 0
    private appearance = DEFAULT_APPEARANCE
    private applicationIconDataUrl = ''
    private lastTargetBounds: WindowsControlBounds | null = null
    private safetyPayloadKey = ''
    private readonly boundsTimer: NodeJS.Timeout
    private readonly onChanged = (snapshot: ControlStateSnapshot) => this.reconcile(snapshot)
    private readonly onCursor = (cursor: ControlCursorState) => this.renderCursor(cursor)

    constructor(
        private readonly broker: AgentControlBroker,
        private readonly options: WindowsControlOverlayOptions = {}
    ) {
        broker.on('changed', this.onChanged)
        broker.on('cursor', this.onCursor)
        this.boundsTimer = setInterval(() => { void this.refreshBounds() }, DISPLAY_REFRESH_MS)
        this.boundsTimer.unref?.()
        this.refreshAppearance()
        this.reconcile(broker.state())
    }

    refreshAppearance(): void {
        const request = ++this.appearanceRequest
        void Promise.resolve(this.options.loadAppearance?.() || {}).then((appearance) => {
            if (this.disposed || request !== this.appearanceRequest) return
            this.appearance = resolveAppearance(appearance)
            this.safetyPayloadKey = ''
            if (this.lastTargetBounds && this.activeTargetId) this.showSafety(this.lastTargetBounds)
        }).catch(() => undefined)
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        this.broker.removeListener('changed', this.onChanged)
        this.broker.removeListener('cursor', this.onCursor)
        clearInterval(this.boundsTimer)
        this.deactivate()
        this.safetyWindow?.destroy()
        this.cursorWindow?.destroy()
        this.safetyWindow = null
        this.cursorWindow = null
    }

    private reconcile(snapshot: ControlStateSnapshot): void {
        if (this.disposed) return
        const targets = new Map(snapshot.targets.map((target) => [target.targetId, target]))
        const active = snapshot.grants
            .filter((grant) => grant.state === 'active' && targets.get(grant.targetId)?.kind === 'windows-window')
            .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))[0]
        const target = active ? targets.get(active.targetId) : undefined
        if (!active || target?.kind !== 'windows-window') {
            this.deactivate()
            return
        }
        const targetChanged = this.activeTargetId !== target.targetId
        this.activeTargetId = target.targetId
        this.activeApplication = windowsApplicationLabel(target)
        this.activateEscapeShortcut()
        if (targetChanged) {
            this.lastTargetBounds = null
            this.applicationIconDataUrl = ''
            this.safetyPayloadKey = ''
            this.safetyWindow?.hide()
            this.refreshAppearance()
            this.refreshApplicationIcon(target)
        }
        const observedBounds = resolveWindowsControlBounds(this.broker.observations.get(target.targetId))
        if (observedBounds) this.showSafety(observedBounds)
        else void this.refreshBounds()
    }

    private activateEscapeShortcut(): void {
        if (!this.ownsEscapeShortcut && !globalShortcut.isRegistered('Esc')) {
            this.ownsEscapeShortcut = globalShortcut.register('Esc', () => {
                this.hideOverlays()
                void this.broker.emergencyStop('Plain Escape was pressed while Windows computer control was active.')
            })
        }
        this.escapeHint = this.ownsEscapeShortcut ? 'Esc' : 'Ctrl+Alt+Esc'
    }

    private deactivate(): void {
        this.activeTargetId = null
        this.lastTargetBounds = null
        this.applicationIconDataUrl = ''
        this.iconRequest += 1
        this.safetyPayloadKey = ''
        if (this.ownsEscapeShortcut) globalShortcut.unregister('Esc')
        this.ownsEscapeShortcut = false
        this.escapeHint = 'Ctrl+Alt+Esc'
        this.hideOverlays()
    }

    private hideOverlays(): void {
        if (this.safetyWindow && !this.safetyWindow.isDestroyed()) this.safetyWindow.hide()
        if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
            void this.cursorWindow.webContents.executeJavaScript('globalThis.hideZyraCursor?.()', true).catch(() => undefined)
            this.cursorWindow.hide()
        }
    }

    private async refreshBounds(): Promise<void> {
        const targetId = this.activeTargetId
        if (!targetId || this.boundsRefreshActive || this.disposed) return
        let target
        try { target = this.broker.targets.get(targetId) } catch { return }
        if (target.target.kind !== 'windows-window' || !target.driver.getWindowBounds) return
        this.boundsRefreshActive = true
        try {
            const bounds = await target.driver.getWindowBounds(target)
            if (this.activeTargetId === targetId) this.showSafety(bounds)
        } catch {
            if (this.activeTargetId === targetId) {
                try { this.broker.removeTarget(targetId, 'The controlled Windows app closed or became unavailable.') }
                catch { this.deactivate() }
            }
        } finally {
            this.boundsRefreshActive = false
        }
    }

    private showSafety(targetBounds: WindowsControlBounds): void {
        const expectedTargetId = this.activeTargetId
        if (!expectedTargetId) return
        this.lastTargetBounds = targetBounds
        const window = this.ensureSafetyWindow()
        const displayBounds = screen.getDisplayMatching(targetBounds).bounds
        if (!sameBounds(window.getBounds(), displayBounds)) window.setBounds(displayBounds, false)
        const payload = {
            application: this.activeApplication,
            applicationIconDataUrl: this.applicationIconDataUrl,
            key: this.escapeHint,
            ...this.appearance
        }
        const payloadKey = JSON.stringify(payload)
        if (payloadKey === this.safetyPayloadKey && window.isVisible()) return
        void (overlayWindowReady.get(window) || Promise.resolve()).then(async () => {
            if (window.isDestroyed() || this.activeTargetId !== expectedTargetId) return
            await window.webContents.executeJavaScript(`globalThis.updateZyraSafety?.(${payloadKey})`, true)
            if (window.isDestroyed() || this.activeTargetId !== expectedTargetId) return
            this.safetyPayloadKey = payloadKey
            if (!window.isVisible()) window.showInactive()
        }).catch(() => undefined)
    }

    private renderCursor(cursor: ControlCursorState): void {
        if (cursor.coordinateSpace !== 'screen' || !cursor.visible) return
        if (cursor.targetId !== this.activeTargetId) {
            const snapshot = this.broker.state()
            const grant = snapshot.grants.find((entry) => entry.state === 'active' && entry.targetId === cursor.targetId)
            const target = snapshot.targets.find((entry): entry is Extract<ControlTarget, { kind: 'windows-window' }> => (
                entry.kind === 'windows-window' && entry.targetId === cursor.targetId
            ))
            if (!grant || !target) return
            this.activeTargetId = cursor.targetId
            this.activeApplication = windowsApplicationLabel(target)
            this.applicationIconDataUrl = ''
            this.lastTargetBounds = null
            this.safetyPayloadKey = ''
            this.safetyWindow?.hide()
            this.activateEscapeShortcut()
            this.refreshAppearance()
            this.refreshApplicationIcon(target)
            void this.refreshBounds()
        }
        const window = this.ensureCursorWindow()
        const virtual = virtualScreenBounds()
        if (!sameBounds(window.getBounds(), virtual)) window.setBounds(virtual, false)
        const payload = JSON.stringify({
            x: Math.round(cursor.x - virtual.x),
            y: Math.round(cursor.y - virtual.y),
            phase: cursor.phase,
            durationMs: cursor.durationMs || 0,
            ...this.appearance
        })
        void (overlayWindowReady.get(window) || Promise.resolve()).then(async () => {
            if (window.isDestroyed() || this.activeTargetId !== cursor.targetId) return
            await window.webContents.executeJavaScript(`globalThis.updateZyraCursor?.(${payload})`, true)
            if (!window.isVisible()) window.showInactive()
        }).catch(() => undefined)
    }

    private refreshApplicationIcon(target: Extract<ControlTarget, { kind: 'windows-window' }>): void {
        const request = ++this.iconRequest
        const loader = this.options.loadApplicationIcon || loadWindowsApplicationIcon
        void Promise.resolve(loader(target)).then((dataUrl) => {
            if (this.disposed || request !== this.iconRequest || this.activeTargetId !== target.targetId) return
            this.applicationIconDataUrl = isSafeImageDataUrl(dataUrl) ? dataUrl : ''
            this.safetyPayloadKey = ''
            if (this.lastTargetBounds) this.showSafety(this.lastTargetBounds)
        }).catch(() => undefined)
    }

    private ensureSafetyWindow(): BrowserWindow {
        if (this.safetyWindow && !this.safetyWindow.isDestroyed()) return this.safetyWindow
        this.safetyWindow = createOverlayWindow('Zyra Control Indicator', WINDOWS_CONTROL_SAFETY_HTML, true)
        return this.safetyWindow
    }

    private ensureCursorWindow(): BrowserWindow {
        if (this.cursorWindow && !this.cursorWindow.isDestroyed()) return this.cursorWindow
        this.cursorWindow = createOverlayWindow('Zyra Control Cursor', WINDOWS_CONTROL_CURSOR_HTML, false)
        this.cursorWindow.setBounds(virtualScreenBounds(), false)
        return this.cursorWindow
    }
}

async function loadWindowsApplicationIcon(target: Extract<ControlTarget, { kind: 'windows-window' }>): Promise<string> {
    if (!isAbsolute(target.executableIdentity) || !/\.exe$/i.test(target.executableIdentity)) return ''
    const icon = await app.getFileIcon(target.executableIdentity, { size: 'small' })
    return icon.isEmpty() ? '' : icon.toDataURL()
}

function isSafeImageDataUrl(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 128 * 1024 && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value)
}

function createOverlayWindow(title: string, html: string, captureProtected: boolean): BrowserWindow {
    const window = new BrowserWindow({
        title,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        skipTaskbar: true,
        hasShadow: false,
        roundedCorners: false,
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            devTools: false
        }
    })
    overlayWindows.add(window)
    window.setIgnoreMouseEvents(true, { forward: true })
    window.setAlwaysOnTop(true, 'screen-saver', 1)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (captureProtected) window.setContentProtection(true)
    overlayWindowReady.set(window, window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`))
    return window
}

function windowsApplicationLabel(target: Extract<ControlTarget, { kind: 'windows-window' }>): string {
    const application = String(target.applicationName || '').replace(/\s+/g, ' ').trim()
    const title = String(target.title || '').replace(/\s+/g, ' ').trim()
    const label = /^ApplicationFrameHost$/i.test(application) && title ? title : application || title || 'this app'
    return label.slice(0, 80)
}

function resolveAppearance(input: WindowsControlOverlayAppearance): ResolvedWindowsControlOverlayAppearance {
    const accentPrimary = validHexColor(input.accentPrimary) || DEFAULT_APPEARANCE.accentPrimary
    const accentSecondary = validHexColor(input.accentSecondary) || accentPrimary
    return {
        accentPrimary,
        accentSecondary,
        accentPrimaryRgb: hexToRgbChannels(accentPrimary),
        accentSecondaryRgb: hexToRgbChannels(accentSecondary),
        reduceMotion: input.reduceMotion === true,
        compact: input.compact === true
    }
}

function validHexColor(value: unknown): string | null {
    const color = String(value || '').trim()
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null
}

function hexToRgbChannels(value: string): string {
    return [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)]
        .map((part) => Number.parseInt(part, 16))
        .join(' ')
}

function virtualScreenBounds(): WindowsControlBounds {
    const displays = screen.getAllDisplays()
    const left = Math.min(...displays.map((display) => display.bounds.x))
    const top = Math.min(...displays.map((display) => display.bounds.y))
    const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
    const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
    return { x: left, y: top, width: right - left, height: bottom - top }
}

function sameBounds(left: WindowsControlBounds, right: WindowsControlBounds): boolean {
    return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}
