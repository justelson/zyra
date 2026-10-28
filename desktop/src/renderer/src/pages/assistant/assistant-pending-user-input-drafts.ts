import type { AssistantUserInputAnswer } from '@shared/assistant/contracts'
import type { AssistantPendingUserInputDraftAnswers } from './assistant-pending-user-input'

export type AssistantPendingUserInputDraftSnapshot = {
    answers: AssistantPendingUserInputDraftAnswers
    questionIndex: number
    customQuestionId: string | null
    returnToReview: boolean
    finishingQuestions?: boolean
}

const MAX_CACHED_REQUESTS = 64
const draftCache = new Map<string, AssistantPendingUserInputDraftSnapshot>()

function cloneAnswers(answers: AssistantPendingUserInputDraftAnswers): AssistantPendingUserInputDraftAnswers {
    return Object.fromEntries(Object.entries(answers).map(([questionId, answer]) => [
        questionId,
        Array.isArray(answer) ? [...answer] : answer
    ])) as Record<string, AssistantUserInputAnswer>
}

export function readAssistantPendingUserInputDraft(requestId: string): AssistantPendingUserInputDraftSnapshot | null {
    const snapshot = draftCache.get(requestId)
    if (!snapshot) return null
    return {
        ...snapshot,
        answers: cloneAnswers(snapshot.answers)
    }
}

export function writeAssistantPendingUserInputDraft(
    requestId: string,
    snapshot: AssistantPendingUserInputDraftSnapshot
): void {
    draftCache.delete(requestId)
    draftCache.set(requestId, {
        ...snapshot,
        answers: cloneAnswers(snapshot.answers),
        questionIndex: Math.max(0, Math.floor(snapshot.questionIndex))
    })
    while (draftCache.size > MAX_CACHED_REQUESTS) {
        const oldestRequestId = draftCache.keys().next().value
        if (!oldestRequestId) break
        draftCache.delete(oldestRequestId)
    }
}

export function clearAssistantPendingUserInputDraft(requestId: string): void {
    draftCache.delete(requestId)
}
