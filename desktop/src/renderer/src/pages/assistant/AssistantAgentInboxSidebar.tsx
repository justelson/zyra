import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { isOverlayEventInside } from '@/components/ui/native-overlay-portal'
import { addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Check, CheckCircle2, ChevronDown, CircleDashed, Folder, FolderPlus, MessageSquare, MoreHorizontal, Pin, Search, Undo2, X } from 'lucide-react'
import type { AssistantSession, AssistantThread } from '@shared/assistant/contracts'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { cn } from '@/lib/utils'
import { isAssistantUserFacingSession } from '@/lib/assistant/selectors'
import { SettingsProviderIcon } from '../settings/SettingsProviderIcon'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import { AssistantSessionTitleText } from './AssistantSessionTitleText'
import { useStableSidebarGroups } from './useStableSidebarGroups'
import { getSidebarSettlementActivityKey, isSidebarSettlementCurrent, upgradeSidebarSettlementOverrides, type SettlementOverride, type SettlementOverrides } from './assistant-sidebar-settlement'
import { AssistantTuiPresenceIndicator } from './AssistantTuiPresenceIndicator'
import { AssistantAgentPresenceIndicator } from './AssistantAgentPresenceIndicator'
import { assistantSessionMobileDevices, isAssistantSessionOpenInTui } from './assistant-tui-presence'
import { resolveAssistantInboxModelPresentation } from './assistant-model-labels'
import { resolveAssistantAgentInboxSettledInitialCount } from './assistant-agent-inbox-settled-window'
import {
    formatAssistantSidebarRelativeTime,
    getPrimarySessionThread,
    getSessionDisplayTitle,
    getSessionLastActivityAt,
    getSortableTimestamp,
    groupSessionsByProject,
    isAssistantDraftSession,
    resolveAssistantThreadStatusPill,
    resolveSessionProjectPath,
    type SessionProjectGroup
} from './assistant-sessions-rail-utils'

const ALL_PROJECTS = '__assistant-agent-inbox-all-projects__'
const SETTLED_OVERRIDES_KEY = 'assistant:agent-inbox-settled-overrides:v1'
const AUTO_SETTLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const SETTLED_PAGE_COUNT = 25

type RowStatus = 'approval' | 'input' | 'working' | 'failed' | 'stopped' | 'done' | 'ready'
type SidebarItem = {
    session: AssistantSession
    thread: AssistantThread | null
    projectPath: string
    project: SessionProjectGroup
    activityAt: string
    status: RowStatus
    active: boolean
    pinned: boolean
    settled: boolean
    tuiOpen: boolean
    mobileDevices: string[]
}

type Props = {
    sessions: AssistantSession[]
    pinnedSessionIds?: ReadonlySet<string>
    activeSessionId: string | null
    activeThreadId: string | null
    commandPending: boolean
    pendingControlThreadIds: ReadonlySet<string>
    projectIconOverrides: Record<string, string>
    headerActions: ReactNode
    onCreateProjectChat: (projectPath?: string) => Promise<void> | void
    onSelectSession: (sessionId: string) => Promise<void> | void
    onRename: (session: AssistantSession) => Promise<void> | void
    getSessionMenuItems: (session: AssistantSession) => FileActionsMenuItem[]
    onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, session: AssistantSession, items: FileActionsMenuItem[]) => void
}

function readSettlementOverrides(): SettlementOverrides {
    try {
        const value = JSON.parse(localStorage.getItem(SETTLED_OVERRIDES_KEY) || '{}') as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, SettlementOverride] => {
            const override = entry[1] as Partial<SettlementOverride> | null
            return Boolean(override && (override.state === 'active' || override.state === 'settled') && typeof override.activityAt === 'string'
                && (override.activityKey === undefined || typeof override.activityKey === 'string'))
        }))
    } catch {
        return {}
    }
}

function writeSettlementOverrides(value: SettlementOverrides): void {
    try { localStorage.setItem(SETTLED_OVERRIDES_KEY, JSON.stringify(value)) } catch { /* keep in memory */ }
}

function getStatusThread(session: AssistantSession): AssistantThread | null {
    return session.threads.find((thread) => thread.id === session.activeThreadId) || getPrimarySessionThread(session)
}

