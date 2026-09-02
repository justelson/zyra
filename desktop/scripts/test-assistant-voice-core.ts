import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import type {
    AssistantRealtimeVoiceEvent,
    CanonicalMessageCommitInput,
    ForegroundRouteClaim,
    PrimaryAgentDomainEvent,
    RealtimeConnectInput,
    RealtimeDomainEvent
} from '../src/shared/assistant/contracts'
import {
    evaluateRealtimeAudioCapabilities,
    foregroundRouteClaim
} from '../src/shared/assistant/contracts'
import {
    createCanonicalMessageOperation,
    dispatchCanonicalMessageOperation
} from '../src/main/assistant/foreground/canonical-message-operation-reducer'
import { ConversationGateway } from '../src/main/assistant/foreground/conversation-gateway'
import { FakeCanonicalMessageWriter } from '../src/main/assistant/foreground/fake-canonical-message-writer'
import { FakePrimaryAgentAdapter } from '../src/main/assistant/foreground/fake-primary-agent-adapter'
import { ForegroundControllerPersistence } from '../src/main/assistant/foreground/foreground-controller-persistence'
import {
    SqlForegroundControllerStore
} from '../src/main/assistant/foreground/foreground-controller-store'
import {
    ForegroundRouteController,
    routeExpectation,
    type ForegroundClock
} from '../src/main/assistant/foreground/foreground-route-controller'
import { ForegroundRouteConflictError } from '../src/main/assistant/foreground/foreground-route-reducer'
import { CanonicalVoiceSessionController } from '../src/main/assistant/voice/canonical-voice-session-controller'
import { CanonicalVoiceTranscriptCommitter } from '../src/main/assistant/voice/canonical-voice-transcript-committer'
import { CanonicalTypedVoiceResponseCommitter } from '../src/main/assistant/voice/canonical-typed-voice-response-committer'
import { AssistantRealtimeContinuitySource } from '../src/main/assistant/voice/assistant-realtime-continuity-source'
import {
    CodexRealtimeForegroundAdapter,
    type CodexRealtimeTransport
} from '../src/main/assistant/voice/codex-realtime-foreground-adapter'
import { probeInstalledCodexRealtimeCapabilitiesAsync } from '../src/main/assistant/voice/codex-realtime-capability-probe'
import { createCodexRealtimeCapabilityReport } from '../src/main/assistant/voice/codex-realtime-capabilities'
import { FakeRealtimeContinuitySource } from '../src/main/assistant/voice/fake-realtime-continuity-source'
import { FakeRealtimeForegroundAdapter } from '../src/main/assistant/voice/fake-realtime-foreground-adapter'
import { createRealtimeHydrationDelta } from '../src/main/assistant/voice/realtime-hydration'

class DeterministicClock implements ForegroundClock {
    private value = Date.parse('2026-08-09T02:00:00.000Z')

    now(): string {
        const result = new Date(this.value).toISOString()
        this.value += 1000
        return result
    }
}

class ScriptedCodexTransport extends EventEmitter implements CodexRealtimeTransport {
    lastStart: Parameters<CodexRealtimeTransport['start']>[0] | null = null
    appendedContext: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }> = []
    requestedSpeech: string[] = []
    requestedSpeechCanonicalMessageIds: Array<string | undefined> = []
    presentedComposerResponses: Array<{ turnId: string; text?: string; error?: string }> = []

    async start(input: Parameters<CodexRealtimeTransport['start']>[0]) {
        this.lastStart = {
            ...input,
            initialItems: input.initialItems ? structuredClone(input.initialItems) : undefined
        }
        return {
            threadId: 'codex_provider_thread_1',
            sdp: 'v=0\r\no=codex 1 1 IN IP4 127.0.0.1\r\n',
            realtimeVersion: 'v3',
            realtimeSessionId: 'codex_realtime_session_1'
        }
    }

    async appendContext(items: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>): Promise<void> {
        this.appendedContext.push(...structuredClone(items))
    }

    async requestSpeech(text: string, canonicalMessageId?: string): Promise<void> {
        this.requestedSpeech.push(text)
        this.requestedSpeechCanonicalMessageIds.push(canonicalMessageId)
    }
    presentComposerResponse(input: { turnId: string; text?: string; error?: string }): void {
        this.presentedComposerResponses.push(structuredClone(input))
    }
    async stop(): Promise<void> {}
}

const identities = {
    routeId: (conversationId: string, epoch: number) => `route_${conversationId}_${epoch}`,
    ownerClaimId: (conversationId: string, epoch: number) => `claim_${conversationId}_${epoch}`
}

const SQL = await initSqlJs()
const db = new SQL.Database()
const clock = new DeterministicClock()
const store = new SqlForegroundControllerStore(db)
const routes = new ForegroundRouteController(store, identities, clock)
const writer = new FakeCanonicalMessageWriter(clock)
const gateway = new ConversationGateway(store, writer, clock)

const chat = routes.initializeChat({
    conversationId: 'chat_voice_core',
    contextVersion: 3,
    attachedTaskIds: ['task_active']
})
assert.equal(chat.route_epoch, 1)
assert.equal(chat.surface_mode, 'chat')
assert.equal(chat.response_owner, 'strong_primary')
assert.deepEqual(chat.attached_task_ids, ['task_active'])

