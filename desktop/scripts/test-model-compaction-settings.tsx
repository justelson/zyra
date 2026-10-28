import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { partitionDevicePreferencePatch, sanitizeDevicePreferenceValue } from '../src/main/setup/device-preferences-service'
import { DEFAULT_DEVICE_SETTINGS } from '../src/shared/preferences/default-settings'

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
const mount=async()=>{if(root){await act(async()=>root.unmount())}root=createRoot(document.getElementById('root'));await act(async()=>root.render(<MemoryRouter><ModelCompactionSettings/><AssistantComposerContextIndicator usage={{totalTokens:175000}} model={window.fixtureModels[0]}/></MemoryRouter>));await flush()};
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
 check([...select.options].some(o=>o.text.includes('Input 2×, Output 1.5× API-equivalent')),'category-specific long-context pricing shown');
 check(![...select.options].some(o=>o.text.includes('Cached input')),'unchanged cached-input rate is not falsely tagged');
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
window.run().catch(error=>console.error('MODEL_COMPACTION_SETTINGS_FAIL '+error.stack));
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
    await writeFile(join(directory, 'test.html'), '<div id="root"></div><script type="module" src="harness.js"></script>')
    await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{backgroundThrottling:false}});win.webContents.on('console-message',event=>{console.log(event.message);if(event.message.includes('MODEL_COMPACTION_SETTINGS_PASS'))app.exit(0);if(event.message.includes('MODEL_COMPACTION_SETTINGS_FAIL'))app.exit(1)});await win.loadFile(${JSON.stringify(join(directory, 'test.html'))})});setTimeout(()=>{console.error('Compaction fixture timed out');app.exit(1)},30000);`)
    const electron = createRequire(import.meta.url)('electron') as string
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)) })
    assert.equal(code, 0, 'hidden actual compaction settings/picker/indicator interactions pass')
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
console.log('Model compaction preference contract and hidden real component interactions: ok')
