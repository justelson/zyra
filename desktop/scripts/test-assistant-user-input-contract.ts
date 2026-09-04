import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AssistantThread, AssistantUserInputQuestion } from '../src/shared/assistant/contracts'
import { toUserInputQuestions } from '../src/main/assistant/codex-runtime-session-utils'
import { buildTurnParams } from '../src/main/assistant/codex-runtime-protocol'
import { respondToAssistantUserInputWithRuntime } from '../src/main/assistant/user-input-response'
import {
    formatAssistantUserInputContinuationPrompt,
    reconcileAssistantUserInputResponseMessageIds
} from '../src/shared/assistant/user-input-continuation'
import {
    buildAssistantPendingUserInputAnswers,
    deriveAssistantPendingUserInputProgress,
    findFirstUnansweredAssistantPendingUserInputQuestionIndex,
    formatAssistantUserInputAnswer,
    reorderAssistantUserInputRanking
} from '../src/renderer/src/pages/assistant/assistant-pending-user-input'
import { buildTimelineRows, getTimelineEntries, shouldRenderActivity } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import {
    clearAssistantPendingUserInputDraft,
    readAssistantPendingUserInputDraft,
    writeAssistantPendingUserInputDraft
} from '../src/renderer/src/pages/assistant/assistant-pending-user-input-drafts'

const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const asString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const rawQuestions = [
    { id: 'text', header: 'Text', question: 'What should it say?', type: 'text', placeholder: 'Write an answer' },
    { id: 'single', header: 'Single', question: 'Choose one', type: 'single_select', allowOther: true, options: [{ label: 'A', recommended: true }] },
    { id: 'multi', header: 'Multi', question: 'Choose several', type: 'multi_select', minSelections: 2, options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'confirm', header: 'Confirm', question: 'Continue?', type: 'confirm' },
    { id: 'files', header: 'Files', question: 'Choose files', type: 'file_select', multiple: true, options: [{ label: 'src/a.ts' }, { label: 'src/b.ts' }] },
    { id: 'number', header: 'Number', question: 'How many?', type: 'number', min: 1, max: 5, step: 1 },
    { id: 'date', header: 'Date', question: 'Which date?', type: 'date' },
    { id: 'ranking', header: 'Ranking', question: 'Order these', type: 'ranking', options: [{ label: 'Correctness' }, { label: 'Speed' }] }
]
const questions = toUserInputQuestions(rawQuestions, asRecord, asString)
assert.equal(questions.length, rawQuestions.length, 'the schema has no arbitrary question-count cap')
assert.deepEqual(questions.map((question) => question.type), ['text', 'single_select', 'multi_select', 'confirm', 'file_select', 'number', 'date', 'ranking'])
assert.equal(questions[1].allowOther, true)
assert.equal(questions[1].options[0].recommended, true)
assert.equal(questions[0].required, true)
assert.equal(questions[2].minSelections, 2)

const legacy = toUserInputQuestions([{ id: 'legacy', header: 'Legacy', question: 'Old question', options: [{ label: 'One', description: 'First' }] }], asRecord, asString)
assert.equal(legacy[0].type, 'single_select', 'legacy option questions remain readable')
assert.equal(legacy[0].required, true)
assert.equal(legacy[0].allowOther, false)
const deduplicatedRankingQuestion = toUserInputQuestions([{
    id: 'deduplicated-ranking',
    header: 'Ranking',
    question: 'Order these',
    type: 'ranking',
    options: [{ label: 'Correctness' }, { label: 'Correctness' }, { label: 'Speed' }]
}], asRecord, asString)[0]
assert.deepEqual(deduplicatedRankingQuestion.options.map((option) => option.label), ['Correctness', 'Speed'], 'Desktop ranking identities are unique')

