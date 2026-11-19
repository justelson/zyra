import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-wallpaper-review-'))
try {
    const settingsPath = join(desktop, 'src/renderer/src/lib/settings.tsx')
    await writeFile(join(directory, 'settings.ts'), `export * from ${JSON.stringify(settingsPath)};import {loadSettings} from ${JSON.stringify(settingsPath)};const defaults=loadSettings({});export function useSettings(){return {settings:{...defaults,...window.reviewSettings},updateSettings:async patch=>Object.assign(window.reviewSettings,patch)}}`)
    await build({
        entryPoints: [join(desktop, 'scripts/fixtures/wallpaper-review.tsx')], outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
        alias: { '@/lib/settings': join(directory, 'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false', 'import.meta.hot': 'undefined', 'import.meta.url': JSON.stringify(pathToFileURL(join(directory, 'fixture.js')).href), '__ZYRA_BUILD_METADATA__': 'null' },
        loader: { '.ico': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty', '.ttf': 'dataurl', '.woff2': 'dataurl' },
        plugins: [{ name: 'unused-workspace-editors', setup(builder) {
            // The real Pane, composers/controllers, question tray, voice hooks,
            // permission menu and draft stores run. No attachment editor opens.
            builder.onResolve({ filter: /AssistantAttachmentPreviewModal$/ }, () => ({ path: 'attachment-preview', namespace: 'attention-unused' }))
            builder.onResolve({ filter: /DeveloperWorkspaceMenu$/ }, () => ({ path: 'workspace-menu', namespace: 'attention-unused' }))
            builder.onLoad({ filter: /.*/, namespace: 'attention-unused' }, args => ({ contents: args.path === 'workspace-menu' ? 'export function DeveloperWorkspaceMenu(){return null}' : 'export default function AttachmentPreview(){return null}', loader: 'js' }))
            builder.onResolve({ filter: /monaco\/runtime$/ }, () => ({ path: 'runtime', namespace: 'attention-editor' }))
            builder.onLoad({ filter: /.*/, namespace: 'attention-editor' }, () => ({ contents: 'export const monaco={};export function ensureMonacoRuntime(){throw new Error("Unexpected editor in attention fixture")}', loader: 'js' }))
            builder.onResolve({ filter: /^@pierre\/diffs\/worker\/worker\.js\?worker$/ }, () => ({ path: 'diff', namespace: 'attention-worker' }))
            builder.onLoad({ filter: /.*/, namespace: 'attention-worker' }, () => ({ contents: 'export default class UnusedWorker{constructor(){throw new Error("Unexpected diff worker")}}', loader: 'js' }))
        } }],
    })
    const source=(await readFile(join(desktop,'src/renderer/src/index.css'),'utf8')).replace(/^@import[^\n]+\n/gm,'')
    const tokens=await readFile(join(desktop,'src/renderer/src/styles/theme-tokens.css'),'utf8')
    const css=await postcss([tailwind({...tailwindConfig,content:[join(desktop,'src/renderer/src/**/*.{ts,tsx}'),join(desktop,'scripts/fixtures/wallpaper-review.tsx')]})]).process(source,{from:undefined})
    await writeFile(join(directory,'index.html'),`<!doctype html><meta charset="utf-8"><style>${tokens}\n${css.css}\nbody{font-family:Segoe UI,sans-serif;color:var(--color-text);background:var(--color-bg)}</style><div id="root"></div><script src="./fixture.js"></script>`)
    await build({entryPoints:[join(desktop,'src/main/assistant/wallpaper-import.ts')],bundle:true,platform:'node',format:'cjs',outfile:join(directory,'reader.cjs')})
    const main=join(directory,'main.cjs')
    await writeFile(main,`const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));const timeout=setTimeout(()=>app.exit(1),45000);app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1040,height:820,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',e=>{if(e.level==='error')console.error(e.message)});await win.loadFile(path.join(__dirname,'index.html'));const payload=await require('./reader.cjs').readDownloadsWallpaper(app.getPath('downloads'),process.env.ZYRA_QA_WALLPAPER);const asset=await win.webContents.executeJavaScript('window.reviewImport('+JSON.stringify(payload)+')');if(!/^[a-f0-9]{64}$/.test(asset))throw Error('Invalid receipt');const out=process.env.ZYRA_QA_OUTPUT;fs.mkdirSync(out,{recursive:true});for(const width of [1040,420]){win.setContentSize(width,820);for(const view of ['settings','inspector','chat']){await win.webContents.executeJavaScript('window.reviewView('+JSON.stringify(view)+')');await new Promise(r=>setTimeout(r,180));const image=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(out,view+'-'+width+'.png'),image.toPNG());console.log(view,width,image.getSize())}}clearTimeout(timeout);app.exit(0)}).catch(e=>{console.error(e.message);app.exit(1)})`)
    if(!process.env.ZYRA_QA_WALLPAPER || !process.env.ZYRA_QA_OUTPUT) throw Error('Provide a local Downloads image filename and a private output directory.')
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    process.exitCode=await new Promise((done,reject)=>{const child=spawn(electronPath,[main],{env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',c=>done(c??1))})
} finally { await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}) }
