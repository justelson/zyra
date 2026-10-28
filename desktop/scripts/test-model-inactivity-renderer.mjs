import assert from 'node:assert/strict'
import { build } from 'esbuild'
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Production React panel/CSS, synthetic clock and callbacks, isolated hidden window.
const directory = await mkdtemp(join(tmpdir(), 'zyra-model-inactivity-'))
const screenshot = resolve(import.meta.dirname, '../../docs.local/model-ping-panel.png')
try {
    const bundle = await build({ stdin: { contents: `
import React,{act} from 'react';import{createRoot}from'react-dom/client';
import{AssistantModelInactivityPanel}from'./src/renderer/src/pages/assistant/AssistantModelInactivityPanel';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const root=createRoot(document.getElementById('root')),check=(value,message)=>{if(!value)throw Error(message)};
let now=1000000,nextTimer=0;Date.now=()=>now;const timers=new Map(),setTimeoutOriginal=window.setTimeout,clearTimeoutOriginal=window.clearTimeout;
window.setTimeout=(callback,delay,...args)=>{if(delay>=100000){const id=++nextTimer;timers.set(id,{at:now+delay,callback:()=>callback(...args)});return -id}return setTimeoutOriginal(callback,delay,...args)};
window.clearTimeout=id=>{if(id<0)timers.delete(-id);else clearTimeoutOriginal(id)};
const advance=async(ms)=>{now+=ms;await act(async()=>{for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.callback()}})};
let props, pings=0,stops=0,pingAction=async()=>{throw Error('Synthetic Ping rejection')},stopAction=async()=>{};
const base=()=>({requestId:'request-1',startedAt:1000000,lastActivityAt:1000000,phase:'waiting',canPing:true});
const panel=()=>document.querySelector('.assistant-model-inactivity'),button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label);
const mount=async(p={})=>{props={progress:base(),turnId:'turn-1',onPing:async(id)=>{pings++;check(id===props.progress.requestId,'exact request');return pingAction()},onStop:async()=>{stops++;return stopAction()},...p};await act(async()=>root.render(<AssistantModelInactivityPanel {...props}/>))};
const click=async(label)=>{const target=button(label);check(target,'missing '+label);await act(async()=>target.click())};
window.runPanel=async()=>{
 await mount();document.getElementById('composer').focus();check(!panel(),'no early panel');
 await advance(119999);check(!panel(),'no early deadline');await advance(1);check(panel(),'panel opens at two minutes');
 check(document.activeElement.id==='composer','appearance never steals focus');
 await click('Keep waiting');check(!panel(),'snooze hides panel');check(pings===0&&stops===0,'snooze never changes execution');
 await advance(119999);check(!panel(),'finite snooze not early');await advance(1);check(panel(),'snooze expires');
 await click('Ping');check(pings===1,'explicit Ping only');check(document.querySelector('[role=alert]').textContent==='Synthetic Ping rejection','inline error');
 let rejectPing;pingAction=()=>new Promise((_,reject)=>{rejectPing=reject});
 await click('Ping');check(pings===2,'retry accepted');const pingButton=button('Pinging…');check(pingButton?.disabled,'pending Ping disabled');await act(async()=>pingButton.click());check(pings===2,'duplicate suppressed');
 check(!button('Stop').disabled,'Stop stays usable during pending Ping');await click('Stop');check(stops===1,'Stop supersedes held Ping');
 await mount({progress:{...base(),requestId:'request-next',startedAt:now,lastActivityAt:now},turnId:'turn-2'});
 await act(async()=>rejectPing(Error('stale chat error')));check(!document.querySelector('[role=alert]'),'old async response cannot leak into new request');check(!panel(),'new request resets clock');
 await advance(120000);check(panel(),'new request gets reminder');
 await mount({progress:{...base(),lastActivityAt:now}});check(!panel(),'reasoning activity hides panel');
 await mount({suppressed:true});check(!panel(),'skills and files take priority in the shared slot');await mount();check(panel(),'reminder returns after menu closes');
 await mount({progress:null});await advance(200000);check(!panel(),'tools compaction idle have no reminder');check(timers.size===0,'unmount clears timers');
 await mount({progress:{...base(),canPing:false}});check(button('Ping').disabled,'partial answer cannot be pinged');check(panel().textContent.includes('before the model starts'),'disabled reason');
 await mount({progress:{...base(),phase:'recovering',canPing:false}});check(button('Ping').disabled,'recovering cannot be pinged');check(!button('Stop').disabled,'Stop remains available');check(!panel().textContent.includes('before the model starts'),'recovery does not claim partial output');
 pingAction=async()=>{};await mount();check(!document.querySelector('[role=dialog]'),'no modal');
};
window.checkGeometry=()=>{const rect=panel().getBoundingClientRect(),composer=document.getElementById('composer').getBoundingClientRect();check(rect.left>=0&&rect.right<=innerWidth,'panel fits viewport');check(Math.abs(rect.bottom-composer.top)<1,'content meets the composer without a separate-card gap');const drawer=document.querySelector('[data-composer-drawer]').getBoundingClientRect();check(drawer.left>composer.left&&drawer.right<composer.right,'shared drawer is inset from the composer');check(Math.abs(drawer.bottom-composer.top-17)<1,'drawer tucks 17px behind composer');check(rect.height<160,'compact panel at narrow width');for(const b of document.querySelectorAll('button')){const r=b.getBoundingClientRect();check(r.left>=rect.left&&r.right<=rect.right,'buttons fit panel')}};
window.cleanup=async()=>act(async()=>root.unmount());
`, resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx' }, outdir: directory, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } })
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
    const utilities = await postcss([tailwindcss({ ...tailwindConfig, content: [resolve(import.meta.dirname, '../src/renderer/src/pages/assistant/AssistantComposerMenuSurface.tsx'), resolve(import.meta.dirname, '../src/renderer/src/pages/assistant/AssistantModelInactivityPanel.tsx')] })]).process('@tailwind utilities;', { from: undefined })
    const css = utilities.css + bundle.outputFiles.find(file => file.path.endsWith('.css')).text
    await writeFile(join(directory, 'index.html'), `<style>:root{--surface-divider:#34343c;--surface-floating:#222227;--color-card:#222227;--color-text:#ededf1;--color-text-secondary:#aaaab4;--status-danger:#ee8888;--surface-hover:#303038;--accent-primary:#aa99ff}body{margin:0;padding:16px;box-sizing:border-box;background:#17171c;color:#ededf1;font:13px system-ui}main{max-width:760px;margin:auto;padding-top:170px}.composer-fixture{position:relative;isolation:isolate}textarea{position:relative;z-index:40;display:block;box-sizing:border-box;width:100%;height:90px;margin-top:0;border:1px solid #34343c;border-radius:12px;background:#222227;color:#ededf1;padding:14px}${css}</style><main><div class="composer-fixture"><div id="root"></div><textarea id="composer" placeholder="Message Zyra"></textarea></div></main><script>${script}</script>`)
    await mkdir(resolve(import.meta.dirname, '../../docs.local'), { recursive: true })
    await writeFile(join(directory, 'main.cjs'), `
const{app,BrowserWindow}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.disableHardwareAcceleration();
const timeout=setTimeout(()=>{console.error('Model panel timed out');app.exit(1)},25000);
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:500,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true}});
win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});await win.webContents.executeJavaScript('window.runPanel()');await win.webContents.executeJavaScript('window.checkGeometry()');
fs.writeFileSync(${JSON.stringify(screenshot)},(await win.webContents.capturePage()).toPNG());win.setContentSize(320,500);await new Promise(resolve=>setTimeout(resolve,100));await win.webContents.executeJavaScript('window.checkGeometry()');await win.webContents.executeJavaScript('window.cleanup()');
console.log('MODEL_INACTIVITY_RENDERER_PASS');clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electronPath, [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
    const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
    assert.equal(code, 0, output)
    assert.match(output, /MODEL_INACTIVITY_RENDERER_PASS/)
} finally { await rm(directory, { recursive: true, force: true }) }
