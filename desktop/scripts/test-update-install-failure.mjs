import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
const desktop = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-install-feedback-'))
try {
    await build({ entryPoints: [join(desktop, 'scripts/fixtures/app-update-preview.tsx')], outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false', 'import.meta.hot': 'undefined', '__ZYRA_BUILD_METADATA__': 'null', '__ZYRA_DESKTOP_VERSION__': '"0.7.1"' },
        loader: { '.ogg': 'dataurl', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.ico': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'silent' })
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="fixture.js"></script></body></html>')
    const check = async () => {
        const wait = async (predicate, message) => { const end = Date.now() + 3000; while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); if (!predicate()) throw Error(message) }
        await wait(() => window.__updateFixture?.actions(), 'Real update provider mounts')
        const fixture = window.__updateFixture
        fixture.settleInitial()
        fixture.emit({ enabled: false, externalInstaller: { id: 'native-fixture', version: '0.7.2', agentServerUpdate: true } })
        await wait(() => document.querySelector('dialog')?.open && fixture.actions().installPlan?.state === 'ready', 'Native request opens the actual confirmation with reviewed idle state')
        fixture.failInstall()
        await fixture.actions().confirmInstallUpdate(false)
        await wait(() => fixture.actions().pendingAction === null, 'Failed install releases pending action')
        await wait(() => fixture.actions().isModalOpen, 'Failed native request must retain a visible error surface')
        await wait(() => document.body.textContent.includes('Synthetic installer failure'), 'Actual update modal renders the failure')
        if (fixture.actions().installConfirmationVersion !== null) throw Error('Expired native confirmation remains actionable')
        if (fixture.calls.filter(call => call === 'install').length !== 1) throw Error('Failure implicitly retried installation')
        fixture.actions().closeModal()
        fixture.emit({ enabled: true, status: 'downloaded', downloadedVersion: '0.7.2', message: null, errorContext: null })
        await fixture.actions().installUpdate()
        await wait(() => document.querySelector('dialog')?.open && fixture.actions().installPlan?.state === 'ready', 'Automatic update opens a reviewed confirmation')
        fixture.failInstall()
        await fixture.actions().confirmInstallUpdate(false)
        await wait(() => document.querySelector('dialog')?.open && document.querySelector('dialog [role="alert"]')?.textContent.includes('Update did not start.'), 'Live confirmation retains its actionable error')
        document.querySelector('dialog [aria-label="Update error"]').click()
        await wait(() => document.querySelector('dialog [role="tooltip"]')?.textContent.includes('Synthetic installer failure'), 'Error details retain the exact preparation failure')
        if (fixture.actions().isModalOpen) throw Error('Failure opened a second status modal over the live confirmation')
        if (fixture.actions().pendingAction !== null || fixture.calls.filter(call => call === 'install').length !== 2) throw Error('Failure retained busy state or implicitly retried')
        console.log('PASS actual update provider/confirmation/modal: native and automatic failures stay visible on one surface without implicit retries')
    }
    await writeFile(join(directory, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const timer=setTimeout(()=>app.exit(1),15000);app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});const result=await win.webContents.executeJavaScript(${JSON.stringify(`(${check})()`)});console.log('PASS hidden install failure feedback');clearTimeout(timer);win.destroy();app.exit(0)}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const virtualDisplay = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), join(directory, 'main.cjs')]
    process.exitCode = await new Promise((done, reject) => { const child = spawn(virtualDisplay ? 'xvfb-run' : electronPath, virtualDisplay ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', code => done(code ?? 1)) })
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
