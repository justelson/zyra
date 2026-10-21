import assert from 'node:assert/strict'
import { ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, createAssistantComposerQueueStorage, emptyAssistantComposerQueue, moveQueuedDispatch, type PendingComposerDispatch } from '../src/renderer/src/pages/assistant/assistant-composer-queue-storage'

let raw: string | null = null
let quota = false
const storage = createAssistantComposerQueueStorage(() => ({
    getItem: key => { assert.equal(key, ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY); return raw },
    setItem: (_key, value) => { if (quota) throw new Error('quota'); raw = value }
}))
const message = (id: string): PendingComposerDispatch => ({ id, sessionId: 'chat', prompt: id,
    contextFiles: [{ id: 'attachment', path: 'clipboard://synthetic', content: 'complete body', previewDataUrl: 'data:image/png;base64,c3ludGhldGlj', selection: { nested: 'preserved' } as any }],
    options: { runtimeMode: 'full-access', interactionMode: 'default', effort: 'medium', model: 'fixture/model', dispatchMode: 'queue' } })
assert.deepEqual(storage.read(), emptyAssistantComposerQueue())
const snapshot = { version: 1 as const, entries: { chat: [message('one'), message('two'), message('three')] }, held: { chat: false } }
storage.write(snapshot)
const restored = storage.read()
assert.equal(restored.held.chat, true, 'every recovered queue is held even if last snapshot was unheld')
assert.deepEqual(restored.entries.chat, snapshot.entries.chat, 'inline attachment data and nested metadata preserved')
const moved = moveQueuedDispatch(restored.entries.chat!, 'one', 'three')
assert.deepEqual(moved.map(entry => entry.id), ['two', 'three', 'one'])
assert.deepEqual(moveQueuedDispatch(moved, 'one', 'two').map(entry => entry.id), ['one', 'two', 'three'])
assert.equal(moveQueuedDispatch(moved, 'missing', 'two'), moved, 'invalid reorder is no-op')
quota = true
const before = raw
assert.throws(() => storage.write(emptyAssistantComposerQueue()), /quota/)
assert.equal(raw, before, 'failed writes retain previous record')
quota = false
raw = JSON.stringify({ ...snapshot, entries: { chat: [{ ...message('legacy'), options: { ...message('legacy').options, dispatchMode: 'force' } }] } })
assert.equal(storage.read().entries.chat![0]!.options.dispatchMode, 'steer', 'legacy Force migrates without abort semantics')
raw = '{broken'
assert.throws(() => storage.read())
assert.equal(raw, '{broken', 'corrupt recovery record is not overwritten')
raw = JSON.stringify({ version: 1, entries: { chat: [{ ...message('wrong'), sessionId: 'other' }] } })
assert.throws(() => storage.read(), /Invalid queued message/)
assert.throws(() => createAssistantComposerQueueStorage(() => { throw new Error('blocked') }).read(), /blocked/)
const silentlyDroppingStorage = createAssistantComposerQueueStorage(() => ({ getItem: () => null, setItem: () => undefined }))
assert.throws(() => silentlyDroppingStorage.write(snapshot), /could not be saved/)
console.log('Composer queue storage: full payload persistence, held recovery, legacy migration, reorder and fail-closed errors passed')
