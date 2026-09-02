import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { ArrowUpRight, Bot, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentRunState } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import {
    formatAssistantAgentElapsed,
    formatAssistantAgentTokens,
    resolveAssistantAgentIdentity,
    shortAssistantAgentModel,
    type AssistantAgentVibe
} from './assistant-agent-presentation'
import {
    AssistantAgentActionButtons,
    AssistantAgentAvatar,
    AssistantAgentStatusBadge,
    type AssistantAgentAction
} from './AssistantAgentPrimitives'

export const ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE = 9

const AGENT_GRID_STYLE: CSSProperties = {
    gridTemplateColumns: 'repeat(auto-fit, minmax(0, 16.5rem))'
}

const AGENT_NAME_TONES: Record<AssistantAgentVibe, string> = {
    inquiry: 'text-sky-100',
    systems: 'text-violet-100',
    guardian: 'text-amber-100',
    craft: 'text-fuchsia-100',
    proof: 'text-emerald-100',
    builder: 'text-orange-100',
    velocity: 'text-cyan-100',
    contemplative: 'text-sparkle-text'
}

const AGENT_TYPE_TONES: Record<AssistantAgentVibe, string> = {
    inquiry: 'text-sky-200/70',
    systems: 'text-violet-200/70',
    guardian: 'text-amber-200/70',
    craft: 'text-fuchsia-200/70',
    proof: 'text-emerald-200/70',
    builder: 'text-orange-200/70',
    velocity: 'text-cyan-200/70',
    contemplative: 'text-sparkle-text-muted/65'
}

