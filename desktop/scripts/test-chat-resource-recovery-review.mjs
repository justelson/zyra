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
import tailwindConfig from '../tailwind.config.js'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-resource-recovery-'))
const screenshots = process.argv.includes('--screenshots') ? resolve(desktop, '../docs.local/reviews/chat-resource-recovery/screenshots') : null
try {
    const stubs = {
        '@/lib/settings': `import {useState} from 'react';import {DEFAULT_DEVICE_SETTINGS} from ${JSON.stringify(resolve(desktop, 'src/shared/preferences/default-settings.ts'))};window.fixtureSettings={...DEFAULT_DEVICE_SETTINGS,assistantBrowserNewTabBackgroundMode:'off'};export const getThemeAppearance=()=> 'dark';export function useSettings(){const[,render]=useState(0);return {settings:window.fixtureSettings,updateSettings:async patch=>{Object.assign(window.fixtureSettings,patch);render(x=>x+1)}}}`,
        '@/lib/assistant/assistant-store-hooks': 'export const useAssistantStoreActions=()=>window.fixtureActions;',
        editor: 'export default function Editor(){throw new Error("Image-only fixture must never render the code editor")}',
        routes: 'export const preloadSettingsRoute=()=>{};',
    }
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/chat-resource-recovery-review.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty', '.woff2': 'dataurl', '.ttf': 'dataurl' }, define: { 'import.meta.hot': 'undefined', 'import.meta.env.DEV': 'false' }, alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, plugins: [{ name: 'capture-fixture-transports', setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(settings|assistant\/assistant-store-hooks)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onResolve({ filter: /MonacoPreviewEditor$/ }, () => ({ path: 'editor', namespace: 'fixture' }))
        builder.onResolve({ filter: /settings-route-loaders$/ }, () => ({ path: 'routes', namespace: 'fixture' }))
        builder.onLoad({ filter: /[\\/]lib[\\/]settings\.tsx$/ }, () => ({ contents: stubs['@/lib/settings'], loader: 'tsx', resolveDir: desktop }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: desktop }))
    } }] })
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    const css = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'))
    css.walkAtRules('import', rule => rule.remove())
    const styles = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/components/ui/**/*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/*.tsx'), join(desktop, 'scripts/fixtures/chat-resource-recovery-review.tsx')] })]).process(css.toString(), { from: undefined })
    const font = await readFile(resolve(desktop, '../extensions/zyra-browser-control/assets/font.woff2'))
    await writeFile(join(directory, 'fixture.css'), await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8') + '\n' + styles.css + `\n@font-face{font-family:CaptureReview;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:200 800}:root{--font-ui:CaptureReview,Segoe UI,sans-serif}`)
    await writeFile(join(directory, 'index.html'), '<!doctype html><html class="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;padding:30px;background:var(--color-bg);color:var(--color-text);font-family:var(--font-ui)}#root{margin:auto}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await writeFile(join(directory, 'main.cjs'), `const{app,BrowserWindow,protocol}=require('electron');protocol.registerSchemesAsPrivileged([{scheme:'zyra',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);const fs=require('node:fs/promises');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const deadline=setTimeout(()=>{console.error('Capture review timed out');app.exit(1)},45000);app.whenReady().then(async()=>{protocol.handle('zyra',()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="%232b3442"/><circle cx="480" cy="280" r="160" fill="%239597df"/><text x="480" y="530" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white">Synthetic chat preview</text></svg>'.replaceAll('%23','#'),{headers:{'content-type':'image/svg+xml'}}));const win=new BrowserWindow({show:false,focusable:false,width:1040,height:750,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});win.webContents.on('paint',()=>{});win.webContents.startPainting();win.webContents.on('console-message',e=>{if(e.level==='error'||/^PASS:/.test(e.message))console.log(e.message)});await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});const run=code=>win.webContents.executeJavaScript(code);await run('window.resourceRecoveryReview.run().catch(error=>{console.error(error.stack);throw error})');
${screenshots ? `const take=async(name,view)=>{await run('window.resourceRecoveryReview.preview('+JSON.stringify(view)+')');await win.webContents.capturePage();win.webContents.invalidate();await new Promise(r=>setTimeout(r,160));await fs.writeFile(${JSON.stringify(screenshots)}+'/'+name+'.png',(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())};await take('resources','multi');await take('single','single');await take('retrying','retrying');await take('recovered','recovered');` : ''}
if(win.isVisible()||win.isFocused())throw Error('Hidden review must not take desktop focus');win.destroy();clearTimeout(deadline);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((accept, reject) => { const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', accept) })
    assert.equal(code, 0, 'actual Chat resource and recovery interactions pass')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-resource-recovery-')) throw new Error('Unexpected capture review cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
