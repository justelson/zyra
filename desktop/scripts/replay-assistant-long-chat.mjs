import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { visualizationFrameDocument } from './maint/visualization-frame-document.mjs'

const input = process.argv[2], report = process.argv[3]
const profiling = process.argv.includes('--profile')
const navigation = process.argv.includes('--navigation')
if (!input || !report) throw new Error('Usage: node desktop/scripts/replay-assistant-long-chat.mjs <private render-pages.json> <report.json>')
const pages = JSON.parse(await readFile(resolve(input), 'utf8'))
if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page.messages))) throw new Error('Invalid replay pages')
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(os.tmpdir(), 'zyra-chat-replay-'))
try {
    await build({ entryPoints: [join(desktop, navigation ? 'scripts/fixtures/assistant-history-navigation.tsx' : 'scripts/fixtures/assistant-long-chat-replay.tsx')], bundle: true, outfile: join(directory, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' }, alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') } })
    const shell = await readFile(join(desktop, 'src/renderer/index.html'), 'utf8')
    const policy = shell.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    if (!policy) throw new Error('Missing application CSP')
    await writeFile(join(directory, 'data.js'), `window.longChatReplayPages=${JSON.stringify(pages)};`)
    await writeFile(join(directory, 'visualization-frame.html'), visualizationFrameDocument())
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head>${policy}<style>
    html,body,#root{height:100%;margin:0}.assistant-chat-scrollbar{overflow-anchor:none}body{font:14px system-ui;background:#101318;color:#eef1f6}.h-full{height:100%}.w-full{width:100%}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.pb-4{padding-bottom:16px}article{padding:12px;overflow-wrap:anywhere}p{margin:8px 0}iframe{display:block;width:100%;border:0}img,video{max-width:100%;max-height:560px}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{padding:4px;border:1px solid #343b46}
    </style></head><body><div id="root"></div><script src="./data.js"></script><script src="./fixture.js"></script></body></html>`)
    await writeFile(join(directory, 'run.cjs'), `
    const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs');
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    const timeout=setTimeout(()=>{console.error('Replay timed out');app.exit(1)},90000);
    app.whenReady().then(async()=>{
        session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:!['file:','data:','blob:','about:','devtools:'].includes(new URL(details.url).protocol)}));
        const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        win.webContents.setFrameRate(60);
        await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
        if (${profiling}) {win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Profiler.enable');await win.webContents.debugger.sendCommand('Profiler.start');}
        const result=await win.webContents.executeJavaScript('window.longChatReplayCheck');
        if (${profiling}) {const trace=await win.webContents.debugger.sendCommand('Profiler.stop');fs.writeFileSync(${JSON.stringify(resolve(report + '.cpuprofile'))},JSON.stringify(trace.profile));win.webContents.debugger.detach();}
        result.processes=app.getAppMetrics().map(p=>({type:p.type,workingSetKiB:p.memory.workingSetSize,peakWorkingSetKiB:p.memory.peakWorkingSetSize}));
        fs.writeFileSync(${JSON.stringify(join(directory, 'report.json'))},JSON.stringify(result,null,2));
        clearTimeout(timeout);win.destroy();app.quit();
    }).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((done,reject) => {
        const child = spawn(electronPath, [join(directory, 'run.cjs')], { cwd: desktop, env, windowsHide: true, stdio: 'inherit' })
        const timeout = setTimeout(() => child.kill(), 100_000)
        child.once('error',error=>{ clearTimeout(timeout); reject(error) }); child.once('exit',value=>{ clearTimeout(timeout); done(value ?? 1) })
    })
    if (code !== 0) throw new Error(`Replay exited ${code}`)
    const result = await readFile(join(directory, 'report.json'), 'utf8')
    await mkdir(dirname(resolve(report)), { recursive:true }); await writeFile(resolve(report),result)
    console.log(result)
} finally {
    if (dirname(directory) !== os.tmpdir() || !basename(directory).startsWith('zyra-chat-replay-')) throw new Error('Unexpected replay cleanup path')
    await rm(directory,{ recursive:true,force:true })
}
