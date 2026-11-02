import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Users, Workflow } from 'lucide-react'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'
import type { FleetSnapshot } from '@shared/assistant/contracts'
import type { AssistantUtilityAgentsStateCapsule } from '@shared/assistant/utility-window'
import { AssistantAgentDetailPage } from './AssistantAgentDetailPage'
import { AssistantAgentDirectory } from './AssistantAgentDirectory'
import type { AssistantAgentDirectoryFilter } from './assistant-agent-directory-model'
import type { AssistantAgentAction } from './AssistantAgentPrimitives'
import { AssistantWorkflowDetailPage } from './AssistantWorkflowDetailPage'
import { AssistantWorkflowDirectory } from './AssistantWorkflowDirectory'
import type { AssistantWorkflowDirectoryFilter } from './assistant-workflow-directory-model'
import type { AssistantWorkflowAction } from './AssistantWorkflowPrimitives'
import { useAssistantAgentTranscript } from './useAssistantAgentTranscript'

interface AssistantFleetWorkspaceProps {
    threadId: string | null
    snapshot: FleetSnapshot | null
    selectedAgentRunId: string | null
    selectedWorkflowRunId: string | null
    selectionRequestId?: number
    onSelectAgent: (agentRunId: string | null) => void
    onSelectWorkflow: (workflowRunId: string | null) => void
    onAgentAction?: (action: AssistantAgentAction, agentRunId: string) => void
    onWorkflowAction?: (action: AssistantWorkflowAction, workflowRunId: string) => void
    stateCapsule?: AssistantUtilityAgentsStateCapsule
    onStateCapsuleChange?: (capsule: AssistantUtilityAgentsStateCapsule) => void
}

export function AssistantFleetWorkspace(props: AssistantFleetWorkspaceProps) {
    const [tab, setTab] = useState<'agents' | 'workflows'>(props.selectedAgentRunId ? 'agents' : props.selectedWorkflowRunId ? 'workflows' : props.stateCapsule?.section || 'agents')
    const [agentPage, setAgentPage] = useState(props.stateCapsule?.agentPage || 0)
    const [agentQuery, setAgentQuery] = useState(props.stateCapsule?.agentQuery || '')
    const [agentFilter, setAgentFilter] = useState<AssistantAgentDirectoryFilter>(props.stateCapsule?.agentFilter || 'all')
    const [workflowPage, setWorkflowPage] = useState(props.stateCapsule?.workflowPage || 0)
    const [workflowQuery, setWorkflowQuery] = useState(props.stateCapsule?.workflowQuery || '')
    const [workflowFilter, setWorkflowFilter] = useState<AssistantWorkflowDirectoryFilter>(props.stateCapsule?.workflowFilter || 'all')
    const pendingHydrationRef = useRef(props.stateCapsule)
    const agents = useMemo(() => Object.values(props.snapshot?.agents ?? {}).sort(newestFirst), [props.snapshot])
    const workflows = useMemo(() => Object.values(props.snapshot?.workflows ?? {}).sort(newestFirst), [props.snapshot])
    const selectedAgent = agents.find((run) => run.agentRunId === props.selectedAgentRunId) ?? null
    const selectedWorkflow = workflows.find((run) => run.workflowRunId === props.selectedWorkflowRunId) ?? null
    // Selection owns the visible page immediately. `tab` remembers the directory
    // to return to, but its passive synchronization must never paint a wrong page.
    const section = selectedAgent ? 'agents' : selectedWorkflow ? 'workflows' : tab
    const transcript = useAssistantAgentTranscript(props.threadId, selectedAgent)
    const handleOpenWorkflowAgent = useCallback((agentRunId: string) => {
        props.onSelectAgent(agentRunId)
        setTab('agents')
    }, [props.onSelectAgent])

    useEffect(() => {
        pendingHydrationRef.current = props.stateCapsule
        if (!props.stateCapsule) return
        setTab(props.stateCapsule.section || 'agents')
        setAgentPage(props.stateCapsule.agentPage || 0)
        setAgentQuery(props.stateCapsule.agentQuery || '')
        setAgentFilter(props.stateCapsule.agentFilter || 'all')
        setWorkflowPage(props.stateCapsule.workflowPage || 0)
        setWorkflowQuery(props.stateCapsule.workflowQuery || '')
        setWorkflowFilter(props.stateCapsule.workflowFilter || 'all')
    }, [props.stateCapsule])

    useEffect(() => {
        if (props.selectedAgentRunId) setTab('agents')
        else if (props.selectedWorkflowRunId) setTab('workflows')
    }, [props.selectedAgentRunId, props.selectedWorkflowRunId, props.selectionRequestId])

    useEffect(() => {
        const pendingHydration = pendingHydrationRef.current
        if (pendingHydration) {
            const hydrated = tab === (pendingHydration.section || 'agents')
                && agentPage === (pendingHydration.agentPage || 0)
                && agentQuery === (pendingHydration.agentQuery || '')
                && agentFilter === (pendingHydration.agentFilter || 'all')
                && workflowPage === (pendingHydration.workflowPage || 0)
                && workflowQuery === (pendingHydration.workflowQuery || '')
                && workflowFilter === (pendingHydration.workflowFilter || 'all')
                && props.selectedAgentRunId === (pendingHydration.selectedAgentRunId || null)
                && props.selectedWorkflowRunId === (pendingHydration.selectedWorkflowRunId || null)
            if (!hydrated) return
            pendingHydrationRef.current = undefined
        }
        props.onStateCapsuleChange?.({
            version: 1,
            workspace: 'agents',
            section,
            agentPage,
            agentQuery,
            agentFilter,
            workflowPage,
            workflowQuery,
            workflowFilter,
            selectedAgentRunId: props.selectedAgentRunId || undefined,
            selectedWorkflowRunId: props.selectedWorkflowRunId || undefined,
            scrollAnchor: props.stateCapsule?.scrollAnchor
        })
    }, [agentPage, agentQuery, agentFilter, props.onStateCapsuleChange, props.selectedAgentRunId, props.selectedWorkflowRunId, props.stateCapsule?.scrollAnchor, section, tab, workflowPage, workflowQuery, workflowFilter])

    return (
        <section className="flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--color-bg)_96%,black)]" data-testid="assistant-fleet-workspace">
            {section === 'agents' ? (
                selectedAgent ? (
                    <AssistantAgentDetailPage
                        key={selectedAgent.agentRunId}
                        run={selectedAgent}
                        transcript={transcript.page}
                        loading={transcript.loading}
                        error={transcript.error}
                        onBack={() => props.onSelectAgent(null)}
                        onLoadOlder={() => void transcript.loadOlder()}
                        onLoadNewer={() => void transcript.loadNewer()}
                        onRetry={transcript.retry}
                        onAgentAction={props.onAgentAction}
                    />
                ) : (
                    <AssistantAgentDirectory
                        agents={agents}
                        navigation={<FleetSectionPicker section={section} onChange={setTab} agents={agents.length} workflows={workflows.length} />}
                        page={agentPage}
                        onPageChange={setAgentPage}
                        onOpenAgent={props.onSelectAgent}
                        query={agentQuery}
                        filter={agentFilter}
                        onQueryChange={setAgentQuery}
                        onFilterChange={setAgentFilter}
                    />
                )
            ) : selectedWorkflow ? (
                <AssistantWorkflowDetailPage
                    run={selectedWorkflow}
                    agents={props.snapshot?.agents ?? {}}
                    onBack={() => props.onSelectWorkflow(null)}
                    onOpenAgent={handleOpenWorkflowAgent}
                    onWorkflowAction={props.onWorkflowAction}
                />
            ) : (
                <AssistantWorkflowDirectory
                    workflows={workflows}
                    navigation={<FleetSectionPicker section={section} onChange={setTab} agents={agents.length} workflows={workflows.length} />}
                    query={workflowQuery}
                    filter={workflowFilter}
                    onQueryChange={setWorkflowQuery}
                    onFilterChange={setWorkflowFilter}
                    page={workflowPage}
                    onPageChange={setWorkflowPage}
                    onOpenWorkflow={props.onSelectWorkflow}
                    onWorkflowAction={props.onWorkflowAction}
                />
            )}
        </section>
    )
}

