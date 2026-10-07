import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ExternalLink, Puzzle } from 'lucide-react'
import { parseAssistantHistoryBodyRef, type AssistantActivity, type AssistantHistoryBody } from '@shared/assistant/contracts'
import { describePluginActivity, readPluginResult } from '@shared/assistant/plugin-activity-presentation'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { bundledPluginLogo } from '../plugins/bundled-plugin-logos'
import { getActivityOutput, getTimelineActivityDomId } from './assistant-timeline-helpers'
import { ASSISTANT_ACTION_ICON_CLASS, ASSISTANT_ACTION_ROW_CLASS } from './assistant-action-row-layout'
import { formatAssistantActionTime } from './AssistantTimelineActionShell'
import { requestAssistantTimelineDisclosureAnchor } from './assistant-timeline-scroll-events'
import { pluginAppViewFromActivity, pluginAppViewIdentity } from './plugin-app-view-state'
import { PluginAppView } from './PluginAppView'
import { PluginActivityPayload } from './PluginActivityPayload'

export function PluginToolCallCard({activity:source,onOpenUrl}: {activity:AssistantActivity;onOpenUrl?:(url:string)=>Promise<boolean|void>|boolean|void}) {
    const [expanded,setExpanded]=useState(false)
    const [detailsSeen,setDetailsSeen]=useState(false)
    const [body,setBody]=useState<AssistantHistoryBody|null>(null)
    const [loading,setLoading]=useState(false)
    const [error,setError]=useState('')
    const [attempt,setAttempt]=useState(0)
    const trigger=useRef<HTMLButtonElement>(null)
    const historyRef=useMemo(()=>parseAssistantHistoryBodyRef(source.payload?.historyBodyRef),[source.payload?.historyBodyRef])
    useEffect(()=> {
        if(!expanded || !historyRef || body) return
        let cancelled=false
        setLoading(true); setError('')
        window.devscope.assistant.hydrateHistoryBody({activityId:source.id,ref:historyRef}).then(result=> {if(cancelled)return; if(!result.success) throw new Error(result.error); setBody(result.body)}).catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:'Could not load plugin output.')}).finally(()=>{if(!cancelled)setLoading(false)})
        return ()=>{cancelled=true}
    },[expanded,historyRef,source.id,body,attempt])
    const activity=useMemo(()=>body?{...source,payload:{...source.payload,...body.payload}}:source,[source,body])
    const presentation=useMemo(()=>describePluginActivity(activity),[activity])
    const raw=detailsSeen?getActivityOutput(activity):''
    const result=useMemo(()=>readPluginResult(detailsSeen?activity.payload?.result:null,raw),[detailsSeen,activity.payload?.result,raw])
    const logo=bundledPluginLogo(presentation.slug)
    const view=pluginAppViewFromActivity(activity)
    const pretty=useMemo(()=>{try{return JSON.stringify(JSON.parse(raw),null,2)}catch{return raw}},[raw])
    return <div className="assistant-plugin-call py-0" id={getTimelineActivityDomId(activity.id)} data-assistant-plugin-call="true">
        <button ref={trigger} type="button" aria-expanded={expanded} className={`${ASSISTANT_ACTION_ROW_CLASS} group hover:bg-[var(--surface-hover)]`} data-assistant-action-row="true" onClick={()=>{requestAssistantTimelineDisclosureAnchor(trigger.current,220,!expanded);if(!expanded)setDetailsSeen(true);setExpanded(!expanded)}}>
            <span className={ASSISTANT_ACTION_ICON_CLASS}>{logo?<img src={logo} alt="" className="size-4 object-contain"/>:<Puzzle size={14}/>}</span>
            <span className={`min-w-0 flex-1 truncate text-left text-xs text-sparkle-text-secondary ${presentation.running?'assistant-title-shimmer':''}`} data-assistant-action-title="true">{presentation.title}</span>
            <span className="shrink-0 text-[10px] text-sparkle-text-muted">{presentation.plugin}</span>
            {presentation.failed?<span className="text-[10px] text-[var(--status-danger)]">Failed</span>:null}
            <span className="hidden text-[10px] tabular-nums text-sparkle-text-muted sm:inline">{formatAssistantActionTime(activity.createdAt)}</span>
            <ChevronRight size={12} className={`shrink-0 text-sparkle-text-muted transition-transform duration-200 motion-reduce:transition-none ${expanded?'rotate-90':''}`}/>
        </button>
        <AnimatedHeight isOpen={expanded} duration={220} crispContent>{detailsSeen && <div className="ml-6 mb-2 space-y-3 border-l border-[var(--surface-divider)] py-2 pl-3 text-xs">
            {presentation.target ? <p className="break-all text-[10px] text-sparkle-text-muted" title={presentation.server}>{presentation.target}</p> : null}
            {presentation.fields.length?<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">{presentation.fields.map(field=><div key={field.label} className="contents"><dt className="text-sparkle-text-muted capitalize">{field.label}</dt><dd className="min-w-0 break-words text-sparkle-text-secondary">{field.value}</dd></div>)}</dl>:null}
            {Object.keys(presentation.arguments).length ? <PluginActivityPayload label="Arguments" value={JSON.stringify(presentation.arguments, null, 2)} /> : null}
            {loading?<p role="status" className="text-sparkle-text-muted">Loading saved output…</p>:error?<p role="alert" className="text-[var(--status-danger)]">{error}<button type="button" onClick={()=>setAttempt(attempt+1)} className="ml-2 underline">Retry</button></p>:<>
                {result.count!==null?<p className="text-sparkle-text-muted">{result.count} {presentation.action==='tools'?'tools':presentation.action==='servers'?'plugins':result.count===1?'result':'results'}</p>:null}
                {result.items.length?<ul className="divide-y divide-[var(--surface-divider)]">{result.items.map((item,index)=><li key={index} className="flex min-w-0 items-center gap-2 py-2"><span className="min-w-0 flex-1">{item.url?<button type="button" className="max-w-full truncate text-left text-sparkle-text hover:text-[var(--accent-primary)]" title={item.url} onClick={()=>{if(onOpenUrl)void onOpenUrl(item.url!);else void window.devscope.openBrowserPreviewExternal(item.url!)}}>{item.title}</button>:<span className="block truncate text-sparkle-text">{item.title}</span>}{item.type?<span className="ml-2 text-[10px] text-sparkle-text-muted">{item.type}</span>:null}</span>{item.url?<ExternalLink size={12} className="shrink-0 text-sparkle-text-muted"/>:null}</li>)}</ul>:null}
                {result.text?<p className="whitespace-pre-wrap break-words text-sparkle-text-secondary">{result.text}</p>:null}
                {result.count!==null && result.count>result.items.length?<p className="text-sparkle-text-muted">{result.count-result.items.length} more in the raw response.</p>:null}
                {raw ? <PluginActivityPayload label="Raw response" value={pretty} /> : !presentation.running && !result.items.length && !result.text ? <p className="text-sparkle-text-muted">No response content recorded.</p> : null}
            </>}
        </div>}</AnimatedHeight>
        {view?<PluginAppView key={pluginAppViewIdentity(view)} view={view}/>:null}
    </div>
}