const chatClaim = foregroundRouteClaim(chat)
const userReceipt = await gateway.commitMessage(commitInput({
    claim: chatClaim,
    messageId: 'message_user_1',
    role: 'user',
    producer: 'user',
    text: 'Continue the existing task.',
    completedAt: clock.now()
}))
const assistantCompletedAt = clock.now()
const assistantReceipt = await gateway.commitMessage(commitInput({
    claim: chatClaim,
    messageId: 'message_assistant_1',
    role: 'assistant',
    producer: 'strong_primary',
    text: 'I will keep the task running while Voice connects.',
    completedAt: assistantCompletedAt
}))
assert.equal(userReceipt.canonicalSequence, 1)
assert.equal(assistantReceipt.canonicalSequence, 2)
assert.equal(writer.records('chat_voice_core').length, 2)
const replayedAssistantReceipt = await gateway.commitMessage(commitInput({
    claim: chatClaim,
    messageId: 'message_assistant_1',
    role: 'assistant',
    producer: 'strong_primary',
    text: 'I will keep the task running while Voice connects.',
    completedAt: assistantCompletedAt
}))
assert.equal(replayedAssistantReceipt.receiptId, assistantReceipt.receiptId)
assert.equal(writer.records('chat_voice_core').length, 2)

const continuity = new FakeRealtimeContinuitySource(clock)
continuity.initialize('chat_voice_core', 3)
continuity.appendMessage({
    conversationId: 'chat_voice_core',
    messageId: 'message_user_1',
    role: 'user',
    text: 'Continue the existing task.'
})
continuity.appendMessage({
    conversationId: 'chat_voice_core',
    messageId: 'message_assistant_1',
    role: 'assistant',
    text: 'I will keep the task running while Voice connects.'
})
continuity.appendTaskSummary('chat_voice_core', 'task_active', 'Task task_active is still running with its original attempt and authority.')
const realtime = new FakeRealtimeForegroundAdapter(clock)
realtime.onBeforeConnectReady = () => {
    continuity.appendMessage({
        conversationId: 'chat_voice_core',
        messageId: 'message_during_connect',
        role: 'assistant',
        text: 'The Chat prefix committed during connection.'
    })
}
const voiceSessions = new CanonicalVoiceSessionController(routes, continuity, realtime, clock)
const transcriptCommitter = new CanonicalVoiceTranscriptCommitter(voiceSessions, routes, gateway)
const committedVoiceReceipts: string[] = []
transcriptCommitter.onCommit((receipt) => committedVoiceReceipts.push(receipt.receiptId))

const activation = await voiceSessions.startVoice({
    conversationId: 'chat_voice_core',
    projectCwd: 'C:/workspace',
    offerSdp: 'v=0\r\n',
    instructions: 'Speak as Zyra and use bounded inspection only.',
    voice: 'cove',
    output: 'audio',
    contextVersion: 3,
    attachedTaskIds: ['task_active']
})
assert.equal(activation.route.route_epoch, 2)
assert.equal(activation.route.surface_mode, 'voice')
assert.equal(activation.route.activation_reason, 'start_voice')
assert.deepEqual(activation.route.attached_task_ids, ['task_active'])
assert.equal(activation.handle.hydratedThrough.conversation, 2)
assert.equal(continuity.currentWatermarks('chat_voice_core').conversation, 3)
assert.deepEqual(
    store.scopeBinding(activation.route.foreground_route_id),
    {
        conversationId: 'chat_voice_core',
        realtimeProviderThreadId: activation.handle.realtimeProviderThreadId,
        realtimeSessionId: activation.handle.realtimeSessionId,
        realtimeSessionGeneration: 1
    }
)

await assert.rejects(
    gateway.commitMessage(commitInput({
        claim: chatClaim,
        messageId: 'message_stale_chat',
        role: 'assistant',
        producer: 'strong_primary',
        text: 'This stale Chat response must never commit.',
        completedAt: clock.now()
    })),
    (error: unknown) => error instanceof ForegroundRouteConflictError && error.code === 'route_conflict'
)

