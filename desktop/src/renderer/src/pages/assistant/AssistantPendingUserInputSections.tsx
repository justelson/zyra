import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { AssistantPendingUserInput, AssistantUserInputAnswer, AssistantUserInputQuestion } from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { ComposerFooterControls, ComposerSendButton } from './AssistantComposerSections'
import { AssistantPendingUserInputQuestionField } from './AssistantPendingUserInputQuestionField'
import type { AssistantComposerController } from './useAssistantComposerController'

export function AssistantPendingUserInputStage(props: {
    questionShellOpen: boolean
    questionShellMinimized: boolean
    animatedStepRef: RefObject<HTMLDivElement | null>
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
    reviewAnswers: Array<{ question: AssistantUserInputQuestion; index: number; answer: string }>
    responding: boolean
    returnToReview: boolean
    expandedOptionKey: string | null
    showCustomComposer: boolean
    customTextareaRef: RefObject<HTMLTextAreaElement | null>
    composerCapabilities: { attachDisabled: boolean; inputDisabled: boolean; placeholder: string }
    setQuestionIndex: (value: number | ((current: number) => number)) => void
    setReturnToReview: (value: boolean) => void
    setExpandedOptionKey: (value: string | null | ((current: string | null) => string | null)) => void
    onToggleQuestionShellMinimized: () => void
    handleSelectOption: (questionId: string, optionLabel: string) => void
    handleToggleOption: (questionId: string, optionLabel: string) => void
    handleSelectCustom: (questionId: string) => void
    handleCustomAnswerChange: (questionId: string, value: string) => void
    handleRankingChange: (questionId: string, value: string[]) => void
    handleCustomTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
}) {
    const {
        questionShellOpen,
        questionShellMinimized,
        animatedStepRef,
        isReviewStep,
        activeQuestion,
        activePrompt,
        pendingUserInputsLength,
        progress,
        reviewAnswers,
        responding,
        returnToReview,
        expandedOptionKey,
        showCustomComposer,
        setQuestionIndex,
        setReturnToReview,
        setExpandedOptionKey,
        onToggleQuestionShellMinimized,
        handleSelectOption,
        handleToggleOption,
        handleSelectCustom,
        handleCustomAnswerChange,
        handleRankingChange
    } = props

    return (
        <AnimatedHeight isOpen={questionShellOpen} duration={240}>
            <div ref={animatedStepRef} className="mb-1.5 overflow-hidden rounded-[18px] border border-white/5 bg-sparkle-bg/85">
                <div data-guided-animate className={cn('px-4 pt-2 transition-[padding] duration-200', questionShellMinimized ? 'pb-2' : 'border-b border-white/5 pb-2')}>
                    <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-sparkle-text-muted">
                            {isReviewStep ? 'Review Decisions' : activeQuestion?.header}
                        </p>
                        <div className="flex shrink-0 items-center gap-2 text-[11px]">
                            <span className="rounded-full bg-white/[0.04] px-2 py-0.5 font-semibold uppercase tracking-[0.12em] text-emerald-200">Guided Input</span>
                            <span className="rounded-full bg-white/[0.03] px-2 py-0.5 font-medium tabular-nums text-sparkle-text-secondary">{isReviewStep ? 'Review' : `${progress.questionIndex + 1}/${activePrompt.questions.length}`}</span>
                            {pendingUserInputsLength > 1 ? <span className="rounded-full bg-white/[0.03] px-2 py-0.5 text-sparkle-text-muted">1/{pendingUserInputsLength}</span> : null}
                            <button type="button" onClick={onToggleQuestionShellMinimized} className="inline-flex size-6 items-center justify-center rounded-full bg-white/[0.04] text-sparkle-text-secondary transition-colors hover:bg-white/[0.07] hover:text-sparkle-text" title={questionShellMinimized ? 'Expand question' : 'Minimize question'} aria-label={questionShellMinimized ? 'Expand guided question' : 'Minimize guided question'} aria-expanded={!questionShellMinimized}>
                                {questionShellMinimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                        </div>
                    </div>
                    {!questionShellMinimized ? <p className="mt-1 text-[13px] leading-4 text-sparkle-text">{isReviewStep ? 'Review every answer before sending it back.' : activeQuestion?.question}</p> : null}
                </div>

                {!questionShellMinimized && isReviewStep ? (
                    <div className="custom-scrollbar max-h-[286px] space-y-1.5 overflow-y-auto overscroll-contain px-3 py-2.5 pr-2">
                        {reviewAnswers.map(({ question, index, answer }) => (
                            <button data-guided-animate key={question.id} type="button" disabled={responding} onClick={() => {
                                setQuestionIndex(index)
                                setReturnToReview(true)
                            }} className="flex w-full items-start justify-between gap-3 rounded-2xl bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]">
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.1] px-1.5 text-[10px] font-semibold tabular-nums text-sparkle-text">{index + 1}</span>
                                        <span className="truncate text-[12px] font-medium text-sparkle-text">{question.question}</span>
                                    </span>
                                    <span className="mt-1.5 flex items-center gap-2">
                                        <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-sparkle-text-secondary">{question.header}</span>
                                        <span className="min-w-0 truncate text-[12px] text-sparkle-text-muted">{answer}</span>
                                    </span>
                                </span>
                                <span className="mt-0.5 shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-sparkle-text">Change</span>
                            </button>
                        ))}
                    </div>
                ) : !questionShellMinimized && activeQuestion && activeQuestion.type !== 'text' ? (
                    <div className="px-3 py-2.5">
                        <AssistantPendingUserInputQuestionField
                            question={activeQuestion}
                            answer={progress.selectedAnswer}
                            responding={responding}
                            expandedOptionKey={expandedOptionKey}
                            showCustomComposer={showCustomComposer}
                            setExpandedOptionKey={setExpandedOptionKey}
                            onSelectOption={handleSelectOption}
                            onToggleOption={handleToggleOption}
                            onSelectCustom={handleSelectCustom}
                            onScalarChange={handleCustomAnswerChange}
                            onRankingChange={handleRankingChange}
                        />
                    </div>
                ) : null}
            </div>
        </AnimatedHeight>
    )
}

