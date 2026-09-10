import { useState } from 'react';
import { Cable, ChevronDown, Unplug, Check } from 'lucide-react';
import type { ExtensionState } from '../shared/protocol';
export type Action = (type: string, params?: Record<string, unknown>) => Promise<boolean>;
export function ConnectionView({ state, action, busy, onConnected }: { state: ExtensionState; action: Action; busy: string; onConnected?: () => void }) {
  const [port, setPort] = useState(state.port ? String(state.port) : ''), [code, setCode] = useState('');
  const valid = /^\d{8}$/.test(code.replace(/[\s-]/g, '')) && Number(port) >= 1 && Number(port) <= 65535;
  return <div className="connection-view"><h2>{state.connected ? 'Connection' : 'Connect to Zyra'}</h2>
    {state.connected ? <><div className="connected-summary"><div className="connected-icon"><Check size={19} /></div><div><strong>Connected to Zyra</strong><p>On this device</p></div></div><div className="connection-count"><span>Shared tabs</span><strong>{state.grants.length}</strong></div><p className="footnote connection-note">Only tabs you share are available to Zyra. You can release access at any time.</p><button className="secondary" disabled={!!busy} onClick={() => action('disconnect')}><Unplug size={14} />Disconnect browser</button></> : <>
      <p className="muted connection-intro">In the Zyra app, open Settings → Device connections and start Chrome pairing.</p>
      <form onSubmit={async e => { e.preventDefault(); if (valid && await action('connect', { port: Number(port), code })) { setCode(''); onConnected?.(); } }}>
        <label htmlFor="pairing-code">Pairing code</label><input id="pairing-code" autoComplete="off" inputMode="numeric" spellCheck={false} className="code" placeholder="1234 5678" value={code} maxLength={11} onChange={e => setCode(e.target.value)} required aria-describedby="code-hint" />
        <p id="code-hint" className="input-hint">Enter the eight digits shown in Zyra.</p>
        <div className="setting-row"><label htmlFor="bridge-port">Port shown in Zyra</label><input id="bridge-port" value={port} onChange={e => setPort(e.target.value)} type="number" min="1" max="65535" placeholder="Port" required /></div>
        <div className="connection-actions"><button className="primary" disabled={!valid || !!busy || state.connecting}><Cable size={14} />{state.connecting ? 'Connecting…' : 'Connect to Zyra'}</button></div>
      </form>
      <details className="help"><summary>How sharing works<ChevronDown size={13} /></summary><p>After connecting, choose a tab and select Read or Control. Zyra will use that tab when you ask it to use Chrome. Keep the Zyra app open while connected.</p></details>
    </>}
  </div>;
}
