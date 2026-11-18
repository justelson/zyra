import assert from 'node:assert/strict'
import { DevicePreferencesService } from '../../src/main/setup/device-preferences-service'
import { createServer } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { AccessoryWindowManager } from '../../src/main/accessory-window-manager'
import { BrowserViewManager, type BrowserViewPresentation } from '../../src/main/browser-view-manager'
import { registerTrustedIpcSender } from '../../src/main/ipc/trusted-ipc'
import { bindTrustedBrowserTarget } from '../../src/main/agent-control'
import { trustedBrowserGuests } from '../../src/main/agent-control/trusted-guest-registry'
import type { AccessoryWindowState } from '../../src/shared/accessories'
import { handleSetBrowserPreviewZoom, handleSetBrowserPreviewColorScheme } from '../../src/main/ipc/handlers/browser-preview-developer-handlers'

const profile = process.env.ZYRA_ACCESSORY_NATIVE_PROFILE!
const shellHtml = process.env.ZYRA_ACCESSORY_NATIVE_HTML!
const preload = process.env.ZYRA_ACCESSORY_NATIVE_PRELOAD!
app.setPath('userData', profile)
app.setPath('sessionData', `${profile}/session`)
const deadline = setTimeout(() => {
    console.error('Accessory Browser native test timed out')
    app.exit(1)
}, 30_000)

