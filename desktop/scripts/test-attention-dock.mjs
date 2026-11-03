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
const directory = await mkdtemp(join(tmpdir(), 'zyra-attention-dock-'))
try {
    const settingsPath = join(desktop, 'src/renderer/src/lib/settings.tsx')
    await writeFile(join(directory, 'settings.ts'), `export * from ${JSON.stringify(settingsPath)};import {loadSettings} from ${JSON.stringify(settingsPath)};const settings={...loadSettings({}),assistantTranscriptionEnabled:true,assistantTranscriptionEngine:'codex'};export function useSettings(){return {settings,updateSettings:async()=>{}}}`)
    await build({
        entryPoints: [join(desktop, 'scripts/fixtures/attention-dock.tsx')], outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
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
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const css = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/pages/assistant/**/*.{ts,tsx}'), join(desktop, 'src/renderer/src/components/ui/**/*.{ts,tsx}')] })]).process(source, { from: undefined })
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}
:root{--color-card:#111820;--color-text:#ebeef2;--color-text-secondary:#acb5c3;--color-text-muted:#828c96;--text-primary:235 238 242;--text-secondary:172 181 195;--text-muted:130 140 150;--surface-floating:#18212b;--surface-divider:#303844;--surface-hover:#202833;--surface-chrome:#111820;--accent-primary:#f29540;--accent-contrast:#101010;--status-warning:#f29540}html,body,#root{height:100%;margin:0}body{background:#0a0f14;color:#ebeff2}</style></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>`)
    const main = join(directory, 'main.cjs')
    const evidenceDirectory = process.env.ZYRA_ATTENTION_EVIDENCE ? resolve(process.env.ZYRA_ATTENTION_EVIDENCE) : null
    const captureEvidence = evidenceDirectory ? `const fs=require('node:fs');const path=require('node:path');fs.mkdirSync(${JSON.stringify(evidenceDirectory)},{recursive:true});for(const width of [1000,390]){window.setContentSize(width,850);for(const scenario of ['permission','answer-later','answer']){await window.webContents.executeJavaScript('window.attentionDockPreview('+JSON.stringify(scenario)+')');fs.writeFileSync(path.join(${JSON.stringify(evidenceDirectory)},scenario+'-'+width+'.png'),(await window.webContents.capturePage()).toPNG())}}console.log('Dock screenshots saved');` : ''
    await writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});const timeout=setTimeout(()=>{console.error('Attention dock deadline');app.exit(1)},${evidenceDirectory ? 45000 : 30000});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});window.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error(message)});await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});window.webContents.setFrameRate(30);window.webContents.startPainting();const paints=setInterval(()=>window.webContents.invalidate(),30);const results=await window.webContents.executeJavaScript('window.attentionDockCheck ? window.attentionDockCheck() : Promise.reject(new Error("Fixture did not initialize"))');for(const result of results)console.log('PASS: '+result);console.log('Attention dock interactions: passed');${captureEvidence}clearInterval(paints);clearTimeout(timeout);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electronPath, [main], { cwd: desktop, env, stdio: 'inherit', windowsHide: true })
        const watchdog = setTimeout(() => child.kill(), evidenceDirectory ? 55000 : 40000)
        child.once('error', error => { clearTimeout(watchdog); reject(error) })
        child.once('exit', code => { clearTimeout(watchdog); done(code ?? 1) })
    })
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }) }
