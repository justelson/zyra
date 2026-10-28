import { useMemo, useState } from 'react'
import { projectUsageChart, type UsageChartView } from '@shared/assistant/usage-chart'
import type { UsageSummary } from '@shared/assistant/usage-summary'
import { formatUsageDate, formatUsageMeasurement, formatUsageTokens, formatUsageUsd, hasUsageValue, usageMetricValue } from './usage-presentation'
import { usageCurvePaths, usageNiceScale } from './usage-chart-geometry'
import { UsageActivityChart } from './UsageActivityChart'
import { UsageChoice } from './UsageChoice'
import { buildUsageSeries, type UsageDetailSelection } from './usage-series'

const width = 960, height = 224, top = 8, bottom = 212
export function UsageTrendChart({ daily, summary, metric, view, onViewChange, onSelect }: { daily: UsageSummary['daily']; summary?: UsageSummary; metric: 'cost' | 'tokens'; view: UsageChartView; onViewChange: (view: UsageChartView) => void; onSelect?: (selection: UsageDetailSelection) => void }) {
    const [hovered, setHovered] = useState<{ date: string; index: number } | null>(null)
    const [seriesMode, setSeriesMode] = useState<'provider' | 'model'>('provider')
    const effectiveView = view === 'activity' && metric === 'cost' ? 'daily' : view
    const periods = useMemo(() => projectUsageChart(daily, effectiveView), [daily, effectiveView])
    const series = useMemo(() => summary ? buildUsageSeries(summary, seriesMode, metric, effectiveView) : [], [summary, seriesMode, metric, effectiveView])
    const geometry = useMemo(() => {
        const scale = usageNiceScale(Math.max(0, ...periods.map(day => usageMetricValue(day, metric))))
        const pointsFor = (rows: UsageSummary['daily']) => rows.map((day, index) => ({ x: periods.length === 1 ? width / 2 : index / Math.max(1, periods.length - 1) * width, y: bottom - usageMetricValue(day, metric) / scale.max * (bottom - top), known: hasUsageValue(day, metric) }))
        const points = pointsFor(periods)
        return { scale, points, paths: usageCurvePaths(points, bottom), series: series.map(row => { const points = pointsFor(row.daily); return { ...row, points, paths: usageCurvePaths(points, bottom) } }) }
    }, [periods, metric, series])
    if (effectiveView === 'activity') return <UsageActivityChart daily={daily} view={view} onViewChange={onViewChange} onSelectDay={onSelect ? date => onSelect({ mode: 'period', date, view: 'daily', label: formatUsageDate(date) }) : undefined} />
    const selected = hovered && periods[hovered.index]?.date === hovered.date ? periods[hovered.index] : null
    const point = selected && hovered ? geometry.points[hovered.index] : null
    const format = metric === 'cost' ? formatUsageUsd : formatUsageTokens
    const label = `${effectiveView === 'cumulative' ? 'Cumulative' : effectiveView === 'weekly' ? 'Weekly' : 'Daily'} ${metric === 'cost' ? 'cost' : 'processed tokens'}`
    const pick = (index: number) => { const safe = Math.max(0, Math.min(periods.length - 1, index)); if (periods[safe]) setHovered({ date: periods[safe].date, index: safe }) }
    const activate = (index: number) => { const day = periods[index]; if (day) onSelect?.({ mode: 'period', date: day.date, view: effectiveView, label: `${effectiveView === 'weekly' ? 'Week of ' : effectiveView === 'cumulative' ? 'Through ' : ''}${formatUsageDate(day.date)}` }) }
    return <section className="usage-trend" aria-label={label}>
        <div className="usage-section-heading"><h2>{label}</h2><UsageChoice label="Chart view" value={effectiveView} onChange={onViewChange} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'cumulative', label: 'Cumulative' }, ...(metric === 'tokens' ? [{ value: 'activity' as const, label: 'Activity' }] : [])]} /></div>
        {series.length > 0 && <div className="usage-series-controls" role="group" aria-label="Chart series">{(['provider', 'model'] as const).map(mode => <button type="button" key={mode} aria-pressed={seriesMode === mode} onClick={() => setSeriesMode(mode)}>{mode === 'provider' ? 'Providers' : 'Models'}</button>)}</div>}
        <div className="usage-trend-grid">
            <div className="usage-trend-scale" aria-hidden="true">{geometry.scale.ticks.map(tick => <span key={tick} style={{ top: `${(bottom - tick / geometry.scale.max * (bottom - top)) / height * 100}%` }}>{format(tick)}</span>)}</div>
            <div className="usage-trend-plot" tabIndex={0} role="group" aria-label={`${label}. Use arrow keys to inspect dates.${onSelect ? ' Press Enter to open details.' : ''}`} onFocus={() => pick(periods.length - 1)} onBlur={() => setHovered(null)} onPointerLeave={() => setHovered(null)} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); pick(Math.round((event.clientX - rect.left) / Math.max(1, rect.width) * (periods.length - 1))) }} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); activate(Math.max(0, Math.min(periods.length - 1, Math.round((event.clientX - rect.left) / Math.max(1, rect.width) * (periods.length - 1))))) }} onKeyDown={event => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); activate(hovered?.index ?? periods.length - 1) } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') setHovered(null); else pick(event.key === 'Home' ? 0 : event.key === 'End' ? periods.length - 1 : (hovered?.index ?? periods.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1)) } }}>
                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                    {geometry.scale.ticks.map(tick => <line key={tick} x1={0} x2={width} y1={bottom - tick / geometry.scale.max * (bottom - top)} y2={bottom - tick / geometry.scale.max * (bottom - top)} stroke="var(--settings-divider)" vectorEffect="non-scaling-stroke" />)}
                    {(geometry.series.length ? geometry.series : [{ id: 'aggregate', color: 'var(--settings-text)', paths: geometry.paths, points: geometry.points }]).map(row => <g key={row.id} data-usage-series={row.id} data-usage-color={row.color}>{row.paths.map((path, index) => <g key={index}>{!geometry.series.length && <path d={path.area} fill={row.color} fillOpacity={0.07} />}<path d={path.line} fill="none" stroke={row.color} strokeWidth={2} vectorEffect="non-scaling-stroke" /></g>)}{row.points.map((candidate, index, points) => candidate.known && !points[index - 1]?.known && !points[index + 1]?.known ? <circle key={index} cx={candidate.x} cy={candidate.y} r={3} fill={row.color} vectorEffect="non-scaling-stroke" /> : null)}</g>)}
                    {point && <><line x1={point.x} x2={point.x} y1={top} y2={bottom} stroke="var(--settings-text-muted)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />{point.known && !series.length && <circle cx={point.x} cy={point.y} r={4} fill="var(--settings-text)" vectorEffect="non-scaling-stroke" />}</>}
                </svg>
                {periods.some(day => day.turns) && !periods.some(day => metric === 'cost' ? day.pricedTurns : day.meteredTurns) && <p className="usage-chart-empty">{metric === 'cost' ? 'No prices available for this activity' : 'No token counts available'}</p>}
                {selected && point && <div data-usage-tooltip role="status" className="usage-trend-tooltip" style={{ left: `clamp(8px, calc(${point.x / width * 100}% - 104px), calc(100% - 216px))` }}><strong>{formatUsageDate(selected.date)}</strong><span>{formatUsageMeasurement(selected, metric)}</span><small>{selected.turns.toLocaleString()} records · {metric === 'cost' ? `${formatUsageMeasurement(selected, 'tokens')}${hasUsageValue(selected, 'tokens') ? ' tokens' : ''}` : formatUsageMeasurement(selected, 'cost')}</small>{selected.turns > selected.pricedTurns && metric === 'cost' && <small>{selected.turns - selected.pricedTurns} unpriced</small>}{series.map(row => <small key={row.id}><i className="usage-color-dot" style={{ background: row.color }} />{row.label}: {formatUsageMeasurement(row.daily[hovered!.index], metric)}</small>)}</div>}
            </div>
        </div>
        <div className="usage-trend-dates" aria-hidden="true">{[0, Math.floor((periods.length - 1) / 2), periods.length - 1].filter((value, index, values) => value >= 0 && values.indexOf(value) === index).map(index => <span key={index}>{formatUsageDate(periods[index].date)}</span>)}</div>
        {series.length > 0 && <ul className="usage-series-legend" aria-label={`${seriesMode === 'model' ? 'Model' : 'Provider'} chart legend`}>{series.map(row => <li key={row.id}>{onSelect ? <button type="button" data-usage-legend={row.id} onClick={() => onSelect({ mode: seriesMode, id: row.id, label: row.label })}><i className="usage-color-dot" style={{ background: row.color }} />{row.label}</button> : <span data-usage-legend={row.id}><i className="usage-color-dot" style={{ background: row.color }} />{row.label}</span>}</li>)}</ul>}
    </section>
}
