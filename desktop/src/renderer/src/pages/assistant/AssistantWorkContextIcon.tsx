import { Code, Bug, Search, Music, Mic, Video, Palette, FileText, BarChart3, ListTodo, MessageSquare } from 'lucide-react'
import type { WorkKind } from '@shared/assistant/work-context'
import { cn } from '@/lib/utils'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import type { SidebarWorkContext } from './assistant-work-context'

const workIcons = { coding: Code, debugging: Bug, research: Search, music: Music, audio: Mic, video: Video, design: Palette, writing: FileText, data: BarChart3, planning: ListTodo, general: MessageSquare } satisfies Record<WorkKind, typeof Code>

export function AssistantWorkContextIcon({ work, dimmed = false }: { work: SidebarWorkContext; dimmed?: boolean }) {
    const Icon = workIcons[work.kind]
    return <span data-work-kind={work.kind} title={work.folderPath || undefined} className={cn('inline-flex size-4 shrink-0 items-center justify-center transition-[filter,opacity]', dimmed && 'opacity-40 grayscale group-hover/agent-inbox-row:opacity-100 group-hover/agent-inbox-row:grayscale-0')}>
        <AssistantProjectIcon projectPath={work.folderPath} size={16} fallbackIcon={<Icon size={16} strokeWidth={1.7} aria-hidden="true" className="text-sparkle-text-muted/75" />} />
    </span>
}
