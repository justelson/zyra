import { useMemo, useState } from 'react'
import { projectUsageChart, type UsageChartView } from '@shared/assistant/usage-chart'
import type { UsageSummary } from '@shared/assistant/usage-summary'
import { formatUsageDate, formatUsageMeasurement, formatUsageTokens, formatUsageUsd, hasUsageValue, usageMetricValue } from './usage-presentation'
import { usageCurvePaths, usageNiceScale } from './usage-chart-geometry'
import { UsageActivityChart } from './UsageActivityChart'

const width = 960, height = 224, top = 8, bottom = 212
export function UsageTrendChart({ daily, metric, view, onViewChange }: { daily: UsageSummary['daily']; metric: 'cost' | 'tokens'; view: UsageChartView; onViewChange: (view: UsageChartView) => void }) {
    const [hovered, setHovered] = useState<{ date: string; index: number } | null>(null)
    const effectiveView = view === 'activity' && metric === 'cost' ? 'daily' : view
    const periods = useMemo(() => projectUsageChart(daily, effectiveView), [daily, effectiveView])
    const geometry = useMemo(() => {
        const scale = usageNiceScale(Math.max(0, ...periods.map(day => usageMetricValue(day, metric))))
        const points = periods.map((day, index) => ({ x: periods.length === 1 ? width / 2 : index / Math.max(1, periods.length - 1) * width, y: bottom - usageMetricValue(day, metric) / scale.max * (bottom - top), known: hasUsageValue(day, metric) }))
        return { scale, points, paths: usageCurvePaths(points, bottom) }
    }, [periods, metric])
    if (effectiveView === 'activity') return <UsageActivityChart daily={daily} view={view} onViewChange={onViewChange} />
    const selected = hovered && periods[hovered.index]?.date === hovered.date ? periods[hovered.index] : null
    const point = selected && hovered ? geometry.points[hovered.index] : null
    const format = metric === 'cost' ? formatUsageUsd : formatUsageTokens
    const label = `${effectiveView === 'cumulative' ? 'Cumulative' : effectiveView === 'weekly' ? 'Weekly' : 'Daily'} ${metric === 'cost' ? 'cost' : 'processed tokens'}`
    const pick = (index: number) => { const safe = Math.max(0, Math.min(periods.length - 1, index)); if (periods[safe]) setHovered({ date: periods[safe].date, index: safe }) }
    return <section className="usage-trend" aria-label={label}>
        <div className="usage-section-heading"><h2>{label}</h2><select aria-label="Chart view" value={effectiveView} onChange={event => onViewChange(event.target.value as UsageChartView)} className="usage-quiet-select"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="cumulative">Cumulative</option>{metric === 'tokens' && <option value="activity">Activity</option>}</select></div>
        <div className="usage-trend-grid">
            <div className="usage-trend-scale" aria-hidden="true">{geometry.scale.ticks.map(tick => <span key={tick} style={{ top: `${(bottom - tick / geometry.scale.max * (bottom - top)) / height * 100}%` }}>{format(tick)}</span>)}</div>
            <div className="usage-trend-plot" tabIndex={0} role="group" aria-label={`${label}. Use arrow keys to inspect dates.`} onFocus={() => pick(periods.length - 1)} onBlur={() => setHovered(null)} onPointerLeave={() => setHovered(null)} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); pick(Math.round((event.clientX - rect.left) / Math.max(1, rect.width) * (periods.length - 1))) }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') setHovered(null); else pick(event.key === 'Home' ? 0 : event.key === 'End' ? periods.length - 1 : (hovered?.index ?? periods.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)) } }}>
                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                    {geometry.scale.ticks.map(tick => <line key={tick} x1={0} x2={width} y1={bottom - tick / geometry.scale.max * (bottom - top)} y2={bottom - tick / geometry.scale.max * (bottom - top)} stroke="var(--settings-divider)" vectorEffect="non-scaling-stroke" />)}
                    {geometry.paths.map((path, index) => <g key={index}><path d={path.area} fill="var(--settings-text)" fillOpacity={0.07} /><path d={path.line} fill="none" stroke="var(--settings-text)" strokeWidth={2} vectorEffect="non-scaling-stroke" /></g>)}
                    {geometry.points.map((candidate, index, points) => candidate.known && !points[index - 1]?.known && !points[index + 1]?.known ? <circle key={index} cx={candidate.x} cy={candidate.y} r={3} fill="var(--settings-text)" vectorEffect="non-scaling-stroke" /> : null)}
                    {point && <><line x1={point.x} x2={point.x} y1={top} y2={bottom} stroke="var(--settings-text-muted)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />{point.known && <circle cx={point.x} cy={point.y} r={4} fill="var(--accent-primary)" vectorEffect="non-scaling-stroke" />}</>}
                </svg>
                {periods.some(day => day.turns) && !periods.some(day => metric === 'cost' ? day.pricedTurns : day.meteredTurns) && <p className="usage-chart-empty">{metric === 'cost' ? 'No prices available for this activity' : 'No token counts available'}</p>}
                {selected && point && <div data-usage-tooltip role="status" className="usage-trend-tooltip" style={{ left: `clamp(8px, calc(${point.x / width * 100}% - 104px), calc(100% - 216px))` }}><strong>{formatUsageDate(selected.date)}</strong><span>{formatUsageMeasurement(selected, metric)}</span><small>{selected.turns.toLocaleString()} records · {metric === 'cost' ? `${formatUsageMeasurement(selected, 'tokens')}${hasUsageValue(selected, 'tokens') ? ' tokens' : ''}` : formatUsageMeasurement(selected, 'cost')}</small>{selected.turns > selected.pricedTurns && metric === 'cost' && <small>{selected.turns - selected.pricedTurns} unpriced</small>}</div>}
            </div>
        </div>
        <div className="usage-trend-dates" aria-hidden="true">{[0, Math.floor((periods.length - 1) / 2), periods.length - 1].filter((value, index, values) => value >= 0 && values.indexOf(value) === index).map(index => <span key={index}>{formatUsageDate(periods[index].date)}</span>)}</div>
    </section>
}