const canonicalRecordCountBeforeUserPartials = writer.records('chat_voice_core').length
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_user_chunk_1',
    text: 'Hello',
    completed: false
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_user_chunk_2',
    text: 'Hello, respond with',
    completed: false
})
await transcriptCommitter.flush()
assert.equal(
    writer.records('chat_voice_core').length,
    canonicalRecordCountBeforeUserPartials,
    'partial user transcript chunks must never become standalone canonical messages'
)
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_user_fallback_prefix',
    text: 'Yo',
    completed: true
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_user_provider_full',
    text: 'Yo, so can you please help me check the time',
    completed: true
})
await transcriptCommitter.flush()
assert.deepEqual(
    writer.records('chat_voice_core')
        .filter((entry) => entry.input.providerItemId.startsWith('voice_user_'))
        .map((entry) => [entry.input.providerItemId, entry.input.text]),
    [['voice_user_provider_full', 'Yo, so can you please help me check the time']],
    'canonical Voice must keep only the stabilized provider completion when it extends a shorter fallback prefix'
)
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'intentional_repeat_user_1',
    text: 'Hello',
    completed: true
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'intentional_repeat_user_2',
    text: 'Hello',
    completed: true
})
await transcriptCommitter.flush()
assert.deepEqual(
    writer.records('chat_voice_core')
        .filter((entry) => entry.input.providerItemId.startsWith('intentional_repeat_user_'))
        .map((entry) => entry.input.providerItemId),
    ['intentional_repeat_user_1', 'intentional_repeat_user_2'],
    'canonical Voice must preserve two exact repeated user utterances as separate turns'
)
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_item_user_1',
    text: 'Hello, respond with exactly I am here',
    completed: true
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'assistant',
    providerItemId: 'voice_item_assistant_1',
    text: 'It is still running under the same task authority.',
    completed: true
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'assistant',
    providerItemId: 'voice_item_assistant_1',
    text: 'It is still running under the same task authority.',
    completed: true
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_user_chunk_3',
    text: 'Some',
    completed: false
})
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'user',
    providerItemId: 'voice_item_user_2',
    text: 'Some other random long statement',
    completed: true
})
await transcriptCommitter.flush()
assert.equal(committedVoiceReceipts.length, 7, 'replayed provider completion returns the same receipt to subscribers')
assert.equal(new Set(committedVoiceReceipts).size, 6)
assert.equal(writer.records('chat_voice_core').length, 8)
const committedSpokenUsers = writer.records('chat_voice_core')
    .filter((entry) => entry.input.providerItemId.startsWith('voice_item_user_'))
assert.deepEqual(
    committedSpokenUsers.map((entry) => [entry.input.providerItemId, entry.input.text]),
    [
        ['voice_item_user_1', 'Hello, respond with exactly I am here'],
        ['voice_item_user_2', 'Some other random long statement']
    ],
    'consecutive spoken finals each create one canonical user message'
)
assert.equal(
    writer.records('chat_voice_core').some((entry) => entry.input.providerItemId.startsWith('voice_user_chunk_')),
    false,
    'no provisional chunk identity can reach canonical persistence'
)

realtime.onBeforeConnectReady = null
const replacement = await voiceSessions.startVoice({
    conversationId: 'chat_voice_core',
    projectCwd: 'C:/workspace',
    offerSdp: 'v=0\r\n',
    instructions: 'Speak as Zyra and use bounded inspection only.',
    voice: 'cove',
    output: 'audio',
    contextVersion: 3,
    attachedTaskIds: ['task_active']
})
assert.equal(replacement.route.route_epoch, 3)
assert.equal(replacement.route.activation_reason, 'replace_voice_session')
assert.equal(replacement.handle.realtimeSessionGeneration, 2)
const beforeStaleEvent = writer.records('chat_voice_core').length
realtime.emitTranscript({
    sessionId: activation.handle.adapterSessionId,
    role: 'assistant',
    providerItemId: 'stale_old_generation',
    text: 'This must be quarantined.',
    completed: true
})
await transcriptCommitter.flush()
assert.equal(writer.records('chat_voice_core').length, beforeStaleEvent)

const typedResponseCommitter = new CanonicalTypedVoiceResponseCommitter(gateway)
typedResponseCommitter.activate(replacement.handle.adapterSessionId)
const typedWriteBarrier = writer.pauseNextWrite()
const typedResponseReceiptPromise = typedResponseCommitter.commit({
    adapterSessionId: replacement.handle.adapterSessionId,
    conversationId: 'chat_voice_core',
    routeClaim: foregroundRouteClaim(replacement.route),
    messageId: 'voice_assistant_typed_generation_2',
    providerItemId: 'typed-response:generation-2',
    text: 'This completed typed response must survive Stop.',
    completedAt: clock.now()
})
await typedWriteBarrier.started
let stopBarrierSettled = false
const stopBarrier = typedResponseCommitter.beginStop(replacement.handle.adapterSessionId)
    .then(() => { stopBarrierSettled = true })
await Promise.resolve()
assert.equal(stopBarrierSettled, false, 'Stop waits while a canonical typed response write is in flight')
typedWriteBarrier.release()
const typedResponseReceipt = await typedResponseReceiptPromise
await stopBarrier
assert.ok(typedResponseReceipt)
assert.equal(writer.records('chat_voice_core').filter((entry) => entry.input.messageId === 'voice_assistant_typed_generation_2').length, 1)
assert.equal(await typedResponseCommitter.commit({
    adapterSessionId: replacement.handle.adapterSessionId,
    conversationId: 'chat_voice_core',
    routeClaim: foregroundRouteClaim(replacement.route),
    messageId: 'voice_assistant_after_stop',
    providerItemId: 'typed-response:after-stop',
    text: 'This late response must be rejected.',
    completedAt: clock.now()
}), null)

const failingTypedResponseCommitter = new CanonicalTypedVoiceResponseCommitter(gateway)
failingTypedResponseCommitter.activate(replacement.handle.adapterSessionId)
writer.failNextBeforeWrite('Injected typed Voice persistence failure.')
const failedWriteBarrier = writer.pauseNextWrite()
const failedTypedCommit = failingTypedResponseCommitter.commit({
    adapterSessionId: replacement.handle.adapterSessionId,
    conversationId: 'chat_voice_core',
    routeClaim: foregroundRouteClaim(replacement.route),
    messageId: 'voice_assistant_failed_before_stop',
    providerItemId: 'typed-response:failed-before-stop',
    text: 'This write fails while Stop is draining.',
    completedAt: clock.now()
})
await failedWriteBarrier.started
const failedStopBarrier = failingTypedResponseCommitter.beginStop(replacement.handle.adapterSessionId)
failedWriteBarrier.release()
await assert.rejects(failedTypedCommit, /outcome is unknown/)
await failedStopBarrier

