import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import config from '../tailwind.config.js'

const directory = await mkdtemp(join(tmpdir(), 'zyra-account-identity-'))
const source = (file: string) => JSON.stringify(resolve(import.meta.dir, '../src/renderer/src', file))
const harness = `
import React,{act,useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Activity,Settings} from 'lucide-react'
import {ChatGptAccountIdentity} from ${source('pages/settings/providers/ChatGptAccountIdentity.tsx')}
import {useChatGptAccountPool} from ${source('pages/settings/providers/useChatGptAccountPool.ts')}
import {subscribeChatGptAccounts} from ${source('lib/chatgpt-account-events.ts')}
import {buildAccountUsageResults} from ${source('components/command-palette-account-usage.tsx')}
import {CommandPaletteResults} from ${source('components/CommandPaletteResults.tsx')}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const check=(value,message)=>{if(!value)throw Error(message)}
let current={accounts:[{id:'fixture',alias:'Quiet Comet 123',email:'hidden@example.test',primary:true,enabled:true,plan:'plus',state:'ready',usage:null}],policy:{strategy:'balanced',accountMode:'all',accountIds:[],preferredAccountId:null},checkedAt:'2026-10-13T12:00:00Z'}
const updates=[],timers=new Map()
const setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window)
let timerId=90000,opened=0
window.setTimeout=(fn,ms,...args)=>{if(ms!==20000)return setTimer(fn,ms,...args);const id=timerId++;timers.set(id,fn);return id}
window.clearTimeout=id=>{if(timers.has(id)){timers.delete(id);return}clearTimer(id)}
window.devscope={onboarding:{getChatGptAccounts:async()=>({success:true,pool:structuredClone(current)}),updateChatGptAccounts:input=>new Promise(resolve=>updates.push({input,resolve}))}}
function Harness(){
 const pool=useChatGptAccountPool({usageActive:false})
 const [palette,setPalette]=useState(current)
 const [selectedIndex,setSelectedIndex]=useState(1)
 useEffect(()=>subscribeChatGptAccounts(setPalette),[])
 const results=[...buildAccountUsageResults(palette,()=>opened++),{id:'local',title:'Local activity',icon:<Activity/>,group:'Local activity',action:()=>opened++},{id:'details',title:'Open usage details',icon:<Settings/>,group:'Actions',action:()=>opened++}]
 return <><div id="limits">{pool.snapshot&&<ChatGptAccountIdentity account={pool.snapshot.accounts[0]} disabled={pool.busy} onRename={alias=>pool.update({action:'alias',accountId:'fixture',alias})}/>}</div><div id="palette"><CommandPaletteResults query="usage" results={results} selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex} selectResult={result=>result.action()} loading={false} searchFailed={false} indexingOlderChats={false}/></div></>
}
const root=createRoot(document.getElementById('root'))
const button=(surface,label)=>document.querySelector('#'+surface+' [aria-label="'+label+'"]')
const flush=(ms=10)=>act(async()=>{await new Promise(resolve=>setTimer(resolve,ms))})
// A hidden Electron window leaves CSS transition clocks at zero. Verify their
// shared timings, then finish finite transitions to inspect the painted endpoint.
const finishTransitions=()=>{for(const animation of document.getAnimations())if(animation.effect.getTiming().iterations!==Infinity)animation.finish()}
try{
 await act(async()=>root.render(<Harness/>));await flush()
 check(!document.body.innerHTML.includes('hidden@example.test'),'default DOM, tooltip and accessibility labels contain no email')
 check(!document.querySelector('button button'),'palette contains no nested buttons')
 const rows=[...document.querySelectorAll('#palette [role="option"]')]
 const iconColor=row=>getComputedStyle(row.querySelector('[data-command-palette-icon]')).color
 const titleColor=row=>getComputedStyle(row.querySelector('[data-command-palette-title]')).color
 check(iconColor(rows[1])===titleColor(rows[1])&&iconColor(rows[1])==='rgb(255, 153, 0)','selected icon and title share the accent')
 for(const row of rows){
  await act(async()=>row.dispatchEvent(new MouseEvent('mousemove',{bubbles:true})))
  const colors=row.getAnimations({subtree:true}).filter(animation=>animation.effect.target.matches('[data-command-palette-icon],[data-command-palette-title]'))
  check(colors.length===2&&colors.every(animation=>animation.effect.getTiming().duration===150),'icon and title use the same transition timing')
  finishTransitions()
  check(row.getAttribute('aria-selected')==='true'&&iconColor(row)===titleColor(row)&&iconColor(row)==='rgb(255, 153, 0)','average, account, local activity and action icons follow selection '+JSON.stringify({id:row.id,selected:row.getAttribute('aria-selected'),icon:iconColor(row),title:titleColor(row),iconClass:row.querySelector('[data-command-palette-icon]').className,animations:row.getAnimations({subtree:true}).map(animation=>({time:animation.currentTime,state:animation.playState,duration:animation.effect.getTiming().duration}))}))
 }
 check(iconColor(rows[1])==='rgb(136, 153, 170)','prior icon clears its selection highlight')
 await act(async()=>button('palette','Show email for Quiet Comet 123').focus())
 finishTransitions()
 check(iconColor(rows[1])===titleColor(rows[1])&&iconColor(rows[1])==='rgb(255, 153, 0)','focused identity controls highlight their row icon and title together')
 button('palette','Show email for Quiet Comet 123').blur()
 await act(async()=>button('palette','Show email for Quiet Comet 123').click())
 check(document.querySelector('#palette').textContent.includes('hidden@example.test')&&!document.querySelector('#limits').textContent.includes('hidden@example.test')&&!opened,'click reveals only this surface and does not navigate')
 check(!button('palette','Hide email for Quiet Comet 123').querySelector('svg'),'reveal control has no eye icon')
 await act(async()=>button('palette','Hide email for Quiet Comet 123').click())
 check(!document.body.innerHTML.includes('hidden@example.test'),'second click restores the alias')
 await act(async()=>button('limits','Show email for Quiet Comet 123').click())
 await act(async()=>window.dispatchEvent(new Event('blur')))
 check(!document.body.innerHTML.includes('hidden@example.test'),'leaving the window hides email')
 await act(async()=>button('limits','Show email for Quiet Comet 123').click())
 await act(async()=>[...timers.values()][0]())
 check(!document.body.innerHTML.includes('hidden@example.test'),'email auto-hides after the reveal interval')
 await act(async()=>button('palette','Rename Quiet Comet 123').click())
 let input=document.querySelector('#palette input')
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Work account');input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>button('palette','Save account name').click())
 check(updates.length===1&&updates[0].input.action==='alias'&&updates[0].input.alias==='Work account','rename invokes the real alias API contract')
 check(button('palette','Save account name').disabled,'pending save disables only its editor')
 current={...current,accounts:[{...current.accounts[0],alias:'Work account'}]}
 await act(async()=>updates[0].resolve({success:true,pool:structuredClone(current)}));await flush()
 check(button('limits','Show email for Work account')&&button('palette','Show email for Work account'),'acknowledged aliases update both usage surfaces immediately')
 check(!document.body.innerHTML.includes('hidden@example.test'),'rename does not reveal email')
 await act(async()=>button('limits','Rename Work account').click())
 await act(async()=>button('limits','Save account name').click())
 await act(async()=>updates[1].resolve({success:false,error:'Synthetic failure'}));await flush()
 check(document.querySelector('#limits [role="alert"]')&&document.querySelector('#limits input'),'failed save preserves the editor for retry')
 await act(async()=>button('limits','Cancel account rename').click())
 check(button('limits','Show email for Work account'),'cancel retains the saved name')
 await act(async()=>root.unmount())
 check(!timers.size,'reveal timers are cleaned up')
 console.log('ACCOUNT_IDENTITY_PASS')
}catch(error){console.error('ACCOUNT_IDENTITY_FAIL',error.stack||String(error))}
`
try {
    const build = await Bun.build({ entrypoints: ['account-identity-harness'], target: 'browser', plugins: [{ name: 'account-identity', setup(builder) {
        builder.onResolve({ filter: /^account-identity-harness$/ }, () => ({ path: 'harness', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
        builder.onResolve({ filter: /^@\// }, args => {
            const base = resolve(import.meta.dir, '../src/renderer/src', args.path.slice(2))
            return { path: ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'].map(extension => base + extension).find(existsSync) || base }
        })
    } }] })
    if (!build.success) throw new Error(build.logs.map(String).join('\n'))
    await writeFile(join(directory, 'test.js'), await build.outputs[0].text())
    const stylingSources = await Promise.all(['components/CommandPaletteResults.tsx', 'pages/settings/providers/ChatGptAccountIdentity.tsx'].map(file => readFile(resolve(import.meta.dir, '../src/renderer/src', file), 'utf8')))
    const css = await postcss([tailwindcss({ ...config, content: stylingSources.map(raw => ({ raw, extension: 'tsx' })) })]).process('@tailwind utilities;', { from: undefined })
    await writeFile(join(directory, 'test.html'), `<style>:root{--accent-primary:#ff9900;--color-text-muted:#657789;--color-text:#ddeeff;--color-text-secondary:#8899aa}${css.css}</style><div id="root"></div><script type="module" src="test.js"></script>`)
    await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});win.webContents.on('console-message',(event,_level,legacy)=>{const message=typeof legacy==='string'?legacy:event.message;console.log(message);if(message.includes('ACCOUNT_IDENTITY_PASS'))app.exit(0);if(message.includes('ACCOUNT_IDENTITY_FAIL'))app.exit(1)});await win.loadFile(${JSON.stringify(join(directory, 'test.html'))})});setTimeout(()=>app.exit(1),30000);
`)
    const electron = createRequire(import.meta.url)('electron') as string
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.on('error', reject); child.on('exit', code => accept(code ?? 1)) })
    if (code !== 0) throw new Error(`Account identity fixture exited ${code}`)
} finally { await rm(directory, { recursive: true, force: true }) }
