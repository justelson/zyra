import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { SettingsListPagination } from './SettingsListPagination'
import { paginateSettingsItems } from './settings-list-page'
import { SettingsProviderIcon } from './SettingsProviderIcon'
import {
    SettingsButton,
    SettingsDialog,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSelect
} from './settings-layout'

type ProviderFilter = 'all' | 'groq' | 'gemini' | 'codex'
const LOGS_CACHE_TTL_MS = 10_000

type AiDebugLogEntry = {
    id: string
    timestamp: number
    provider: 'groq' | 'gemini' | 'codex'
    action: 'generateCommitMessage' | 'testConnection'
    status: 'success' | 'error'
    model?: string
    error?: string
    promptPreview?: string
    requestPayload?: string
    rawResponse?: string
    candidateMessage?: string
    finalMessage?: string
    metadata?: Record<string, string | number | boolean | null>
}

let cachedLogs: AiDebugLogEntry[] | null = null
let cachedLogsAt = 0
let logsCacheTimer = 0

function rememberLogs(logs: AiDebugLogEntry[]): void {
    cachedLogs = logs
    cachedLogsAt = Date.now()
    window.clearTimeout(logsCacheTimer)
    logsCacheTimer = window.setTimeout(() => {
        cachedLogs = null
        cachedLogsAt = 0
    }, LOGS_CACHE_TTL_MS)
}

registerSettingsCacheClearer('settings-diagnostics', () => {
    window.clearTimeout(logsCacheTimer)
    cachedLogs = null
    cachedLogsAt = 0
})

