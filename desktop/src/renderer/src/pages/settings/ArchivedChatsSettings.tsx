import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArchiveRestore, ExternalLink, Trash2 } from 'lucide-react'
import type { AssistantSession } from '@shared/assistant/contracts'
import { SettingsActionsMenu } from './SettingsActionsMenu'
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
    SettingsRow,
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
        <SettingsPageContainer title="Archived chats" backTo="/settings/data" backLabel="Data & privacy">
            <SettingsSection title="Archive">
                <SettingsRow title="Archived chats" description="Chats stay saved until you restore or delete them." control={<span className="font-mono text-xs tabular-nums text-sparkle-text-secondary">{archivedSessions.length}</span>} />
                {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
            </SettingsSection>

            <SettingsSection title="Chats">
                <div className="border-b border-[var(--settings-row-divider)] px-4 py-3" data-settings-search-target={createSettingsRowTargetId('Archive', 'Search')} tabIndex={-1}>
                    <SettingsInput value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Search by title, project or chat ID" aria-label="Search archived chats" className="sm:w-full" />
                </div>
                <div className="max-h-[520px] overflow-y-auto [scrollbar-gutter:stable]">
                {page.total === 0 ? <SettingsNotice>{query ? 'No archived chats match this search.' : 'No chats are archived.'}</SettingsNotice> : page.items.map((session) => {
                    const pending = pendingSessionId === session.id
                    return (
                        <SettingsRow
                            key={session.id}
                            title={<span className="block truncate" title={getSessionDisplayTitle(session)}>{getSessionDisplayTitle(session)}</span>}
                            description={session.projectPath ? <code className="block truncate text-[11px]" title={session.projectPath}>{session.projectPath}</code> : 'No project folder.'}
                            status={formatAssistantSidebarRelativeTime(getSessionLastActivityAt(session))}
                            info={<div className="space-y-1"><span>Chat ID</span><code className="block break-all text-[11px]">{session.id}</code></div>}
                            control={<div className="flex gap-2"><SettingsButton onClick={() => void restore(session, false)} disabled={Boolean(pendingSessionId)}><ArchiveRestore size={13} />{pending ? 'Working…' : 'Restore'}</SettingsButton><SettingsActionsMenu label="More" ariaLabel={`Actions for ${getSessionDisplayTitle(session)}`} disabled={Boolean(pendingSessionId)} items={[
                                { id: 'open', label: 'Restore and open', icon: <ExternalLink size={13} />, onSelect: () => restore(session, true) },
                                { id: 'delete', label: 'Delete chat', icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onSelect: () => deleteSession(session) }
                            ]} /></div>}
                        />
                    )
                })}
                </div>
                <SettingsListPagination {...page} onPageChange={setPage} />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
