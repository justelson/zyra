import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ResponseTimingRecord } from '@shared/response-timing'
import { SettingsButton, SettingsDialog, SettingsNotice, SettingsRow, SettingsSection } from './settings-layout'

const timing = (value: number | null) => value === null ? 'Not observed' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`
const stages = [
    ['mainReceivedMs', 'Desktop received submission'], ['dispatchMs', 'Runtime dispatch'], ['acceptedMs', 'Runtime accepted'],
    ['firstEventMs', 'First provider event'], ['firstTextMs', 'First provider text'],
    ['firstTextReceivedMs', 'Desktop received text'], ['firstDisplayMs', 'First visible text'], ['completedMs', 'Turn finished']
] as const

export function ResponseTimingSettings() {
    const [records, setRecords] = useState<ResponseTimingRecord[]>([])
    const [selected, setSelected] = useState<ResponseTimingRecord | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await window.zyraDiagnostics?.read()
            if (!result?.success) throw new Error('Response timings are unavailable. Try refreshing.')
            setRecords(result.records)
        } catch { setError('Response timings could not be loaded. Try refreshing.') }
        finally { setLoading(false) }
    }
    useEffect(() => { void load() }, [])
    const copy = async () => {
        try {
            const result = await window.devscope.copyToClipboard(JSON.stringify(selected || records, null, 2))
            if (!result.success) throw new Error('copy failed')
            setCopied(true)
        } catch { setError('Response timings could not be copied.') }
    }
    return <>
        <SettingsSection title="Response timings" headerAction={<div className="flex gap-1">
            <SettingsButton variant="ghost" onClick={() => void load()} disabled={loading}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} />Refresh</SettingsButton>
            <SettingsButton variant="ghost" onClick={() => { setCopied(false); void copy() }} disabled={!records.length}>{copied ? <Check size={12} /> : <Copy size={12} />}Copy timings</SettingsButton>
        </div>}>
            <SettingsRow title="Local performance diagnostics" status="Always on" statusTone="ready"
                description={<>Records submission, provider, display and recovery timings on this computer. Keeps up to 200 turns within a 2 MB file. Chat text and credentials are excluded. Sharing summaries follows <Link to="/settings/data/privacy" className="underline underline-offset-2">your analytics preference</Link>.</>} />
            {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
            {!records.length ? <SettingsNotice>{loading ? 'Loading response timings…' : 'New chat turns will appear here as they run.'}</SettingsNotice> : records.slice(0, 10).map(row => <SettingsRow key={row.turnId}
                title={row.model} status={row.outcome} statusTone={row.outcome === 'failed' ? 'danger' : 'muted'}
                description={<span className="tabular-nums">First text received: {timing(row.firstTextReceivedMs)} · Visible: {timing(row.firstDisplayMs)}</span>}
                info={<span>{new Date(row.startedAt).toLocaleString()} · {row.effort} reasoning</span>}
                control={<SettingsButton variant="ghost" onClick={() => { setCopied(false); setSelected(row) }}>Details</SettingsButton>} />)}
            {records.length > 10 ? <SettingsNotice>Showing the 10 most recent turns. Copy timings includes all {records.length} retained records.</SettingsNotice> : null}
        </SettingsSection>
        <SettingsDialog open={selected !== null} title="Response timing" onClose={() => setSelected(null)}
            footer={<><SettingsButton variant="ghost" onClick={() => setSelected(null)}>Close</SettingsButton><SettingsButton onClick={() => void copy()}>{copied ? 'Copied' : 'Copy record'}</SettingsButton></>}>
            {selected ? <div className="max-h-[65vh] space-y-4 overflow-y-auto text-xs">
                <p className="text-[var(--settings-text-secondary)]">{selected.model} · {new Date(selected.startedAt).toLocaleString()} · {selected.outcome}</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums">
                    {stages.map(([key, label]) => <div key={key} className="contents"><dt>{label}</dt><dd>{timing(selected[key])}</dd></div>)}
                    <dt>Provider calls / runtime retries</dt><dd>{selected.requestCount} / {selected.retryCount}</dd>
                    <dt>Compactions</dt><dd>{selected.compactionCount} · {timing(selected.compactionMs)}</dd>
                    <dt>Longest provider activity gap</dt><dd>{timing(selected.maxStreamingGapMs)}</dd>
                    {selected.requests.length ? <><dt>Latest provider activity after request start</dt><dd>{timing(selected.requests.at(-1)!.lastEventMs)}</dd></> : null}
                    <dt>Desktop stall reports</dt><dd>{selected.stallCount} · longest {timing(selected.maxStallMs)}</dd>
                    <dt>Main / renderer stall time</dt><dd>{timing(selected.mainStallMs)} / {timing(selected.rendererStallMs)}</dd>
                </dl>
                <p className="text-[var(--settings-text-muted)]">Stages are measured from submission. First visible text is observed after a paint opportunity while the text is in view. Hidden or collapsed text is not counted. Provider stages remain unobserved with older runtimes. Tool execution time is excluded from provider activity gaps.</p>
                <p className="break-all font-mono text-[10px] text-[var(--settings-text-muted)]">{selected.turnId}</p>
            </div> : null}
        </SettingsDialog>
    </>
}