function resolveRowStatus(thread: AssistantThread | null, isSelectedThread: boolean): RowStatus {
    const pill = resolveAssistantThreadStatusPill(thread, isSelectedThread)
    switch (pill?.label) {
        case 'Pending': return 'approval'
        case 'Input needed': return 'input'
        case 'Working':
        case 'Background':
        case 'Connecting': return 'working'
        case 'Failed':
        case 'Stale': return 'failed'
        case 'Done': return 'done'
        case 'Stopped': return 'stopped'
        default: return 'ready'
    }
}

function isWorkingItem(item: Pick<SidebarItem, 'status'>): boolean {
    return item.status === 'working' || item.status === 'approval' || item.status === 'input'
}

function isPriorityItem(item: Pick<SidebarItem, 'pinned' | 'status'>): boolean {
    return item.pinned || isWorkingItem(item)
}

function isEffectivelySettled(item: Omit<SidebarItem, 'settled'>, overrides: SettlementOverrides): boolean {
    if (isPriorityItem(item)) return false
    const override = overrides[item.session.id]
    if (override && isSidebarSettlementCurrent(item.session, override)) return override.state === 'settled'
    if (item.status !== 'ready') return false
    const activity = getSortableTimestamp(item.activityAt)
    return activity > 0 && Date.now() - activity >= AUTO_SETTLE_AFTER_MS
}

function formatWorkingDuration(startedAt: string | null): string {
    if (!startedAt) return ''
    const started = Date.parse(startedAt)
    if (!Number.isFinite(started)) return ''
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function WorkingDuration({ thread }: { thread: AssistantThread | null }) {
    const startedAt = thread?.latestTurn?.startedAt || thread?.latestTurn?.requestedAt || thread?.updatedAt || null
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!startedAt) return
        const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000)
        return () => window.clearInterval(timer)
    }, [startedAt])
    const label = formatWorkingDuration(startedAt)
    return label ? <span className="tabular-nums">{label}</span> : null
}

function ProjectMark({ group, dimmed = false }: { group: SessionProjectGroup; dimmed?: boolean }) {
    return (
        <span className={cn('inline-flex size-4 shrink-0 items-center justify-center transition-[filter,opacity]', dimmed && 'opacity-40 grayscale group-hover/agent-inbox-row:opacity-100 group-hover/agent-inbox-row:grayscale-0')}>
            {group.path ? (
                <AssistantProjectIcon
                    projectPath={group.path}
                    projectIconPath={group.projectIconPath}
                    projectType={group.projectType}
                    framework={group.framework}
                    size={16}
                />
            ) : (
                <MessageSquare size={16} strokeWidth={1.7} className="text-sparkle-text-muted/75" />
            )}
        </span>
    )
}

function topStatus(item: SidebarItem): ReactNode {
    if (item.status === 'working') return <span className="assistant-agent-inbox-working-text inline-flex items-center gap-1 font-medium text-sky-400"><CircleDashed size={16} /><span>Working</span><WorkingDuration thread={item.thread} /></span>
    if (item.status === 'approval') return <span className="font-medium text-amber-300">Approval</span>
    if (item.status === 'input') return <span className="font-medium text-indigo-300">Input</span>
    if (item.status === 'failed') return <span className="font-medium text-red-300">Failed</span>
    if (item.status === 'stopped') return <span className="font-medium text-sparkle-text-muted">Stopped</span>
    if (item.status === 'done') return <span className="inline-flex items-center gap-1 font-medium text-emerald-300"><CheckCircle2 size={16} /><span>Done</span></span>
    return formatAssistantSidebarRelativeTime(item.activityAt)
}

function getAgentInboxMenuItems(item: SidebarItem, onToggleSettlement: (item: SidebarItem) => void, props: Props): FileActionsMenuItem[] {
    const settle = !item.settled
    return [
        {
            id: settle ? 'settle' : 'unsettle',
            label: item.pinned ? 'Unpin chat to settle' : settle ? 'Settle chat' : 'Un-settle chat',
            disabled: isPriorityItem(item),
            icon: settle ? <Check size={13} /> : <Undo2 size={13} />,
            onSelect: () => onToggleSettlement(item)
        },
        ...props.getSessionMenuItems(item.session)
    ]
}

