import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { UsageSummary } from '@shared/assistant/usage-summary'
import type { UsageChartView } from '@shared/assistant/usage-chart'
import { formatUsageMeasurement, formatUsageTokens, groupUsageRows, hasUsageValue, type UsageMetric } from './usage-presentation'
import { scopeUsageSummary, usageSeriesColor, type UsageDetailSelection } from './usage-series'
import { UsageTrendChart } from './UsageTrendChart'
import { UsageMeasurementCoverage } from './UsageMeasurementCoverage'
import './UsageDetails.css'

/** Native modal top layer makes the rest of Settings inert and traps keyboard focus. */
export function UsageDetailDialog({ summary, selection, metric, onClose }: { summary: UsageSummary; selection: UsageDetailSelection; metric: UsageMetric; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const title = useId(), description = useId()
    const [view, setView] = useState<UsageChartView>('daily')
    const scoped = useMemo(() => scopeUsageSummary(summary, selection), [summary, selection])
    const rows = groupUsageRows(scoped, selection.mode === 'model' ? 'harness' : 'model', metric)
    // A wholly unpriced selection still has a useful, truthful token trend.
    const trendMetric = metric === 'cost' && !hasUsageValue(scoped.totals, 'cost') ? 'tokens' : metric
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        const node = dialog.current!
        node.showModal()
        return () => { node.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
    }, [])
    return <dialog ref={dialog} className="usage-detail-dialog" aria-labelledby={title} aria-describedby={description} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
        <header className="usage-detail-header"><h2 id={title}>{selection.label}</h2><button type="button" autoFocus aria-label="Close usage details" onClick={onClose}>Close</button></header>
        <p id={description} className="usage-detail-description">{scoped.daily[0]?.date} to {scoped.daily.at(-1)?.date} · {summary.timeZone}{selection.mode === 'period' && selection.view === 'weekly' ? ' · Selected week, limited to this period' : selection.mode === 'period' && selection.view === 'cumulative' ? ' · Through selected date' : ''}</p>
        <dl className="usage-detail-stats"><div><dt>Cost</dt><dd>{formatUsageMeasurement(scoped.totals, 'cost')}</dd></div><div><dt>Tokens</dt><dd>{formatUsageMeasurement(scoped.totals, 'tokens')}</dd></div><div><dt>Records</dt><dd>{scoped.totals.turns.toLocaleString()}</dd></div></dl>
        {scoped.dayModels !== undefined ? <UsageTrendChart daily={scoped.daily} summary={scoped} metric={trendMetric} view={view} onViewChange={setView} /> : <p className="usage-quiet-copy">Daily model details are unavailable for this older summary. No daily distribution has been inferred.</p>}
        <section aria-label="Tokens by type"><h3 className="usage-section-title">Tokens by type</h3><dl className="usage-detail-token-mix">{([['input', 'Uncached input'], ['cached', 'Cached input'], ['output', 'Output'], ['cacheWrite', 'Cache write']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{hasUsageValue(scoped.totals, 'tokens') ? `${formatUsageTokens(scoped.totals[key])}${scoped.totals.meteredTurns < scoped.totals.turns ? ' *' : ''}` : 'Unmetered'}</dd></div>)}</dl></section>
        <UsageMeasurementCoverage totals={scoped.totals} />
        {rows.length > 0 && <section aria-label="Selected usage breakdown"><h3 className="usage-section-title">{selection.mode === 'model' ? 'By tool' : 'By model'}</h3><ul className="usage-detail-rows">{rows.map(row => <li key={row.id}><span><i className="usage-color-dot" style={{ background: usageSeriesColor(selection.mode === 'model' ? 'harness' : 'model', row.id) }} />{row.label}</span><span>{formatUsageMeasurement(row.totals, metric)}</span></li>)}</ul></section>}
        {!scoped.totals.turns && <p className="usage-quiet-copy">No recorded activity in this selection.</p>}
    </dialog>
}
