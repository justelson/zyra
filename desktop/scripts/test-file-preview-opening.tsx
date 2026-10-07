import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const directory = await mkdtemp(join(tmpdir(), 'zyra-file-opening-'))
const harness = `
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {useFilePreview} from ${JSON.stringify(resolve(import.meta.dir, '../src/renderer/src/components/ui/file-preview/useFilePreview.ts'))}
import {useFilePreviewEditSession} from ${JSON.stringify(resolve(import.meta.dir, '../src/renderer/src/components/ui/file-preview/useFilePreviewEditSession.ts'))}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const check = (condition, message) => {if (!condition) throw Error(message)}
const reads = []
window.devscope = {readFileContent:(path,options)=>new Promise(resolve=>reads.push({path,options,resolve}))}
let preview
function Harness(){preview=useFilePreview();return <div>{preview.previewFile?.readError || preview.previewContent}</div>}
let editing
function EditHarness({content='',loading=false,path='/project/edit.txt'}){editing=useFilePreviewEditSession({file:{path,name:'edit.txt',type:'text'},content,loading,canEdit:!loading,initialMode:'edit',onClose:()=>{}});return <div>{editing.draftContent}</div>}
const root=createRoot(document.getElementById('root'))
const begin=(name,mode='replace')=>{let request;act(()=>{request=(mode==='replace'?preview.openPreview:preview.openPreviewInNewTab)({name,path:'/project/'+name},'txt')});return request}
const settle=async(index,content)=>act(async()=>reads[index].resolve({success:true,content,size:content.length,modifiedAt:1}))
try {
 await act(async()=>root.render(<Harness/>))
 const first=begin('first.txt');check(!preview.previewFile,'cold read does not publish an empty editor');await settle(0,'first');await act(async()=>first)
 check(preview.previewContent==='first'&&!preview.loadingPreview,'first commit contains complete content')
 const slow=begin('slow.txt');check(preview.previewFile.name==='first.txt'&&preview.previewContent==='first','replacement keeps the current content readable')
 const fast=begin('fast.txt');await settle(2,'fast');await act(async()=>fast);await settle(1,'slow');await act(async()=>slow)
 check(preview.previewFile.name==='fast.txt'&&preview.previewContent==='fast','late replacement cannot overwrite the newer file')
 const closed=begin('closed.txt');await act(async()=>preview.closePreview());await settle(3,'closed');await act(async()=>closed)
 check(!preview.previewFile&&preview.previewTabs.length===0,'closing cancels delayed file opening')
 let cached;await act(async()=>{cached=preview.openPreview({name:'first.txt',path:'/project/first.txt'},'txt')})
 check(preview.previewContent==='first'&&!preview.loadingPreview,'cached content appears while disk validation is pending');await settle(4,'first changed');await act(async()=>cached)
 check(preview.previewContent==='first changed','disk validation refreshes cached content')
 const empty=begin('empty.txt');await settle(5,'');await act(async()=>empty);check(preview.previewFile.name==='empty.txt'&&!preview.loadingPreview,'empty files are successful ready documents')
 const failed=begin('missing.txt');await act(async()=>reads[6].resolve({success:false,error:'File not found'}));await act(async()=>failed)
 check(preview.previewFile.readError==='File not found'&&document.body.textContent.includes('File not found'),'failed reads expose an error rather than an editable empty file')
 const retry=begin('missing.txt');await settle(7,'recovered');await act(async()=>retry)
 check(!preview.previewFile.readError&&preview.previewContent==='recovered','retry replaces a failed tab with recovered content')
 await act(async()=>preview.closePreview())
 const tabA=begin('tab-a.txt','new-tab'),tabB=begin('tab-b.txt','new-tab');await settle(9,'B');await act(async()=>tabB);await settle(8,'A');await act(async()=>tabA)
 check(preview.previewTabs.length===2&&preview.previewContent==='B','parallel new tabs survive without delayed focus theft')
 await act(async()=>preview.closePreview())
 const sameA=begin('same.txt','new-tab'),sameB=begin('same.txt','new-tab');await settle(10,'shared');await act(async()=>Promise.all([sameA,sameB]))
 check(preview.previewTabs.length===1&&preview.previewContent==='shared','concurrent opens of one file share one tab')
 await act(async()=>root.render(<EditHarness loading/>));await act(async()=>root.render(<EditHarness content="first actual file content"/>))
 check(editing.draftContent==='first actual file content','first disk read fills the editor rather than staying blank')
 await act(async()=>editing.setDraftContent('my unsaved edits'));await act(async()=>root.render(<EditHarness content="watcher refresh"/>))
 check(editing.draftContent==='my unsaved edits','later refresh preserves unsaved edits')
 await act(async()=>root.render(<EditHarness path="/project/other.txt" content="other file"/>))
 check(editing.draftContent==='other file','switching files binds the editor to the new content')
 await act(async()=>root.unmount());console.log('FILE_OPENING_PASS')
}catch(error){console.error('FILE_OPENING_FAIL '+error.stack)}
`
try {
    const build = await Bun.build({entrypoints:['file-opening-harness'],target:'browser',plugins:[{name:'isolated-file-opening',setup(builder){
        builder.onResolve({filter:/^file-opening-harness$/},()=>({path:'harness',namespace:'fixture'}))
        builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:harness,loader:'tsx',resolveDir:resolve(import.meta.dir,'..')}))
        builder.onResolve({filter:/^@\/lib\/product-analytics$|^\.\/(?:FileMarkdownPreview|CsvPreviewTable|MonacoPreviewEditor)$/},args=>({path:args.path,namespace:'mock'}))
        builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const captureProductEvent=()=>{};export const warmFileMarkdownPreview=()=>{};export default ()=>null;',loader:'js'}))
    }}]})
    if(!build.success) throw Error(build.logs.join('\n'))
    await writeFile(join(directory,'harness.js'),await build.outputs[0].text())
    await writeFile(join(directory,'test.html'),'<div id="root"></div><script type="module" src="harness.js"></script>')
    await writeFile(join(directory,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});window.webContents.on('console-message',event=>{const message=event.message;console.log(message);if(message.includes('FILE_OPENING_PASS'))app.exit(0);if(message.includes('FILE_OPENING_FAIL'))app.exit(1)});await window.loadFile(${JSON.stringify(join(directory,'test.html'))})});setTimeout(()=>app.exit(1),30000);`)
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const electron=createRequire(import.meta.url)('electron') as string
    const args=[...(process.platform==='linux'&&process.env.CI?['--no-sandbox']:[]),join(directory,'main.cjs')]
    const virtualDisplay=process.platform==='linux'&&process.env.CI&&!process.env.DISPLAY
    const child=spawn(virtualDisplay?'xvfb-run':electron,virtualDisplay?['--auto-servernum',electron,...args]:args,{env,stdio:'inherit',windowsHide:true})
    const code=await new Promise<number>((accept,reject)=>{child.on('error',reject);child.on('exit',code=>accept(code??1))})
    if(code!==0) throw Error(`File opening fixture exited ${code}`)
    console.log('Ready file commits, warm refresh, errors, close and navigation races: ok')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-file-opening-')) throw Error('Unexpected fixture cleanup path')
    await rm(directory,{recursive:true,force:true})
}
