import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-final-response-'))
const evidence = resolve(desktop, '../docs.local/reviews/final-response-collapse')
const success = 'Final response disclosure: final phase collapse before text, animated zero height, reopen, both modes and live turn preserved: ok'
try {
    await mkdir(evidence, { recursive: true })
    await writeFile(join(directory, 'settings.ts'), 'export function useSettings(){ return { settings: { assistantAllowCollapseWhileWorking:false, assistantShowActionStats:false } } }')
    await build({ entryPoints: [join(desktop, 'scripts/fixtures/assistant-final-response-collapse.tsx')], outfile: join(directory, 'fixture.js'),
        bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.woff2': 'dataurl' },
        alias: { '@/lib/settings': join(directory, 'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'undefined' } })
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline'"><style>
      body{background:#191919;color:#c7c7c7;font:14px system-ui;margin:32px}main{max-width:720px}button{background:transparent;color:#aaa;border:0;padding:8px 0}svg{width:12px;height:12px}article{padding:18px 0}
      [data-state]{display:grid;transition:grid-template-rows .26s ease}[data-state="open"]{grid-template-rows:1fr}[data-state="closed"]{grid-template-rows:0fr}[data-state]>div{min-height:0;overflow:hidden}[data-action-evidence]{padding:12px 0;line-height:24px}
      </style></head><body><script src="./fixture.js"></script></body></html>`)
    const main = join(directory, 'main.cjs')
    await writeFile(main, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
let check;const timeout=setTimeout(()=>{console.error('Final response fixture deadline');app.exit(1)},15000);
app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});window.webContents.on('paint',()=>{});window.webContents.startPainting();
window.webContents.on('console-message',async(_event,_level,message)=>{if(message.includes(${JSON.stringify(success)})){clearTimeout(timeout);clearInterval(check);fs.writeFileSync(${JSON.stringify(join(evidence, 'collapsed-work.png'))},(await window.webContents.capturePage()).toPNG());console.log(message);app.exit(0)}});
await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});await window.webContents.capturePage();check=setInterval(async()=>{try{if(window.isDestroyed())return;await window.webContents.capturePage();const failure=await window.webContents.executeJavaScript('globalThis.__testFailed || null');if(failure){console.error(failure);clearInterval(check);clearTimeout(timeout);app.exit(1)}}catch{}},200);
}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const ciLinux = process.platform === 'linux' && Boolean(process.env.CI)
    const virtual = ciLinux && !process.env.DISPLAY
    const args = [...(ciLinux ? ['--no-sandbox'] : []), main]
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args,
            { cwd: desktop, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        let passed = false
        const watchdog = setTimeout(() => child.kill(), 20000)
        child.stdout.on('data', value => { passed ||= String(value).includes(success); process.stdout.write(value) })
        child.stderr.on('data', value => process.stderr.write(value))
        child.once('error', error => { clearTimeout(watchdog); reject(error) })
        child.once('exit', code => { clearTimeout(watchdog); done(code === 0 && passed ? 0 : code || 1) })
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-final-response-')) throw new Error('Unexpected final-phase fixture cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 })
}
