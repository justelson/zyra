import { useEffect, useRef, useState } from 'react';
import { Search, RefreshCw, List, LayoutGrid } from 'lucide-react';
import { request } from './api';
import { TabRow, type BrowserTab } from './TabRow';
import type { ExtensionState } from '../shared/protocol';
import type { Action } from './ConnectionView';
export function TabsView({state,action,busy}:{state:ExtensionState;action:Action;busy:string}) {
  const [tabs,setTabs]=useState<BrowserTab[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const generation=useRef(0);
  const load=async()=>{const current=++generation.current;setLoading(true);setError('');try{const result=await request<BrowserTab[]>('tabs');if(current===generation.current)setTabs(result);}catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setLoading(false);}};
  useEffect(()=>{void load();let timer:ReturnType<typeof setTimeout>;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>void load(),100);};chrome.tabs.onRemoved.addListener(refresh);chrome.tabs.onUpdated.addListener(refresh);chrome.tabs.onCreated.addListener(refresh);chrome.tabs.onActivated.addListener(refresh);return()=>{generation.current++;clearTimeout(timer);chrome.tabs.onRemoved.removeListener(refresh);chrome.tabs.onUpdated.removeListener(refresh);chrome.tabs.onCreated.removeListener(refresh);chrome.tabs.onActivated.removeListener(refresh);};},[]);
  const filtered=tabs.filter(t=>(t.title+' '+t.url).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(state.grants.some(g=>g.tabId===b.id))-Number(state.grants.some(g=>g.tabId===a.id))||Number(b.active)-Number(a.active));
  const show=async(tab:BrowserTab)=>{try{await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}catch(e){setError((e as Error).message);}};
  return <><div className="tabs-toolbar"><label className="search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a tab…" aria-label="Find a tab"/><span aria-label={filtered.length+' tabs'}>{filtered.length}</span></label>
    <div className="layout-controls" role="group" aria-label="Tab layout"><button className={'icon-button '+(state.tabsLayout==='list'?'selected':'')} title="List view" aria-label="List view" aria-pressed={state.tabsLayout==='list'} disabled={!!busy} onClick={()=>action('tabs-layout',{layout:'list'})}><List size={15}/></button><button className={'icon-button '+(state.tabsLayout==='grid'?'selected':'')} title="Grid view" aria-label="Grid view" aria-pressed={state.tabsLayout==='grid'} disabled={!!busy} onClick={()=>action('tabs-layout',{layout:'grid'})}><LayoutGrid size={14}/></button></div>
    <button className="icon-button" title="Refresh tabs" aria-label="Refresh tabs" onClick={load} disabled={loading}><RefreshCw size={13} className={loading?'spinning':''}/></button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className={'tab-list '+state.tabsLayout}>{filtered.map(tab=><TabRow key={tab.id} tab={tab} grant={state.grants.find(g=>g.tabId===tab.id)} connected={state.connected} action={action} busy={busy} show={()=>show(tab)}/>)}
    {!filtered.length&&<div className="empty" role="status">{loading?'Loading tabs…':query?'No matching tabs':'Open a web page to share it.'}</div>}</div>
  </>;
}
