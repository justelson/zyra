import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvents } from '../src/shared/assistant/projector'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { AssistantStartupSelection } from '../src/main/assistant/startup-selection'
import { AssistantWorkspaceStartup } from '../src/renderer/src/pages/assistant/AssistantWorkspaceStartup'
import type { AssistantDomainEvent, AssistantSnapshot } from '../src/shared/assistant/contracts'

const makeSession = (id: string, updatedAt = '2026-10-06T10:00:00Z') => {
    const thread = createAssistantThread(updatedAt)
    return { id, title: 'Saved chat', mode: 'work' as const, projectPath: null, playgroundLabId: null, pendingLabRequest: null,
        archived: false, createdAt: updatedAt, updatedAt, activeThreadId: thread.id, threadIds: [thread.id], threads: [thread] }
}
let snapshot: AssistantSnapshot = createDefaultAssistantSnapshot()
let creations = 0
let sequence = 0
let releaseCreation!: () => void
const deps = {
    getSnapshot: () => snapshot,
    appendEvent(type: AssistantDomainEvent['type'], occurredAt: string, payload: Record<string, unknown>, sessionId?: string, threadId?: string) {
        snapshot = applyAssistantDomainEvents(snapshot, [{ eventId: `launch-${++sequence}`, sequence, type, occurredAt, payload, sessionId, threadId }])
    },
    async createSession() {
        creations++
        await new Promise<void>(resolve => { releaseCreation = resolve })
        const session = makeSession('fresh-draft')
        deps.appendEvent('session.created', session.createdAt, { session }, session.id, session.activeThreadId)
        return { success: true as const, sessionId: session.id }
    }
}
const selection = new AssistantStartupSelection()
const first = selection.ensure(deps)
const second = selection.ensure(deps)
assert.equal(first, second, 'two opening windows share the initial draft request')
assert.equal(creations, 1)
releaseCreation()
await Promise.all([first, second])
assert.equal(snapshot.selectedSessionId, 'fresh-draft', 'first setup has a persisted selected draft')
await selection.ensure(deps)
assert.equal(creations, 1, 'reopening preserves the selected chat instead of adding drafts')

const older = makeSession('older', '2026-10-04T10:00:00Z')
const newest = makeSession('newest')
snapshot = { ...createDefaultAssistantSnapshot(), sessions: [older, { ...makeSession('archived'), archived: true }, newest], selectedSessionId: 'missing' }
await selection.ensure(deps)
assert.equal(snapshot.selectedSessionId, newest.id, 'an invalid saved selection restores the newest nonarchived chat')
snapshot = { ...snapshot, selectedSessionId: older.id }
await selection.ensure(deps)
assert.equal(snapshot.selectedSessionId, older.id, 'a valid saved choice is retained even when another chat is newer')
snapshot = { ...snapshot, sessions: [{ ...older, activeThreadId: 'missing-thread' }] }
await selection.ensure(deps)
assert.equal(snapshot.sessions[0]?.activeThreadId, older.activeThreadId, 'legacy missing active-thread pointers recover without deleting history')

const failed = new AssistantStartupSelection()
snapshot = createDefaultAssistantSnapshot()
await assert.rejects(failed.ensure({ ...deps, createSession: async () => { throw Error('Disk unavailable') } }), /Disk unavailable/)
const retried = failed.ensure(deps)
releaseCreation()
await retried
assert.equal(snapshot.selectedSessionId, 'fresh-draft', 'an unsuccessful bootstrap can be retried')

for (const [ready, error, expected] of [[false, null, 'Opening chats'], [false, 'Disk unavailable', 'Try again'], [true, null, 'Saved conversation']] as const) {
    const markup = renderToStaticMarkup(createElement(AssistantWorkspaceStartup, {
        ready, error, onRetry() {}, loadingFallback: createElement('div', null, 'Opening chats'), children: createElement('div', null, 'Saved conversation')
    }))
    assert.ok(markup.includes(expected))
    assert.equal(markup.includes('Saved conversation'), ready, 'normal workspace is exposed only after bootstrap')
    assert.equal(markup.includes('Disconnected'), false, 'startup never paints a disabled disconnected composer')
}

const service = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const bootstrap = service.slice(service.indexOf('    async getBootstrap()'), service.indexOf('    async getStatus()'))
assert.match(bootstrap, /startupSelection\.ensure\(this\.actionDeps\)/, 'fresh and restored profiles must have a valid selection before bootstrap exposes the workspace')
const lifetime = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantWorkspaceLifetime.tsx', import.meta.url), 'utf8')
assert.match(lifetime, /AssistantWorkspaceStartup/, 'the empty default store cannot paint a disconnected composer before bootstrap')

console.log('Assistant launch wiring: ok')
