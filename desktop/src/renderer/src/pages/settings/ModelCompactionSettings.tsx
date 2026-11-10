import { useEffect, useState } from 'react'
import type { AssistantModelInfo } from '@shared/assistant/contracts'
import { getModelCompactionPresets, resolveModelCompactionPolicy } from '@shared/assistant/runtime-policy'
import { useSettings } from '@/lib/settings'
import { ChatDefaultModelPicker } from './ChatDefaultModelPicker'
import { loadSettingsModels, subscribeSettingsModels } from './settings-model-catalog-cache'
import { SettingsButton, SettingsNotice, SettingsRow, SettingsSection, SettingsSelect } from './settings-layout'

const tokensLabel = (tokens: number) => tokens.toLocaleString() + ' tokens'
const shortTokens = (tokens: number) => tokens >= 1_000 && tokens % 1_000 === 0 ? `${(tokens / 1_000).toLocaleString()}K` : tokens.toLocaleString()
type PricingTier = { inputTokensAbove: number; short: Record<string, number | null>; long: Record<string, number | null> | null }
export function compactionPricingLabel(tokens: number, tier?: PricingTier): string {
    if (!tier?.long || tokens <= tier.inputTokensAbove) return ''
    const labels = [['input', 'Input'], ['cacheRead', 'Cached input'], ['output', 'Output']] as const
    const changes = labels.flatMap(([key, label]) => {
        const short = tier.short[key], long = tier.long?.[key]
        return short != null && short > 0 && long != null && long !== short ? [`${label} ${Number((long / short).toFixed(2))}×`] : []
    })
    return changes.length ? ` · ${changes.join(', ')} API-equivalent` : ''
}

export function ModelCompactionSettings() {
    const { settings, updateSettings } = useSettings()
    const overrides = settings.assistantModelCompactionOverrides
    const [models, setModels] = useState<AssistantModelInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        let mounted = true
        void loadSettingsModels().then(value => { if (mounted) { setModels(value); setLoading(false) } }).catch(() => {
            if (mounted) { setError('Connected models could not be loaded. Saved overrides are preserved.'); setLoading(false) }
        })
        const unsubscribe = subscribeSettingsModels(setModels)
        return () => { mounted = false; unsubscribe() }
    }, [])
    const save = async (next: Record<string, number>) => {
        setError(null)
        try { await updateSettings({ assistantModelCompactionOverrides: next }) }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save compaction settings.') }
    }
    const remove = (id: string) => { const next = { ...overrides }; delete next[id]; void save(next) }
    const add = (id: string) => {
        const model = models.find(entry => entry.id === id)
        if (!model) return
        const policy = resolveModelCompactionPolicy(model)
        if (policy.thresholdTokens != null && policy.maxThresholdTokens != null) void save({ ...overrides, [id]: policy.thresholdTokens })
    }
    const available = models.filter(model => !Object.hasOwn(overrides, model.id) && resolveModelCompactionPolicy(model).maxThresholdTokens != null)
    return <SettingsSection title="Context" searchSection="Reasoning and context">
        <SettingsRow title="Auto-compaction" description="Use defaults or customize each model."
            status={Object.keys(overrides).length ? `${Object.keys(overrides).length} customized` : 'Use provider defaults'} statusTone="info"
            info="Changing this limit does not enable a larger context window. Models without a provider recommendation keep safe headroom. API-equivalent pricing is an estimate, not subscription quota usage. Legacy global limits remain saved but do not override per-model limits."
            control={<ChatDefaultModelPicker value="" models={available} onValueChange={add} ariaLabel="Customize models" defaultOptionLabel={loading ? 'Loading models…' : 'Customize models'} disabled={loading} />} />
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        {!loading && !models.length && !error ? <SettingsNotice>No connected models are available. Provider defaults remain active.</SettingsNotice> : null}
        {Object.entries(overrides).map(([id, value]) => {
            const model = models.find(entry => entry.id === id)
            const policy = resolveModelCompactionPolicy(model, overrides)
            const options = model ? getModelCompactionPresets(model) : []
            if (model && policy.maxThresholdTokens != null) options.push(Math.min(value, policy.maxThresholdTokens))
            const selected = model && policy.thresholdTokens != null ? policy.thresholdTokens : value
            const tier = model?.pricing?.tiers.standard as PricingTier | undefined
            const defaultLimit = resolveModelCompactionPolicy(model).thresholdTokens
            const pricing = compactionPricingLabel(selected, tier)
            const details = [
                policy.contextWindow != null ? `Context window: ${tokensLabel(policy.contextWindow)}.` : 'Context window unknown.',
                defaultLimit != null ? `Default limit: ${tokensLabel(defaultLimit)}.` : '',
                pricing ? `Pricing${pricing}.` : '',
                model?.metadataSource ? `Source: ${model.metadataSource}.` : ''
            ].filter(Boolean).join(' ')
            return <SettingsRow key={id} title={model?.label || id} description={!model ? 'Unavailable. Saved override is preserved until this model reconnects.'
                : policy.contextWindow == null ? 'Context window unknown; override is not applied.'
                : `${shortTokens(policy.contextWindow)} context${defaultLimit != null ? ` · ${shortTokens(defaultLimit)} default` : ''}`}
                info={details}
                control={<div className="flex min-w-0 items-center gap-2">
                    <SettingsSelect value={String(selected)} title={`${tokensLabel(selected)}${pricing}`} disabled={!model || !options.length} aria-label={`${model?.label || id} compaction limit`} onChange={event => event.target.value ? void save({ ...overrides, [id]: Number(event.target.value) }) : remove(id)}>
                        <option value="">Use provider defaults</option>
                        {[...new Set(options.length ? options : [value])].sort((a, b) => a - b).map(tokens => <option key={tokens} value={tokens}>{shortTokens(tokens)} tokens</option>)}
                    </SettingsSelect>
                    <SettingsButton variant="ghost" onClick={() => remove(id)} aria-label={`Remove ${model?.label || id} override`}>Remove</SettingsButton>
                </div>} />
        })}
    </SettingsSection>
}
