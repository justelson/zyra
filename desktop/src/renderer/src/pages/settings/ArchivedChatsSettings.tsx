import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArchiveRestore, ExternalLink, MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react'
import type { AssistantSession } from '@shared/assistant/contracts'
import { FileActionsMenu } from '@/components/ui/FileActionsMenu'
import { SettingsListPagination } from './SettingsListPagination'
import { paginateSettingsItems } from './settings-list-page'
import { createSettingsRowTargetId } from './settings-search'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import {
    formatAssistantSidebarRelativeTime,
    getSessionDisplayTitle,
    getProjectLabel,
    getSessionLastActivityAt,
    getSortableTimestamp
} from '../assistant/assistant-sessions-rail-utils'
import {
    SettingsButton,
    SettingsInput,
    SettingsNotice,
    SettingsPageContainer,
    SettingsSection
} from './settings-layout'

export default function ArchivedChatsSettings() {
    const navigate = useNavigate()
    const actions = useAssistantStoreActions()
    const sessions = useAssistantStoreSelector((state) => state.snapshot.sessions)
    const [query, setQuery] = useState('')
    const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
    const [requestedPage, setPage] = useState(0)
    const [actionError, setActionError] = useState<string | null>(null)

    const archivedSessions = useMemo(() => sessions.filter((session) => session.archived).sort((left, right) => getSortableTimestamp(getSessionLastActivityAt(right)) - getSortableTimestamp(getSessionLastActivityAt(left))), [sessions])
    const filteredSessions = useMemo(() => {
        const normalized = query.trim().toLowerCase()
        if (!normalized) return archivedSessions
        return archivedSessions.filter((session) => `${getSessionDisplayTitle(session)} ${session.projectPath || ''} ${session.id}`.toLowerCase().includes(normalized))
    }, [archivedSessions, query])

    const restore = async (session: AssistantSession, openAfterRestore: boolean) => {
        if (pendingSessionId) return
        setPendingSessionId(session.id)
        setActionError(null)
        try {
            const result = await actions.archiveSessionResult(session.id, false)
            if (!result.success) throw new Error(result.error || 'Could not restore the chat.')
            if (openAfterRestore) {
                const selected = await actions.selectSessionResult(session.id, { force: true })
                if (!selected.success) throw new Error(`Chat restored, but could not open it: ${selected.error}`)
                navigate('/assistant')
            }
        } catch (error) {
            setActionError(error instanceof Error ? error.message : 'Could not restore the chat.')
        } finally {
            setPendingSessionId(null)
        }
    }

    const deleteSession = async (session: AssistantSession) => {
        if (pendingSessionId || !window.confirm(`Delete "${getSessionDisplayTitle(session)}"? This cannot be undone.`)) return
        setPendingSessionId(session.id)
        setActionError(null)
        try {
            const result = await actions.deleteSessionResult(session.id)
            if (!result.success) throw new Error(result.error || 'Could not delete the chat.')
        } catch (error) {
            setActionError(error instanceof Error ? error.message : 'Could not delete the chat.')
        } finally {
            setPendingSessionId(null)
        }
    }

    const page = paginateSettingsItems(filteredSessions, requestedPage)

    return (
        <SettingsPageContainer title="Archived chats" fillViewport>
            {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex shrink-0 items-center gap-4" data-settings-search-target={createSettingsRowTargetId('Archive', 'Search')} tabIndex={-1}>
                    <SettingsInput value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Search archived chats" aria-label="Search archived chats" className="min-w-0 flex-1 sm:w-auto" />
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--settings-text-muted)]" aria-live="polite">{page.total} {page.total === 1 ? 'chat' : 'chats'}</span>
                </div>
                <SettingsSection title="Chats" hideHeader className="flex min-h-0 flex-col [content-visibility:visible]" bodyClassName="flex min-h-0 flex-col overflow-hidden">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <table aria-label="Archived chats" className="w-full table-fixed text-left">
                            <colgroup><col /><col className="hidden w-[26%] sm:table-column" /><col className="w-20 sm:w-24" /><col className="w-20 sm:w-[88px]" /></colgroup>
                            <thead className="sticky top-0 z-10 bg-[var(--settings-section)] text-[11px] text-[var(--settings-text-muted)]">
                                <tr className="border-b border-[var(--settings-row-divider)]">
                                    <th scope="col" className="px-4 py-2.5 font-normal">Chat</th>
                                    <th scope="col" className="hidden px-3 py-2.5 font-normal sm:table-cell">Project</th>
                                    <th scope="col" className="py-2.5 font-normal whitespace-nowrap">Last active</th>
                                    <th scope="col"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--settings-row-divider)]">{page.items.map((session) => {
                                const pending = pendingSessionId === session.id
                                const title = getSessionDisplayTitle(session)
                                const lastActive = getSessionLastActivityAt(session)
                                const project = session.projectPath ? getProjectLabel(session.projectPath) : null
                                return (
                                    <tr key={session.id} className="h-[52px] transition-colors hover:bg-[var(--settings-row-hover)]" aria-busy={pending}>
                                        <td className="px-4 py-2">
                                            <div className="flex min-w-0 items-center gap-2.5">
                                                <MessageSquare size={16} strokeWidth={1.5} className="shrink-0 text-[var(--settings-text-muted)]" aria-hidden="true" />
                                                <div className="min-w-0"><span className="block truncate text-[13px] font-medium text-[var(--settings-text)]" title={`${title}\nChat ID: ${session.id}`}>{title}</span>{project ? <span className="mt-0.5 block truncate text-[11px] text-[var(--settings-text-secondary)] sm:hidden" title={session.projectPath || undefined}>{project}</span> : null}</div>
                                            </div>
                                        </td>
                                        <td className="hidden px-3 py-2 text-[12px] text-[var(--settings-text-secondary)] sm:table-cell"><span className="block truncate" title={session.projectPath || 'No project'}>{project || '—'}</span></td>
                                        <td className="py-2 text-[11px] tabular-nums text-[var(--settings-text-muted)]"><time dateTime={lastActive} title={lastActive}>{formatAssistantSidebarRelativeTime(lastActive)}</time></td>
                                        <td className="pr-2 py-2">
                                            <div className="flex items-center justify-end">
                                                <SettingsButton variant="ghost" className="!h-8 !w-8 !px-0" aria-label={`Restore ${title}`} title={pending ? 'Working…' : 'Restore chat'} onClick={() => void restore(session, false)} disabled={Boolean(pendingSessionId)}><ArchiveRestore size={14} className={pending ? 'animate-pulse motion-reduce:animate-none' : ''} /></SettingsButton>
                                                <FileActionsMenu title={`Actions for ${title}`} density="compact" menuWidth={224} triggerIcon={<MoreHorizontal size={15} />} buttonClassName="!h-8 !w-8 !text-[var(--settings-text-secondary)] hover:!bg-[var(--settings-row-hover)] hover:!text-[var(--settings-text)] disabled:opacity-45" disabled={Boolean(pendingSessionId)} items={[
                                                    { id: 'restore', label: 'Restore chat', icon: <ArchiveRestore size={13} />, onSelect: () => restore(session, false) },
                                                    { id: 'open', label: 'Restore and open', icon: <ExternalLink size={13} />, onSelect: () => restore(session, true) },
                                                    { id: 'delete', label: 'Delete chat', icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onSelect: () => deleteSession(session) }
                                                ]} />
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}</tbody>
                        </table>
                        {page.total === 0 ? <div className="px-4 py-7 text-[12px] text-[var(--settings-text-secondary)]" role="status">{query ? 'No archived chats match this search.' : 'No chats are archived.'}</div> : null}
                    </div>
                    <SettingsListPagination {...page} onPageChange={setPage} />
                </SettingsSection>
            </div>
        </SettingsPageContainer>
    )
}
