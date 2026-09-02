import { memo, useEffect, useState } from 'react'
import type { AssistantTurnUsage } from '@shared/assistant/contracts'
import { resolveAssistantContextCompactionLimitTokens } from '@shared/assistant/runtime-policy'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { formatCompactMetric } from './AssistantPageHelpers'
import {
    readAssistantComposerUsageVisibility,
    subscribeAssistantComposerUsageVisibility
} from './assistant-composer-usage-visibility'

function getContextTone(percent: number | null): {
    ringColor: string
    textClass: string
    glowClass: string
} {
    if (percent == null) {
        return {
            ringColor: 'var(--color-text-muted)',
            textClass: 'text-sparkle-text-secondary',
            glowClass: 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-text)_5%,transparent)]'
        }
    }
    if (percent >= 90) {
        return {
            ringColor: 'var(--status-danger)',
            textClass: 'text-red-300',
            glowClass: 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--status-danger)_18%,transparent)]'
        }
    }
    if (percent >= 70) {
        return {
            ringColor: 'var(--status-warning)',
            textClass: 'text-amber-300',
            glowClass: 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--status-warning)_16%,transparent)]'
        }
    }
    return {
        ringColor: 'var(--status-success)',
        textClass: 'text-emerald-300',
        glowClass: 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--status-success)_16%,transparent)]'
    }
}

export const AssistantComposerContextIndicator = memo(function AssistantComposerContextIndicator({
    usage,
    modelContextWindow
}: {
    usage?: AssistantTurnUsage | null
    modelContextWindow?: number | null
}) {
    const { settings } = useSettings()
    const [visible, setVisible] = useState(readAssistantComposerUsageVisibility)
    useEffect(() => subscribeAssistantComposerUsageVisibility(setVisible), [])
    const usedTokens = usage?.totalTokens ?? null
    const contextWindowTokens = modelContextWindow ?? usage?.modelContextWindow ?? null
    const hasContextWindow = contextWindowTokens != null && Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
    const compactionLimitTokens = resolveAssistantContextCompactionLimitTokens(
        contextWindowTokens,
        settings.assistantContextCompactionThresholdTokens
    )
    const rawPercent = usedTokens != null && Number.isFinite(usedTokens)
        ? (usedTokens / compactionLimitTokens) * 100
        : null
    const displayPercent = rawPercent != null ? Math.max(0, Math.min(100, Math.round(rawPercent))) : null
    const visualPercent = rawPercent != null ? Math.max(0, Math.min(100, rawPercent)) : 0
    const tone = getContextTone(displayPercent)
    const centerLabel = displayPercent != null ? `${displayPercent}` : '--'
    const usageLabel = usedTokens != null
        ? `${formatCompactMetric(usedTokens)} / ${formatCompactMetric(compactionLimitTokens)} before compaction`
        : `Compaction limit: ${formatCompactMetric(compactionLimitTokens)} tokens`
    const windowLabel = hasContextWindow
        ? `Model window ${formatCompactMetric(contextWindowTokens)}`
        : 'Model window not reported'

    return (
        <div
            className="group/context assistant-composer-footer-context relative w-[32px] shrink-0"
            data-visible={visible}
            aria-hidden={!visible}
        >
            <button
                type="button"
                tabIndex={visible ? 0 : -1}
                className="inline-flex size-[32px] items-center justify-center rounded-full bg-transparent p-0 text-sparkle-text-secondary transition-[filter,transform] hover:brightness-110 focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/25 active:scale-95"
                title={displayPercent != null ? `Context before compaction ${displayPercent}% full` : 'Context usage unavailable'}
                aria-label={displayPercent != null ? `Context before compaction ${displayPercent}% full` : 'Context usage unavailable'}
            >
                <span
                    className={cn('relative flex size-[32px] items-center justify-center rounded-full', tone.glowClass)}
                    style={{
                        background: `conic-gradient(${tone.ringColor} 0deg ${visualPercent * 3.6}deg, color-mix(in srgb, var(--color-text) 9%, transparent) ${visualPercent * 3.6}deg 360deg)`
                    }}
                >
                    <span className="absolute inset-[4px] rounded-full bg-sparkle-card shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-text)_5%,transparent)]" />
                    <span className={cn('relative z-10 text-[8px] font-semibold tabular-nums', tone.textClass)}>
                        {centerLabel}
                    </span>
                </span>
            </button>

            <div className="pointer-events-none absolute bottom-full right-0 z-[170] mb-1.5 w-[176px] translate-y-0.5 opacity-0 transition-all duration-150 group-hover/context:pointer-events-auto group-hover/context:translate-y-0 group-hover/context:opacity-100 group-focus-within/context:pointer-events-auto group-focus-within/context:translate-y-0 group-focus-within/context:opacity-100">
                <div className="overflow-hidden rounded-[15px] border border-white/10 bg-sparkle-card/98 px-2.5 py-2 text-left shadow-[0_18px_36px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                    <div className="space-y-0.5">
                        <p className={cn('text-[13px] font-semibold leading-4 tracking-[-0.01em]', tone.textClass)}>
                            {displayPercent != null ? `${displayPercent}% full` : 'Waiting for usage'}
                        </p>
                        <p className="text-[10px] font-medium leading-3.5 text-sparkle-text">{usageLabel}</p>
                    </div>
                    <p className="mt-1.5 text-[9px] font-medium leading-3.5 text-sparkle-text-secondary">
                        {windowLabel} · auto-compacts at {formatCompactMetric(compactionLimitTokens)}
                    </p>
                </div>
            </div>
        </div>
    )
})