function FleetSectionPicker({ section, onChange, agents, workflows }: {
    section: 'agents' | 'workflows'; onChange: (section: 'agents' | 'workflows') => void; agents: number; workflows: number
}) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLButtonElement | null>(null)
    const close = useCallback(() => setOpen(false), [])
    return <>
        <button ref={anchorRef} type="button" className="assistant-fleet-section-picker" aria-label="Delegated work view"
            aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            {section === 'agents' ? 'Agents' : 'Workflows'}<span>{section === 'agents' ? agents : workflows}</span><ChevronDown size={13} />
        </button>
        {open ? <AnchoredMenuPopover anchorRef={anchorRef} label="Delegated work view" onClose={close} autoFocus width={160} browserZIndex={170}>
            <div className="assistant-fleet-section-menu" onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                const index = buttons.indexOf(event.target as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                buttons[next]?.focus()
            }}>
                {(['agents', 'workflows'] as const).map(value => <button key={value} type="button" role="menuitemradio" aria-checked={section === value}
                    className="assistant-fleet-section-option"
                    onClick={() => { onChange(value); close(); anchorRef.current?.focus() }}>
                    {section === value ? <Check size={14} aria-hidden="true" />
                        : value === 'agents' ? <Users size={14} aria-hidden="true" /> : <Workflow size={14} aria-hidden="true" />}
                    <span>{value === 'agents' ? 'Agents' : 'Workflows'}</span>
                    <span className="assistant-fleet-section-option__count">{value === 'agents' ? agents : workflows}</span>
                </button>)}
            </div>
        </AnchoredMenuPopover> : null}
    </>
}

function newestFirst(left: { createdAt: string }, right: { createdAt: string }) {
    return right.createdAt.localeCompare(left.createdAt)
}
