import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { mergeCanonicalCompletionReceipt } from '../src/main/assistant/service-canonical-presence'

const noop = () => undefined
class Window extends EventEmitter {
    focused = true; visible = true; minimized = false
    isFocused() { return this.focused }; isVisible() { return this.visible }; isMinimized() { return this.minimized }
}
const window = new Window()
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop, grants: { list: () => [], listPending: () => [] } }) }))
mock.module('electron', () => ({
    app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static fromWebContents() { return window }; static getAllWindows() { return [] } },
    Notification: class { static isSupported() { return false } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const { AssistantService } = await import('../src/main/assistant/service')
const { reportDesktopThreadView } = await import('../src/main/assistant/thread-view-window')
const { selectAssistantSessionAction } = await import('../src/main/assistant/service-session-actions')
const now = new Date().toISOString()
const thread = createAssistantThread(now)
thread.providerThreadId = 'canonical-one'
thread.latestTurn = { id: 'completed-one', state: 'completed', requestedAt: now, startedAt: now, completedAt: now, assistantMessageId: null }
const session = createAssistantSessionRecord({ sessionId: 'session-one', title: 'Test', projectPath: null, createdAt: now, thread })
const harness: any = Object.create(AssistantService.prototype)
harness.state = { snapshot: { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }, events: [] }
harness.threadViews = new Map()
harness.ensureReady = async () => undefined
const canonical: any[] = []
harness.runtime = { reportCanonicalChatView: async (...args: any[]) => { canonical.push(args) }, setNavigationBackgrounded: noop }
let sequence = 0
harness.appendEvent = (type: any, occurredAt: string, payload: any, sessionId: string, threadId: string) => {
    harness.state.snapshot = applyAssistantDomainEvent(harness.state.snapshot, { eventId: `event-${++sequence}`, sequence, type, occurredAt, payload, sessionId, threadId })
}
const current = () => harness.state.snapshot.sessions[0].threads[0]
await selectAssistantSessionAction({ ensureReady: harness.ensureReady, getSnapshot: () => harness.state.snapshot, runtime: harness.runtime, appendEvent: harness.appendEvent } as any, session.id)
assert.equal(current().lastSeenCompletedTurnId, null, 'selection alone does not claim the user read a completion')
const sender: any = new EventEmitter(); sender.id = 7; sender.isDestroyed = () => false
const report = (id: string, input: any) => harness.setThreadView(id, input)
window.focused = false
await reportDesktopThreadView(sender, { threadId: thread.id, viewing: true }, report)
assert.equal(current().lastSeenCompletedTurnId, null, 'background desktop selection stays unread')
window.focused = true; window.minimized = true
await reportDesktopThreadView(sender, { threadId: thread.id, viewing: true }, report)
assert.equal(current().lastSeenCompletedTurnId, null, 'minimized window cannot report viewing')
window.minimized = false
await reportDesktopThreadView(sender, { threadId: thread.id, viewing: true }, report)
assert.equal(current().lastSeenCompletedTurnId, 'completed-one', 'visible native window persists read into the projector')
assert.equal(canonical.at(-1)[0], 'canonical-one')
assert.equal(canonical.at(-1)[1].seenTurnId, 'completed-one')
window.emit('blur'); await Promise.resolve(); await Promise.resolve()
assert.equal(harness.threadViews.size, 0, 'native blur clears the foreground reader')
assert.equal(current().lastSeenCompletedTurnId, 'completed-one', 'leaving preserves the read completion')
assert.equal(mergeCanonicalCompletionReceipt('new-read', 'older-read', 'new-read'), 'new-read', 'a late catalog response cannot revive Done')
assert.equal(mergeCanonicalCompletionReceipt('older-read', 'new-read', 'new-read'), 'new-read', 'another surface read is imported')
await harness.setThreadView('browser:test', { threadId: thread.id, viewing: true }, 'browser')
assert.equal(canonical.at(-1)[1].surface, 'browser')
sender.emit('destroyed'); await Promise.resolve()
console.log('PASS: selection versus actual view, minimized/native focus guard, canonical acknowledgment, durable local projection and stale receipt merge')