const returnedChat = await voiceSessions.stopVoice({
    conversationId: 'chat_voice_core',
    contextVersion: 3,
    attachedTaskIds: ['task_active']
})
assert.equal(returnedChat.route_epoch, 4)
assert.equal(returnedChat.surface_mode, 'chat')
assert.equal(returnedChat.activation_reason, 'exit_voice')
assert.deepEqual(returnedChat.attached_task_ids, ['task_active'])
realtime.emitTranscript({
    sessionId: replacement.handle.adapterSessionId,
    role: 'assistant',
    providerItemId: 'provider_after_stop',
    text: 'A provider completion after Stop must stay quarantined.',
    completed: true
})
await transcriptCommitter.flush()
assert.equal(writer.records('chat_voice_core').some((entry) => entry.input.providerItemId === 'provider_after_stop'), false)
assert.equal(writer.records('chat_voice_core').filter((entry) => entry.input.messageId === 'voice_assistant_typed_generation_2').length, 1)

const hydrationBoundarySource = new AssistantRealtimeContinuitySource(async () => ({
    contextVersion: 1,
    routeCount: 4,
    messages: [{
        id: 'stopped_voice_user',
        role: 'user',
        text: 'A stopped Voice request is history, not a new request.',
        modality: 'text',
        sequence: 1
    }, {
        id: 'voice_assistant_typed_generation_2',
        role: 'assistant',
        text: 'This completed typed response must survive Stop.',
        modality: 'voice',
        sequence: 2
    }],
    pendingApprovals: [],
    pendingInputs: [],
    attachedTaskIds: []
}), () => clock.now())
const hydrationBoundarySeed = await hydrationBoundarySource.materialize('chat_voice_core', foregroundRouteClaim(returnedChat))
assert.equal(hydrationBoundarySeed.items.every((item) => item.role === 'developer'), true, 'provider startup cannot receive executable historical user or assistant turns')
assert.match(hydrationBoundarySeed.items[0]?.text || '', /Historical user message, for context only/)
assert.equal(hydrationBoundarySeed.items.filter((item) => item.canonicalMessageId === 'voice_assistant_typed_generation_2').length, 1, 'restart hydration retains the completed typed response exactly once')
assert.match(hydrationBoundarySeed.items.at(-1)?.text || '', /historical context.*do not answer/iu)

const disposeChat = routes.initializeChat({ conversationId: 'chat_typed_dispose', contextVersion: 0 })
const disposeVoice = routes.activatePreparedVoice({
    conversationId: 'chat_typed_dispose',
    expected: routeExpectation(foregroundRouteClaim(disposeChat)),
    contextVersion: 0,
    attachedTaskIds: [],
    prepared: {
        realtimeProviderThreadId: 'provider_typed_dispose',
        realtimeSessionId: 'session_typed_dispose',
        realtimeSessionGeneration: 1
    }
})
const disposeCommitter = new CanonicalTypedVoiceResponseCommitter(gateway)
disposeCommitter.activate('adapter_typed_dispose')
const disposeWriteBarrier = writer.pauseNextWrite()
const disposeCommit = disposeCommitter.commit({
    adapterSessionId: 'adapter_typed_dispose',
    conversationId: 'chat_typed_dispose',
    routeClaim: foregroundRouteClaim(disposeVoice),
    messageId: 'voice_assistant_typed_dispose',
    providerItemId: 'typed-response:dispose',
    text: 'Dispose must drain this canonical response.',
    completedAt: clock.now()
})
await disposeWriteBarrier.started
let typedDisposeSettled = false
const typedDispose = disposeCommitter.dispose().then(() => { typedDisposeSettled = true })
await Promise.resolve()
assert.equal(typedDisposeSettled, false, 'disposal cannot clear an in-flight typed canonical write')
disposeWriteBarrier.release()
assert.ok(await disposeCommit)
await typedDispose
assert.equal(writer.records('chat_typed_dispose').length, 1)

// A connection failure rekeys the unchanged Chat route so every delayed callback is stale.
const failedChat = routes.initializeChat({ conversationId: 'chat_failed_prepare', contextVersion: 0 })
const failedContinuity = new FakeRealtimeContinuitySource(clock)
failedContinuity.initialize('chat_failed_prepare')
const failedAdapter = new FakeRealtimeForegroundAdapter(clock)
failedAdapter.failNextConnect()
const failedSessions = new CanonicalVoiceSessionController(routes, failedContinuity, failedAdapter, clock)
await assert.rejects(failedSessions.startVoice({
    conversationId: 'chat_failed_prepare',
    projectCwd: 'C:/workspace',
    offerSdp: 'v=0\r\n',
    instructions: 'Zyra Voice',
    voice: 'cove',
    output: 'audio',
    contextVersion: 0,
    attachedTaskIds: []
}), /Injected realtime connection failure/)
const rekeyedChat = routes.activeRoute('chat_failed_prepare')
assert.equal(rekeyedChat.route_epoch, failedChat.route_epoch + 1)
assert.equal(rekeyedChat.activation_reason, 'voice_preparation_failed')
assert.equal(rekeyedChat.surface_mode, 'chat')
failedSessions.dispose()

