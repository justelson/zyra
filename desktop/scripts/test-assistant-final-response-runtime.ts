import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { AssistantRuntimeEvent, AssistantSnapshot, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const { handleAssistantRuntimeEvent } = await import('../src/main/assistant/service-runtime-events')
const { processResponsesStream: sourceProcessor } = await import('../../src/runtime/providers/source/api/openai-responses-shared')
const { processResponsesStream: shippedProcessor } = await import('../../src/runtime/providers/src/api/openai-responses-shared.js')
const at = '2026-10-06T10:00:00.000Z'
const thread = { id: 'phase-thread', providerThreadId: 'phase-canonical', messages: [], activities: [], pendingApprovals: [], pendingUserInputs: [],
    state: 'running', latestTurn: { id: 'phase-turn', state: 'running', requestedAt: at, startedAt: at, completedAt: null, assistantMessageId: null } } as unknown as AssistantThread
const session = { id: 'phase-session', title: 'Phase repair', threads: [thread], threadIds: [thread.id], activeThreadId: thread.id } as unknown as AssistantSession
let snapshot = { sessions: [session], selectedSessionId: session.id, snapshotSequence: 0, updatedAt: at, knownModels: [], fleetByThreadId: {}, playground: { rootPath: null, labs: [] } } as AssistantSnapshot
let sequence = 0
const record = () => ({ session: snapshot.sessions[0]!, thread: snapshot.sessions[0]!.threads[0]! })
const deps = {
    findThreadRecord: record, findSessionByThreadId: () => record().session, requireThread: () => record().thread,
    assistantTextBuffers: new Map(), isAssistantTextSuppressed: () => false, flushAssistantTextDelta: noop,
    updateLatestTurnAssistantMessage: noop,
    appendEvent: (type: any, occurredAt: string, payload: Record<string, unknown>) => {
        snapshot = applyAssistantDomainEvent(snapshot, { eventId: `phase-event-${++sequence}`, sequence, type, occurredAt, payload, sessionId: session.id, threadId: thread.id })
    },
    queueAssistantTextDelta: (delta: any) => deps.appendEvent('thread.message.assistant.delta', delta.occurredAt, delta)
}
const runtime = new ZyraRuntime()
const context = { localThreadId: thread.id, providerThreadId: thread.providerThreadId, activeTurnId: 'phase-turn', activeAssistantItemId: null,
    assistantMessageSequence: 0, completedTurnIds: new Set(), internalTextByItemId: new Map(), assistantTextByItemId: new Map(),
    assistantCompletedItemIds: new Set(), sessionUsage: null, lastUsage: null, lastUsageTurnId: null }
const runtimeEvents: AssistantRuntimeEvent[] = []
runtime.on('runtime', event => { runtimeEvents.push(event); handleAssistantRuntimeEvent(event, deps as never) })

for (const [index, processor] of [sourceProcessor, shippedProcessor].entries()) {
    const output: any = { role: 'assistant', content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }, stopReason: 'stop' }
    const providerId = `phase-output-${index}`
    async function* wire() {
        yield { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: providerId, role: 'assistant', phase: 'final_answer', content: [] } }
        // Inspect before the generator yields any text or completion.
        const message = record().thread.messages.find(message => message.id === `assistant-message-${providerId}`)
        assert.equal(message?.phase, 'final_answer', 'provider text_start metadata reaches the desktop projector without a text delta')
        assert.equal(message?.text, '')
        assert.equal(message?.streaming, true)
        assert.equal(record().thread.latestTurn?.state, 'running')
        assert.equal(context.activeTurnId, 'phase-turn')
        assert.equal(context.completedTurnIds.size, 0)
        yield { type: 'response.completed', response: { id: 'synthetic-response', status: 'completed', output: [] } }
    }
    await processor(wire() as never, output, { push: (event: any) => {
        if (event.type !== 'text_start') return
        const signature = JSON.parse(event.partial.content[event.contentIndex].textSignature)
        assert.equal(signature.phase, 'final_answer', 'the phase is present at text_start in both source and shipped provider runtime')
        ;(runtime as any).handleZyraEvent(context, { type: 'message_start', message: { id: providerId, ...event.partial }, assistantMessageEvent: event }, { turnId: 'phase-turn' })
    } } as never, { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never)
}
assert.equal(runtimeEvents.some(event => event.type === 'turn.completed'), false)
const beforeRepeatedPhase = runtimeEvents.length
;(runtime as any).streamAssistantText(context, 'phase-turn', '', 'phase-output-1', 'final_answer')
assert.equal(runtimeEvents.length, beforeRepeatedPhase, 'unchanged text and phase do not emit another delta')
;(runtime as any).streamAssistantText(context, 'phase-turn', 'New final text', 'phase-output-1', 'final_answer')
assert.equal(runtimeEvents.length, beforeRepeatedPhase + 1)
assert.equal(runtimeEvents.at(-1)?.payload.phase, undefined, 'later text deltas do not resend unchanged phase metadata')
;(runtime as any).streamAssistantText(context, 'phase-turn', '', 'new-phase-output', 'final_answer')
assert.equal(runtimeEvents.at(-1)?.payload.phase, 'final_answer', 'each new item still emits its first empty phase transition')
runtime.dispose()
console.log('Provider phase: source and shipped text_start -> runtime event -> main handler -> live message projection; no completion: ok')
