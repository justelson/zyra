import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import type { AssistantPendingUserInput, AssistantRuntimeMode, AssistantUserInputAnswer } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import {
    AssistantPendingUserInputFooter,
    AssistantPendingUserInputStage
} from './AssistantPendingUserInputSections'
import {
    deriveAssistantComposerCapabilities,
    deriveAssistantComposerDisabledReason
} from './assistant-composer-capabilities'
import { useAssistantComposerController } from './useAssistantComposerController'
import type { AssistantComposerSendOptions, ComposerContextFile } from './assistant-composer-types'
import {
    buildAssistantPendingUserInputAnswers,
    deriveAssistantPendingUserInputProgress,
    findFirstUnansweredAssistantPendingUserInputQuestionIndex,
    formatAssistantUserInputAnswer,
    isAssistantUserInputMultiValueQuestion,
    type AssistantPendingUserInputDraftAnswers
} from './assistant-pending-user-input'
import {
    clearAssistantPendingUserInputDraft,
    readAssistantPendingUserInputDraft,
    writeAssistantPendingUserInputDraft
} from './assistant-pending-user-input-drafts'

export const AssistantPendingUserInputPanel = memo(function AssistantPendingUserInputPanel(props: {
    pendingUserInputs: AssistantPendingUserInput[]
    responding: boolean
    onRespond: (requestId: string, answers: Record<string, AssistantUserInputAnswer>) => Promise<void> | void
    sessionId: string | null
    assistantAvailable: boolean
    assistantConnected: boolean
    selectedProjectPath: string | null
    availableModels: Array<{ id: string; label: string; description?: string }>
    activeModel: string | undefined
    modelsLoading: boolean
    runtimeMode: AssistantRuntimeMode
    interactionMode: 'default' | 'plan'
    activeProfile: 'safe-dev' | 'yolo-fast'
    activeStatusLabel: string
    isConnecting?: boolean
}) {
    const { pendingUserInputs, responding, onRespond } = props
    const activePrompt = pendingUserInputs[0] || null
    const composerDisabledReason = deriveAssistantComposerDisabledReason({
        sessionId: props.sessionId
    })
    const [draftAnswersByRequestId, setDraftAnswersByRequestId] = useState<Record<string, AssistantPendingUserInputDraftAnswers>>({})
    const [questionIndex, setQuestionIndex] = useState(0)
    const [customQuestionIdByRequestId, setCustomQuestionIdByRequestId] = useState<Record<string, string | null>>({})
    const [questionShellOpen, setQuestionShellOpen] = useState(false)
    const [questionShellMinimized, setQuestionShellMinimized] = useState(false)
    const [returnToReview, setReturnToReview] = useState(false)
    const [expandedOptionKey, setExpandedOptionKey] = useState<string | null>(null)
    const customTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const animatedStepRef = useRef<HTMLDivElement | null>(null)
    const suppressDraftPersistenceRequestIdRef = useRef<string | null>(null)

    const composerController = useAssistantComposerController({
        sessionId: props.sessionId,
        onSend: async (_prompt: string, _contextFiles: ComposerContextFile[], _options: AssistantComposerSendOptions) => false,
        disabled: Boolean(composerDisabledReason),
        disabledReason: composerDisabledReason,
        allowEmptySubmit: true,
        isSending: responding,
        isThinking: false,
        thinkingLabel: props.activeStatusLabel,
        isConnected: props.assistantConnected,
        isConnecting: props.isConnecting ?? false,
        activeModel: props.activeModel,
        modelOptions: props.availableModels,
        modelsLoading: props.modelsLoading,
        modelsError: null,
        activeProfile: props.activeProfile,
        runtimeMode: props.runtimeMode,
        interactionMode: props.interactionMode,
        projectPath: props.selectedProjectPath,
        acceptBrowserAnnotations: false,
        submitLabel: 'Continue'
    })

    const activeDraftAnswers = useMemo(() => {
        if (!activePrompt) return {}
        return draftAnswersByRequestId[activePrompt.requestId]
            || readAssistantPendingUserInputDraft(activePrompt.requestId)?.answers
            || {}
    }, [activePrompt, draftAnswersByRequestId])
    const progress = useMemo(
        () => deriveAssistantPendingUserInputProgress(activePrompt, activeDraftAnswers, questionIndex),
        [activeDraftAnswers, activePrompt, questionIndex]
    )

    useLayoutEffect(() => {
        if (!activePrompt) {
            setQuestionIndex(0)
            setReturnToReview(false)
            setExpandedOptionKey(null)
            setQuestionShellMinimized(false)
            return
        }
        const persistedDraft = readAssistantPendingUserInputDraft(activePrompt.requestId)
        const restoredAnswers = draftAnswersByRequestId[activePrompt.requestId] || persistedDraft?.answers || {}
        const restoredQuestionIndex = persistedDraft
            ? Math.min(persistedDraft.questionIndex, activePrompt.questions.length)
            : findFirstUnansweredAssistantPendingUserInputQuestionIndex(activePrompt.questions, restoredAnswers)
        suppressDraftPersistenceRequestIdRef.current = activePrompt.requestId
        setDraftAnswersByRequestId((current) => ({ ...current, [activePrompt.requestId]: restoredAnswers }))
        setCustomQuestionIdByRequestId((current) => ({
            ...current,
            [activePrompt.requestId]: persistedDraft?.customQuestionId ?? current[activePrompt.requestId] ?? null
        }))
        setQuestionShellOpen(false)
        setQuestionShellMinimized(false)
        setReturnToReview(persistedDraft?.returnToReview ?? false)
        setExpandedOptionKey(null)
        setQuestionIndex(restoredQuestionIndex)
    }, [activePrompt?.requestId])

    useLayoutEffect(() => {
        if (!activePrompt) return
        if (suppressDraftPersistenceRequestIdRef.current === activePrompt.requestId) {
            suppressDraftPersistenceRequestIdRef.current = null
            return
        }
        writeAssistantPendingUserInputDraft(activePrompt.requestId, {
            answers: activeDraftAnswers,
            questionIndex,
            customQuestionId: customQuestionIdByRequestId[activePrompt.requestId] || null,
            returnToReview
        })
    }, [activeDraftAnswers, activePrompt, customQuestionIdByRequestId, questionIndex, returnToReview])

    useEffect(() => {
        setExpandedOptionKey(null)
    }, [activePrompt?.requestId, questionIndex])

    useEffect(() => {
        if (!activePrompt) return
        const frame = window.requestAnimationFrame(() => setQuestionShellOpen(true))
        return () => window.cancelAnimationFrame(frame)
    }, [activePrompt?.requestId])

    const updateDraftAnswer = useCallback((questionId: string, answer: AssistantUserInputAnswer) => {
        if (!activePrompt) return
        setDraftAnswersByRequestId((current) => ({
            ...current,
            [activePrompt.requestId]: {
                ...(current[activePrompt.requestId] || {}),
                [questionId]: answer
            }
        }))
    }, [activePrompt])

    const handleSelectOption = useCallback((questionId: string, optionLabel: string) => {
        updateDraftAnswer(questionId, optionLabel)
        if (!activePrompt) return
        setCustomQuestionIdByRequestId((current) => ({
            ...current,
            [activePrompt.requestId]: current[activePrompt.requestId] === questionId ? null : current[activePrompt.requestId] ?? null
        }))
    }, [activePrompt, updateDraftAnswer])

    const handleToggleOption = useCallback((questionId: string, optionLabel: string) => {
        if (!activePrompt) return
        const question = activePrompt.questions.find((candidate) => candidate.id === questionId)
        if (!question) return
        setDraftAnswersByRequestId((current) => {
            const requestAnswers = current[activePrompt.requestId] || {}
            const currentValue = requestAnswers[questionId]
            const values = Array.isArray(currentValue) ? currentValue : []
            const nextValues = values.includes(optionLabel)
                ? values.filter((entry) => entry !== optionLabel)
                : [...values, optionLabel]
            if (question.maxSelections !== undefined && nextValues.length > question.maxSelections) return current
            return {
                ...current,
                [activePrompt.requestId]: { ...requestAnswers, [questionId]: nextValues }
            }
        })
    }, [activePrompt])

    const handleSelectCustom = useCallback((questionId: string) => {
        if (!activePrompt) return
        const question = activePrompt.questions.find((candidate) => candidate.id === questionId) || null
        if (!question) return
        setCustomQuestionIdByRequestId((current) => ({ ...current, [activePrompt.requestId]: questionId }))
        setDraftAnswersByRequestId((current) => {
            const currentAnswers = current[activePrompt.requestId] || {}
            const currentAnswer = currentAnswers[questionId]
            const nextAnswer = isAssistantUserInputMultiValueQuestion(question)
                ? Array.isArray(currentAnswer) ? currentAnswer : []
                : question?.options.some((option) => option.label === currentAnswer) ? '' : String(currentAnswer || '')
            return { ...current, [activePrompt.requestId]: { ...currentAnswers, [questionId]: nextAnswer } }
        })
        window.requestAnimationFrame(() => {
            const textarea = customTextareaRef.current
            if (!textarea) return
            textarea.focus()
            const cursor = textarea.value.length
            textarea.setSelectionRange(cursor, cursor)
        })
    }, [activePrompt])

    const handleCustomAnswerChange = useCallback((questionId: string, value: string) => {
        if (!activePrompt) return
        const question = activePrompt.questions.find((candidate) => candidate.id === questionId)
        if (!question) return
        if (question.type !== 'text' && question.type !== 'number' && question.type !== 'date') {
            setCustomQuestionIdByRequestId((current) => ({ ...current, [activePrompt.requestId]: questionId }))
        }
        setDraftAnswersByRequestId((current) => {
            const requestAnswers = current[activePrompt.requestId] || {}
            const currentAnswer = requestAnswers[questionId]
            const answer = isAssistantUserInputMultiValueQuestion(question)
                ? [
                    ...(Array.isArray(currentAnswer) ? currentAnswer : []).filter((entry) => question.options.some((option) => option.label === entry)),
                    ...(value.trim() ? [value] : [])
                ]
                : value
            return { ...current, [activePrompt.requestId]: { ...requestAnswers, [questionId]: answer } }
        })
    }, [activePrompt])

    const handleRankingChange = useCallback((questionId: string, value: string[]) => {
        updateDraftAnswer(questionId, value)
    }, [updateDraftAnswer])

    const handleAdvance = useCallback(async () => {
        if (!activePrompt || !progress) return
        const resolvedAnswers = buildAssistantPendingUserInputAnswers(activePrompt.questions, activeDraftAnswers)

        if (progress.isReviewStep) {
            if (!resolvedAnswers) return
            await onRespond(activePrompt.requestId, resolvedAnswers)
            suppressDraftPersistenceRequestIdRef.current = activePrompt.requestId
            clearAssistantPendingUserInputDraft(activePrompt.requestId)
            return
        }

        if (!progress.hasAnswer) return
        if (returnToReview) {
            setQuestionIndex(activePrompt.questions.length)
            setReturnToReview(false)
            return
        }
        if (progress.questionIndex < activePrompt.questions.length - 1) {
            setQuestionIndex(progress.questionIndex + 1)
            return
        }
        setQuestionIndex(activePrompt.questions.length)
    }, [activeDraftAnswers, activePrompt, onRespond, progress])

    useEffect(() => {
        const activeQuestion = progress?.activeQuestion
        if (!activePrompt || !activeQuestion || activeQuestion.type !== 'ranking') return
        if (Object.prototype.hasOwnProperty.call(activeDraftAnswers, activeQuestion.id)) return
        updateDraftAnswer(activeQuestion.id, activeQuestion.options.map((option) => option.label))
    }, [activeDraftAnswers, activePrompt, progress?.activeQuestion, updateDraftAnswer])

    useEffect(() => {
        const activeQuestion = progress?.activeQuestion
        if (!activePrompt || !activeQuestion || responding) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return
            const target = event.target
            if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return

            const digit = Number.parseInt(event.key, 10)
            if (!Number.isNaN(digit) && digit >= 1 && digit <= 9) {
                const option = activeQuestion.options[digit - 1]
                if (!option) return
                event.preventDefault()
                if (activeQuestion.type === 'multi_select' || (activeQuestion.type === 'file_select' && activeQuestion.multiple !== false)) {
                    handleToggleOption(activeQuestion.id, option.label)
                } else {
                    handleSelectOption(activeQuestion.id, option.label)
                }
                return
            }

            if ((event.key === 'Enter' || event.key === 'NumpadEnter') && progress.hasAnswer) {
                event.preventDefault()
                void handleAdvance()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [activePrompt, handleAdvance, handleSelectOption, handleToggleOption, progress, responding])

    useLayoutEffect(() => {
        if (!progress?.activeQuestion || !activePrompt) return
        const activeCustomQuestionId = customQuestionIdByRequestId[activePrompt.requestId] || null
        const shouldFocusCustomComposer = progress.activeQuestion.type === 'text'
            || activeCustomQuestionId === progress.activeQuestion.id
            || progress.isCustomAnswer
        if (!shouldFocusCustomComposer) return
        const textarea = customTextareaRef.current
        if (!textarea) return
        textarea.focus()
        const cursor = textarea.value.length
        textarea.setSelectionRange(cursor, cursor)
    }, [activePrompt, customQuestionIdByRequestId, progress?.activeQuestion, progress?.isCustomAnswer])

    useLayoutEffect(() => {
        const textarea = customTextareaRef.current
        if (!textarea) return
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 40), 180)}px`
    }, [progress?.selectedAnswer, progress?.isReviewStep])

    if (!activePrompt || !progress) return null

    const activeQuestion = progress.activeQuestion
    const isReviewStep = progress.isReviewStep
    const activeCustomQuestionId = customQuestionIdByRequestId[activePrompt.requestId] || null
    const showCustomComposer = Boolean(
        activeQuestion
        && activeQuestion.allowOther
        && (activeCustomQuestionId === activeQuestion.id || progress.isCustomAnswer)
    )
    const showAnswerComposer = Boolean(activeQuestion?.type === 'text' || showCustomComposer)
    const customAnswerValue = activeQuestion && Array.isArray(progress.selectedAnswer)
        ? progress.selectedAnswer.find((entry) => !activeQuestion.options.some((option) => option.label === entry)) || ''
        : typeof progress.selectedAnswer === 'string' ? progress.selectedAnswer : ''
    const animatedStageKey = isReviewStep
        ? `${activePrompt.requestId}:review`
        : `${activePrompt.requestId}:${activeQuestion?.id || questionIndex}`
    const answeredAllQuestions = progress.answeredQuestionCount >= activePrompt.questions.length
    const actionLabel = responding ? 'Finish' : isReviewStep ? 'Finish' : returnToReview ? 'Back to review' : 'Continue'
    const canAdvance = isReviewStep ? answeredAllQuestions : progress.hasAnswer
    const reviewAnswers = activePrompt.questions.map((question, index) => ({
        question,
        index,
        answer: formatAssistantUserInputAnswer(question, activeDraftAnswers[question.id])
    }))
    const composerCapabilities = deriveAssistantComposerCapabilities({
        mode: 'guided',
        disabled: composerController.disabled,
        disabledReason: composerDisabledReason,
        isConnected: composerController.isConnected,
        isConnecting: props.isConnecting ?? false,
        isSending: false,
        isThinking: false,
        allowEmptySubmit: false,
        hasContent: canAdvance,
        controlsLocked: true,
        attachmentsLocked: true,
        isResponding: responding,
        isReviewStep
    })
    const composerStatusToneClass = composerCapabilities.tone === 'warning'
        ? 'text-amber-200'
        : composerCapabilities.tone === 'info'
            ? 'text-sky-200'
            : 'text-sparkle-text-secondary'
    const composerStatusDotClass = composerCapabilities.tone === 'warning'
        ? 'bg-amber-300/80'
        : composerCapabilities.tone === 'info'
            ? 'bg-sky-300/80'
            : 'bg-white/35'

    const handleCustomTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        event.stopPropagation()
        if ('nativeEvent' in event && 'stopImmediatePropagation' in event.nativeEvent) {
            event.nativeEvent.stopImmediatePropagation()
        }
        if (!activeQuestion || isReviewStep || responding) return
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key !== 'Enter' && event.key !== 'NumpadEnter') return
        if (event.shiftKey) return
        if (!progress.hasAnswer) return
        event.preventDefault()
        void handleAdvance()
    }, [activeQuestion, handleAdvance, isReviewStep, progress.hasAnswer, responding])

    useEffect(() => {
        const container = animatedStepRef.current
        if (!container) return

        const animatedNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-guided-animate]'))
        animatedNodes.forEach((node, index) => {
            node.animate(
                [
                    {
                        opacity: 0,
                        transform: 'translateY(14px) scale(0.982)',
                        filter: 'blur(3px)'
                    },
                    {
                        opacity: 1,
                        transform: 'translateY(0) scale(1)',
                        filter: 'blur(0px)'
                    }
                ],
                {
                    duration: 280 + index * 48,
                    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                    fill: 'both'
                }
            )
        })
    }, [animatedStageKey])

    return (
        <div className="mx-auto w-full max-w-3xl">
            <div ref={composerController.composerRootRef} className="pointer-events-auto relative z-10">
                <div className="group rounded-[20px] border border-white/10 bg-sparkle-card transition-[border-color,box-shadow] duration-200">
                    <div className="relative px-3 pb-1.5 pt-2 sm:px-4 sm:pt-2">
                        <AssistantPendingUserInputStage
                            questionShellOpen={questionShellOpen}
                            questionShellMinimized={questionShellMinimized}
                            animatedStepRef={animatedStepRef}
                            isReviewStep={isReviewStep}
                            activeQuestion={activeQuestion}
                            activePrompt={activePrompt}
                            pendingUserInputsLength={pendingUserInputs.length}
                            progress={{
                                questionIndex: progress.questionIndex,
                                answeredQuestionCount: progress.answeredQuestionCount,
                                hasAnswer: progress.hasAnswer,
                                isReviewStep: progress.isReviewStep,
                                isCustomAnswer: progress.isCustomAnswer,
                                selectedAnswer: progress.selectedAnswer
                            }}
                            reviewAnswers={reviewAnswers}
                            responding={responding}
                            returnToReview={returnToReview}
                            expandedOptionKey={expandedOptionKey}
                            showCustomComposer={showCustomComposer}
                            customTextareaRef={customTextareaRef}
                            composerCapabilities={composerCapabilities}
                            setQuestionIndex={setQuestionIndex}
                            setReturnToReview={setReturnToReview}
                            setExpandedOptionKey={setExpandedOptionKey}
                            onToggleQuestionShellMinimized={() => setQuestionShellMinimized((current) => !current)}
                            handleSelectOption={handleSelectOption}
                            handleToggleOption={handleToggleOption}
                            handleSelectCustom={handleSelectCustom}
                            handleCustomAnswerChange={handleCustomAnswerChange}
                            handleRankingChange={handleRankingChange}
                            handleCustomTextareaKeyDown={handleCustomTextareaKeyDown}
                        />

                        {showAnswerComposer ? (
                            <div data-guided-animate className="flex min-h-10 items-start gap-2">
                                <button
                                    type="button"
                                    disabled={composerCapabilities.attachDisabled}
                                    className="mt-0.5 rounded-full p-1 text-sparkle-text-muted opacity-35"
                                    title={composerCapabilities.attachDisabled
                                        ? composerCapabilities.detailLabel || 'Attachments are disabled right now'
                                        : 'Attach files'}
                                >
                                    <Plus size={18} />
                                </button>
                                <div className="relative min-w-0 flex-1">
                                    <textarea
                                        ref={customTextareaRef}
                                        autoFocus
                                        rows={1}
                                        value={customAnswerValue}
                                        onFocus={() => {
                                            if (activeQuestion?.allowOther && activeQuestion.type !== 'text') handleSelectCustom(activeQuestion.id)
                                        }}
                                        onChange={(event) => {
                                            if (!activeQuestion) return
                                            handleCustomAnswerChange(activeQuestion.id, event.target.value)
                                        }}
                                        onKeyDownCapture={(event) => {
                                            event.stopPropagation()
                                            if ('nativeEvent' in event && 'stopImmediatePropagation' in event.nativeEvent) {
                                                event.nativeEvent.stopImmediatePropagation()
                                            }
                                        }}
                                        onKeyDown={handleCustomTextareaKeyDown}
                                        className="relative min-h-10 w-full resize-none overflow-y-auto bg-transparent pl-[3px] pr-2 text-[14px] leading-[1.45rem] text-sparkle-text outline-none placeholder:text-sparkle-text/20 selection:bg-white/15"
                                        placeholder={activeQuestion?.placeholder || composerCapabilities.placeholder}
                                        disabled={composerCapabilities.inputDisabled}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <AssistantPendingUserInputFooter
                        composerController={composerController}
                        composerCapabilities={composerCapabilities}
                        responding={responding}
                        progressQuestionIndex={progress.questionIndex}
                        isReviewStep={isReviewStep}
                        returnToReview={returnToReview}
                        canAdvance={canAdvance}
                        canSkip={!isReviewStep && activeQuestion?.required === false}
                        actionLabel={actionLabel}
                        onBack={() => {
                            if (returnToReview) {
                                setQuestionIndex(activePrompt.questions.length)
                                setReturnToReview(false)
                                return
                            }
                            setQuestionIndex((current) => Math.max(0, current - 1))
                        }}
                        onSkip={() => {
                            if (!activeQuestion) return
                            updateDraftAnswer(activeQuestion.id, isAssistantUserInputMultiValueQuestion(activeQuestion) ? [] : '')
                            if (returnToReview) {
                                setQuestionIndex(activePrompt.questions.length)
                                setReturnToReview(false)
                            } else if (progress.questionIndex < activePrompt.questions.length - 1) {
                                setQuestionIndex(progress.questionIndex + 1)
                            } else {
                                setQuestionIndex(activePrompt.questions.length)
                            }
                        }}
                        onAdvance={() => void handleAdvance()}
                    />
                </div>
            </div>
        </div>
    )
})