// An unexpected current physical-session close restores a fresh Chat owner.
routes.initializeChat({ conversationId: 'chat_runtime_close', contextVersion: 1 })
const closeContinuity = new FakeRealtimeContinuitySource(clock)
closeContinuity.initialize('chat_runtime_close', 1)
const closeAdapter = new FakeRealtimeForegroundAdapter(clock)
const closeSessions = new CanonicalVoiceSessionController(routes, closeContinuity, closeAdapter, clock)
const closeActivation = await closeSessions.startVoice({
    conversationId: 'chat_runtime_close',
    projectCwd: 'C:/workspace',
    offerSdp: 'v=0\r\n',
    instructions: 'Zyra Voice',
    voice: 'cove',
    output: 'audio',
    contextVersion: 1,
    attachedTaskIds: ['task_survives_close']
})
await closeAdapter.close(closeActivation.handle.adapterSessionId, 'transport_lost')
const closeFallback = routes.activeRoute('chat_runtime_close')
assert.equal(closeFallback.route_epoch, 3)
assert.equal(closeFallback.surface_mode, 'chat')
assert.equal(closeFallback.activation_reason, 'voice_preparation_failed')
assert.deepEqual(closeFallback.attached_task_ids, ['task_survives_close'])
closeSessions.dispose()

// Intended/dispatched canonical commits are a hard handoff barrier.
const blockedChat = routes.initializeChat({ conversationId: 'chat_quiescence', contextVersion: 0 })
const blockedClaim = foregroundRouteClaim(blockedChat)
const pendingOperation = createCanonicalMessageOperation({
    operationId: 'operation_pending_message',
    conversationId: 'chat_quiescence',
    canonicalMessageId: 'message_pending',
    idempotencyKey: 'canonical-message:chat_quiescence:message_pending',
    routeClaim: blockedClaim,
    adapterId: 'test_gateway',
    protectedPayloadRef: 'payload_pending',
    payloadSha256: 'a'.repeat(64),
    redactedSummary: 'pending assistant message',
    intentAt: clock.now()
})
store.prepareCanonicalMessageOperation(routeExpectation(blockedClaim), pendingOperation)
assert.throws(() => routes.activatePreparedVoice({
    conversationId: 'chat_quiescence',
    expected: routeExpectation(blockedClaim),
    contextVersion: 0,
    attachedTaskIds: [],
    prepared: {
        realtimeProviderThreadId: 'provider_quiescence',
        realtimeSessionId: 'session_quiescence',
        realtimeSessionGeneration: 1
    }
}), (error: unknown) => error instanceof ForegroundRouteConflictError && error.code === 'route_quiescence_required')
gateway.cancelPrepared('operation_pending_message')
const unblockedVoice = routes.activatePreparedVoice({
    conversationId: 'chat_quiescence',
    expected: routeExpectation(blockedClaim),
    contextVersion: 0,
    attachedTaskIds: [],
    prepared: {
        realtimeProviderThreadId: 'provider_quiescence',
        realtimeSessionId: 'session_quiescence',
        realtimeSessionGeneration: 1
    }
})
assert.equal(unblockedVoice.surface_mode, 'voice')

// Restart reconciliation cancels undispatched intents and terminalizes missing dispatched receipts.
const reconciliationChat = routes.initializeChat({ conversationId: 'chat_reconciliation', contextVersion: 0 })
const reconciliationClaim = foregroundRouteClaim(reconciliationChat)
for (const [operationId, status] of [['operation_restart_intended', 'intended'], ['operation_restart_dispatched', 'dispatched']] as const) {
    const intended = createCanonicalMessageOperation({
        operationId,
        conversationId: 'chat_reconciliation',
        canonicalMessageId: `message_${status}`,
        idempotencyKey: `canonical-message:chat_reconciliation:${status}`,
        routeClaim: reconciliationClaim,
        adapterId: 'test_gateway',
        protectedPayloadRef: `payload_${status}`,
        payloadSha256: (status === 'intended' ? 'b' : 'c').repeat(64),
        redactedSummary: `${status} restart operation`,
        intentAt: clock.now()
    })
    store.prepareCanonicalMessageOperation(routeExpectation(reconciliationClaim), intended)
    if (status === 'dispatched') {
        store.commitCanonicalMessageOperationRevision(
            intended.revision,
            dispatchCanonicalMessageOperation(intended, clock.now())
        )
    }
}
await gateway.reconcilePendingOperations('chat_reconciliation')
assert.equal(store.canonicalMessageOperation('operation_restart_intended')?.status, 'cancelled')
assert.equal(store.canonicalMessageOperation('operation_restart_dispatched')?.status, 'outcome_unknown')
assert.equal(store.pendingCanonicalMessageOperations(reconciliationChat.foreground_route_id).length, 0)

