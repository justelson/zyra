import assert from 'node:assert/strict'
import { app, BrowserWindow, globalShortcut, nativeImage, screen, type Display, type NativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import type { AgentControlDriver } from '../src/main/agent-control/drivers/driver'
import { WindowsControlOverlayManager, isWindowsControlOverlayWindow } from '../src/main/agent-control/windows-control-overlay'

const execFileAsync = promisify(execFile)

void run().catch((error) => {
    console.error(error)
    app.exit(1)
})

async function run(): Promise<void> {
    await app.whenReady()
    const targetWindow = new BrowserWindow({ width: 560, height: 380, x: 220, y: 160, show: false, title: 'Overlay smoke target' })
    await targetWindow.loadURL('data:text/html,<body style="background:%23111827;color:white;font:18px Segoe UI;padding:40px"><button>Continue</button></body>')
    targetWindow.showInactive()
    await targetWindow.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true)
    await delay(300)

    let boundsReadCount = 0
    const driver: AgentControlDriver = {
        kind: 'windows-window',
        async observe(target, options) {
            const bounds = targetWindow.getBounds()
            return {
                version: 1,
                observationId: `overlay-smoke:${options.revision}`,
                revision: options.revision,
                targetId: target.target.targetId,
                capturedAt: new Date().toISOString(),
                targetState: 'ready',
                title: 'Overlay smoke target',
                elements: [
                    { elementRef: `root:${options.revision}`, role: 'window', name: 'Overlay smoke target', bounds },
                    { elementRef: `button:${options.revision}`, role: 'button', name: 'Continue', actions: ['click'], bounds: { x: bounds.x + 80, y: bounds.y + 110, width: 100, height: 38 } }
                ],
                redactions: []
            }
        },
        async act(_target, action, context) {
            const element = 'elementRef' in action ? context.previousObservation.elements.find((entry) => entry.elementRef === action.elementRef) : undefined
            const bounds = element?.bounds
            const point = bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : { x: 300, y: 240 }
            context.updateCursor?.({ ...point, coordinateSpace: 'screen', visible: true, phase: 'moving', durationMs: 100 })
            await delay(80)
            context.updateCursor?.({ ...point, coordinateSpace: 'screen', visible: true, phase: 'pressing', durationMs: 0 })
            await delay(60)
            context.updateCursor?.({ ...point, coordinateSpace: 'screen', visible: true, phase: 'idle', durationMs: 0 })
            return { changed: true }
        },
        async getWindowBounds() {
            boundsReadCount += 1
            return targetWindow.getBounds()
        }
    }

    const broker = new AgentControlBroker({ drivers: [driver] })
    const overlay = new WindowsControlOverlayManager(broker, {
        loadAppearance: () => ({ accentPrimary: '#f97316', accentSecondary: '#fb923c', compact: true })
    })
    const principal = { type: 'root' as const, threadId: 'thread:overlay-smoke', turnId: 'turn:overlay-smoke' }
    const targetId = broker.targets.createTargetId('windows-window')
    broker.registerTarget({
        target: {
            kind: 'windows-window', targetId, sidecarSessionId: 'overlay-smoke', processId: process.pid,
            windowToken: 'overlay-smoke-token', executableIdentity: process.execPath, applicationName: 'Overlay Smoke', title: 'Overlay smoke target'
        },
        driver,
        trustedIdentity: {}
    })
    await delay(100)
    const captureDisplay = screen.getDisplayMatching(targetWindow.getBounds())
    const captureBeforeGrant = await captureScreen(captureDisplay)
    const pending = broker.requestGrant({ principal, targetId, capabilities: ['observe.structure', 'pointer.click'], durationMs: 30_000, maxActions: 4 })
    const grant = broker.approvePendingGrant({ pendingRequestId: pending.requestId, targetId, capabilities: pending.capabilities, durationMs: 30_000, maxActions: 4 })
    const observation = await broker.observe(principal, grant.grantId, targetId)

    const safety = await waitForWindow('Zyra Control Indicator', (window) => window.isVisible() && isWindowsControlOverlayWindow(window))
    if (!safety) throw new Error(`The capture-protected safety frame did not become visible. ${overlayDiagnostics(broker)}`)
    const safetyText = await safety.webContents.executeJavaScript('document.body.innerText', true)
    if (!String(safetyText).includes('Zyra is using Overlay Smoke') || !String(safetyText).includes('Esc')) throw new Error(`Safety copy is incomplete: ${safetyText}`)
    assert.deepEqual(safety.getBounds(), screen.getDisplayMatching(targetWindow.getBounds()).bounds, 'the safety glow must fill the target display')
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await safety.webContents.executeJavaScript("document.querySelector('#app-icon').classList.contains('has-image')", true)) break
        await delay(25)
    }
    const safetyAppearance = await safety.webContents.executeJavaScript(`({
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim(),
        compact: document.documentElement.dataset.compact,
        background: getComputedStyle(document.body).backgroundColor,
        hasAppIcon: document.querySelector('#app-icon').classList.contains('has-image'),
        appIcon: document.querySelector('#app-icon-image').getAttribute('src')
    })`, true)
    assert.deepEqual({
        accent: safetyAppearance.accent,
        compact: safetyAppearance.compact,
        background: safetyAppearance.background,
        hasAppIcon: safetyAppearance.hasAppIcon
    }, { accent: '#f97316', compact: 'true', background: 'rgba(0, 0, 0, 0)', hasAppIcon: true })
    assert.match(safetyAppearance.appIcon, /^data:image\/png;base64,/)
    const captureWithSafety = await captureScreen(captureDisplay)
    // Starting an external recorder can redraw the Windows taskbar itself. Compare the display above that bounded strip.
    const workArea = {
        x: captureDisplay.workArea.x - captureDisplay.bounds.x,
        y: captureDisplay.workArea.y - captureDisplay.bounds.y,
        width: captureDisplay.workArea.width,
        height: Math.max(1, captureDisplay.workArea.height - 80)
    }
    const safetyCaptureDifference = regionDifferenceRatio(
        captureBeforeGrant,
        captureWithSafety,
        workArea.x,
        workArea.y,
        workArea.width,
        workArea.height
    )
    assert(safetyCaptureDifference < 0.01, `the capture-protected edge glow or app label leaked into external screen capture (${(safetyCaptureDifference * 100).toFixed(3)}% of the work area changed)`)
    if (!globalShortcut.isRegistered('Esc')) throw new Error('Plain Escape was not scoped to the active Windows grant.')

    await broker.act(principal, {
        version: 1,
        requestId: 'overlay-smoke-action',
        grantId: grant.grantId,
        targetId,
        observationRevision: observation.revision,
        action: { type: 'click', elementRef: `button:${observation.revision}`, sideEffect: 'none' }
    })
    const cursor = await waitForWindow('Zyra Control Cursor', (window) => window.isVisible() && isWindowsControlOverlayWindow(window))
    if (!cursor) throw new Error(`The recordable synthetic cursor did not become visible. ${overlayDiagnostics(broker)}`)
    const cursorVisible = await cursor.webContents.executeJavaScript("document.querySelector('#cursor').classList.contains('show')", true)
    if (!cursorVisible) throw new Error('The synthetic cursor did not receive its screen-space update.')
    const captureWithCursor = await captureScreen(captureDisplay)
    const cursorPoint = { x: targetWindow.getBounds().x + 130 - captureDisplay.bounds.x, y: targetWindow.getBounds().y + 129 - captureDisplay.bounds.y }
    assert(regionDifferenceRatio(captureWithSafety, captureWithCursor, cursorPoint.x - 20, cursorPoint.y - 20, 150, 60) > 0.005, 'the synthetic cursor was not recordable')

    const readsBeforeMove = boundsReadCount
    const currentDisplay = screen.getDisplayMatching(targetWindow.getBounds())
    const alternateDisplay = screen.getAllDisplays().find((display) => display.id !== currentDisplay.id)
    const destination = alternateDisplay?.workArea || currentDisplay.workArea
    targetWindow.setBounds({ x: destination.x + 40, y: destination.y + 40, width: 600, height: 420 })
    await delay(900)
    assert(boundsReadCount > readsBeforeMove, 'the overlay keeps polling the exact target through move and resize')
    assert.deepEqual(safety.getBounds(), screen.getDisplayMatching(targetWindow.getBounds()).bounds, 'the glow follows the target onto its current display')

    broker.revokeGrant(grant.grantId)
    await delay(120)
    if (safety.isVisible() || cursor.isVisible()) throw new Error('Control overlays remained visible after grant revocation.')
    if (globalShortcut.isRegistered('Esc')) throw new Error('Plain Escape remained registered after Windows control ended.')

    const expiringRequest = broker.requestGrant({ principal, targetId, capabilities: ['observe.structure'], durationMs: 1_000, maxActions: 4 })
    const expiringGrant = broker.approvePendingGrant({ pendingRequestId: expiringRequest.requestId, targetId, capabilities: expiringRequest.capabilities, durationMs: 1_000, maxActions: 4 })
    await broker.observe(principal, expiringGrant.grantId, targetId)
    assert(await waitForCondition(() => safety.isVisible()), 'the overlay did not return for the expiry check')
    assert(await waitForCondition(() => !safety.isVisible(), 2_500), 'the overlay remained visible after an idle grant expired')
    assert.equal(expiringGrant.state, 'expired')
    assert.equal(globalShortcut.isRegistered('Esc'), false, 'plain Escape remained registered after grant expiry')

    const closingRequest = broker.requestGrant({ principal, targetId, capabilities: ['observe.structure'], durationMs: 30_000, maxActions: 4 })
    const closingGrant = broker.approvePendingGrant({ pendingRequestId: closingRequest.requestId, targetId, capabilities: closingRequest.capabilities, durationMs: 30_000, maxActions: 4 })
    await broker.observe(principal, closingGrant.grantId, targetId)
    assert(await waitForCondition(() => safety.isVisible()), 'the overlay did not return for the target-close check')
    targetWindow.destroy()
    assert(await waitForCondition(() => !safety.isVisible(), 2_500), 'the overlay remained visible after the exact target closed')
    assert.equal(broker.targets.list().some((entry) => entry.target.targetId === targetId), false)

    overlay.dispose()
    await broker.dispose()
    console.log('Windows recordable cursor, app icon, capture-excluded full-display accent glow, display tracking, expiry, target-close, Escape lifetime, and teardown smoke passed.')
    app.quit()
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return true
        await delay(25)
    }
    return predicate()
}

