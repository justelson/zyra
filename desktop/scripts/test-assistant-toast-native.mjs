import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

// No live app, native input or real bridge: a hidden disposable renderer runs
// the real toast, portal host and CSS. Its window.open adapter actually resizes
// the child iframe after every native crop acknowledgement.
const started = Date.now()
const stage = message => console.log(`[toast-native +${Date.now() - started}ms] ${message}`)
stage('runner imports ready')
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-toast-native-'))
const evidence = process.argv.includes('--evidence') ? resolve(desktop, '../docs.local/assistant-toast-native') : null
// Optional private exact-source snapshot for replaying the pre-fix failure. The
// default standalone regression never depends on ignored evidence files.
const before = process.argv.includes('--before') ? resolve(desktop, '../docs.local/assistant-toast-native/AssistantToast.before.tsx') : null
const evidenceName = reduced => before ? 'before' : reduced ? 'reduced-motion' : 'native-toast'
const hostReducedMotion = process.argv.includes('--host-reduced-motion')
try {
    if (evidence) await mkdir(evidence, { recursive: true })
    stage('bundling real toast/portal fixture')
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/assistant-toast-native.tsx')], bundle: true, write: false,
        format: 'iife', jsx: 'automatic', platform: 'browser', alias: { '@': join(desktop, 'src/renderer/src') },
        define: { 'import.meta.hot': 'globalThis.__fixtureHot' }, logLevel: 'silent',
        plugins: before ? [{ name: 'exact-before-source', setup(builder) {
            builder.onLoad({ filter: /[\\/]AssistantToast\.tsx$/ }, async args => ({ contents: await readFile(before, 'utf8'), loader: 'tsx', resolveDir: dirname(args.path) }))
        } }] : [] })
    stage('bundle ready; compiling scoped application CSS')
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const css = await postcss([tailwind({ ...tailwindConfig, content: [before || join(desktop, 'src/renderer/src/pages/assistant/AssistantToast.tsx')] })]).process(source, { from: undefined })
    stage('CSS ready; writing disposable harness')
    const html = join(directory, 'index.html')
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}
        :root{font-size:16px;--surface-floating:#111820;--surface-divider:#303844;--status-success:#44cf92;--status-danger:#f57777;--text-primary:235 238 242;--text-secondary:172 181 195;--text-muted:130 140 150;--accent-primary:#f29540}
        html,body,#root{height:100%;margin:0}body{background:#0a0f14;color:#ebeff2}
        </style></head><body><input id="owner-input" aria-label="Owner draft" style="position:absolute;top:20px;left:20px"><button id="owner-action" style="position:absolute;top:60px;left:20px">Underlying action</button><div id="root"></div><script>globalThis.__fixtureHot={dispose:callback=>{globalThis.__disposeNativeOverlayHost=callback}};window.addEventListener('error',event=>{window.__fixtureError=String(event.error?.stack||event.message)})</script><script src="./fixture.js"></script></body></html>`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    for (const reduced of [false, true]) {
        const harness = join(directory, `run-${reduced}.cjs`)
        await writeFile(harness, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.disableHardwareAcceleration();console.log('toast-native Electron process loaded; awaiting app ready');
            app.setPath('userData',${JSON.stringify(join(directory, `profile-${reduced}`))});
            ${reduced || hostReducedMotion ? "app.commandLine.appendSwitch('force-prefers-reduced-motion');" : ''}
            let window,pumping=true;const timeout=setTimeout(()=>{console.error('Native toast check timed out');app.exit(1)},30000);
            app.whenReady().then(async()=>{console.log('toast-native Electron ready; creating hidden offscreen fixture');window=new BrowserWindow({show:false,width:1000,height:800,useContentSize:true,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
                window.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error(message);else if(message.startsWith('toast-native'))console.log(message)});
                window.webContents.on('paint',()=>{});window.webContents.setFrameRate(60);window.webContents.startPainting();
                // Start the renderer before sending CDP commands, then set real
                // media before loading the owner and its same-page child iframe.
                await window.loadURL('about:blank');
                console.log('toast-native renderer ready; setting real motion media');
                window.webContents.debugger.attach('1.3');
                await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:${JSON.stringify(reduced ? 'reduce' : 'no-preference')}}]});
                console.log('toast-native real motion media configured');
                await window.loadFile(${JSON.stringify(html)},{query:{reduced:${JSON.stringify(String(reduced))}}});
                console.log('toast-native HTML loaded; awaiting renderer checks');
                const pump=(async()=>{while(pumping){const request=await window.webContents.executeJavaScript('window.toastNativeRequest && !window.toastNativeRequest.done ? window.toastNativeRequest : null');
                    if(request){if(request.type==='resize')window.setContentSize(request.width,request.height);else throw Error('Unknown fixture request');await window.webContents.executeJavaScript('window.toastNativeRequest.done=true')}
                    await new Promise(resolve=>setTimeout(resolve,10));}})();
                let results,error;try{results=await window.webContents.executeJavaScript('window.toastNativeCheck || Promise.reject(new Error(window.__fixtureError || "Fixture did not initialize"))')}catch(value){error=value}finally{pumping=false;await pump}
                if(error)console.error('toast-native ASSERTION FAILED (before optional capture): '+(error.stack||error));
                ${evidence ? `try{fs.writeFileSync(${JSON.stringify(join(evidence, `${evidenceName(reduced)}.json`))},JSON.stringify({error:error?.stack||String(error||''),results,evidence:await window.webContents.executeJavaScript('window.toastNativeEvidence')},null,2))}catch(value){console.error('toast-native evidence JSON unavailable: '+value)};try{window.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,80));fs.writeFileSync(${JSON.stringify(join(evidence, `${evidenceName(reduced)}.png`))},(await window.webContents.capturePage()).toPNG())}catch(value){console.error('toast-native optional screenshot unavailable: '+value)}` : ''}
                if(error)throw error;for(const result of results)console.log('PASS '+(${reduced}?'reduced motion: ':'motion: ')+result);
                clearTimeout(timeout);window.destroy();app.quit();
            }).catch(error=>{console.error(error);clearTimeout(timeout);if(window&&!window.isDestroyed())window.destroy();app.exit(1)});`)
        stage(`launching bounded hidden Electron (${reduced ? 'reduced motion' : 'motion'})`)
        const virtual = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
        const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
        const code = await new Promise((done, reject) => {
            const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args,
                { cwd: desktop, env, windowsHide: true, shell: false, stdio: 'inherit' })
            child.once('error', reject); child.once('exit', code => done(code ?? 1))
        })
        stage(`Electron exited ${code}`)
        if (code) { process.exitCode = code; break }
    }
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-toast-native-')) throw Error('Unexpected toast fixture cleanup path')
    await rm(directory, { recursive: true, force: true })
}
