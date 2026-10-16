import { useMemo, useState } from 'react'
import { usageProviderLabel, type UsageSummary } from '@shared/assistant/usage-summary'
import { createSettingsSectionTargetId } from '../settings-search'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { formatUsageTokens, formatUsageUsd, groupUsageRows, hasUsageValue, type UsageBreakdownMode } from './usage-presentation'

export function UsageBreakdown({ summary, metric, mode, onMode }: { summary: UsageSummary; metric: 'cost' | 'tokens'; mode: UsageBreakdownMode; onMode: (mode: UsageBreakdownMode) => void }) {
    const [expanded, setExpanded] = useState(false)
    const rows = useMemo(() => groupUsageRows(summary, mode, metric), [summary, mode, metric])
    const visible = expanded ? rows : rows.slice(0, 10)
    return <section aria-label="Breakdown" data-settings-section-title="Breakdown" data-settings-search-target={createSettingsSectionTargetId('Breakdown')} tabIndex={-1}>
        <div className="usage-section-heading"><h2>Breakdown</h2><div className="usage-segmented usage-breakdown-modes" role="group" aria-label="Group usage by">{(['model', 'day', 'harness', 'provider'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onMode(value)}>{value === 'model' ? 'Model' : value === 'day' ? 'Day' : value === 'harness' ? 'Tool' : 'Provider'}</button>)}</div></div>
        <div className="usage-table-scroll"><table className="usage-breakdown-table"><thead><tr><th className="usage-rank">#</th><th>{mode === 'day' ? 'Day' : mode === 'harness' ? 'Tool' : mode === 'provider' ? 'Provider' : 'Model'}</th><th>Cost</th><th>Share</th><th>Tokens</th></tr></thead><tbody>{visible.map((row, index) => <tr key={row.id}><td className="usage-rank">{index + 1}</td><td><span className="usage-table-name">{mode !== 'day' && <SettingsProviderIcon provider={mode === 'harness' ? row.harness === 'zyra-cli' ? 'zyra' : row.harness || '' : row.provider === 'anthropic' ? 'claude' : row.provider || ''} size={14} />}<strong title={row.label}>{row.label}</strong></span><div className="usage-table-name-meta">{mode === 'model' && <span>{usageProviderLabel(row.provider || 'unknown')}</span>}<span>{row.totals.turns.toLocaleString()} records</span><span className="usage-share-rule" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, row.share * 100))}%` }} /></span></div></td><td title={row.totals.pricedTurns < row.totals.turns ? `${row.totals.pricedTurns} of ${row.totals.turns} records have prices` : 'Recorded and estimated model cost'}>{hasUsageValue(row.totals, 'cost') ? `${formatUsageUsd(row.totals.costUsd)}${row.totals.pricedTurns < row.totals.turns ? ' *' : ''}` : 'Unpriced'}</td><td title={`Share of available ${metric}`}>{hasUsageValue(row.totals, metric) ? `${(row.share * 100).toFixed(1)}%` : '—'}</td><td title={row.totals.tokens.toLocaleString()}>{hasUsageValue(row.totals, 'tokens') ? formatUsageTokens(row.totals.tokens) : 'Unmetered'}</td></tr>)}</tbody></table></div>
        {!rows.length && <p className="usage-empty-copy">No recorded activity for this source and period.</p>}
        {rows.length > 10 && <button type="button" className="usage-show-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : `Show all ${rows.length}`}</button>}
    </section>
}
