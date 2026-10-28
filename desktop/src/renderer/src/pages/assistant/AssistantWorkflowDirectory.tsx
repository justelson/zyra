import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search, Workflow } from 'lucide-react'
import type { WorkflowRunState } from '@shared/assistant/contracts'
import { AssistantDirectorySearch } from './AssistantDirectorySearch'
import { formatAssistantAgentTokens } from './assistant-agent-presentation'
import { formatAssistantWorkflowElapsed, getAssistantWorkflowProgress } from './assistant-workflow-presentation'
import { AssistantWorkflowAvatar, AssistantWorkflowStatusBadge, type AssistantWorkflowAction } from './AssistantWorkflowPrimitives'
import { ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE, assistantWorkflowCurrentPhase, projectAssistantWorkflowDirectory, type AssistantWorkflowDirectoryFilter } from './assistant-workflow-directory-model'
import './assistant-agent-directory.css'
import './assistant-workflow-directory.css'
export { ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE } from './assistant-workflow-directory-model'

export function AssistantWorkflowDirectory({ workflows, page, onPageChange, onOpenWorkflow, navigation,
    query = '', filter = 'all', onQueryChange, onFilterChange }: {
    workflows: WorkflowRunState[]; page: number; onPageChange: (page: number) => void; onOpenWorkflow: (id: string) => void
    onWorkflowAction?: (action: AssistantWorkflowAction, id: string) => void
    navigation?: ReactNode; query?: string; filter?: AssistantWorkflowDirectoryFilter
    onQueryChange?: (query: string) => void; onFilterChange?: (filter: AssistantWorkflowDirectoryFilter) => void
}) {
    const { rows, counts } = useMemo(() => projectAssistantWorkflowDirectory(workflows, query, filter), [workflows, query, filter])
    const pageCount = Math.max(1, Math.ceil(rows.length / ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE))
    const safePage = Math.min(Math.max(page, 0), pageCount - 1)
    const start = safePage * ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE
    const scrollRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => { if (safePage !== page) onPageChange(safePage) }, [page, safePage, onPageChange])
    useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [safePage, query, filter])
    const changeQuery = (value: string) => { onQueryChange?.(value); onPageChange(0) }
    const changeFilter = (value: AssistantWorkflowDirectoryFilter) => { onFilterChange?.(value); onPageChange(0) }
    return <section className="assistant-agent-directory assistant-workflow-directory" data-testid="assistant-workflow-directory">
        <header className="assistant-agent-directory__toolbar">
            {navigation || <span className="assistant-fleet-section-label">Workflows <span>{workflows.length}</span></span>}
            <AssistantDirectorySearch entity="workflows" query={query} onChange={changeQuery} disabled={!onQueryChange} />
            <select className="assistant-agent-directory__filter" aria-label="Filter workflows" value={filter} disabled={!onFilterChange}
                onChange={event => changeFilter(event.target.value as AssistantWorkflowDirectoryFilter)}>
                {(['all', 'attention', 'active', 'finished'] as const).map(value => <option key={value} value={value}>
                    {{ all: 'All', attention: 'Needs attention', active: 'Active', finished: 'Finished' }[value]} · {counts[value]}
                </option>)}
            </select>
        </header>
        <div ref={scrollRef} data-assistant-capsule-scroll="workflows-directory" className="assistant-agent-directory__scroll custom-scrollbar">
            {rows.length ? <>
                <div className="assistant-workflow-directory__columns" aria-hidden="true"><span>Workflow</span><span>Phase</span><span>Agents / usage</span><span>Status</span><span /></div>
                <ul className="assistant-agent-directory__list" aria-label="Workflow runs">{rows.slice(start, start + ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE).map(({ run, identity, group }) => {
                    const progress = getAssistantWorkflowProgress(run)
                    return <li key={run.workflowRunId} data-testid="assistant-workflow-row" data-workflow-run-id={run.workflowRunId} data-workflow-group={group}>
                        <button type="button" className="assistant-workflow-directory__row" onClick={() => onOpenWorkflow(run.workflowRunId)} aria-label={`Open ${identity.name} workflow`}>
                            <span className="assistant-workflow-directory__identity"><AssistantWorkflowAvatar run={run} size={28} /><span><strong title={identity.name}>{identity.name}</strong>
                                <span title={run.error?.message || run.warnings[0]}>{run.error?.message || run.warnings[0] || `${Object.keys(run.calls).length} calls · attempt ${run.attempt}`}</span></span></span>
                            <span className="assistant-workflow-directory__phase"><strong>{assistantWorkflowCurrentPhase(run)}</strong><span>{progress.completedPhases}/{progress.totalPhases} phases complete</span></span>
                            <span className="assistant-workflow-directory__usage"><strong>{run.agentRunIds.length} agents</strong><span>{formatAssistantAgentTokens(run.usage.totalTokens)} tokens · {formatAssistantWorkflowElapsed(run)}</span></span>
                            <span className="assistant-agent-directory__status assistant-workflow-directory__status"><AssistantWorkflowStatusBadge status={run.status} /></span>
                            <ChevronRight size={14} className="assistant-agent-directory__open assistant-workflow-directory__open" aria-hidden="true" />
                        </button>
                    </li>
                })}</ul>
            </> : <div className="assistant-agent-directory__empty">{workflows.length ? <><Search size={22} /><h3>No matching workflows</h3><p>Try another name, phase, model, or status.</p><button onClick={() => { changeQuery(''); changeFilter('all') }}>Clear filters</button></>
                : <><Workflow size={23} /><h3>No workflows yet</h3><p>Workflow runs for this chat appear here.</p></>}</div>}
        </div>
        {workflows.length ? <footer className="assistant-agent-directory__footer" data-testid="assistant-workflow-directory-footer">
            <span aria-live="polite">{rows.length ? `${start + 1}–${Math.min(start + ASSISTANT_WORKFLOW_DIRECTORY_PAGE_SIZE, rows.length)} of ${rows.length}` : '0'} workflows{rows.length !== workflows.length ? ` · ${workflows.length} total` : ''}</span>
            {pageCount > 1 ? <nav aria-label="Workflow directory pages"><button aria-label="Previous workflow page" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)}><ChevronLeft size={14} /></button>
                <span>{safePage + 1} / {pageCount}</span><button aria-label="Next workflow page" disabled={safePage === pageCount - 1} onClick={() => onPageChange(safePage + 1)}><ChevronRight size={14} /></button></nav> : null}
        </footer> : null}
    </section>
}