function InboxRowActions({ item, action, onAction, props, showLabel = false, inFlow = false }: {
    item: SidebarItem
    action: 'settle' | 'unsettle'
    onAction: (item: SidebarItem) => void
    props: Props
    showLabel?: boolean
    inFlow?: boolean
}) {
    const menuItems = getAgentInboxMenuItems(item, onAction, props)
    return (
        <div className={cn(
            'pointer-events-none z-[1] translate-x-1 opacity-0 duration-150 ease-out group-hover/agent-inbox-row:pointer-events-auto group-focus-visible/agent-inbox-row:pointer-events-auto group-has-[:focus-visible]/agent-inbox-row:pointer-events-auto group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:pointer-events-auto group-hover/agent-inbox-row:translate-x-0 group-focus-visible/agent-inbox-row:translate-x-0 group-has-[:focus-visible]/agent-inbox-row:translate-x-0 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:translate-x-0 group-hover/agent-inbox-row:opacity-100 group-focus-visible/agent-inbox-row:opacity-100 group-has-[:focus-visible]/agent-inbox-row:opacity-100 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:translate-x-0 has-[:focus-visible]:opacity-100 motion-reduce:transition-none',
            inFlow
                ? 'relative grid min-w-0 shrink-0 grid-cols-[0fr] overflow-hidden transition-[grid-template-columns,margin-left,opacity,transform] group-hover/agent-inbox-row:ml-1.5 group-focus-visible/agent-inbox-row:ml-1.5 group-has-[:focus-visible]/agent-inbox-row:ml-1.5 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:ml-1.5 group-hover/agent-inbox-row:grid-cols-[1fr] group-focus-visible/agent-inbox-row:grid-cols-[1fr] group-has-[:focus-visible]/agent-inbox-row:grid-cols-[1fr] group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:grid-cols-[1fr]'
                : 'absolute right-0 top-1/2 -translate-y-1/2 transition-[opacity,transform]',
            !inFlow && (showLabel ? 'w-[4.75rem]' : 'w-[3.25rem]')
        )}>
            <div className="relative flex min-w-0 items-center gap-0.5 overflow-hidden">
                <button
                    type="button"
                    aria-label={item.pinned ? 'Unpin chat to settle' : isWorkingItem(item) ? 'Working chat stays in Priority' : action === 'settle' ? 'Settle chat' : 'Un-settle chat'}
                    title={item.pinned ? 'Unpin chat to settle' : isWorkingItem(item) ? 'Working chat stays in Priority' : undefined}
                    disabled={isPriorityItem(item)}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onAction(item)
                    }}
                    className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-sparkle-text-muted transition-colors enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-sparkle-text disabled:cursor-default disabled:opacity-35"
                >
                    {action === 'settle' ? <Check size={12} /> : <Undo2 size={12} />}
                    {showLabel ? <span>{action === 'settle' ? 'Settle' : 'Un-settle'}</span> : null}
                </button>
                <FileActionsMenu
                    items={menuItems}
                    title={`${getSessionDisplayTitle(item.session)} actions`}
                    triggerIcon={<MoreHorizontal size={14} />}
                    presentation="portal"
                    rootClassName="flex shrink-0 items-center"
                    density="compact"
                    buttonClassName="h-6 w-6 rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    openButtonClassName="rounded-md bg-[var(--surface-hover)] text-sparkle-text opacity-100"
                />
            </div>
        </div>
    )
}

