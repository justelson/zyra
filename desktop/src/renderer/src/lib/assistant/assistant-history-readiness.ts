import type { AssistantActivity, AssistantMessage, AssistantProposedPlan, AssistantThread } from '@shared/assistant/contracts'
import { resolveAssistantMessageReferenceId } from '@shared/assistant/message-identity'

/** Live work can arrive before bootstrap. It cannot prove the conversation loaded. */
export function hasUsableAssistantTimelineHistory(
    history: { messages: readonly AssistantMessage[]; activities: readonly AssistantActivity[]; proposedPlans: readonly AssistantProposedPlan[]; pageInfo?: { hasNewer: boolean } } | undefined,
    thread?: Pick<AssistantThread, 'messageCount'> & Partial<Pick<AssistantThread, 'latestTurn'>> | null
): boolean {
    if (!history) return false
    if ((thread?.messageCount || 0) > 0 && history.messages.length === 0) return false
    // A shell can report completion after Chat missed the final text events.
    // Counts/timestamps alone cannot validate the cached final-answer placeholder.
    // Deliberate older pages remain usable without containing the latest answer.
    const completedAnswerId = thread?.latestTurn?.state === 'completed' ? thread.latestTurn.assistantMessageId : null
    if (completedAnswerId && !history.pageInfo?.hasNewer) {
        const resolvedId = resolveAssistantMessageReferenceId(history.messages, completedAnswerId)
        const answer = resolvedId ? history.messages.find(message => message.id === resolvedId) : null
        if (!answer || answer.streaming || !answer.text.trim()) return false
    }
    return Boolean(history.messages.length || history.activities.length || history.proposedPlans.length)
}
