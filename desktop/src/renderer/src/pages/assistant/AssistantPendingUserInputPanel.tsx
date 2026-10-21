import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent as ReactClipboardEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Plus } from 'lucide-react'
import AssistantAttachmentPreviewModal from './AssistantAttachmentPreviewModal'
import {
    buildTextAttachmentFromPaste,
    getContextFileMeta,
    isLargeTextPaste,
    toKbLabel,
} from './assistant-composer-utils'
import { ComposerAttachmentsShelf } from './AssistantComposerSections'
import { clearAssistantComposerSessionState } from './assistant-composer-session-state'
import { isAssistantUserInputAnswerComplete } from './assistant-pending-user-input'
import type {
    AssistantPendingUserInput,
    AssistantRuntimeMode,
    AssistantUserInputAnswer,
} from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import {
    AssistantPendingUserInputFooter,
    AssistantPendingUserInputStage,
} from './AssistantPendingUserInputSections'
import {
    deriveAssistantComposerCapabilities,
    deriveAssistantComposerDisabledReason,
} from './assistant-composer-capabilities'
import { useAssistantComposerController } from './useAssistantComposerController'
import type { AssistantComposerSendOptions, ComposerContextFile } from './assistant-composer-types'
import {
    buildAssistantPendingUserInputAnswers,
    deriveAssistantPendingUserInputProgress,
    findFirstUnansweredAssistantPendingUserInputQuestionIndex,
    formatAssistantUserInputAnswer,
    isAssistantUserInputMultiValueQuestion,
    type AssistantPendingUserInputDraftAnswers,
} from './assistant-pending-user-input'
import {
    clearAssistantPendingUserInputDraft,
    readAssistantPendingUserInputDraft,
    writeAssistantPendingUserInputDraft,
} from './assistant-pending-user-input-drafts'

