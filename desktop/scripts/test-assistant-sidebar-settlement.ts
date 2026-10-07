import assert from 'node:assert/strict'
import type { AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { getSidebarSettlementActivityKey, isSidebarSettlementCurrent, upgradeSidebarSettlementOverrides, isAssistantChatSettled, AUTO_SETTLE_AFTER_MS } from '../src/renderer/src/pages/assistant/assistant-sidebar-settlement'

const createdAt = '2026-01-01T00:00:00Z'
const completedAt = '2026-01-02T00:00:00Z'
const thread = { id: 'thread', messageCount: 4, createdAt, updatedAt: completedAt, messages: [],
    latestTurn: { id: 'turn', state: 'completed', requestedAt: createdAt, completedAt } } as unknown as AssistantThread
const session = { id: 'chat', threads: [thread] } as AssistantSession
const override = { state: 'settled' as const, activityAt: completedAt, activityKey: getSidebarSettlementActivityKey(session) }
const changed = (patch: Partial<AssistantThread>) => ({ ...session, threads: [{ ...thread, ...patch }] })
assert.equal(isSidebarSettlementCurrent(changed({ messages: [{ id: 'message', createdAt: '2026-01-03T00:00:00Z' }] as any }), override), true, 'Loading existing messages does not invalidate settlement')
assert.equal(isSidebarSettlementCurrent(changed({ updatedAt: '2026-01-04T00:00:00Z', model: 'another-model', lastSeenCompletedTurnId: 'turn', canonicalHistoryModifiedAt: '2026-01-04T00:00:00Z' }), override), true, 'Read and settings timestamps do not invalidate settlement')
assert.equal(isSidebarSettlementCurrent(changed({ messageCount: 5 }), override), false, 'A new message without a new turn revives the chat')
assert.equal(isSidebarSettlementCurrent(changed({ latestTurn: { ...thread.latestTurn!, id: 'next-turn' } }), override), false, 'A new turn revives the chat even at the same timestamp')
assert.equal(isSidebarSettlementCurrent(changed({ latestTurn: { ...thread.latestTurn!, state: 'running', completedAt: null } }), override), false, 'Resumed work revives the chat')
const otherThread = { ...thread, id: 'other', latestTurn: null }
const multiple = { ...session, threads: [thread, otherThread] }
assert.equal(getSidebarSettlementActivityKey(multiple), getSidebarSettlementActivityKey({ ...multiple, threads: [otherThread, thread] }), 'Thread ordering is not new activity')
assert.notEqual(getSidebarSettlementActivityKey(multiple), getSidebarSettlementActivityKey({ ...multiple, threads: [thread, { ...otherThread, messageCount: 5 }] }), 'New sibling-thread messages revive the chat')
const legacy = { state: 'settled' as const, activityAt: completedAt }
assert.equal(isSidebarSettlementCurrent(session, legacy), true, 'Legacy persisted settlement survives history loading')
assert.equal(isSidebarSettlementCurrent(changed({ latestTurn: { ...thread.latestTurn!, requestedAt: '2026-01-03T00:00:00Z' } }), legacy), false, 'Legacy settlement does not hide a newer turn')
const upgraded = upgradeSidebarSettlementOverrides({ chat: legacy }, [session])
assert.equal(upgraded.chat.activityKey, override.activityKey)
assert.equal(isSidebarSettlementCurrent(changed({ messageCount: 5 }), upgraded.chat), false, 'Migrated legacy choices detect new messages')
assert.equal(upgradeSidebarSettlementOverrides(upgraded, [session]), upgraded, 'Repeated snapshots preserve the override object')
assert.equal(isSidebarSettlementCurrent(session, { ...legacy, activityAt: 'invalid' }), false)
const presentation = { priority: false, ready: true, activityAt: completedAt, now: Date.parse(completedAt) + AUTO_SETTLE_AFTER_MS }
assert(isAssistantChatSettled(session, {}, presentation), 'Automatic settlement drives every surface from the same metadata')
assert(isAssistantChatSettled(session, { chat: override }, { ...presentation, now: Date.parse(completedAt) }), 'Manual settlement appears immediately')
assert(!isAssistantChatSettled(session, { chat: override }, { ...presentation, priority: true }), 'Sending, active work, approval or pinning suppresses the settled state')
assert(!isAssistantChatSettled(changed({ messageCount: 5 }), { chat: override }, { ...presentation, now: Date.parse(completedAt) }), 'New messages invalidate a settled indicator without a navigation or hydration timestamp')
assert(!isAssistantChatSettled(session, { chat: { ...override, state: 'active' } }, presentation), 'Explicitly unsettled chats remain active')
console.log('Sidebar settlement metadata, legacy choices, new activity, and hydration regressions passed.')
