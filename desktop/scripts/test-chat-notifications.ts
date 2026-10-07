import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ChatNotifications, type ChatAttentionNotice } from '../src/main/assistant/chat-notifications'

let chat: any = { title: 'Test chat', presence: { viewers: [], attention: null, latestTurn: { id: 'turn-one', state: 'completed' } } }
const toasts: Toast[] = []
const opened: string[] = []
class Toast extends EventEmitter {
    shown = false; closed = false
    constructor(readonly options: { title: string; body: string }) { super() }
    show() { this.shown = true }
    close() { this.closed = true }
}
const manager = new ChatNotifications({
    readChat: async () => chat,
    create: options => { const toast = new Toast(options); toasts.push(toast); return toast },
    openChat: async id => { opened.push(id) }, failed: error => { throw error }
})
const done: ChatAttentionNotice = { canonicalChatId: 'chat-one', token: 'done-one', kind: 'completed', turnId: 'turn-one' }
await manager.receive(done); await manager.receive(done)
assert.equal(toasts.length, 1); assert.equal(toasts[0].shown, true)
assert.equal(toasts[0].options.title, 'Chat finished')
toasts[0].emit('click'); await Promise.resolve()
assert.deepEqual(opened, ['chat-one']); assert.equal(toasts[0].closed, true)
chat.presence.viewers = [{ surface: 'mobile' }]
await manager.receive({ ...done, token: 'seen-elsewhere' }); assert.equal(toasts.length, 1)
chat.presence.viewers = []; chat.lastSeenCompletedTurnId = 'turn-one'
await manager.receive({ ...done, token: 'already-read' }); assert.equal(toasts.length, 1)
chat.presence.attention = 'user-input'
await manager.receive({ ...done, token: 'input-one', kind: 'input' }); assert.equal(toasts.at(-1)?.options.title, 'Input needed')
chat.presence.attention = null; await manager.refresh('chat-one'); assert.equal(toasts.at(-1)?.closed, true)
chat.presence.attention = 'approval'
await manager.receive({ ...done, token: 'approval-one', kind: 'approval' }); assert.equal(toasts.at(-1)?.options.title, 'Approval needed')
chat.presence.viewers = [{ surface: 'browser' }]; await manager.refresh(); assert.equal(toasts.at(-1)?.closed, true)
chat = null; await manager.receive({ ...done, token: 'gone' }); assert.equal(toasts.length, 3)
manager.dispose()
console.log('PASS: notification deduplication, canonical visibility/read suppression, dismissal and exact-chat click routing')
