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
const directory = await mkdtemp(join(tmpdir(), 'zyra-archive-review-'))
const screenshots = process.argv.includes('--screenshots') ? resolve(desktop, '../docs.local/reviews/archived-chats/screenshots') : null
try {
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures/archived-chats-settings.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser',
        define: { 'import.meta.hot': 'undefined', 'import.meta.env.DEV': 'false' },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        plugins: [{ name: 'archive-fixture-boundaries', setup(builder) {
            builder.onResolve({ filter: /^@\/lib\/assistant\/store$/ }, () => ({ path: 'store', namespace: 'fixture' }))
            builder.onResolve({ filter: /settings-route-loaders$/ }, () => ({ path: 'routes', namespace: 'fixture' }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
                contents: path === 'routes' ? 'export function preloadSettingsRoute(){}'
                    : 'import {useSyncExternalStore} from "react";export function useAssistantStoreSelector(selector){return useSyncExternalStore(window.archiveStore.subscribe,()=>selector(window.archiveStore.getState()))}export const useAssistantStoreActions=()=>window.archiveStore.actions;',
                loader: 'js', resolveDir: desktop
            }))
        } }]
    })
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    const css = postcss.parse(await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8'))
    css.walkAtRules('import', rule => rule.remove())
    const styles = await postcss([tailwind({ ...config, content: [
        join(desktop, 'src/renderer/src/pages/settings/*.{ts,tsx}'),
        join(desktop, 'src/renderer/src/components/ui/FileActionsMenu*.tsx'),
        join(desktop, 'scripts/fixtures/archived-chats-settings.tsx')
    ] })]).process(css.toString(), { from: undefined })
    const font = await readFile(resolve(desktop, '../extensions/zyra-browser-control/assets/font.woff2'))
    await writeFile(join(directory, 'fixture.css'), await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8') + '\n' + styles.css + `\n@font-face{font-family:ArchiveReview;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:200 800}:root{--font-ui:ArchiveReview,Segoe UI,sans-serif}`)
    await writeFile(join(directory, 'index.html'), '<!doctype html><html class="dark"><head><link rel="stylesheet" href="fixture.css"><style>html,body,#root{margin:0;height:100%;background:var(--color-bg);color:var(--color-text);font-family:var(--font-ui)}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
    if (screenshots) await mkdir(screenshots, { recursive: true })
    await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs/promises');
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
const deadline=setTimeout(()=>{console.error('Archive review timed out');app.exit(1)},40000);
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
 const win=new BrowserWindow({show:false,focusable:false,width:1000,height:740,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('paint',()=>{});win.webContents.startPainting();win.webContents.on('console-message',e=>{if(e.level==='error'||/PASS:/.test(e.message))console.log(e.message)});
 await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});const run=code=>win.webContents.executeJavaScript(code);
 await run('window.archiveReview.run().catch(error=>{console.error(error.stack);throw error})');
 const preview=async(view)=>{await run('window.archiveReview.preview('+JSON.stringify(view)+')');await win.webContents.capturePage();win.webContents.invalidate();await new Promise(r=>setTimeout(r,180))};
 ${screenshots ? `const take=async(name,view)=>{await preview(view);await fs.writeFile(${JSON.stringify(screenshots)}+'/'+name+'.png',(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())};await take('archived-chats','default');await take('archived-chats-menu','menu');await take('archived-chats-search','search');await take('archived-chats-empty','empty');await take('archived-chats-light','light');` : ''}
 win.setContentSize(390,740);await preview('default');await run('window.archiveReview.narrow()');
 ${screenshots ? `await fs.writeFile(${JSON.stringify(join(screenshots, 'archived-chats-narrow.png'))},(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());` : ''}
 if(win.isVisible()||win.isFocused())throw Error('Review must not take desktop focus');win.destroy();clearTimeout(deadline);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((accept, reject) => {
        const child = spawn(electron, [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true })
        child.once('error', reject); child.once('exit', accept)
    })
    assert.equal(code, 0, 'actual archive UI and actions pass')
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-archive-review-')) throw new Error('Unexpected archive review cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
