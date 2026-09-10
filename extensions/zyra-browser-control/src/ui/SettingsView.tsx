import { ChevronDown, ShieldCheck, Palette } from 'lucide-react';
import type { ExtensionState } from '../shared/protocol';
import type { Action } from './ConnectionView';
import { ThemePicker } from './ThemePicker';
export function SettingsView({state,action,busy}:{state:ExtensionState;action:Action;busy:string}) {
  return <div className="settings-view"><h2>Settings</h2><div className="setting-row"><span className="setting-label"><Palette size={15}/>Theme</span><ThemePicker value={state.theme} appearance={state.zyraAppearance} disabled={!!busy} onChange={theme=>void action('theme',{theme})}/></div>
    <details className="help access-help"><summary><ShieldCheck size={14}/>Access & privacy<ChevronDown size={13}/></summary><ul><li>Choose Read or Control per tab.</li><li>A new site or disconnect releases access.</li><li>Password, payment, verification-code and file fields are protected.</li><li>Screenshots include visible content. Observations may go to your assistant’s model provider.</li><li>Activity contains request metadata only and clears on restart.</li></ul></details>
    <div className="about-row"><span>Zyra Browser</span><span>v{chrome.runtime.getManifest().version}</span></div>
  </div>;
}