export function AssistantPendingUserInputFooter(props: {
    composerController: AssistantComposerController
    composerCapabilities: { controlsLocked: boolean; sendDisabled: boolean }
    responding: boolean
    progressQuestionIndex: number
    isReviewStep: boolean
    returnToReview: boolean
    canAdvance: boolean
    canSkip: boolean
    actionLabel: string
    onBack: () => void
    onSkip: () => void
    onAdvance: () => void
}) {
    const { composerController, composerCapabilities, responding, progressQuestionIndex, isReviewStep, returnToReview, canAdvance, canSkip, actionLabel, onBack, onSkip, onAdvance } = props
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
                {(progressQuestionIndex > 0 || isReviewStep) ? <button type="button" disabled={responding} onClick={onBack} className={cn('inline-flex items-center justify-center gap-1 rounded-full bg-white/[0.04] py-2 text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:bg-white/[0.06] hover:text-sparkle-text disabled:opacity-50', isReviewStep ? 'min-w-[80px] px-3' : 'min-w-[92px] px-3.5')}><ArrowLeft size={12} />{returnToReview ? 'Review' : 'Back'}</button> : null}
                {canSkip ? <button type="button" disabled={responding} onClick={onSkip} className="rounded-full px-3 py-2 text-[12px] font-medium text-sparkle-text-muted transition-colors hover:bg-white/[0.04] hover:text-sparkle-text">Skip</button> : null}
                <ComposerSendButton disabled={composerCapabilities.sendDisabled} isConnected={composerController.isConnected} isThinking={false} canSend={canAdvance} label={actionLabel} onSend={() => void onAdvance()} />
            </div>
        </div>
    )
}
