import { useEffect, useState } from 'react';
import { PanelsTopLeft, Activity, Settings2, Square, ArrowUpRight, X, CircleAlert, Cable } from 'lucide-react';
import { useExtension } from './api';
import { TabsView } from './TabsView';
import { ConnectionView } from './ConnectionView';
import { ActivityView } from './ActivityView';
import { SettingsView } from './SettingsView';
import { useAppearance } from './useAppearance';
type View='tabs'|'activity'|'connection'|'settings';
export function App() {
  const { state, error, busy, action, clearError } = useExtension();
  const [view,setView]=useState<View>('tabs');
  const popup=location.pathname.endsWith('popup.html');
  useEffect(()=>{document.body.classList.toggle('popup',popup);},[popup]);
  useAppearance(state);
  if(!state)return <div className="loading" role="status"><span className="loading-dot"/>Opening Zyra Browser…{error&&<p role="alert">{error}</p>}</div>;
  return <div className="app">
    <header><div className="wordmark">Zyra <span>Browser</span></div><button className={'connection-status '+(state.connected?'online':'')} aria-label="Connection" title={state.connected?'Manage connection':'Connect browser'} onClick={()=>setView('connection')}><i/>{state.connected?'Connected':state.connecting?'Connecting…':'Connect'}<Cable size={13}/></button></header>
    <div className="workspace"><nav aria-label="Main navigation">
      <button aria-label="Tabs" className={'nav-item '+(view==='tabs'?'active':'')} onClick={()=>setView('tabs')} aria-current={view==='tabs'?'page':undefined}><PanelsTopLeft size={15}/>Tabs{state.grants.length>0&&<b>{state.grants.length}</b>}</button>
      <button aria-label="Activity" className={'nav-item '+(view==='activity'?'active':'')} onClick={()=>setView('activity')} aria-current={view==='activity'?'page':undefined}><Activity size={15}/>Activity</button>
      <div className="nav-tools"><button aria-label="Settings" title="Settings" className={'icon-button '+(view==='settings'?'selected':'')} onClick={()=>setView('settings')} aria-current={view==='settings'?'page':undefined}><Settings2 size={15}/><span>Settings</span></button>{popup&&<button className="icon-button" title="Open full console" aria-label="Open browser console" onClick={()=>action('open-console')}><ArrowUpRight size={15}/></button>}</div>
    </nav><main><div className="content">
      {error&&<div className="error-banner" role="alert"><CircleAlert size={15}/><span>{error}</span>{error&&<button aria-label="Dismiss error" className="icon-button" onClick={clearError}><X size={13}/></button>}</div>}
      {view==='tabs'&&<>{!state.connected&&<div className="connect-banner"><span>Connect to share tabs.</span><button onClick={()=>setView('connection')}>Connect<ArrowUpRight size={13}/></button></div>}<TabsView state={state} action={action} busy={busy}/></>}
      {view==='activity'&&<ActivityView entries={state.activity} action={action}/>}
      {view==='connection'&&<ConnectionView state={state} action={action} busy={busy} onConnected={()=>setView('tabs')}/>}
      {view==='settings'&&<SettingsView state={state} action={action} busy={busy}/>}
    </div></main></div>
    <footer><span><i className={state.grants.length?'live-dot':''}/>{state.grants.length?state.grants.length+' '+(state.grants.length===1?'tab':'tabs')+' shared':'No tabs shared'}</span><button className="release" disabled={!state.grants.length} onClick={()=>action('release')}><Square size={10} fill="currentColor"/>Release access</button></footer>
  </div>;
}
