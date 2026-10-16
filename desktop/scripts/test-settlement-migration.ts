import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { AssistantSession } from '../src/shared/assistant/contracts'
import { getSidebarSettlementActivityKey } from '../src/renderer/src/pages/assistant/assistant-sidebar-settlement'

const values = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } })
let active = 0, peak = 0, refreshes = 0
const calls: string[] = []
Object.assign(globalThis, { window: { devscope: { assistant: { settleSession: async (id: string, _settled: boolean, migration: boolean) => {
    assert.equal(migration, true)
    calls.push(id); peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 5)); active--
    return id === 'failed' ? { success: false, error: 'Offline' } : { success: true }
} } } } })
mock.module('../src/renderer/src/lib/assistant/assistant-store-core', () => ({ assistantStore: { refresh: async () => { refreshes++ } } }))
const { setAssistantSettlementOverrides, migrateCanonicalSettlementOverrides } = await import('../src/renderer/src/pages/assistant/assistant-settlement-store')
const sessions = ['one', 'two', 'server-choice', 'failed'].map(id => ({ id, settled: false, settlementManual: id === 'server-choice', threads: [{ id: `${id}-thread`, messageCount: 2, latestTurn: null }] })) as unknown as AssistantSession[]
setAssistantSettlementOverrides(Object.fromEntries(sessions.map(session => [session.id, { state: 'settled', activityAt: '', activityKey: getSidebarSettlementActivityKey(session) }])))
const first = migrateCanonicalSettlementOverrides(sessions)
const concurrent = migrateCanonicalSettlementOverrides(sessions)
assert.equal(first, concurrent, 'Repeated snapshots share the same migration job')
await first
assert.equal(peak, 1, 'Legacy choices cannot flood the catalog with parallel mutations')
assert.deepEqual(calls, ['one', 'two', 'failed'], 'Existing canonical choices are preserved without another update')
assert.equal(refreshes, 1, 'One refresh covers the acknowledged batch')
assert.deepEqual(Object.keys(JSON.parse(values.get('assistant:agent-inbox-settled-overrides:v1')!)), ['failed'], 'Only acknowledged choices leave local migration storage')
await migrateCanonicalSettlementOverrides(sessions)
assert.equal(calls.length, 3, 'A failed request waits before retrying on subsequent snapshots')
console.log('Settlement migration: serial requests, shared job, canonical priority, one refresh and failed-choice retry passed.')
