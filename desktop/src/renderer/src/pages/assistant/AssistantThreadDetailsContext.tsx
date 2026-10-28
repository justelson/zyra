import { formatAssistantUsd } from '@shared/assistant/pricing'
import { cn } from '@/lib/utils'
import {
    formatPiTokenCount,
    type AssistantThreadUsageSummary
} from './assistant-thread-details'

export function AssistantThreadDetailsContext({
    usage,
    loading,
    className
}: {
    usage: AssistantThreadUsageSummary
    loading: boolean
    className?: string
}) {
    const contextPercent = usage.contextPercent == null ? null : Math.max(0, usage.contextPercent)
    const displayedPercent = contextPercent == null ? null : Math.min(100, contextPercent)
    const contextLimit = usage.contextLimit || usage.contextWindow
    const autoCompaction = usage.autoCompactionEnabled !== false
    const contextTone = contextPercent == null
        ? 'bg-white/15'
        : contextPercent >= 90
            ? 'bg-red-400'
            : contextPercent >= 70
                ? 'bg-amber-400'
                : 'bg-emerald-400'
    const costDisplay = usage.costUsd == null
        ? loading ? 'Reading…' : '—'
        : formatAssistantUsd(usage.costUsd)
    const costTitle = usage.costSource === 'recorded'
        ? 'Calculated from model usage recorded for this thread. Account billing may differ.'
        : usage.costSource === 'estimated'
            ? 'Estimated from the turn usage currently available for this thread.'
            : 'Model cost is not available yet.'

    return (
        <section className={cn('border-t border-white/[0.06] pt-3.5', className)} aria-labelledby="thread-context-heading">
            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <h3 id="thread-context-heading" className="text-[10px] font-semibold text-sparkle-text-secondary">Context</h3>
                    <p className="mt-1 truncate text-[9px] text-sparkle-text-muted/45">
                        {autoCompaction ? 'Automatic compaction limit' : 'Model context window'}
                    </p>
                </div>
                <div className="shrink-0 text-right">
                    <span className="font-mono text-[15px] font-medium tabular-nums text-sparkle-text">
                        {contextPercent == null ? '—' : `${contextPercent.toFixed(1)}%`}
                    </span>
                    {contextLimit ? <span className="ml-1 font-mono text-[9px] text-sparkle-text-muted/45">/ {formatPiTokenCount(contextLimit)}</span> : null}
                </div>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedPercent == null ? undefined : Math.round(displayedPercent)}>
                <div className={cn('h-full transition-[width] duration-300', contextTone)} style={{ width: `${displayedPercent || 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[8px] text-sparkle-text-muted/45">
                <span>{usage.contextTokens ? `${formatPiTokenCount(usage.contextTokens)} in context` : loading ? 'Reading context…' : 'Available after a completed turn'}</span>
                <span>{contextLimit ? `${autoCompaction ? 'compacts at' : 'window'} ${formatPiTokenCount(contextLimit)}` : ''}</span>
            </div>

            <dl className="mt-3 space-y-1.5 border-t border-white/[0.05] pt-3 text-[9px]" aria-label="Cache reuse">
                {[['Whole chat', usage.cacheHitPercent], ['Latest turn', usage.turnCacheHitPercent], ['Latest request', usage.latestRequestCacheHitPercent]].map(([label, percent]) => (
                    <div key={String(label)} className="flex items-center justify-between gap-3">
                        <dt className="text-sparkle-text-muted/50">{label} cache reuse</dt>
                        <dd className="font-mono text-sparkle-text-secondary">{typeof percent === 'number' ? `${percent.toFixed(1)}%` : '—'}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-white/[0.05] pt-3" title={costTitle} data-thread-model-cost={usage.costUsd == null ? 'unavailable' : usage.costSource}>
                <span className="text-[9px] text-sparkle-text-muted/50">Estimated model cost</span>
                <strong className="font-mono text-[12px] font-medium tabular-nums text-sparkle-text-secondary">{costDisplay}</strong>
            </div>
        </section>
    )
}
