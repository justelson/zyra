import { Link } from 'react-router-dom'
import type { AssistantSession } from '@shared/assistant/contracts'
import { useAssistantStoreSelector } from '@/lib/assistant/store'

export function AssistantForkOriginNote({ origin }: { origin: AssistantSession['forkOrigin'] }) {
    const source = useAssistantStoreSelector(state => state.snapshot.sessions.find(session => session.threads.some(thread => thread.providerThreadId === origin?.canonicalChatId)) || null)
    if (!origin) return null
    const thread = source?.threads.find(thread => thread.providerThreadId === origin.canonicalChatId)
    const href = source && thread ? `/assistant/chat/${encodeURIComponent(source.id)}/thread/${encodeURIComponent(thread.id)}?message=${encodeURIComponent(origin.messageId || origin.entryId)}` : null
    return <div className="flex shrink-0 flex-wrap items-center gap-x-2 px-4 py-1 text-[11px] text-sparkle-text-muted" data-chat-fork-origin title="Only Chat history was forked. Current working files were not restored to this message's date.">
        <span>Forked history</span>
        {href ? <Link to={href} className="underline underline-offset-2">View source</Link> : <span>Source unavailable</span>}
        <span>{origin.worktree === 'isolated' ? 'Isolated worktree at its creation HEAD' : 'Shared current working files'}</span>
    </div>
}
