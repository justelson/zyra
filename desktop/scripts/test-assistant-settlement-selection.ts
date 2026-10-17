import assert from 'node:assert/strict'
import { areAssistantSessionsRailSelectionsEqual } from '../src/renderer/src/lib/assistant/assistant-store-selection-helpers'
import type { AssistantSessionsRailSelection } from '../src/renderer/src/lib/assistant/assistant-store-selection-types'

const selection = {
    activeSessionId: 'open-chat', activeThreadId: 'open-thread', connected: true, commandPending: false,
    playground: { rootPath: null, labs: [] },
    sessions: [{ id: 'open-chat', title: 'Open chat', createdAt: '2026-08-01T12:00:00.000Z', threads: [], settled: false, settlementManual: false }]
} as unknown as AssistantSessionsRailSelection
for (const patch of [{ settled: true }, { settlementManual: true }, { settled: undefined }]) {
    const updated = { ...selection, sessions: selection.sessions.map(session => ({ ...session, ...patch })) }
    assert.equal(areAssistantSessionsRailSelectionsEqual(selection, updated), false, 'a settlement-only event must invalidate the selected sidebar slice without navigating')
}
assert.equal(areAssistantSessionsRailSelectionsEqual(selection, structuredClone(selection)), true, 'unchanged settlement retains selector equality')
console.log('Selected sidebar invalidates canonical settlement changes without navigation: ok')
