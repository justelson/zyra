import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Eraser,
    FolderX,
    Plus,
    RefreshCw,
    RotateCcw,
    SquareSplitHorizontal,
    SquareSplitVertical,
    SquareTerminal,
    Trash2,
    X
} from 'lucide-react'
import type {
    DevScopePreviewTerminalSessionSummary,
    DevScopePreviewTerminalWorkspaceOwner
} from '@shared/contracts/devscope-api'
import type { ITheme } from 'xterm'
import type { Shell } from '@/lib/settings'
import { getAppearanceCodeFontStack, useSettings } from '@/lib/settings'
import { createPreviewTerminalSessionId, readCssVariable } from '@/components/ui/file-preview/modalShared'
import { cn } from '@/lib/utils'
import { useThemeRevision } from '@/lib/use-theme-revision'
import { AssistantTerminalViewport } from './AssistantTerminalViewport'
import {
    activateAssistantTerminalSession,
    addAssistantTerminalSession,
    ASSISTANT_TERMINALS_PER_GROUP_LIMIT,
    createEmptyAssistantTerminalWorkspaceState,
    loadAssistantTerminalWorkspaceState,
    persistAssistantTerminalWorkspaceState,
    reconcileAssistantTerminalWorkspaceState,
    removeAssistantTerminalSession,
    type AssistantTerminalSplitDirection,
    type AssistantTerminalWorkspaceState
} from './assistant-terminal-workspace-state'

type TerminalSessionItem = DevScopePreviewTerminalSessionSummary & {
    hasUnreadOutput?: boolean
}

const MAX_TERMINAL_BUFFER_CHARS = 60_000

function shellPreferenceFromSession(session: DevScopePreviewTerminalSessionSummary | null, fallback: Shell): Shell {
    if (/cmd(?:\.exe)?$/i.test(String(session?.shell || ''))) return 'cmd'
    return fallback
}

function terminalStatusClass(status: DevScopePreviewTerminalSessionSummary['status']): string {
    if (status === 'running') return 'bg-emerald-300'
    if (status === 'error') return 'bg-red-300'
    return 'bg-amber-300'
}

function projectLabel(projectPath: string): string {
    return projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || projectPath
}

