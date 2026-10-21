import assert from 'node:assert/strict'
import {
    ASSISTANT_INBOX_ORDER_STORAGE_KEY,
    applyAssistantInboxOrder,
    compareAssistantInboxCreation,
    moveAssistantInboxItem,
    parseAssistantInboxOrder,
    restoreAssistantInboxItem
} from '../src/renderer/src/pages/assistant/assistant-agent-inbox-order'

const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString()
function item(id: string, day: number, project = 'alpha') {
    return {
        session: { id, createdAt: at(day), updatedAt: at(day), threads: [{
            lastSeenCompletedTurnId: 'seen', latestTurn: { id: 'seen', state: 'completed' },
            messages: [{ id: `${id}-answer`, role: 'assistant', text: 'Saved answer', createdAt: at(day), updatedAt: at(day) }]
        }] },
        project, active: false, status: 'ready', activityAt: at(day), lastSeenCompletedTurnId: 'seen'
    }
}
type Item = ReturnType<typeof item>
const ids = (items: readonly Item[]) => items.map(entry => entry.session.id)
const ordered = (items: readonly Item[], saved: readonly string[] = []) => applyAssistantInboxOrder([...items].sort(compareAssistantInboxCreation), saved)
function check(label: string, run: () => void) { run(); console.log(`PASS: ${label}`) }

const original = [item('old', 1), item('new', 3), item('middle', 2)]
check('default order is creation-descending with deterministic ties, not input/activity order', () => {
    assert.deepEqual(ids(ordered(original)), ['new', 'middle', 'old'])
    assert.deepEqual(ids(ordered([item('b', 1), item('a', 1)])), ['a', 'b'])
    assert.deepEqual(ids(original), ['old', 'new', 'middle'], 'Ordering must not mutate the source list')
    assert.equal(compareAssistantInboxCreation({ session: { id: 'invalid', createdAt: 'invalid' } }, item('old', 1)) > 0, true)
})

const saved = ['old', 'new', 'middle']
check('working/approval/input/completed/read/selected/send metadata never reorder chats', () => {
    for (const status of ['working', 'approval', 'input', 'done', 'stopped', 'ready']) {
        const changed = original.map(entry => entry.session.id === 'old' ? {
            ...entry, active: true, status, activityAt: at(30), lastSeenCompletedTurnId: 'newly-read',
            session: { ...entry.session, updatedAt: at(30), threads: entry.session.threads.map(thread => ({
                ...thread, lastSeenCompletedTurnId: 'newly-read', latestTurn: { id: 'new-turn', state: status === 'working' ? 'running' : 'completed' },
                messages: [...thread.messages, { id: 'sent-message', role: 'user', text: 'Continue', createdAt: at(30), updatedAt: at(30) }]
            })) }
        } : entry)
        assert.deepEqual(ids(ordered(changed)), ['new', 'middle', 'old'], `${status}: default order`)
        assert.deepEqual(ids(ordered(changed, saved)), saved, `${status}: explicit order`)
    }
})

check('newly created chats go above existing manual order', () => {
    assert.deepEqual(ids(ordered([...original, item('created-now', 5)], saved)), ['created-now', ...saved])
    assert.deepEqual(ids(ordered([...original, item('created-later', 6), item('created-now', 5)], saved)), ['created-later', 'created-now', ...saved])
})

check('project-filtered moves swap visible neighbors and preserve hidden chat slots', () => {
    const all = [item('alpha-top', 5), item('beta-top', 4, 'beta'), item('alpha-bottom', 3), item('beta-bottom', 2, 'beta')]
    const allIds = ids(all)
    const visibleIds = ids(all.filter(entry => entry.project === 'alpha'))
    const moved = moveAssistantInboxItem(allIds, visibleIds, 'alpha-bottom', -1)
    assert.deepEqual(moved, ['alpha-bottom', 'beta-top', 'alpha-top', 'beta-bottom'])
    assert.deepEqual(ids(applyAssistantInboxOrder(all, moved).filter(entry => entry.project === 'alpha')), ['alpha-bottom', 'alpha-top'])
    assert.deepEqual(moveAssistantInboxItem(moved, ['alpha-bottom', 'alpha-top'], 'alpha-bottom', 1), allIds)
    assert.deepEqual(moveAssistantInboxItem(allIds, visibleIds, 'alpha-top', -1), allIds)
    assert.deepEqual(moveAssistantInboxItem(allIds, visibleIds, 'missing', 1), allIds)
    assert.deepEqual(allIds, ['alpha-top', 'beta-top', 'alpha-bottom', 'beta-bottom'])
})

check('explicit restore puts an old chat at the top, ahead of unsaved current chats', () => {
    const restored = item('restored-old', 1)
    const current = [item('new-unsaved', 7), ...ordered(original, saved)]
    const next = restoreAssistantInboxItem(ids(current), [...saved, 'inactive-saved'], restored.session.id)
    assert.deepEqual(next, ['restored-old', 'new-unsaved', ...saved, 'inactive-saved'])
    assert.deepEqual(ids(ordered([...current, restored], next)), ['restored-old', 'new-unsaved', ...saved])
    assert.deepEqual(ids(ordered([...current, restored, item('created-after-restore', 8)], next)), ['created-after-restore', 'restored-old', 'new-unsaved', ...saved])
})

check('saved order survives serialization/reload, retaining inactive IDs and section isolation', () => {
    const storage = new Map<string, string>()
    const chats = restoreAssistantInboxItem(saved, ['inactive-saved'], 'restored-old')
    storage.set(ASSISTANT_INBOX_ORDER_STORAGE_KEY, JSON.stringify({ pinned: ['pin-b', 'pin-a'], chats }))
    const reloaded = parseAssistantInboxOrder(storage.get(ASSISTANT_INBOX_ORDER_STORAGE_KEY) ?? null)
    assert.deepEqual(reloaded, { pinned: ['pin-b', 'pin-a'], chats })
    assert.deepEqual(ids(ordered([...original, item('restored-old', 1)], reloaded.chats)), ['restored-old', ...saved])
    assert.deepEqual(ids(ordered([item('pin-a', 4), item('pin-b', 2)], reloaded.pinned)), ['pin-b', 'pin-a'])
    assert.deepEqual(parseAssistantInboxOrder('{invalid'), { pinned: [], chats: [] })
    assert.deepEqual(parseAssistantInboxOrder(null), { pinned: [], chats: [] })
    assert.deepEqual(parseAssistantInboxOrder(JSON.stringify({ pinned: ['a', 'a', null, 7], chats: 'invalid' })), { pinned: ['a'], chats: [] })
})
