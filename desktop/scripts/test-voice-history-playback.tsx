// Pagination interaction coverage; existing test-voice-history-playback.mjs owns real WAV playback.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import electronPath from 'electron'

const desktop = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-voice-pages-ui-'))
try {
    await build({
        stdin: { resolveDir: desktop, loader: 'tsx', contents: `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { VoiceHistorySettings } from './src/renderer/src/pages/settings/VoiceHistorySettings'
const rows = Array.from({length: 41}, (_, index) => ({ id: String(index), createdAt: new Date(2026, 0, 1, 0, 0, 41-index).toISOString(), engine: 'codex', status: 'success', durationMs: 1000, transcript: 'Transcript '+index, error: null, hasRecording: false }))
const requests = []; const copied = []; const deleted = []
let fail = false
window.devscope = { copyToClipboard: async text => { copied.push(text); return {success:true} }, assistant: {
listVoiceHistory: async input => { requests.push(input.page); if(fail) {fail=false; return {success:false,error:'Synthetic load failure'}}; const totalPages=Math.max(1,Math.ceil(rows.length/20)); const page=Math.min(input.page,totalPages); return {success:true,entries:rows.slice((page-1)*20,page*20),page,pageSize:20,totalCount:rows.length,totalPages} },
deleteVoiceHistory: async id => { deleted.push(id); rows.splice(rows.findIndex(row=>row.id===id),1); return {success:true} }
} }
createRoot(document.getElementById('root')).render(<VoiceHistorySettings />)
const check=(value,label)=>{if(!value)throw Error(label)}
const until=async(predicate,label)=>{const deadline=Date.now()+4000;while(!predicate()){if(Date.now()>deadline)throw Error('Timeout: '+label);await new Promise(resolve=>setTimeout(resolve,10))}}
const button=text=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent===text)
window.runTest=async()=>{
await until(()=>document.querySelectorAll('article').length===20,'page one')
check(requests.join(',')==='1','initial requested page only')
check(button('Previous').disabled,'previous disabled at start')
button('Next').click()
await until(()=>document.body.textContent.includes('Page 2 of 3'),'page two')
check(document.querySelector('article').textContent.includes('Transcript 20'),'second page contains next twenty')
button('Refresh').click()
await until(()=>requests.length===3&&!button('Refresh').disabled,'refresh')
check(requests[2]===2,'refresh retains current page')
document.querySelector('button[title="Copy transcript"]').click()
await until(()=>copied.length===1,'copy')
check(copied[0]==='Transcript 20','copy targets requested page')
button('Next').click()
await until(()=>document.querySelectorAll('article').length===1,'last page')
check(button('Next').disabled,'next disabled at end')
document.querySelector('button[title="Delete entry"]').click()
await until(()=>document.querySelector('[role="dialog"]'),'confirmation')
button('Delete entry').click()
await until(()=>document.body.textContent.includes('Page 2 of 2')&&document.querySelectorAll('article').length===20,'clamped page after delete')
check(deleted[0]==='40','correct record deleted')
check(requests[requests.length-1]===3,'delete refetches current page for source clamping')
check(document.body.textContent.includes('40 entries'),'count updated')
fail=true;button('Refresh').click()
await until(()=>document.querySelector('[role="alert"]'),'refresh error')
check(document.querySelectorAll('article').length===20,'refresh error retains rows')
button('Refresh').click()
await until(()=>!document.querySelector('[role="alert"]')&&!button('Refresh').disabled,'retry')
button('Previous').click()
await until(()=>document.body.textContent.includes('Page 1 of 2'),'previous navigation')
return {pagination:true,copy:true,deleteClamping:true,currentPageRefresh:true,retry:true}
}
` },
        outfile: join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"development"', 'import.meta.hot': 'undefined' }
    })
    await writeFile(join(directory, 'index.html'), '<div id="root"></div><script src="./renderer.js"></script>')
    await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));
const watchdog=setTimeout(()=>app.exit(1),15000);
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({show:false,focusable:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});
await win.loadFile(path.join(__dirname,'index.html'));console.log(JSON.stringify(await win.webContents.executeJavaScript('window.runTest()',true)));clearTimeout(watchdog);win.destroy();app.exit(0);
}catch(error){console.error(error);clearTimeout(watchdog);win?.destroy();app.exit(1)}});
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.stdout.write(execFileSync(electronPath as unknown as string, [join(directory, 'main.cjs')], { cwd: desktop, env, encoding: 'utf8', windowsHide: true, timeout: 20000 }))
} finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
