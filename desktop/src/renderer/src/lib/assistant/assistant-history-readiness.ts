import type { AssistantActivity, AssistantMessage, AssistantProposedPlan, AssistantThread } from '@shared/assistant/contracts'

/** Live work can arrive before bootstrap. It cannot prove the conversation loaded. */
export function hasUsableAssistantTimelineHistory(
    history: { messages: readonly AssistantMessage[]; activities: readonly AssistantActivity[]; proposedPlans: readonly AssistantProposedPlan[] } | undefined,
    thread?: Pick<AssistantThread, 'messageCount'> | null
): boolean {
    if (!history) return false
    if ((thread?.messageCount || 0) > 0 && history.messages.length === 0) return false
    return Boolean(history.messages.length || history.activities.length || history.proposedPlans.length)
}
