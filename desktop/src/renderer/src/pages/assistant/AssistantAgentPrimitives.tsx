import { useMemo, type ReactNode } from 'react'
import { Avatar, Style } from '@dicebear/core'
import botttsDefinition from '@dicebear/styles/bottts.json'
import { GitBranch, RotateCcw, Square } from 'lucide-react'
import type { AgentRunState, AgentRunStatus } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { resolveAssistantAgentIdentity, type AgentIdentitySource } from './assistant-agent-presentation'

export type AssistantAgentAction = 'stop' | 'retry' | 'resume'

const BOTTS_STYLE = new Style(botttsDefinition)

export function AssistantAgentAvatar({
    run,
    size,
    className
}: {
    run: AgentIdentitySource
    size: number
    className?: string
}) {
    const identity = resolveAssistantAgentIdentity(run)
    const avatarUri = useMemo(() => new Avatar(BOTTS_STYLE, {
        seed: identity.seed,
        size,
        borderRadius: 12,
        scale: 9.2
    }).toDataUri(), [identity.seed, size])
    return (
        <span
            role="img"
            aria-label={`${identity.name}, ${identity.roleTitle}`}
            className={cn('inline-flex shrink-0 overflow-hidden rounded-md bg-transparent', className)}
            style={{ width: size, height: size }}
            data-dicebear-style="bottts"
        >
            <img src={avatarUri} alt="" width={size} height={size} draggable={false} className="size-full select-none object-cover" />
        </span>
    )
}

const STATUS_STYLES: Record<AgentRunStatus, { badge: string; dot: string; pulse?: boolean }> = {
    queued: { badge: 'bg-white/[0.035] text-sparkle-text-muted/70', dot: 'bg-white/35' },
    starting: { badge: 'bg-cyan-400/[0.07] text-cyan-100/75', dot: 'bg-cyan-300', pulse: true },
    running: { badge: 'bg-emerald-400/[0.075] text-emerald-100/80', dot: 'bg-emerald-300', pulse: true },
    waiting: { badge: 'bg-sky-400/[0.07] text-sky-100/75', dot: 'bg-sky-300', pulse: true },
    blocked: { badge: 'bg-amber-400/[0.08] text-amber-100/80', dot: 'bg-amber-300' },
    completed: { badge: 'bg-emerald-400/[0.06] text-emerald-100/65', dot: 'bg-emerald-300/70' },
    failed: { badge: 'bg-rose-400/[0.08] text-rose-100/80', dot: 'bg-rose-300' },
    cancelled: { badge: 'bg-white/[0.025] text-sparkle-text-muted/55', dot: 'bg-white/25' },
    interrupted: { badge: 'bg-amber-400/[0.07] text-amber-100/75', dot: 'bg-amber-300' },
    recovering: { badge: 'bg-violet-400/[0.07] text-violet-100/75', dot: 'bg-violet-300', pulse: true }
}

export function AssistantAgentStatusBadge({ status }: { status: AgentRunStatus }) {
    const style = STATUS_STYLES[status]
    return (
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[8px] font-semibold capitalize tracking-[0.02em]', style.badge)}>
            <span className={cn('size-1.5 rounded-full', style.dot, style.pulse && 'motion-safe:animate-pulse')} aria-hidden="true" />
            {status}
        </span>
    )
}

export function AssistantAgentActionButtons({
    run,
    onAction,
    className
}: {
    run: AgentRunState
    onAction?: (action: AssistantAgentAction, agentRunId: string) => void
    className?: string
}) {
    const canStop = ['running', 'waiting', 'blocked', 'starting'].includes(run.status)
    const canRetry = ['failed', 'cancelled', 'interrupted'].includes(run.status)
    const canResume = run.status === 'interrupted'
    if (!canStop && !canRetry && !canResume) return null

    return (
        <nav className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label={`Actions for ${run.label}`}>
            {canStop ? (
                <AgentActionButton
                    icon={<Square size={9} />}
                    label="Stop"
                    onClick={() => onAction?.('stop', run.agentRunId)}
                />
            ) : null}
            {canRetry ? (
                <AgentActionButton
                    icon={<RotateCcw size={10} />}
                    label="Retry"
                    onClick={() => onAction?.('retry', run.agentRunId)}
                />
            ) : null}
            {canResume ? (
                <AgentActionButton
                    icon={<GitBranch size={10} />}
                    label="Resume"
                    onClick={() => onAction?.('resume', run.agentRunId)}
                />
            ) : null}
        </nav>
    )
}

function AgentActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex h-6 items-center gap-1.5 rounded bg-white/[0.035] px-2 text-[8px] font-medium text-sparkle-text-muted transition-colors hover:bg-white/[0.07] hover:text-sparkle-text"
        >
            {icon}
            {label}
        </button>
    )
}