export const AssistantTerminalWorkspace = memo(function AssistantTerminalWorkspace({
    workspaceKey,
    projectPath,
    active,
    terminalOwner,
    onReady
}: {
    workspaceKey: string
    projectPath: string | null
    active: boolean
    terminalOwner?: DevScopePreviewTerminalWorkspaceOwner
    onReady?: () => void
}) {
    const { settings } = useSettings()
    const themeRevision = useThemeRevision()
    const normalizedProjectPath = String(projectPath || '').trim()
    const [sessions, setSessions] = useState<TerminalSessionItem[]>([])
    const [uiState, setUiState] = useState<AssistantTerminalWorkspaceState>(() => (
        loadAssistantTerminalWorkspaceState(workspaceKey)
    ))
    const [newShell, setNewShell] = useState<Shell>(settings.defaultShell)
    const [loading, setLoading] = useState(Boolean(normalizedProjectPath))
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [focusRequestId, setFocusRequestId] = useState(0)
    const [workspaceCapability, setWorkspaceCapability] = useState<string | null | undefined>(
        terminalOwner ? undefined : null
    )
    const sessionsRef = useRef(sessions)
    const uiStateRef = useRef(uiState)
    const outputBuffersRef = useRef(new Map<string, string>())
    const creatingRef = useRef(false)
    const mountedRef = useRef(true)
    const onReadyRef = useRef(onReady)
    const terminalOwnerKind = terminalOwner?.kind || null
    const terminalOwnerIdentity = terminalOwner?.kind === 'utility-tab'
        ? terminalOwner.tabId
        : terminalOwner?.runtimeId || null

    sessionsRef.current = sessions
    onReadyRef.current = onReady

    useEffect(() => {
        if (!loading && !creating && !error) onReadyRef.current?.()
    }, [creating, error, loading])
    uiStateRef.current = uiState

    useEffect(() => {
        if (!terminalOwnerKind || !terminalOwnerIdentity) {
            setWorkspaceCapability(null)
            return
        }
        let cancelled = false
        let registeredCapability: string | null = null
        setWorkspaceCapability(undefined)
        setError(null)
        const owner: DevScopePreviewTerminalWorkspaceOwner = terminalOwnerKind === 'utility-tab'
            ? { kind: 'utility-tab', tabId: terminalOwnerIdentity }
            : { kind: 'main-workspace', runtimeId: terminalOwnerIdentity }
        void window.devscope.registerPreviewTerminalWorkspace(owner).then((result) => {
            if (!result.success) {
                if (!cancelled) setError(result.error || 'Failed to authorize terminal workspace.')
                return
            }
            registeredCapability = result.workspaceCapability
            if (cancelled) {
                void window.devscope.releasePreviewTerminalWorkspace(result.workspaceCapability)
                return
            }
            setWorkspaceCapability(result.workspaceCapability)
        }).catch((registrationError: unknown) => {
            if (!cancelled) setError(registrationError instanceof Error ? registrationError.message : 'Failed to authorize terminal workspace.')
        })
        return () => {
            cancelled = true
            if (registeredCapability) void window.devscope.releasePreviewTerminalWorkspace(registeredCapability)
        }
    }, [terminalOwnerIdentity, terminalOwnerKind])

    const terminalTheme = useMemo<ITheme>(() => {
        const accent = readCssVariable('--accent-primary', settings.accentColor.primary || '#38bdf8')
        const card = readCssVariable('--color-card', '#0b1220')
        const bg = readCssVariable('--color-bg', '#020617')
        const text = readCssVariable('--color-text', '#e5e7eb')
        const muted = readCssVariable('--color-text-secondary', '#94a3b8')
        const danger = readCssVariable('--status-danger', '#f87171')
        const warning = readCssVariable('--status-warning', '#facc15')
        const success = readCssVariable('--status-success', '#4ade80')
        const info = readCssVariable('--status-info', '#60a5fa')
        const secondary = readCssVariable('--color-secondary', '#c084fc')
        const accentSecondary = readCssVariable('--accent-secondary', '#22d3ee')
        return {
            background: bg,
            foreground: text,
            cursor: accent,
            cursorAccent: card,
            selectionBackground: `${accent}33`,
            black: bg,
            brightBlack: muted,
            red: danger,
            brightRed: danger,
            green: success,
            brightGreen: success,
            yellow: warning,
            brightYellow: warning,
            blue: info,
            brightBlue: info,
            magenta: secondary,
            brightMagenta: secondary,
            cyan: accentSecondary,
            brightCyan: accentSecondary,
            white: muted,
            brightWhite: text
        }
    }, [settings.accentColor.primary, settings.theme, themeRevision])

    const commitUiState = useCallback((nextState: AssistantTerminalWorkspaceState) => {
        uiStateRef.current = nextState
        setUiState(nextState)
        persistAssistantTerminalWorkspaceState(workspaceKey, nextState)
    }, [workspaceKey])

    const refreshSessions = useCallback(async (preferredSessionId?: string) => {
        if (!normalizedProjectPath) return []
        const result = await window.devscope.listPreviewTerminalSessions({
            targetPath: normalizedProjectPath,
            workspaceCapability: workspaceCapability || undefined
        })
        if (!result.success) {
            if (mountedRef.current) setError(result.error || 'Failed to load terminal sessions.')
            return []
        }
        const nextSessions = (result.sessions || []) as TerminalSessionItem[]
        for (const session of nextSessions) {
            outputBuffersRef.current.set(session.sessionId, String(session.recentOutput || ''))
        }
        if (!mountedRef.current) return nextSessions
        setSessions((current) => {
            const unreadIds = new Set(current.filter((session) => session.hasUnreadOutput).map((session) => session.sessionId))
            return nextSessions.map((session) => ({
                ...session,
                hasUnreadOutput: unreadIds.has(session.sessionId)
                    && session.sessionId !== preferredSessionId
                    && session.sessionId !== uiStateRef.current.activeTerminalId
            }))
        })
        let reconciled = reconcileAssistantTerminalWorkspaceState(
            uiStateRef.current,
            nextSessions.map((session) => session.sessionId)
        )
        if (preferredSessionId) reconciled = activateAssistantTerminalSession(reconciled, preferredSessionId)
        commitUiState(reconciled)
        setError(null)
        return nextSessions
    }, [commitUiState, normalizedProjectPath, workspaceCapability])

    const createTerminal = useCallback(async (
        mode: 'new' | 'split' = 'new',
        splitDirection: AssistantTerminalSplitDirection = 'horizontal',
        preferredShell: Shell = newShell
    ) => {
        if (!normalizedProjectPath || creatingRef.current) return null
        const activeGroup = uiStateRef.current.groups.find((group) => group.id === uiStateRef.current.activeGroupId)
        if (mode === 'split' && activeGroup && activeGroup.terminalIds.length >= ASSISTANT_TERMINALS_PER_GROUP_LIMIT) return null

        creatingRef.current = true
        setCreating(true)
        setError(null)
        const terminalId = createPreviewTerminalSessionId()
        const previousState = uiStateRef.current
        const optimisticState = addAssistantTerminalSession(
            previousState,
            sessionsRef.current.map((session) => session.sessionId),
            terminalId,
            mode,
            splitDirection
        )
        commitUiState(optimisticState)

        try {
            const result = await window.devscope.createPreviewTerminal({
                sessionId: terminalId,
                targetPath: normalizedProjectPath,
                preferredShell,
                cols: 80,
                rows: 24,
                workspaceCapability: workspaceCapability || undefined
            })
            if (!result.success) {
                commitUiState(previousState)
                setError(result.error || 'Failed to create terminal.')
                return null
            }
            outputBuffersRef.current.set(terminalId, String(result.session.recentOutput || ''))
            await refreshSessions(terminalId)
            setFocusRequestId((requestId) => requestId + 1)
            return terminalId
        } catch (createError: unknown) {
            commitUiState(previousState)
            setError(createError instanceof Error ? createError.message : 'Failed to create terminal.')
            return null
        } finally {
            creatingRef.current = false
            if (mountedRef.current) setCreating(false)
        }
    }, [commitUiState, newShell, normalizedProjectPath, refreshSessions, workspaceCapability])

    useEffect(() => {
        mountedRef.current = true
        if (workspaceCapability === undefined) return
        if (!normalizedProjectPath) {
            setSessions([])
            commitUiState(createEmptyAssistantTerminalWorkspaceState())
            setLoading(false)
            return
        }
        let cancelled = false
        setLoading(true)
        void refreshSessions().then((knownSessions) => {
            if (cancelled) return
            if (knownSessions.length === 0) return createTerminal('new', 'horizontal', settings.defaultShell)
        }).catch((reason: unknown) => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : 'Failed to start terminal workspace.')
        }).finally(() => {
            if (!cancelled) setLoading(false)
        })
        return () => {
            cancelled = true
            mountedRef.current = false
        }
    }, [commitUiState, createTerminal, normalizedProjectPath, refreshSessions, settings.defaultShell, workspaceCapability])

    useEffect(() => {
        if (!normalizedProjectPath) return
        if (workspaceCapability === undefined) return
        const unsubscribe = window.devscope.onPreviewTerminalEvent((event) => {
            if (!event.sessionId) return
            if (event.type === 'output') {
                const outputChunk = String(event.data || '')
                outputBuffersRef.current.set(
                    event.sessionId,
                    `${outputBuffersRef.current.get(event.sessionId) || ''}${outputChunk}`.slice(-MAX_TERMINAL_BUFFER_CHARS)
                )
                setSessions((current) => {
                    const index = current.findIndex((session) => session.sessionId === event.sessionId)
                    if (index < 0) return current
                    const currentSession = current[index]
                    const hasUnreadOutput = !(active && uiStateRef.current.activeTerminalId === event.sessionId)
                    const nextTitle = event.title || currentSession.title
                    const nextStatus = event.status || currentSession.status
                    if (
                        currentSession.hasUnreadOutput === hasUnreadOutput
                        && currentSession.title === nextTitle
                        && currentSession.status === nextStatus
                    ) return current
                    const next = current.slice()
                    next[index] = {
                        ...currentSession,
                        title: nextTitle,
                        status: nextStatus,
                        cwd: event.cwd || currentSession.cwd,
                        shell: event.shell || currentSession.shell,
                        lastActivityAt: Date.now(),
                        hasUnreadOutput
                    }
                    return next
                })
                return
            }
            if (event.type === 'clear') {
                outputBuffersRef.current.set(event.sessionId, '')
                setSessions((current) => current.map((session) => session.sessionId === event.sessionId
                    ? { ...session, recentOutput: '', lastActivityAt: Date.now() }
                    : session))
                return
            }
            if (event.type === 'title') {
                setSessions((current) => current.map((session) => session.sessionId === event.sessionId
                    ? {
                        ...session,
                        title: event.title || session.title,
                        cwd: event.cwd || session.cwd,
                        shell: event.shell || session.shell,
                        status: event.status || session.status,
                        lastActivityAt: Date.now()
                    }
                    : session))
                return
            }
            if (event.type === 'error') {
                setError(event.message || 'Terminal session error.')
            }
            if (event.type === 'started' || event.type === 'exit' || event.type === 'error') {
                void refreshSessions(event.sessionId)
            }
        }, workspaceCapability || undefined)
        return () => unsubscribe()
    }, [active, normalizedProjectPath, refreshSessions, workspaceCapability])

    useEffect(() => {
        if (active) setFocusRequestId((requestId) => requestId + 1)
    }, [active])

    const activateTerminal = useCallback((terminalId: string) => {
        commitUiState(activateAssistantTerminalSession(uiStateRef.current, terminalId))
        setSessions((current) => current.map((session) => session.sessionId === terminalId
            ? { ...session, hasUnreadOutput: false }
            : session))
        setFocusRequestId((requestId) => requestId + 1)
    }, [commitUiState])

    const closeTerminal = useCallback(async (terminalId: string) => {
        await window.devscope.closePreviewTerminal({
            sessionId: terminalId,
            workspaceCapability: workspaceCapability || undefined
        }).catch(() => undefined)
        outputBuffersRef.current.delete(terminalId)
        commitUiState(removeAssistantTerminalSession(uiStateRef.current, terminalId))
        await refreshSessions()
    }, [commitUiState, refreshSessions, workspaceCapability])

    const clearTerminal = useCallback(async (terminalId: string) => {
        outputBuffersRef.current.set(terminalId, '')
        const result = await window.devscope.clearPreviewTerminal({
            sessionId: terminalId,
            workspaceCapability: workspaceCapability || undefined
        })
        if (!result.success) setError(result.error || 'Failed to clear terminal output.')
    }, [workspaceCapability])

    const restartTerminal = useCallback(async (session: TerminalSessionItem) => {
        setError(null)
        outputBuffersRef.current.set(session.sessionId, '')
        const result = await window.devscope.createPreviewTerminal({
            sessionId: session.sessionId,
            targetPath: normalizedProjectPath,
            preferredShell: shellPreferenceFromSession(session, newShell),
            cols: 80,
            rows: 24,
            title: session.title,
            workspaceCapability: workspaceCapability || undefined
        })
        if (!result.success) {
            setError(result.error || 'Failed to restart terminal.')
            return
        }
        await refreshSessions(session.sessionId)
        setFocusRequestId((requestId) => requestId + 1)
    }, [newShell, normalizedProjectPath, refreshSessions, workspaceCapability])

    if (!normalizedProjectPath) {
        return (
            <section className="flex min-h-0 flex-1 items-center justify-center px-6 text-center" aria-label="Terminal workspace">
                <div className="max-w-[250px]">
                    <span className="mx-auto inline-flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-sparkle-text-muted/55">
                        <FolderX size={18} />
                    </span>
                    <h3 className="mt-3 text-[12px] font-semibold text-sparkle-text-secondary">No project attached</h3>
                    <p className="mt-1 text-[10px] leading-4 text-sparkle-text-muted/65">Open a project chat to start a terminal in its workspace.</p>
                </div>
            </section>
        )
    }

    const activeSession = sessions.find((session) => session.sessionId === uiState.activeTerminalId) || sessions[0] || null
    const activeGroup = uiState.groups.find((group) => group.id === uiState.activeGroupId)
        || uiState.groups.find((group) => group.terminalIds.includes(activeSession?.sessionId || ''))
        || uiState.groups[0]
        || null
    const visibleSessions = (activeGroup?.terminalIds || [])
        .map((sessionId) => sessions.find((session) => session.sessionId === sessionId) || null)
        .filter(Boolean) as TerminalSessionItem[]
    const splitLimitReached = visibleSessions.length >= ASSISTANT_TERMINALS_PER_GROUP_LIMIT
    const showSessionRail = sessions.length > 1

    return (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--color-bg)_96%,black)]" aria-label="Terminal workspace">
            <header className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.07] bg-[color-mix(in_srgb,var(--color-bg)_94%,black)] px-1.5">
                <SquareTerminal size={12} className="shrink-0 text-[var(--accent-primary)]/80" />
                <span className="min-w-0 flex-1 truncate text-[9px] text-sparkle-text-muted/65" title={normalizedProjectPath}>
                    {projectLabel(normalizedProjectPath)}
                </span>
                <select
                    value={newShell}
                    onChange={(event) => setNewShell(event.target.value === 'cmd' ? 'cmd' : 'powershell')}
                    className="h-5 max-w-[88px] rounded border border-white/[0.08] bg-transparent px-1 text-[9px] text-sparkle-text-secondary outline-none hover:bg-white/[0.04]"
                    aria-label="Shell for new terminals"
                >
                    <option value="powershell">PowerShell</option>
                    <option value="cmd">CMD</option>
                </select>
                <button type="button" onClick={() => void createTerminal('new')} disabled={creating} className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text disabled:opacity-35" title="New terminal (Ctrl+Shift+`)"><Plus size={12} /></button>
                <button type="button" onClick={() => void createTerminal('split', 'horizontal')} disabled={creating || !activeSession || splitLimitReached} className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text disabled:opacity-30" title="Split horizontally (Ctrl+Shift+5)"><SquareSplitHorizontal size={12} /></button>
                <button type="button" onClick={() => void createTerminal('split', 'vertical')} disabled={creating || !activeSession || splitLimitReached} className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text disabled:opacity-30" title="Split vertically (Ctrl+Alt+5)"><SquareSplitVertical size={12} /></button>
                <button type="button" onClick={() => activeSession && void clearTerminal(activeSession.sessionId)} disabled={!activeSession} className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text disabled:opacity-30" title="Clear terminal"><Eraser size={11} /></button>
                <button type="button" onClick={() => activeSession && void restartTerminal(activeSession)} disabled={!activeSession} className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text disabled:opacity-30" title="Restart terminal"><RotateCcw size={11} /></button>
                <button type="button" onClick={() => activeSession && void closeTerminal(activeSession.sessionId)} disabled={!activeSession} className="inline-flex size-5 items-center justify-center rounded text-red-300/75 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-30" title="Close terminal (Ctrl+Shift+W)"><Trash2 size={11} /></button>
            </header>

            <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                    {visibleSessions.length > 0 ? (
                        <div
                            className="grid h-full min-h-0 w-full overflow-hidden"
                            style={activeGroup?.splitDirection === 'vertical'
                                ? { gridTemplateRows: `repeat(${visibleSessions.length}, minmax(0, 1fr))` }
                                : { gridTemplateColumns: `repeat(${visibleSessions.length}, minmax(0, 1fr))` }}
                        >
                            {visibleSessions.map((session, index) => {
                                const sessionActive = session.sessionId === activeSession?.sessionId
                                return (
                                    <div
                                        key={session.sessionId}
                                        className={cn(
                                            'relative min-h-0 min-w-0 p-1',
                                            index > 0 && (activeGroup?.splitDirection === 'vertical' ? 'border-t border-white/[0.08]' : 'border-l border-white/[0.08]'),
                                            sessionActive && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_30%,transparent)]'
                                        )}
                                    >
                                        <AssistantTerminalViewport
                                            session={session}
                                            workspaceCapability={workspaceCapability || undefined}
                                            initialOutput={outputBuffersRef.current.get(session.sessionId) || String(session.recentOutput || '')}
                                            theme={terminalTheme}
                                            fontFamily={getAppearanceCodeFontStack(settings.appearanceCodeFont)}
                                            fontSize={settings.terminalFontSize}
                                            cursorBlink={settings.terminalCursorBlink}
                                            scrollback={settings.terminalScrollback}
                                            active={sessionActive}
                                            visible={active}
                                            focusRequestId={focusRequestId}
                                            onActivate={() => activateTerminal(session.sessionId)}
                                            onNewTerminal={() => void createTerminal('new')}
                                            onSplitHorizontal={() => void createTerminal('split', 'horizontal')}
                                            onSplitVertical={() => void createTerminal('split', 'vertical')}
                                            onCloseTerminal={() => void closeTerminal(session.sessionId)}
                                            onError={setError}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
                            <div>
                                {loading || creating ? <RefreshCw size={16} className="mx-auto animate-spin text-[var(--accent-primary)]/65" /> : <SquareTerminal size={18} className="mx-auto text-sparkle-text-muted/55" />}
                                <p className="mt-2 text-[11px] text-sparkle-text-muted/70">{loading || creating ? 'Starting terminal…' : 'No terminal sessions'}</p>
                                {!loading && !creating ? <button type="button" onClick={() => void createTerminal('new')} className="mt-2 rounded border border-white/[0.08] px-2 py-1 text-[10px] text-sparkle-text-secondary hover:bg-white/[0.04]">New terminal</button> : null}
                            </div>
                        </div>
                    )}
                </div>

                {showSessionRail ? (
                    <aside className="flex w-[148px] shrink-0 flex-col border-l border-white/[0.07] bg-white/[0.015]">
                        <div className="border-b border-white/[0.06] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-sparkle-text-muted/50">Sessions</div>
                        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
                            {uiState.groups.map((group, groupIndex) => {
                                const groupSessions = group.terminalIds
                                    .map((terminalId) => sessions.find((entry) => entry.sessionId === terminalId) || null)
                                    .filter(Boolean) as TerminalSessionItem[]
                                const connected = groupSessions.length > 1
                                const groupActive = group.id === activeGroup?.id
                                if (groupSessions.length === 0) return null
                                return (
                                    <div key={group.id} className="mb-2" data-terminal-session-group={group.id}>
                                        {uiState.groups.length > 1 || connected ? (
                                            <button
                                                type="button"
                                                onClick={() => groupSessions[0] && activateTerminal(groupSessions[0].sessionId)}
                                                className={cn(
                                                    'mb-1 flex w-full items-center gap-1 px-1 py-0.5 text-left text-[8px] font-semibold uppercase tracking-[0.08em]',
                                                    groupActive ? 'text-[var(--accent-primary)]/80' : 'text-sparkle-text-muted/50 hover:bg-white/[0.03] hover:text-sparkle-text-secondary'
                                                )}
                                            >
                                                <span>Group {groupIndex + 1}</span>
                                                {connected ? (
                                                    <span className="ml-auto text-sparkle-text-muted/45" title={group.splitDirection === 'vertical' ? 'Vertically split group' : 'Horizontally split group'}>
                                                        {group.splitDirection === 'vertical' ? <SquareSplitVertical size={9} /> : <SquareSplitHorizontal size={9} />}
                                                    </span>
                                                ) : null}
                                            </button>
                                        ) : null}
                                        <div className={cn('relative', connected && 'pr-3')}>
                                            {connected ? (
                                                <span
                                                    aria-hidden="true"
                                                    data-terminal-group-connector
                                                    className={cn(
                                                        'pointer-events-none absolute bottom-3 right-0 top-3 w-px',
                                                        groupActive
                                                            ? 'bg-[color-mix(in_srgb,var(--accent-primary)_58%,transparent)]'
                                                            : 'bg-white/[0.2]'
                                                    )}
                                                />
                                            ) : null}
                                            {groupSessions.map((session) => {
                                                const sessionActive = session.sessionId === activeSession?.sessionId
                                                return (
                                                    <div
                                                        key={session.sessionId}
                                                        className={cn(
                                                            'group/session relative mb-1 flex min-h-6 items-center gap-1 border px-1.5 py-1 last:mb-0',
                                                            sessionActive
                                                                ? 'border-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_11%,transparent)] text-sparkle-text shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_5%,transparent)]'
                                                                : 'border-white/[0.06] bg-white/[0.018] text-sparkle-text-muted hover:border-white/[0.11] hover:bg-white/[0.04] hover:text-sparkle-text-secondary'
                                                        )}
                                                    >
                                                        {connected ? (
                                                            <span
                                                                aria-hidden="true"
                                                                data-terminal-group-branch
                                                                className={cn(
                                                                    'pointer-events-none absolute -right-3 top-1/2 h-px w-3',
                                                                    groupActive ? 'bg-[color-mix(in_srgb,var(--accent-primary)_58%,transparent)]' : 'bg-white/[0.2]'
                                                                )}
                                                            />
                                                        ) : null}
                                                        <button
                                                            type="button"
                                                            onClick={() => activateTerminal(session.sessionId)}
                                                            className="flex min-w-0 flex-1 items-center gap-1 text-left"
                                                            title={`${session.title} · ${session.cwd}`}
                                                        >
                                                            <span className={cn('size-1.5 shrink-0 rounded-full', terminalStatusClass(session.status))} />
                                                            <span className="min-w-0 flex-1 truncate text-[9px]">{session.title}</span>
                                                            {session.hasUnreadOutput ? <span className="size-1.5 shrink-0 rounded-full bg-sky-300" title="Unread output" /> : null}
                                                        </button>
                                                        <button type="button" onClick={() => void closeTerminal(session.sessionId)} className="inline-flex size-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-red-500/10 hover:text-red-200 group-hover/session:opacity-100" title={`Close ${session.title}`}><X size={9} /></button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </aside>
                ) : null}
            </div>
            {error ? <div className="shrink-0 border-t border-red-500/15 bg-red-500/[0.06] px-2 py-1 text-[9px] text-red-300">{error}</div> : null}
        </section>
    )
})
