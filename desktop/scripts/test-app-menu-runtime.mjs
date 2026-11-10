import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import config from '../tailwind.config.js'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-menu-review-'))
const screenshots = process.argv.includes('--screenshots') ? resolve(desktop, '../docs.local/reviews/app-menu-runtime/screenshots') : null
try {
    // Keep the real TitleBar, menu, router and runtime subscription/presentation.
    // Other application contexts and native window services are isolated here.
    const stubs = {
        '@/lib/keybindings': `export const isShortcutRecording=()=>false,isProtectedShortcutTarget=()=>false,keyboardInput=()=>({}),shortcutPlatform=()=> 'windows';export const useShortcutLabel=()=>id=>({'app.newChat':'Ctrl+N','app.search':'Ctrl+K','app.settings':'Ctrl+,'}[id]||'');`,
        '@/lib/assistant/store': 'export const useAssistantStoreActions=()=>({}),useAssistantStoreSelector=selector=>selector({snapshot:{sessions:[],selectedSessionId:null}});',
        '@/lib/settings': 'export const useSettings=()=>({settings:{sidebarCollapsed:false}});',
        '@/lib/useWindowChrome': 'export const useWindowChrome=()=>({runtime:{platform:"win32"},policy:{customWindowControls:true},isMaximized:false});',
        '@/lib/commandPalette': 'export const useCommandPalette=()=>({open:()=>{}});',
        '@/components/ui/LoadingState': 'export const useLoadingScreenActive=()=>false;',
        '@/pages/assistant/AssistantControlStatus': 'export const AssistantControlStatus=()=>null;'
    }
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/app-menu-runtime.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'import.meta.hot': 'undefined', 'import.meta.env.DEV': 'false' },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        plugins: [{ name: 'menu-fixture-contexts', setup(builder) {
            builder.onResolve({ filter: /^@\// }, input => input.path in stubs ? { path: input.path, namespace: 'fixture' } : undefined)
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, input => ({ contents: stubs[input.path], loader: 'js', resolveDir: desktop }))
        } }]
    })
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    const css = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'))
    css.walkAtRules('import', rule => rule.remove())
    const styles = await postcss([tailwind({ ...config, content: [join(desktop, 'src/renderer/src/components/layout/*.{ts,tsx}'), join(desktop, 'scripts/fixtures/app-menu-runtime.tsx')] })]).process(css.toString(), { from: undefined })
    const font = await readFile(resolve(desktop, '../extensions/zyra-browser-control/assets/font.woff2'))
    await writeFile(join(directory, 'fixture.css'), await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8') + '\n' + styles.css + `\n@font-face{font-family:MenuReview;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:200 800}:root{--font-ui:MenuReview,Segoe UI,sans-serif}`)
    await writeFile(join(directory, 'index.html'), '<!doctype html><html class="dark"><head><link rel="stylesheet" href="fixture.css"><style>html,body,#root{margin:0;height:100%;background:var(--color-bg);color:var(--color-text);font-family:var(--font-ui)}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs/promises');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const timer=setTimeout(()=>{console.error('Menu review timed out');app.exit(1)},35000);app.whenReady().then(async()=>{
session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
const win=new BrowserWindow({show:false,focusable:false,width:560,height:400,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.on('paint',()=>{});win.webContents.startPainting();win.webContents.on('console-message',event=>{if(event.level==='error'||/PASS:/.test(event.message))console.log(event.message)});
await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});const run=code=>win.webContents.executeJavaScript(code);await run('window.appMenuReview.run().catch(error=>{console.error(error.stack);throw error})');
${screenshots ? `for(const view of ['connected','update','connecting','disconnected','light']){await run('window.appMenuReview.preview('+JSON.stringify(view)+')');await run('window.appMenuReview.bounds()');await win.webContents.capturePage();win.webContents.invalidate();await new Promise(r=>setTimeout(r,160));await fs.writeFile(${JSON.stringify(screenshots)}+'/'+view+'.png',(await win.webContents.capturePage({x:0,y:0,width:300,height:320},{stayHidden:true,stayAwake:true})).toPNG())}` : `await run('window.appMenuReview.preview("update")');await run('window.appMenuReview.bounds()');`}
if(win.isVisible()||win.isFocused())throw Error('Preview must not take desktop focus');win.destroy();clearTimeout(timer);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((accept, reject) => { const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', accept) })
    assert.equal(code, 0, 'real app menu preview and runtime actions pass')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-menu-review-')) throw new Error('Unexpected menu review cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
