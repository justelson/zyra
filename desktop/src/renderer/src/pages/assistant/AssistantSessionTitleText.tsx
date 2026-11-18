import { memo } from 'react'
import { cn } from '@/lib/utils'

export const AssistantSessionTitleText = memo(function AssistantSessionTitleText({
    title,
    generating = false,
    sidebar = false,
    reveal = true,
    className
}: {
    title: string
    generating?: boolean
    sidebar?: boolean
    reveal?: boolean
    className?: string
}) {
    return (
        <span data-zyra-part={sidebar ? 'sidebar.chatRow.title' : undefined} className={cn('block min-w-0 truncate', className)} aria-busy={generating || undefined} aria-label={generating ? `${title}, refreshing title` : title}>
            <span key={`${title}:${generating ? 'generating' : 'ready'}`} className={cn('block truncate', generating ? 'assistant-title-shimmer' : reveal && 'assistant-title-reveal')}>
                {title}
            </span>
        </span>
    )
})
