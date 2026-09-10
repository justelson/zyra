import { useState } from 'react';
import { Check, CircleAlert, Download, ListFilter, Trash2 } from 'lucide-react';
import type { Activity } from '../shared/protocol';
import type { Action } from './ConnectionView';
export function ActivityView({ entries, action }: { entries: Activity[]; action: Action }) {
  const [errorsOnly, setErrorsOnly] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const filtered = errorsOnly ? entries.filter(e => e.outcome === 'error') : entries;
  const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'zyra-activity-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <><div className="activity-toolbar"><button className={errorsOnly ? 'quiet selected' : 'quiet'} onClick={() => setErrorsOnly(!errorsOnly)} aria-pressed={errorsOnly}><ListFilter size={13}/>{errorsOnly ? 'Errors only' : 'All requests'}<span className="count">{filtered.length}</span></button><div className="button-group"><button className="icon-button" title="Export activity" aria-label="Export activity" onClick={download} disabled={!entries.length}><Download size={14}/></button><button className="icon-button" title="Clear activity" aria-label="Clear activity" onClick={() => action('clear-activity')} disabled={!entries.length}><Trash2 size={14}/></button></div></div>
    <div className="activity-list">{filtered.map(entry => <div key={entry.id}><button className="activity-row" aria-expanded={selected === entry.id} onClick={() => setSelected(selected === entry.id ? null : entry.id)}><span className={entry.outcome === 'ok' ? 'success-text' : 'error-text'}>{entry.outcome === 'ok' ? <Check size={13}/> : <CircleAlert size={13}/>}</span><strong>{entry.method}</strong><span className="request-tab">{entry.tabId ? 'Tab '+entry.tabId : 'Browser'}</span><time>{new Date(entry.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{entry.durationMs}ms</span></button>{selected === entry.id && <dl className="request-details"><div><dt>Request ID</dt><dd>{entry.id}</dd></div><div><dt>Result</dt><dd>{entry.code || 'Completed'}</dd></div><div><dt>Started</dt><dd>{new Date(entry.startedAt).toISOString()}</dd></div></dl>}</div>)}</div>
    {!filtered.length && <div className="empty" role="status">{errorsOnly ? 'No failed requests' : 'No activity yet'}</div>}
  </>;
}
