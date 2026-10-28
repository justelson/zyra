import assert from 'node:assert/strict'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import type { AssistantDomainEvent, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'

const now = '2026-10-01T12:00:00.000Z'
const thread = {
    id: 'settlement-thread', source: 'root', providerThreadId: 'canonical:settlement', model: 'test-model',
    messages: [{ id: 'saved-answer', role: 'assistant', text: 'Keep the visible answer.', createdAt: now, updatedAt: now }],
    activities: [], proposedPlans: [], pendingApprovals: [], pendingUserInputs: [], messageCount: 1,
    state: 'ready', createdAt: now, updatedAt: now,
    latestTurn: { id: 'completed-turn', state: 'completed', requestedAt: now, completedAt: now },
    lastSeenCompletedTurnId: 'completed-turn'
} as unknown as AssistantThread
const session = {
    id: 'settlement-chat', title: 'Settlement continuity', mode: 'work', createdAt: now, updatedAt: now,
    projectPath: null, threads: [thread], activeThreadId: thread.id, threadIds: [thread.id],
    archived: false, settled: false, settlementManual: false
} as AssistantSession
const storage = new Map<string, string>()
const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
let listener: ((payload: { event: AssistantDomainEvent }) => void) | null = null
let bootstrapCalls = 0, hydrationCalls = 0, sequence = 0
const mutations: { id: string; settled: boolean; migrateLegacy: boolean }[] = []
;(globalThis as any).localStorage = localStorage
;(globalThis as any).window = {
    localStorage, setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    devscope: { assistant: {
        bootstrap: async () => { bootstrapCalls++; return { snapshot: assistantStore.getState().snapshot, status: assistantStore.getState().status } },
        hydrateSession: async () => { hydrationCalls++; return { success: false, error: 'Unexpected history reload' } },
        onEvent: (callback: typeof listener) => { listener = callback; return () => { listener = null } },
        settleSession: async (id: string, settled: boolean, migrateLegacy = false) => {
            mutations.push({ id, settled, migrateLegacy })
            listener?.({ event: { eventId: `settlement-${++sequence}`, sequence, type: 'session.updated', occurredAt: now,
                sessionId: id, threadId: thread.id, payload: { sessionId: id, patch: { settled, settlementManual: true } } } })
            ;(assistantStore as any).flushPendingAssistantEvents()
            return { success: true }
        }
    } }
}
const { assistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
const { setChatSettlement } = await import('../src/renderer/src/pages/assistant/assistant-chat-menu-state')
const { setAssistantSettlementOverrides, migrateCanonicalSettlementOverrides } = await import('../src/renderer/src/pages/assistant/assistant-settlement-store')
;(assistantStore as any).state = { ...assistantStore.getState(), snapshot: { ...createDefaultAssistantSnapshot(), sessions: [session], selectedSessionId: session.id }, hydrated: true }
;(assistantStore as any).ensureEventStream()
const loading: boolean[] = []
const unsubscribe = assistantStore.subscribe(() => loading.push(assistantStore.getState().hydrating))
const selected = () => assistantStore.getState().snapshot.sessions[0]!
const assertContinuity = () => {
    assert.equal(bootstrapCalls, 0, 'Settlement must not bootstrap/reload the whole assistant')
    assert.equal(hydrationCalls, 0, 'Settlement must not request the selected thread history again')
    assert(!loading.includes(true), 'Settling metadata must never put the open thread into loading')
    assert.equal(assistantStore.getState().snapshot.selectedSessionId, session.id, 'Settlement preserves the selected chat')
    assert.strictEqual(selected().threads[0], thread, 'Metadata keeps the existing thread and timeline identity')
    assert.equal(selected().threads[0]!.messages[0]!.text, 'Keep the visible answer.')
}
await setChatSettlement(session, true)
assert.equal(selected().settled, true, 'The canonical metadata event updates settlement without a refresh')
assertContinuity()
await setChatSettlement(selected(), false)
assert.equal(selected().settled, false, 'Restore uses the same metadata-only path')
assertContinuity()
// Cleaning up a migrated local override must not trigger a second full refresh.
setAssistantSettlementOverrides({ [session.id]: { state: 'active', activityAt: now } })
await migrateCanonicalSettlementOverrides([selected()])
assertContinuity()
// A real legacy migration also emits metadata rather than reloading the history.
setAssistantSettlementOverrides({ [session.id]: { state: 'settled', activityAt: now } })
await migrateCanonicalSettlementOverrides([{ ...selected(), settlementManual: false }])
assert.equal(mutations.at(-1)?.migrateLegacy, true)
assert.equal(selected().settled, true)
assertContinuity()
unsubscribe()
assistantStore.release()
console.log('PASS: settle, restore and legacy migration update canonical metadata without bootstrap, history reload or loading transitions')