function AgentInboxCard({ item, onSettle, props }: { item: SidebarItem; onSettle: (item: SidebarItem) => void; props: Props }) {
    const title = getSessionDisplayTitle(item.session)
    const model = resolveAssistantInboxModelPresentation(item.thread?.model)
    const receded = (item.status === 'ready' || item.status === 'working' || item.status === 'approval' || item.status === 'input') && !item.active
    const activate = () => void props.onSelectSession(item.session.id)
    const menuItems = getAgentInboxMenuItems(item, onSettle, props)
    return (
        <li data-agent-inbox-layout-id={item.session.id} className="list-none py-0.5">
            <div role="button" aria-current={item.active ? 'page' : undefined} tabIndex={0} onClick={activate} onDoubleClick={() => void props.onRename(item.session)} onContextMenu={(event) => props.onOpenContextMenu(event, item.session, menuItems)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }} className={cn('group/agent-inbox-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none', item.active ? 'bg-[var(--surface-active)] text-sparkle-text' : receded ? 'text-sparkle-text-muted/75 hover:bg-[var(--surface-hover)] hover:text-sparkle-text' : 'bg-transparent text-sparkle-text hover:bg-[var(--surface-hover)]', (item.status === 'working' || item.status === 'approval' || item.status === 'input') && !item.active && 'opacity-70 transition-opacity hover:opacity-100')} title={[title, item.projectPath, model.modelName, item.thread?.lastError].filter(Boolean).join('\n')}>
                <div className="relative z-10 h-[4.875rem] px-2.5 py-2">
                    <div className="flex h-5 min-w-0 items-center gap-1.5">
                        <ProjectMark group={item.project} />
                        <span className={cn('min-w-0 flex-1 truncate text-xs text-sparkle-text-secondary/85', receded ? 'font-normal' : 'font-medium')}>{item.project.label}</span>
                        <div className="relative ml-auto flex h-6 min-w-0 shrink-0 items-center justify-end gap-1 pl-1 text-xs">
                            <span className="shrink-0">
                                <span className="whitespace-nowrap tabular-nums text-sparkle-text-muted/65">{topStatus(item)}</span>
                            </span>
                            <InboxRowActions item={item} action="settle" onAction={onSettle} props={props} inFlow />
                        </div>
                    </div>
                    <div className="mt-1 flex min-w-0">
                        <AssistantSessionTitleText title={title} generating={item.session.titleGenerating === true} className={cn('min-w-0 flex-1 text-sm', receded ? 'font-normal text-sparkle-text-secondary/80' : 'font-medium text-sparkle-text')} />
                    </div>
                    <div className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-xs text-sparkle-text-muted/75">
                        {model.provider ? <span role="img" aria-label={`${model.provider} model provider`} className="inline-flex shrink-0"><SettingsProviderIcon provider={model.provider === 'anthropic' ? 'claude' : model.provider === 'google' ? 'gemini' : model.provider} size={13} /></span> : null}
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap">{model.modelName || 'Assistant'}</span>
                        {item.pinned ? <span aria-label="Pinned chat" title="Pinned chat" className="inline-flex shrink-0"><Pin size={12} /></span> : null}
                        {item.thread?.agentNickname || item.thread?.source === 'subagent' || item.tuiOpen || item.mobileDevices.length > 0 ? <span className="inline-flex shrink-0 items-center" data-assistant-presence-group>
                            <AssistantAgentPresenceIndicator thread={item.thread} />
                            {item.tuiOpen ? <AssistantTuiPresenceIndicator focusable={false} /> : null}
                            {item.mobileDevices.length > 0 ? <AssistantTuiPresenceIndicator focusable={false} mobileDevices={item.mobileDevices} /> : null}
                        </span> : null}
                    </div>
                </div>
            </div>
        </li>
    )
}

