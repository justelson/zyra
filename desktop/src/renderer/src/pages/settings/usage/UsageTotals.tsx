import type { UsageTotals as Totals } from '@shared/assistant/usage-summary'
import { formatUsageTokens } from './usage-presentation'

const fields = [['tokens', 'Processed tokens'], ['cached', 'Cached input'], ['input', 'Uncached input'], ['output', 'Output'], ['cacheWrite', 'Cache write']] as const
export function UsageTotals({ totals }: { totals: Totals }) {
    return <section aria-label="Usage totals"><h2 className="usage-section-title">Totals</h2><div className="usage-totals">{fields.map(([key, label]) => <div key={key}><span>{label}</span><strong title={totals[key].toLocaleString()}>{totals.meteredTurns || !totals.turns ? formatUsageTokens(totals[key]) : '—'}</strong></div>)}</div></section>
}
