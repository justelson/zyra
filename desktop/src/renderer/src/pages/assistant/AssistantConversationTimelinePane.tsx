import { memo, useLayoutEffect, useRef, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import type { AssistantActivity, AssistantMessage, AssistantPendingUserInput, AssistantProposedPlan, AssistantSessionTurnUsageEntry } from '@shared/assistant/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { AssistantChatDisplayMode, AssistantTextStreamingMode, AssistantToolOutputDefaultMode } from '@/lib/settings'
import { LoadingSpinner } from '@/components/ui/LoadingState'
import { cn } from '@/lib/utils'
import { AssistantTimeline } from './AssistantTimeline'
import type { AssistantDiffTarget } from './assistant-diff-types'
import type { AssistantElementBounds } from './assistant-composer-types'
import { resolveAssistantScrollButtonBottom } from './assistant-pane-layout'

export const AssistantConversationTimelinePane = memo(function AssistantConversationTimelinePane(props: {
    loading: boolean
    timelineScrollRef: RefObject<HTMLDivElement | null>
    timelineContentRef: RefObject<HTMLDivElement | null>
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    proposedPlans?: AssistantProposedPlan[]
    userInputs: AssistantPendingUserInput[]
    userInputResponding: boolean
    onRespondUserInput: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
    sessionMode: 'work' | 'playground'
    latestProjectLabel: string
    projectTitle: string | null
    assistantMessageFilePath?: string | null
    windowKey: string
    isWorking: boolean
    activeStatusLabel: string
    isConnecting: boolean
    activeWorkStartedAt: string | null
    latestAssistantMessageId: string | null
    latestTurnStartedAt: string | null
    turnUsageById?: ReadonlyMap<string, AssistantSessionTurnUsageEntry>
    deletingMessageId: string | null
    focusMessageId?: string | null
    loadingChats: boolean
    assistantTextStreamingMode: AssistantTextStreamingMode
    assistantToolOutputDefaultMode: AssistantToolOutputDefaultMode
    assistantChatDisplayMode: AssistantChatDisplayMode
    bottomComposerOverlayActive?: boolean
    contentInsetEndAdjustment?: number
    scrollButtonBottomOverride?: number
    hasOlder?: boolean
    hasNewer?: boolean
    loadingOlder?: boolean
    loadingNewer?: boolean
    loadOlderError?: string | null
    loadNewerError?: string | null
    onLoadOlder?: (turnLimit?: number) => Promise<boolean> | boolean | void
    onLoadNewer?: (turnLimit?: number) => Promise<boolean> | boolean | void
    showScrollToBottom: boolean
    elevateScrollToBottom?: boolean
    onScrollButtonBoundsChange?: (bounds: AssistantElementBounds | null) => void
    onScrollTimeline: (element: HTMLDivElement) => void
    onScrollToBottom: () => void
    onRequestDeleteUserMessage: (message: AssistantMessage) => void
    onImplementProposedPlan?: (plan: AssistantProposedPlan) => Promise<void> | void
    onShowPlanPanel?: () => void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onOpenAssistantLink?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    onOpenEditedFile?: (filePath: string) => Promise<void> | void
    onViewDiff?: (target: AssistantDiffTarget) => void
}) {
    const projectRootPath = props.projectTitle
    const floatingPlanOverlayRef = useRef<HTMLDivElement | null>(null)
    const scrollButtonRef = useRef<HTMLButtonElement | null>(null)

    useLayoutEffect(() => {
        const element = scrollButtonRef.current
        if (!props.showScrollToBottom || !element) {
            props.onScrollButtonBoundsChange?.(null)
            return
        }

        const measure = () => {
            const rect = element.getBoundingClientRect()
            props.onScrollButtonBoundsChange?.({
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
                height: rect.height
            })
        }

        const frameId = window.requestAnimationFrame(measure)
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
        observer?.observe(element)
        window.addEventListener('resize', measure)

        return () => {
            window.cancelAnimationFrame(frameId)
            observer?.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [props.elevateScrollToBottom, props.onScrollButtonBoundsChange, props.showScrollToBottom])

    return (
        <div className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden bg-sparkle-bg" data-assistant-conversation-timeline-pane="true">
            {props.loading ? (
                <LoadingSpinner
                    message="Loading assistant snapshot..."
                    className="h-full py-0"
                    minHeightClassName="min-h-0"
                />
            ) : (
                <>
                    <AssistantTimeline
                        messages={props.messages}
                        activities={props.activities}
                        proposedPlans={props.proposedPlans || []}
                        userInputs={props.userInputs}
                        userInputResponding={props.userInputResponding}
                        onRespondUserInput={props.onRespondUserInput}
                        sessionMode={props.sessionMode}
                        projectLabel={projectRootPath ? props.latestProjectLabel : null}
                        projectTitle={projectRootPath}
                        projectRootPath={projectRootPath}
                        assistantMessageFilePath={props.assistantMessageFilePath}
                        windowKey={props.windowKey}
                        scrollContainerRef={props.timelineScrollRef}
                        overlayContainerRef={floatingPlanOverlayRef}
                        isWorking={props.isWorking}
                        workingLabel={props.activeStatusLabel}
                        activeWorkStartedAt={props.activeWorkStartedAt}
                        latestAssistantMessageId={props.latestAssistantMessageId}
                        latestTurnStartedAt={props.latestTurnStartedAt}
                        turnUsageById={props.turnUsageById}
                        deletingMessageId={props.deletingMessageId}
                        focusMessageId={props.focusMessageId}
                        loadingChats={props.loadingChats}
                        assistantTextStreamingMode={props.assistantTextStreamingMode}
                        assistantToolOutputDefaultMode={props.assistantToolOutputDefaultMode}
                        assistantChatDisplayMode={props.assistantChatDisplayMode}
                        isConnecting={props.isConnecting}
                        contentInsetEndAdjustment={props.contentInsetEndAdjustment || 0}
                        hasOlder={props.hasOlder}
                        hasNewer={props.hasNewer}
                        loadingOlder={props.loadingOlder}
                        loadingNewer={props.loadingNewer}
                        loadOlderError={props.loadOlderError}
                        loadNewerError={props.loadNewerError}
                        onLoadOlder={props.onLoadOlder}
                        onLoadNewer={props.onLoadNewer}
                        onScrollContainer={props.onScrollTimeline}
                        onRequestDeleteUserMessage={props.onRequestDeleteUserMessage}
                        onImplementProposedPlan={props.onImplementProposedPlan}
                        onShowPlanPanel={props.onShowPlanPanel}
                        onOpenAttachmentPreview={props.onOpenAttachmentPreview}
                        onOpenInternalLink={props.onOpenAssistantLink}
                        onLinkNotice={props.onLinkNotice}
                        onOpenFilePath={props.onOpenEditedFile}
                        onViewDiff={props.onViewDiff}
                    />
                    <div ref={floatingPlanOverlayRef} className="pointer-events-none absolute inset-0 z-20" />
                    <div
                        className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 transition-[bottom,opacity,transform] duration-200"
                        style={{
                            bottom: `${props.scrollButtonBottomOverride ?? resolveAssistantScrollButtonBottom(
                                props.contentInsetEndAdjustment || 0,
                                props.elevateScrollToBottom === true
                            )}px`
                        }}
                    >
                        <button
                            ref={scrollButtonRef}
                            type="button"
                            onClick={props.onScrollToBottom}
                            className={cn(
                                'pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-sparkle-card/95 px-3 py-2 text-xs text-sparkle-text-secondary shadow-lg shadow-black/20 backdrop-blur-xl transition-all hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text',
                                props.showScrollToBottom ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
                            )}
                            title="Scroll to bottom"
                        >
                            <ArrowDown size={13} />
                            Scroll to bottom
                        </button>
                    </div>
                </>
            )}
        </div>
    )
})