function AgentInboxSlimRow({ item, action, onAction, props }: { item: SidebarItem; action: 'settle' | 'unsettle'; onAction: (item: SidebarItem) => void; props: Props }) {
    const title = getSessionDisplayTitle(item.session)
    const activate = () => void props.onSelectSession(item.session.id)
    const menuItems = getAgentInboxMenuItems(item, onAction, props)
    return (
        <li data-agent-inbox-layout-id={item.session.id} className="list-none">
            <div role="button" aria-current={item.active ? 'page' : undefined} tabIndex={0} onClick={activate} onDoubleClick={() => void props.onRename(item.session)} onContextMenu={(event) => props.onOpenContextMenu(event, item.session, menuItems)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }} className={cn('group/agent-inbox-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left outline-none select-none', item.active ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-muted/70 hover:bg-[var(--surface-hover)] hover:text-sparkle-text')} title={title}>
                <ProjectMark group={item.project} dimmed={!item.active} />
                <AssistantSessionTitleText title={title} generating={item.session.titleGenerating === true} className={cn('min-w-0 flex-1 text-sm group-hover/agent-inbox-row:text-sparkle-text', item.active ? 'text-sparkle-text' : 'text-sparkle-text-muted/70')} />
                <div className="relative ml-auto flex h-6 min-w-0 shrink-0 items-center justify-end">
                    {item.status !== 'ready' ? <span className="mr-1 inline-flex shrink-0 text-sparkle-text-muted" title={item.status === 'done' ? 'New response' : item.status}>
                        {item.status === 'working' ? <CircleDashed size={13} /> : item.status === 'done' ? <CheckCircle2 size={13} /> : <span className="text-[10px]">{item.status}</span>}
                    </span> : null}
                    {item.thread?.agentNickname || item.thread?.source === 'subagent' || item.tuiOpen || item.mobileDevices.length > 0 ? (
                        <span className="mr-1.5 inline-flex shrink-0 items-center" data-assistant-presence-group>
                            <AssistantAgentPresenceIndicator thread={item.thread} />
                            {item.tuiOpen ? <AssistantTuiPresenceIndicator focusable={false} /> : null}
                            {item.mobileDevices.length > 0 ? <AssistantTuiPresenceIndicator focusable={false} mobileDevices={item.mobileDevices} /> : null}
                        </span>
                    ) : null}
                    <span className="max-w-20 shrink-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-150 ease-out group-hover/agent-inbox-row:max-w-0 group-focus-visible/agent-inbox-row:max-w-0 group-has-[:focus-visible]/agent-inbox-row:max-w-0 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:max-w-0 group-hover/agent-inbox-row:translate-x-1 group-focus-visible/agent-inbox-row:translate-x-1 group-has-[:focus-visible]/agent-inbox-row:translate-x-1 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:translate-x-1 group-hover/agent-inbox-row:opacity-0 group-focus-visible/agent-inbox-row:opacity-0 group-has-[:focus-visible]/agent-inbox-row:opacity-0 group-has-[[aria-haspopup=menu][aria-expanded=true]]/agent-inbox-row:opacity-0 motion-reduce:transition-none">
                        <span className="whitespace-nowrap text-xs tabular-nums text-sparkle-text-muted/55">{formatAssistantSidebarRelativeTime(item.activityAt)}</span>
                    </span>
                    <InboxRowActions item={item} action={action} onAction={onAction} props={props} inFlow />
                </div>
            </div>
        </li>
    )
}

export const AssistantAgentInboxSidebar = memo(function AssistantAgentInboxSidebar(props: Props) {
    const [scope, setScope] = useState(ALL_PROJECTS)
    const [projectMenuOpen, setProjectMenuOpen] = useState(false)
    const [projectSearch, setProjectSearch] = useState('')
    const [settledExpanded, setSettledExpanded] = useState(true)
    const [settledInitialCount, setSettledInitialCount] = useState(1)
    const [settledAdditionalCount, setSettledAdditionalCount] = useState(0)
    const [settlementOverrides, setSettlementOverrides] = useState<SettlementOverrides>(readSettlementOverrides)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const projectTriggerRef = useRef<HTMLButtonElement | null>(null)
    const projectSearchRef = useRef<HTMLInputElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const listRef = useRef<HTMLUListElement | null>(null)
    const settledHeaderRef = useRef<HTMLLIElement | null>(null)
    const previousLayoutRectsRef = useRef(new Map<string, { top: number; height: number }>())
    const layoutAnimationsRef = useRef(new Map<string, Animation>())

    const visibleSessions = useMemo(() => props.sessions.filter((session) => isAssistantUserFacingSession(session) && !session.archived && !isAssistantDraftSession(session)), [props.sessions])
    useEffect(() => {
        setSettlementOverrides(current => {
            const next = upgradeSidebarSettlementOverrides(current, visibleSessions)
            if (next !== current) writeSettlementOverrides(next)
            return next
        })
    }, [visibleSessions])
    const projectGroups = useMemo(() => groupSessionsByProject(visibleSessions, props.projectIconOverrides), [props.projectIconOverrides, visibleSessions])
    const projectQuery = projectSearch.trim().toLocaleLowerCase()
    const filteredProjectGroups = projectGroups.filter((group) => !projectQuery || [group.label, group.path].join(' ')
        .toLocaleLowerCase().includes(projectQuery))
    const projectByPath = useMemo(() => new Map(projectGroups.map((group) => [group.path, group])), [projectGroups])
    useEffect(() => { if (scope !== ALL_PROJECTS && !projectByPath.has(scope)) setScope(ALL_PROJECTS) }, [projectByPath, scope])
    useEffect(() => setSettledAdditionalCount(0), [scope])
    useEffect(() => {
        if (!projectMenuOpen) {
            setProjectSearch('')
            return
        }
        const close = (event: PointerEvent) => { if (!isOverlayEventInside(event, menuRef.current)) setProjectMenuOpen(false) }
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setProjectMenuOpen(false)
                projectTriggerRef.current?.focus()
            }
        }
        const removeOverlayListener1 = addOverlayEventListener('pointerdown', close)
        const removeOverlayListener2 = addOverlayEventListener('keydown', escape)
        return () => { removeOverlayListener1(); removeOverlayListener2() }
    }, [projectMenuOpen])

    const items = useMemo(() => visibleSessions
        .filter((session) => scope === ALL_PROJECTS || resolveSessionProjectPath(session) === scope)
        .map((session): SidebarItem => {
            const thread = getStatusThread(session)
            const active = session.id === props.activeSessionId
            const activityAt = getSessionLastActivityAt(session)
            const base = {
                session,
                thread,
                active,
                pinned: props.pinnedSessionIds?.has(session.id) === true,
                activityAt,
                tuiOpen: isAssistantSessionOpenInTui(session),
                mobileDevices: assistantSessionMobileDevices(session),
                projectPath: resolveSessionProjectPath(session),
                project: projectByPath.get(resolveSessionProjectPath(session))!
            }
            const status = session.threads.some((entry) => props.pendingControlThreadIds.has(entry.id))
                ? 'approval'
                : resolveRowStatus(thread, active && thread?.id === props.activeThreadId)
            const unsettled = { ...base, status }
            return { ...unsettled, settled: isEffectivelySettled(unsettled, settlementOverrides) }
        }), [props.activeSessionId, props.activeThreadId, props.pendingControlThreadIds, props.pinnedSessionIds, projectByPath, scope, settlementOverrides, visibleSessions])

    const desiredPriority = useMemo(() => items
        .filter((item) => !item.settled && isPriorityItem(item))
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || getSortableTimestamp(right.session.createdAt) - getSortableTimestamp(left.session.createdAt) || left.session.id.localeCompare(right.session.id)), [items])
    const desiredRecent = useMemo(() => items
        .filter((item) => !item.settled && !isPriorityItem(item))
        .sort((left, right) => getSortableTimestamp(right.activityAt) - getSortableTimestamp(left.activityAt) || left.session.id.localeCompare(right.session.id)), [items])
    const settledItems = useMemo(() => items.filter((item) => item.settled).sort((left, right) => getSortableTimestamp(right.activityAt) - getSortableTimestamp(left.activityAt) || left.session.id.localeCompare(right.session.id)), [items])
    const settledVisibleCount = settledInitialCount + settledAdditionalCount
    const visibleSettled = settledItems.slice(0, settledVisibleCount)
    const desiredSettled = settledExpanded ? visibleSettled : visibleSettled.filter((item) => item.active)
    const stableLayout = useStableSidebarGroups([desiredPriority, desiredRecent, desiredSettled])
    const [priorityItems, recentItems, renderedSettled] = stableLayout.groups
    // An explicit pin/unpin must move immediately, even while hover holds status-driven moves.
    useLayoutEffect(() => stableLayout.release(), [props.pinnedSessionIds, stableLayout.release])
    const hiddenSettledCount = settledItems.length - visibleSettled.length
    const scopedProject = scope === ALL_PROJECTS ? null : projectByPath.get(scope) || null
    const layoutKey = [
        priorityItems.map((item) => `${item.session.id}:card:${item.status}`).join(','),
        recentItems.map((item) => `${item.session.id}:recent`).join(','),
        renderedSettled.map((item) => `${item.session.id}:settled`).join(','),
        settledExpanded ? 'settled-open' : 'settled-closed'
    ].join('|')

    const measureSettledInitialWindow = useCallback(() => {
        const scroller = scrollRef.current
        const header = settledHeaderRef.current
        if (!scroller || !header) return
        const scrollerBounds = scroller.getBoundingClientRect()
        const headerBounds = header.getBoundingClientRect()
        const headerContentBottom = headerBounds.bottom - scrollerBounds.top + scroller.scrollTop
        const availableHeight = Math.max(0, scrollerBounds.height - headerContentBottom)
        const nextCount = resolveAssistantAgentInboxSettledInitialCount(availableHeight)
        setSettledInitialCount((current) => current === nextCount ? current : nextCount)
    }, [])

    useLayoutEffect(() => {
        measureSettledInitialWindow()
    }, [layoutKey, measureSettledInitialWindow, settledItems.length])

    useEffect(() => {
        const scroller = scrollRef.current
        if (!scroller || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measureSettledInitialWindow)
        observer.observe(scroller)
        return () => observer.disconnect()
    }, [measureSettledInitialWindow])

    useLayoutEffect(() => {
        const list = listRef.current
        if (!list) return

        const listBounds = list.getBoundingClientRect()
        const previousRects = previousLayoutRectsRef.current
        const nextRects = new Map<string, { top: number; height: number }>()
        const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-agent-inbox-layout-id]'))
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        for (const row of rows) {
            const id = row.dataset.agentInboxLayoutId
            if (!id) continue
            layoutAnimationsRef.current.get(id)?.cancel()

            const bounds = row.getBoundingClientRect()
            const current = { top: bounds.top - listBounds.top, height: bounds.height }
            nextRects.set(id, current)
            const previous = previousRects.get(id)
            if (reducedMotion) continue
            if (!previous) {
                if (previousRects.size === 0) continue
                const enteringAnimation = row.animate([
                    {
                        transform: 'translate3d(0, 6px, 0)',
                        opacity: 0.85
                    },
                    {
                        transform: 'translate3d(0, 0, 0)',
                        opacity: 1
                    }
                ], {
                    duration: 240,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    fill: 'both'
                })
                layoutAnimationsRef.current.set(id, enteringAnimation)
                enteringAnimation.addEventListener('finish', () => {
                    if (layoutAnimationsRef.current.get(id) !== enteringAnimation) return
                    enteringAnimation.cancel()
                    layoutAnimationsRef.current.delete(id)
                }, { once: true })
                continue
            }

            const deltaY = previous.top - current.top
            const revealHeight = Math.max(0, current.height - previous.height)
            if (Math.abs(deltaY) < 0.5 && revealHeight < 0.5) continue

            const animation = row.animate([
                {
                    transform: `translate3d(0, ${deltaY}px, 0)`,
                    opacity: 0.9
                },
                {
                    transform: 'translate3d(0, 0, 0)',
                    opacity: 1
                }
            ], {
                duration: 280,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both'
            })
            layoutAnimationsRef.current.set(id, animation)
            animation.addEventListener('finish', () => {
                if (layoutAnimationsRef.current.get(id) !== animation) return
                animation.cancel()
                layoutAnimationsRef.current.delete(id)
            }, { once: true })
        }

        previousLayoutRectsRef.current = nextRects
    }, [layoutKey])

    useEffect(() => () => {
        for (const animation of layoutAnimationsRef.current.values()) animation.cancel()
        layoutAnimationsRef.current.clear()
    }, [])

    const setSettlement = (item: SidebarItem, state: SettlementOverride['state']) => {
        if (item.pinned) return
        stableLayout.release()
        setSettlementOverrides((current) => {
            const next = { ...current, [item.session.id]: { state, activityAt: item.activityAt, activityKey: getSidebarSettlementActivityKey(item.session) } }
            writeSettlementOverrides(next)
            return next
        })
    }

    return (
        <>
            <div className="shrink-0 space-y-0.5 pb-3">
            {props.headerActions}
            {projectGroups.length > 0 ? (
                <div ref={menuRef} className="relative mx-0.5">
                    <button ref={projectTriggerRef} type="button" aria-label="Filter chats by project" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((open) => !open)} className="flex h-7 w-full min-w-0 items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] leading-none text-sparkle-text-secondary outline-none hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35">{scopedProject ? <ProjectMark group={scopedProject} /> : <Folder size={16} className="shrink-0 text-sparkle-text-muted/80" />}<span className="min-w-0 flex-1 truncate">{scopedProject?.label || 'All projects'}</span><ChevronDown size={16} className="shrink-0 text-sparkle-text-muted/70" /></button>
                    {projectMenuOpen ? (
                        <AnchoredNativeOverlay><div className="absolute left-0 right-0 top-[34px] z-50 flex max-h-72 flex-col overflow-hidden rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 shadow-[0_16px_48px_rgba(0,0,0,0.34)]">
                            <div className="mb-1 flex h-9 shrink-0 items-center gap-2 border-b border-[var(--surface-divider)] px-2 text-sparkle-text-muted">
                                <Search size={14} className="shrink-0 opacity-70" aria-hidden="true" />
                                <input
                                    ref={projectSearchRef}
                                    autoFocus
                                    type="text"
                                    role="searchbox"
                                    aria-label="Search projects"
                                    placeholder="Search projects…"
                                    value={projectSearch}
                                    onChange={(event) => setProjectSearch(event.target.value)}
                                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-sparkle-text outline-none placeholder:text-sparkle-text-muted/60"
                                />
                                {projectSearch ? (
                                    <button type="button" aria-label="Clear project search" onClick={() => { setProjectSearch(''); projectSearchRef.current?.focus() }} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35">
                                        <X size={12} />
                                    </button>
                                ) : null}
                            </div>
                            <div className="assistant-chat-scrollbar min-h-0 overflow-y-auto">
                                <button type="button" onClick={() => { setScope(ALL_PROJECTS); setProjectMenuOpen(false) }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text"><Folder size={16} /><span className="min-w-0 flex-1 truncate">All projects</span>{scope === ALL_PROJECTS ? <Check size={13} /> : null}</button>
                                {filteredProjectGroups.map((group) => <button key={group.key} type="button" onClick={() => { setScope(group.path); setProjectMenuOpen(false) }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text"><ProjectMark group={group} /><span className="min-w-0 flex-1 truncate">{group.label}</span>{scope === group.path ? <Check size={13} /> : null}</button>)}
                                {filteredProjectGroups.length === 0 ? <p role="status" className="px-2 py-3 text-center text-xs text-sparkle-text-muted/70">No projects found</p> : null}
                            </div>
                        </div></AnchoredNativeOverlay>
                    ) : null}
                </div>
            ) : null}
            </div>
            <div ref={scrollRef} onPointerEnter={stableLayout.hold} onPointerLeave={stableLayout.release}
                onFocusCapture={stableLayout.hold} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) stableLayout.release() }}
                className="assistant-chat-scrollbar assistant-sidebar-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden pr-0.5">
                <ul ref={listRef} role="list" className="flex flex-col gap-px">
                    {priorityItems.length > 0 ? (
                        <li className="list-none">
                            <div className="mb-1 flex w-full items-center gap-2 px-2.5 text-left">
                                <span className="text-xs font-medium text-sparkle-text-muted/50">Priority</span>
                                <span className="h-px flex-1 bg-[var(--surface-divider)]/60" />
                            </div>
                        </li>
                    ) : null}
                    {priorityItems.map((item) => <AgentInboxCard key={`${item.session.id}:card`} item={item} onSettle={(target) => setSettlement(target, 'settled')} props={props} />)}
                    {recentItems.length > 0 ? (
                        <li className="list-none">
                            <div className="mb-1 mt-3 flex w-full items-center gap-2 px-2.5 text-left">
                                <span className="text-xs font-medium text-sparkle-text-muted/50">Recent</span>
                                <span className="h-px flex-1 bg-[var(--surface-divider)]/60" />
                            </div>
                        </li>
                    ) : null}
                    {recentItems.map((item) => <AgentInboxCard key={`${item.session.id}:recent`} item={item} onSettle={(target) => setSettlement(target, 'settled')} props={props} />)}
                    {settledItems.length > 0 ? <li ref={settledHeaderRef} className="list-none"><button type="button" onClick={() => setSettledExpanded((expanded) => !expanded)} aria-expanded={settledExpanded} className="mb-1 mt-3 flex w-full items-center gap-2 px-2.5 text-left"><span className="text-xs font-medium text-sparkle-text-muted/50">{settledExpanded ? 'Settled' : `Settled (${settledItems.length})`}</span><span className="h-px flex-1 bg-[var(--surface-divider)]/60" /><ChevronDown size={12} className={cn('text-sparkle-text-muted/50 transition-transform', settledExpanded && 'rotate-180')} /></button></li> : null}
                    {renderedSettled.map((item) => <AgentInboxSlimRow key={`${item.session.id}:settled`} item={item} action="unsettle" onAction={(target) => setSettlement(target, 'active')} props={props} />)}
                    {settledExpanded && hiddenSettledCount > 0 ? <li className="list-none"><button type="button" onClick={() => setSettledAdditionalCount((count) => count + SETTLED_PAGE_COUNT)} className="mt-1 flex h-[30px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--surface-divider)] font-mono text-[11px] text-sparkle-text-muted transition-colors hover:border-solid hover:bg-[var(--surface-hover)] hover:text-sparkle-text">See {Math.min(hiddenSettledCount, SETTLED_PAGE_COUNT)} more</button></li> : null}
                </ul>
                {items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-sparkle-text-muted/60">
                        <span>{scopedProject ? `No chats in ${scopedProject.label} yet` : projectGroups.length === 0 ? 'No projects yet' : 'No chats yet'}</span>
                        {projectGroups.length === 0 ? <button type="button" onClick={() => void props.onCreateProjectChat()} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--surface-divider)] px-2.5 py-1 text-[11px] font-medium text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"><FolderPlus size={12} />Add project</button> : null}
                    </div>
                ) : null}
            </div>
        </>
    )
})
