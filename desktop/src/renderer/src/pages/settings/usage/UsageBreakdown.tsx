import { useMemo, useState } from 'react'
import { UsageDetailDialog } from './UsageDetailDialog'
import { usageSeriesColor, type UsageDetailSelection } from './usage-series'
import { usageProviderLabel, type UsageSummary } from '@shared/assistant/usage-summary'
import { SettingsSection } from '../settings-layout'
import { UsageChoice } from './UsageChoice'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { formatUsageTokens, formatUsageUsd, groupUsageRows, hasUsageValue, type UsageBreakdownSelection } from './usage-presentation'

export function UsageBreakdown({ summary, metric, mode, onMode }: { summary: UsageSummary; metric: 'cost' | 'tokens'; mode: UsageBreakdownSelection; onMode: (mode: UsageBreakdownSelection) => void }) {
    const [expanded, setExpanded] = useState(false)
    const [detail, setDetail] = useState<UsageDetailSelection | null>(null)
    const rows = useMemo(() => groupUsageRows(summary, mode, metric), [summary, mode, metric])
    const visible = expanded ? rows : rows.slice(0, 10)
    return <SettingsSection title="Breakdown" bodyClassName="px-4 pb-4" headerAction={<UsageChoice className="usage-breakdown-select" label="Group usage by" value={mode} onChange={onMode} options={[{ value: 'model', label: 'Model' }, { value: 'harness', label: 'Tool' }, { value: 'provider', label: 'Provider' }]} />}>
        <div className="usage-table-scroll"><table className="usage-breakdown-table"><thead><tr><th className="usage-rank">#</th><th>{mode === 'harness' ? 'Tool' : mode === 'provider' ? 'Provider' : 'Model'}</th><th>Cost</th><th>Share</th><th>Tokens</th></tr></thead><tbody>{visible.map((row, index) => <tr key={row.id} data-usage-row={row.id} onClick={event => { if (!(event.target as HTMLElement).closest('button')) { event.currentTarget.querySelector('button')?.focus(); setDetail({ mode, id: row.id, label: row.label }) } }}><td className="usage-rank">{index + 1}</td><td><button type="button" className="usage-table-name" aria-label={`View usage details for ${row.label}`} onClick={() => setDetail({ mode, id: row.id, label: row.label })}><i className="usage-color-dot" style={{ background: usageSeriesColor(mode, row.id) }} /><SettingsProviderIcon provider={mode === 'harness' ? row.harness === 'zyra-cli' ? 'zyra' : row.harness || '' : row.provider === 'anthropic' ? 'claude' : row.provider || ''} size={14} /><strong title={row.label}>{row.label}</strong></button><div className="usage-table-name-meta">{mode === 'model' && <span>{usageProviderLabel(row.provider || 'unknown')}</span>}<span>{row.totals.turns.toLocaleString()} records</span><span className="usage-share-rule" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, row.share * 100))}%`, background: usageSeriesColor(mode, row.id) }} /></span></div></td><td title={row.totals.pricedTurns < row.totals.turns ? `${row.totals.pricedTurns} of ${row.totals.turns} records have prices` : 'Recorded and estimated model cost'}>{hasUsageValue(row.totals, 'cost') ? `${formatUsageUsd(row.totals.costUsd)}${row.totals.pricedTurns < row.totals.turns ? ' *' : ''}` : 'Unpriced'}</td><td title={`Share of available ${metric}`}>{hasUsageValue(row.totals, metric) ? `${(row.share * 100).toFixed(1)}%` : '—'}</td><td title={row.totals.tokens.toLocaleString()}>{hasUsageValue(row.totals, 'tokens') ? formatUsageTokens(row.totals.tokens) : 'Unmetered'}</td></tr>)}</tbody></table></div>
        {!rows.length && <p className="usage-empty-copy">No recorded activity for this source and period.</p>}
        {rows.length > 10 && <button type="button" className="usage-show-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : `Show all ${rows.length}`}</button>}
        {detail && <UsageDetailDialog summary={summary} selection={detail} metric={metric} onClose={() => setDetail(null)} />}
    </SettingsSection>
}
