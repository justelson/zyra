import type { AssistantMessage, AssistantPendingUserInput, AssistantUserInputAnswer, AssistantUserInputQuestion } from './contracts'

const USER_INPUT_RESPONSE_REPLAY_WINDOW_MS = 5 * 60_000

function formatAnswer(question: AssistantUserInputQuestion, answer: AssistantUserInputAnswer | undefined): string {
    if (Array.isArray(answer)) {
        if (answer.length === 0) return 'Skipped'
        return question.type === 'ranking' ? answer.join(' → ') : answer.join(', ')
    }
    return String(answer || '').trim() || 'Skipped'
}

export function formatAssistantUserInputContinuationPrompt(
    questions: ReadonlyArray<AssistantUserInputQuestion>,
    answers: Record<string, AssistantUserInputAnswer>
): string {
    const lines = questions.map((question) => `- ${question.header}: ${formatAnswer(question, answers[question.id])}`)
    return ['Here are my answers:', '', ...lines].join('\n')
}

export function reconcileAssistantUserInputResponseMessageIds(
    inputs: ReadonlyArray<AssistantPendingUserInput>,
    existingMessages: ReadonlyArray<AssistantMessage>,
    canonicalMessages: ReadonlyArray<AssistantMessage>
): AssistantPendingUserInput[] {
    const existingById = new Map(existingMessages.map((message) => [message.id, message]))
    const canonicalIds = new Set(canonicalMessages.map((message) => message.id))
    const claimedCanonicalIds = new Set(inputs.flatMap((input) => (
        input.responseMessageId && canonicalIds.has(input.responseMessageId) ? [input.responseMessageId] : []
    )))

    return inputs.map((input) => {
        const responseMessageId = input.responseMessageId
        if (!responseMessageId || canonicalIds.has(responseMessageId) || input.status !== 'resolved') return input
        const optimisticMessage = existingById.get(responseMessageId)
        const expectedText = optimisticMessage?.text
            || (input.answers ? formatAssistantUserInputContinuationPrompt(input.questions, input.answers) : '')
        const anchorTime = Date.parse(optimisticMessage?.createdAt || input.resolvedAt || input.createdAt)
        if (!expectedText || !Number.isFinite(anchorTime)) return input

        const canonical = canonicalMessages
            .filter((message) => {
                if (message.role !== 'user' || message.text !== expectedText || claimedCanonicalIds.has(message.id)) return false
                const createdAt = Date.parse(message.createdAt)
                return Number.isFinite(createdAt) && Math.abs(createdAt - anchorTime) <= USER_INPUT_RESPONSE_REPLAY_WINDOW_MS
            })
            .sort((left, right) => (
                Math.abs(Date.parse(left.createdAt) - anchorTime) - Math.abs(Date.parse(right.createdAt) - anchorTime)
                || left.createdAt.localeCompare(right.createdAt)
                || left.id.localeCompare(right.id)
            ))[0]
        if (!canonical) return input
        claimedCanonicalIds.add(canonical.id)
        return { ...input, responseMessageId: canonical.id }
    })
}