const answers = {
    text: 'Ship it',
    single: 'A',
    multi: ['A', 'B'],
    confirm: 'Yes',
    files: ['src/a.ts'],
    number: '3',
    date: '2026-08-19',
    ranking: ['Correctness', 'Speed']
}
assert.deepEqual(buildAssistantPendingUserInputAnswers(questions, answers), answers)
assert.equal(findFirstUnansweredAssistantPendingUserInputQuestionIndex(questions, { ...answers, multi: ['A'] }), 2)
assert.equal(formatAssistantUserInputAnswer(questions[7], answers.ranking), 'Correctness → Speed')
assert.deepEqual(
    reorderAssistantUserInputRanking(['Correctness', 'Speed', 'Polish'], 'Polish', 'Correctness'),
    ['Polish', 'Correctness', 'Speed'],
    'ranking drag-and-drop moves the dragged answer to the selected position'
)
const progress = deriveAssistantPendingUserInputProgress({
    id: 'pending', requestId: 'request', questions, status: 'pending', answers: null, turnId: null,
    createdAt: '2026-08-19T00:00:00.000Z', resolvedAt: null
}, answers, questions.length)
assert.equal(progress?.isReviewStep, true)
assert.equal(progress?.answeredQuestionCount, questions.length)
const questionRows = buildTimelineRows(getTimelineEntries([], [], [], [{
    id: 'pending', requestId: 'request', questions, status: 'pending', answers: null, responseMessageId: null, turnId: 'turn:question',
    createdAt: '2026-08-19T00:00:00.000Z', resolvedAt: null
}]), false, null)
assert.equal(questionRows[0]?.kind, 'user-input', 'question sets are first-class replayable timeline rows')
const handedOffRows = groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries([
        {
            id: 'handoff-user', role: 'user', text: 'Choose the scope.', turnId: 'turn:question', streaming: false,
            createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z'
        },
        {
            id: 'handoff-purpose', role: 'assistant', text: 'I need the scope before editing.', turnId: 'turn:question', streaming: false,
            createdAt: '2026-08-19T00:00:01.000Z', updatedAt: '2026-08-19T00:00:01.000Z'
        }
    ], [], [], [{
        id: 'handoff-questions', requestId: 'request:handoff', questions, status: 'pending', answers: null,
        responseMessageId: null, turnId: 'turn:question', createdAt: '2026-08-19T00:00:02.000Z', resolvedAt: null
    }]), false, null),
    messages: [
        {
            id: 'handoff-user', role: 'user', text: 'Choose the scope.', turnId: 'turn:question', streaming: false,
            createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z'
        },
        {
            id: 'handoff-purpose', role: 'assistant', text: 'I need the scope before editing.', turnId: 'turn:question', streaming: false,
            createdAt: '2026-08-19T00:00:01.000Z', updatedAt: '2026-08-19T00:00:01.000Z'
        }
    ],
    latestAssistantMessageId: 'handoff-purpose',
    latestTurnStartedAt: '2026-08-19T00:00:00.000Z',
    isWorking: false
})
assert.deepEqual(handedOffRows.map((row) => row.kind), ['message', 'turn-work-summary', 'user-input'], 'pre-question narration stays inside Work and cannot masquerade as a final assistant answer')
assert.equal(handedOffRows[1]?.kind === 'turn-work-summary' ? handedOffRows[1].rows[0]?.id : null, 'handoff-purpose')
const pageScopedQuestions = getTimelineEntries([{
    id: 'latest-page-message', role: 'user', text: 'Newest loaded turn', turnId: 'turn:newest', streaming: false,
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
}], [], [], [{
    id: 'old-answered', requestId: 'request:old', questions, status: 'resolved', answers,
    responseMessageId: 'message:not-loaded', turnId: 'turn:not-loaded',
    createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: '2026-08-01T00:01:00.000Z'
}])
assert.equal(pageScopedQuestions.some((entry) => entry.type === 'user-input'), false, 'resolved question rows stay inside the loaded history window')
assert.equal(getTimelineEntries([], [], [], [{
    id: 'old-pending', requestId: 'request:pending', questions, status: 'pending', answers: null,
    responseMessageId: null, turnId: 'turn:not-loaded', createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null
}]).some((entry) => entry.type === 'user-input'), true, 'pending questions remain visible even when their original turn is outside the loaded page')
assert.equal(shouldRenderActivity({
    id: 'request-tool', kind: 'tool', tone: 'tool', summary: 'Used request_user_input', turnId: 'turn:question', createdAt: '2026-08-19T00:00:00.000Z',
    payload: { toolName: 'request_user_input' }
}), false, 'the raw question tool row cannot duplicate the structured form')
assert.equal(shouldRenderActivity({
    id: 'legacy-response', kind: 'user-input.resolved', tone: 'tool', summary: 'Consulted user', turnId: 'turn:question', createdAt: '2026-08-19T00:00:01.000Z'
}), false, 'legacy Consulted user activities defer to the persisted Answered N questions row')

