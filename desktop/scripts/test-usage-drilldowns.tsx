import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { buildUsageSummary, type UsageEntry } from '../src/shared/assistant/usage-summary'
import { scopeUsageSummary } from '../src/renderer/src/pages/settings/usage/usage-series'
import { formatUsageMeasurement } from '../src/renderer/src/pages/settings/usage/usage-presentation'

const entries: UsageEntry[] = [
 { id:'1',harness:'codex',model:'openai/fixture-a',requestedAt:'2026-10-11T12:00:00Z',usage:{inputTokens:100,outputTokens:20,costUsd:2,costSource:'reported'} },
 { id:'2',harness:'zyra',model:'anthropic/fixture-b',requestedAt:'2026-10-12T12:00:00Z',usage:{inputTokens:300,outputTokens:40,costSource:'unpriced'} },
 { id:'3',harness:'zyra',model:'openai/fixture-a',requestedAt:'2026-10-13T12:00:00Z',usage:null }
]
const summary = buildUsageSummary(entries,{days:7},new Date('2026-10-13T18:00:00Z'))
assert.equal(scopeUsageSummary(summary,{mode:'period',date:'2026-10-11',view:'daily',label:'day'}).totals.tokens,120)
assert.equal(scopeUsageSummary(summary,{mode:'period',date:'2026-10-12',view:'weekly',label:'week'}).totals.turns,2)
assert.equal(scopeUsageSummary(summary,{mode:'period',date:'2026-10-12',view:'cumulative',label:'through'}).totals.tokens,460)
assert.equal(formatUsageMeasurement(scopeUsageSummary(summary,{mode:'period',date:'2026-10-13',view:'daily',label:'unmetered'}).totals,'tokens'),'Unmetered')
assert.match(formatUsageMeasurement(scopeUsageSummary(summary,{mode:'model',id:'openai/fixture-a',label:'a'}).totals,'cost'),/\*/)
const source=resolve(import.meta.dir,'../src/renderer/src')
const directory=await mkdtemp(join(tmpdir(),'zyra-usage-details-'))
const harness=`
import React,{act,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {UsageOverview} from ${JSON.stringify(join(source,'pages/settings/usage/UsageOverview.tsx'))}
import {UsageBreakdown} from ${JSON.stringify(join(source,'pages/settings/usage/UsageBreakdown.tsx'))}
import {usageSeriesColor} from ${JSON.stringify(join(source,'pages/settings/usage/usage-series.ts'))}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const summary=${JSON.stringify(summary)}
const check=(value,message)=>{if(!value)throw Error(message)}
const root=createRoot(document.getElementById('root'))
function Fixture(){const [mode,setMode]=useState('model'),[view,setView]=useState('daily');return <MemoryRouter><div className="usage-page-content"><UsageOverview summary={summary} metric="cost" chartView={view} onChartView={setView}/><UsageBreakdown summary={summary} metric="cost" mode={mode} onMode={setMode}/></div></MemoryRouter>}
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30))})
const click=async node=>{check(node,'target exists');await act(async()=>{node.focus();node.click()});await flush()}
const dialog=()=>document.querySelector('dialog[open]')
const close=async()=>{await click(dialog().querySelector('[aria-label="Close usage details"]'));check(!dialog(),'dialog closes')}
async function run(){
 await act(async()=>root.render(<Fixture/>));await flush()
 const row=document.querySelector('[data-usage-row="openai/fixture-a"] button')
 await click(row);check(dialog()?.textContent.includes('fixture-a'),'model row opens real dialog');check(dialog().textContent.includes('1 of 2 records'),'partial model coverage retained');check(dialog().textContent.includes('*'),'partial totals marked');check(document.activeElement===dialog().querySelector('button'),'dialog starts at Close');check(dialog().matches(':modal'),'native focus trap active');await close();check(document.activeElement===row,'focus restored to model row')
 await click(document.querySelector('[data-usage-row="anthropic/fixture-b"] td:last-child'));check(dialog().textContent.includes('Unpriced'),'whole table row opens unpriced model');check(dialog().querySelector('.usage-trend').getAttribute('aria-label')==='Daily processed tokens','unpriced detail uses tokens rather than a fake zero cost');await close()
 const legend=document.querySelector('[data-usage-legend="anthropic"]');await click(legend);check(dialog().textContent.includes('Anthropic'),'provider legend opens scoped details');check(dialog().textContent.includes('340'),'provider scoped totals');await close();check(document.activeElement===legend,'provider focus restored')
 await click(document.querySelector('.usage-tool-summary'));check(dialog().textContent.includes('By model'),'tool list opens details');await close()
 const plot=document.querySelector('.usage-trend-plot');await act(async()=>{plot.focus();plot.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))});await flush();await act(async()=>plot.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await flush();check(dialog().textContent.includes('Unmetered'),'keyboard day opens truthful missing measurements');await close();check(document.activeElement===plot,'plot focus restored')
 await click([...document.querySelectorAll('[aria-label="Chart series"] button')].find(node=>node.textContent==='Models'))
 for(const line of document.querySelectorAll('[data-usage-series]')){const id=line.getAttribute('data-usage-series');check(line.getAttribute('data-usage-color')===usageSeriesColor('model',id),'actual model path uses central identity color');const dot=document.querySelector('[data-usage-row="'+id+'"] .usage-color-dot');check(dot&&dot.style.background===document.querySelector('[data-usage-legend="'+id+'"] .usage-color-dot').style.background,'table and legend agree')}
 // Leave a modal open for real Chromium Tab/Escape events from the hidden owner.
 await click(row)
 window.fixtureLastFocus=()=>{const nodes=[...dialog().querySelectorAll('button,[tabindex="0"]')];nodes.at(-1).focus()}
 window.fixtureFirstFocused=()=>document.activeElement===dialog()?.querySelector('button')
 window.fixtureClosed=()=>!dialog()&&document.activeElement===row
 console.log('USAGE_DETAILS_READY')
}
run().catch(error=>console.error('USAGE_DETAILS_FAIL',error.stack||String(error)))
`
try {
 const result=await Bun.build({entrypoints:['usage-details-fixture'],target:'browser',plugins:[{name:'fixture',setup(builder){
  builder.onResolve({filter:/^usage-details-fixture$/},()=>({path:'entry',namespace:'fixture'}))
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:harness,loader:'tsx',resolveDir:resolve(import.meta.dir,'..')}))
  builder.onLoad({filter:/\.(png|svg)$/},async args=>({contents:'export default '+JSON.stringify('data:'+(args.path.endsWith('.svg')?'image/svg+xml':'image/png')+';base64,'+(await readFile(args.path)).toString('base64')),loader:'js'}))
  builder.onResolve({filter:/^(@\/|@shared\/)/},args=>{const base=args.path.startsWith('@shared/')?resolve(import.meta.dir,'../src/shared',args.path.slice(8)):join(source,args.path.slice(2));return {path:['','.ts','.tsx','.js','/index.ts','/index.tsx'].map(ext=>base+ext).find(path=>existsSync(path)&&statSync(path).isFile())||base}})
 }}]})
 if(!result.success)throw Error(result.logs.map(String).join('\n'))
 await writeFile(join(directory,'fixture.js'),await result.outputs.find(item=>item.path.endsWith('.js'))!.text())
 const css=await Promise.all(['UsagePage.css','UsageDetails.css','UsageActivityChart.css'].map(file=>readFile(join(source,'pages/settings/usage',file),'utf8')))
 await writeFile(join(directory,'fixture.html'),'<style>:root{--settings-bg:#111820;--settings-text:#ddd;--settings-text-muted:#999;--settings-border:#445;--settings-control:#223;--settings-divider:#334;--settings-text-secondary:#aaa;--accent-primary:#8ac}body{font:13px Arial;background:#111820;color:#ddd}button{font:inherit;color:inherit;background:transparent;border:0}'+css.join('\n')+'</style><div id="root"></div><script type="module" src="fixture.js"></script>')
 await writeFile(join(directory,'main.cjs'),`
 const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});
 app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:900,webPreferences:{backgroundThrottling:false}});let ready=false;win.webContents.on('console-message',async(event,_level,legacy)=>{const message=typeof legacy==='string'?legacy:event.message;console.log(message);if(message.includes('USAGE_DETAILS_FAIL'))app.exit(1);if(message.includes('USAGE_DETAILS_READY')&&!ready){ready=true;try{await win.webContents.executeJavaScript('fixtureLastFocus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await new Promise(r=>setTimeout(r,100));if(!await win.webContents.executeJavaScript('fixtureFirstFocused()'))throw Error('native Tab did not wrap modal focus');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(r=>setTimeout(r,100));if(!await win.webContents.executeJavaScript('fixtureClosed()'))throw Error('native Escape did not close and restore focus');console.log('USAGE_DETAILS_PASS');app.exit(0)}catch(error){console.error(error);app.exit(1)}}});await win.loadFile(${JSON.stringify(join(directory,'fixture.html'))})});setTimeout(()=>app.exit(1),45000)
 `)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const child=spawn(createRequire(import.meta.url)('electron') as string,[join(directory,'main.cjs')],{env,stdio:'inherit',windowsHide:true})
 const code=await new Promise<number>((accept,reject)=>{child.on('error',reject);child.on('exit',code=>accept(code??1))})
 assert.equal(code,0,'hidden Usage details fixture')
} finally { await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}) }