// The strong adapter has separate direct-Chat and private-task output lanes.
const primary = new FakePrimaryAgentAdapter(clock)
const primaryEvents: PrimaryAgentDomainEvent[] = []
primary.subscribe((event) => primaryEvents.push(event))
primary.directResponse = 'A direct strong Chat response.'
const directAbort = new AbortController()
const directHandle = await primary.respondDirect({
    conversationId: 'chat_voice_core',
    routeClaim: foregroundRouteClaim(returnedChat),
    userMessageId: 'message_direct_request',
    text: 'Answer this directly.',
    attachmentIds: [],
    signal: directAbort.signal
})
const directCompleted = primaryEvents.find((event) => event.type === 'primary.direct.text.completed')
assert.ok(directCompleted && directCompleted.turnId === directHandle.turnId)
await gateway.commitMessage({
    conversationId: directCompleted.conversationId,
    messageId: 'message_direct_primary',
    role: 'assistant',
    producer: 'strong_primary',
    modality: 'text',
    text: directCompleted.text,
    attachmentIds: [],
    routeClaim: directCompleted.routeClaim,
    providerItemId: directCompleted.providerItemId,
    providerCompletedAt: directCompleted.occurredAt
})
const privateRecordCount = writer.records('chat_quiescence').length
await primary.startPrivate({
    packetId: 'packet_private_1',
    conversationId: 'chat_quiescence',
    taskId: 'task_private_1',
    attemptId: 'attempt_private_1',
    primaryAgentRunId: 'primary_run_1',
    sourceUserMessageId: 'message_pending',
    verbatimRequest: 'Perform durable work without speaking directly.',
    contextVersion: 0,
    projectCwd: 'C:/workspace'
}, new AbortController().signal)
primary.progress('attempt_private_1', 'Private evidence is ready.', true)
primary.complete('attempt_private_1')
assert.equal(writer.records('chat_quiescence').length, privateRecordCount)
await assert.rejects(primary.respondDirect({
    conversationId: 'chat_quiescence',
    routeClaim: foregroundRouteClaim(unblockedVoice),
    userMessageId: 'message_voice_direct_rejected',
    text: 'Do not use the direct strong lane while Voice owns the route.',
    attachmentIds: [],
    signal: new AbortController().signal
}), /active Chat owner claim/)

// A provider thread is permanently scoped to one canonical conversation.
const otherChat = routes.initializeChat({ conversationId: 'chat_provider_rebind', contextVersion: 0 })
assert.throws(() => routes.activatePreparedVoice({
    conversationId: 'chat_provider_rebind',
    expected: routeExpectation(foregroundRouteClaim(otherChat)),
    contextVersion: 0,
    attachedTaskIds: [],
    prepared: {
        realtimeProviderThreadId: 'provider_quiescence',
        realtimeSessionId: 'session_other',
        realtimeSessionGeneration: 1
    }
}), /cannot be rebound/)
assert.equal(routes.activeRoute('chat_provider_rebind').route_epoch, 1)

// Cross-store retry uses the same operation/message identity after a post-write error.
const retryChat = routes.initializeChat({ conversationId: 'chat_commit_retry', contextVersion: 0 })
writer.failNextAfterWrite()
const retryReceipt = await gateway.commitMessage(commitInput({
    claim: foregroundRouteClaim(retryChat),
    messageId: 'message_retry',
    role: 'assistant',
    producer: 'strong_primary',
    text: 'Committed exactly once despite a lost response.',
    completedAt: clock.now()
}))
assert.equal(retryReceipt.canonicalSequence, 1)
assert.equal(writer.records('chat_commit_retry').length, 1)

writer.failNextBeforeWrite()
await assert.rejects(gateway.commitMessage(commitInput({
    claim: foregroundRouteClaim(retryChat),
    messageId: 'message_unknown',
    role: 'assistant',
    producer: 'strong_primary',
    text: 'This operation has an unknown append outcome.',
    completedAt: clock.now()
})), /outcome is unknown/)
const unknownOperation = store.canonicalMessageOperationByIdempotencyKey('canonical-message:chat_commit_retry:message_unknown')
assert.equal(unknownOperation?.status, 'outcome_unknown')

// Controller records survive a SQLite export/reopen with route and operation history intact.
const reopenedDb = new SQL.Database(db.export())
const reopenedStore = new SqlForegroundControllerStore(reopenedDb)
assert.equal(reopenedStore.activeRoute('chat_voice_core')?.route_epoch, 4)
assert.deepEqual(
    reopenedStore.routeHistory('chat_voice_core').map((route) => [route.route_epoch, route.revision, route.status]),
    [
        [1, 1, 'active'], [1, 2, 'superseded'],
        [2, 1, 'active'], [2, 2, 'superseded'],
        [3, 1, 'active'], [3, 2, 'superseded'],
        [4, 1, 'active']
    ]
)
assert.equal(reopenedStore.canonicalMessageOperationByIdempotencyKey(
    'canonical-message:chat_commit_retry:message_unknown'
)?.status, 'outcome_unknown')
assert.equal(reopenedStore.canonicalMessageOperationByIdempotencyKey(
    `voice-typed-response:chat_voice_core:${replacement.route.foreground_route_id}:typed-response:generation-2`
)?.status, 'succeeded', 'completed typed Voice responses remain terminal after controller restart')

