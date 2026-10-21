import assert from 'node:assert/strict'
import { mock } from 'bun:test'

// Actual production navigation/cycling/store helpers, isolated from the app and user storage.
const storage = new Map<string, string>()
;(globalThis as any).window = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener() {}, removeEventListener() {} }
let selected: string | null = 'a'
const visited: string[] = []
const make = (id: string, source = 'root') => ({ id, archived: false, createdAt: '2026-10-21T00:00:00Z', activeThreadId: `${id}-thread`, threads: [{ id: `${id}-thread`, source, messages: [{ role: 'user', text: 'saved work' }], activities: [] }] })
let sessions: any[] = ['pin', 'a', 'hidden-project', 'b', 'c', 'settled'].map(id => make(id))
mock.module('@/lib/assistant/assistant-store-core', () => ({ assistantStore: {
    getState: () => ({ snapshot: { sessions, selectedSessionId: selected } }),
    selectSession: async (id: string) => { selected = id; visited.push(id); return { success: true } }
} }))
const nav = await import('../src/renderer/src/pages/assistant/assistant-chat-navigation')
const { cycleAssistantChat, selectAssistantChatAt } = await import('../src/renderer/src/pages/assistant/assistant-chat-cycling')
const order = await import('../src/renderer/src/pages/assistant/assistant-agent-inbox-order')
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().targetIds, [], 'cold/unmounted sidebar does not invent a creation sort')
assert.equal(cycleAssistantChat(1), false)
order.setAssistantInboxGroupOrder('chats', ['a', 'hidden-project', 'b', 'inactive-saved', 'c'])
let undo: (() => boolean) | null = null
const value = {
    groups: { pinned: ['pin'], chats: ['a', 'b', 'c'], settled: [] as string[] },
    effective: { pinned: ['pin'], chats: ['a', 'hidden-project', 'b', 'c'] },
    activeSessionId: 'a', scope: 'project-one',
    // Deliberately asynchronous selection acknowledgment: rapid repeats must use the cursor.
    selectSession: (id: string) => { visited.push(id) },
    onOrderChange: (callback: (() => boolean) | null) => { undo = callback }
}
const registration = nav.registerAssistantChatNavigation(value)
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().targetIds, ['pin', 'a', 'b', 'c'])
assert.equal(cycleAssistantChat(1), true); assert.equal(cycleAssistantChat(1), true)
assert.deepEqual(visited.splice(0), ['b', 'c'], 'rapid repeats advance before async selected state catches up')
cycleAssistantChat(1); assert.equal(visited.pop(), 'pin', 'wrap follows final groups')
selectAssistantChatAt(2); assert.equal(visited.pop(), 'b', 'numeric jump uses same visible list')
assert.equal(selectAssistantChatAt(-1), false)
assert.equal(selectAssistantChatAt(1.5), false)
registration.update({ ...value, activeSessionId: 'missing' })
cycleAssistantChat(-1); assert.equal(visited.pop(), 'c', 'missing active row starts reverse at last')
registration.update({ ...value, activeSessionId: 'external-missing' })
cycleAssistantChat(1); assert.equal(visited.pop(), 'pin', 'missing active row starts forward at first')
let snapshot = nav.getAssistantChatNavigationSnapshot()
const input = { action: 'move' as const, owner: snapshot.owner!, expectedRevision: snapshot.revision, group: 'chats' as const, sessionId: 'c', beforeSessionId: 'a' }
const moved = nav.performAssistantChatOrderOperation(input)
assert.equal(moved.success, true)
assert.deepEqual(moved.snapshot.groups.chats, ['c', 'a', 'b'])
assert.deepEqual(moved.snapshot.saved.chats, ['c', 'hidden-project', 'a', 'inactive-saved', 'b'], 'hidden Project and inactive saved slots stay exact')
assert.equal(nav.performAssistantChatOrderOperation(input).success, false, 'stale write rejected')
assert.equal((undo as unknown as () => boolean)(), true, 'agent move uses same UI Undo callback')
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().saved.chats, ['a', 'hidden-project', 'b', 'inactive-saved', 'c'])
snapshot = nav.getAssistantChatNavigationSnapshot()
assert.equal(nav.performAssistantChatOrderOperation({ ...input, expectedRevision: snapshot.revision, sessionId: 'pin' }).success, false, 'no implicit cross-group pinning')
const movedAgain = nav.performAssistantChatOrderOperation({ ...input, expectedRevision: snapshot.revision })
assert.equal(movedAgain.success, true)
order.setAssistantInboxGroupOrder('chats', current => [...current, 'external-write'])
assert.equal((undo as unknown as () => boolean)(), false, 'intervening shared-store write makes Undo stale')
// Authenticated subsets cannot inspect/move foreign IDs, including an All Projects sidebar.
order.setAssistantInboxGroupOrder('chats', ['a', 'hidden-project', 'b', 'inactive-saved', 'c'])
registration.update({ ...value, groups: { pinned: ['pin'], chats: ['a', 'hidden-project', 'b', 'c'], settled: [] } })
snapshot = nav.getAssistantChatNavigationSnapshot(['a', 'c'])
assert.deepEqual(snapshot.targetIds, ['a', 'c'])
assert.deepEqual(snapshot.saved.chats, ['a', 'c'])
const authorizedMove = nav.performAssistantChatOrderOperation({ ...input, expectedRevision: snapshot.revision, allowedSessionIds: ['a', 'c'] })
assert.equal(authorizedMove.success, true)
assert.deepEqual(authorizedMove.snapshot.targetIds, ['c', 'a'], 'receipt does not reveal foreign rows')
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().groups.chats, ['c', 'hidden-project', 'b', 'a'], 'unauthorized visible slots remain fixed')
assert.deepEqual(order.getAssistantInboxOrderSnapshot().order.chats, ['c', 'hidden-project', 'b', 'inactive-saved', 'a'])
assert.equal(nav.performAssistantChatOrderOperation({ action: 'undo', owner: authorizedMove.snapshot.owner!, expectedRevision: authorizedMove.snapshot.revision, undoToken: 'undoToken' in authorizedMove ? authorizedMove.undoToken! : '', allowedSessionIds: ['b'] }).success, false, 'Undo cannot target another authorized scope')
assert.equal((undo as unknown as () => boolean)(), true)
snapshot = nav.getAssistantChatNavigationSnapshot()
const denied = nav.performAssistantChatOrderOperation({ ...input, expectedRevision: snapshot.revision, beforeSessionId: 'b', allowedSessionIds: ['a', 'c'] })
assert.equal(denied.success, false)
assert.deepEqual(denied.snapshot.targetIds, ['a', 'c'])
// Expansion/paging/status changes publish the exact committed rows, never a competing sort.
registration.update({ ...value, groups: { ...value.groups, chats: ['b', 'a', 'c'], settled: ['settled'] } })
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().targetIds, ['pin', 'b', 'a', 'c', 'settled'])
const newer = nav.registerAssistantChatNavigation({ ...value, groups: { pinned: [], chats: ['c'], settled: [] } })
registration.dispose()
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().targetIds, ['c'], 'older cleanup cannot clear newer owner')
newer.dispose()
assert.equal(nav.getAssistantChatNavigationSnapshot().source, 'last-known-sidebar')
sessions = [make('c', 'subagent')]
assert.deepEqual(nav.getAssistantChatNavigationSnapshot().targetIds, [], 'cached fallback excludes supporting transcripts')
sessions = [make('c')]
const routes: string[] = []
selected = null
assert.equal(selectAssistantChatAt(0, ((path: string) => routes.push(path)) as any), true)
assert.equal(visited.pop(), 'c')
assert.ok(routes[0]?.includes('/assistant/chat/c'), 'unmounted traversal navigates to exact Chat route')
const reloaded = order.parseAssistantInboxOrder(storage.get(order.ASSISTANT_INBOX_ORDER_STORAGE_KEY) || null)
assert.deepEqual(reloaded, order.getAssistantInboxOrderSnapshot().order, 'same saved JSON can rehydrate')
assert.deepEqual(order.reorderAssistantInboxSlots(['new', 'a', 'hidden-project', 'b'], ['a', 'hidden-project', 'inactive-saved', 'b'], ['new', 'a', 'b'], 'b', 'new', 'before'), ['b', 'new', 'hidden-project', 'inactive-saved', 'a'], 'new unsaved IDs are materialized without disturbing hidden slots')
console.log('PASS assistant Chat navigation: final groups, numeric/cycle/rapid/wrap/missing, CAS move/Undo/shared writer, hidden slots, owner cleanup, cached exact route and supporting-transcript exclusion')
