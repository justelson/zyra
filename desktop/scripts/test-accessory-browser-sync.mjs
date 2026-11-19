import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rendererSource = join(desktop, 'src/renderer/src')
const sharedSource = join(desktop, 'src/shared')
const fixture = join(desktop, 'scripts/fixtures/accessory-browser-sync.tsx')
const directory = await mkdtemp(join(tmpdir(), 'zyra-accessory-browser-sync-'))
const successMessage = 'Accessory Browser React synchronization: bounded loop, idempotence, local mutations, transfers, and bootstrap race: ok'

const resolveSource = (base, relativePath) => {
    const path = join(base, relativePath)
    for (const extension of ['', '.ts', '.tsx']) {
        if (existsSync(`${path}${extension}`)) return `${path}${extension}`
    }
    return path
}

const fixturePlugin = {
    name: 'accessory-browser-sync-fixture',
    setup(context) {
        context.onResolve({ filter: /AssistantBrowserWorkspace$/ }, () => ({ path: 'assistant-browser-workspace', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /FilePreviewModal$/ }, () => ({ path: 'file-preview-modal', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /file-preview\/useFilePreview$/ }, () => ({ path: 'use-file-preview', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /AssistantInspectorDeveloperToast$/ }, () => ({ path: 'developer-toast', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /^@\/lib\/settings$/ }, () => ({ path: 'tab-settings', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /AccessoryHeaderContext$/ }, () => ({ path: 'header-context', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /IncognitoIcon$/ }, () => ({ path: 'incognito-icon', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /AssistantBrowserPageIcon$/ }, () => ({ path: 'page-icon', namespace: 'sync-fixture' }))
        context.onResolve({ filter: /^@\// }, (args) => ({ path: resolveSource(rendererSource, args.path.slice(2)) }))
        context.onResolve({ filter: /^@shared\// }, (args) => ({ path: resolveSource(sharedSource, args.path.slice('@shared/'.length)) }))
        context.onResolve({ filter: /.*/, namespace: 'sync-fixture' }, (args) => {
            if (args.path === fixture) return { path: fixture }
            return context.resolve(args.path, { kind: args.kind, resolveDir: desktop })
        })
        context.onLoad({ filter: /.*/, namespace: 'sync-fixture' }, (args) => {
            if (args.path === 'assistant-browser-workspace') return { loader: 'tsx', contents: `export { SyntheticAssistantBrowserWorkspace as AssistantBrowserWorkspace } from ${JSON.stringify(fixture)};` }
            if (args.path === 'file-preview-modal') return { loader: 'tsx', contents: 'export default function FilePreviewModal(){ return null }' }
            if (args.path === 'use-file-preview') return { loader: 'tsx', contents: `export function useFilePreview(){ const noop=()=>undefined; return { previewFile:null, previewTabs:[], activePreviewTabId:null, previewContent:'', loadingPreview:false, previewTruncated:false, previewSize:0, previewBytes:0, previewModifiedAt:null, previewMediaItems:[], openPreview:async()=>undefined, openPreviewInNewTab:async()=>undefined, setActivePreviewTab:noop, closePreviewTab:noop, reorderPreviewTabs:noop, closePreview:noop } }` }
            if (args.path === 'developer-toast') return { loader: 'tsx', contents: `export function useAssistantInspectorDeveloperToast(){ return { developerToast:null, showDeveloperToast:()=>undefined, dismissDeveloperToast:()=>undefined } } export function AssistantInspectorDeveloperToast(){ return null }` }
            if (args.path === 'tab-settings') return { loader: 'tsx', resolveDir: desktop, contents: `import { useState } from 'react'; export function useSettings(){ const [vertical, setVertical] = useState(false); window.fixtureSetTabOrientation = setVertical; return { settings: { assistantBrowserVerticalTabs: vertical } } }` }
            if (args.path === 'header-context') return { loader: 'tsx', resolveDir: desktop, contents: `import { createPortal } from 'react-dom'; export function AccessoryHeaderPortal({children}){ return createPortal(children, document.getElementById('fixture-header-slot')) }` }
            return { loader: 'tsx', contents: 'export function IncognitoIcon(){ return null } export function AssistantBrowserPageIcon(){ return null }' }
        })
    }
}

try {
    const bundle = join(directory, 'fixture.js')
    await build({
        entryPoints: [fixture],
        outfile: bundle,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        plugins: [fixturePlugin],
        logLevel: 'silent'
    })
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><head><style>.flex{display:flex}.flex-1{flex:1 1 0%}.min-w-0{min-width:0}.shrink-0{flex-shrink:0}.overflow-x-auto{overflow-x:auto}.sticky{position:sticky}.right-0{right:0}.w-7{width:28px}.h-7{height:28px}.px-1{padding-inline:4px}.gap-1{gap:4px}</style></head><body><script src="./fixture.js"></script></body></html>')
    const main = join(directory, 'main.cjs')
    await writeFile(main, `const { app, BrowserWindow } = require('electron');
const deadline=setTimeout(()=>{console.error('Accessory Browser React synchronization test timed out');app.exit(1)},15000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:900,height:650,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.on('console-message',(_event,_level,message)=>{
   console.log(message);
   if(message.includes(${JSON.stringify(successMessage)})){clearTimeout(deadline);app.exit(0)}
 });
 await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
 setTimeout(async()=>{
   const failure=await win.webContents.executeJavaScript('globalThis.__testFailed || null').catch(error=>String(error));
   if(failure){console.error(failure);clearTimeout(deadline);app.exit(1)}
 },2500);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const virtual = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), main]
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args, {
            cwd: desktop,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false
        })
        let output = ''
        child.stdout.on('data', (chunk) => { output += String(chunk); process.stdout.write(chunk) })
        child.stderr.on('data', (chunk) => { output += String(chunk); process.stderr.write(chunk) })
        child.once('error', reject)
        child.once('exit', (code) => done(code === 0 && output.includes(successMessage) ? 0 : code || 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-accessory-browser-sync-')) {
        throw new Error('Unexpected Accessory Browser synchronization cleanup path')
    }
    await rm(directory, { recursive: true, force: true })
}
