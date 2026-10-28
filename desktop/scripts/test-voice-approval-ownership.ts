import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Execute the complete production event handler, with only its durable projector
// and provider adapter substituted. No real account, profile or Voice call.
const source = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('    private handleRuntimeEvent(')
const end = source.indexOf('\n}\n\nfunction createPendingCanonicalVoiceStart', start)
assert.ok(start >= 0 && end > start)
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`class ServiceFixture { ${source.slice(start, end)} }; return ServiceFixture`)
const projected: any[] = [], contexts: any[] = [], narrations: any[] = []
const record = { session: { id: 'session-A' }, thread: { id: 'local-A', providerThreadId: 'canonical-A' } }
const Fixture = new Function('findThreadRecord', 'handleAssistantRuntimeEvent', code)(
    (_snapshot: unknown, id: string) => ['local-A', 'canonical-A'].includes(id) ? record : null,
    (event: unknown) => projected.push(event)
)
const service: any = new Fixture()
const noop = () => undefined
const voice = (id: string) => ({ conversationId: `canonical-${id}`, adapterSessionId: `adapter-${id}`, localThreadId: `local-${id}`, sessionId: `session-${id}` })
Object.assign(service, {
    state: { snapshot: {} },
    runtime: { resolvePrivateVoiceTargetThread: (id: string) => id === 'private-A' ? 'local-A' : null },
    activeVoiceStrongTasks: new Map([['canonical-A', { taskId: 'task-A', conversationId: 'canonical-A', localThreadId: 'local-A' }]]),
    activeCanonicalVoice: voice('B'),
    requireCanonicalRealtimeAdapter: () => ({ appendTransientContext: async (...args: unknown[]) => { contexts.push(args) } }),
    submitVoiceTaskNarration: async (...args: unknown[]) => { narrations.push(args) },
    suppressedAssistantTextTurns: new Set(), assistantTextDeltaBuffer: { queue: noop, flush: noop }, assistantActivityDeltaBuffer: { queue: noop, flush: noop }
})
const deliver = async (type: 'approval.requested' | 'approval.resolved', decision = 'allow') => {
    service.handleRuntimeEvent({ type, threadId: 'private-A', providerThreadId: 'private-provider-A', requestId: 'request-A', createdAt: new Date().toISOString(), payload: { decision } })
    for (let i = 0; i < 4; i++) await Promise.resolve()
}
await deliver('approval.requested')
await deliver('approval.resolved')
assert.equal(contexts.length, 0, 'A surviving task cannot append approval context to another conversation')
assert.equal(narrations.length, 0, 'Requested and resolved approvals from A never speak into B')
assert.ok(projected.every(event => event.threadId === 'local-A' && event.providerThreadId === 'canonical-A'), 'Approval evidence still projects to its original Chat')
service.activeCanonicalVoice = voice('A')
await deliver('approval.requested')
assert.equal(contexts.length, 1)
assert.equal(contexts[0][0], 'adapter-A')
assert.match(contexts[0][1], /task-A.*approval/)
assert.equal(narrations.length, 1)
assert.equal(narrations[0][0].adapterSessionId, 'adapter-A')
await deliver('approval.resolved')
await deliver('approval.resolved', 'decline')
assert.equal(narrations.length, 3, 'The owning active conversation retains both approval outcome announcements')
assert.match(narrations[1][2], /Approval received/)
assert.match(narrations[2][2], /declined/)
service.activeCanonicalVoice = null
await deliver('approval.requested')
await deliver('approval.resolved')
assert.equal(contexts.length, 1)
assert.equal(narrations.length, 3, 'No active call does not discard durable approvals or start narration')
assert.equal(projected.length, 7)
console.log('PASS: production Voice approval handler retains original Chat evidence and narrates only into its owning active conversation')
