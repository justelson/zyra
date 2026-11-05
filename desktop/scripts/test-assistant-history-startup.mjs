import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-history-startup-'))
const captureArgument = process.argv.find(argument => argument.startsWith('--capture='))?.slice('--capture='.length)
const capturePath = captureArgument ? resolve(captureArgument) : null
const baseline = process.argv.find(argument => argument.startsWith('--baseline='))?.slice('--baseline='.length)
if (baseline && !/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Baseline must be an exact source SHA')
if (capturePath) await mkdir(dirname(capturePath), { recursive: true })
try {
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/assistant-history-startup.tsx')], bundle: true, write: false,
        outfile: join(directory, 'renderer.js'), format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, logLevel: 'silent',
        plugins: baseline ? [{ name: 'exact-source-baseline', setup(builder) {
            builder.onLoad({ filter: /AssistantVirtualTimeline\.tsx$/ }, args => ({
                contents: execFileSync('git', ['show', `${baseline}:desktop/src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx`], { cwd: desktop, encoding: 'utf8', windowsHide: true }),
                loader: 'tsx', resolveDir: dirname(args.path)
            }))
            builder.onLoad({ filter: /assistant-history-streaming-policy\.ts$/ }, args => ({
                contents: execFileSync('git', ['show', `${baseline}:desktop/src/renderer/src/pages/assistant/assistant-history-streaming-policy.ts`], { cwd: desktop, encoding: 'utf8', windowsHide: true }),
                loader: 'ts', resolveDir: dirname(args.path)
            }))
        } }] : []
    })
    await writeFile(join(directory, 'renderer.js'), bundle.outputFiles[0].text)
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><style>
        html,body,#root{height:100%;margin:0}body{font:14px system-ui;background:#101010;color:#eee}
        .h-full{height:100%}.w-full{width:100%}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}
        .pb-4{padding-bottom:16px}.min-h-11{min-height:44px}.overflow-x-hidden{overflow-x:hidden}
        </style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>`)
    await writeFile(join(directory, 'run.cjs'), `
        const {app,BrowserWindow}=require('electron');
        const fs=require('node:fs');let window;
        const capturePath=${JSON.stringify(capturePath)};
        app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timer=setTimeout(()=>{console.error('History startup timed out');app.exit(1)},20000);
        app.whenReady().then(async()=>{
            window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
            await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            const results=await window.webContents.executeJavaScript('window.historyStartupCheck');
            for(const result of results) console.log('PASS: '+result);
            if(capturePath){console.log(JSON.stringify(await window.webContents.executeJavaScript('window.captureHistoryStartup()')));fs.writeFileSync(capturePath,(await window.webContents.capturePage()).toPNG());}
            clearTimeout(timer);window.destroy();app.quit();
        }).catch(async error=>{console.error(error);if(capturePath&&window)fs.writeFileSync(capturePath,(await window.webContents.capturePage()).toPNG());clearTimeout(timer);app.exit(1)});
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const virtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'run.cjs')]
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(virtualDisplay ? 'xvfb-run' : electronPath, virtualDisplay ? ['--auto-servernum', electronPath, ...args] : args,
            { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false })
        child.once('error', reject); child.once('exit', code => done(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-history-startup-')) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
