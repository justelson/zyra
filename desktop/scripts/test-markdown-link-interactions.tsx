import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const directory = await mkdtemp(join(tmpdir(), 'zyra-link-interactions-'))
const markdown = resolve(import.meta.dir, '../src/renderer/src/components/ui/markdown')
const harness = `
import React, {act,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {MarkdownInteractionLayer} from ${JSON.stringify(join(markdown, 'MarkdownInteractionLayer.tsx'))}
import {createMarkdownComponents} from ${JSON.stringify(join(markdown, 'components.tsx'))}
import {inspectMarkdownLinkAvailability,resetMarkdownLinkAvailabilityCache} from ${JSON.stringify(join(markdown, 'linkAvailability.ts'))}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const check=(value,message)=>{if(!value)throw Error(message)}
const calls={open:[],notice:[],reveal:[],browser:[],accessory:[],copy:[],stat:[]}
let exists=true,failed=false,deferred=null
Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value)=>calls.copy.push(value)},configurable:true})
window.devscope={getPathInfo:async(path)=>{calls.stat.push(path);if(deferred)return await new Promise(resolve=>deferred.push(()=>resolve({success:true,exists:true,path,type:'file'})));return failed?{success:false,error:'offline'}:{success:true,exists,path,type:exists?'file':null}},searchIndexedPaths:async()=>({success:true,entries:[],ancestors:[],totalMatched:0}),openInExplorer:async(path)=>{calls.reveal.push(path);return{success:true}},openBrowserPreviewExternal:async(url)=>{calls.browser.push(url);return{success:true}},accessories:{open:async(input)=>{calls.accessory.push(input);return{success:true}}}}
const onOpen=async(href)=>{calls.open.push(href);return true},onNotice=(message,tone)=>calls.notice.push({message,tone})
function Harness({filePath='/project/__assistant__.md',contentKey='one'}){const ref=useRef(null),components=createMarkdownComponents(filePath),A=components.a,Code=components.code;return <><div ref={ref}><A href="./note.md#L42">Note</A><A href="./missing.pdf">Missing PDF</A><A href="https://example.com">Website</A><A href="./src/"><Code>src/</Code></A><A href="./docs/current/"><strong><Code>docs/current/</Code></strong></A><Code>ordinary code</Code></div><MarkdownInteractionLayer rootRef={ref} filePath={filePath} searchRootPath="/project" contentKey={contentKey} onInternalLinkClick={onOpen} onLinkNotice={onNotice}/></>}
const root=createRoot(document.getElementById('root'))
const render=async(props={})=>act(async()=>root.render(<Harness {...props}/>))
const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,40))})
const anchor=(href)=>document.querySelector('a[href="'+href+'"]')
const click=async(href)=>{await act(async()=>anchor(href).click());await tick()}
const menu=async(href)=>{await act(async()=>anchor(href).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100})));await tick()}
const buttons=()=>[...document.querySelectorAll('[role=menuitem]')]
const item=(text)=>buttons().find(button=>button.textContent===text)
try{
 await render();await tick()
 check(anchor('./note.md#L42').querySelector('.markdown-inline-target-file-icon'),'file type icon renders for relative file links')
 check(anchor('./note.md#L42').textContent.includes('L42'),'line target is visible')
 check(!anchor('./src/').querySelector('code')&&anchor('./src/').querySelectorAll('.markdown-inline-target-file-icon').length===1,'code-formatted directory labels use one link chip and one icon')
 check(!anchor('./docs/current/').querySelector('code')&&anchor('./docs/current/').querySelector('strong'),'nested formatted code labels retain emphasis without extra code boxes')
 check(document.querySelector('code')?.textContent==='ordinary code','ordinary inline code keeps its own rendering')
 await click('./note.md#L42');check(calls.open.length===1&&calls.open[0]==='./note.md#L42','verified local target retains line number')
 exists=false;await click('./note.md#L42');check(calls.open.length===1&&anchor('./note.md#L42').dataset.markdownLinkState==='missing','fresh click detects deletion despite prior available cache')
 failed=true;await click('./note.md#L42');check(calls.open.length===1&&anchor('./note.md#L42').dataset.markdownLinkState==='unknown','bridge failure cannot navigate')
 failed=false;await menu('./missing.pdf');check(item('File not found')?.disabled&&item('Show in file manager')?.disabled,'missing file menu disables opening and revealing')
 check(!item('Open in default browser')&&item('Copy path'),'file menu contains only relevant actions')
 await act(async()=>item('Copy path').click());check(calls.copy.at(-1)==='/project/missing.pdf'&&!document.querySelector('[role=menu]'),'copy gets resolved path and closes menu')
 exists=true;await menu('./note.md#L42');check(!item('Open file').disabled,'existing file can open from context menu')
 await act(async()=>item('Show in file manager').click());check(calls.reveal.at(-1)==='/project/note.md','reveal checks and uses actual path without line fragment')
 await menu('https://example.com');check(item('Open in Zyra Browser')&&item('Open in default browser')&&!item('Copy path'),'web menu has browser actions')
 await act(async()=>item('Open in default browser').click());check(calls.browser.at(-1)==='https://example.com','default browser receives website URL')
 await menu('https://example.com');await act(async()=>item('Open in Zyra Browser').click());check(calls.accessory.at(-1)?.url==='https://example.com','Zyra Browser action opens existing browser accessory')
 await menu('./note.md#L42');await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));check(!document.querySelector('[role=menu]'),'Escape dismisses link menu')
 await menu('./note.md#L42');await render({contentKey:'two'});check(!document.querySelector('[role=menu]'),'navigation dismisses stale link menus')
 await render({filePath:''});check(anchor('./note.md#L42').querySelector('.markdown-inline-target-file-icon'),'relative file retains its icon before working folder is ready')
 await click('./note.md#L42');check(calls.open.length===1,'unresolved relative file never becomes a browser URL')
 await render();deferred=[];let pending;await act(async()=>{pending=anchor('./note.md#L42').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))});await render({filePath:'/other/__assistant__.md',contentKey:'other'});const oldChecks=deferred;deferred=null;await act(async()=>oldChecks.forEach(resolve=>resolve()));await tick();check(calls.open.length===1,'old file check cannot navigate after owner changes')
 resetMarkdownLinkAvailabilityCache();exists=true;await inspectMarkdownLinkAvailability('/project/Name.md',undefined,undefined,{allowProjectSearch:false});exists=false;const lower=await inspectMarkdownLinkAvailability('/project/name.md',undefined,undefined,{allowProjectSearch:false});check(lower.availability==='missing','POSIX path case remains distinct')
 await act(async()=>root.unmount());console.log('LINK_INTERACTIONS_PASS')
}catch(error){console.error('LINK_INTERACTIONS_FAIL '+error.stack)}
`
try {
    const build = await Bun.build({entrypoints:['link-interactions-harness'],target:'browser',plugins:[{name:'isolated-link-interactions',setup(builder){
        builder.onResolve({filter:/^link-interactions-harness$/},()=>({path:'harness',namespace:'fixture'}))
        builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:harness,loader:'tsx',resolveDir:resolve(import.meta.dir,'..')}))
        builder.onResolve({filter:/native-overlay-portal$/},()=>({path:'native-overlay',namespace:'mock'}))
        builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import {createPortal} from 'react-dom';export const createOverlayPortal=createPortal;export const getOverlayActiveElement=()=>document.activeElement;export const isOverlayEventInside=(event,element)=>element?.contains(event.target);export const addOverlayEventListener=(name,handler)=>{window.addEventListener(name,handler);return()=>window.removeEventListener(name,handler)};export const addOverlayWindowBlurListener=(handler)=>()=>{};`,loader:'js'}))
    }}]})
    if(!build.success) throw Error(build.logs.join('\n'))
    await writeFile(join(directory,'harness.js'),await build.outputs[0].text())
    await writeFile(join(directory,'test.html'),'<div id="root"></div><script type="module" src="harness.js"></script>')
    await writeFile(join(directory,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});window.webContents.on('console-message',event=>{const message=event.message;console.log(message);if(message.includes('LINK_INTERACTIONS_PASS'))app.exit(0);if(message.includes('LINK_INTERACTIONS_FAIL'))app.exit(1)});await window.loadFile(${JSON.stringify(join(directory,'test.html'))})});setTimeout(()=>app.exit(1),30000);`)
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const electron=createRequire(import.meta.url)('electron') as string
    const args=[...(process.platform==='linux'&&process.env.CI?['--no-sandbox']:[]),join(directory,'main.cjs')]
    const virtualDisplay=process.platform==='linux'&&process.env.CI&&!process.env.DISPLAY
    const child=spawn(virtualDisplay?'xvfb-run':electron,virtualDisplay?['--auto-servernum',electron,...args]:args,{env,stdio:'inherit',windowsHide:true})
    const code=await new Promise<number>((accept,reject)=>{child.on('error',reject);child.on('exit',code=>accept(code??1))})
    if(code!==0) throw Error(`Link interactions fixture exited ${code}`)
    console.log('Verified file navigation, deletion, bridge failures, icons, context menus and stale ownership: ok')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-link-interactions-')) throw Error('Unexpected fixture cleanup path')
    await rm(directory,{recursive:true,force:true})
}