const server = createServer((request, response) => {
    const url = request.url || '/'
    if (url === '/normal') response.setHeader('Set-Cookie', 'zyraNormal=kept; Path=/; SameSite=Lax')
    if (url === '/private') response.setHeader('Set-Cookie', 'zyraPrivate=temporary; Path=/; SameSite=Lax')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<title>${url}</title><main>${url}</main><input id="form-state"><canvas id="media-source" width="32" height="32"></canvas><video id="synthetic-media" muted playsinline></video><script>
const canvas = document.querySelector('#media-source');
const context = canvas.getContext('2d');
let frame = 0;
setInterval(() => { context.fillStyle = 'rgb(' + (frame++ % 255) + ',40,80)'; context.fillRect(0, 0, 32, 32); }, 30);
const media = document.querySelector('#synthetic-media');
media.srcObject = canvas.captureStream(12);
globalThis.__mediaStarted = media.play().then(() => true, () => false);
</script>`)
})

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function waitFor(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
        if (await check()) return
        await delay(30)
    }
    throw new Error(message)
}

app.whenReady().then(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const windows = new Map<string, BrowserWindow>()
    let accessoryManager!: AccessoryWindowManager
    const createWindow = (state: AccessoryWindowState) => {
        const window = new BrowserWindow({
            width: 900,
            height: 650,
            show: false,
            webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
        })
        windows.set(state.id, window)
        window.once('closed', () => windows.delete(state.id))
        registerTrustedIpcSender(window.webContents, (url) => url.startsWith('file:'))
        void window.loadFile(shellHtml)
        return window
    }
    accessoryManager = new AccessoryWindowManager({ rootPath: profile, createWindow, preferences: new DevicePreferencesService(profile + '/preferences.json') })
    accessoryManager.registerIpc()
    const presentations = new Map<string, BrowserViewPresentation>()
    let failNextPopupOwnerTransfer = false
    const browserManager = new BrowserViewManager({
        popupManager: {
            registerGuest: () => undefined,
            transferGuestOwner: () => {
                if (!failNextPopupOwnerTransfer) return
                failNextPopupOwnerTransfer = false
                throw new Error('Synthetic popup owner transfer failure')
            }
        },
        resolveOwnerId: (window) => {
            const id = accessoryManager.windowIdForWebContents(window.webContents.id)
            return id ? `accessory:${id}` : null
        },
        canUseBrowser: () => true
    })
    accessoryManager.setBrowserViews(browserManager)
    browserManager.registerIpc()
    browserManager.observePresentation((presentation) => presentations.set(presentation.tabId, presentation))

    const opened = accessoryManager.open({ kind: 'browser', sessionMode: 'normal', url: `${origin}/normal` })
    assert.equal(opened.success, true)
    if (!opened.success) throw new Error(opened.error)
    const normalWindow = windows.get(opened.state.id)!
    await waitFor(() => !normalWindow.webContents.isLoading(), 'Accessory shell did not load')
    const queued = await normalWindow.webContents.executeJavaScript('window.accessoryNative.getState()')
    assert.equal(queued.success, true)
    assert.equal(queued.state.requests.length, 1, 'URL navigation stays queued until renderer acknowledgement')
    const request = queued.state.requests[0]
    const badOwner = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: `browser:accessory:${opened.state.id}:bad`, threadId: 'chat:wrong', sessionMode: 'normal' })})`)
    assert.equal(badOwner.success, false, 'Accessory Browser rejects a Chat owner identity')

    const normalTabId = `browser:accessory:${opened.state.id}:0`
    const ensured = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId, threadId: `accessory:${opened.state.id}`, sessionMode: 'normal', initialUrl: request.url })})`)
    assert.equal(ensured.success, true)
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId, revision: 1, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    await waitFor(() => presentations.get(normalTabId)?.visible === true, 'Native Browser view never became visible')
    assert.deepEqual(presentations.get(normalTabId)?.bounds, { x: 24, y: 72, width: 640, height: 420 })
    await waitFor(() => presentations.get(normalTabId)?.guestWebContents.getURL() === request.url, 'Queued URL did not navigate the native view')
    const registryEntry = trustedBrowserGuests.findByGuestId(presentations.get(normalTabId)!.guestWebContents.id)
    assert.equal(registryEntry?.tabId, normalTabId, 'user browser tools have exact guest ownership without creating an agent-control target')
    const guestId = presentations.get(normalTabId)!.guestWebContents.id
    assert.equal(trustedBrowserGuests.resolveOwned(normalWindow.webContents.id, guestId, normalTabId).guest.id, guestId)
    assert.throws(() => trustedBrowserGuests.resolveOwned(normalWindow.webContents.id + 10000, guestId, normalTabId), /another window/)
    const userEvent = { sender: normalWindow.webContents } as Electron.IpcMainInvokeEvent
    const target = { guestWebContentsId: guestId, tabId: normalTabId }
    const zoom = await handleSetBrowserPreviewZoom(userEvent, { ...target, factor: 1.25 })
    assert.equal(zoom.success, true, 'standalone zoom uses the real developer handler')
    const scheme = await handleSetBrowserPreviewColorScheme(userEvent, { ...target, colorScheme: 'dark' })
    assert.equal(scheme.success, true, 'standalone color emulation uses the real developer handler')
    assert.throws(() => bindTrustedBrowserTarget(normalWindow.webContents.id, presentations.get(normalTabId)!.guestWebContents.id, normalTabId, `accessory:${opened.state.id}`, 'normal'), /cannot become agent-control targets/)
    assert.equal((await presentations.get(normalTabId)!.guestWebContents.session.cookies.get({ url: origin, name: 'zyraNormal' })).length, 1)

    const liveGuest = presentations.get(normalTabId)!.guestWebContents
    assert.equal(await liveGuest.executeJavaScript(`globalThis.__mediaStarted`), true, 'synthetic media started before transfer')
    await waitFor(() => liveGuest.executeJavaScript(`document.querySelector('#synthetic-media').currentTime > 0.05`), 'Synthetic media clock did not advance')
    const mediaTimeBeforeTransfer = await liveGuest.executeJavaScript(`document.querySelector('#synthetic-media').currentTime`)
    await liveGuest.executeJavaScript(`document.querySelector('#form-state').value = 'kept'; globalThis.__tearOffState = { value: 73 }; history.pushState({ token: 91 }, '', '#preserved')`)
    const originalTab = { id: normalTabId, sessionMode: 'normal', url: request.url, title: 'Stateful tab', faviconUrl: null }
    const manyTabs = [originalTab, ...Array.from({ length: 12 }, (_, index) => ({ ...originalTab, id: `${normalTabId}:extra:${index}`, url: '', title: `New tab ${index}` }))]
    const acceptedMany = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.syncBrowserTabs(${JSON.stringify({ workspaceId: opened.state.id, activeTabId: normalTabId, tabs: manyTabs })})`)
    assert.equal(acceptedMany.state.browserTabs.length, 13, 'the main process preserves more than eight Browser tabs without truncating the sync')
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.syncBrowserTabs(${JSON.stringify({ workspaceId: opened.state.id, activeTabId: normalTabId, tabs: [originalTab] })})`)
    const beginRollback = normalWindow.webContents.executeJavaScript(`window.accessoryNative.beginBrowserTabTearOff(${JSON.stringify({ workspaceId: opened.state.id, tabId: normalTabId, screenPoint: { x: 420, y: 160 }, grabOffset: { x: 120, y: 16 } })})`)
    await waitFor(() => windows.size === 2, 'Rollback tear-off destination was not created')
    const rollbackEntry = [...windows.entries()].find(([id]) => id !== opened.state.id)!
    const rollbackWindow = rollbackEntry[1]
    await waitFor(() => !rollbackWindow.webContents.isLoading(), 'Rollback tear-off shell did not load')
    const rollbackState = await rollbackWindow.webContents.executeJavaScript('window.accessoryNative.getState()')
    assert.equal(rollbackState.success, true)
    assert.equal(rollbackState.state.browserTabs[0].id, normalTabId)
    const rollbackEnsure = await rollbackWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId, threadId: `accessory:${rollbackEntry[0]}`, sessionMode: 'normal' })})`)
    assert.equal(rollbackEnsure.success, true, 'pending destination can prepare a slot for the same live tab')
    await rollbackWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId, revision: 10, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const rollbackSession = await beginRollback
    assert.equal(rollbackSession.success, true)
    assert.equal(presentations.get(normalTabId)?.guestWebContents.id, guestId, 'tear-off reparents the same WebContents')
    assert.equal(await liveGuest.executeJavaScript(`document.querySelector('#form-state').value + ':' + globalThis.__tearOffState.value`), 'kept:73', 'form DOM and JavaScript state survive reparenting')
    assert.equal(await liveGuest.executeJavaScript(`!document.querySelector('#synthetic-media').paused && document.querySelector('#synthetic-media').currentTime >= ${mediaTimeBeforeTransfer}`), true, 'active media keeps playing through reparenting')
    assert.equal(await liveGuest.executeJavaScript(`location.hash + ':' + history.state.token`), '#preserved:91', 'navigation entry and history state survive reparenting')
    const cancelled = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.cancelBrowserTabTearOff(${JSON.stringify(rollbackSession.sessionId)})`)
    assert.equal(cancelled.success, true)
    await waitFor(() => presentations.get(normalTabId)?.ownerWindow === normalWindow, 'cancelled tear-off did not roll the live view back')
    await waitFor(() => windows.size === 1, 'cancelled tear-off left a provisional window behind')
    assert.equal(await liveGuest.executeJavaScript(`document.querySelector('#form-state').value + ':' + globalThis.__tearOffState.value`), 'kept:73', 'rollback keeps live page state')
    assert.equal(await liveGuest.executeJavaScript(`!document.querySelector('#synthetic-media').paused`), true, 'rollback does not pause active media')

    const beginFailure = normalWindow.webContents.executeJavaScript(`window.accessoryNative.beginBrowserTabTearOff(${JSON.stringify({ workspaceId: opened.state.id, tabId: normalTabId, screenPoint: { x: 460, y: 175 }, grabOffset: { x: 120, y: 16 } })})`)
    await waitFor(() => windows.size === 2, 'Failure rollback destination was not created')
    const failureEntry = [...windows.entries()].find(([id]) => id !== opened.state.id)!
    const failureWindow = failureEntry[1]
    await waitFor(() => !failureWindow.webContents.isLoading(), 'Failure rollback shell did not load')
    const failureEnsure = await failureWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId, threadId: `accessory:${failureEntry[0]}`, sessionMode: 'normal' })})`)
    assert.equal(failureEnsure.success, true)
    failNextPopupOwnerTransfer = true
    await failureWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId, revision: 20, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const failedTransfer = await beginFailure
    assert.equal(failedTransfer.success, false)
    assert.match(failedTransfer.error, /Synthetic popup owner transfer failure/)
    await waitFor(() => windows.size === 1, 'Failed transfer left a provisional window behind')
    assert.equal(presentations.get(normalTabId)?.ownerWindow, normalWindow, 'dependency failure restores the native view to its exact source')
    assert.equal(trustedBrowserGuests.resolveOwned(normalWindow.webContents.id, guestId, normalTabId).ownerThreadId, `accessory:${opened.state.id}`, 'dependency failure restores trusted guest owner metadata')
    assert.equal(await liveGuest.executeJavaScript(`globalThis.__tearOffState.value`), 73, 'dependency failure does not recreate the page')

    const acknowledged = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.acknowledge(${JSON.stringify(request.id)})`)
    assert.equal(acknowledged.success, true)
    assert.equal(acknowledged.state.requests.length, 0)
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId, revision: 2, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: false })})`)
    await waitFor(() => presentations.get(normalTabId)?.visible === false, 'Native Browser view ignored standalone visibility')
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.close(${JSON.stringify(normalTabId)})`)

    const normalTabId2 = `browser:accessory:${opened.state.id}:1`
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId2, threadId: `accessory:${opened.state.id}`, sessionMode: 'normal', initialUrl: `${origin}/echo` })})`)
    await waitFor(() => presentations.get(normalTabId2)?.guestWebContents.getURL() === `${origin}/echo`, 'Second normal tab did not load')
    assert.equal((await presentations.get(normalTabId2)!.guestWebContents.session.cookies.get({ url: origin, name: 'zyraNormal' })).length, 1, 'Normal Browser tabs retain the global profile cookie')
    await presentations.get(normalTabId2)!.guestWebContents.executeJavaScript(`document.querySelector('main').dataset.transfer = 'same-page'`)
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.syncBrowserTabs({ workspaceId: ${JSON.stringify(opened.state.id)}, activeTabId: ${JSON.stringify(normalTabId2)}, tabs: [{ id: ${JSON.stringify(normalTabId2)}, sessionMode: 'normal', url: ${JSON.stringify(`${origin}/echo`)}, title: 'Transfer tab', faviconUrl: null }] })`)
    const beginCommit = normalWindow.webContents.executeJavaScript(`window.accessoryNative.beginBrowserTabTearOff(${JSON.stringify({ workspaceId: opened.state.id, tabId: normalTabId2, screenPoint: { x: 720, y: 210 }, grabOffset: { x: 100, y: 16 } })})`)
    await waitFor(() => windows.size === 2, 'Committed tear-off destination was not created')
    const commitEntry = [...windows.entries()].find(([id]) => id !== opened.state.id)!
    const commitWindow = commitEntry[1]
    await waitFor(() => !commitWindow.webContents.isLoading(), 'Committed tear-off shell did not load')
    await commitWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId2, threadId: `accessory:${commitEntry[0]}`, sessionMode: 'normal' })})`)
    await commitWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId2, revision: 11, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const commitSession = await beginCommit
    assert.equal(commitSession.success, true)
    const committed = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.finishBrowserTabTearOff(${JSON.stringify({ sessionId: commitSession.sessionId, screenPoint: { x: 720, y: 210 } })})`)
    assert.equal(committed.success, true)
    assert.equal(committed.committed, true)
    assert.equal(presentations.get(normalTabId2)?.ownerWindow, commitWindow)
    assert.equal(await presentations.get(normalTabId2)!.guestWebContents.executeJavaScript(`document.querySelector('main').dataset.transfer`), 'same-page')
    assert.equal((await presentations.get(normalTabId2)!.guestWebContents.session.cookies.get({ url: origin, name: 'zyraNormal' })).length, 1, 'successful tear-off keeps the normal profile session')

    normalWindow.show()
    const dropZone = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.registerBrowserDropZone(${JSON.stringify({
        workspaceId: opened.state.id,
        rect: { x: 0, y: 0, width: 1_000, height: 120 },
        tabSlots: [{ tabId: normalTabId2, index: 0, left: 0, right: 220 }]
    })})`)
    assert.equal(dropZone.success, true)
    const beginMergeBack = commitWindow.webContents.executeJavaScript(`window.accessoryNative.beginBrowserTabTearOff(${JSON.stringify({ workspaceId: commitEntry[0], tabId: normalTabId2, screenPoint: { x: 760, y: 220 }, grabOffset: { x: 100, y: 16 } })})`)
    await waitFor(() => windows.size === 3, 'Merge-back provisional destination was not created')
    const mergeProvisionalEntry = [...windows.entries()].find(([id]) => id !== opened.state.id && id !== commitEntry[0])!
    const mergeProvisionalWindow = mergeProvisionalEntry[1]
    await waitFor(() => !mergeProvisionalWindow.webContents.isLoading(), 'Merge-back provisional shell did not load')
    await mergeProvisionalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId2, threadId: `accessory:${mergeProvisionalEntry[0]}`, sessionMode: 'normal' })})`)
    await mergeProvisionalWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId2, revision: 22, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const mergeSession = await beginMergeBack
    assert.equal(mergeSession.success, true)
    const finishMergeBack = commitWindow.webContents.executeJavaScript(`window.accessoryNative.finishBrowserTabTearOff(${JSON.stringify({ sessionId: mergeSession.sessionId, screenPoint: { x: 100, y: 60 } })})`)
    await delay(30)
    const mergeEnsure = await normalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: normalTabId2, threadId: `accessory:${opened.state.id}`, sessionMode: 'normal' })})`)
    assert.equal(mergeEnsure.success, true, JSON.stringify(mergeEnsure))
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: normalTabId2, revision: 23, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const mergedBack = await finishMergeBack
    assert.equal(mergedBack.success, true, JSON.stringify(mergedBack))
    assert.equal(mergedBack.committed, true)
    assert.equal(mergedBack.targetWorkspaceId, opened.state.id)
    assert.equal(presentations.get(normalTabId2)?.ownerWindow, normalWindow, 'a compatible tab strip accepts the same live WebContentsView')
    assert.equal(await presentations.get(normalTabId2)!.guestWebContents.executeJavaScript(`document.querySelector('main').dataset.transfer`), 'same-page', 'drag-back merge does not recreate the page')

    const sourceCloseTabId = `browser:accessory:${opened.state.id}:2`
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: sourceCloseTabId, threadId: `accessory:${opened.state.id}`, sessionMode: 'normal', initialUrl: `${origin}/echo` })})`)
    await waitFor(() => presentations.get(sourceCloseTabId)?.guestWebContents.getURL() === `${origin}/echo`, 'Source-close tab did not load')
    await presentations.get(sourceCloseTabId)!.guestWebContents.executeJavaScript(`globalThis.__sourceCloseState = 'alive'`)
    await normalWindow.webContents.executeJavaScript(`window.accessoryNative.syncBrowserTabs({ workspaceId: ${JSON.stringify(opened.state.id)}, activeTabId: ${JSON.stringify(sourceCloseTabId)}, tabs: [{ id: ${JSON.stringify(sourceCloseTabId)}, sessionMode: 'normal', url: ${JSON.stringify(`${origin}/echo`)}, title: 'Source close tab', faviconUrl: null }] })`)
    const beginSourceClose = normalWindow.webContents.executeJavaScript(`window.accessoryNative.beginBrowserTabTearOff(${JSON.stringify({ workspaceId: opened.state.id, tabId: sourceCloseTabId, screenPoint: { x: 810, y: 240 }, grabOffset: { x: 100, y: 16 } })})`)
    await waitFor(() => windows.size === 3, 'Source-close tear-off destination was not created')
    const sourceCloseEntry = [...windows.entries()].find(([id]) => id !== opened.state.id && id !== commitEntry[0])!
    const sourceCloseWindow = sourceCloseEntry[1]
    await waitFor(() => !sourceCloseWindow.webContents.isLoading(), 'Source-close tear-off shell did not load')
    await sourceCloseWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: sourceCloseTabId, threadId: `accessory:${sourceCloseEntry[0]}`, sessionMode: 'normal' })})`)
    await sourceCloseWindow.webContents.executeJavaScript(`window.accessoryNative.report(${JSON.stringify({ tabId: sourceCloseTabId, revision: 12, bounds: { x: 24, y: 72, width: 640, height: 420 }, contentSize: { width: 640, height: 420 }, active: true, visible: true })})`)
    const sourceCloseSession = await beginSourceClose
    assert.equal(sourceCloseSession.success, true)
    normalWindow.close()
    await waitFor(() => windows.size === 2, 'Source Browser did not close after its live tab moved')
    await waitFor(async () => {
        const state = await sourceCloseWindow.webContents.executeJavaScript('window.accessoryNative.getState()')
        return state.success && !state.state.provisional
    }, 'Closing the source did not commit the already transferred Browser')
    assert.equal(presentations.get(sourceCloseTabId)?.ownerWindow, sourceCloseWindow, 'source closure keeps the transferred view alive')
    assert.equal(await presentations.get(sourceCloseTabId)!.guestWebContents.executeJavaScript(`globalThis.__sourceCloseState`), 'alive', 'source closure keeps live JavaScript state')

    const incognitoOpen = accessoryManager.open({ kind: 'browser', sessionMode: 'incognito' })
    assert.equal(incognitoOpen.success, true)
    if (!incognitoOpen.success) throw new Error(incognitoOpen.error)
    const incognitoWindow = windows.get(incognitoOpen.state.id)!
    await waitFor(() => !incognitoWindow.webContents.isLoading(), 'Incognito accessory shell did not load')
    const privateTabId = `browser:accessory:${incognitoOpen.state.id}:0`
    await incognitoWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: privateTabId, threadId: `accessory:${incognitoOpen.state.id}`, sessionMode: 'incognito', initialUrl: `${origin}/private` })})`)
    await waitFor(() => presentations.get(privateTabId)?.guestWebContents.getURL() === `${origin}/private`, 'Incognito tab did not load')
    assert.equal((await presentations.get(privateTabId)!.guestWebContents.session.cookies.get({ url: origin, name: 'zyraPrivate' })).length, 1)
    await incognitoWindow.webContents.executeJavaScript(`window.accessoryNative.close(${JSON.stringify(privateTabId)})`)
    await delay(100)
    const privateTabId2 = `browser:accessory:${incognitoOpen.state.id}:1`
    await incognitoWindow.webContents.executeJavaScript(`window.accessoryNative.ensure(${JSON.stringify({ tabId: privateTabId2, threadId: `accessory:${incognitoOpen.state.id}`, sessionMode: 'incognito', initialUrl: `${origin}/echo` })})`)
    await waitFor(() => presentations.get(privateTabId2)?.guestWebContents.getURL() === `${origin}/echo`, 'Replacement incognito tab did not load')
    assert.equal((await presentations.get(privateTabId2)!.guestWebContents.session.cookies.get({ url: origin, name: 'zyraPrivate' })).length, 0, 'Closing the last incognito tab discards its cookies')
    await assert.rejects(
        browserManager.transferTo(privateTabId2, sourceCloseWindow, {
            expectedSourceWindow: incognitoWindow,
            expectedSourceOwnerId: `accessory:${incognitoOpen.state.id}`,
            expectedSessionMode: 'normal',
            destinationThreadId: `accessory:${sourceCloseEntry[0]}`
        }),
        /session mode/,
        'normal and incognito owners cannot merge the same live page'
    )
    assert.equal(presentations.get(privateTabId2)?.ownerWindow, incognitoWindow, 'rejected isolation transfer leaves ownership unchanged')

    console.log('Accessory Browser native tear-off, rollback, ownership, state, and session isolation: ok')
    clearTimeout(deadline)
    server.close()
    app.exit(0)
}).catch((error) => {
    console.error(error)
    clearTimeout(deadline)
    server.close()
    app.exit(1)
})
