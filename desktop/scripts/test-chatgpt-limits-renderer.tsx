import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { ZyraCredentialStore, createZyraCredentialAuthStorage } from '../../src/zyra-auth-store.mjs'
import { ChatGptAccountPool, chatGptIdentity } from '../../src/chatgpt-account-pool.mjs'

const root = await mkdtemp(join(tmpdir(), 'zyra-limits-renderer-'))
const authPath = join(root, 'credentials', 'auth.json')
const store = new ZyraCredentialStore({ authPath })
const auth = await createZyraCredentialAuthStorage({ credentialStore: store })
const token = (id: string) => `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: id, chatgpt_plan_type: 'plus' }, 'https://api.openai.com/profile': { email: `${id}@example.test` } })).toString('base64url')}.fixture`
const ids: string[] = []
for (const id of ['a', 'b']) {
    const credential = { type: 'oauth', accountId: id, access: token(id), refresh: `fixture-refresh-${id}`, expires: Date.now() + 3600000 }
    await auth.loginOAuth('openai-codex', credential)
    ids.push(chatGptIdentity(credential).id)
}
const pool = new ChatGptAccountPool(store)
for (const [index, id] of ids.entries()) await pool.recordUsage(id, { primary: { usedPercent: index ? 20 : 90, resetAt: new Date(Date.now() + 1800000).toISOString(), windowSeconds: 18000 }, secondary: { usedPercent: 30, resetAt: new Date(Date.now() + 86400000).toISOString(), windowSeconds: 604800 } })
const renderer = resolve(import.meta.dir, '../src/renderer/src')
const harness = `
import React,{act,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ChatGptAccountPoolSection} from ${JSON.stringify(join(renderer, 'pages/settings/providers/ChatGptAccountPoolSection.tsx'))}
import {useChatGptAccountPool} from ${JSON.stringify(join(renderer, 'pages/settings/providers/useChatGptAccountPool.ts'))}
import {BrowserLinkHoverStatus} from ${JSON.stringify(join(renderer, 'pages/assistant/BrowserLinkHoverStatus.tsx'))}
import {createMarkdownComponents} from ${JSON.stringify(join(renderer, 'components/ui/markdown/components.tsx'))}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const check=(value,message)=>{if(!value)throw Error(message)}
const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,100))})
const wait=async(predicate,label='UI')=>{for(let i=0;i<60&&!predicate();i++)await tick();check(predicate(),'Timed out waiting for '+label)}
const connection={desktopHost:true,connectionBusy:false,connectionAction:null,connectionError:null,chatGptDeviceCode:null,chatGptDeviceCodeOpen:false,chatGptAuthenticationSuccessOpen:false,connectChatGpt:async()=>{},cancelChatGpt:async()=>{},dismissChatGptDeviceCode:()=>{},setChatGptAuthenticationSuccessOpen:()=>{}}
function Harness(){const pool=useChatGptAccountPool(),slot=useRef(null),[url,setUrl]=useState('');React.useEffect(()=>window.fixture.onHover(url=>{act(()=>setUrl(url))}),[]);const A=createMarkdownComponents('/fixture/readme.md').a;return <><ChatGptAccountPoolSection pool={pool}/><A href="https://openai.com/brand/">Website</A><div ref={slot} style={{position:'fixed',left:640,top:420,width:300,height:100}}/><BrowserLinkHoverStatus url={url} slot={slot}/></>}
const root=createRoot(document.getElementById('root'))
try{
 await act(async()=>root.render(<Harness/>));await wait(()=>document.querySelector('[aria-label="ChatGPT usage strategy"]'))
 check(document.body.textContent.includes('a@example.test')&&document.body.textContent.includes('b@example.test'),'separate account rows render')
 check(document.querySelectorAll('[role=meter]').length===1&&document.querySelector('[role=meter]').getAttribute('aria-label')==='Weekly average remaining','one Weekly summary, with both individual windows below')
 check(!document.body.textContent.includes('Add account')&&!document.body.textContent.includes('ChatGPT account'),'Limits does not contain account sign-in or the old primary account panel')
 check(document.querySelectorAll('[data-chatgpt-usage-window]').length===4,'each reported usage window appears once')
 check(document.querySelectorAll('[data-chatgpt-usage-account]').length===2,'two native usage windows share one row per account')
 const change=async(label,value)=>{await act(async()=>{const select=document.querySelector('[aria-label="'+label+'"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))});await wait(()=>!document.querySelector('[aria-label="ChatGPT usage strategy"]').disabled)}
 await change('ChatGPT usage strategy','fill-first');check(document.querySelector('[aria-label="ChatGPT preferred account"]'),'drain-first reveals account preference')
 await change('ChatGPT preferred account',${JSON.stringify(ids[1])});check((await window.devscope.onboarding.getChatGptAccounts()).pool.policy.preferredAccountId===${JSON.stringify(ids[1])},'preference persists in native backend')
 await change('Allowed ChatGPT accounts','selected');check(!document.querySelector('input[type=checkbox]'),'selected accounts do not create a duplicated list')
 await act(async()=>document.querySelector('button[title="Usage options for a@example.test"]').click());await wait(()=>document.querySelector('[role=menu]'))
 await act(async()=>[...document.querySelectorAll('[role^=menuitem]')].find(item=>item.textContent.includes('Exclude this account')).click());await wait(()=>!document.querySelector('[aria-label="ChatGPT usage strategy"]').disabled)
 check((await window.devscope.onboarding.getChatGptAccounts()).pool.policy.accountIds.length===1,'selected-only change reaches the saved policy')
 await act(async()=>document.querySelector('[aria-label="Enable b@example.test"]').click());await wait(()=>!document.querySelector('[aria-label="ChatGPT usage strategy"]').disabled)
 check((await window.devscope.onboarding.getChatGptAccounts()).pool.accounts.find(a=>a.email==='b@example.test').state==='paused','pause reaches saved account state')
 check(document.querySelector('a[href="https://openai.com/brand/"]').className.includes('decoration-dotted'),'website hover uses dotted decoration')
 await window.fixture.hover();await wait(()=>document.querySelector('[data-browser-link-hover]')?.textContent==='https://example.test/destination','Chromium link hover')
 const hint=document.querySelector('[data-browser-link-hover]');check(hint.style.left==='648px'&&parseFloat(hint.style.maxWidth)<=284,'native link hint uses browser slot left edge and width')
 await window.fixture.leave();await wait(()=>!document.querySelector('[data-browser-link-hover]'))
 await act(async()=>root.unmount());console.log('LIMITS_RENDERER_PASS')
}catch(error){console.error('LIMITS_RENDERER_FAIL',error.stack)}
`
try {
    const build = await Bun.build({ entrypoints: ['limits-renderer-harness'], target: 'browser', plugins: [{ name: 'limits-fixture', setup(builder) {
        builder.onResolve({ filter: /^limits-renderer-harness$/ }, () => ({ path: 'harness', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'tsx', resolveDir: resolve(import.meta.dir, '..') }))
    } }] })
    if (!build.success) throw Error(build.logs.join('\n'))
    await writeFile(join(root, 'harness.js'), await build.outputs.find(output => output.path.endsWith('.js'))!.text())
    await writeFile(join(root, 'test.html'), '<style>body{margin:12px;background:#191919;color:#ddd;font:13px sans-serif}section{border:1px solid #444;margin:8px;padding:10px}button,select{padding:5px;margin:3px;background:#292929;color:#ddd;border:1px solid #555}h3,p{margin:4px}select{width:190px}p{color:#aaa}</style><div id="root"></div><script type="module" src="harness.js"></script>')
    await writeFile(join(root, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('devscope',{onboarding:{getChatGptAccounts:()=>ipcRenderer.invoke('pool-get'),updateChatGptAccounts:input=>ipcRenderer.invoke('pool-update',input)}});contextBridge.exposeInMainWorld('fixture',{onHover:fn=>{const handler=(_e,url)=>fn(url);ipcRenderer.on('hover',handler);return()=>ipcRenderer.removeListener('hover',handler)},hover:()=>ipcRenderer.invoke('hover'),leave:()=>ipcRenderer.invoke('leave')});`)
    const backend = pathToFileURL(resolve(import.meta.dir, '../../src/chatgpt-pool-service.mjs')).href
    await writeFile(join(root, 'main.cjs'), `const {app,BrowserWindow,WebContentsView,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(join(root, 'profile'))});app.whenReady().then(async()=>{const api=await import(${JSON.stringify(backend)}),options={authPath:${JSON.stringify(authPath)}};ipcMain.handle('pool-get',async()=>({success:true,pool:await api.getChatGptAccounts(options)}));ipcMain.handle('pool-update',async(_e,input)=>({success:true,pool:await api.updateChatGptAccounts(input,options)}));const window=new BrowserWindow({show:false,width:1000,height:600,webPreferences:{preload:${JSON.stringify(join(root, 'preload.cjs'))},backgroundThrottling:false}});window.webContents.on('console-message',event=>{const text=event.message;console.log(text);if(text.includes('LIMITS_RENDERER_PASS'))app.exit(0);if(text.includes('LIMITS_RENDERER_FAIL'))app.exit(1)});const guest=new WebContentsView({webPreferences:{backgroundThrottling:false}});window.contentView.addChildView(guest);guest.setBounds({x:640,y:420,width:300,height:100});guest.webContents.on('update-target-url',(_e,url)=>window.webContents.send('hover',url));guest.webContents.debugger.attach('1.3');ipcMain.handle('hover',async()=>{console.log('HOVER_GEOMETRY',JSON.stringify({window:window.getContentBounds(),guest:guest.getBounds(),layout:await guest.webContents.executeJavaScript("({width:innerWidth,height:innerHeight,hit:document.elementFromPoint(25,20)?.outerHTML})")}));await guest.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:25,y:20});});ipcMain.handle('leave',()=>guest.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:250,y:90}));await guest.webContents.loadURL('data:text/html,<a href="https://example.test/destination" style="position:absolute;left:10px;top:10px">Link</a>');await window.loadFile(${JSON.stringify(join(root, 'test.html'))});});setTimeout(()=>app.exit(1),45000);`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const electron = createRequire(import.meta.url)('electron') as string
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(root, 'main.cjs')]
    const virtualDisplay = process.platform === 'linux' && process.env.CI && !process.env.DISPLAY
    const child = spawn(virtualDisplay ? 'xvfb-run' : electron, virtualDisplay ? ['--auto-servernum', electron, ...args] : args, { env, stdio: 'inherit', windowsHide: true })
    const code = await new Promise<number>((accept, reject) => { child.on('error', reject); child.on('exit', code => accept(code ?? 1)) })
    if (code) throw Error(`Limits renderer fixture exited ${code}`)
    console.log('Live Limits renderer -> saved policy/account controls and Chromium hover -> browser destination hint: ok')
} finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('zyra-limits-renderer-')) throw Error('Unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true })
}
