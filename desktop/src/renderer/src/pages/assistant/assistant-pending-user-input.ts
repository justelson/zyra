import type {
    AssistantPendingUserInput,
    AssistantUserInputAnswer,
    AssistantUserInputQuestion
} from '@shared/assistant/contracts'

import { parseQuestionDate } from './assistant-question-date'

export type AssistantPendingUserInputDraftAnswers = Record<string, AssistantUserInputAnswer>

export type AssistantPendingUserInputProgress = {
    questionIndex: number
    activeQuestion: AssistantUserInputQuestion | null
    selectedAnswer: AssistantUserInputAnswer | null
    normalizedSelectedAnswer: AssistantUserInputAnswer | null
    selectedOptionLabel: string | null
    isCustomAnswer: boolean
    hasAnswer: boolean
    answeredQuestionCount: number
    isLastQuestion: boolean
    isReviewStep: boolean
}

export function isAssistantUserInputMultiValueQuestion(question: AssistantUserInputQuestion): boolean {
    return question.type === 'multi_select'
        || question.type === 'ranking'
        || (question.type === 'file_select' && question.multiple !== false)
}

export function reorderAssistantUserInputRanking(ranking: string[], draggedLabel: string, targetLabel: string): string[] {
    const fromIndex = ranking.indexOf(draggedLabel)
    const targetIndex = ranking.indexOf(targetLabel)
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return ranking
    const next = [...ranking]
    const [dragged] = next.splice(fromIndex, 1)
    next.splice(targetIndex, 0, dragged)
    return next
}

export function isAssistantUserInputAnswerComplete(
    question: AssistantUserInputQuestion,
    answer: AssistantUserInputAnswer | undefined,
    hasDraft: boolean
): boolean {
    if (!hasDraft) return false
    const required = question.required !== false
    const empty = Array.isArray(answer) ? answer.length === 0 : !String(answer || '').trim()
    if (!required && empty) return true

    if (question.type === 'multi_select' || question.type === 'file_select') {
        const values = Array.isArray(answer)
            ? answer.filter((entry) => entry.trim())
            : String(answer || '').trim() ? [String(answer).trim()] : []
        const minimum = Math.max(required ? 1 : 0, question.minSelections || 0)
        return values.length >= minimum
            && (question.maxSelections === undefined || values.length <= question.maxSelections)
    }

    if (question.type === 'ranking') {
        if (!Array.isArray(answer)) return false
        const optionLabels = question.options.map((option) => option.label)
        return answer.length === optionLabels.length
            && new Set(answer).size === optionLabels.length
            && answer.every((entry) => optionLabels.includes(entry))
    }

    const value = String(answer || '').trim()
    if (!value) return false
    if (question.type === 'number') {
        const numericValue = Number(value)
        return Number.isFinite(numericValue)
            && (question.min === undefined || numericValue >= question.min)
            && (question.max === undefined || numericValue <= question.max)
    }
    if (question.type === 'date') return parseQuestionDate(value) !== null
    return true
}

export function formatAssistantUserInputAnswer(
    question: AssistantUserInputQuestion,
    answer: AssistantUserInputAnswer | undefined
): string {
    if (Array.isArray(answer)) {
        if (answer.length === 0) return 'Skipped'
        return question.type === 'ranking' ? answer.join(' → ') : answer.join(', ')
    }
    return String(answer || '').trim() || 'Skipped'
}

export function buildAssistantPendingUserInputAnswers(
    questions: ReadonlyArray<AssistantUserInputQuestion>,
    draftAnswers: AssistantPendingUserInputDraftAnswers
): Record<string, AssistantUserInputAnswer> | null {
    const answers: Record<string, AssistantUserInputAnswer> = {}

    for (const question of questions) {
        const hasDraft = Object.prototype.hasOwnProperty.call(draftAnswers, question.id)
        const answer = draftAnswers[question.id]
        if (!isAssistantUserInputAnswerComplete(question, answer, hasDraft)) return null
        answers[question.id] = Array.isArray(answer)
            ? answer.map((entry) => entry.trim()).filter(Boolean)
            : String(answer || '').trim()
    }

    return answers
}

export function findFirstUnansweredAssistantPendingUserInputQuestionIndex(
    questions: ReadonlyArray<AssistantUserInputQuestion>,
    draftAnswers: AssistantPendingUserInputDraftAnswers
): number {
    const unansweredIndex = questions.findIndex((question) => !isAssistantUserInputAnswerComplete(
        question,
        draftAnswers[question.id],
        Object.prototype.hasOwnProperty.call(draftAnswers, question.id)
    ))
    if (unansweredIndex >= 0) return unansweredIndex
    return Math.max(questions.length - 1, 0)
}

export function deriveAssistantPendingUserInputProgress(
    pendingInput: AssistantPendingUserInput | null,
    draftAnswers: AssistantPendingUserInputDraftAnswers,
    questionIndex: number
): AssistantPendingUserInputProgress | null {
    if (!pendingInput) return null

    const questions = pendingInput.questions
    if (questions.length === 0) {
        return {
            questionIndex: 0,
            activeQuestion: null,
            selectedAnswer: null,
            normalizedSelectedAnswer: null,
            selectedOptionLabel: null,
            isCustomAnswer: false,
            hasAnswer: false,
            answeredQuestionCount: 0,
            isLastQuestion: true,
            isReviewStep: true
        }
    }

    const normalizedQuestionIndex = Math.max(0, Math.min(questionIndex, questions.length))
    const isReviewStep = normalizedQuestionIndex >= questions.length
    const activeQuestion = isReviewStep ? null : questions[normalizedQuestionIndex] || null
    const selectedAnswer = activeQuestion && Object.prototype.hasOwnProperty.call(draftAnswers, activeQuestion.id)
        ? draftAnswers[activeQuestion.id]
        : null
    const normalizedSelectedAnswer = Array.isArray(selectedAnswer)
        ? selectedAnswer.map((entry) => entry.trim()).filter(Boolean)
        : String(selectedAnswer || '').trim() || null
    const optionLabels = new Set(activeQuestion?.options.map((option) => option.label) || [])
    const customValues = Array.isArray(normalizedSelectedAnswer)
        ? normalizedSelectedAnswer.filter((entry) => !optionLabels.has(entry))
        : normalizedSelectedAnswer && !optionLabels.has(normalizedSelectedAnswer) ? [normalizedSelectedAnswer] : []
    const hasAnswer = activeQuestion ? isAssistantUserInputAnswerComplete(
        activeQuestion,
        selectedAnswer ?? undefined,
        Object.prototype.hasOwnProperty.call(draftAnswers, activeQuestion.id)
    ) : false

    return {
        questionIndex: normalizedQuestionIndex,
        activeQuestion,
        selectedAnswer,
        normalizedSelectedAnswer,
        selectedOptionLabel: Array.isArray(normalizedSelectedAnswer) ? null : customValues.length > 0 ? null : normalizedSelectedAnswer,
        isCustomAnswer: customValues.length > 0,
        hasAnswer,
        answeredQuestionCount: questions.reduce((count, question) => count + (isAssistantUserInputAnswerComplete(
            question,
            draftAnswers[question.id],
            Object.prototype.hasOwnProperty.call(draftAnswers, question.id)
        ) ? 1 : 0), 0),
        isLastQuestion: !isReviewStep && normalizedQuestionIndex >= questions.length - 1,
        isReviewStep
    }
}