export const AssistantPendingUserInputPanel = memo(function AssistantPendingUserInputPanel(props: {
    pendingUserInputs: AssistantPendingUserInput[]
    responding: boolean
    onRespond: (
        requestId: string,
        answers: Record<string, AssistantUserInputAnswer>,
        files?: ComposerContextFile[],
    ) => Promise<void> | void
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
    const activePrompt = useMemo(() => {
        const prompt = pendingUserInputs[0]
        return prompt
            ? {
                  ...prompt,
                  questions: prompt.questions.map((question) => ({
                      ...question,
                      allowOther:
                          question.allowOther ||
                          question.type === 'single_select' ||
                          question.type === 'multi_select',
                  })),
              }
            : null
    }, [pendingUserInputs])
    const questionComposerSessionId = activePrompt
        ? `question:${props.sessionId}:${activePrompt.requestId}`
        : null
    const submittedComposerSessionIdRef = useRef<string | null>(null)
    const submittingRef = useRef(false)
    const [pasteError, setPasteError] = useState<string | null>(null)
    const [attaching, setAttaching] = useState(0)
    const composerDisabledReason = deriveAssistantComposerDisabledReason({
        sessionId: props.sessionId,
    })
    const [draftAnswersByRequestId, setDraftAnswersByRequestId] = useState<
        Record<string, AssistantPendingUserInputDraftAnswers>
    >({})
    const [questionIndex, setQuestionIndex] = useState(0)
    const [customQuestionIdByRequestId, setCustomQuestionIdByRequestId] = useState<
        Record<string, string | null>
    >({})
    const [questionShellOpen, setQuestionShellOpen] = useState(false)
    const [questionShellMinimized, setQuestionShellMinimized] = useState(false)
    const [returnToReview, setReturnToReview] = useState(false)
    const [expandedOptionKey, setExpandedOptionKey] = useState<string | null>(null)
    const customTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const animatedStepRef = useRef<HTMLDivElement | null>(null)
    const suppressDraftPersistenceRequestIdRef = useRef<string | null>(null)

    const composerController = useAssistantComposerController({
        sessionId: questionComposerSessionId,
        onSend: async (
            _prompt: string,
            _contextFiles: ComposerContextFile[],
            _options: AssistantComposerSendOptions,
        ) => false,
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
        onBlockedSend: (message) => setPasteError(message),
        submitLabel: 'Continue',
    })

    const hasAttachments = composerController.contextFiles.length > 0
    const activeDraftAnswers = useMemo(() => {
        if (!activePrompt) return {}
        const answers =
            draftAnswersByRequestId[activePrompt.requestId] ||
            readAssistantPendingUserInputDraft(activePrompt.requestId)?.answers ||
            {}
        if (hasAttachments) return answers
        // A file-only caption is not an answer without its evidence. Derive this
        // before progress/Submit validation, including restored review drafts.
        return Object.fromEntries(
            Object.entries(answers).map(([id, answer]) => {
                const question = activePrompt.questions.find((item) => item.id === id)
                if (question?.options.some((option) => option.label === 'See attached files.'))
                    return [id, answer]
                return [
                    id,
                    Array.isArray(answer)
                        ? answer.filter((value) => value !== 'See attached files.')
                        : answer === 'See attached files.'
                          ? ''
                          : answer,
                ]
            }),
        )
    }, [activePrompt, draftAnswersByRequestId, hasAttachments])
    const progress = useMemo(
        () =>
            deriveAssistantPendingUserInputProgress(
                activePrompt,
                activeDraftAnswers,
                questionIndex,
            ),
        [activeDraftAnswers, activePrompt, questionIndex],
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
        const restoredAnswers =
            draftAnswersByRequestId[activePrompt.requestId] || persistedDraft?.answers || {}
        const restoredQuestionIndex = persistedDraft
            ? Math.min(persistedDraft.questionIndex, activePrompt.questions.length)
            : findFirstUnansweredAssistantPendingUserInputQuestionIndex(
                  activePrompt.questions,
                  restoredAnswers,
              )
        suppressDraftPersistenceRequestIdRef.current = activePrompt.requestId
        setDraftAnswersByRequestId((current) => ({
            ...current,
            [activePrompt.requestId]: restoredAnswers,
        }))
        setCustomQuestionIdByRequestId((current) => ({
            ...current,
            [activePrompt.requestId]:
                persistedDraft?.customQuestionId ?? current[activePrompt.requestId] ?? null,
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
            returnToReview,
        })
    }, [
        activeDraftAnswers,
        activePrompt,
        customQuestionIdByRequestId,
        questionIndex,
        returnToReview,
    ])

    useEffect(() => {
        setExpandedOptionKey(null)
    }, [activePrompt?.requestId, questionIndex])

    useEffect(() => {
        if (!activePrompt) return
        const frame = window.requestAnimationFrame(() => setQuestionShellOpen(true))
        return () => window.cancelAnimationFrame(frame)
    }, [activePrompt?.requestId])

    const updateDraftAnswer = useCallback(
        (questionId: string, answer: AssistantUserInputAnswer) => {
            if (!activePrompt) return
            setDraftAnswersByRequestId((current) => ({
                ...current,
                [activePrompt.requestId]: {
                    ...(current[activePrompt.requestId] || {}),
                    [questionId]: answer,
                },
            }))
        },
        [activePrompt],
    )

    const handleSelectOption = useCallback(
        (questionId: string, optionLabel: string) => {
            updateDraftAnswer(questionId, optionLabel)
            if (!activePrompt) return
            setCustomQuestionIdByRequestId((current) => ({
                ...current,
                [activePrompt.requestId]:
                    current[activePrompt.requestId] === questionId
                        ? null
                        : (current[activePrompt.requestId] ?? null),
            }))
        },
        [activePrompt, updateDraftAnswer],
    )

    const handleToggleOption = useCallback(
        (questionId: string, optionLabel: string) => {
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
                if (
                    question.maxSelections !== undefined &&
                    nextValues.length > question.maxSelections
                )
                    return current
                return {
                    ...current,
                    [activePrompt.requestId]: {
                        ...requestAnswers,
                        [questionId]: nextValues,
                    },
                }
            })
        },
        [activePrompt],
    )

    const handleCustomAnswerChange = useCallback(
        (questionId: string, value: string) => {
            if (!activePrompt) return
            const question = activePrompt.questions.find((candidate) => candidate.id === questionId)
            if (!question) return
            if (
                question.type !== 'text' &&
                question.type !== 'number' &&
                question.type !== 'date'
            ) {
                setCustomQuestionIdByRequestId((current) =>
                    current[activePrompt.requestId] === questionId
                        ? current
                        : { ...current, [activePrompt.requestId]: questionId },
                )
            }
            setDraftAnswersByRequestId((current) => {
                const requestAnswers = current[activePrompt.requestId] || {}
                const currentAnswer = requestAnswers[questionId]
                const answer = isAssistantUserInputMultiValueQuestion(question)
                    ? [
                          ...(Array.isArray(currentAnswer) ? currentAnswer : []).filter((entry) =>
                              question.options.some((option) => option.label === entry),
                          ),
                          ...(value.trim() ? [value] : []),
                      ]
                    : value
                return {
                    ...current,
                    [activePrompt.requestId]: {
                        ...requestAnswers,
                        [questionId]: answer,
                    },
                }
            })
        },
        [activePrompt],
    )

    const handleRankingChange = useCallback(
        (questionId: string, value: string[]) => {
            updateDraftAnswer(questionId, value)
        },
        [updateDraftAnswer],
    )

    const stepQuestion = progress?.activeQuestion || null
    const emptyStepAnswer =
        !stepQuestion || !String(activeDraftAnswers[stepQuestion.id] || '').trim()
    const attachmentAnswer =
        stepQuestion &&
        stepQuestion.required !== false &&
        hasAttachments &&
        emptyStepAnswer &&
        (stepQuestion.type === 'text' || stepQuestion.allowOther)
            ? isAssistantUserInputMultiValueQuestion(stepQuestion)
                ? ['See attached files.']
                : 'See attached files.'
            : undefined
    const attachmentAnswerComplete = Boolean(
        stepQuestion &&
        attachmentAnswer &&
        isAssistantUserInputAnswerComplete(stepQuestion, attachmentAnswer, true),
    )
    // Evidence belongs to the whole response, not every later blank field.
    const canSkipStep = stepQuestion?.required === false && emptyStepAnswer
    const canAdvanceStep = Boolean(
        !attaching && (progress?.hasAnswer || attachmentAnswerComplete || canSkipStep),
    )

    useEffect(
        () => () => {
            if (
                questionComposerSessionId &&
                submittedComposerSessionIdRef.current === questionComposerSessionId
            )
                clearAssistantComposerSessionState(questionComposerSessionId)
        },
        [questionComposerSessionId],
    )

    const handleAdvance = useCallback(async () => {
        if (!activePrompt || !progress || attaching || responding || submittingRef.current) return
        const nextAnswers =
            !progress.isReviewStep && stepQuestion && !progress.hasAnswer
                ? {
                      ...activeDraftAnswers,
                      [stepQuestion.id]: attachmentAnswerComplete
                          ? attachmentAnswer!
                          : isAssistantUserInputMultiValueQuestion(stepQuestion)
                            ? []
                            : '',
                  }
                : activeDraftAnswers
        const resolvedAnswers = buildAssistantPendingUserInputAnswers(
            activePrompt.questions,
            nextAnswers,
        )

        if (progress.isReviewStep || activePrompt.questions.length === 1 && canAdvanceStep && composerController.contextFiles.length === 0 && stepQuestion && !isAssistantUserInputMultiValueQuestion(stepQuestion)) {
            if (!resolvedAnswers) return
            submittingRef.current = true
            try {
                await onRespond(
                    activePrompt.requestId,
                    resolvedAnswers,
                    composerController.contextFiles,
                )
                submittedComposerSessionIdRef.current = questionComposerSessionId
                if (questionComposerSessionId)
                    clearAssistantComposerSessionState(questionComposerSessionId)
                suppressDraftPersistenceRequestIdRef.current = activePrompt.requestId
                clearAssistantPendingUserInputDraft(activePrompt.requestId)
            } catch (error) {
                setPasteError(error instanceof Error ? error.message : 'Could not submit. Your answer stays here.')
            } finally {
                submittingRef.current = false
            }
            return
        }

        if (!canAdvanceStep) return
        if (stepQuestion && nextAnswers !== activeDraftAnswers)
            updateDraftAnswer(stepQuestion.id, nextAnswers[stepQuestion.id])
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
    }, [
        activeDraftAnswers,
        activePrompt,
        attachmentAnswer,
        attachmentAnswerComplete,
        attaching,
        canAdvanceStep,
        composerController.contextFiles,
        onRespond,
        progress,
        questionComposerSessionId,
        responding,
        returnToReview,
        stepQuestion,
        updateDraftAnswer,
    ])

    useEffect(() => {
        const activeQuestion = progress?.activeQuestion
        if (!activePrompt || !activeQuestion || activeQuestion.type !== 'ranking') return
        if (Object.prototype.hasOwnProperty.call(activeDraftAnswers, activeQuestion.id)) return
        updateDraftAnswer(
            activeQuestion.id,
            activeQuestion.options.map((option) => option.label),
        )
    }, [activeDraftAnswers, activePrompt, progress?.activeQuestion, updateDraftAnswer])

    useEffect(() => {
        const activeQuestion = progress?.activeQuestion
        if (!activePrompt || !activeQuestion || responding) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.key === 'Process') return
            const target = event.target
            if (target instanceof HTMLElement && target.isContentEditable) return
            if (activePrompt.mode === 'async' && (!(target instanceof Element) || !target.closest('[data-assistant-async-question]'))) return
            if (
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLInputElement ||
                target instanceof HTMLSelectElement
            )
                return

            const digit = Number.parseInt(event.key, 10)
            if (!Number.isNaN(digit) && digit >= 1 && digit <= 9) {
                const option = activeQuestion.options[digit - 1]
                if (!option) return
                event.preventDefault()
                if (
                    activeQuestion.type === 'multi_select' ||
                    (activeQuestion.type === 'file_select' && activeQuestion.multiple !== false)
                ) {
                    handleToggleOption(activeQuestion.id, option.label)
                } else {
                    handleSelectOption(activeQuestion.id, option.label)
                }
                return
            }

            if ((event.key === 'Enter' || event.key === 'NumpadEnter') && canAdvanceStep) {
                event.preventDefault()
                void handleAdvance()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [
        activePrompt,
        canAdvanceStep,
        handleAdvance,
        handleSelectOption,
        handleToggleOption,
        progress,
        responding,
    ])

    useLayoutEffect(() => {
        if (!progress?.activeQuestion || !activePrompt || activePrompt.mode === 'async') return
        const activeCustomQuestionId = customQuestionIdByRequestId[activePrompt.requestId] || null
        const shouldFocusCustomComposer =
            progress.activeQuestion.type === 'text' ||
            activeCustomQuestionId === progress.activeQuestion.id ||
            progress.isCustomAnswer
        if (!shouldFocusCustomComposer) return
        const textarea = customTextareaRef.current
        if (!textarea || document.activeElement === textarea) return
        textarea.focus()
        const cursor = textarea.value.length
        textarea.setSelectionRange(cursor, cursor)
    }, [
        activePrompt,
        customQuestionIdByRequestId,
        progress?.activeQuestion,
        progress?.isCustomAnswer,
    ])

    useLayoutEffect(() => {
        const textarea = customTextareaRef.current
        if (!textarea) return
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 40), 180)}px`
    }, [progress?.selectedAnswer, progress?.isReviewStep])

    const activeQuestion = progress?.activeQuestion || null
    const isReviewStep = progress?.isReviewStep ?? false
    const activeCustomQuestionId = activePrompt
        ? customQuestionIdByRequestId[activePrompt.requestId] || null
        : null
    const showAnswerComposer = Boolean(
        activeQuestion &&
        (activeQuestion.type === 'text' ||
            (activeQuestion.allowOther &&
                !['number', 'date', 'ranking'].includes(activeQuestion.type))),
    )
    const customAnswerValue =
        activeQuestion && Array.isArray(progress?.selectedAnswer)
            ? progress.selectedAnswer.find(
                  (entry) => !activeQuestion.options.some((option) => option.label === entry),
              ) || ''
            : typeof progress?.selectedAnswer === 'string' &&
                (activeQuestion?.type === 'text' ||
                    progress.isCustomAnswer ||
                    activeCustomQuestionId === activeQuestion?.id)
              ? progress.selectedAnswer
              : ''
    const animatedStageKey = `${activePrompt?.requestId}:${isReviewStep ? 'review' : activeQuestion?.id || questionIndex}`
    const answeredAllQuestions = Boolean(
        progress && activePrompt && progress.answeredQuestionCount >= activePrompt.questions.length,
    )
    const actionLabel = responding
        ? 'Submitting'
        : isReviewStep
          ? 'Submit'
          : attaching
            ? 'Adding files'
            : canSkipStep
              ? 'Skip'
              : activePrompt?.questions.length === 1 && composerController.contextFiles.length === 0 && activeQuestion && !isAssistantUserInputMultiValueQuestion(activeQuestion) ? 'Submit answer' : 'Continue'
    const canAdvance = isReviewStep ? answeredAllQuestions && !attaching : canAdvanceStep
    const reviewAnswers = (activePrompt?.questions || []).map((question, index) => ({
        question,
        index,
        answer: formatAssistantUserInputAnswer(question, activeDraftAnswers[question.id]),
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
        attachmentsLocked: false,
        isResponding: responding,
        isReviewStep,
    })
    const composerStatusToneClass =
        composerCapabilities.tone === 'warning'
            ? 'text-amber-200'
            : composerCapabilities.tone === 'info'
              ? 'text-sky-200'
              : 'text-sparkle-text-secondary'
    const composerStatusDotClass =
        composerCapabilities.tone === 'warning'
            ? 'bg-amber-300/80'
            : composerCapabilities.tone === 'info'
              ? 'bg-sky-300/80'
              : 'bg-white/35'

    const handleCustomTextareaKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            event.stopPropagation()
            if ('nativeEvent' in event && 'stopImmediatePropagation' in event.nativeEvent) {
                event.nativeEvent.stopImmediatePropagation()
            }
            if (!activeQuestion || isReviewStep || responding || event.nativeEvent?.isComposing || event.key === 'Process') return
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (event.key !== 'Enter' && event.key !== 'NumpadEnter') return
            if (event.shiftKey) return
            if (!canAdvanceStep) return
            event.preventDefault()
            void handleAdvance()
        },
        [activeQuestion, canAdvanceStep, handleAdvance, isReviewStep, responding],
    )

    useEffect(() => {
        const container = animatedStepRef.current
        if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

        const animatedNodes = Array.from(
            container.querySelectorAll<HTMLElement>('[data-guided-animate]'),
        )
        animatedNodes.forEach((node, index) => {
            node.animate(
                [
                    {
                        opacity: 0,
                        transform: 'translateY(14px) scale(0.982)',
                        filter: 'blur(3px)',
                    },
                    {
                        opacity: 1,
                        transform: 'translateY(0) scale(1)',
                        filter: 'blur(0px)',
                    },
                ],
                {
                    duration: 280 + index * 48,
                    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                    fill: 'both',
                },
            )
        })
    }, [animatedStageKey])

    const attachQuestionFile = async (file: File, source: 'paste' | 'manual') => {
        setAttaching((count) => count + 1)
        try {
            await composerController.attachFile(file, source)
        } catch {
            setPasteError('Could not attach this file. Try again.')
        } finally {
            setAttaching((count) => count - 1)
        }
    }

    const pasteAnswerText = (value: string) => {
        if (!activeQuestion) return
        if (isLargeTextPaste(value))
            composerController.upsertAttachment(buildTextAttachmentFromPaste(value))
        else {
            const start = customTextareaRef.current?.selectionStart ?? customAnswerValue.length
            const end = customTextareaRef.current?.selectionEnd ?? start
            handleCustomAnswerChange(
                activeQuestion.id,
                customAnswerValue.slice(0, start) + value + customAnswerValue.slice(end),
            )
            window.requestAnimationFrame(() => {
                customTextareaRef.current?.focus({ preventScroll: true })
                customTextareaRef.current?.setSelectionRange(
                    start + value.length,
                    start + value.length,
                )
            })
        }
    }

    const handleAnswerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
        if (composerCapabilities.inputDisabled) {
            event.preventDefault()
            return
        }
        setPasteError(null)
        const files = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file')
        const text = event.clipboardData.getData('text/plain')
        if (composerCapabilities.attachDisabled && (files.length > 0 || isLargeTextPaste(text))) {
            event.preventDefault()
            setPasteError(
                composerCapabilities.detailLabel || 'Attachments are unavailable right now.',
            )
            return
        }
        if (files.length > 0) {
            event.preventDefault()
            for (const item of files) {
                const file = item.getAsFile()
                if (file) void attachQuestionFile(file, 'paste')
            }
            return
        }
        if (text) {
            event.preventDefault()
            pasteAnswerText(text)
        }
    }

    if (!activePrompt || !progress) return null
    return (
        <div className="mx-auto w-full max-w-3xl" data-assistant-composer-hitbox="true">
            <div
                ref={composerController.composerRootRef}
                className="pointer-events-auto relative z-10"
            >
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
                                selectedAnswer: progress.selectedAnswer,
                            }}
                            reviewAnswers={reviewAnswers}
                            responding={responding}
                            returnToReview={returnToReview}
                            expandedOptionKey={expandedOptionKey}
                            customTextareaRef={customTextareaRef}
                            composerCapabilities={composerCapabilities}
                            setQuestionIndex={setQuestionIndex}
                            setReturnToReview={setReturnToReview}
                            setExpandedOptionKey={setExpandedOptionKey}
                            onToggleQuestionShellMinimized={() =>
                                setQuestionShellMinimized((current) => !current)
                            }
                            handleSelectOption={handleSelectOption}
                            handleToggleOption={handleToggleOption}
                            handleCustomAnswerChange={handleCustomAnswerChange}
                            handleRankingChange={handleRankingChange}
                            handleCustomTextareaKeyDown={handleCustomTextareaKeyDown}
                        />

                        {showAnswerComposer ? (
                            <div data-guided-animate className="flex min-h-10 items-start gap-2">
                                <button
                                    type="button"
                                    disabled={composerCapabilities.attachDisabled}
                                    onClick={() =>
                                        composerController.filePickerRef.current?.click()
                                    }
                                    aria-label="Attach files"
                                    className="mt-0.5 rounded-full p-1 text-sparkle-text-muted hover:text-sparkle-text disabled:opacity-35"
                                    title={
                                        composerCapabilities.attachDisabled
                                            ? composerCapabilities.detailLabel ||
                                              'Attachments are disabled right now'
                                            : 'Attach files'
                                    }
                                >
                                    <Plus size={18} />
                                </button>
                                <div className="relative min-w-0 flex-1">
                                    <textarea
                                        key={activeQuestion?.id}
                                        ref={customTextareaRef}
                                        autoFocus={activeQuestion?.type === 'text'}
                                        rows={1}
                                        value={customAnswerValue}
                                        onChange={(event) => {
                                            if (!activeQuestion) return
                                            handleCustomAnswerChange(
                                                activeQuestion.id,
                                                event.target.value,
                                            )
                                        }}
                                        onKeyDownCapture={(event) => {
                                            event.stopPropagation()
                                            if (
                                                'nativeEvent' in event &&
                                                'stopImmediatePropagation' in event.nativeEvent
                                            ) {
                                                event.nativeEvent.stopImmediatePropagation()
                                            }
                                        }}
                                        onKeyDown={handleCustomTextareaKeyDown}
                                        onPaste={handleAnswerPaste}
                                        aria-label="Your answer"
                                        className="relative min-h-10 w-full resize-none overflow-y-auto bg-transparent pl-[3px] pr-2 text-[14px] leading-[1.45rem] text-sparkle-text outline-none placeholder:text-sparkle-text/20 selection:bg-white/15"
                                        placeholder={
                                            activeQuestion?.placeholder ||
                                            composerCapabilities.placeholder
                                        }
                                        disabled={composerCapabilities.inputDisabled}
                                    />
                                </div>
                            </div>
                        ) : null}
                        {pasteError ? (
                            <p role="alert" className="text-xs text-amber-300">
                                {pasteError}
                            </p>
                        ) : null}
                        <input
                            ref={composerController.filePickerRef}
                            type="file"
                            multiple
                            className="hidden"
                            aria-label="Choose answer attachments"
                            onChange={(event) => {
                                for (const file of Array.from(event.currentTarget.files || []))
                                    void attachQuestionFile(file, 'manual')
                                event.currentTarget.value = ''
                            }}
                        />
                        <ComposerAttachmentsShelf
                            contextFiles={composerController.contextFiles}
                            presentation="compact-pills"
                            compact
                            removingAttachmentIds={composerController.removingAttachmentIds}
                            onPreview={(file) => composerController.setPreviewAttachment(file)}
                            onRemove={composerController.removeAttachment}
                        />
                    </div>

                    <AssistantPendingUserInputFooter
                        composerController={composerController}
                        composerCapabilities={composerCapabilities}
                        responding={responding}
                        progressQuestionIndex={progress.questionIndex}
                        isReviewStep={isReviewStep}
                        returnToReview={returnToReview}
                        canAdvance={canAdvance}
                        actionLabel={actionLabel}
                        onBack={() => {
                            if (returnToReview) {
                                setQuestionIndex(activePrompt.questions.length)
                                setReturnToReview(false)
                                return
                            }
                            setQuestionIndex((current) => Math.max(0, current - 1))
                        }}
                        onAdvance={() => void handleAdvance()}
                    />
                </div>
                <AssistantAttachmentPreviewModal
                    file={composerController.previewAttachment}
                    meta={
                        composerController.previewAttachment
                            ? getContextFileMeta(composerController.previewAttachment)
                            : null
                    }
                    contentType={composerController.previewAttachment?.mimeType || ''}
                    sizeLabel={toKbLabel(composerController.previewAttachment?.sizeBytes)}
                    showFormattingWarning={false}
                    onUpdatePastedText={composerController.updateContextFileText}
                    onClose={() => composerController.setPreviewAttachment(null)}
                />
            </div>
        </div>
    )
})
