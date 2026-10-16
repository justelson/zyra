import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, RefreshCw } from 'lucide-react'
import { usageHarnessLabels, type UsageRange, type UsageSummary, type UsageSummaryInput } from '@shared/assistant/usage-summary'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { formatUsageDate, type UsageMetric } from './usage-presentation'

export function UsageToolbar({ metric, days, harness, summary, busy, onMetric, onDays, onHarness, onRefresh }: {
    metric: UsageMetric; days: UsageRange; harness: NonNullable<UsageSummaryInput['harness']>; summary: UsageSummary | null; busy: boolean
    onMetric: (value: UsageMetric) => void; onDays: (value: UsageRange) => void; onHarness: (value: NonNullable<UsageSummaryInput['harness']>) => void; onRefresh: () => void
}) {
    const anchor = useRef<HTMLButtonElement>(null)
    const [open, setOpen] = useState(false)
    const limits = metric === 'limits'
    useEffect(() => setOpen(false), [metric])
    const label = harness === 'all' ? 'All local tools' : usageHarnessLabels[harness]
    const sourceState = (id: string) => summary?.sources?.find(source => source.id === id)
    return <header className="usage-toolbar">
        <div className="usage-breadcrumb"><Link to="/settings/providers" aria-label="Back to providers" className="usage-icon-button"><ArrowLeft size={14} /></Link><h1>Usage</h1><span className="usage-breadcrumb-slash">/</span><button ref={anchor} type="button" className="usage-source-trigger" aria-label={`Usage source: ${limits ? 'ChatGPT accounts' : label}`} disabled={limits} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(current => !current)}><span>{limits ? 'ChatGPT accounts' : label}</span>{!limits && <ChevronDown size={12} />}</button>{!limits && summary?.daily.length ? <span className="usage-range-caption">{formatUsageDate(summary.daily[0].date)} to {formatUsageDate(summary.daily[summary.daily.length - 1].date)}</span> : null}</div>
        <div className="usage-toolbar-controls">
            <div className="usage-segmented" role="group" aria-label="Usage metric">{(['cost', 'tokens', 'limits'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => onMetric(value)}>{value === 'cost' ? 'Cost' : value === 'tokens' ? 'Tokens' : 'Limits'}</button>)}</div>
            <div className="usage-segmented usage-period-tabs" role="group" aria-label="Usage period">{([7, 30, 90] as const).map(value => <button key={value} type="button" disabled={limits} aria-pressed={days === value} onClick={() => onDays(value)}>{value} days</button>)}<select aria-label="More usage periods" disabled={limits} value={days === 365 || days === 'all' ? days : ''} onChange={event => onDays(event.target.value === 'all' ? 'all' : 365)}><option value="" disabled>More</option><option value="365">1 year</option><option value="all">All time</option></select></div>
            <select className="usage-quiet-select usage-period-select" aria-label="Usage period" disabled={limits} value={days} onChange={event => onDays(event.target.value === 'all' ? 'all' : Number(event.target.value) as UsageRange)}>{([7, 30, 90, 365, 'all'] as const).map(value => <option key={value} value={value}>{value === 'all' ? 'All time' : value === 365 ? '1 year' : `${value} days`}</option>)}</select>
            <button type="button" className="usage-icon-button" disabled={busy} aria-label={limits ? 'Refresh limits' : 'Refresh usage'} aria-busy={busy} onClick={onRefresh}><RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} /></button>
        </div>
        {open && <AnchoredMenuPopover anchorRef={anchor} autoFocus label="Usage sources" onClose={() => setOpen(false)}>
            <div onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
                const current = rows.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length
                event.preventDefault(); event.stopPropagation(); rows[next]?.focus()
            }}>
            {(['all', ...Object.keys(usageHarnessLabels)] as Array<NonNullable<UsageSummaryInput['harness']>>).map(id => { const state = sourceState(id); return <button key={id} type="button" role="menuitemradio" aria-checked={harness === id} className="usage-source-option" onClick={() => { onHarness(id); setOpen(false) }}><span className="usage-source-check">{harness === id && <Check size={12} />}</span>{id !== 'all' && <SettingsProviderIcon provider={id === 'zyra-cli' ? 'zyra' : id} size={14} />}<span className="usage-source-name">{id === 'all' ? 'All local tools' : usageHarnessLabels[id]}</span>{state && <span className="usage-source-state" title={state.error}>{state.state === 'ready' ? `${state.records.toLocaleString()} records` : state.state === 'missing' ? 'No history' : state.state === 'indexing' ? 'Indexing' : 'Unavailable'}</span>}</button> })}
            {summary?.sources && <details className="usage-source-details"><summary>Source coverage</summary>{summary.sources.map(source => <p key={source.id}><strong>{usageHarnessLabels[source.id]}</strong><span>{source.state === 'ready' ? `${source.files.toLocaleString()} files · ${source.records.toLocaleString()} records` : source.state === 'missing' ? 'No local history found' : source.state === 'indexing' ? `Indexing · ${source.files.toLocaleString()} files` : source.error || 'Unavailable'}</span></p>)}<p>Canonical transcripts take precedence over summaries. Missing and unmetered history stays visible.</p></details>}
            <div className="usage-source-links"><Link to="/settings/providers" onClick={() => setOpen(false)}>Connections</Link><Link to="/settings/providers/models" onClick={() => setOpen(false)}>Models</Link><Link to="/settings/providers/limits" onClick={() => setOpen(false)}>Account limits</Link></div>
            </div>
        </AnchoredMenuPopover>}
    </header>
}
