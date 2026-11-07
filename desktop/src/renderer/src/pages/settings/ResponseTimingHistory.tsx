import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ResponseTimingRecord } from '@shared/response-timing'
import { SettingsButton, SettingsDialog, SettingsNotice, SettingsSelect } from './settings-layout'
import { formatResponseTiming as timing, RESPONSE_TIMING_SORTS, sortResponseTimings, type ResponseTimingSort } from './response-timing-summary'

const stages = [
    ['mainReceivedMs', 'Desktop received submission'], ['dispatchMs', 'Runtime dispatch'], ['acceptedMs', 'Runtime accepted'],
    ['firstEventMs', 'First provider event'], ['firstTextMs', 'First provider text'],
    ['firstTextReceivedMs', 'Desktop received text'], ['firstDisplayMs', 'First visible text'], ['completedMs', 'Turn finished']
] as const
const shortDate = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function ResponseTimingHistory({ records, open, onClose }: { records: ResponseTimingRecord[]; open: boolean; onClose: () => void }) {
    const [sort, setSort] = useState<ResponseTimingSort>('newest')
    const [selected, setSelected] = useState<ResponseTimingRecord | null>(null)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const close = () => { setSelected(null); setCopied(false); setError(null); onClose() }
    const copy = async () => {
        setCopied(false)
        setError(null)
        try {
            const result = await window.devscope.copyToClipboard(JSON.stringify(selected, null, 2))
            if (!result.success) throw new Error('copy failed')
            setCopied(true)
        } catch { setError('This timing record could not be copied.') }
    }
    return <SettingsDialog open={open} title={selected ? 'Response timing' : 'Turn history'} onClose={close} className="max-w-[720px]"
        description="Times start at submission. Visible text is observed after a paint opportunity while text is in view. A dash means the stage was not observed. Provider activity gaps exclude tool execution."
        descriptionMode="info"
        footer={selected ? <><SettingsButton variant="ghost" onClick={() => { setSelected(null); setCopied(false); setError(null) }}>Back to history</SettingsButton><SettingsButton onClick={() => void copy()}>{copied ? 'Copied' : 'Copy record'}</SettingsButton></> : <SettingsButton variant="ghost" onClick={close}>Close</SettingsButton>}>
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        {selected ? <div className="space-y-4 text-xs">
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[var(--settings-text-secondary)]"><span>{selected.model}</span><span>· {new Date(selected.startedAt).toLocaleString()}</span><span>· {selected.effort} · {selected.outcome}</span></div>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 tabular-nums">
                {stages.map(([key, label]) => <div key={key} className="contents"><dt>{label}</dt><dd>{timing(selected[key])}</dd></div>)}
                <dt>Provider calls / runtime retries</dt><dd>{selected.requestCount} / {selected.retryCount}</dd>
                <dt>Compactions</dt><dd>{selected.compactionCount} · {timing(selected.compactionMs)}</dd>
                <dt>Longest provider activity gap</dt><dd>{timing(selected.maxStreamingGapMs)}</dd>
                {selected.requests.length ? <><dt>Latest provider activity after request start</dt><dd>{timing(selected.requests.at(-1)!.lastEventMs)}</dd></> : null}
                <dt>Desktop stall reports</dt><dd>{selected.stallCount} · longest {timing(selected.maxStallMs)}</dd>
                <dt>Main / renderer stall time</dt><dd>{timing(selected.mainStallMs)} / {timing(selected.rendererStallMs)}</dd>
            </dl>
        </div> : <div className="space-y-3">
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--settings-text-muted)]">{records.length} turns</span><SettingsSelect aria-label="Sort turns" value={sort} onChange={event => setSort(event.target.value as ResponseTimingSort)} className="!w-auto !min-w-0">{RESPONSE_TIMING_SORTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</SettingsSelect></div>
            <table aria-label="Response timing history" className="w-full text-xs">
                <thead><tr className="border-b border-[var(--settings-border)] text-[11px] text-[var(--settings-text-muted)]"><th className="py-2 text-left font-normal">Turn</th><th className="text-right font-normal">First text</th><th className="text-right font-normal">Visible</th><th aria-label="Details" /></tr></thead>
                <tbody>{sortResponseTimings(records, sort).map(row => <tr key={row.turnId} data-timing-turn={row.turnId} className="border-b border-[var(--settings-border)] last:border-0 hover:bg-[var(--settings-row-hover)]">
                    <td className="py-2 text-[var(--settings-text-secondary)]"><time dateTime={new Date(row.startedAt).toISOString()}>{shortDate(row.startedAt)}</time><span className="ml-3 hidden sm:inline">{row.model}</span></td>
                    <td className="pl-2 text-right tabular-nums">{timing(row.firstTextReceivedMs)}</td><td className="pl-3 text-right tabular-nums">{timing(row.firstDisplayMs)}</td>
                    <td className="w-9 pl-1"><SettingsButton variant="ghost" className="!w-8 !px-0" aria-label={`View timing for ${row.model}, ${new Date(row.startedAt).toLocaleString()}, ${row.outcome}`}
                        onClick={() => { setSelected(row); setCopied(false); setError(null) }}><ChevronRight size={14} /></SettingsButton></td>
                </tr>)}</tbody>
            </table>
        </div>}
    </SettingsDialog>
}