writeAssistantPendingUserInputDraft('request:cache-test', {
    answers: { text: 'Keep this', ranking: ['Speed', 'Correctness'] },
    questionIndex: 7,
    customQuestionId: null,
    returnToReview: false
})
assert.deepEqual(readAssistantPendingUserInputDraft('request:cache-test'), {
    answers: { text: 'Keep this', ranking: ['Speed', 'Correctness'] },
    questionIndex: 7,
    customQuestionId: null,
    returnToReview: false
}, 'guided-input answers and step survive panel unmounts while switching chats')
clearAssistantPendingUserInputDraft('request:cache-test')
assert.equal(readAssistantPendingUserInputDraft('request:cache-test'), null)

const optionalQuestion: AssistantUserInputQuestion = {
    id: 'optional', header: 'Optional', question: 'Anything else?', type: 'text', options: [], required: false, allowOther: false
}
assert.deepEqual(buildAssistantPendingUserInputAnswers([optionalQuestion], { optional: '' }), { optional: '' })
assert.equal(buildAssistantPendingUserInputAnswers([optionalQuestion], {}), null, 'optional questions still require an explicit Skip action')

const thread = {
    id: 'thread', providerThreadId: 'provider', source: 'root', parentThreadId: null, providerParentThreadId: null,
    subagentDepth: null, agentNickname: null, agentRole: null, model: 'openai-codex/gpt-5.6-sol', cwd: 'C:/workspace',
    messageCount: 0, activityCount: 0, proposedPlanCount: 0, lastSeenCompletedTurnId: null,
    runtimeMode: 'approval-required', interactionMode: 'plan', webSearch: true, webFetch: true, state: 'ready', lastError: null,
    createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', latestTurn: null,
    hasPendingApprovals: false, hasPendingUserInputs: false, hasActivePlan: false, activePlan: null,
    messages: [], proposedPlans: [], activities: [], pendingApprovals: [], pendingUserInputs: []
} as AssistantThread
const responseLifecycleCalls: string[] = []
const pendingResponseThread = {
    ...thread,
    pendingUserInputs: [{
        id: 'pending-response',
        requestId: 'request:response',
        questions,
        status: 'pending',
        answers: null,
        turnId: 'turn:response',
        createdAt: '2026-08-19T00:00:00.000Z',
        resolvedAt: null
    }]
} as AssistantThread
const continuationPrompt = await respondToAssistantUserInputWithRuntime({
    runtime: {
        hasSession: () => false,
        connect: async () => { responseLifecycleCalls.push('connect') },
        respondUserInput: async (threadId: string, requestId: string) => {
            responseLifecycleCalls.push(`respond:${threadId}:${requestId}`)
            return { continuationPrompt: null }
        }
    },
    thread: pendingResponseThread,
    cwd: 'C:/workspace',
    requestId: 'request:response',
    questions,
    answers
})
assert.deepEqual(responseLifecycleCalls, [
    'connect',
    'respond:provider:request:response'
], 'submitting answers reattaches a chat-switched canonical runtime before continuing')
assert.equal(continuationPrompt, formatAssistantUserInputContinuationPrompt(questions, answers))
assert.match(continuationPrompt, /^Here are my answers:/)
const reconciledResponse = reconcileAssistantUserInputResponseMessageIds(
    [{
        id: 'answered', requestId: 'request:answered', questions, status: 'resolved', answers,
        responseMessageId: 'assistant-message-local', turnId: 'turn:response',
        createdAt: '2026-08-19T00:00:00.000Z', resolvedAt: '2026-08-19T00:01:00.000Z'
    }],
    [{
        id: 'assistant-message-local', role: 'user', text: continuationPrompt, turnId: 'turn:answer', streaming: false,
        createdAt: '2026-08-19T00:01:00.000Z', updatedAt: '2026-08-19T00:01:00.000Z'
    }],
    [{
        id: 'pi-message:answer', role: 'user', text: continuationPrompt, turnId: 'shared-turn:answer', streaming: false,
        createdAt: '2026-08-19T00:01:00.200Z', updatedAt: '2026-08-19T00:01:00.200Z'
    }]
)
assert.equal(reconciledResponse[0]?.responseMessageId, 'pi-message:answer', 'canonical replay repairs the durable question-to-answer-message link')

