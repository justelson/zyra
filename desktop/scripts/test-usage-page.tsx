import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.js'

const directory = await mkdtemp(join(tmpdir(), 'zyra-usage-ui-'))
const output = resolve(import.meta.dir, '../../docs.local/ui-review/usage-page')
const source = resolve(import.meta.dir, '../src/renderer/src')
const harness = `
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {createSettingsSectionTargetId} from ${JSON.stringify(join(source,'pages/settings/settings-search.ts'))}
import UsageSettings from ${JSON.stringify(join(source,'pages/settings/UsageSettings.tsx'))}
import {buildUsageSummary} from ${JSON.stringify(resolve(import.meta.dir,'../src/shared/assistant/usage-summary.ts'))}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
window.localStorage.clear()
const check=(value,message)=>{if(!value)throw Error(message)}
const requests=[];let fail=false,hold=null
const turns=[
 {id:'a',harness:'codex',model:'openai/gpt-fixture',requestedAt:'2026-10-11T12:00:00Z',usage:{inputTokens:200000,outputTokens:10000,cachedInputTokens:100000,costUsd:12,costSource:'reported'}},
 {id:'b',harness:'zyra',model:'openai/gpt-fixture',requestedAt:'2026-10-12T12:00:00Z',usage:{inputTokens:30000,outputTokens:5000,costUsd:3,costSource:'reported'}},
 {id:'c',harness:'codex',model:'openai-codex/gpt-fixture',requestedAt:'2026-10-13T12:00:00Z',usage:null}
]
const summary=input=>({...buildUsageSummary(turns.filter(row=>input.harness==='all'||row.harness===input.harness),input,new Date('2026-10-13T13:00:00Z')),sources:[{id:'codex',state:'ready',files:2,records:2},{id:'zyra',state:'ready',files:1,records:1},{id:'pi',state:'missing',files:0,records:0}]})
window.fixtureOverviewRequests=[]
window.devscope={assistant:{getUsageSummary:async input=>{requests.push(input);if(hold)await hold;if(fail)return {success:false,error:'Synthetic history failure'};return {success:true,summary:summary(input)}}},onboarding:{getChatGptAccounts:async input=>{window.fixturePoolRequests.push(input);return {success:true,pool:{accounts:[],policy:{strategy:'balanced',accountMode:'all',accountIds:[],preferredAccountId:null},checkedAt:'2026-10-13T13:00:00Z'}}}}}
window.fixturePoolRequests=[]
const root=createRoot(document.getElementById('root'))
const flush=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30))})
const find=(selector,text)=>[...document.querySelectorAll(selector)].find(node=>node.textContent.trim()===text)
const click=async node=>{check(node,'control exists');await act(async()=>node.click());await flush()}
window.fixtureResize=async()=>{await flush();window.dispatchEvent(new Event('resize'));await flush()}
window.fixtureGeometry=()=>{
 const page=document.querySelector('.usage-page-content').getBoundingClientRect(),overview=document.querySelector('.usage-overview').getBoundingClientRect(),headline=document.querySelector('.usage-headline-column').getBoundingClientRect(),chart=document.querySelector('.usage-trend').getBoundingClientRect()
 check(document.documentElement.scrollWidth<=innerWidth+1,'page has no horizontal overflow')
 if(innerWidth>=1100)check(page.width>1000,'usage has its dedicated wide content frame')
 if(page.width>=720)check(chart.left>headline.right-1&&Math.abs(chart.top-headline.top)<2,'wide overview has summary beside chart');else check(chart.top>headline.bottom,'narrow overview stacks chart')
 const tooltip=document.querySelector('[data-usage-tooltip]');if(tooltip){const rect=tooltip.getBoundingClientRect();check(rect.left>=0&&rect.right<=innerWidth+1,'tooltip stays in viewport')}
 return {width:innerWidth,page:page.width,chart:chart.width,overview:overview.height}
}
window.fixtureScreenshotReady=false
async function run(){
 await act(async()=>root.render(<MemoryRouter><UsageSettings/></MemoryRouter>));await flush()
 check(requests.length===1&&requests[0].harness==='all'&&requests[0].days===30,'default scope follows real usage hook contract')
 check(document.querySelector('[data-usage-headline]').textContent.includes('15')&&document.querySelector('[data-usage-headline]').textContent.includes('*'),'partial costs marked in headline')
 check(document.body.textContent.includes('Unmetered'),'missing token counts remain unknown')
 check(document.querySelector('.usage-tool-summary:nth-child(2) img'),'Zyra tool uses its logo');
 check(document.body.textContent.includes('ChatGPT')&&document.body.textContent.includes('OpenAI'),'same model distinguishes providers')
 await click(find('[aria-label="Usage metric"] button','Tokens'))
 check(requests.length===1,'metric switch reuses same source data')
 const plot=document.querySelector('.usage-trend-plot')
 await act(async()=>{plot.focus();plot.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))});await flush()
 check(document.querySelector('[data-usage-tooltip]')?.textContent.includes('Unmetered'),'keyboard inspect preserves missing measurement')
 await act(async()=>plot.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));await flush()
 window.fixtureGeometry()
 await click(document.querySelector('[aria-label^="Usage source:"]'))
 const rows=[...document.querySelectorAll('[role="menuitemradio"]')]
 check(document.activeElement===rows[0],'source menu gets keyboard focus')
 await act(async()=>rows[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})))
 check(document.activeElement===rows[1],'source choices support arrow navigation')
 await click(rows.find(row=>row.textContent.includes('Codex')))
 check(requests.at(-1).harness==='codex'&&document.querySelector('[data-usage-headline]').textContent.includes('310'),'source selection updates real hook data')
 await click(find('[aria-label="Usage period"] button','7 days'))
 check(requests.at(-1).days===7,'period changes request scope')
 await click(find('[aria-label="Group usage by"] button','Day'))
 const names=[...document.querySelectorAll('.usage-table-name strong')].map(node=>node.textContent)
 check(names[0].includes('13'),'day table is newest first')
 fail=true;await click(document.querySelector('[aria-label="Refresh usage"]'))
 check(document.body.textContent.includes('Showing the last successful refresh.')&&document.querySelector('[data-usage-headline]'),'refresh error retains last valid summary')
 fail=false;await click(document.querySelector('[aria-label="Refresh usage"]'))
 await click(find('[aria-label="Usage metric"] button','Limits'))
 check([...document.querySelectorAll('[aria-label="Usage period"] button')].every(node=>node.disabled),'limits disable history period controls')
 check(!document.querySelector('.usage-overview'),'limits uses actual account surface')
 await click(document.querySelector('[aria-label="Refresh limits"]'))
 check(window.fixturePoolRequests.some(input=>input?.refreshUsage),'limits refresh asks for fresh pool quotas')
 check(window.fixtureOverviewRequests.includes(true),'limits refresh also requests reset-credit overview')
 await click(find('[aria-label="Usage metric"] button','Cost'))
 await click(document.querySelector('[aria-label^="Usage source:"]'))
 await click(find('[role="menuitemradio"]','All local tools'))
 await click(find('[aria-label="Usage period"] button','30 days'))
 window.fixtureGeometry();
 await act(async()=>root.unmount());
 localStorage.setItem('zyra:usage-page:v1',JSON.stringify({metric:'limits',days:30,harness:'all'}));
 const restored=createRoot(document.getElementById('root'));
 await act(async()=>restored.render(<MemoryRouter initialEntries={['/settings/providers/usage?setting='+createSettingsSectionTargetId('Breakdown')]}><UsageSettings/></MemoryRouter>));await flush();
 check(document.querySelector('[data-settings-section-title="Breakdown"]'),'targeted usage search overrides a saved Limits mode');
 window.fixtureScreenshotReady=true
 console.log('USAGE_UI_READY')
}
run().catch(error=>console.error('USAGE_UI_FAIL',error.stack||String(error)))
`
try {
 const connectionStub = `export const connectionStatusLabel=()=>'',connectionStatusTone=()=> 'default'; const loadOverview=async force=>{window.fixtureOverviewRequests.push(force);return null}; export function useOpenAIAccountSettings(){return {settings:{assistantUsageDisplayMode:'remaining'},updateSettings:()=>{},overview:null,overviewLoading:false,overviewError:null,usageCards:[],initialAccountLoading:false,applyAccountOverview:()=>{},loadOverview}}`
 const menuStub = `import React,{useEffect,useRef} from 'react';export function AnchoredMenuPopover({children,autoFocus,label}){const ref=useRef(null);useEffect(()=>{if(autoFocus)ref.current.querySelector('button')?.focus()},[]);return <div ref={ref} role="menu" aria-label={label}>{children}</div>}`
 const build=await Bun.build({entrypoints:['usage-ui-harness'],target:'browser',loader:{'.svg':'dataurl','.png':'dataurl'},plugins:[{name:'usage-ui-fixture',setup(builder){
  builder.onLoad({filter:/\.(png|svg)$/},async args=>({contents:'export default '+JSON.stringify('data:'+(args.path.endsWith('.svg')?'image/svg+xml':'image/png')+';base64,'+(await readFile(args.path)).toString('base64')),loader:'js'}))
  builder.onResolve({filter:/^usage-ui-harness$/},()=>({path:'harness',namespace:'fixture'}))
  builder.onResolve({filter:/useOpenAIAccountSettings$/},()=>({path:'connection',namespace:'fixture'}))
  builder.onResolve({filter:/AnchoredMenuPopover$/},()=>({path:'menu',namespace:'fixture'}))
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='harness'?harness:args.path==='menu'?menuStub:connectionStub,loader:'tsx',resolveDir:resolve(import.meta.dir,'..')}))
  builder.onResolve({filter:/^(@\/|@shared\/)/},args=>{const base=args.path.startsWith('@shared/')?resolve(import.meta.dir,'../src/shared',args.path.slice(8)):join(source,args.path.slice(2));return {path:['','.ts','.tsx','.js','/index.ts','/index.tsx'].map(ext=>base+ext).find(path=>existsSync(path)&&statSync(path).isFile())||base}})
 }}]})
 if(!build.success)throw Error(build.logs.map(String).join('\n'))
 const bundled=await build.outputs.find(row=>row.path.endsWith('.js'))!.text();

 await writeFile(join(directory,'test.js'),bundled)
 const css=await postcss([tailwindcss({...config,content:['./src/renderer/src/pages/settings/**/*.{ts,tsx}','./src/renderer/src/components/ui/*.{ts,tsx}']})]).process('@tailwind base;@tailwind utilities;',{from:undefined})
 const pageCss=await readFile(join(source,'pages/settings/usage/UsagePage.css'),'utf8')
 await writeFile(join(directory,'test.html'),`<style>:root{--settings-bg:#0e151a;--settings-text:#d9ddd8;--settings-text-secondary:#a0aaa7;--settings-text-muted:#717e83;--settings-text-faint:#59676d;--settings-divider:#293138;--settings-control:#1d262d;--settings-nav-active:#33404a;--settings-row-hover:#1d262d;--settings-track:#293138;--settings-surface:#172027;--surface-floating:#172027;--surface-divider:#293138;--accent-primary:#ffad40;--accent-secondary:#8095d0;--status-success:#6bce96;--status-warning:#ffad40;--status-error:#ec7581;--color-bg:#0e151a;--color-text:#d9ddd8;--color-text-muted:#717e83;--color-text-secondary:#a0aaa7}body{background:var(--settings-bg);color:var(--settings-text);font:13px Arial}${css.css}\n${pageCss}</style><div id="root"></div><script type="module" src="test.js"></script>`)
 await mkdir(output,{recursive:true})
 await writeFile(join(directory,'main.cjs'),`
 const {app,BrowserWindow}=require('electron'),fs=require('node:fs');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});
 app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1180,height:1020,webPreferences:{backgroundThrottling:false}});let capturing=false;win.webContents.on('console-message',async(event,_level,legacy)=>{const message=typeof legacy==='string'?legacy:event.message;console.log(message);if(message.includes('USAGE_UI_FAIL'))app.exit(1);if(message.includes('USAGE_UI_READY')&&!capturing){capturing=true;try{for(const size of [1180,760,390]){win.setContentSize(size,1020);await win.webContents.executeJavaScript('fixtureResize()');console.log(await win.webContents.executeJavaScript('JSON.stringify(fixtureGeometry())'));fs.writeFileSync(${JSON.stringify(output)}+'/usage-'+size+'.png',(await win.webContents.capturePage()).toPNG())}console.log('USAGE_UI_PASS');app.exit(0)}catch(error){console.error(error);app.exit(1)}}});await win.loadFile(${JSON.stringify(join(directory,'test.html'))})});setTimeout(()=>app.exit(1),45000)
 `)
 const electron=createRequire(import.meta.url)('electron') as string
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const child=spawn(electron,[join(directory,'main.cjs')],{env,stdio:'inherit',windowsHide:true})
 const code=await new Promise<number>((accept,reject)=>{child.on('error',reject);child.on('exit',code=>accept(code??1))})
 if(code!==0)throw Error('Usage renderer fixture exited '+code)
}finally{
 if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('zyra-usage-ui-'))throw Error('Unexpected fixture path')
 await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
