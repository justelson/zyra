import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArchiveRestore, ExternalLink, Trash2 } from 'lucide-react'
import type { AssistantSession } from '@shared/assistant/contracts'
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

    const archivedSessions = useMemo(() => sessions.filter((session) => session.archived).sort((left, right) => getSortableTimestamp(getSessionLastActivityAt(right)) - getSortableTimestamp(getSessionLastActivityAt(left))), [sessions])
    const filteredSessions = useMemo(() => {
        const normalized = query.trim().toLowerCase()
        if (!normalized) return archivedSessions
        return archivedSessions.filter((session) => `${getSessionDisplayTitle(session)} ${session.projectPath || ''} ${session.id}`.toLowerCase().includes(normalized))
    }, [archivedSessions, query])

    const restore = async (session: AssistantSession, openAfterRestore: boolean) => {
        if (pendingSessionId) return
        setPendingSessionId(session.id)
        try {
            await actions.archiveSession(session.id, false)
            if (openAfterRestore) {
                await actions.selectSession(session.id, { force: true })
                navigate('/assistant')
            }
        } finally {
            setPendingSessionId(null)
        }
    }

    const deleteSession = async (session: AssistantSession) => {
        if (pendingSessionId || !window.confirm(`Delete "${getSessionDisplayTitle(session)}"? This cannot be undone.`)) return
        setPendingSessionId(session.id)
        try {
            await actions.deleteSession(session.id)
        } finally {
            setPendingSessionId(null)
        }
    }

    return (
        <SettingsPageContainer title="Archived chats" backTo="/settings/data" backLabel="Data & privacy">
            <SettingsSection title="Archive">
                <SettingsRow title="Archived chats" description="Hidden canonical chats that remain intact until restored or explicitly deleted." control={<span className="font-mono text-xs tabular-nums text-sparkle-text-secondary">{archivedSessions.length}</span>} />
                <SettingsRow title="Search" description="Filter by title, project path, or canonical chat ID." control={<SettingsInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archive" aria-label="Search archived chats" />} />
            </SettingsSection>

            <SettingsSection title="Chats">
                {filteredSessions.length === 0 ? <SettingsNotice>{query ? 'No archived chats match this search.' : 'No chats are archived.'}</SettingsNotice> : filteredSessions.map((session) => {
                    const pending = pendingSessionId === session.id
                    return (
                        <SettingsRow
                            key={session.id}
                            title={getSessionDisplayTitle(session)}
                            description={session.projectPath || 'No project folder'}
                            status={`${formatAssistantSidebarRelativeTime(getSessionLastActivityAt(session))} · ${session.id}`}
                            control={<div className="flex gap-1"><SettingsButton onClick={() => void restore(session, false)} disabled={pending}><ArchiveRestore size={13} />Restore</SettingsButton><SettingsButton variant="ghost" onClick={() => void restore(session, true)} disabled={pending}><ExternalLink size={13} />Restore and open</SettingsButton><SettingsButton variant="ghost" onClick={() => void deleteSession(session)} disabled={pending} aria-label="Delete archived chat"><Trash2 size={13} /></SettingsButton></div>}
                        />
                    )
                })}
            </SettingsSection>
        </SettingsPageContainer>
    )
}
