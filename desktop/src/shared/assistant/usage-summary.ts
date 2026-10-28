import { estimateAssistantTurnCostUsd } from './pricing'
import type { AssistantSessionTurnUsageEntry } from './contracts'

export type UsageRange = 7 | 30 | 90 | 365 | 'all'
export type UsageHarness = 'zyra' | 'codex' | 'claude' | 'opencode' | 'pi' | 'devscope' | 'zyra-cli'
export type UsageSummaryInput = { days?: UsageRange; timeZone?: string; harness?: UsageHarness | 'all' }
export const usageHarnessLabels: Record<UsageHarness, string> = { zyra: 'Zyra', codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', pi: 'Pi', devscope: 'DevScope', 'zyra-cli': 'Zyra CLI' }
export type UsageSource = { id: UsageHarness; state: 'ready' | 'indexing' | 'missing' | 'error'; files: number; records: number; updatedAt?: string; error?: string }
export type UsageEntry = Pick<AssistantSessionTurnUsageEntry, 'id' | 'model' | 'requestedAt' | 'usage'> & Partial<Pick<AssistantSessionTurnUsageEntry, 'threadId' | 'sessionId' | 'updatedAt' | 'serviceTier'>> & { harness?: UsageHarness; providerResponseId?: string }
export type UsageTotals = { input: number; output: number; cached: number; cacheWrite: number; tokens: number; costUsd: number; turns: number; meteredTurns: number; pricedTurns: number }
export type UsageBreakdown = UsageTotals & { id: string; provider: string; model: string; harness?: UsageHarness }
export type UsageDayModel = UsageBreakdown & { date: string }
export type UsageSummary = { days: number; timeZone: string; fetchedAt: string; totals: UsageTotals; daily: Array<UsageTotals & { date: string }>; models: UsageBreakdown[]; /** Real date/model buckets; absent on legacy summaries, never inferred from totals. */ dayModels?: UsageDayModel[]; sources?: UsageSource[] }
export const emptyUsageTotals = (): UsageTotals => ({ input: 0, output: 0, cached: 0, cacheWrite: 0, tokens: 0, costUsd: 0, turns: 0, meteredTurns: 0, pricedTurns: 0 })
const usageTotalFields = Object.keys(emptyUsageTotals()) as Array<keyof UsageTotals>
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const number = (value: unknown) => finite(value) ? value : 0
export function usageWindow(input: UsageSummaryInput = {}, now = new Date(), earliest?: string) {
    if (![7, 30, 90, 365, 'all'].includes(input.days ?? 30)) throw new Error('Choose a supported usage range.')
    if (input.harness && input.harness !== 'all' && !Object.hasOwn(usageHarnessLabels,input.harness)) throw new Error('Unknown usage source.')
    const timeZone = input.timeZone || 'UTC'
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const dayKey = (date: Date) => {
        return formatter.format(date)
    }
    const today = new Date(dayKey(now) + 'T12:00:00Z')
    const days = input.days === 'all' ? Math.max(1, Math.min(36525, Math.floor((today.getTime() - Date.parse((earliest ? dayKey(new Date(earliest)) : dayKey(now)) + 'T12:00:00Z')) / 86400000) + 1)) : input.days ?? 30
    const dates = Array.from({ length: days }, (_, index) => new Date(today.getTime() - (days - 1 - index) * 86400000).toISOString().slice(0, 10))
    return { days, timeZone, dates, dayKey, since: input.days === 'all' ? new Date(0).toISOString() : new Date(Date.parse(dates[0] + 'T00:00:00Z') - 86400000).toISOString() }
}
export function buildUsageSummary(turns: readonly UsageEntry[], input: UsageSummaryInput = {}, now = new Date(), deduplicated = false, dayModels?: Map<string, UsageDayModel>): UsageSummary {
    let earliest: string | undefined
    if (input.days === 'all') {
        let earliestTime = now.getTime()
        for (const turn of turns) {
            const time = Date.parse(turn.requestedAt)
            if (Number.isFinite(time) && time >= 0 && time < earliestTime) { earliestTime = time; earliest = new Date(time).toISOString() }
        }
    }
    const window = usageWindow(input, now, earliest)
    const buckets = dayModels || new Map<string, UsageDayModel>()
    const daily = new Map(window.dates.map(date => [date, { date, ...emptyUsageTotals() }]))
    const models = new Map<string, UsageBreakdown>()
    const totals = emptyUsageTotals()
    const unique = new Map<string, UsageEntry>()
    if (!deduplicated) for (const turn of turns) {
        const key = `${turn.harness || 'zyra'}:${turn.threadId || turn.sessionId || ''}:${turn.id}`
        const prior = unique.get(key)
        if (!prior || (turn.updatedAt || turn.requestedAt) >= (prior.updatedAt || prior.requestedAt)) unique.set(key, turn)
    }
    for (const turn of deduplicated ? turns : unique.values()) {
        const timestamp = new Date(turn.requestedAt)
        if (!Number.isFinite(timestamp.getTime()) || timestamp > now) continue
        const day = daily.get(window.dayKey(timestamp))
        if (!day) continue
        const slash = turn.model.indexOf('/')
        const provider = slash > 0 ? turn.model.slice(0, slash) : /^(gpt-|o[1-9]|codex)/i.test(turn.model) ? 'openai-codex' : 'unknown'
        const model = slash > 0 ? turn.model.slice(slash + 1) : turn.model || 'Unknown model'
        const harness = turn.harness || 'zyra'
        const id = `${harness}:${provider}/${model}`
        const group = models.get(id) || { id, provider, model, harness, ...emptyUsageTotals() }
        models.set(id, group)
        const usage = turn.usage
        const values = emptyUsageTotals()
        values.turns = 1
        if (usage) {
            // Pi reports cache separately; legacy Codex totals include cached input.
            const includesCache = usage.inputIncludesCachedTokens ?? (slash < 0 && provider === 'openai-codex')
            values.cached = number(usage.cachedInputTokens)
            values.cacheWrite = number(usage.cacheWriteTokens)
            values.input = Math.max(0, number(usage.inputTokens) - (includesCache ? values.cached + values.cacheWrite : 0))
            values.output = number(usage.outputTokens)
            // totalTokens is sometimes the current context size, not consumed tokens.
            values.tokens = values.input + values.output + values.cached + values.cacheWrite
            values.meteredTurns = [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteTokens].some(finite) ? 1 : 0
            const estimatedCost = estimateAssistantTurnCostUsd(turn.model, { ...usage, inputIncludesCachedTokens: includesCache }, turn.serviceTier)
            const cost = usage.costSource !== 'unpriced' && finite(usage.costUsd)
                && (usage.costSource === 'reported' || usage.costUsd > 0 || estimatedCost === 0 || values.tokens === 0)
                ? usage.costUsd : estimatedCost
            if (finite(cost)) { values.costUsd = cost; values.pricedTurns = 1 }
        }
        {
            const key = `${day.date}:${id}`
            const row = buckets.get(key) || { date:day.date,id,provider,model,harness,...emptyUsageTotals() }
            for (const field of usageTotalFields) row[field] += values[field]
            buckets.set(key,row)
        }
        for (const key of usageTotalFields) { totals[key] += values[key]; group[key] += values[key]; day[key] += values[key] }
    }
    return { days: window.days, timeZone: window.timeZone, fetchedAt: now.toISOString(), totals, daily: [...daily.values()], models: [...models.values()].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id)), dayModels: [...buckets.values()] }
}
export function mergeUsageSummaries(left: UsageSummary, right: UsageSummary): UsageSummary {
    const totals = emptyUsageTotals()
    const daily = new Map<string, UsageSummary['daily'][number]>()
    for (const summary of [left, right]) {
        for (const key of usageTotalFields) totals[key] += summary.totals[key]
        for (const day of summary.daily) {
            const row = daily.get(day.date) || { date: day.date, ...emptyUsageTotals() }
            for (const key of usageTotalFields) row[key] += day[key]
            daily.set(day.date, row)
        }
    }
    // A mixed legacy merge cannot claim complete time series for its models.
    const buckets = new Map<string, UsageDayModel>()
    const complete = [left, right].every(summary => summary.dayModels !== undefined || summary.totals.turns === 0)
    if (complete) for (const bucket of [...left.dayModels || [], ...right.dayModels || []]) {
        const key = `${bucket.date}:${bucket.id}`
        const row = buckets.get(key) || { ...bucket, ...emptyUsageTotals() }
        for (const field of usageTotalFields) row[field] += bucket[field]
        buckets.set(key, row)
    }
    return { ...left, dayModels: complete ? [...buckets.values()] : undefined, fetchedAt: left.fetchedAt < right.fetchedAt ? left.fetchedAt : right.fetchedAt, totals, days: daily.size, daily: [...daily.values()].sort((a,b) => a.date.localeCompare(b.date)), models: [...left.models, ...right.models].sort((a,b) => b.tokens-a.tokens), sources: [...left.sources || [], ...right.sources || []] }
}
export const usageProviderLabel = (provider: string) => ({ 'openai-codex': 'ChatGPT', openai: 'OpenAI', anthropic: 'Anthropic', opencode: 'OpenCode', 'opencode-zen': 'OpenCode Zen', unknown: 'Unknown provider' }[provider] || provider)
