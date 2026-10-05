import { Bot } from 'lucide-react'
import type { AssistantThread } from '@shared/assistant/contracts'

/** Agent origin belongs beside the chat's surface indicators. */
export function AssistantAgentPresenceIndicator({ thread, compact = false }: { thread: Pick<AssistantThread, 'source' | 'agentNickname' | 'agentRole'> | null; compact?: boolean }) {
    if (!thread || (thread.source !== 'subagent' && !thread.agentNickname)) return null
    const label = `Agent thread: ${thread.agentNickname || thread.agentRole || 'Agent'}`
    return <span role="status" aria-label={label} title={label} data-agent-presence="thread"
        className="no-drag inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--agent-presence-accent,var(--color-secondary))_12%,transparent)] text-[var(--agent-presence-accent,var(--color-secondary))]">
        <Bot size={compact ? 12 : 15} strokeWidth={1.9} aria-hidden="true" />
    </span>
}