async function captureScreen(display: Display): Promise<NativeImage> {
    const scale = Math.max(1, display.scaleFactor || 1)
    const width = Math.max(1, Math.round(display.size.width * scale))
    const height = Math.max(1, Math.round(display.size.height * scale))
    const offsetX = Math.round(display.bounds.x * scale)
    const offsetY = Math.round(display.bounds.y * scale)
    const { stdout } = await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'gdigrab', '-draw_mouse', '0',
        '-offset_x', String(offsetX), '-offset_y', String(offsetY), '-video_size', `${width}x${height}`,
        '-i', 'desktop', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
    ], { timeout: 15_000, windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
    const capture = nativeImage.createFromBuffer(stdout)
    if (capture.isEmpty()) throw new Error(`Display ${display.id} was unavailable to the external capture smoke.`)
    return capture.resize({ width: display.size.width, height: display.size.height, quality: 'best' })
}

function regionDifferenceRatio(left: NativeImage, right: NativeImage, x: number, y: number, width: number, height: number): number {
    const leftSize = left.getSize()
    const rightSize = right.getSize()
    if (leftSize.width !== rightSize.width || leftSize.height !== rightSize.height) return 1
    const leftPixels = left.toBitmap()
    const rightPixels = right.toBitmap()
    const minX = Math.max(0, Math.floor(x))
    const minY = Math.max(0, Math.floor(y))
    const maxX = Math.min(leftSize.width, Math.ceil(x + width))
    const maxY = Math.min(leftSize.height, Math.ceil(y + height))
    let changed = 0
    let total = 0
    for (let row = minY; row < maxY; row += 1) {
        for (let column = minX; column < maxX; column += 1) {
            const offset = (row * leftSize.width + column) * 4
            const difference = Math.abs(leftPixels[offset] - rightPixels[offset])
                + Math.abs(leftPixels[offset + 1] - rightPixels[offset + 1])
                + Math.abs(leftPixels[offset + 2] - rightPixels[offset + 2])
            if (difference > 24) changed += 1
            total += 1
        }
    }
    return total ? changed / total : 0
}

async function waitForWindow(title: string, predicate: (window: BrowserWindow) => boolean): Promise<BrowserWindow | null> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === title)
        if (window && predicate(window)) return window
        await delay(50)
    }
    return null
}

function overlayDiagnostics(broker: AgentControlBroker): string {
    const windows = BrowserWindow.getAllWindows().map((window) => ({
        title: window.getTitle(), visible: window.isVisible(), destroyed: window.isDestroyed(), url: window.webContents.getURL().slice(0, 40)
    }))
    const state = broker.state()
    return JSON.stringify({ windows, grants: state.grants.map((grant) => ({ targetId: grant.targetId, state: grant.state })), escape: globalShortcut.isRegistered('Esc') })
}
