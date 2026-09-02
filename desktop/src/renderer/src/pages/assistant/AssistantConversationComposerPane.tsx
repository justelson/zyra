import { memo, useCallback, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import type { AssistantApprovalDecision, AssistantPendingApproval, AssistantPendingUserInput, AssistantPlaygroundPendingLabRequest, AssistantReasoningEffort, AssistantRuntimeMode, AssistantTurnUsage, AssistantVoiceExecutionConfiguration } from '@shared/assistant/contracts'
import type { ControlPendingActionApproval, ControlPendingGrant, ControlTarget } from '@shared/agent-control/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { cn } from '@/lib/utils'
import { AssistantComposer } from './AssistantComposer'
import { AssistantPendingApprovalPanel } from './AssistantPendingApprovalPanel'
import { AssistantPendingControlApprovalPanel } from './AssistantPendingControlApprovalPanel'
import { AssistantPendingPlaygroundLabPanel } from './AssistantPendingPlaygroundLabPanel'
import { AssistantPendingTerminalAccessPanel, getPendingTerminalAccessRequest } from './AssistantPendingTerminalAccessModal'
import { AssistantPendingUserInputPanel } from './AssistantPendingUserInputPanel'
import { deriveAssistantComposerDisabledReason } from './assistant-composer-capabilities'
import { ASSISTANT_COMPOSER_OVERLAY_TOP_PADDING_PX } from './assistant-pane-layout'
import type { AssistantComposerSendOptions, AssistantElementBounds, AssistantQueuedComposerMessage, ComposerContextFile } from './assistant-composer-types'
import { useAssistantComposerPlacementMotion } from './useAssistantComposerPlacementMotion'

export const AssistantConversationComposerPane = memo(function AssistantConversationComposerPane(props: {
    placement?: 'bottom' | 'center'
    paneRef?: RefObject<HTMLDivElement | null>
    newChatPrompt?: string | null
    pendingPlaygroundLabRequest: AssistantPlaygroundPendingLabRequest | null
    pendingApprovals: AssistantPendingApproval[]
    pendingControlActions: ControlPendingActionApproval[]
    pendingControlGrants: ControlPendingGrant[]
    controlTargets: ControlTarget[]
    pendingUserInputs: AssistantPendingUserInput[]
    commandPending: boolean
    composerDisabled?: boolean
    sending: boolean
    thinking: boolean
    queuedMessageCount: number
    queuedMessages: AssistantQueuedComposerMessage[]
    onForceQueuedMessage?: (messageId: string) => Promise<void> | void
    onDeleteQueuedMessage?: (messageId: string) => Promise<void> | void
    onMoveQueuedMessage?: (messageId: string, targetMessageId: string) => Promise<void> | void
    selectedSessionId: string | null
    useSettingsDefaults: boolean
    resetComposerStateToken?: string | null
    selectedSessionMode: 'work' | 'playground'
    assistantAvailable: boolean
    assistantConnected: boolean
    selectedProjectPath: string | null
    projectChoices?: Array<{ path: string; label: string }>
    projectContextDisabled?: boolean
    onSelectProject?: (projectPath: string | null) => Promise<void> | void
    onChooseProjectFolder?: () => Promise<void> | void
    availableModels: Array<{ id: string; label: string; description?: string }>
    activeModel: string | undefined
    activeEffort?: AssistantReasoningEffort | null
    activeFastModeEnabled: boolean
    modelsLoading: boolean
    latestTurnUsage?: AssistantTurnUsage | null
    runtimeMode: AssistantRuntimeMode
    interactionMode: 'default' | 'plan'
    activeProfile: 'safe-dev' | 'yolo-fast'
    zyraProfile: 'default' | 'builder'
    onZyraProfileChange: (profile: 'default' | 'builder') => void
    activeStatusLabel: string
    isConnecting?: boolean
    reconnectPending?: boolean
    onStop?: () => Promise<void> | void
    onReconnect?: () => Promise<void> | void
    onPrepareRealtimeVoice?: (configuration: AssistantVoiceExecutionConfiguration) => void
    onStartRealtimeVoice?: (configuration: AssistantVoiceExecutionConfiguration) => void
    realtimeVoiceDisabled?: boolean
    onOverflowWheel?: (deltaY: number) => void
    onBlockedSend?: (message: string) => void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onAttachmentShelfBoundsChange?: (bounds: AssistantElementBounds | null) => void
    onDraftStarted?: () => void
    sendPrompt: (
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => Promise<boolean>
    refreshModels: () => void
    respondApproval: (requestId: string, decision: AssistantApprovalDecision) => Promise<void>
    respondUserInput: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
    setPlaygroundTerminalAccess: (enabled: boolean) => void
    setPlaygroundTerminalAccessRequestMuted: (muted: boolean) => void
    approvePendingPlaygroundLabRequest: (input: { title?: string; source: 'empty' | 'git-clone'; repoUrl?: string }) => Promise<void>
    declinePendingPlaygroundLabRequest: () => Promise<void>
}) {
    const placement = props.placement || 'bottom'
    useAssistantComposerPlacementMotion(props.paneRef, placement)
    const hasPendingPlaygroundLabRequest = Boolean(props.pendingPlaygroundLabRequest)
    const isWaitingForControlApproval = props.pendingControlActions.length > 0 || props.pendingControlGrants.length > 0
    const isWaitingForApproval = props.pendingApprovals.length > 0
    const pendingTerminalAccessRequest = getPendingTerminalAccessRequest(props.pendingUserInputs)
    const visiblePendingUserInputs = pendingTerminalAccessRequest
        ? props.pendingUserInputs.filter((request) => request.requestId !== pendingTerminalAccessRequest.requestId)
        : props.pendingUserInputs
    const isWaitingForUserInput = visiblePendingUserInputs.length > 0
    const isConnecting = props.isConnecting ?? (props.commandPending && !props.assistantConnected)
    const reconnectPending = props.reconnectPending ?? (props.commandPending && !props.assistantConnected)
    const composerDisabledReason = deriveAssistantComposerDisabledReason({
        sessionId: props.selectedSessionId,
        sessionMode: props.selectedSessionMode,
        projectPath: props.selectedProjectPath
    })
    const handlePaneWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (!props.onOverflowWheel || event.deltaY === 0 || isWaitingForControlApproval || isWaitingForApproval || isWaitingForUserInput || hasPendingPlaygroundLabRequest) return
        if (event.target instanceof Element && event.target.closest('[data-assistant-composer-hitbox="true"]')) return

        const lineHeight = Number.parseFloat(window.getComputedStyle(event.currentTarget).lineHeight || '0') || 20
        const pageHeight = event.currentTarget.clientHeight || lineHeight * 3
        const deltaFactor = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? pageHeight : 1
        event.preventDefault()
        props.onOverflowWheel(event.deltaY * deltaFactor)
    }, [hasPendingPlaygroundLabRequest, isWaitingForApproval, isWaitingForControlApproval, isWaitingForUserInput, props.onOverflowWheel])

    return (
        <div
            ref={props.paneRef}
            className={cn(
                'w-full px-4 will-change-transform',
                placement === 'center'
                    ? '-translate-y-[7vh] pb-0 pt-0'
                    : 'pointer-events-none absolute inset-x-0 bottom-0 z-40 translate-y-0 pb-4'
            )}
            style={placement === 'bottom' ? { paddingTop: ASSISTANT_COMPOSER_OVERLAY_TOP_PADDING_PX } : undefined}
            onWheel={handlePaneWheel}
        >
            {isWaitingForControlApproval ? (
                <AssistantPendingControlApprovalPanel
                    pendingActions={props.pendingControlActions}
                    pendingGrants={props.pendingControlGrants}
                    targets={props.controlTargets}
                />
            ) : null}
            {!isWaitingForControlApproval && isWaitingForApproval ? (
                <AssistantPendingApprovalPanel
                    pendingApprovals={props.pendingApprovals}
                    responding={props.commandPending}
                    onRespond={props.respondApproval}
                />
            ) : null}
            {!isWaitingForControlApproval && !isWaitingForApproval && isWaitingForUserInput ? (
                <AssistantPendingUserInputPanel
                    pendingUserInputs={visiblePendingUserInputs}
                    responding={props.commandPending}
                    onRespond={props.respondUserInput}
                    sessionId={props.selectedSessionId}
                    assistantAvailable={props.assistantAvailable}
                    assistantConnected={props.assistantConnected}
                    selectedProjectPath={props.selectedProjectPath}
                    availableModels={props.availableModels}
                    activeModel={props.activeModel}
                    modelsLoading={props.modelsLoading}
                    runtimeMode={props.runtimeMode}
                    interactionMode={props.interactionMode}
                    activeProfile={props.activeProfile}
                    activeStatusLabel={props.activeStatusLabel}
                    isConnecting={isConnecting}
                />
            ) : null}
            {!isWaitingForControlApproval && !isWaitingForApproval && pendingTerminalAccessRequest ? (
                <AssistantPendingTerminalAccessPanel
                    request={pendingTerminalAccessRequest}
                    responding={props.commandPending}
                    onRespond={props.respondUserInput}
                    onSetTerminalAccess={props.setPlaygroundTerminalAccess}
                    onSetRequestMuted={props.setPlaygroundTerminalAccessRequestMuted}
                />
            ) : null}
            {!isWaitingForControlApproval && !isWaitingForApproval && !isWaitingForUserInput && hasPendingPlaygroundLabRequest && props.pendingPlaygroundLabRequest ? (
                <AssistantPendingPlaygroundLabPanel
                    request={props.pendingPlaygroundLabRequest}
                    responding={props.commandPending}
                    onApprove={props.approvePendingPlaygroundLabRequest}
                    onDecline={props.declinePendingPlaygroundLabRequest}
                />
            ) : null}
            {!isWaitingForControlApproval && !isWaitingForApproval && !hasPendingPlaygroundLabRequest && !isWaitingForUserInput && !pendingTerminalAccessRequest ? (
                <div
                    className={cn(
                        'mx-auto w-full transition-[max-width] duration-[460ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        placement === 'center' ? 'max-w-2xl' : 'max-w-[760px]'
                    )}
                    data-assistant-composer-hitbox="true"
                >
                    {placement === 'center' ? (
                        <div className="pointer-events-none mb-5 px-2 text-center">
                            <p
                                className="mx-auto max-w-[680px] text-[30px] font-medium leading-[1.08] tracking-[-0.035em] text-sparkle-text/90"
                                style={{ fontFamily: 'var(--font-ui, "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif)' }}
                            >
                                {props.newChatPrompt || ''}
                            </p>
                        </div>
                    ) : null}
                    <AssistantComposer
                        sessionId={props.selectedSessionId}
                        useSettingsDefaults={props.useSettingsDefaults}
                        resetStateToken={props.resetComposerStateToken}
                        placement={placement}
                        disabled={Boolean(composerDisabledReason) || props.composerDisabled === true}
                        disabledReason={composerDisabledReason}
                        isSending={props.sending}
                        isThinking={props.thinking}
                        thinkingLabel={props.activeStatusLabel}
                        queuedMessageCount={props.queuedMessageCount}
                        queuedMessages={props.queuedMessages}
                        onForceQueuedMessage={props.onForceQueuedMessage}
                        onDeleteQueuedMessage={props.onDeleteQueuedMessage}
                        onMoveQueuedMessage={props.onMoveQueuedMessage}
                        isConnected={props.assistantConnected}
                        isConnecting={isConnecting}
                        activeModel={props.activeModel}
                        activeEffort={props.activeEffort}
                        activeFastModeEnabled={props.activeFastModeEnabled}
                        modelOptions={props.availableModels}
                        modelsLoading={props.modelsLoading}
                        modelsError={null}
                        latestTurnUsage={props.latestTurnUsage}
                        activeProfile={props.activeProfile}
                        zyraProfile={props.zyraProfile}
                        onZyraProfileChange={props.onZyraProfileChange}
                        runtimeMode={props.runtimeMode}
                        interactionMode={props.interactionMode}
                        projectPath={props.selectedProjectPath}
                        projectChoices={props.projectChoices}
                        projectContextDisabled={props.projectContextDisabled}
                        onSelectProject={props.onSelectProject}
                        onChooseProjectFolder={props.onChooseProjectFolder}
                        onReconnect={props.onReconnect}
                        onPrepareRealtimeVoice={props.onPrepareRealtimeVoice}
                        onStartRealtimeVoice={props.onStartRealtimeVoice}
                        realtimeVoiceDisabled={props.realtimeVoiceDisabled}
                        onOverflowWheel={props.onOverflowWheel}
                        onBlockedSend={props.onBlockedSend}
                        onOpenAttachmentPreview={props.onOpenAttachmentPreview}
                        onAttachmentShelfBoundsChange={props.onAttachmentShelfBoundsChange}
                        onDraftStarted={props.onDraftStarted}
                        onRefreshModels={props.refreshModels}
                        onStop={props.onStop}
                        onSend={props.sendPrompt}
                        reconnectPending={reconnectPending}
                    />
                </div>
            ) : null}
        </div>
    )
})
