// Disposable hidden Electron regression. No app startup, server, provider or installed build required.
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citations = process.argv.includes('--citations')
const hints = process.argv.includes('--hints')
const directory = await mkdtemp(join(tmpdir(), 'zyra-selection-ui-'))
try {
    const bundle = await build({
        entryPoints: [join(desktop, 'scripts/fixtures', hints ? 'shortcut-hints-ui.tsx' : citations ? 'assistant-citations-ui.tsx' : 'code-selection-toolbar.tsx')],
        outdir: directory, entryNames: 'fixture', bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'import.meta.env.DEV': 'false' },
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        loader: { '.ttf': 'dataurl', '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
        plugins: [{ name: 'isolated-assistant-store', setup(builder) {
            // Only owning store/context adapters are substituted; UI and geometry are actual source.
            if (hints) {
                builder.onResolve({ filter: /(?:lib[\\/]settings|lib[\\/]commandPalette)$/ }, args => args.importer.endsWith('ShortcutHints.tsx') ? { path: args.path.includes('commandPalette') ? 'palette' : 'settings', namespace: 'fixture-context' } : undefined)
                builder.onLoad({ filter: /.*/, namespace: 'fixture-context' }, args => ({ contents: args.path === 'palette' ? 'export const useCommandPalette=()=>({isOpen:window.__fixturePaletteOpen})' : 'export const useSettings=()=>({settings:window.__fixtureSettings})', loader: 'js' }))
            }
            builder.onResolve({ filter: /assistant-store-core$/ }, () => ({ path: 'store', namespace: 'fixture-store' }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture-store' }, () => ({ contents: 'export const assistantStore={getState:()=>({snapshot:window.__fixtureSnapshot})}', loader: 'js' }))
        } }], logLevel: 'silent'
    })
    for (const file of bundle.outputFiles) await writeFile(file.path, file.contents)
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const css = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/src/components/ui/{SelectionActionBar,file-preview/PreviewCodeSelection}.tsx'), join(desktop, 'src/renderer/src/pages/assistant/AssistantCitation*.tsx'), join(desktop, 'scripts/fixtures/{code-selection-toolbar,assistant-citations-ui,shortcut-hints-ui}.tsx'), join(desktop, 'src/renderer/src/components/ui/Shortcut*.tsx')] })]).process(source, { from: undefined })
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${bundle.outputFiles.some(file => file.path.endsWith('.css')) ? '<link rel="stylesheet" href="fixture.css">' : ''}<style>${css.css}
        :root{--surface-floating:#202630;--surface-hover:#343d49;--color-text:#eee;--text-primary:238 238 238;--text-secondary:180 190 200;--text-muted:140 150 160;--bg-primary:10 15 20;--accent-primary:#f29540}
        html,body,#root{margin:0;width:100%;height:100%}body{background:#0a0f14;color:#eee}
        </style></head><body><div id="root"></div><script>window.addEventListener('error',e=>window.__fixtureError=String(e.error?.stack||e.message))</script><script src="fixture.js"></script></body></html>`)
    await writeFile(join(directory, 'run.cjs'), `const {app,BrowserWindow}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timeout=setTimeout(()=>{console.error('Selection UI check timed out');app.exit(1)},45000);
        app.whenReady().then(async()=>{
            const win=new BrowserWindow({show:false,width:1000,height:720,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
            win.webContents.on('console-message',(event,level,message)=>{if(level>=2)console.error(message)});
            await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            let pumping=true;
            const pump=(async()=>{while(pumping){
                const request=await win.webContents.executeJavaScript('window.__pointer&&!window.__pointer.done?{x:window.__pointer.x,y:window.__pointer.y}:null');
                if(request){const point={x:Math.round(request.x),y:Math.round(request.y)};
                    win.webContents.sendInputEvent({type:'mouseMove',...point});
                    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
                    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
                    await win.webContents.executeJavaScript('window.__pointer.done=true');}
                await new Promise(resolve=>setTimeout(resolve,16));
            }})();
            let results;try{results=await win.webContents.executeJavaScript('window.__selectionUICheck||Promise.reject(new Error(window.__fixtureError||"Fixture failed to initialize"))')}finally{pumping=false;await pump}
            for(const result of results)console.log('PASS: '+result);
            clearTimeout(timeout);win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(electronPath, [join(directory, 'run.cjs')], { cwd: desktop, env, windowsHide: true, shell: false, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-selection-ui-')) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
