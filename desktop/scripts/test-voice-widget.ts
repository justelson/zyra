import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'
import { idleVoiceWidgetState, voiceWidgetHitTest, VOICE_WIDGET_IPC as IPC, type VoiceWidgetLaunch } from '../src/shared/assistant/voice-widget'

const handlers = new Map<string, (...args: any[]) => any>()
const mouse = { x: -1000, y: -1000 }
mock.module('electron', () => ({ screen: { getCursorScreenPoint: () => mouse } }))
mock.module('../src/main/ipc/trusted-ipc', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } }))
const { VoiceWidgetManager } = await import('../src/main/assistant/voice-widget-manager')
class Contents extends EventEmitter {
    id = 42
    sent: Array<{ channel: string; value: any }> = []
    isDestroyed() { return false }
    isLoadingMainFrame() { return false }
    send(channel: string, value: any) { this.sent.push({ channel, value }) }
}
class Window extends EventEmitter {
    webContents = new Contents()
    visible = false
    destroyed = false
    above = false
    allWorkspaces = false
    ignored = false
    setAlwaysOnTop(value: boolean) { this.above = value }
    setVisibleOnAllWorkspaces(value: boolean) { this.allWorkspaces = value }
    setMenu() {}
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    getBounds() { return { x: 0, y: 0, width: 240, height: 280 } }
    setIgnoreMouseEvents(value: boolean) { this.ignored = value }
    destroy() { this.destroyed = true; this.emit('closed') }
}
const window = new Window(), events: string[] = []
const manager = new VoiceWidgetManager({ createWindow: () => window as any, returnToChat: async launch => { events.push(`return:${launch.conversationId}`) }, onOwnerLost: async () => { events.push('owner-lost') } })
manager.registerIpc()
const owner = { sender: window.webContents }, observer = { sender: new Contents() }
observer.sender.id = 7
const state = () => handlers.get(IPC.getState)!(observer)
const publish = async (status: 'active' | 'idle', callId = state().callId) => handlers.get(IPC.publish)!(owner, callId, { ...idleVoiceWidgetState(), status })
const launch = (id: string): VoiceWidgetLaunch => ({ sessionId: `session-${id}`, conversationId: `thread-${id}`, title: id, options: { instructions: 'Synthetic only.', voice: 'cove', outputModality: 'audio' } })
try {
    const first = await handlers.get(IPC.open)!(observer, launch('A'))
    assert.equal(first.disposition, 'started')
    const callA = state().callId
    assert.equal(window.above && window.allWorkspaces, true)
    await publish('active')
    const before = window.webContents.sent.length
    const second = await handlers.get(IPC.open)!(observer, launch('B'))
    assert.equal(second.disposition, 'handoff-required')
    assert.equal(state().callId, callA, 'Merely requesting Voice in B never ends A')
    assert.equal(window.webContents.sent.slice(before).some(item => item.channel === IPC.receive), false)
    await manager.command({ callId: callA, action: 'return' })
    assert.deepEqual(events, ['return:thread-A'])
    const switching = handlers.get(IPC.open)!(observer, launch('B'), callA)
    await Promise.resolve(); await Promise.resolve()
    const stop = window.webContents.sent.findLast(item => item.channel === IPC.receive)!.value
    assert.equal(stop.action, 'stop')
    assert.equal(state().callId, callA, 'Old call stays authoritative until stop is acknowledged')
    await publish('idle')
    await handlers.get(IPC.complete)!(owner, stop.commandId, { success: true })
    assert.equal((await switching).disposition, 'started')
    const callB = state().callId
    assert.notEqual(callB, callA)
    assert.equal(state().launch.conversationId, 'thread-B')
    await publish('idle', callA)
    assert.equal(state().status, 'connecting', 'Late old-call updates cannot stop the new call')
    assert.equal((await manager.command({ callId: callA, action: 'stop' })).success, false)
    assert.throws(() => handlers.get(IPC.publish)!(observer, callB, idleVoiceWidgetState()), /Only the Voice widget/)
    // Commands during renderer startup wait for the exact new call to register.
    const earlyStop = manager.command({ callId: callB, action: 'stop' })
    const countBeforeReady = window.webContents.sent.filter(item => item.channel === IPC.receive).length
    await Promise.resolve()
    assert.equal(window.webContents.sent.filter(item => item.channel === IPC.receive).length, countBeforeReady)
    await publish('active', callB)
    const nextStop = window.webContents.sent.findLast(item => item.channel === IPC.receive)!.value
    assert.equal(nextStop.callId, callB)
    await publish('idle', callB)
    await handlers.get(IPC.complete)!(owner, nextStop.commandId, { success: true })
    assert.equal((await earlyStop).success, true)
    assert.equal(voiceWidgetHitTest(120, 90), true)
    assert.equal(voiceWidgetHitTest(120, 190), true)
    assert.equal(voiceWidgetHitTest(120, 240), true)
    assert.equal(voiceWidgetHitTest(28, 170), false, 'Transparent rounded control corners pass through')
    assert.equal(voiceWidgetHitTest(18, 222), false, 'Transparent owning-chat corners pass through')
    assert.equal(voiceWidgetHitTest(2, 2), false)
    assert.equal(voiceWidgetHitTest(238, 150), false)
    window.destroy()
    assert.equal(state().status, 'idle')
    assert.equal(events.at(-1), 'owner-lost')
    console.log('PASS: widget owner, explicit handoff, startup command queue, stale events, click-through geometry and owner cleanup')
} finally { window.destroy() }
