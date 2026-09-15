import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { AGENT_CONTROL_IPC } from '../src/shared/agent-control/protocol'
let controller: any
const sent: Array<{ owner: number; channel: string; request: any }> = []
const windowFor = (id: number, url: string) => ({ id, isDestroyed: () => false, webContents: {
    id, isDestroyed: () => false, getURL: () => url,
    send: (channel: string, request: any) => sent.push({ owner: id, channel, request })
} })
const overlay = windowFor(1, 'file:///app/native-overlay.html')
const original = windowFor(2, 'file:///app/index.html#/assistant')
const replacement = windowFor(3, 'file:///app/index.html#/assistant')
let main = original
mock.module('electron', () => ({ app: {}, shell: {}, BrowserWindow: {
    getAllWindows: () => [overlay, main], fromWebContents: (sender: any) => [overlay, original, replacement].find(w => w.webContents === sender)
} }))
mock.module('../src/main/agent-control/index', () => ({ bindTrustedBrowserTarget: () => null, getAgentControlBroker: () => ({
    targets: { list: () => [], get: () => { throw new Error('not registered') } },
    setBrowserSurfaceController: (value: any) => { controller = value }, on: () => {}
}) }))
mock.module('../src/main/agent-control/windows-control-overlay', () => ({ isWindowsControlOverlayWindow: () => false }))
const { createAgentControlHandlers } = await import('../src/main/ipc/handlers/agent-control-handlers')
const handlers = createAgentControlHandlers(original as any, () => main as any)
const principal = { type: 'root', threadId: 'fixture:chat', turnId: 'fixture:turn' }
for (const expected of [original, replacement]) {
    main = expected
    const abort = new AbortController()
    const opened = controller.openTab(principal, true, 'normal', abort.signal)
    const rejection = assert.rejects(opened, /cancelled/)
    const delivery = sent.at(-1)!
    assert.equal(delivery.owner, expected.id, 'auxiliary overlays never receive new Browser requests; recreated main windows do')
    assert.equal(delivery.channel, AGENT_CONTROL_IPC.browserSurfaceRequested)
    const wrong = await handlers.acknowledgeBrowserSurfaceRequest({ sender: overlay.webContents } as any, delivery.request)
    assert.equal(wrong.success, false, 'another trusted renderer cannot acknowledge the request')
    abort.abort()
    await rejection
    const late = await handlers.acknowledgeBrowserSurfaceRequest({ sender: main.webContents } as any, delivery.request)
    assert.equal(late.success && late.accepted, false, 'a late acknowledgement cannot resurrect a cancelled tab')
}
controller.dispose()
console.log('Browser surface routing: overlay exclusion, recreated main window, owner binding and late cancellation passed.')
