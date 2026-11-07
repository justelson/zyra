import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import type { ResponseTimingRecord } from '@shared/response-timing'
import { SettingsButton, SettingsNotice, SettingsPageContainer, SettingsRow, SettingsSection } from './settings-layout'
import { ResponseTimingHistory } from './ResponseTimingHistory'
import { formatResponseTiming, summarizeResponseTimings } from './response-timing-summary'

export default function ResponseTimingPage() {
    return <SettingsPageContainer title="Response timings" backTo="/settings/data/diagnostics" backLabel="Diagnostics" showSettingsBack><ResponseTimingSettings /></SettingsPageContainer>
}

export function ResponseTimingSettings() {
    const [records, setRecords] = useState<ResponseTimingRecord[]>([])
    const [historyOpen, setHistoryOpen] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copyError, setCopyError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const load = async () => {
        setLoading(true)
        setError(null)
        setCopyError(null)
        setCopied(false)
        try {
            const result = await window.zyraDiagnostics?.read()
            if (!result?.success) throw new Error('read failed')
            setRecords(result.records)
        } catch { setError('Response timings could not be loaded. Try refreshing.') }
        finally { setLoading(false) }
    }
    useEffect(() => { void load() }, [])
    const copy = async () => {
        setCopied(false)
        setCopyError(null)
        try {
            const result = await window.devscope.copyToClipboard(JSON.stringify(records, null, 2))
            if (!result.success) throw new Error('copy failed')
            setCopied(true)
        } catch { setCopyError('Response timings could not be copied.') }
    }
    const summary = summarizeResponseTimings(records)
    return <>
        <SettingsSection title="Summary" headerAction={<div className="flex gap-1">
            <SettingsButton variant="ghost" onClick={() => void load()} disabled={loading}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} />Refresh</SettingsButton>
            <SettingsButton variant="ghost" onClick={() => void copy()} disabled={!records.length}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy timings'}</SettingsButton>
        </div>}>
            <SettingsRow title="Local diagnostics" description={null} layout="connection" className="!min-h-12 !py-3" status="Always on" statusTone="ready"
                info="Response timings are saved on this computer, up to 200 turns. Chat text and credentials are excluded. Sharing summaries follows your analytics preference in Privacy & data." />
            {error || copyError ? <SettingsNotice tone="error">{error || copyError}</SettingsNotice> : null}
            {records.length ? <>
                <SettingsRow title="Typical first text" description={null} layout="connection" className="!min-h-12 !py-3" info={`Median time from submission until this computer receives text, using ${summary.firstText.count} observed results from the ${summary.sampled} most recent completed turns, up to 20.`}
                    control={<span className="text-[13px] tabular-nums">{formatResponseTiming(summary.firstText.value)}</span>} />
                <SettingsRow title="Typical visible text" description={null} layout="connection" className="!min-h-12 !py-3" info={`Median time until text is first shown, using ${summary.visible.count} observed results from the ${summary.sampled} most recent completed turns. Hidden or collapsed text is not counted.`}
                    control={<span className="text-[13px] tabular-nums">{formatResponseTiming(summary.visible.value)}</span>} />
                <SettingsRow title="Recorded turns" description={null} layout="connection" className="!min-h-12 !py-3" info={`${summary.completed} completed, ${summary.running} running. Summaries use recent completed turns; raw timings include every retained outcome. A dash means the stage was not observed.`}
                    control={<span className="text-[13px] tabular-nums">{summary.total}</span>} />
                <SettingsRow title="Turn history" description={null} layout="connection" className="!min-h-12 !py-3" control={<SettingsButton variant="ghost" onClick={() => setHistoryOpen(true)}>View turns</SettingsButton>} />
            </> : !error ? <SettingsNotice>{loading ? 'Loading response timings…' : 'New chat timings will appear here.'}</SettingsNotice> : null}
        </SettingsSection>
        <ResponseTimingHistory records={records} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
}
