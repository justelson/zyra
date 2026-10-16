import assert from 'node:assert/strict'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import { recoverPersistedSnapshot } from '../src/main/assistant/projector'
import { formatAssistantUserInputContinuationPrompt, reconcileAssistantUserInputResponseMessageIds } from '../src/shared/assistant/user-input-continuation'
import type { AssistantPendingUserInput, AssistantMessage } from '../src/shared/assistant/contracts'

const createdAt = '2026-09-17T10:00:00.000Z'
const questions = [{ id: 'choice', header: 'Approach', question: 'Which approach?', type: 'single_select' as const, options: [{ label: 'Small fix', description: '' }] }]
const resolved: AssistantPendingUserInput = { id: 'question-record', requestId: 'question-request', questions, status: 'resolved', answers: { choice: 'Small fix' }, responseMessageId: 'local-answer', turnId: 'question-turn', createdAt, resolvedAt: '2026-09-17T10:01:00.000Z' }
const thread = createAssistantThread(createdAt)
thread.pendingUserInputs = [resolved]
const snapshot = createDefaultAssistantSnapshot()
snapshot.sessions = [createAssistantSessionRecord({ sessionId: 'session', title: 'Question history', projectPath: null, createdAt, thread })]
assert.deepEqual(recoverPersistedSnapshot(snapshot).sessions[0]!.threads[0]!.pendingUserInputs, [resolved], 'reopening preserves answered questions as durable message presentation receipts')
assert.deepEqual(snapshot.sessions[0]!.threads[0]!.pendingUserInputs, [resolved], 'restoring does not mutate persisted source')
const text = formatAssistantUserInputContinuationPrompt(questions, resolved.answers!)
const canonical: AssistantMessage = { id: 'canonical-answer', role: 'user', text, turnId: 'answer-turn', streaming: false, createdAt: resolved.resolvedAt!, updatedAt: resolved.resolvedAt! }
const reconcile = (input: AssistantPendingUserInput, messages: AssistantMessage[]) => reconcileAssistantUserInputResponseMessageIds([input], [], messages)[0]!
assert.equal(reconcile({ ...resolved, responseMessageId: null }, [canonical]).responseMessageId, canonical.id, 'legacy externally answered receipts recover missing canonical message association')
assert.equal(reconcile({ ...resolved, responseMessageId: null }, [{ ...canonical, text: text.replace(/\n/g, '\r\n') }]).responseMessageId, canonical.id, 'legacy Windows line endings do not lose structured answer cards')
assert.equal(reconcile({ ...resolved, responseMessageId: null }, [{ ...canonical, createdAt: '2026-09-17T11:00:00Z' }]).responseMessageId, null, 'unrelated later authored lookalikes remain ordinary messages')
assert.equal(reconcile({ ...resolved, responseMessageId: null, status: 'pending', answers: null }, [canonical]).responseMessageId, null, 'pending questions cannot claim an authored lookalike answer')
assert.equal(reconcile({ ...resolved, responseMessageId: null }, [{ ...canonical, text: text + '\nAn extra instruction.' }]).responseMessageId, null, 'additional authored text never becomes a generated answer card')
const { recoverCanonicalUserInputReceipts, mergeRecoveredUserInputReceipts } = await import('../src/main/assistant/user-input-history')
const entries = [
    { type: 'message', timestamp: createdAt, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'question-call', name: 'request_user_input', arguments: { questions } }] } },
    { type: 'message', timestamp: createdAt, message: { role: 'toolResult', toolCallId: 'question-call', toolName: 'request_user_input', details: { questions, requestId: 'question-request', deferred: true }, content: [] } },
    { type: 'message', timestamp: resolved.resolvedAt, message: { role: 'user', content: [{ type: 'text', text }] } }
]
const recovered = recoverCanonicalUserInputReceipts(entries, [{ ...canonical, timelineSequence: 3 }])
const { projectLoadedHistoryEntries, historyQuestionCallIds } = await import('../../src/agent-server/history-bodies.mjs')
const locatedEntries = entries.map((entry, index) => ({ ...entry, id: `control-entry-${index}` }))
const onDemandEntries = projectLoadedHistoryEntries(locatedEntries, 0, { toolResultBodies: 'lazy-desktop-v2', canonicalChatId: 'question-history' })
const onDemandRecovered = recoverCanonicalUserInputReceipts(onDemandEntries, [{ ...canonical, timelineSequence: 3 }])
assert.equal(onDemandRecovered[0]?.requestId, 'question-request', 'on-demand output history preserves the real question request owner')
const unnamedLocated = structuredClone(locatedEntries)
delete (unnamedLocated[1]!.message as any).toolName
assert.equal(recoverCanonicalUserInputReceipts(projectLoadedHistoryEntries(unnamedLocated, 0, { toolResultBodies: 'lazy-desktop-v2', canonicalChatId: 'question-history' }), [{ ...canonical, timelineSequence: 3 }])[0]?.requestId, 'question-request', 'unnamed legacy question results retain their control metadata')
const gapEntries = [unnamedLocated[0], { type: 'custom', id: 'waiting', data: {} }, ...unnamedLocated.slice(1)]
const gapPage = projectLoadedHistoryEntries(gapEntries.slice(1), 1, { toolResultBodies: 'lazy-desktop-v2', canonicalChatId: 'question-history', questionCallIds: historyQuestionCallIds(gapEntries, 1) })
assert.equal(recoverCanonicalUserInputReceipts(gapPage, [{ ...canonical, timelineSequence: 4 }], 1)[0]?.requestId, 'question-request', 'an isolated legacy question result recovers its real owner through the paged DTO')
;(gapEntries[2]!.message!.details as any).cancelled = true
const cancelledGap = projectLoadedHistoryEntries(gapEntries.slice(1), 1, { toolResultBodies: 'lazy-desktop-v2', canonicalChatId: 'question-history', questionCallIds: historyQuestionCallIds(gapEntries, 1) })
assert.equal(recoverCanonicalUserInputReceipts(cancelledGap, [{ ...canonical, timelineSequence: 4 }], 1).length, 0, 'page gaps never revive cancelled legacy questions')
const cancelledLocated = structuredClone(locatedEntries)
;(cancelledLocated[1]!.message.details as any).cancelled = true
assert.equal(recoverCanonicalUserInputReceipts(projectLoadedHistoryEntries(cancelledLocated, 0, { toolResultBodies: 'lazy-desktop-v2', canonicalChatId: 'question-history' }), [{ ...canonical, timelineSequence: 3 }]).length, 0, 'lazy history cannot revive cancelled questions')
assert.equal(recovered.length, 1, 'legacy cold canonical history restores missing question receipts')
assert.equal(recovered[0]!.responseMessageId, canonical.id)
assert.deepEqual(recovered[0]!.answers, resolved.answers)
assert.equal(mergeRecoveredUserInputReceipts([resolved], recovered).length, 1, 'recovery enriches rather than duplicates live receipts')
const changedIdentity = mergeRecoveredUserInputReceipts([{ ...resolved, responseMessageId: null }], [{ ...resolved, requestId: 'recovered-request', responseMessageId: 'recovered-answer' }])
assert.equal(changedIdentity.length, 1, 'recovery also matches the durable row ID when request and response IDs change')
assert.equal(changedIdentity[0]!.id, resolved.id)
assert.equal(changedIdentity[0]!.requestId, 'recovered-request')
assert.equal(recoverCanonicalUserInputReceipts(entries.slice(2), [{ ...canonical, timelineSequence: 1 }]).length, 0, 'an authored answer-looking prompt without a question tool stays ordinary')
const cancelled = structuredClone(entries)
;(cancelled[1]!.message.details as any).cancelled = true
assert.equal(recoverCanonicalUserInputReceipts(cancelled, [{ ...canonical, timelineSequence: 3 }]).length, 0)
const multi = { ...canonical, text: 'Here are my answers:\n\n- Approach: Paper\n- with soft borders', timelineSequence: 3 }
assert.equal(recoverCanonicalUserInputReceipts(entries, [multi])[0]!.answers!.choice, 'Paper\nwith soft borders', 'legacy prefixed continuation lines restore multiline answers')
const laterPrompt = { ...canonical, text: 'An ordinary next prompt', timelineSequence: 3 }
const withInterveningUser = [...entries, entries[2]]
assert.equal(recoverCanonicalUserInputReceipts(withInterveningUser, [laterPrompt, { ...canonical, timelineSequence: 4 }]).length, 0, 'an intervening user prompt consumes the question association')
const multilineAnswers = { choice: 'Paper\nwith soft borders' }
assert.equal(reconcile({ ...resolved, answers: multilineAnswers, responseMessageId: null }, [multi]).responseMessageId, canonical.id, 'legacy multiline runtime prompts relink existing receipts')
const claimed = reconcileAssistantUserInputResponseMessageIds([{ ...resolved, responseMessageId: null }, { ...resolved, id: 'second', requestId: 'second', responseMessageId: null }], [], [canonical])
assert.equal(claimed.filter(input => input.responseMessageId === canonical.id).length, 1, 'a canonical message can be claimed only once')
assert.equal(recoverCanonicalUserInputReceipts(entries.slice(0, 2), [{ ...canonical, timelineSequence: 103 }], 100)[0]!.responseMessageId, canonical.id, 'older question page repairs answer receipt in persisted newer tail using canonical sequence offsets')
assert.equal(recoverCanonicalUserInputReceipts(entries.slice(0, 2), [{ ...laterPrompt, timelineSequence: 103 }, { ...canonical, timelineSequence: 104 }], 100).length, 0, 'cross-page recovery stops at the first user boundary')
const { handleAssistantRuntimeEvent } = await import('../src/main/assistant/service-runtime-events')
const liveThread = structuredClone(thread)
liveThread.messages = []
liveThread.pendingUserInputs = [{ ...resolved, responseMessageId: null }]
const liveSession = { ...snapshot.sessions[0]!, threads: [liveThread] }
const emitted: Array<{ type: string; payload: any }> = []
const deps = { findThreadRecord: () => ({ session: liveSession, thread: liveThread }), findSessionByThreadId: () => liveSession, requireThread: () => liveThread, appendEvent: (type: string, _at: string, payload: any) => { emitted.push({ type, payload }); if (type === 'thread.user-input.updated') liveThread.pendingUserInputs = [payload.userInput] } }
handleAssistantRuntimeEvent({ type: 'user.message.received', eventId: 'live-answer', threadId: liveThread.id, turnId: 'answer-turn', createdAt: canonical.createdAt, payload: { messageId: canonical.id, text } } as any, deps as any)
assert.equal(emitted[0]!.type, 'thread.user-input.updated', 'remote response association precedes visible user message insertion')
assert.equal(emitted[0]!.payload.userInput.responseMessageId, canonical.id)
assert.equal(emitted[1]!.type, 'thread.message.user')
liveThread.messages = [canonical]
liveThread.pendingUserInputs = [{ ...resolved, status: 'pending', answers: null, responseMessageId: null }]
emitted.length = 0
handleAssistantRuntimeEvent({ type: 'user-input.resolved', eventId: 'late-resolution', threadId: liveThread.id, turnId: 'question-turn', requestId: resolved.requestId, createdAt: canonical.createdAt, payload: { answers: resolved.answers } } as any, deps as any)
assert.equal(emitted[0]!.payload.userInput.responseMessageId, canonical.id, 'late resolution also links an already received response')
console.log('assistant user-input durable history: ok')
