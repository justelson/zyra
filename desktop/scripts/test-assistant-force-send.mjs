import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const restart = process.argv.includes('--restart')
const fixture = restart ? 'assistant-restart-send' : 'assistant-force-send'
const smoke = restart ? 'runRestartSendSmoke' : 'runForceSendSmoke'
const directory = await mkdtemp(join(tmpdir(), `zyra-${fixture}-`))
try {
    const index = await readFile(join(desktop, 'src/renderer/index.html'), 'utf8')
    const csp = index.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    if (!csp) throw new Error('Renderer CSP missing')
    await build({
        absWorkingDir: desktop, entryPoints: [`scripts/fixtures/${fixture}.tsx`],
        outfile: join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'true' },
        // Startup recovery imports a main-process utility whose ID generator is
        // unused here. Keep the real recovery policy, not Electron/Node services.
        plugins: restart ? [{ name: 'browser-uuid', setup(builder) {
            builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'uuid', namespace: 'browser-uuid' }))
            builder.onLoad({ filter: /.*/, namespace: 'browser-uuid' }, () => ({ contents: 'export const randomUUID = () => crypto.randomUUID();', loader: 'js' }))
        } }] : []
    })
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head>${csp}</head><body><div id="root"></div><script src="./renderer.js"></script></body></html>`)
    await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.setPath('sessionData',path.join(__dirname,'session'));
const watchdog=setTimeout(()=>{console.error('Force send test timed out');app.exit(1)},15000);
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
await win.loadFile(path.join(__dirname,'index.html'));
const result=await win.webContents.executeJavaScript('window.${smoke}()',true);
console.log(JSON.stringify({test:'${fixture}',...result}));clearTimeout(watchdog);win.destroy();app.exit(0);
}catch(error){console.error(error);clearTimeout(watchdog);win?.destroy();app.exit(1)}});
`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(electronPath, [join(directory, 'main.cjs')], { cwd: desktop, env, windowsHide: true, timeout: 20000 })
    process.stdout.write(result.stdout)
} catch (error) {
    if (error.stdout) process.stderr.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
} finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
