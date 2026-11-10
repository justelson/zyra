import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { partitionDevicePreferencePatch, sanitizeDevicePreferenceValue } from '../src/main/setup/device-preferences-service'
import { DEFAULT_DEVICE_SETTINGS } from '../src/shared/preferences/default-settings'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'

const screenshots = process.argv.includes('--screenshots') ? resolve(import.meta.dir, '../../docs.local/reviews/model-compaction-copy/screenshots') : null

assert.deepEqual(DEFAULT_DEVICE_SETTINGS.assistantModelCompactionOverrides, {})
const partitioned = partitionDevicePreferencePatch({ assistantModelCompactionOverrides: { 'other/fixture': 900_000, invalid: 10, 'other/bad': -1 }, assistantContextCompactionThresholdTokens: 900_000 }, 'browser')
assert.deepEqual(partitioned.shared.assistantModelCompactionOverrides, { 'other/fixture': 900_000 })
assert.equal(partitioned.shared.assistantContextCompactionThresholdTokens, 900_000, 'legacy saved value is not arbitrarily capped')
assert.equal(sanitizeDevicePreferenceValue('assistantModelCompactionOverrides', []), undefined)

// Actual settings section, picker, selects, portal and indicator mounted in a
// hidden disposable Chromium renderer. Only catalog transport/settings storage
// are synthetic. No live account, app preference or provider request is used.
const directory = await mkdtemp(join(tmpdir(), 'zyra-model-compaction-'))
const source = (path: string) => JSON.stringify(resolve(import.meta.dir, '../src/renderer/src', path))
const harness = `
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {ModelCompactionSettings,compactionPricingLabel} from ${source('pages/settings/ModelCompactionSettings.tsx')};
import {AssistantComposerContextIndicator} from ${source('pages/assistant/AssistantComposerContextIndicator.tsx')};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const check=(ok,message)=>{if(!ok)throw Error(message)};
window.fixtureModels=[{id:'openai-codex/fixture',label:'Fixture model',context_window:400000,contextWindow:400000,max_context_window:1000000,effective_context_window_percent:95,auto_compact_token_limit:350000,metadataSource:'openai-models-manifest',pricing:{tiers:{standard:{inputTokensAbove:200000,short:{input:2,cacheRead:0.2,output:10},long:{input:4,cacheRead:0.2,output:15}}}}},{id:'other/unknown',label:'Unknown capacity',contextWindow:null}];
window.devscope={};
let root;const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,40))});
const click=async node=>{check(node,'click target exists');await act(async()=>node.click());await flush()};
const button=label=>document.querySelector('button[aria-label="'+label+'"]');
const mount=async()=>{if(root){await act(async()=>root.unmount())}root=createRoot(document.getElementById('root'));await act(async()=>root.render(<MemoryRouter><ModelCompactionSettings/>{!window.fixturePreview&&<AssistantComposerContextIndicator usage={{totalTokens:175000}} model={window.fixtureModels[0]}/>}</MemoryRouter>));await flush()};
const stored=()=>JSON.parse(localStorage.getItem('fixture-settings')||'{}');
window.run=async()=>{
 await mount();check(document.body.textContent.includes('Use provider defaults'),'provider defaults shown initially');check(!document.querySelector('select'),'no global or fake model thresholds');
 await click(button('Customize models'));check(document.querySelector('[role=listbox]'),'existing picker really opens');
 check(!document.querySelector('[role=option]')?.textContent.includes('256'),'no global cap option');
 check(!document.body.textContent.includes('Unknown capacity'),'unknown-context model has no invented customization presets');
 await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent.includes('Fixture model')));
 let select=document.querySelector('select[aria-label="Fixture model compaction limit"]');check(select,'selected model produces actual per-model dropdown');
 check(stored().assistantModelCompactionOverrides['openai-codex/fixture']===350000,'selection persists provider-based initial threshold');
 check(document.body.textContent.includes('Customized'),'indicator uses the same per-model preference');
 check([...select.options].every(o=>!o.value||Number(o.value)<=360000),'presets respect current capacity, not advertised1M extension');
 check(select.selectedOptions[0].text==='350K tokens','selected threshold stays short and readable');
 check([...select.options].every(o=>!o.text.includes('API-equivalent')),'pricing cannot crowd the limit picker');
 check(select.title.includes('Input 2×, Output 1.5× API-equivalent'),'exact value and pricing stay available on hover');
 await click(button('About Fixture model'));check(document.querySelector('[role=tooltip]')?.textContent.includes('Input 2×, Output 1.5× API-equivalent'),'pricing detail remains available in the info tip');
 check(!document.querySelector('[role=tooltip]')?.textContent.includes('Cached input'),'unchanged cached-input rate stays untagged in pricing details');
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush();
 await act(async()=>{select.value='180000';select.dispatchEvent(new Event('change',{bubbles:true}))});await flush();
 check(stored().assistantModelCompactionOverrides['openai-codex/fixture']===180000,'dropdown saves exact model override');
 await mount();check(document.querySelector('select').value==='180000','override survives actual component remount');
 await click(button('Remove Fixture model override'));check(!document.querySelector('select'),'removal clears selected row');
 check(!Object.hasOwn(stored().assistantModelCompactionOverrides,'openai-codex/fixture'),'remove durably restores provider policy');
 check(stored().assistantContextCompactionThresholdTokens===900000,'legacy preference remains preserved, not applied');
 check(document.body.textContent.includes('Provider default'),'indicator immediately returns to provider recommendation');
 await click(button('Customize models'));await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent.includes('Fixture model')));
 select=document.querySelector('select');await act(async()=>{select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))});await flush();check(!document.querySelector('select'),'Use provider defaults resets via dropdown too');
 localStorage.setItem('fixture-settings',JSON.stringify({assistantContextCompactionThresholdTokens:900000,assistantModelCompactionOverrides:{'gone/model':300000}}));
 await mount();check(document.body.textContent.includes('Unavailable. Saved override is preserved'),'disconnected saved override retained visibly');
 check(document.querySelector('select').disabled,'unavailable model cannot invent supported presets');
 check(compactionPricingLabel(200000,window.fixtureModels[0].pricing.tiers.standard)==='','pricing threshold comparison is strictly above');
 window.fixtureModels=[];window.fixtureFailure=true;await mount();check(document.body.textContent.includes('Connected models could not be loaded'),'catalog error shown');
 check(stored().assistantModelCompactionOverrides['gone/model']===300000,'catalog error does not erase overrides');
 console.log('MODEL_COMPACTION_SETTINGS_PASS');
};
window.preview=async()=>{window.fixturePreview=true;window.fixtureModels=[{...window.fixtureModels[0],label:'GPT-6.1-Sol',context_window:500000,contextWindow:500000,max_context_window:500000,effective_context_window_percent:100,auto_compact_token_limit:undefined}];localStorage.setItem('fixture-settings',JSON.stringify({assistantModelCompactionOverrides:{'openai-codex/fixture':450000}}));await mount();check(document.querySelector('select').selectedOptions[0].text==='450K tokens','preview threshold fits');};
window.openPreviewInfo=()=>click(button('About GPT-6.1-Sol'));
window.closePreviewInfo=async()=>{await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush()};
${screenshots ? 'window.preview().then(()=>console.log("MODEL_COMPACTION_PREVIEW_READY"))' : 'window.run()'}.catch(error=>console.error('MODEL_COMPACTION_SETTINGS_FAIL '+error.stack));
`
try {
    const build = await Bun.build({ entrypoints: ['compaction-fixture'], target: 'browser', plugins: [{ name: 'compaction-fixture', setup(builder) {
        builder.onResolve({ filter: /^compaction-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
        builder.onResolve({ filter: /^@\/lib\/settings$/ }, () => ({ path: 'settings', namespace: 'mock' }))
        builder.onResolve({ filter: /settings-model-catalog-cache$/ }, () => ({ path: 'catalog', namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'catalog'
            ? `export const loadSettingsModels=async()=>{if(window.fixtureFailure)throw Error('Synthetic unavailable');return window.fixtureModels};export const subscribeSettingsModels=()=>()=>{};`
            : `import {useState,useEffect} from 'react';const listeners=new Set();let current;const read=()=>JSON.parse(localStorage.getItem('fixture-settings')||'{"assistantContextCompactionThresholdTokens":900000,"assistantModelCompactionOverrides":{}}');export const useSettings=()=>{const [settings,setSettings]=useState(read);useEffect(()=>{listeners.add(setSettings);return()=>listeners.delete(setSettings)},[]);return {settings,updateSettings:async patch=>{current={...read(),...patch};localStorage.setItem('fixture-settings',JSON.stringify(current));for(const fn of listeners)fn(current)}}};export const getThemeAppearance=()=> 'dark';`, loader: 'tsx' }))
    } }] })
    if (!build.success) throw Error(build.logs.join('\n'))
    await writeFile(join(directory, 'harness.js'), await build.outputs[0].text())
    if (screenshots) {
        await mkdir(screenshots, { recursive: true })
        const appCss = postcss.parse(await readFile(resolve(import.meta.dir, '../src/renderer/src/index.css'), 'utf8'))
        appCss.walkAtRules('import', rule => rule.remove())
        const styles = await postcss([tailwindcss({ ...tailwindConfig, content: [resolve(import.meta.dir, '../src/renderer/src/pages/settings/**/*.tsx')] })]).process(appCss.toString(), { from: undefined })
        const tokens = await readFile(resolve(import.meta.dir, '../src/renderer/src/styles/theme-tokens.css'), 'utf8')
        await writeFile(join(directory, 'preview.css'), tokens + '\n' + styles.css)
    }
    await writeFile(join(directory, 'test.html'), `<!doctype html><html><head>${screenshots ? '<link rel="stylesheet" href="preview.css"><style>body{margin:0;padding:24px;background:var(--color-bg);color:var(--color-text);font-family:Segoe UI,sans-serif}#root{max-width:760px;margin:auto}</style>' : ''}</head><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>`)
    await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,focusable:false,width:920,height:470,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});
win.webContents.on('paint',()=>{});win.webContents.startPainting();win.webContents.on('console-message',async event=>{console.log(event.message);if(event.message.includes('MODEL_COMPACTION_SETTINGS_PASS'))app.exit(0);if(event.message.includes('MODEL_COMPACTION_SETTINGS_FAIL'))app.exit(1);
if(event.message.includes('MODEL_COMPACTION_PREVIEW_READY')){try{
const take=async(name,full=false)=>{await win.webContents.capturePage();win.webContents.invalidate();await new Promise(r=>setTimeout(r,130));const clip=full?undefined:await win.webContents.executeJavaScript('(()=>{const r=document.querySelector("section").getBoundingClientRect();return{x:Math.max(0,Math.floor(r.left)-12),y:Math.max(0,Math.floor(r.top)-12),width:Math.min(innerWidth-Math.max(0,Math.floor(r.left)-12),Math.ceil(r.width)+24),height:Math.min(innerHeight-Math.max(0,Math.floor(r.top)-12),Math.ceil(r.height)+24)}})()');await fs.writeFile(${JSON.stringify(screenshots)}+'/'+name+'.png',(await win.webContents.capturePage(clip,{stayHidden:true,stayAwake:true})).toPNG())};
await take('desktop');await win.webContents.executeJavaScript('window.openPreviewInfo()');await take('details',true);
await win.webContents.executeJavaScript('window.closePreviewInfo()');win.setContentSize(390,500);await new Promise(r=>setTimeout(r,150));if(!await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'))throw Error('Narrow settings overflow');await take('narrow');
if(win.isVisible()||win.isFocused())throw Error('Preview must remain hidden');console.log('MODEL_COMPACTION_SCREENSHOTS_PASS');app.exit(0)
}catch(error){console.error(error);app.exit(1)}}});await win.loadFile(${JSON.stringify(join(directory, 'test.html'))})});setTimeout(()=>{console.error('Compaction fixture timed out');app.exit(1)},30000);`)
    const electron = createRequire(import.meta.url)('electron') as string
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)) })
    assert.equal(code, 0, 'hidden actual compaction settings/picker/indicator interactions pass')
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
console.log('Model compaction preference contract and hidden real component interactions: ok')