export function AssistantAgentDirectory({
    agents,
    page,
    onPageChange,
    onOpenAgent,
    onAgentAction
}: {
    agents: AgentRunState[]
    page: number
    onPageChange: (page: number) => void
    onOpenAgent: (agentRunId: string) => void
    onAgentAction?: (action: AssistantAgentAction, agentRunId: string) => void
}) {
    const pageCount = Math.max(1, Math.ceil(agents.length / ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE))
    const safePage = Math.min(Math.max(0, page), pageCount - 1)
    const pageStart = safePage * ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE
    const visibleAgents = agents.slice(pageStart, pageStart + ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE)
    const activeCount = agents.filter((run) => ['queued', 'starting', 'running', 'waiting', 'recovering'].includes(run.status)).length
    const completedCount = agents.filter((run) => run.status === 'completed').length

    useEffect(() => {
        if (page !== safePage) onPageChange(safePage)
    }, [onPageChange, page, safePage])

    return (
        <section
            className="flex min-h-0 flex-1 flex-col"
            data-testid="assistant-agent-directory"
            data-agent-page-size={ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE}
        >
            <div data-assistant-capsule-scroll="agents-directory" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]">
                <div className="mx-auto w-full max-w-[56rem]">
                    <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.04] pb-3">
                        <div>
                            <h2 className="text-[14px] font-semibold text-sparkle-text">Delegated work</h2>
                            <p className="mt-0.5 text-[9px] leading-4 text-sparkle-text-muted/60">Open an agent to read its task, run details, and transcript.</p>
                        </div>
                        <div className="flex items-center gap-1.5 text-[8px] font-medium text-sparkle-text-muted/55">
                            <span className="rounded bg-white/[0.025] px-2 py-1">{activeCount} active</span>
                            <span className="rounded bg-white/[0.025] px-2 py-1">{completedCount} done</span>
                        </div>
                    </header>

                    {agents.length === 0 ? (
                        <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] bg-white/[0.012] px-5 text-center">
                            <Bot size={20} className="text-sparkle-text-muted/35" />
                            <p className="text-[10px] font-medium text-sparkle-text-secondary/70">No child agents in this thread.</p>
                            <p className="max-w-xs text-[9px] leading-4 text-sparkle-text-muted/50">Agents appear here when work is delegated from the root conversation.</p>
                        </div>
                    ) : (
                        <div
                            className="grid w-full items-start gap-2.5"
                            style={AGENT_GRID_STYLE}
                            data-testid="assistant-agent-card-grid"
                            data-max-columns="3"
                        >
                            {visibleAgents.map((run) => (
                                <AssistantAgentCard
                                    key={run.agentRunId}
                                    run={run}
                                    onOpen={() => onOpenAgent(run.agentRunId)}
                                    onAgentAction={onAgentAction}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {agents.length > 0 ? (
                <footer
                    className="shrink-0 border-t border-white/[0.04] bg-[color-mix(in_srgb,var(--color-bg)_97%,black)] px-3"
                    data-testid="assistant-agent-directory-footer"
                >
                    <div className="mx-auto flex h-10 w-full max-w-[56rem] items-center justify-between gap-3 text-[9px] text-sparkle-text-muted/55">
                        <span>{pageStart + 1}–{Math.min(pageStart + ASSISTANT_AGENT_DIRECTORY_PAGE_SIZE, agents.length)} of {agents.length} agents</span>
                        {pageCount > 1 ? (
                            <nav className="flex items-center gap-1" aria-label="Agent directory pages">
                                <PageButton
                                    label="Previous agent page"
                                    disabled={safePage === 0}
                                    onClick={() => onPageChange(safePage - 1)}
                                    icon={<ChevronLeft size={12} />}
                                />
                                <span className="min-w-16 text-center font-medium text-sparkle-text-muted/65">Page {safePage + 1} of {pageCount}</span>
                                <PageButton
                                    label="Next agent page"
                                    disabled={safePage >= pageCount - 1}
                                    onClick={() => onPageChange(safePage + 1)}
                                    icon={<ChevronRight size={12} />}
                                />
                            </nav>
                        ) : null}
                    </div>
                </footer>
            ) : null}
        </section>
    )
}

function AssistantAgentCard({
    run,
    onOpen,
    onAgentAction
}: {
    run: AgentRunState
    onOpen: () => void
    onAgentAction?: (action: AssistantAgentAction, agentRunId: string) => void
}) {
    const identity = resolveAssistantAgentIdentity(run)
    return (
        <article
            className="group/card flex h-[12.5rem] w-full max-w-[16.5rem] min-w-0 justify-self-start flex-col overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_38%,transparent)] transition-colors hover:border-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-card)_52%,transparent)]"
            data-testid="assistant-agent-card"
            data-agent-run-id={run.agentRunId}
            data-card-width="16.5rem"
            data-card-height="12.5rem"
        >
            <button
                type="button"
                onClick={onOpen}
                className="flex min-h-0 flex-1 flex-col p-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]/45"
                aria-label={`Open ${identity.name}'s agent transcript`}
            >
                <div className="flex w-full min-w-0 items-start gap-2.5">
                    <AssistantAgentAvatar run={run} size={40} />
                    <div className="min-w-0 flex-1 pt-0.5">
                        <strong className={cn('block truncate text-[12px] font-semibold', AGENT_NAME_TONES[identity.vibe])}>{identity.name}</strong>
                        <span className="mt-0.5 block truncate text-[9px] font-medium text-[var(--accent-primary)]/70">{identity.roleTitle}</span>
                    </div>
                    <AssistantAgentStatusBadge status={run.status} />
                </div>
                <p className="mt-3 line-clamp-3 min-h-[3.15rem] text-[10px] leading-[1.05rem] text-sparkle-text-secondary/70">{run.goal || 'No delegated goal recorded.'}</p>
                {run.activity?.summary ? (
                    <p className="mt-2 truncate border-l border-[var(--accent-primary)]/20 pl-2 text-[8px] leading-4 text-sparkle-text-muted/50">{run.activity.summary}</p>
                ) : null}
                <div className="mt-auto flex w-full items-end justify-between gap-2 pt-2.5">
                    <div className="min-w-0">
                        <span className={cn('block max-w-full truncate text-[7.5px] font-semibold', AGENT_TYPE_TONES[identity.vibe])}>
                            {run.definitionName || run.agentId}
                        </span>
                        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[7.5px] font-medium">
                            <span className="truncate text-violet-200/65" title={run.selectedModel}>{shortAssistantAgentModel(run.selectedModel)}</span>
                            <span className="size-1 shrink-0 rounded-full bg-white/12" aria-hidden="true" />
                            <span className="shrink-0 text-emerald-200/65">{formatAssistantAgentTokens(run.usage.totalTokens)} tokens</span>
                            <span className="size-1 shrink-0 rounded-full bg-white/12" aria-hidden="true" />
                            <span className="shrink-0 text-amber-200/65">{formatAssistantAgentElapsed(run.elapsedMs)}</span>
                        </div>
                    </div>
                    <ArrowUpRight size={12} className="mb-0.5 shrink-0 text-sparkle-text-muted/25 transition-colors group-hover/card:text-[var(--accent-primary)]/70" />
                </div>
            </button>
            <AssistantAgentActionButtons
                run={run}
                onAction={onAgentAction}
                className={cn('min-h-9 shrink-0 border-t border-[color-mix(in_srgb,var(--accent-primary)_6%,transparent)] px-3 py-1.5', !onAgentAction && 'opacity-60')}
            />
        </article>
    )
}

function PageButton({
    label,
    disabled,
    onClick,
    icon
}: {
    label: string
    disabled: boolean
    onClick: () => void
    icon: ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className="inline-flex size-7 items-center justify-center rounded bg-white/[0.025] text-sparkle-text-muted transition-colors hover:bg-white/[0.065] hover:text-sparkle-text disabled:cursor-default disabled:opacity-25"
        >
            {icon}
        </button>
    )
}
