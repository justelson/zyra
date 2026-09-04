import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Send } from 'lucide-react'
import type {
    AssistantPendingUserInput,
    AssistantUserInputAnswer,
    AssistantUserInputQuestion
} from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { AssistantPendingUserInputQuestionField } from './AssistantPendingUserInputQuestionField'
import {
    buildAssistantPendingUserInputAnswers,
    formatAssistantUserInputAnswer,
    type AssistantPendingUserInputDraftAnswers
} from './assistant-pending-user-input'
import {
    clearAssistantPendingUserInputDraft,
    readAssistantPendingUserInputDraft,
    writeAssistantPendingUserInputDraft
} from './assistant-pending-user-input-drafts'
import { getTimelineMessageDomId } from './assistant-timeline-helpers'

function initialDraft(input: AssistantPendingUserInput): AssistantPendingUserInputDraftAnswers {
    const cached = readAssistantPendingUserInputDraft(input.requestId)?.answers || {}
    const answers: AssistantPendingUserInputDraftAnswers = { ...cached }
    for (const question of input.questions) {
        if (Object.prototype.hasOwnProperty.call(answers, question.id)) continue
        if (question.type === 'ranking') answers[question.id] = question.options.map((option) => option.label)
        else if (question.required === false) answers[question.id] = ''
    }
    return answers
}

function answerValues(answer: AssistantUserInputAnswer | undefined): string[] {
    if (Array.isArray(answer)) return answer
    return typeof answer === 'string' && answer ? [answer] : []
}

function isMultipleQuestion(question: AssistantUserInputQuestion): boolean {
    return question.type === 'multi_select' || (question.type === 'file_select' && question.multiple !== false)
}

function customAnswerValue(question: AssistantUserInputQuestion, answer: AssistantUserInputAnswer | undefined): string {
    const optionLabels = new Set(question.options.map((option) => option.label))
    return answerValues(answer).find((value) => !optionLabels.has(value)) || ''
}

function QuestionBoundary(props: { label: string; answered?: boolean }) {
    return (
        <div className="flex items-center gap-3 py-1.5" data-assistant-question-boundary={props.answered ? 'answered' : 'asked'}>
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className={cn(
                'inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em]',
                props.answered ? 'text-emerald-300/75' : 'text-sparkle-text-muted'
            )}>
                {props.answered ? <Check size={11} /> : null}
                {props.label}
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
        </div>
    )
}

