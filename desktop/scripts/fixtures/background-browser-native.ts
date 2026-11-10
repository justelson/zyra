import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createServer } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { BrowserPopupManager } from '../../src/main/browser-popup-manager'
import { BrowserViewManager } from '../../src/main/browser-view-manager'
import { BrowserSurfaceHost } from '../../src/main/agent-control/browser-surface-host'
import { getAgentControlBroker } from '../../src/main/agent-control'
import { trustedBrowserGuests } from '../../src/main/agent-control/trusted-guest-registry'
import { browserControlOverlayScript } from '../../src/main/browser-control-overlay'

app.setPath('userData', process.env.ZYRA_BACKGROUND_TEST_PROFILE!)
app.setPath('sessionData', `${process.env.ZYRA_BACKGROUND_TEST_PROFILE}/session`)
const deadline = setTimeout(() => { console.error('Background Browser native check timed out'); app.exit(1) }, 30000)
const trace = (phase: string) => { if (process.env.ZYRA_BACKGROUND_TEST_TRACE === '1') console.log(`[browser fixture] ${phase}`) }
const server = createServer((request, response) => {
    if (request.url === '/pending') return
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Background Browser fixture</title><style>body{background:#101419;color:#eef2f6;font:16px system-ui;padding:40px}button,input{font:inherit;margin:8px;padding:12px;border-radius:8px}</style><h2>Background Browser</h2><button onclick="window.clicks++">Continue</button><input placeholder="Draft"><script>window.clicks=0;window.keys=[];document.addEventListener("keydown",event=>keys.push(event.type));document.addEventListener("keyup",event=>keys.push(event.type));</script>')
})
let owner: BrowserWindow | undefined
let manager: BrowserViewManager | undefined

app.whenReady().then(async () => {
    trace('Electron ready')
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}/`
    const backgrounded = process.env.ZYRA_BACKGROUND_TEST_SELECTED !== '1'
    owner = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    // The owner needs no renderer document: control must work without a mounted
    // Inspector. Keep only the Browser guests running in this native fixture.
    trace(backgrounded ? 'Unselected chat, no inspector' : 'Selected chat, no inspector')
    manager = new BrowserViewManager({ popupManager: { registerGuest() {}, transferGuestOwner() {} }, resolveOwnerId: () => 'fixture:main', canUseBrowser: () => true })
    const broker = getAgentControlBroker()
    const principal = { type: 'root' as const, threadId: 'thread:background-native', turnId: 'turn:background-native' }
    const surface = new BrowserSurfaceHost({ send() { throw new Error('Hidden requests must not use the selected chat renderer') }, resolveTarget: id => broker.targets.get(id).target, executeHidden: (request, signal) => manager!.executeHiddenControlRequest(owner!, request, signal) })
    broker.setBrowserSurfaceController(surface)
    const blankFirst = process.env.ZYRA_BACKGROUND_TEST_BLANK === '1'
    const opened = await broker.handleToolOperation(principal, { operation: 'open_tab', ...(blankFirst ? {} : { url }), reveal: false }, undefined, { backgrounded }) as any
    const target = opened.target
    trace('Hidden tab opened')
    const entry = trustedBrowserGuests.findByIdentity(target.guestIdentity)!
    const guest = entry.guest
    // Tab transitions send blur even when the app is in the background. Spy on
    // the real command boundary without activating any desktop window.
    let shellFocusRequests = 0, pageFocusRequests = 0
    const originalShellFocus = owner.webContents.focus
    const originalPageFocus = guest.focus
    const originalWindowFocused = owner.isFocused
    const originalWindowVisible = owner.isVisible
    const originalPageFocused = guest.isFocused
    owner.webContents.focus = () => { shellFocusRequests++ }
    guest.focus = () => { pageFocusRequests++ }
    try {
        guest.isFocused = () => true
        await (manager as any).command({ sender: owner.webContents }, { tabId: target.tabId, type: 'blur' })
        await (manager as any).command({ sender: owner.webContents }, { tabId: target.tabId, type: 'focus' })
        assert.equal(shellFocusRequests, 0, 'background tab transitions must not request OS app attention through renderer focus')
        assert.equal(pageFocusRequests, 0, 'background focus commands must not activate the Browser owner')
        owner.isFocused = () => true
        owner.isVisible = () => true
        guest.isFocused = () => false
        await (manager as any).command({ sender: owner.webContents }, { tabId: target.tabId, type: 'blur' })
        assert.equal(shellFocusRequests, 0, 'tab updates preserve another input already focused inside Zyra')
        guest.isFocused = () => true
        await (manager as any).command({ sender: owner.webContents }, { tabId: target.tabId, type: 'blur' })
        await (manager as any).command({ sender: owner.webContents }, { tabId: target.tabId, type: 'focus' })
        assert.equal(shellFocusRequests, 1, 'an actual foreground Browser blur can hand focus back')
        assert.equal(pageFocusRequests, 1, 'explicit foreground Browser focus still works')
    } finally {
        owner.webContents.focus = originalShellFocus
        guest.focus = originalPageFocus
        owner.isFocused = originalWindowFocused
        owner.isVisible = originalWindowVisible
        guest.isFocused = originalPageFocused
    }
    console.log('PASS: Browser shell command preserves inactive app and existing input ownership')
    // Exercise the actual popup creation + ready lifecycle while spying on
    // activation methods so this regression check never flashes the desktop.
    const popupManager = new BrowserPopupManager({
        createShellWindow: () => new BrowserWindow({ show: false }), requestTab() {}
    })
    try {
        for (const [initialFocus, readyFocus, sourceFocus, disposition, expectedActive] of [
            [false, false, true, 'new-window', 0],
            [true, false, true, 'new-window', 0],
            [true, true, false, 'new-window', 0],
            [true, true, true, 'new-window', 1],
            [true, true, true, 'background-tab', 0]
        ] as const) {
            owner.isFocused = () => initialFocus
            owner.isVisible = () => true
            guest.isFocused = () => sourceFocus
            const popup = (popupManager as any).createPopup(owner, guest, guest.id, {
                url: 'about:blank', disposition, referrer: { url: '', policy: 'default' }, features: ''
            }, {}, Symbol('fixture'))
            if (popup.pageContents.isLoading()) await new Promise<void>(resolve => popup.pageContents.once('did-stop-loading', () => resolve()))
            let active = 0, inactive = 0, focused = 0
            popup.shellWindow.show = () => { active++ }
            popup.shellWindow.showInactive = () => { inactive++ }
            popup.pageContents.focus = () => { focused++ }
            owner.isFocused = () => readyFocus
            popup.shellWindow.webContents.emit('did-finish-load')
            assert.equal(active, expectedActive, `popup activation: ${initialFocus}/${readyFocus}/${sourceFocus}/${disposition}`)
            assert.equal(focused, expectedActive)
            assert.equal(inactive, 1 - expectedActive)
            ;(popupManager as any).disposePopup(popup, true)
            popup.shellWindow.destroy()
        }
    } finally {
        owner.isFocused = originalWindowFocused
        owner.isVisible = originalWindowVisible
        guest.isFocused = originalPageFocused
    }
    console.log('PASS: Browser popups preserve background attention and explicit foreground behavior')

    if (!blankFirst) assert.equal(guest.getURL(), url)
    assert.equal(owner.isVisible(), false, 'background control does not reveal the user window')
    const access = await broker.handleToolOperation(principal, {
        operation: 'request_grant', targetId: target.targetId,
        capabilities: ['observe.structure', 'pointer.click', 'keyboard.type', 'keyboard.key'], durationMs: 60000, maxActions: 20
    }, undefined, { backgrounded, permissionMode: 'full-access' }) as any
    const grant = access.grant
    trace('Access granted')
    assert(access.observation, 'fresh access returns a structural observation without mounting an inspector')
    if (blankFirst) {
        console.log('PASS: fresh blank tab accepted its first control attachment')
        const visualTab = await broker.handleToolOperation(principal, { operation: 'open_tab' }, undefined, { backgrounded }) as any
        assert.equal(visualTab.revealed, false, 'opening a tab defaults to hidden without a reveal argument')
        const visualAccess = await broker.handleToolOperation(principal, {
            operation: 'request_grant', targetId: visualTab.target.targetId, capabilities: ['observe.screenshot'], maxActions: 5
        }, undefined, { backgrounded, permissionMode: 'full-access' }) as any
        const visual = await broker.handleToolOperation(principal, {
            operation: 'observe', targetId: visualTab.target.targetId, grantId: visualAccess.grant.grantId, mode: 'visual', includeScreenshot: true
        }, undefined, { backgrounded }) as any
        assert(visual.observation.screenshotRef, 'a fresh blank tab supports screenshot-first control without prior navigation or structural observation')
        await surface.closeTab(principal, visualTab.target)
        console.log('PASS: default hidden open and screenshot-first attachment on a fresh blank tab')
        await surface.commandTab(principal, target, 'navigate', url)
    }
    broker.revokeForegroundPrincipal(principal)
    const observed = await broker.handleToolOperation(principal, { operation: 'observe', targetId: target.targetId, grantId: grant.grantId }, undefined, { backgrounded }) as any
    const button = observed.observation.elements.find((element: any) => element.name === 'Continue')
    assert(button)
    assert(observed.observation.viewport.width > 2 && observed.observation.viewport.height > 2, 'hidden pages retain a usable control viewport')
    await broker.handleToolOperation(principal, {
        operation: 'act', version: 1, requestId: 'request:native-background', grantId: grant.grantId, targetId: target.targetId,
        observationRevision: observed.observation.revision, action: { type: 'click', elementRef: button.elementRef }
    }, undefined, { backgrounded })
    assert.equal(await guest.executeJavaScript('window.clicks'), 1, 'real CDP clicks work in a hidden background page')

    // Release the selected renderer presentation; the same owned page must live.
    ;(manager as any).releaseFromRenderer({ sender: owner.webContents }, target.tabId)
    await new Promise(resolve => setTimeout(resolve, 850))
    assert(!guest.isDestroyed(), 'background agent pages survive renderer unmount/release')
    assert.equal(await guest.executeJavaScript('window.clicks'), 1)
    const afterRelease = await broker.handleToolOperation(principal, { operation: 'observe', targetId: target.targetId, grantId: grant.grantId }, undefined, { backgrounded }) as any
    const input = afterRelease.observation.elements.find((element: any) => element.name === 'Draft')
    assert(input, 'the hidden input remains observable after changing chats')
    await broker.handleToolOperation(principal, {
        operation: 'act', version: 1, requestId: 'request:hidden-type', grantId: grant.grantId, targetId: target.targetId,
        observationRevision: afterRelease.observation.revision, action: { type: 'type', elementRef: input.elementRef, text: 'Continued in the background' }
    }, undefined, { backgrounded })
    assert.equal(await guest.executeJavaScript('document.querySelector("input").value'), 'Continued in the background', 'real hidden input continues after its renderer releases the page')
    assert.equal(owner.isVisible(), false, 'granting access and typing never reveal the owner window')

    const native = broker.targets.get(target.targetId).driver as any
    const originalCommand = native.command.bind(native)
    const presentationCommands: string[] = []
    native.command = (...args: any[]) => { presentationCommands.push(args[1]); return originalCommand(...args) }
    ;(manager as any).reportSlot({ sender: owner.webContents }, { tabId: target.tabId, revision: 1, bounds: { x: 0, y: 0, width: 640, height: 480 }, contentSize: null, active: true, visible: true })
    await native.syncControlPresentation(guest)
    assert(presentationCommands.includes('Emulation.clearDeviceMetricsOverride'), 'revealing a controlled page restores its native viewport immediately')
    ;(manager as any).releaseFromRenderer({ sender: owner.webContents }, target.tabId)
    await native.syncControlPresentation(guest)
    assert(presentationCommands.includes('Emulation.setDeviceMetricsOverride'), 'releasing the page restores its hidden control viewport')
    native.command = originalCommand
    const cancelled = new AbortController()
    const context = { signal: cancelled.signal, runAgentInput: async (operation: () => Promise<unknown>) => { const result = await operation(); cancelled.abort(); return result } }
    await assert.rejects(native.dispatchKey(guest, 'Enter', [], context), { code: 'CONTROL_CANCELLED' })
    assert.deepEqual(await guest.executeJavaScript('window.keys'), ['keydown', 'keyup'], 'cancellation releases a key that was already pressed')
    await assert.rejects(native.inputCommand(guest, 'Input.insertText', { text: 'leaked' }, context), { code: 'CONTROL_CANCELLED' })

    const abortNavigation = new AbortController()
    const pendingRequest = new Promise<void>(resolve => server.once('request', () => resolve()))
    const navigating = surface.commandTab(principal, target, 'navigate', url + 'pending', abortNavigation.signal)
    const abortedResult = assert.rejects(navigating, { code: 'CONTROL_CANCELLED' })
    await pendingRequest
    abortNavigation.abort()
    await abortedResult
    assert.equal(guest.isLoadingMainFrame(), false, 'cancelled hidden navigation stops the page load')
    await surface.commandTab(principal, target, 'navigate', url)

    const script = browserControlOverlayScript({ controlled: true, cursor: { x: 192, y: 170, visible: true, phase: 'pressing', label: 'Zyra' } })
    await guest.executeJavaScriptInIsolatedWorld(999, [{ code: script }], false)
    const appearance = await guest.executeJavaScriptInIsolatedWorld(999, [{ code: `(() => {const state=globalThis.__zyraControlOverlayState;const svg=state.shadow.querySelector('svg');return {pulse:!!state.shadow.querySelector('.pulse'),icon:svg.classList.contains('lucide-mouse-pointer2'),linecap:svg.getAttribute('stroke-linecap'),linejoin:svg.getAttribute('stroke-linejoin'),label:getComputedStyle(state.shadow.querySelector('.label')).borderRadius}})()` }], false)
    assert.deepEqual(appearance, { pulse: false, icon: true, linecap: 'round', linejoin: 'round', label: '6px' })
    const image = await native.captureRenderedPage(guest)
    assert(image.getSize().width > 2 && image.getSize().height > 2, 'hidden screenshots have a usable viewport')
    const size = image.getSize()
    const pixel = image.toBitmap().subarray((Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4, (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4 + 3)
    assert.deepEqual([...pixel], [25, 20, 16], 'hidden screenshot contains the painted fixture page rather than a blank compositor frame')
    const screenshot = process.env.ZYRA_BACKGROUND_TEST_SCREENSHOT!
    await mkdir(dirname(screenshot), { recursive: true })
    await writeFile(screenshot, image.toPNG())
    await guest.executeJavaScript(`document.body.style.background='#263746'`)
    const updated = await native.captureRenderedPage(guest)
    const updatedSize = updated.getSize()
    const updatedOffset = (Math.floor(updatedSize.height / 2) * updatedSize.width + Math.floor(updatedSize.width / 2)) * 4
    assert.deepEqual([...updated.toBitmap().subarray(updatedOffset, updatedOffset + 3)], [70, 55, 38], 'a second hidden capture shows fresh content rather than the preceding frame')
    console.log('PASS: real hidden Browser open, navigation, retained page, CDP input, cancellation and Lucide cursor')
    console.log('Screenshot: ' + screenshot)
    surface.dispose()
    manager.dispose()
    broker.dispose()
    owner.destroy()
    server.closeAllConnections()
    server.close()
    clearTimeout(deadline)
    app.quit()
}).catch(error => { console.error(error); clearTimeout(deadline); manager?.dispose(); owner?.destroy(); server.closeAllConnections(); server.close(); app.exit(1) })