// The dedicated controller.sqlite owner durably flushes each accepted mutation.
const controllerDirectory = mkdtempSync(join(tmpdir(), 'zyra-voice-controller-'))
const controllerPath = join(controllerDirectory, 'controller.sqlite')
const durableStore = await ForegroundControllerPersistence.open(controllerPath)
const durableRoutes = new ForegroundRouteController(durableStore, identities, clock)
durableRoutes.initializeChat({ conversationId: 'chat_durable', contextVersion: 2 })
durableStore.close()
const reopenedDurableStore = await ForegroundControllerPersistence.open(controllerPath)
assert.equal(reopenedDurableStore.activeRoute('chat_durable')?.context_version, 2)
reopenedDurableStore.close()
rmSync(controllerDirectory, { recursive: true, force: true })

// Direct ChatGPT capabilities are source-controlled and fail closed until the renderer bridges are proven.
const asyncProbe = await probeInstalledCodexRealtimeCapabilitiesAsync({
    directSignalingVerified: true,
    transcriptIdentityBridge: true,
    ownerScopedClientCommands: true,
    clock
})
assert.equal(asyncProbe.report.realtime.session.support, 'supported')
assert.equal(asyncProbe.report.realtime.sideband_control.support, 'supported')
assert.deepEqual(asyncProbe.report.realtime.transports, ['webrtc'])

const incompleteCodexReport = createCodexRealtimeCapabilityReport({
    providerVersion: 'chatgpt-frameless-v3',
    directSignalingVerified: true,
    transcriptIdentityBridge: false,
    ownerScopedClientCommands: false
}, clock.now())
assert.equal(evaluateRealtimeAudioCapabilities(incompleteCodexReport, new Date(clock.now())).ok, false)

const scriptedTransport = new ScriptedCodexTransport()
const codexAdapter = new CodexRealtimeForegroundAdapter(scriptedTransport, {
    providerVersion: 'chatgpt-frameless-v3',
    directSignalingVerified: true,
    transcriptIdentityBridge: true,
    ownerScopedClientCommands: true
}, clock)
const codexEvents: RealtimeDomainEvent[] = []
codexAdapter.subscribe((event) => codexEvents.push(event))
const codexContinuity = new FakeRealtimeContinuitySource(clock)
codexContinuity.initialize('chat_codex_adapter')
codexContinuity.appendMessage({
    conversationId: 'chat_codex_adapter',
    messageId: 'earlier_assistant_message',
    role: 'assistant',
    text: 'Earlier canonical answer.'
})
const codexRoute = routes.initializeChat({ conversationId: 'chat_codex_adapter', contextVersion: 0 })
const codexSeed = await codexContinuity.materialize('chat_codex_adapter', foregroundRouteClaim(codexRoute))
const codexAbort = new AbortController()
const codexInput: RealtimeConnectInput = {
    conversationId: 'chat_codex_adapter',
    projectCwd: 'C:/workspace',
    offerSdp: 'v=0\r\n',
    instructions: 'Zyra Voice',
    voice: 'cove',
    output: 'audio',
    requestedSessionGeneration: 1,
    hydrationSeed: codexSeed,
    signal: codexAbort.signal
}
const codexHandle = await codexAdapter.connect(codexInput)
assert.equal(codexHandle.realtimeVersion, 'v3')
assert.equal(scriptedTransport.lastStart?.clientManagedHandoffs, true)
assert.deepEqual(scriptedTransport.lastStart?.initialItems, [{
    role: 'assistant',
    text: 'Earlier canonical answer.'
}])
const codexDelta = createRealtimeHydrationDelta({
    deltaId: 'codex_delta_1',
    basePacketId: codexSeed.packetId,
    conversationId: 'chat_codex_adapter',
    fromWatermarks: codexSeed.sourceWatermarks,
    toWatermarks: { ...codexSeed.sourceWatermarks, context: 1 },
    items: [{
        itemId: 'codex_context_revision_1',
        role: 'developer',
        text: 'The user asked to preserve the existing API.',
        canonicalMessageId: null,
        conversationSequence: null,
        modality: 'system'
    }],
    generatedAt: clock.now()
})
await codexAdapter.appendContext(codexHandle.adapterSessionId, codexDelta)
assert.deepEqual(scriptedTransport.appendedContext, [{
    role: 'developer',
    text: 'The user asked to preserve the existing API.'
}])
scriptedTransport.emit('event', {
    type: 'transcript.done',
    threadId: codexHandle.realtimeProviderThreadId,
    providerItemId: 'codex_item_1',
    role: 'assistant',
    text: 'Understood.'
} satisfies AssistantRealtimeVoiceEvent)
assert.ok(codexEvents.some((event) => event.type === 'realtime.assistant.transcript.completed'
    && event.providerItemId === 'codex_item_1'))
