import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import config from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const priorityPins = process.argv.includes('--priority-pins')
const chatMenus = process.argv.includes('--chat-menus')
const screenshotDirectory = process.argv.find(arg => arg.startsWith('--screenshots='))?.slice('--screenshots='.length)
if (screenshotDirectory) await mkdir(resolve(screenshotDirectory), { recursive: true })
const directory = await mkdtemp(join(tmpdir(), 'zyra-sidebar-edge-'))
try {
    const bundle = await build({ entryPoints: [join(desktop, chatMenus ? 'scripts/fixtures/chat-menus.tsx' : priorityPins ? 'scripts/fixtures/sidebar-priority-pins.tsx' : 'scripts/fixtures/sidebar-hover-edge.tsx')],
        bundle: true, write: false, metafile: true, format: 'iife', jsx: 'automatic', platform: 'browser',
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'import.meta.hot': 'undefined' }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent',
        plugins: [{ name: 'edge-unrelated-services', setup(build) {
            build.onResolve({ filter: /\/AssistantSidebarFooter$/ }, () => ({ path: 'footer', namespace: 'fixture' }))
            build.onResolve({ filter: /\/useAssistantRailTitleRegeneration$/ }, () => ({ path: 'titles', namespace: 'fixture' }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'footer'
                ? 'export const AssistantSidebarFooter=()=>null' : 'export const useAssistantRailTitleRegeneration=()=>()=>{}', loader: 'js' }))
        } }]
    })
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const content = Object.keys(bundle.metafile.inputs).filter(path => !path.includes('node_modules')).map(path => resolve(desktop, path))
    const css = await postcss([tailwind({ ...config, content })]).process(source, { from: undefined })
    const html = join(directory, 'index.html')
    await writeFile(html, `<!doctype html><head><style>${css.css}
        :root{--color-text:#eee;--color-text-secondary:#aaa;--color-text-muted:#888;--color-bg:#10151a;--color-card:#171e26;--surface-hover:#252f38;--surface-divider:#39434d;--accent-primary:#ef9c45;--accent-secondary:#b59bdf}
        html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body>`)
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timer=setTimeout(()=>{console.error('Edge fixture timed out');app.exit(1)},30000);
        app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:900,height:700,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        window.webContents.on('console-message',(event)=>{if(event.level==='error')console.error(event.message)});
        await window.loadFile(${JSON.stringify(html)});
        let pumping=true;const pump=(async()=>{while(pumping){const request=await window.webContents.executeJavaScript('window.sidebarPointerRequest && !window.sidebarPointerRequest.done ? {x:window.sidebarPointerRequest.x,y:window.sidebarPointerRequest.y,type:window.sidebarPointerRequest.type} : null');
        if(request){window.webContents.sendInputEvent({type:request.type,x:request.x,y:request.y});await window.webContents.executeJavaScript('window.sidebarPointerRequest.done=true')}
        await new Promise(resolve=>setTimeout(resolve,10))}})();
        const results=await window.webContents.executeJavaScript('window.sidebarEdgeCheck');
        for(const result of results)console.log('PASS: '+result);
        ${chatMenus && screenshotDirectory ? `for(const surface of ['header','sidebar']){await window.webContents.executeJavaScript('window.chatMenuReview('+JSON.stringify(surface)+')');const image=await window.webContents.capturePage();require('fs').writeFileSync(require('path').join(${JSON.stringify(resolve(screenshotDirectory))},surface+'-chat-menu.png'),image.toPNG())}` : ''}
        pumping=false;await pump;clearTimeout(timer);window.destroy();app.quit()}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electronPath, [harness], { cwd: desktop, env, windowsHide: true, shell: false, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => done(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-sidebar-edge-')) throw Error('Unexpected fixture cleanup path')
    await rm(directory, { recursive: true, force: true })
}
