import type { AssistantThread } from '../../shared/assistant/contracts'
import type { CanonicalAgentChat } from './zyra-agent-server-worker'

/** A durable independent conversation is a root, while retaining its creator. */
export function projectCanonicalAgentOrigin(chat: Pick<CanonicalAgentChat, 'agentCreatedBy' | 'agentLabel' | 'agentConversationKind'>): Pick<AssistantThread, 'source' | 'providerParentThreadId' | 'agentNickname'> | undefined {
    if (!chat.agentCreatedBy) return undefined
    return {
        source: chat.agentConversationKind === 'thread' ? 'root' : 'subagent',
        providerParentThreadId: chat.agentCreatedBy,
        agentNickname: chat.agentLabel || 'Agent'
    }
}
