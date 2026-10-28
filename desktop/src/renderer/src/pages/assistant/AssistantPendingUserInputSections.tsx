import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { AssistantPendingUserInput, AssistantUserInputAnswer, AssistantUserInputQuestion } from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { ComposerFooterControls, ComposerSendButton, ComposerVoiceButton } from './AssistantComposerSections'
import { AssistantVoiceRecorderBar } from './AssistantVoiceRecorderBar'
import { useComposerDrawerMotion } from './useComposerDrawerMotion'
import type { useAssistantSpeechInput } from './useAssistantSpeechInput'
import { AssistantPendingUserInputQuestionField } from './AssistantPendingUserInputQuestionField'
import { AssistantComposerMenuSurface } from './AssistantComposerMenuSurface'
import { AssistantQuestionPicker } from './AssistantQuestionPicker'
import { AssistantQuestionTransition } from './AssistantQuestionTransition'
import type { AssistantComposerController } from './useAssistantComposerController'

export function AssistantPendingUserInputStage(props: {
    questionShellOpen: boolean
    questionShellMinimized: boolean
    motionKey: string
    isReviewStep: boolean
    activeQuestion: AssistantUserInputQuestion | null
    activePrompt: AssistantPendingUserInput
    pendingUserInputsLength: number
    progress: {
        questionIndex: number
        answeredQuestionCount: number
        hasAnswer: boolean
        isReviewStep: boolean
        isCustomAnswer: boolean
        selectedAnswer: AssistantUserInputAnswer | null
    }
    reviewAnswers: Array<{ question: AssistantUserInputQuestion; index: number; answer: string; complete: boolean }>
    responding: boolean
    returnToReview: boolean
    setQuestionIndex: (value: number | ((current: number) => number)) => void
    setReturnToReview: (value: boolean) => void
    onToggleQuestionShellMinimized: () => void
    handleSelectOption: (questionId: string, optionLabel: string) => void
    handleToggleOption: (questionId: string, optionLabel: string) => void
    handleCustomAnswerChange: (questionId: string, value: string) => void
    handleRankingChange: (questionId: string, value: string[]) => void
}) {
    const {
        questionShellOpen,
        questionShellMinimized,
        motionKey,
        isReviewStep,
        activeQuestion,
        activePrompt,
        pendingUserInputsLength,
        progress,
        reviewAnswers,
        responding,
        returnToReview,
        setQuestionIndex,
        setReturnToReview,
        onToggleQuestionShellMinimized,
        handleSelectOption,
        handleToggleOption,
        handleCustomAnswerChange,
        handleRankingChange
    } = props


    const drawerMotion = useComposerDrawerMotion(questionShellOpen)
    return (
        <AnimatedHeight isOpen={drawerMotion.open} duration={220} crispContent contentClassName={cn('transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none', drawerMotion.open ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0')}>
            <AssistantComposerMenuSurface title="Questions">
            <div data-question-tray>
                <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-sparkle-text-muted">
                    <span className="min-w-0 flex-1 truncate">{isReviewStep ? 'Review answers' : activeQuestion?.header}</span>
                    <AssistantQuestionPicker requestId={activePrompt.requestId} currentIndex={progress.questionIndex} label={isReviewStep ? `${progress.answeredQuestionCount}/${activePrompt.questions.length}` : `${progress.questionIndex + 1}/${activePrompt.questions.length}`} questions={reviewAnswers} disabled={responding} onChoose={index => {
                        setQuestionIndex(index)
                        setReturnToReview(isReviewStep || returnToReview)
                        if (questionShellMinimized) onToggleQuestionShellMinimized()
                    }} />
                    {!isReviewStep && activeQuestion?.required === false ? <span>· Optional</span> : null}
                    {pendingUserInputsLength > 1 ? <span>· {pendingUserInputsLength} requests</span> : null}
                    <button type="button" onClick={onToggleQuestionShellMinimized} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-sparkle-text" title={questionShellMinimized ? 'Expand question' : 'Minimize question'} aria-label={questionShellMinimized ? 'Expand guided question' : 'Minimize guided question'} aria-expanded={!questionShellMinimized}>
                        {questionShellMinimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                </div>
                <AnimatedHeight isOpen={!questionShellMinimized} duration={220} crispContent contentClassName="transition-opacity duration-[220ms] motion-reduce:transition-none">
                <AssistantQuestionTransition sectionKey={motionKey}>
                <p className="px-3 pb-2 text-[13px] font-medium leading-5 text-sparkle-text">{isReviewStep ? 'Review every answer before sending it back.' : activeQuestion?.question}</p>

                {isReviewStep ? (
                    <div className="custom-scrollbar max-h-[min(18rem,36vh)] space-y-1 overflow-y-auto overscroll-contain px-2 pb-2">
                        {reviewAnswers.map(({ question, index, answer }) => (
                            <button data-guided-animate key={question.id} type="button" disabled={responding} onClick={() => {
                                setQuestionIndex(index)
                                setReturnToReview(true)
                            }} className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.045]">
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.1] px-1.5 text-[10px] font-semibold tabular-nums text-sparkle-text">{index + 1}</span>
                                        <span className="min-w-0 break-words text-[12px] font-medium leading-5 text-sparkle-text">{question.question}</span>
                                    </span>
                                    <span className="mt-1.5 flex items-center gap-2">
                                        <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-sparkle-text-secondary">{question.header}</span>
                                        <span className="min-w-0 whitespace-pre-wrap break-words text-[12px] leading-5 text-sparkle-text-secondary">{answer}</span>
                                    </span>
                                </span>
                                <span className="mt-0.5 shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-sparkle-text">Change</span>
                            </button>
                        ))}
                    </div>
                ) : activeQuestion && activeQuestion.type !== 'text' ? (
                    <div className="custom-scrollbar max-h-[min(18rem,36vh)] overflow-y-auto overscroll-contain px-2 pb-2">
                        <AssistantPendingUserInputQuestionField
                            key={`${activePrompt.requestId}:${activeQuestion.id}`}
                            question={activeQuestion}
                            answer={progress.selectedAnswer}
                            responding={responding}
                            onSelectOption={handleSelectOption}
                            onToggleOption={handleToggleOption}
                            onScalarChange={handleCustomAnswerChange}
                            onRankingChange={handleRankingChange}
                        />
                    </div>
                ) : null}
                </AssistantQuestionTransition>
                </AnimatedHeight>
            </div>
            </AssistantComposerMenuSurface>
        </AnimatedHeight>
    )
}

export function AssistantPendingUserInputFooter(props: {
    composerController: AssistantComposerController
    composerCapabilities: { controlsLocked: boolean; sendDisabled: boolean }
    voiceInput: ReturnType<typeof useAssistantSpeechInput>
    voiceEnabled: boolean
    voiceDisabled: boolean
    showRecorder: boolean
    responding: boolean
    progressQuestionIndex: number
    isReviewStep: boolean
    returnToReview: boolean
    canAdvance: boolean
    actionLabel: string
    onBack: () => void
    onAdvance: () => void
}) {
    const { composerController, composerCapabilities, responding, progressQuestionIndex, isReviewStep, returnToReview, canAdvance, actionLabel, onBack, onAdvance, voiceInput, voiceEnabled, voiceDisabled, showRecorder } = props
    if (showRecorder) return <div className="flex min-w-0 items-center gap-2 px-1.5 py-1.5"><AssistantVoiceRecorderBar disabled={voiceDisabled} durationLabel={voiceInput.durationLabel} isTranscribing={voiceInput.isTranscribing} waveformLevels={voiceInput.waveformLevels} onCancel={voiceInput.cancelRecording} onSubmit={voiceInput.submitRecording} onSend={voiceInput.submitAndSendRecording} /></div>
    return (
        <div className={cn(
            'flex min-w-0 items-center justify-between px-1.5 pb-1.5 [container-type:inline-size] sm:px-2 sm:pb-2',
            isReviewStep
                ? 'flex-nowrap gap-2'
                : cn('gap-3', !composerController.isCompactFooter && 'flex-wrap sm:flex-nowrap')
        )}>
            <ComposerFooterControls
                isCompactFooter={composerController.isCompactFooter}
                forceSingleRow={isReviewStep}
                controlsLocked={composerCapabilities.controlsLocked}
                modelDropdownRef={composerController.modelDropdownRef}
                showModelDropdown={composerController.showModelDropdown}
                setShowModelDropdown={composerController.setShowModelDropdown}
                modelsLoading={composerController.modelsLoading}
                modelsError={composerController.modelsError}
                modelQuery={composerController.modelQuery}
                setModelQuery={composerController.setModelQuery}
                setActiveModelIndex={composerController.setActiveModelIndex}
                modelListRef={composerController.modelListRef}
                filteredModelOptions={composerController.filteredModelOptions}
                activeModelIndex={composerController.activeModelIndex}
                selectedModel={composerController.selectedModel}
                selectedModelLabel={composerController.selectedModelLabel}
                latestModelId={composerController.latestModelId}
                setSelectedModel={composerController.setSelectedModel}
                onRefreshModels={composerController.onRefreshModels}
                traitsDropdownRef={composerController.traitsDropdownRef}
                showTraitsDropdown={composerController.showTraitsDropdown}
                setShowTraitsDropdown={composerController.setShowTraitsDropdown}
                EFFORT_OPTIONS={composerController.EFFORT_OPTIONS}
                selectedEffort={composerController.selectedEffort}
                setSelectedEffort={composerController.setSelectedEffort}
                EFFORT_LABELS={composerController.EFFORT_LABELS}
                fastModeEnabled={composerController.fastModeEnabled}
                setFastModeEnabled={composerController.setFastModeEnabled}
                selectedInteractionMode={composerController.selectedInteractionMode}
                setSelectedInteractionMode={composerController.setSelectedInteractionMode}
                selectedRuntimeMode={composerController.selectedRuntimeMode}
                setSelectedRuntimeMode={composerController.setSelectedRuntimeMode}
                displayedProfile={composerController.displayedProfile}
            />
            <div className={cn('flex shrink-0 items-center', isReviewStep ? 'gap-1.5' : 'gap-2')}>
                {(progressQuestionIndex > 0 || isReviewStep || returnToReview) ? <button type="button" disabled={responding || voiceInput.isStarting} onClick={onBack} className="inline-flex h-9 items-center justify-center gap-1 rounded-full bg-white/[0.04] px-3 text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:bg-white/[0.06] hover:text-sparkle-text disabled:opacity-50"><ArrowLeft size={12} />{returnToReview ? 'Review' : 'Back'}</button> : null}
                <ComposerVoiceButton supported={voiceEnabled && voiceInput.isSupported} isStarting={voiceInput.isStarting} isRecording={voiceInput.isRecording} disabled={voiceDisabled || voiceInput.isStarting || voiceInput.isTranscribing} onToggle={voiceInput.toggleRecording} />
                <ComposerSendButton disabled={composerCapabilities.sendDisabled} isConnected={composerController.isConnected} isThinking={false} canSend={canAdvance} label={actionLabel} onSend={() => void onAdvance()} />
            </div>
        </div>
    )
}
