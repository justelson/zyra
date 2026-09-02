import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Bot, Check, Copy, FolderGit2, PanelRight, Pencil, RefreshCw, X } from 'lucide-react'
import type { AssistantModelInfo, AssistantRuntimeMode, FleetSnapshot } from '@shared/assistant/contracts'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { formatAssistantModelLabel } from './assistant-model-labels'
import {
    readAssistantComposerSessionState,
    subscribeAssistantComposerSessionState,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'
import { SIDEBAR_EFFORT_LABELS } from './useAssistantPageSidebarState'
import { getProfileLabel } from './assistant-composer-controller-constants'
import { useAssistantSessionTurnUsage } from './useAssistantSessionTurnUsage'
import { resolveAssistantThreadDetailsNowState, selectAssistantThreadControl, summarizeAssistantThreadUsage } from './assistant-thread-details'
import { AssistantThreadDetailsContext } from './AssistantThreadDetailsContext'
import { AssistantThreadDetailsComputerUse } from './AssistantThreadDetailsComputerUse'
import { AssistantSessionTitleText } from './AssistantSessionTitleText'

type ThreadDetailsSelection = {
    sessionId: string | null
    sessionTitle: string
    titleGenerating: boolean
    commandPending: boolean
    threadId: string | null
    threadState: string
    threadModel: string
    threadEffort: string | null
    runtimeMode: AssistantRuntimeMode
    profile: string | null
    latestTurnId: string | null
    latestTurnState: string | null
    latestTurnEffort: string | null
    latestTurnServiceTier: 'fast' | 'flex' | null
    latestTurnCompletedAt: string | null
    latestActivitySummary: string | null
    lastError: string | null
    pendingApprovals: number
    pendingInputs: number
    knownModels: AssistantModelInfo[]
    projectPath: string
}

const EMPTY_SELECTION: ThreadDetailsSelection = {
    sessionId: null,
    sessionTitle: 'Thread',
    titleGenerating: false,
    commandPending: false,
    threadId: null,
    threadState: 'idle',
    threadModel: '',
    threadEffort: null,
    runtimeMode: 'approval-required',
    profile: null,
    latestTurnId: null,
    latestTurnState: null,
    latestTurnEffort: null,
    latestTurnServiceTier: null,
    latestTurnCompletedAt: null,
    latestActivitySummary: null,
    lastError: null,
    pendingApprovals: 0,
    pendingInputs: 0,
    knownModels: [],
    projectPath: ''
}

function areSelectionsEqual(left: ThreadDetailsSelection, right: ThreadDetailsSelection): boolean {
    return left.sessionId === right.sessionId
        && left.sessionTitle === right.sessionTitle
        && left.titleGenerating === right.titleGenerating
        && left.commandPending === right.commandPending
        && left.threadId === right.threadId
        && left.threadState === right.threadState
        && left.threadModel === right.threadModel
        && left.threadEffort === right.threadEffort
        && left.runtimeMode === right.runtimeMode
        && left.profile === right.profile
        && left.latestTurnId === right.latestTurnId
        && left.latestTurnState === right.latestTurnState
        && left.latestTurnEffort === right.latestTurnEffort
        && left.latestTurnServiceTier === right.latestTurnServiceTier
        && left.latestTurnCompletedAt === right.latestTurnCompletedAt
        && left.latestActivitySummary === right.latestActivitySummary
        && left.lastError === right.lastError
        && left.pendingApprovals === right.pendingApprovals
        && left.pendingInputs === right.pendingInputs
        && left.projectPath === right.projectPath
        && left.knownModels === right.knownModels
}

function compactPath(value: string): string {
    return String(value || '')
        .replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
        .replace(/\\/g, '/')
}

function runningAgentCount(snapshot: FleetSnapshot | null | undefined): number {
    return Object.values(snapshot?.agents || {}).filter((run) => (
        ['queued', 'starting', 'running', 'waiting', 'blocked', 'recovering'].includes(run.status)
    )).length
}

export function AssistantThreadDetailsWorkspace({
    active,
    sessionId,
    threadId,
    projectPath,
    fleetSnapshot,
    controlState
}: {
    active: boolean
    sessionId: string | null
    threadId: string | null
    projectPath: string | null
    fleetSnapshot: FleetSnapshot | null
    controlState: ControlStateSnapshot | null
}) {
    const selection = useAssistantStoreSelector<ThreadDetailsSelection>((state) => {
        const session = state.snapshot.sessions.find((entry) => entry.id === sessionId)
            || state.snapshot.sessions.find((entry) => entry.id === state.snapshot.selectedSessionId)
            || null
        const thread = session?.threads.find((entry) => entry.id === threadId)
            || session?.threads.find((entry) => entry.id === session.activeThreadId)
            || null
        if (!session || !thread) return { ...EMPTY_SELECTION, knownModels: state.snapshot.knownModels }
        const latestActivity = [...thread.activities].reverse().find((activity) => activity.summary?.trim()) || null
        return {
            sessionId: session.id,
            sessionTitle: session.title || 'Untitled thread',
            titleGenerating: session.titleGenerating === true,
            commandPending: state.commandPending,
            threadId: thread.id,
            threadState: thread.state,
            threadModel: thread.model,
            threadEffort: thread.thinking || null,
            runtimeMode: thread.runtimeMode,
            profile: thread.profile || null,
            latestTurnId: thread.latestTurn?.id || null,
            latestTurnState: thread.latestTurn?.state || null,
            latestTurnEffort: thread.latestTurn?.effort || null,
            latestTurnServiceTier: thread.latestTurn?.serviceTier || null,
            latestTurnCompletedAt: thread.latestTurn?.completedAt || null,
            latestActivitySummary: latestActivity?.summary || null,
            lastError: thread.lastError,
            pendingApprovals: thread.pendingApprovals.filter((request) => request.status === 'pending').length,
            pendingInputs: thread.pendingUserInputs.filter((request) => request.status === 'pending').length,
            knownModels: state.snapshot.knownModels,
            projectPath: projectPath || session.projectPath || thread.cwd || ''
        }
    }, areSelectionsEqual)
    const { settings } = useSettings()
    const actions = useAssistantStoreActions()
    const [branch, setBranch] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleDraft, setTitleDraft] = useState('')
    const [titleError, setTitleError] = useState<string | null>(null)
    const [pathCopied, setPathCopied] = useState(false)
    const [composerState, setComposerState] = useState<AssistantComposerSessionState>(() => readAssistantComposerSessionState(selection.sessionId))
    const { sessionTurnUsage, sessionTurnUsageLoading } = useAssistantSessionTurnUsage({
        sessionId: selection.sessionId,
        enabled: active,
        refreshKey: `${selection.latestTurnId || ''}:${selection.latestTurnState || ''}:${selection.latestTurnCompletedAt || ''}`
    })
    const usage = useMemo(() => summarizeAssistantThreadUsage(
        sessionTurnUsage?.turns || [],
        selection.threadId,
        selection.knownModels,
        sessionTurnUsage?.totals || null,
        settings.assistantContextCompactionThresholdTokens
    ), [selection.knownModels, selection.threadId, sessionTurnUsage?.totals, sessionTurnUsage?.turns, settings.assistantContextCompactionThresholdTokens])
    const threadControl = useMemo(
        () => selectAssistantThreadControl(controlState, selection.threadId),
        [controlState, selection.threadId]
    )
    const currentPendingGrant = threadControl.pendingGrants[0] || null
    const activeAgents = runningAgentCount(fleetSnapshot)

    useEffect(() => {
        setComposerState(readAssistantComposerSessionState(selection.sessionId))
        setEditingTitle(false)
        setTitleDraft(selection.sessionTitle)
        setTitleError(null)
    }, [selection.sessionId])

    useEffect(() => {
        if (!editingTitle) setTitleDraft(selection.sessionTitle)
    }, [editingTitle, selection.sessionTitle])

    useEffect(() => subscribeAssistantComposerSessionState((updatedSessionId, nextState) => {
        if (updatedSessionId === selection.sessionId) setComposerState(nextState)
    }), [selection.sessionId])

    useEffect(() => {
        const selectedPath = selection.projectPath.trim()
        if (!active || !selectedPath) {
            setBranch(null)
            return
        }
        let cancelled = false
        void window.devscope.listBranches(selectedPath).then((result) => {
            if (!cancelled) setBranch(result?.success ? result.branches?.find((entry) => entry.current)?.name || null : null)
        }).catch(() => { if (!cancelled) setBranch(null) })
        return () => { cancelled = true }
    }, [active, selection.projectPath])

    const copyProjectPath = useCallback(async () => {
        if (!selection.projectPath) return
        await window.devscope.copyToClipboard(selection.projectPath)
        setPathCopied(true)
        window.setTimeout(() => setPathCopied(false), 1_500)
    }, [selection.projectPath])

    const submitTitleRename = useCallback(async () => {
        if (!selection.sessionId || selection.commandPending) return
        const title = titleDraft.replace(/\s+/g, ' ').trim().slice(0, 60)
        if (!title) return
        setTitleError(null)
        if (title !== selection.sessionTitle) {
            const result = await actions.renameSessionResult(selection.sessionId, title)
            if (!result.success) {
                setTitleError(result.error || 'Could not rename this thread.')
                return
            }
        }
        setEditingTitle(false)
    }, [actions, selection.commandPending, selection.sessionId, selection.sessionTitle, titleDraft])

    const regenerateTitle = useCallback(async () => {
        if (!selection.sessionId || selection.commandPending || selection.titleGenerating) return
        setTitleError(null)
        const result = await actions.regenerateSessionTitleResult(selection.sessionId)
        if (!result.success) setTitleError(result.error || 'Could not refresh this title.')
    }, [actions, selection.commandPending, selection.sessionId, selection.titleGenerating])

    const nowState = resolveAssistantThreadDetailsNowState({
        threadState: selection.threadState,
        latestTurnState: selection.latestTurnState,
        latestTurnCompletedAt: selection.latestTurnCompletedAt,
        latestActivitySummary: selection.latestActivitySummary,
        lastError: selection.lastError,
        pendingApprovals: selection.pendingApprovals + (currentPendingGrant ? 1 : 0),
        pendingInputs: selection.pendingInputs,
        activeAgents
    })
    const model = formatAssistantModelLabel(composerState.model || selection.threadModel || 'No model')
    const effort = SIDEBAR_EFFORT_LABELS[(composerState.effort || selection.latestTurnEffort || selection.threadEffort || 'high') as keyof typeof SIDEBAR_EFFORT_LABELS] || 'High'
    const speed = composerState.fastModeEnabled || selection.latestTurnServiceTier === 'fast' ? 'Fast' : selection.latestTurnServiceTier === 'flex' ? 'Flex' : 'Standard'
    const titleActionDisabled = selection.commandPending
        || selection.titleGenerating
        || ['starting', 'running', 'waiting'].includes(selection.threadState)
        || selection.latestTurnState === 'running'
    return (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Thread Details" data-testid="assistant-thread-details-workspace">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3">
                <PanelRight size={13} className="text-[var(--accent-primary)]/75" />
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    {editingTitle ? (
                        <input
                            autoFocus
                            value={titleDraft}
                            maxLength={60}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') { event.preventDefault(); void submitTitleRename() }
                                if (event.key === 'Escape') { setEditingTitle(false); setTitleDraft(selection.sessionTitle) }
                            }}
                            className="h-6 min-w-0 flex-1 border-b border-[var(--accent-primary)]/45 bg-transparent px-0.5 text-[11px] font-semibold text-sparkle-text outline-none"
                            aria-label="Thread title"
                        />
                    ) : (
                        <h2 className="min-w-0 flex-1 text-[11px] font-semibold text-sparkle-text" title={selection.sessionTitle}>
                            <AssistantSessionTitleText title={selection.sessionTitle} generating={selection.titleGenerating} />
                        </h2>
                    )}
                    {editingTitle ? (
                        <>
                            <button type="button" onClick={() => void submitTitleRename()} disabled={!titleDraft.trim() || selection.commandPending} className="inline-flex size-5 shrink-0 items-center justify-center text-emerald-300/70 hover:text-emerald-200 disabled:opacity-30" title="Save title" aria-label="Save title"><Check size={10} /></button>
                            <button type="button" onClick={() => { setEditingTitle(false); setTitleDraft(selection.sessionTitle) }} className="inline-flex size-5 shrink-0 items-center justify-center text-sparkle-text-muted/55 hover:text-sparkle-text" title="Cancel rename" aria-label="Cancel rename"><X size={10} /></button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={() => { setEditingTitle(true); setTitleDraft(selection.sessionTitle); setTitleError(null) }} disabled={selection.commandPending || selection.titleGenerating} className="inline-flex size-5 shrink-0 items-center justify-center text-sparkle-text-muted/45 opacity-70 transition-colors hover:text-sparkle-text disabled:opacity-25" title="Rename title" aria-label="Rename title"><Pencil size={9} /></button>
                            <button type="button" onClick={() => void regenerateTitle()} disabled={titleActionDisabled} className="inline-flex size-5 shrink-0 items-center justify-center text-sparkle-text-muted/45 opacity-70 transition-colors hover:text-sparkle-text disabled:opacity-25" title={titleActionDisabled && !selection.titleGenerating ? 'Available after the current turn finishes' : 'Regenerate title'} aria-label="Regenerate title"><RefreshCw size={10} className={selection.titleGenerating ? 'animate-spin motion-reduce:animate-none' : ''} /></button>
                        </>
                    )}
                </div>
                <span className={cn(
                    'size-1.5 rounded-full',
                    nowState.tone === 'active' && 'bg-[var(--accent-primary)] motion-safe:animate-pulse',
                    nowState.tone === 'ready' && 'bg-emerald-400',
                    nowState.tone === 'warning' && 'bg-amber-400',
                    nowState.tone === 'error' && 'bg-red-400',
                    nowState.tone === 'muted' && 'bg-white/20'
                )} />
                <span className="text-[9px] font-medium text-sparkle-text-muted/65">{nowState.label}</span>
            </header>
            {titleError ? <div className="shrink-0 border-b border-red-300/10 bg-red-400/[0.035] px-3 py-1.5 text-[8px] text-red-200/70" role="alert">{titleError}</div> : null}

            <div data-assistant-capsule-scroll="thread-details" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[1080px] px-3 py-3.5">
                    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-3.5" aria-label="Current thread status">
                        <div className="flex min-w-[220px] flex-1 items-start gap-2.5">
                            <Activity size={12} className={cn(
                                'mt-0.5 shrink-0',
                                nowState.tone === 'warning' ? 'text-amber-300/75' : nowState.tone === 'error' ? 'text-red-300/75' : 'text-[var(--accent-primary)]/75'
                            )} />
                            <div className="min-w-0">
                                <p className="line-clamp-2 text-[10px] leading-4 text-sparkle-text-muted/65">{nowState.detail}</p>
                                {activeAgents > 0 ? <p className="mt-1 inline-flex items-center gap-1.5 text-[9px] text-violet-200/65"><Bot size={10} />{activeAgents} active agent{activeAgents === 1 ? '' : 's'}</p> : null}
                            </div>
                        </div>
                        {selection.projectPath ? (
                            <button
                                type="button"
                                onClick={() => void copyProjectPath()}
                                className="group flex min-w-0 max-w-full items-center gap-2 text-[9px] text-sparkle-text-muted/55 hover:text-sparkle-text-secondary"
                                title={`Copy ${selection.projectPath}`}
                            >
                                <FolderGit2 size={11} className="shrink-0" />
                                <span className="min-w-0 truncate font-mono">{compactPath(selection.projectPath)}{branch ? ` (${branch})` : ''}</span>
                                <span className="inline-flex size-4 shrink-0 items-center justify-center">{pathCopied ? <Check size={10} className="text-emerald-300" /> : <Copy size={10} className="opacity-55 transition-opacity group-hover:opacity-100" />}</span>
                            </button>
                        ) : <span className="text-[9px] text-sparkle-text-muted/40">Chat-only thread</span>}
                    </section>

                    <div className="grid items-start gap-x-6 gap-y-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
                        <AssistantThreadDetailsContext
                            usage={usage}
                            loading={sessionTurnUsageLoading}
                        />

                        <section className="border-t border-white/[0.06] pt-3.5" aria-labelledby="thread-setup-heading">
                            <h3 id="thread-setup-heading" className="text-[10px] font-semibold text-sparkle-text-secondary">Setup</h3>
                            <div className="mt-1.5 divide-y divide-white/[0.045]">
                                <DetailRow label="Model" value={model} />
                                <DetailRow label="Thinking" value={effort} />
                                <DetailRow label="Speed" value={speed} />
                                <DetailRow label="Access" value={getProfileLabel(selection.runtimeMode)} />
                                {selection.profile ? <DetailRow label="Profile" value={selection.profile} /> : null}
                            </div>
                        </section>

                        <AssistantThreadDetailsComputerUse
                            className="mt-0 pt-3.5"
                            controlState={controlState}
                            threadControl={threadControl}
                        />
                    </div>
                </div>
            </div>
            {!active ? <span className="sr-only">Thread Details retained while inactive</span> : null}
        </section>
    )
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 text-[9px]">
            <span className="text-sparkle-text-muted/50">{label}</span>
            <span className="min-w-0 truncate text-right font-medium text-sparkle-text-secondary/80">{value}</span>
        </div>
    )
}

// Retained for imports from older Desktop bundles while the user-facing surface is Thread Details.
export const AssistantControlWorkspace = AssistantThreadDetailsWorkspace
