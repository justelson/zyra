import { memo, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, ListTodo, Loader2, PlugZap, Trash2 } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { IssueLogRow, copyTextToClipboard, getUsageMetricDotClass, getUsageMetricToneClass, type UsageMetricTone } from './AssistantPageHelpers'

export const AssistantThreadDetailsPanel = memo(function AssistantThreadDetailsPanel(props: {
    open: boolean
    folderAccess?: ReactNode
    compact?: boolean
    selectedChatTypeLabel: string
    selectedProjectPath: string
    selectedProjectLabel: string
    displayProjectPath: string
    showFullProjectPath: boolean
    projectPathCopied: boolean
    contextPercentage: number | null
    contextColor: string
    contextUsedDisplay: string
    contextAvailableDisplay: string
    pendingApprovalsCount: number
    pendingUserInputsCount: number
    sidebarSelectedModel: string
    selectedRuntimeLabel: string
    selectedThinkingLabel: string
    selectedSpeedLabel: string
    sessionCostLabel: string
    sessionCostDisplay: string
    sessionCostTone: UsageMetricTone
    sidebarMetricChips: Array<{ label: string; value: string; tone: UsageMetricTone }>
    issueActivities: AssistantActivity[]
    latestIssueGroup: { activity: AssistantActivity; activities: AssistantActivity[]; count: number } | null
    olderIssueGroups: Array<{ activity: AssistantActivity; activities: AssistantActivity[]; count: number }>
    copiedLogId: string | null
    copyErrorByLogId: Record<string, string | null>
    allLogsCopied: boolean
    clearingLogs: boolean
    logsExpanded: boolean
    selectedSessionId?: string | null
    assistantConnected: boolean
    commandPending: boolean
    onClose: () => void
    onShowPlan: () => void
    onToggleProjectPath: () => void
    onCopyProjectPath: () => void
    onToggleLogsExpanded: () => void
    onCopyAllLogs: () => void
    onClearLogs: () => void
    onCopyLog: (activity: AssistantActivity) => void
    onShowLogDetails: (activity: AssistantActivity, activities?: AssistantActivity[]) => void
    onToggleAssistantConnection: () => void
}) {
    const { open, compact = false, selectedChatTypeLabel, selectedProjectPath, selectedProjectLabel, displayProjectPath, showFullProjectPath, projectPathCopied, contextPercentage, contextColor, contextUsedDisplay, contextAvailableDisplay, pendingApprovalsCount, pendingUserInputsCount, sidebarSelectedModel, selectedRuntimeLabel, selectedThinkingLabel, selectedSpeedLabel, sessionCostLabel, sessionCostDisplay, sessionCostTone, sidebarMetricChips, issueActivities, latestIssueGroup, olderIssueGroups, copiedLogId, copyErrorByLogId, allLogsCopied, clearingLogs, logsExpanded, selectedSessionId, assistantConnected, commandPending, onClose, onShowPlan, onToggleProjectPath, onCopyProjectPath, onToggleLogsExpanded, onCopyAllLogs, onClearLogs, onCopyLog, onShowLogDetails, onToggleAssistantConnection } = props
    void copiedLogId
    void copyErrorByLogId
    void onCopyLog

    return (
        <div className={cn('relative overflow-hidden transition-all duration-300', open ? 'opacity-100' : 'opacity-0 pointer-events-none')} style={{ width: open ? (compact ? '360px' : '460px') : '0px' }}>
            <aside className="flex h-full min-h-0 flex-col border-l border-white/10 bg-sparkle-bg">
                <div className="flex h-[46px] shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <h2 className="text-sm font-semibold text-sparkle-text">Thread Details</h2>
                        <button
                            type="button"
                            onClick={onToggleAssistantConnection}
                            disabled={commandPending || (!assistantConnected && !selectedSessionId)}
                            className={cn(
                                'inline-flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                assistantConnected
                                    ? 'border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-200 hover:border-emerald-400/35 hover:bg-emerald-500/[0.14]'
                                    : 'border-red-500/25 bg-red-500/[0.10] text-red-200 hover:border-red-400/35 hover:bg-red-500/[0.14]'
                            )}
                            title={assistantConnected ? 'Disconnect assistant' : 'Connect assistant'}
                            aria-label={assistantConnected ? 'Disconnect assistant' : 'Connect assistant'}
                        >
                            <PlugZap size={13} />
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={onShowPlan}
                            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white/[0.03] px-2 text-[11px] font-medium text-sparkle-text-secondary transition-colors hover:bg-white/[0.05] hover:text-sparkle-text"
                            title="Switch to plan"
                            aria-label="Switch to plan"
                        >
                            <ListTodo size={13} />
                            <span>Plan</span>
                        </button>
                        <button type="button" onClick={onClose} className="rounded-md border border-white/10 bg-white/[0.03] p-1.5 text-sparkle-text-secondary transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text" title="Close panel"><ChevronRight size={14} /></button>
                    </div>
                </div>
                <div className="shrink-0 space-y-3 border-b border-white/10 px-4 py-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Chat</span>
                        </div>
                        <div className="space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sparkle-text-secondary">Type</span>
                                <span className="font-medium text-sparkle-text">{selectedChatTypeLabel}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sparkle-text-secondary">Path</span>
                                {selectedProjectPath ? (
                                    <div className="group/path relative ml-auto min-w-0 max-w-[75%]">
                                        <button
                                            type="button"
                                            onClick={onToggleProjectPath}
                                            onDoubleClick={async (event) => { event.preventDefault(); await copyTextToClipboard(selectedProjectPath) }}
                                            className="block max-w-full truncate pr-8 text-right font-medium text-sparkle-text transition-colors hover:text-sparkle-text-secondary"
                                            title={showFullProjectPath ? 'Show folder or lab name (double-click to copy)' : 'Show full path (double-click to copy)'}
                                        >
                                            {displayProjectPath}
                                        </button>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-sparkle-bg via-sparkle-bg/95 to-transparent pl-4">
                                            <button
                                                type="button"
                                                onClick={onCopyProjectPath}
                                                className={cn(
                                                    'pointer-events-auto shrink-0 rounded-md border p-1 transition-colors',
                                                    projectPathCopied
                                                        ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-200'
                                                        : 'border-white/10 bg-white/[0.03] text-sparkle-text-secondary hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text'
                                                )}
                                                title={projectPathCopied ? 'Copied!' : `Copy full path: ${selectedProjectPath}`}
                                                aria-label={projectPathCopied ? 'Path copied' : 'Copy full path'}
                                            >
                                                {projectPathCopied ? <Check size={11} /> : <Copy size={11} />}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <span className="min-w-0 flex-1 truncate text-right font-medium text-sparkle-text">{selectedProjectLabel}</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {props.folderAccess}

                    {(pendingApprovalsCount > 0 || pendingUserInputsCount > 0) && <div className="space-y-2 border-t border-white/5 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Status</span>
                        <div className="space-y-1.5 text-xs">
                            {pendingApprovalsCount > 0 && <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">Pending approvals</span><span className="font-medium text-amber-300">{pendingApprovalsCount}</span></div>}
                            {pendingUserInputsCount > 0 && <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">User input needed</span><span className="font-medium text-amber-300">{pendingUserInputsCount}</span></div>}
                        </div>
                    </div>}

                    <div className="space-y-2 border-t border-white/5 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Context</span>
                        {contextPercentage != null ? <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs"><span className="text-sparkle-text-secondary">Usage</span><span className={cn('font-semibold', contextColor)}>{contextPercentage}%</span></div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className={cn('h-full transition-all duration-300', contextPercentage >= 90 ? 'bg-red-400' : contextPercentage >= 70 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${Math.min(contextPercentage, 100)}%` }} /></div>
                            <div className="flex items-center justify-between text-[11px] text-sparkle-text-muted"><span>{contextUsedDisplay} used</span><span>{contextAvailableDisplay} available</span></div>
                        </div> : <div className="text-xs text-sparkle-text-secondary">No turn yet</div>}
                    </div>

                    <div className="space-y-2 border-t border-white/5 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Configuration</span>
                        <div className="space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">Model</span><span className="truncate font-medium text-sparkle-text">{sidebarSelectedModel || 'None'}</span></div>
                            <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">Mode</span><span className="font-medium text-sparkle-text">{selectedRuntimeLabel}</span></div>
                            <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">Thinking</span><span className="font-medium text-sparkle-text">{selectedThinkingLabel}</span></div>
                            <div className="flex items-center justify-between gap-3"><span className="text-sparkle-text-secondary">Speed</span><span className="font-medium text-sparkle-text">{selectedSpeedLabel}</span></div>
                        </div>
                    </div>

                    {(sessionCostLabel || sidebarMetricChips.length > 0) && <div className="space-y-2 border-t border-white/5 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Usage Metrics</span>
                        <div className="space-y-1 text-xs">
                            {sessionCostLabel ? <div className="rounded-lg bg-white/[0.02] px-2 py-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="min-w-0 truncate text-sparkle-text-secondary">{sessionCostLabel}</span>
                                    <span className={cn('inline-flex items-center gap-2 font-mono', getUsageMetricToneClass(sessionCostTone))}>
                                        <span className={cn('h-1.5 w-1.5 rounded-full', getUsageMetricDotClass(sessionCostTone))} />
                                        {sessionCostDisplay}
                                    </span>
                                </div>
                            </div> : null}
                            {sidebarMetricChips.map((chip) => <div key={chip.label} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-2 py-1.5"><span className="text-sparkle-text-secondary">{chip.label}</span><span className={cn('inline-flex items-center gap-2 font-mono', getUsageMetricToneClass(chip.tone))}><span className={cn('h-1.5 w-1.5 rounded-full', getUsageMetricDotClass(chip.tone))} />{chip.value}</span></div>)}
                        </div>
                    </div>}
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                        <div className="flex items-center gap-2"><span className="text-[11px] font-medium uppercase tracking-[0.16em] text-sparkle-text-muted">Logs</span><span className="text-[11px] text-sparkle-text-muted">({issueActivities.length})</span></div>
                        <div className="flex items-center gap-1">
                            {olderIssueGroups.length > 0 && <button type="button" onClick={onToggleLogsExpanded} className="rounded-md border border-white/10 bg-white/[0.03] p-1 text-sparkle-text-secondary transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text" title={logsExpanded ? 'Collapse logs' : `Show ${olderIssueGroups.length} earlier logs`}><ChevronDown size={12} className={cn('transition-transform duration-200', logsExpanded && 'rotate-180')} /></button>}
                            <button type="button" onClick={onCopyAllLogs} className={cn('rounded-md border p-1 transition-colors', allLogsCopied ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-200' : 'border-white/10 bg-white/[0.03] text-sparkle-text-secondary hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text')} title={allLogsCopied ? 'Copied!' : 'Copy all logs'}>{allLogsCopied ? <Check size={11} /> : <Copy size={11} />}</button>
                            <button type="button" onClick={onClearLogs} disabled={!selectedSessionId || !latestIssueGroup || clearingLogs} className={cn('rounded-md border p-1 transition-colors', !selectedSessionId || !latestIssueGroup || clearingLogs ? 'border-white/10 bg-white/[0.03] text-sparkle-text-secondary opacity-50 cursor-not-allowed' : 'border-white/10 bg-white/[0.03] text-sparkle-text-secondary hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text')} title={clearingLogs ? 'Clearing logs...' : latestIssueGroup ? 'Clear logs' : 'No logs to clear'}>{clearingLogs ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}</button>
                        </div>
                    </div>
                    <div className="scrollbar-hide flex-1 overflow-y-auto py-2">
                        {latestIssueGroup ? <div className="w-full overflow-hidden">
                            <IssueLogRow key={latestIssueGroup.activity.id} activity={latestIssueGroup.activity} activities={latestIssueGroup.activities} count={latestIssueGroup.count} onShowMore={onShowLogDetails} />
                            <AnimatedHeight isOpen={logsExpanded && olderIssueGroups.length > 0}>
                                <div>{olderIssueGroups.map((group) => <IssueLogRow key={group.activity.id} activity={group.activity} activities={group.activities} count={group.count} onShowMore={onShowLogDetails} />)}</div>
                            </AnimatedHeight>
                        </div> : <div className="text-center text-xs text-sparkle-text-muted">No logs</div>}
                    </div>
                </div>
            </aside>
        </div>
    )
}, (prev, next) => !prev.open && !next.open)
