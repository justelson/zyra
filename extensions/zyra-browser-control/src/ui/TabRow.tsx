import { useState } from 'react';
import { Globe, Eye, MousePointer2, X } from 'lucide-react';
import type { Grant } from '../shared/protocol';
import type { Action } from './ConnectionView';
export type BrowserTab = { id: number; title: string; url: string; active: boolean; windowId: number };
export function TabRow({ tab, grant, connected, busy, action, show }: { tab: BrowserTab; grant?: Grant; connected: boolean; busy: string; action: Action; show: () => void }) {
  const [failedIcon, setFailedIcon] = useState('');
  const icon = new URL(chrome.runtime.getURL('/_favicon/')); icon.searchParams.set('pageUrl', tab.url); icon.searchParams.set('size', '32');
  const title = tab.title || 'Untitled tab';
  return <article className={'tab-row' + (grant ? ' shared' : '')}>
    <button className="tab-identity" onClick={show} aria-label={'Show ' + title} title={tab.url}><span className="site-icon" aria-hidden="true">{failedIcon === tab.url ? <Globe size={16}/> : <img src={icon.href} alt="" width="16" height="16" onError={() => setFailedIcon(tab.url)}/>}</span><span className="tab-title"><strong>{title}</strong><span>{new URL(tab.url).host}</span></span>{tab.active && <i className="current-dot" title="Current tab"/>}</button>
    <div className="access-controls" role="group" aria-label={'Access to ' + title}>
      <button className={grant?.mode === 'read' ? 'selected' : ''} title="Read access" aria-label="Read" disabled={!connected || !!busy} aria-pressed={grant?.mode === 'read'} onClick={() => action('grant', { tabId: tab.id, mode: 'read' })}><Eye size={14}/><span>Read</span></button>
      <button className={grant?.mode === 'control' ? 'selected' : ''} title="Control access" aria-label="Control" disabled={!connected || !!busy} aria-pressed={grant?.mode === 'control'} onClick={() => action('grant', { tabId: tab.id, mode: 'control' })}><MousePointer2 size={14}/><span>Control</span></button>
      {grant && <button aria-label={'Release ' + title} title="Release tab" onClick={() => action('release', { tabId: tab.id })}><X size={13}/></button>}
    </div>
  </article>;
}
