import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { buildVoiceStrongInspectionPrompt, boundedVoiceTaskResult, voiceTaskFailureMessage } from '../src/main/assistant/voice/voice-strong-routing'
import { buildVoiceStrongTaskActivity } from '../src/main/assistant/voice/voice-strong-task-activity'

const source = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
function method(start: string, end: string) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a); return source.slice(a, b) }
const body = [
    method('    private async stopCanonicalVoiceInternal(', '\n    private handleCanonicalVoiceEvent('),
    method('    private routeVoiceStrongRequest(', '\n    private prepareVoicePrimaryWorker('),
    method('    private projectVoiceStrongTask(', '\n    private async submitVoiceTaskNarration(')
].join('\n')
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`class ServiceFixture { ${body} }; globalThis.ServiceFixture = ServiceFixture`)
const fixtureGlobal: any = {}
new Function('globalThis', 'randomUUID', 'findThreadRecord', 'buildVoiceStrongInspectionPrompt', 'boundedVoiceTaskResult', 'voiceTaskFailureMessage', 'buildVoiceStrongTaskActivity', 'nowIso', 'log', code)(fixtureGlobal, randomUUID, (_snapshot: unknown, id: string) => id === 'local-A' ? record : null, buildVoiceStrongInspectionPrompt, boundedVoiceTaskResult, voiceTaskFailureMessage, buildVoiceStrongTaskActivity, () => new Date().toISOString(), { warn() {}, error() {} })
const record: any = { session: { id: 'session-A', chatScope: { roots: ['original-root'] } }, thread: { id: 'local-A', providerThreadId: 'canonical-A' } }
const active: any = { conversationId: 'canonical-A', localThreadId: 'local-A', sessionId: 'session-A', adapterSessionId: 'adapter-A', executionConfiguration: { model: 'fixture/original', effort: 'high', runtimeMode: 'approval-required', interactionMode: 'default', profile: 'default' } }
const events: any[] = [], inputs: any[] = [], narrations: any[] = [], completions: Array<(value: any) => void> = []
const service: any = new fixtureGlobal.ServiceFixture()
Object.assign(service, {
    activeCanonicalVoice: active, realtimeVoiceOwnerId: 42, canonicalVoiceStopPromise: null,
    queuedVoiceStrongRequests: new Map(), activeVoiceStrongTasks: new Map(), delegatedVoiceProviderItems: new Set(),
    state: { snapshot: {} }, mobileVoicePresence: { clearAdapter() {} }, canonicalVoiceCommitter: { flush: async () => {} },
    requireCanonicalTypedVoiceCommitter: () => ({ beginStop: async () => {} }),
    requireForegroundRoutes: () => ({ activeRoute: () => ({ surface_mode: 'voice', context_version: 1, attached_task_ids: [] }) }),
    canonicalVoiceSessions: { currentHandle: () => null },
    requireCanonicalVoiceSessions: () => ({ stopVoice: async () => {} }),
    requireCanonicalRealtimeAdapter: () => ({ appendTransientContext: async () => {}, close: async () => {} }),
    voiceContextVersion: () => 1, attachedTaskIds: () => [], broadcastRealtimeVoiceEvent() {},
    getSessionRuntimeCwd: () => '/original-root', readCanonicalVoiceContinuity: async () => ({ messages: [{ role: 'user', text: 'The historical task goal.' }] }),
    runtime: { runPrivateVoiceTask: (input: any) => { inputs.push(input); return new Promise(resolve => completions.push(resolve)) } },
    appendEvent: (_type: string, _at: string, event: any) => events.push(event),
    submitVoiceTaskNarration: async (...args: any[]) => { narrations.push(args) }, prepareVoicePrimaryWorker() {}
})
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const request = (providerItemId: string, text: string) => ({ adapterSessionId: 'adapter-A', conversationId: 'canonical-A', providerItemId, text })
service.routeVoiceStrongRequest(request('one', 'Run the original task.'))
await settle()
assert.equal(inputs.length, 1)
service.routeVoiceStrongRequest(request('two', 'Then check its output.'))
await settle()
assert.equal(service.queuedVoiceStrongRequests.get('canonical-A').length, 1)
assert.match(inputs[0].prompt, /historical task goal/)
// Ending the call closes its audio route, but neither the task nor accepted follow-up is cancelled.
await service.stopCanonicalVoiceInternal('user_exit')
assert.equal(inputs[0].signal.aborted, false)
assert.equal(service.queuedVoiceStrongRequests.get('canonical-A').length, 1)
assert.equal(service.activeCanonicalVoice, null)
// Navigating/starting B must not change A's destination, model, cwd or scope.
record.session.chatScope = { roots: ['new-root'] }
service.activeCanonicalVoice = { ...active, conversationId: 'canonical-B', adapterSessionId: 'adapter-B', localThreadId: 'local-B' }
completions[0]({ text: 'Verified first result.' })
await settle()
assert.equal(inputs.length, 2, 'Accepted queued task starts even though original call ended')
assert.equal(inputs[1].model, 'fixture/original')
assert.equal(inputs[1].cwd, '/original-root')
assert.deepEqual(inputs[1].filesystemScope, { roots: ['original-root'] })
completions[1]({ text: 'Verified second result.' })
await settle()
assert.equal(narrations.length, 0, 'A results never speak into B')
const completed = events.filter(event => event.activity?.payload?.status === 'completed')
assert.equal(completed.length, 2, 'Results are retained even without an active call')
assert.ok(completed.every(event => event.threadId === 'local-A'))
assert.equal(service.activeVoiceStrongTasks.size, 0)
assert.equal(service.queuedVoiceStrongRequests.size, 0)
console.log('PASS: real service methods preserve accepted tasks, queue, original destination/config/scope, completed results and cross-call narration isolation')
