import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import { resolveAssistantProjectLabel } from './assistant-project-label'

import type { AssistantProjectChoice } from './assistant-project-choices'
export type { AssistantProjectChoice } from './assistant-project-choices'

export function AssistantNewChatProjectChip(props: {
    projectId: string | null
    projectPath: string | null
    projectName?: string | null
    projectIconSourcePath?: string | null
    projectChoices: AssistantProjectChoice[]
    disabled?: boolean
    onSelectProject: (projectId: string | null) => Promise<void> | void
    onCreateProject: () => Promise<void> | void
}) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const projectLabel = useMemo(() => (
        resolveAssistantProjectLabel(props.projectName, props.projectId, props.projectPath)
        || (props.projectId ? 'Project' : 'No project')
    ), [props.projectId, props.projectName, props.projectPath])

    useEffect(() => {
        if (!open) return
        const dismiss = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', dismiss, true)
        window.addEventListener('keydown', escape)
        return () => {
            document.removeEventListener('pointerdown', dismiss, true)
            window.removeEventListener('keydown', escape)
        }
    }, [open])

    const selectProject = (projectId: string | null) => {
        setOpen(false)
        if (projectId && projectId === props.projectId) return
        void props.onSelectProject(projectId)
    }
    const iconSourcePath = props.projectIconSourcePath
        || props.projectChoices.find(project => project.projectId === props.projectId)?.iconSourcePath
        || null

    return (
        <div ref={rootRef} className="absolute right-3 top-0 z-[70] -translate-y-1/2" data-assistant-new-chat-project-chip="true">
            <button
                type="button"
                disabled={props.disabled}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--surface-floating)_96%,transparent)] px-2.5 text-[11px] font-medium text-sparkle-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur-xl transition-[border-color,color,box-shadow] hover:border-white/[0.14] hover:text-sparkle-text focus:outline-none focus-visible:border-[var(--accent-primary)]/55 disabled:cursor-not-allowed disabled:opacity-45',
                    open && 'border-white/[0.14] text-sparkle-text shadow-[0_10px_28px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)]'
                )}
                title={props.projectId ? projectLabel : 'This chat is not attached to a project'}
                aria-label={`Project context: ${projectLabel}`}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <AssistantProjectIcon projectPath={iconSourcePath} size={12} />
                <span className="truncate">{projectLabel}</span>
                <ChevronDown size={11} className={cn('shrink-0 text-sparkle-text-muted transition-transform', open && 'rotate-180')} />
            </button>

            {open ? (
                <div
                    role="menu"
                    className="assistant-menu-in-down absolute right-0 top-full mt-1.5 w-60 overflow-hidden rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl"
                >
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!props.projectId}
                        onClick={() => selectProject(null)}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    >
                        <Unlink size={13} className="shrink-0 text-sparkle-text-muted" />
                        <span className="min-w-0 flex-1 truncate">No project</span>
                        {!props.projectId ? <Check size={12} /> : null}
                    </button>
                    {props.projectChoices.length > 0 ? <div className="my-1 border-t border-[var(--surface-divider)]" /> : null}
                    <div className="custom-scrollbar max-h-52 overflow-y-auto">
                        {props.projectChoices.map((project) => (
                            <button
                                key={project.projectId}
                                type="button"
                                role="menuitemradio"
                                aria-checked={project.projectId === props.projectId}
                                onClick={() => selectProject(project.projectId)}
                                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                                title={project.label}
                            >
                                <AssistantProjectIcon projectPath={project.iconSourcePath} size={13} />
                                <span className="min-w-0 flex-1 truncate">{project.label}</span>
                                {project.projectId === props.projectId ? <Check size={12} /> : null}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-[var(--surface-divider)]" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false)
                            void props.onCreateProject()
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    >
                        <Plus size={13} className="shrink-0 text-sparkle-text-muted" />
                        <span>New project…</span>
                    </button>
                </div>
            ) : null}
        </div>
    )
}
