import type { UsageTotals } from '@shared/assistant/usage-summary'
import { formatUsageTokens } from './usage-presentation'

const kinds = [['input', 'Input', 'var(--settings-text-muted)'], ['cached', 'Cache read', 'var(--settings-text-secondary)'], ['cacheWrite', 'Cache write', 'var(--accent-secondary)'], ['output', 'Output', 'var(--settings-text)']] as const
export function UsageDistribution({ totals }: { totals: UsageTotals }) {
    return <section className="usage-distributions" aria-label="Usage composition">
        <div><h2 className="usage-section-title">Tokens by type</h2><div className="usage-distribution-track" aria-hidden="true">{kinds.map(([key, , color]) => <span key={key} style={{ width: `${totals.tokens ? totals[key] / totals.tokens * 100 : 0}%`, background: color }} />)}</div><div className="usage-distribution-legend">{kinds.map(([key, label, color]) => <span key={key}><i style={{ background: color }} />{label}<strong>{totals.meteredTurns || !totals.turns ? formatUsageTokens(totals[key]) : '—'}</strong></span>)}</div></div>
        <div><h2 className="usage-section-title">Pricing coverage</h2><div className="usage-distribution-track" aria-hidden="true"><span style={{ width: `${totals.turns ? totals.pricedTurns / totals.turns * 100 : 0}%`, background: 'var(--settings-text-secondary)' }} /></div><div className="usage-distribution-legend"><span><i style={{ background: 'var(--settings-text-secondary)' }} />Priced<strong>{totals.pricedTurns.toLocaleString()}</strong></span><span><i style={{ background: 'var(--settings-track)' }} />Unpriced<strong>{Math.max(0, totals.turns - totals.pricedTurns).toLocaleString()}</strong></span></div></div>
    </section>
}