export default function LogsSettings() {
    const [logs, setLogs] = useState<AiDebugLogEntry[]>(() => cachedLogs || [])
    const [loading, setLoading] = useState(false)
    const [clearing, setClearing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState<ProviderFilter>('all')
    const [copiedKey, setCopiedKey] = useState<string | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [requestedPage, setPage] = useState(0)

    const loadLogs = async (forceRefresh = false) => {
        if (!forceRefresh && cachedLogs && Date.now() - cachedLogsAt < LOGS_CACHE_TTL_MS) {
            setLogs(cachedLogs)
            return
        }
        setLoading(true)
        setError(null)
        try {
            const result = await window.devscope.getAiDebugLogs(200)
            if (!result?.success) throw new Error(result?.error || 'Could not load AI debug logs.')
            const nextLogs = Array.isArray(result.logs) ? result.logs : []
            rememberLogs(nextLogs)
            setLogs(nextLogs)
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Could not load AI debug logs.')
            setLogs([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { void loadLogs() }, [])

    const filteredLogs = useMemo(() => filter === 'all' ? logs : logs.filter((entry) => entry.provider === filter), [filter, logs])
    const page = paginateSettingsItems(filteredLogs, requestedPage)
    const selectedEntry = logs.find(entry => entry.id === expandedId) || null

    const copyText = async (key: string, value: string) => {
        if (!value.trim()) return
        try {
            const result = await window.devscope.copyToClipboard?.(value)
            if (result && result.success === false) throw new Error(result.error || 'Could not copy logs.')
            if (!result) {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
                await navigator.clipboard.writeText(value)
            }
            setCopiedKey(key)
            window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1500)
        } catch (copyError) {
            setError(copyError instanceof Error ? copyError.message : 'Could not copy logs.')
        }
    }

    const clearLogs = async () => {
        if (logs.length > 0 && !window.confirm('Clear all local AI debug logs?')) return
        setClearing(true)
        setError(null)
        try {
            const result = await window.devscope.clearAiDebugLogs()
            if (!result?.success) throw new Error(result?.error || 'Could not clear AI debug logs.')
            rememberLogs([])
            setLogs([])
        } catch (clearError) {
            setError(clearError instanceof Error ? clearError.message : 'Could not clear AI debug logs.')
        } finally {
            setClearing(false)
        }
    }

    return (
        <SettingsPageContainer title="Diagnostics" backTo="/settings/data" backLabel="Data & privacy">
            <SettingsSection title="Diagnostics" headerAction={<div className="flex gap-1"><SettingsButton variant="ghost" onClick={() => void loadLogs(true)} disabled={loading}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} />Refresh</SettingsButton><SettingsButton variant="ghost" onClick={() => void copyText('visible', filteredLogs.map(formatLogEntry).join('\n\n====================\n\n'))} disabled={filteredLogs.length === 0}>{copiedKey === 'visible' ? <Check size={12} /> : <Copy size={12} />}Copy matching</SettingsButton></div>}>
                {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
                <SettingsRow title="AI debug logs" description="Local provider requests and responses retained for Git AI troubleshooting." control={<span className="font-mono text-xs tabular-nums text-sparkle-text-secondary">{logs.length}</span>} />
                <SettingsRow title="Provider filter" description="Limit the visible log records by provider." control={<SettingsSelect value={filter} onChange={event => { setFilter(event.target.value as ProviderFilter); setPage(0) }} aria-label="AI log provider filter"><option value="all">All providers</option><option value="groq">Groq</option><option value="gemini">Gemini</option><option value="codex">ChatGPT</option></SettingsSelect>} />
                <SettingsRow title="Clear logs" description="Remove all local AI provider debug records." control={<SettingsButton variant="danger" onClick={() => void clearLogs()} disabled={clearing || logs.length === 0}><Trash2 size={12} />{clearing ? 'Clearing…' : 'Clear'}</SettingsButton>} />
            </SettingsSection>

            <SettingsSection title="AI provider records">
                <div className="max-h-[520px] overflow-y-auto [scrollbar-gutter:stable]">
                {page.total === 0 ? <SettingsNotice>{loading ? 'Loading logs…' : error ? 'Records could not be loaded.' : 'No matching debug records.'}</SettingsNotice> : page.items.map((entry) => {
                    return (
                        <SettingsRow
                            key={entry.id}
                            title={`${entry.provider === 'codex' ? 'ChatGPT' : entry.provider.toUpperCase()} · ${entry.action === 'testConnection' ? 'Connection test' : 'Commit message'}`}
                            description={<span className="block truncate">{entry.error || entry.finalMessage || entry.candidateMessage || entry.promptPreview || 'No summary available.'}</span>}
                            icon={entry.provider === 'codex' || entry.provider === 'gemini' ? <SettingsProviderIcon provider={entry.provider} /> : undefined}
                            status={entry.status === 'success' ? 'Success' : 'Error'}
                            statusTone={entry.status === 'success' ? 'ready' : 'danger'}
                            info={<span>{new Date(entry.timestamp).toLocaleString()}{entry.model ? ` · ${entry.model}` : ''}</span>}
                            control={<SettingsActionsMenu label="View" ariaLabel={`Actions for ${entry.provider} record`} items={[
                                { id: 'details', label: 'View details', onSelect: () => setExpandedId(entry.id) },
                                { id: 'copy', label: copiedKey === entry.id ? 'Copied' : 'Copy record', icon: copiedKey === entry.id ? <Check size={13} /> : <Copy size={13} />, onSelect: () => copyText(entry.id, formatLogEntry(entry)) }
                            ]} />}
                        />
                    )
                })}
                </div>
                <SettingsListPagination {...page} onPageChange={setPage} />
            </SettingsSection>
            <SettingsDialog open={selectedEntry !== null} title="Diagnostic record" onClose={() => setExpandedId(null)} className="max-w-[720px]"
                footer={<><SettingsButton variant="ghost" onClick={() => setExpandedId(null)}>Close</SettingsButton>{selectedEntry ? <SettingsButton onClick={() => void copyText(selectedEntry.id, formatLogEntry(selectedEntry))}>{copiedKey === selectedEntry.id ? <Check size={13} /> : <Copy size={13} />}{copiedKey === selectedEntry.id ? 'Copied' : 'Copy record'}</SettingsButton> : null}</>}>
                {selectedEntry ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--settings-text-secondary)]">{formatLogEntry(selectedEntry)}</pre> : null}
            </SettingsDialog>
        </SettingsPageContainer>
    )
}

function formatLogEntry(entry: AiDebugLogEntry): string {
    const parts = [
        `Timestamp: ${new Date(entry.timestamp).toLocaleString()}`,
        `Provider: ${entry.provider}`,
        `Action: ${entry.action}`,
        `Status: ${entry.status}`
    ]
    if (entry.model) parts.push(`Model: ${entry.model}`)
    if (entry.error) parts.push(`Error: ${entry.error}`)
    if (entry.finalMessage) parts.push(`Final Message:\n${entry.finalMessage}`)
    if (entry.candidateMessage) parts.push(`Candidate Message:\n${entry.candidateMessage}`)
    if (entry.promptPreview) parts.push(`Prompt Preview:\n${entry.promptPreview}`)
    if (entry.requestPayload) parts.push(`Request Payload:\n${entry.requestPayload}`)
    if (entry.rawResponse) parts.push(`Raw Response:\n${entry.rawResponse}`)
    if (entry.metadata) parts.push(`Metadata:\n${JSON.stringify(entry.metadata, null, 2)}`)
    return parts.join('\n\n')
}
