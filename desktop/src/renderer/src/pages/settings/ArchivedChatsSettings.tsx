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
            <SettingsSection title="Chats" hideHeader className="flex min-h-0 flex-1 flex-col [content-visibility:visible]" bodyClassName="flex min-h-0 flex-1 flex-col !rounded-none !border-0 !bg-transparent !shadow-none">
                {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
                <div className="shrink-0 pb-4" data-settings-search-target={createSettingsRowTargetId('Archive', 'Search')} tabIndex={-1}>
                    <SettingsInput value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Search archived chats" aria-label="Search archived chats" className="sm:w-full" />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                <ul aria-label="Archived chats" className="divide-y divide-[var(--settings-row-divider)]">{page.items.map((session) => {
                    const pending = pendingSessionId === session.id
                    const title = getSessionDisplayTitle(session)
                    return (
                        <li key={session.id} className="flex min-w-0 items-center gap-3 px-1 py-3" aria-busy={pending}>
                            <span className="flex size-8 shrink-0 items-center justify-center text-[var(--settings-text-secondary)]"><MessageSquare size={24} strokeWidth={1.5} aria-hidden="true" /></span>
                            <div className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-[var(--settings-text)]" title={`${title}\nChat ID: ${session.id}`}>{title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--settings-text-secondary)]" title={session.projectPath || undefined}>{session.projectPath || 'Chat'}</span></div>
                            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                                <span className="text-[11px] tabular-nums text-[var(--settings-text-muted)]" title={getSessionLastActivityAt(session)}>{formatAssistantSidebarRelativeTime(getSessionLastActivityAt(session))}</span>
                                <SettingsButton variant="ghost" className="!h-8 !w-8 !px-0" aria-label={`Restore ${title}`} title={pending ? 'Working…' : 'Restore chat'} onClick={() => void restore(session, false)} disabled={Boolean(pendingSessionId)}><ArchiveRestore size={15} className={pending ? 'animate-pulse motion-reduce:animate-none' : ''} /></SettingsButton>
                                <FileActionsMenu title={`Actions for ${title}`} density="compact" menuWidth={224} triggerIcon={<MoreHorizontal size={16} />} buttonClassName="!h-8 !w-8 !text-[var(--settings-text-secondary)] hover:!bg-[var(--settings-row-hover)] hover:!text-[var(--settings-text)] disabled:opacity-45" disabled={Boolean(pendingSessionId)} items={[
                                { id: 'restore', label: 'Restore chat', icon: <ArchiveRestore size={13} />, onSelect: () => restore(session, false) },
                                { id: 'open', label: 'Restore and open', icon: <ExternalLink size={13} />, onSelect: () => restore(session, true) },
                                { id: 'delete', label: 'Delete chat', icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onSelect: () => deleteSession(session) }
                            ]} /></div>
                        </li>
                    )
                })}</ul>
                {page.total === 0 ? <SettingsNotice>{query ? 'No archived chats match this search.' : 'No chats are archived.'}</SettingsNotice> : null}
                </div>
                <SettingsListPagination {...page} onPageChange={setPage} />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
