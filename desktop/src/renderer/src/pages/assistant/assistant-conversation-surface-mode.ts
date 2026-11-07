import type { AssistantThread } from '@shared/assistant/contracts'

export type AssistantConversationSurfaceModeInput = {
    newChatHandoffActive: boolean
    selectedSessionUsesNewChatSurface: boolean
    showChatOnboardingOverlay: boolean
    selectedThreadHasHistoricalContent: boolean
    timelineMessageCount: number
    activityCount: number
    proposedPlanCount: number
    isThreadWorking: boolean
    connectionBelongsToSelectedChat: boolean
    isLoadingSelectedChat: boolean
    pendingApprovalCount: number
    pendingInputCount: number
    hasPendingLabRequest: boolean
}

export type AssistantComposerConnectionPresentationInput = {
    connected: boolean
    hasComposerSession: boolean
    newChatHandoffActive: boolean
    selectedSessionUsesNewChatSurface: boolean
    connecting?: boolean
    reconnectPending?: boolean
}

export function isAssistantComposerTurnActive(input: {
    newChatHandoffActive: boolean
    selectedSessionIsDraft: boolean
    isThreadWorking: boolean
    optimisticPromptSending: boolean
    optimisticPromptAwaitingUserMessage: boolean
}): boolean {
    return !input.newChatHandoffActive
        && (input.optimisticPromptSending
            || input.optimisticPromptAwaitingUserMessage
            || (!input.selectedSessionIsDraft && input.isThreadWorking))
}

export function resolveAssistantComposerConnectionPresentation(
    input: AssistantComposerConnectionPresentationInput
): { connected: boolean; connecting: boolean; reconnectPending: boolean } {
    const connectionDeferred = input.newChatHandoffActive || input.selectedSessionUsesNewChatSurface
    return {
        connected: input.connected || input.hasComposerSession || connectionDeferred,
        connecting: connectionDeferred ? false : input.connecting === true,
        reconnectPending: connectionDeferred ? false : input.reconnectPending === true
    }
}

export function deriveAssistantConversationSurfaceMode(
    input: AssistantConversationSurfaceModeInput
): 'centered-composer' | 'conversation' {
    const hasConversationContent = !input.newChatHandoffActive
        && !input.selectedSessionUsesNewChatSurface
        && Boolean(
            input.selectedThreadHasHistoricalContent
            || input.timelineMessageCount > 0
            || input.activityCount > 0
            || input.proposedPlanCount > 0
            || input.isThreadWorking
            || input.connectionBelongsToSelectedChat
            || input.isLoadingSelectedChat
            || input.pendingApprovalCount > 0
        )
    const centerComposer = !input.showChatOnboardingOverlay
        && !hasConversationContent
        && !input.hasPendingLabRequest
        && input.pendingApprovalCount === 0
        && input.pendingInputCount === 0
    return input.newChatHandoffActive || centerComposer ? 'centered-composer' : 'conversation'
}

export function resolveAssistantTurnPresentationStartedAt(requestedAt: string | null, canonicalStartedAt: string | null): string | null {
    return requestedAt || canonicalStartedAt
}
export function resolveAssistantWorkingStartedAt(thread: Pick<AssistantThread, 'latestTurn' | 'updatedAt'> | null): string | null {
    const turn = thread?.latestTurn?.state === 'running' ? thread.latestTurn : null
    return turn?.startedAt || turn?.requestedAt || thread?.updatedAt || null
}
