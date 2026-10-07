import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-preview-startup-'))
const server = await createServer({ root: desktop, configFile: false, logLevel: 'error', optimizeDeps: { entries: ['scripts/fixtures/preview-startup-runtime.html'] }, plugins: [react()], worker: { format: 'es' }, resolve: { alias: {
    '@/lib/settings': join(desktop, 'scripts/fixtures/preview-startup-settings.ts'),
    '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared'),
    'decode-named-character-reference': join(desktop, 'node_modules/decode-named-character-reference/index.js')
} }, server: { host: '127.0.0.1', port: 0 } })
try {
    await server.listen()
    const url = new URL('scripts/fixtures/preview-startup-runtime.html', server.resolvedUrls.local[0]).toString()
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const timer=setTimeout(()=>{console.error('Preview startup fixture timed out');app.exit(1)},60000);app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});if(process.env.ZYRA_PREVIEW_STARTUP_DEBUG==='1')window.webContents.on('console-message',event=>console.error('[DEBUG-preview-startup] '+event.message));await window.loadURL(${JSON.stringify(url)});for(let i=0;i<200;i++){if(await window.webContents.executeJavaScript('Boolean(window.previewStartupCheck)'))break;await new Promise(r=>setTimeout(r,100))}const result=await window.webContents.executeJavaScript('window.previewStartupCheck');console.log(JSON.stringify(result));clearTimeout(timer);app.quit()}).catch(e=>{console.error(e);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const useVirtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
    const result = await new Promise((resolveResult, reject) => {
        const child = spawn(useVirtualDisplay ? 'xvfb-run' : electronPath, useVirtualDisplay ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; let errors = ''
        child.stdout.on('data', chunk => { output += chunk.toString() })
        child.stderr.on('data', chunk => { errors += chunk.toString(); if (process.env.ZYRA_PREVIEW_STARTUP_DEBUG === '1') process.stderr.write(chunk) })
        child.once('error', reject)
        child.once('exit', code => {
            if (code !== 0) return reject(Error(`Preview startup failed (${code})\n${errors}\n${output}`))
            const line = output.trim().split(/\r?\n/).reverse().find(line => line.startsWith('{'))
            if (!line) return reject(Error(`Missing startup measurements\n${errors}\n${output}`))
            resolveResult(JSON.parse(line))
        })
    })
    console.log(JSON.stringify(result, null, 2))
    if (!process.argv.includes('--baseline')) {
        assert.equal(result.coldCode.readableOnCommit, true, 'cold editor initialization keeps the actual code readable')
        assert.equal(result.warmCode.readableOnCommit, true, 'warm opening shows code on the first commit, including while Monaco initializes')
    }
    console.log('Real preview startup: ok')
} finally {
    await Promise.race([server.close(), new Promise(resolve => setTimeout(resolve, 5_000))])
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-preview-startup-')) throw Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
