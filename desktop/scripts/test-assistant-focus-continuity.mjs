import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import electronPath from 'electron'

const desktop = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-focus-continuity-'))
try {
    await writeFile(join(directory, 'settings.ts'), `import {loadSettings} from ${JSON.stringify(join(desktop,'src/renderer/src/lib/settings.tsx'))};const settings={...loadSettings({}),assistantAllowCollapseWhileWorking:false};export function useSettings(){return {settings}}`)
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/assistant-focus-continuity.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        alias: { '@/lib/settings': join(directory,'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, loader: { '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'false' } })
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    await writeFile(join(directory, 'index.html'), '<textarea id="composer">Initial prompt</textarea><textarea id="other-composer">Another draft</textarea><iframe id="browser"></iframe><div id="root"></div><script src="fixture.js"></script>')
    await writeFile(join(directory, 'run.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});app.disableHardwareAcceleration();
const timeout=setTimeout(()=>{console.error('Focus continuity timed out');app.exit(1)},25000);app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});let focusCount=0;win.on('focus',()=>focusCount++);
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));await win.loadFile(${JSON.stringify(join(directory,'index.html'))});
 const results=await win.webContents.executeJavaScript('window.focusContinuityCheck');for(const result of results)console.log('PASS: '+result);
 if(focusCount)throw Error('Hidden fixture took OS focus');console.log('OS focus events: '+focusCount);clearTimeout(timeout);win.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electronPath, [join(directory, 'run.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    assert.equal(code, 0, output)
} finally {
    if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('zyra-focus-continuity-')) throw Error('Unexpected focus fixture cleanup target')
    await rm(directory, { recursive: true, force: true })
}