function ResolvedQuestionSet(props: { input: AssistantPendingUserInput }) {
    const [open, setOpen] = useState(false)
    const count = props.input.questions.length
    const revealResponse = () => {
        const messageId = props.input.responseMessageId
        if (!messageId) return
        document.getElementById(getTimelineMessageDomId(messageId))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    return (
        <div data-assistant-question-set="resolved">
            <button
                type="button"
                className="group flex w-full items-center gap-2 py-1 text-left text-[11px] text-sparkle-text-muted transition-colors hover:text-sparkle-text-secondary"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
            >
                <span className="h-px flex-1 bg-white/[0.06]" />
                <Check size={12} className="text-emerald-300/75" />
                <span className="font-medium">Answered {count} {count === 1 ? 'question' : 'questions'}</span>
                <ChevronDown size={12} className={cn('transition-transform duration-200', open && 'rotate-180')} />
                <span className="h-px flex-1 bg-white/[0.06]" />
            </button>
            <AnimatedHeight isOpen={open} duration={200}>
                <div className="mx-auto mt-2 max-w-2xl divide-y divide-white/[0.05] border-l border-emerald-300/20 pl-4">
                    {props.input.questions.map((question) => (
                        <div key={question.id} className="py-2 first:pt-0 last:pb-0">
                            <p className="text-[11px] font-medium text-sparkle-text-secondary">{question.header}</p>
                            <p className="mt-0.5 text-[12px] leading-5 text-sparkle-text">{formatAssistantUserInputAnswer(question, props.input.answers?.[question.id])}</p>
                        </div>
                    ))}
                    {props.input.responseMessageId ? (
                        <button type="button" onClick={revealResponse} className="mt-2 text-[10px] font-medium text-[var(--accent-primary)] hover:underline">
                            Show answer message
                        </button>
                    ) : null}
                </div>
            </AnimatedHeight>
        </div>
    )
}

export function AssistantTimelineQuestionSet(props: {
    input: AssistantPendingUserInput
    responding: boolean
    submissionBlocked?: boolean
    onRespond: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
}) {
    const { input, responding, submissionBlocked = false, onRespond } = props
    const [answers, setAnswers] = useState<AssistantPendingUserInputDraftAnswers>(() => initialDraft(input))
    const [expandedOptionKey, setExpandedOptionKey] = useState<string | null>(null)
    const [customQuestionIds, setCustomQuestionIds] = useState<Set<string>>(() => new Set(
        input.questions
            .filter((question) => customAnswerValue(question, initialDraft(input)[question.id]))
            .map((question) => question.id)
    ))
    const [validationVisible, setValidationVisible] = useState(false)
    const submittingRef = useRef(false)

    useEffect(() => {
        if (input.status !== 'pending') return
        writeAssistantPendingUserInputDraft(input.requestId, {
            answers,
            questionIndex: 0,
            customQuestionId: customQuestionIds.values().next().value || null,
            returnToReview: false
        })
    }, [answers, customQuestionIds, input.requestId, input.status])

    const completedAnswers = useMemo(
        () => buildAssistantPendingUserInputAnswers(input.questions, answers),
        [answers, input.questions]
    )

    if (input.status === 'resolved') return <ResolvedQuestionSet input={input} />

    const updateAnswer = (questionId: string, answer: AssistantUserInputAnswer) => {
        setAnswers((current) => ({ ...current, [questionId]: answer }))
        setValidationVisible(false)
    }
    const questionById = new Map(input.questions.map((question) => [question.id, question]))

    const handleSelectOption = (questionId: string, optionLabel: string) => {
        setCustomQuestionIds((current) => {
            const next = new Set(current)
            next.delete(questionId)
            return next
        })
        updateAnswer(questionId, optionLabel)
    }
    const handleToggleOption = (questionId: string, optionLabel: string) => {
        const selected = answerValues(answers[questionId])
        updateAnswer(questionId, selected.includes(optionLabel)
            ? selected.filter((value) => value !== optionLabel)
            : [...selected, optionLabel])
    }
    const handleSelectCustom = (questionId: string) => {
        const question = questionById.get(questionId)
        if (!question) return
        setCustomQuestionIds((current) => new Set(current).add(questionId))
        if (!isMultipleQuestion(question)) updateAnswer(questionId, customAnswerValue(question, answers[questionId]))
    }
    const handleCustomChange = (question: AssistantUserInputQuestion, value: string) => {
        if (!isMultipleQuestion(question)) {
            updateAnswer(question.id, value)
            return
        }
        const options = new Set(question.options.map((option) => option.label))
        const selectedOptions = answerValues(answers[question.id]).filter((entry) => options.has(entry))
        updateAnswer(question.id, value ? [...selectedOptions, value] : selectedOptions)
    }
    const submit = async () => {
        if (submissionBlocked || submittingRef.current) return
        if (!completedAnswers) {
            setValidationVisible(true)
            return
        }
        submittingRef.current = true
        try {
            await onRespond(input.requestId, completedAnswers)
            clearAssistantPendingUserInputDraft(input.requestId)
        } finally {
            submittingRef.current = false
        }
    }

    const count = input.questions.length
    return (
        <section data-assistant-question-set="pending" className="mx-auto w-full max-w-2xl">
            <QuestionBoundary label={`Asked ${count} ${count === 1 ? 'question' : 'questions'}`} />
            <div className="mt-3 border-l border-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)] pl-4">
                <div className="divide-y divide-white/[0.06]">
                    {input.questions.map((question, index) => {
                        const answer = answers[question.id]
                        const customOpen = customQuestionIds.has(question.id)
                        return (
                            <fieldset key={question.id} disabled={responding} className="py-4 first:pt-1 last:pb-2">
                                <legend className="sr-only">{question.header}</legend>
                                <div className="mb-3 flex items-start gap-3">
                                    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.055] text-[10px] font-semibold text-sparkle-text-muted">{index + 1}</span>
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sparkle-text-muted">{question.header}</p>
                                        <p className="mt-1 text-[13px] leading-5 text-sparkle-text">{question.question}</p>
                                    </div>
                                </div>
                                {question.type === 'text' ? (
                                    <textarea
                                        value={typeof answer === 'string' ? answer : ''}
                                        placeholder={question.placeholder || 'Type your answer'}
                                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                                        rows={3}
                                        className="ml-8 w-[calc(100%-2rem)] resize-y rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-[12px] leading-5 text-sparkle-text outline-none placeholder:text-sparkle-text-muted focus:border-[color-mix(in_srgb,var(--accent-primary)_48%,transparent)]"
                                    />
                                ) : (
                                    <div className="ml-8">
                                        <AssistantPendingUserInputQuestionField
                                            question={question}
                                            answer={answer ?? null}
                                            responding={responding}
                                            expandedOptionKey={expandedOptionKey}
                                            showCustomComposer={customOpen}
                                            setExpandedOptionKey={setExpandedOptionKey}
                                            onSelectOption={handleSelectOption}
                                            onToggleOption={handleToggleOption}
                                            onSelectCustom={handleSelectCustom}
                                            onScalarChange={updateAnswer}
                                            onRankingChange={updateAnswer}
                                        />
                                        {question.allowOther && customOpen ? (
                                            <input
                                                type="text"
                                                value={customAnswerValue(question, answer)}
                                                placeholder={question.placeholder || 'Type another answer'}
                                                onChange={(event) => handleCustomChange(question, event.target.value)}
                                                className="mt-2 h-9 w-full rounded-xl border border-white/10 bg-white/[0.025] px-3 text-[12px] text-sparkle-text outline-none placeholder:text-sparkle-text-muted focus:border-[color-mix(in_srgb,var(--accent-primary)_48%,transparent)]"
                                            />
                                        ) : null}
                                    </div>
                                )}
                            </fieldset>
                        )
                    })}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
                    <p className={cn('text-[11px]', validationVisible ? 'text-amber-300' : 'text-sparkle-text-muted')}>
                        {validationVisible
                            ? 'Answer the required questions before submitting.'
                            : submissionBlocked
                                ? 'Finish the current work before starting the answer turn.'
                                : 'Your answers will continue as a new message.'}
                    </p>
                    <button
                        type="button"
                        disabled={responding || submissionBlocked}
                        onClick={() => void submit()}
                        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-3 text-[11px] font-semibold text-[var(--accent-primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                        {responding ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Submit answers
                    </button>
                </div>
            </div>
        </section>
    )
}
