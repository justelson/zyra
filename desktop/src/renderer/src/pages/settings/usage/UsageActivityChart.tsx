import './UsageActivityChart.css'
import { useMemo, useState } from 'react'
import { emptyUsageTotals, type UsageSummary, type UsageTotals } from '@shared/assistant/usage-summary'
import { formatUsageMeasurement } from './usage-presentation'
const activityMeasurement = (day: UsageTotals) => formatUsageMeasurement(day, 'tokens') + (day.turns > 0 && day.meteredTurns === 0 ? '' : ' tokens')
import { projectUsageChart, type UsageChartView } from '@shared/assistant/usage-chart'
import { UsageChoice } from './UsageChoice'
export const formatTokens = (value: number) => new Intl.NumberFormat(undefined, { notation:'compact', maximumFractionDigits:1 }).format(value)
export const formatDay = (date: string) => new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})
const labels = {daily:'Daily',cumulative:'Cumulative',weekly:'Weekly',activity:'Activity'}
export function UsageActivityChart({ daily, view, onViewChange, onSelectDay }: { daily: UsageSummary['daily']; view: UsageChartView; onViewChange:(view:UsageChartView)=>void; onSelectDay?: (date: string) => void }) {
    const [hovered,setHovered] = useState<string | null>(null)
    const [chosenYear,setChosenYear] = useState('')
    const years = [...new Set(daily.map(day => day.date.slice(0,4)))].reverse()
    const year = years.includes(chosenYear) ? chosenYear : years[0]
    const points = useMemo(() => projectUsageChart(daily,view),[daily,view])
    const selected = points.find(day => day.date === hovered)
    const max = Math.max(1,...points.map(day => day.tokens))
    const width = 720, height = 150, step = width / Math.max(1,points.length)
    const calendar = useMemo(() => {
        if (!year) return []
        const days = new Map(daily.map(day => [day.date,day]))
        const start = Date.parse(year+'-01-01T12:00:00Z'), end = Date.parse((Number(year)+1)+'-01-01T12:00:00Z')
        const offset = (new Date(start).getUTCDay()+6)%7
        return Array.from({length:(end-start)/86400000},(_,i) => {
            const date = new Date(start+i*86400000).toISOString().slice(0,10)
            return {...emptyUsageTotals(),...days.get(date),date, inRange:days.has(date),column:Math.floor((offset+i)/7),row:(offset+i)%7}
        })
    },[year,daily])
    const calendarMax = Math.max(1,...calendar.map(day => day.tokens))
    const active = selected || (view === 'activity' ? calendar.find(day => day.date === hovered) : undefined)
    return <div className="usage-trend min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium">Token activity</h2><UsageChoice label="Chart view" value={view} onChange={value => {onViewChange(value);setHovered(null)}} options={(Object.keys(labels) as UsageChartView[]).map(value => ({ value, label: labels[value] }))} /></div>
        <div className="flex min-h-5 items-center justify-between gap-3 text-[11px] text-[var(--settings-text-muted)]"><span>{active ? `${view==='weekly'?'Week of ':''}${formatDay(active.date)} · ${'inRange' in active && !active.inRange ? 'Outside selected period' : activityMeasurement(active)}` : view==='cumulative'?'Running total within the selected period':view==='weekly'?'Weeks start Monday; edge weeks may be partial':view==='activity'?'Each square is a day':'Tokens processed each day'}</span>{view==='activity'&&years.length>1&&<UsageChoice label="Activity year" value={year} onChange={value=>{setChosenYear(value);setHovered(null)}} options={years.map(value => ({ value, label: value }))} />}</div>
        <svg key={view} viewBox={`0 0 ${width} ${view==='activity'?132:height}`} className="usage-chart-view w-full overflow-visible" role="group" aria-label={`${labels[view]} token usage`} onMouseLeave={()=>setHovered(null)}>
            {view==='activity' ? <>
                {['Mon','Wed','Fri'].map((label,i)=><text key={label} x="0" y={31+i*28} fill="var(--settings-text-muted)" fontSize="9">{label}</text>)}
                {calendar.filter(day=>day.date.endsWith('-01')).map(day=><text key={day.date} x={32+day.column*12.8} y="10" fill="var(--settings-text-muted)" fontSize="9">{new Date(day.date+'T12:00:00').toLocaleDateString(undefined,{month:'short'})}</text>)}
                {calendar.map(day=><rect key={day.date} x={32+day.column*12.8} y={21+day.row*14} width="10.5" height="11" rx="2" fill={day.tokens?'var(--accent-primary)':'var(--settings-track)'} opacity={!day.inRange? .18 : day.tokens ? .25+.75*Math.sqrt(day.tokens/calendarMax) : .7} tabIndex={day.inRange?0:undefined} role={day.inRange && onSelectDay ? 'button' : 'img'} onClick={() => { if (day.inRange) onSelectDay?.(day.date) }} onKeyDown={event => { if (day.inRange && onSelectDay && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelectDay(day.date) } }} aria-label={`${day.date}: ${day.inRange?activityMeasurement(day):'outside selected period'}`} onFocus={()=>setHovered(day.date)} onBlur={()=>setHovered(null)} onMouseEnter={()=>setHovered(day.date)} className="outline-none focus:stroke-[var(--settings-text)]"><title>{day.date}: {day.inRange?activityMeasurement(day):'Outside selected period'}</title></rect>)}
            </> : <>
                {[0,.5,1].map(fraction=><line key={fraction} x1="0" x2={width} y1={fraction*(height-1)} y2={fraction*(height-1)} stroke="var(--settings-divider)" strokeWidth=".6"/>)}
                {view==='cumulative'&&<path d={points.map((point,i)=>`${i?'L':'M'}${(i+.5)*step},${height-4-point.tokens/max*(height-12)}`).join(' ')} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinejoin="round"/>}
                {points.map((day,index)=>{const barHeight=day.tokens/max*(height-8);return <g key={day.date} tabIndex={0} role="img" aria-label={`${day.date}: ${day.tokens.toLocaleString()} tokens`} onFocus={()=>setHovered(day.date)} onBlur={()=>setHovered(null)} onMouseEnter={()=>setHovered(day.date)} className="outline-none">
                    <rect x={index*step} y="0" width={step} height={height} fill="transparent"/>
                    {view==='cumulative'?hovered===day.date&&<circle cx={(index+.5)*step} cy={height-4-day.tokens/max*(height-12)} r="4" fill="var(--accent-primary)"/>:<rect x={index*step+1} y={height-Math.max(1,barHeight)} width={Math.max(.5,step-3)} height={Math.max(1,barHeight)} rx="1.5" fill={day.tokens?'var(--accent-primary)':'var(--settings-divider)'} opacity={hovered&&hovered!==day.date? .35:.85} className="transition-opacity duration-150 motion-reduce:transition-none"/>}
                </g>})}
            </>}
        </svg>
        <div className="flex justify-between text-[10px] text-[var(--settings-text-faint)]"><span>{view==='activity'?year:daily.length?formatDay(daily[0].date):''}</span><span>{view==='activity'?<span className="inline-flex items-center gap-1.5">Less{[.2,.4,.65,1].map(opacity=><span key={opacity} className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent-primary)]" style={{opacity}}/>)}More</span>:daily.length?formatDay(daily[daily.length-1].date):''}</span></div>
    </div>
}