const eventCountBeforeDuplicateTranscriptSource = codexEvents.length
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { id: 'codex_item_1', role: 'assistant', transcript: 'Understood.' }
})
assert.equal(
    codexEvents.length,
    eventCountBeforeDuplicateTranscriptSource,
    'app-server and WebRTC completion paths must converge on one provider item'
)
const eventCountBeforeIdentitylessFlatNotification = codexEvents.length
scriptedTransport.emit('event', {
    type: 'transcript.done',
    threadId: codexHandle.realtimeProviderThreadId,
    role: 'assistant',
    text: 'Missing identity.'
} satisfies AssistantRealtimeVoiceEvent)
assert.equal(codexEvents.length, eventCountBeforeIdentitylessFlatNotification)
const eventCountBeforeHydrationReplay = codexEvents.length
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { id: 'hydrated_assistant_item', role: 'assistant', transcript: 'Earlier canonical answer.' }
})
assert.equal(
    codexEvents.length,
    eventCountBeforeHydrationReplay,
    'hydrated startup history must not be emitted as a new canonical Voice message'
)
await codexAdapter.deliverComposerResponse(codexHandle.adapterSessionId, {
    turnId: 'typed-canonical-turn',
    text: 'Canonical typed answer.',
    canonicalMessageId: 'voice_assistant_typed_canonical'
})
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.created',
    turn: { id: 'unrelated-assistant-turn', role: 'assistant', transcript: '' }
})
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { id: 'unrelated-assistant-turn', role: 'assistant', transcript: 'An unrelated response remains canonical.' }
})
assert.ok(codexEvents.some((event) => event.type === 'realtime.assistant.transcript.completed'
    && event.providerItemId === 'unrelated-assistant-turn'))
const eventCountBeforeCanonicalSpeechReplay = codexEvents.length
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'conversation.item.created',
    item: { id: 'spoken-canonical-turn', role: 'assistant', text: '' }
})
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { id: 'spoken-canonical-turn', role: 'assistant', transcript: '**Canonical typed answer!**' }
})
assert.equal(codexEvents.length, eventCountBeforeCanonicalSpeechReplay, 'only the explicitly correlated spoken replay is suppressed when punctuation changes')
assert.deepEqual(scriptedTransport.requestedSpeech.at(-1), 'Canonical typed answer.')
assert.equal(scriptedTransport.requestedSpeechCanonicalMessageIds.at(-1), 'voice_assistant_typed_canonical')
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.created',
    turn: { id: 'webrtc_turn_1', role: 'assistant', transcript: '' }
})
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.delta',
    turn_id: 'webrtc_turn_1',
    delta: 'Identity-bearing '
})
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { id: 'webrtc_turn_1', role: 'assistant', transcript: 'Identity-bearing result.' }
})
assert.ok(codexEvents.some((event) => event.type === 'realtime.assistant.transcript.delta'
    && event.providerItemId === 'webrtc_turn_1'))
assert.ok(codexEvents.some((event) => event.type === 'realtime.assistant.transcript.completed'
    && event.providerItemId === 'webrtc_turn_1'
    && event.text === 'Identity-bearing result.'))
await codexAdapter.deliverComposerResponse(codexHandle.adapterSessionId, {
    turnId: 'private_typed_turn_1',
    text: 'Narrate this private read-only result.'
})
assert.deepEqual(scriptedTransport.presentedComposerResponses.at(-1), {
    turnId: 'private_typed_turn_1',
    text: 'Narrate this private read-only result.'
})
assert.equal(scriptedTransport.requestedSpeech.at(-1), 'Narrate this private read-only result.')
assert.equal(scriptedTransport.requestedSpeechCanonicalMessageIds.at(-1), undefined)
assert.equal(codexEvents.some((event) => event.type === 'realtime.assistant.transcript.completed'
    && event.providerItemId === 'composer:private_typed_turn_1'), false)
codexAdapter.ingestWebRtcEvent(codexHandle.adapterSessionId, {
    type: 'turn.done',
    turn: { role: 'assistant', transcript: 'Identity is missing.' }
})
assert.ok(codexEvents.some((event) => event.type === 'realtime.session.error'
    && event.category === 'incompatible_protocol'))
await codexAdapter.close(codexHandle.adapterSessionId, 'test_complete')
codexAdapter.dispose()

const assistantServiceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const canonicalVoiceProjectionSource = assistantServiceSource.match(
    /private async projectCanonicalVoiceMessage[\s\S]*?\n    private voiceContextVersion/u
)?.[0] || ''
assert.match(
    canonicalVoiceProjectionSource,
    /queueGeneratedSessionTitle/u,
    'a committed Voice user transcript must enter the normal model-backed chat-title generation path'
)

transcriptCommitter.dispose()
voiceSessions.dispose()
reopenedDb.close()
db.close()
console.log('Assistant canonical Voice core contract passed.')

function commitInput(input: {
    claim: ForegroundRouteClaim
    messageId: string
    role: 'user' | 'assistant'
    producer: 'user' | 'strong_primary' | 'realtime_foreground'
    text: string
    completedAt: string
}): CanonicalMessageCommitInput {
    return {
        conversationId: input.claim.conversationId,
        messageId: input.messageId,
        role: input.role,
        producer: input.producer,
        modality: input.claim.responseOwner === 'realtime_foreground' ? 'voice' : 'text',
        text: input.text,
        attachmentIds: [],
        routeClaim: input.claim,
        providerItemId: `provider_${input.messageId}`,
        providerCompletedAt: input.completedAt
    }
}
