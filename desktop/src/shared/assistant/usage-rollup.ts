import { buildUsageSummary, emptyUsageTotals, usageWindow, type UsageDayModel, type UsageEntry, type UsageSummary, type UsageSummaryInput, type UsageTotals } from './usage-summary'
export type UsageRollup = { timeZone: string; fetchedAt: string; rows: UsageDayModel[] }
/** The compact day/model index lets every range and harness use the same cached data. */
export function buildUsageRollup(entries: UsageEntry[], timeZone: string, now = new Date()): UsageRollup {
    const rows = new Map<string,UsageDayModel>()
    buildUsageSummary(entries,{days:'all',timeZone},now,true,rows)
    return {timeZone,fetchedAt:now.toISOString(),rows:[...rows.values()]}
}
export function summarizeUsageRollup(rollup: UsageRollup, input: UsageSummaryInput, now = new Date()): UsageSummary {
    const selected = rollup.rows.filter(row => !input.harness || input.harness === 'all' || row.harness === input.harness)
    const today = usageWindow({timeZone:rollup.timeZone},now).dayKey(now)
    const earliest = selected.reduce((date,row)=>row.date < date ? row.date : date,today)
    // Day keys are already localized. Noon avoids crossing dates when passing the earliest key.
    const window = usageWindow({...input,timeZone:'UTC'},new Date(today+'T12:00:00Z'),earliest+'T12:00:00Z')
    const daily = new Map(window.dates.map(date=>[date,{date,...emptyUsageTotals()}]))
    const totals = emptyUsageTotals(), models = new Map<string,UsageDayModel>()
    const keys = Object.keys(totals) as Array<keyof UsageTotals>
    for (const row of selected) {
        const day = daily.get(row.date)
        if (!day) continue
        const model = models.get(row.id) || {...row,...emptyUsageTotals()}
        for (const key of keys) { totals[key] += row[key]; day[key] += row[key]; model[key] += row[key] }
        models.set(row.id,model)
    }
    return {days:window.days,timeZone:rollup.timeZone,fetchedAt:rollup.fetchedAt,totals,daily:[...daily.values()],dayModels:selected.filter(row=>daily.has(row.date)).map(row=>({...row})),models:[...models.values()].map(({date,...model})=>model).sort((a,b)=>b.tokens-a.tokens || a.id.localeCompare(b.id))}
}
