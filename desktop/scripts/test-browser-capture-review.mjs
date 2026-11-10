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
const directory = await mkdtemp(join(tmpdir(), 'zyra-capture-review-'))
const screenshots = process.argv.includes('--screenshots') ? resolve(desktop, '../docs.local/reviews/browser-captures/screenshots') : null
try {
    const stubs = {
        '@/lib/settings': `import {useState} from 'react';import {DEFAULT_DEVICE_SETTINGS} from ${JSON.stringify(resolve(desktop, 'src/shared/preferences/default-settings.ts'))};window.fixtureSettings={...DEFAULT_DEVICE_SETTINGS,assistantBrowserNewTabBackgroundMode:'off'};export const getThemeAppearance=()=> 'dark';export function useSettings(){const[,render]=useState(0);return {settings:window.fixtureSettings,updateSettings:async patch=>{Object.assign(window.fixtureSettings,patch);render(x=>x+1)}}}`,
        '@/lib/assistant/assistant-store-hooks': 'export const useAssistantStoreActions=()=>window.fixtureActions;',
        routes: 'export const preloadSettingsRoute=()=>{};',
        webview: `import React,{forwardRef,useImperativeHandle} from 'react';export const AssistantBrowserWebview=forwardRef(({tab,onStateChange},ref)=>{useImperativeHandle(ref,()=>({getDeveloperTarget:()=>({tabId:tab.id,guestWebContentsId:12}),getViewportSize:()=>({width:900,height:500}),navigate:async url=>onStateChange(tab.id,{url,title:'Example',status:'ready'}),focus:()=>{}}),[tab.id]);return <div style={{position:'absolute',inset:0,background:'#f8faf9',color:'#203c33',padding:48}}><p className="text-xs uppercase tracking-widest">Example page</p><h1 className="mt-6 text-3xl font-medium">A quieter place to work.</h1><p className="mt-4 max-w-sm text-sm">A synthetic page used to inspect the actual Browser controls and capture preview.</p></div>});`
    }
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/browser-capture-review.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty', '.woff2': 'dataurl' }, define: { 'import.meta.hot': 'undefined', 'import.meta.env.DEV': 'false' }, alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, plugins: [{ name: 'capture-fixture-transports', setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(settings|assistant\/assistant-store-hooks)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onResolve({ filter: /settings-route-loaders$/ }, () => ({ path: 'routes', namespace: 'fixture' }))
        builder.onResolve({ filter: /\/AssistantBrowserWebview$/ }, () => ({ path: 'webview', namespace: 'fixture' }))
        builder.onLoad({ filter: /[\\/]lib[\\/]settings\.tsx$/ }, () => ({ contents: stubs['@/lib/settings'], loader: 'tsx', resolveDir: desktop }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: desktop }))
    } }] })
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    const css = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'))
    css.walkAtRules('import', rule => rule.remove())
    const styles = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/pages/settings/**/*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantBrowser*.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantInspectorDeveloperToast.tsx'), join(desktop, 'scripts/fixtures/browser-capture-review.tsx')] })]).process(css.toString(), { from: undefined })
    const font = await readFile(resolve(desktop, '../extensions/zyra-browser-control/assets/font.woff2'))
    await writeFile(join(directory, 'fixture.css'), await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8') + '\n' + styles.css + `\n@font-face{font-family:CaptureReview;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:200 800}:root{--font-ui:CaptureReview,Segoe UI,sans-serif}`)
    await writeFile(join(directory, 'index.html'), '<!doctype html><html class="dark"><head><link rel="stylesheet" href="fixture.css"><style>body{margin:0;padding:30px;background:var(--color-bg);color:var(--color-text);font-family:var(--font-ui)}#root{max-width:860px;margin:auto}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await writeFile(join(directory, 'main.cjs'), `const{app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const deadline=setTimeout(()=>{console.error('Capture review timed out');app.exit(1)},45000);app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,focusable:false,width:1040,height:750,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});win.webContents.on('paint',()=>{});win.webContents.startPainting();win.webContents.on('console-message',e=>{if(e.level==='error'||/BROWSER_CAPTURE/.test(e.message))console.log(e.message)});await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});const run=code=>win.webContents.executeJavaScript(code);await run('window.captureReview.run().catch(error=>{console.error(error.stack);throw error})');
${screenshots ? `const take=async(name,view)=>{await run('window.captureReview.preview('+JSON.stringify(view)+')');await win.webContents.capturePage();win.webContents.invalidate();await new Promise(r=>setTimeout(r,160));await fs.writeFile(${JSON.stringify(screenshots)}+'/'+name+'.png',(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())};await take('library','library');await take('delete','delete');await take('preferences','preferences');await take('browser','browser');await take('screenshot-preview','toast');win.setContentSize(430,750);await take('library-narrow','library');if(!await run('document.documentElement.scrollWidth<=innerWidth'))throw Error('Capture library must fit narrow viewport');win.setContentSize(1040,750);await take('library-light','light');` : ''}
if(win.isVisible()||win.isFocused())throw Error('Hidden review must not take desktop focus');win.destroy();clearTimeout(deadline);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((accept, reject) => { const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', accept) })
    assert.equal(code, 0, 'actual Browser/capture library/draft interactions pass')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-capture-review-')) throw new Error('Unexpected capture review cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