const turn = buildTurnParams(thread, 'hello', undefined, undefined, 'plan')
const collaborationMode = turn.collaborationMode as { mode: string; settings: { developer_instructions: string } }
assert.equal(collaborationMode.mode, 'default', 'legacy Plan-mode turns execute in normal mode')
assert.match(collaborationMode.settings.developer_instructions, /Use request_user_input only after inspecting available context/)
assert.match(collaborationMode.settings.developer_instructions, /<proposed_plan>/)
assert.doesNotMatch(collaborationMode.settings.developer_instructions, /Do not call request_user_input in Default mode/)
const questionFieldSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPendingUserInputQuestionField.tsx', import.meta.url), 'utf8')
const inlineQuestionSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineQuestionSet.tsx', import.meta.url), 'utf8')
const composerPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationComposerPane.tsx', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimeline.tsx', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
const requestToolSource = readFileSync(new URL('../../src/request-user-input-tool.mjs', import.meta.url), 'utf8')
const sessionActionsSource = readFileSync(new URL('../src/main/assistant/service-session-actions.ts', import.meta.url), 'utf8')
const persistenceSource = readFileSync(new URL('../src/main/assistant/persistence-write.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/renderer/src/pages/settings/AssistantSettings.tsx', import.meta.url), 'utf8')
const conversationSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const planCardSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineProposedPlan.tsx', import.meta.url), 'utf8')
assert.match(questionFieldSource, /DndContext[\s\S]*SortableContext/, 'ranking answers use sortable pointer dragging')
assert.match(questionFieldSource, /CSS\.Transform\.toString\(transform\)/, 'the complete ranking row follows the pointer')
assert.match(inlineQuestionSource, /input\.questions\.map/, 'all questions render in one flat inline form')
assert.match(inlineQuestionSource, /Asked \$\{count\}/, 'pending handoffs expose an Asked N questions boundary')
assert.match(inlineQuestionSource, /Answered \{count\}/, 'completed handoffs collapse to Answered N questions')
assert.match(inlineQuestionSource, /Your answers will continue as a new message/, 'the continuation semantics are visible at submission')
assert.match(inlineQuestionSource, /responseMessageId/, 'resolved question sets retain a link to their answer message')
assert.match(inlineQuestionSource, /submittingRef\.current/, 'rapid clicks cannot submit the same answer form twice')
assert.doesNotMatch(composerPaneSource, /AssistantPendingUserInputPanel/, 'normal structured questions no longer replace the composer')
assert.match(composerPaneSource, /AssistantPendingApprovalPanel/, 'approvals remain blocking composer actions')
assert.match(timelineSource, /AssistantTimelineQuestionSet/, 'structured questions render in the timeline')
assert.match(bridgeSource, /deferred: true/, 'the runtime bridge hands questions off without blocking the model turn')
assert.match(requestToolSource, /terminate: true/, 'the handoff terminates the current tool turn cleanly')
assert.match(sessionActionsSource, /responseMessageId[\s\S]*sendAssistantPromptAction/, 'submitted answers reserve a linked user message and use the normal prompt path')
assert.match(sessionActionsSource, /activeUserInputResponses/, 'the main process single-flights each question response')
assert.match(persistenceSource, /response_message_id/, 'the question-to-answer-message link survives replay')
assert.doesNotMatch(settingsSource, /title="Interaction mode"/)
assert.match(conversationSource, /<approved_plan>/, 'the plan-card Implement handoff remains wired')
assert.match(planCardSource, /Implement/, 'normal-mode plan cards keep their approval action')

console.log('assistant user-input and retired Plan-mode contract: ok')
