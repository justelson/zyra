import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../tailwind.config.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronPath from 'electron'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-sidebar-continuity-'))
try {
    await writeFile(join(directory, 'settings.ts'), `export {getAppearanceCodeFontStack,getThemeAppearance} from ${JSON.stringify(join(desktop, 'src/renderer/src/lib/settings.tsx'))};const settings={assistantAllowCollapseWhileWorking:false,assistantShowActionStats:false};export function useSettings(){return {settings}}`)
    const fixture = process.argv.includes('--settlement-navigation') ? 'sidebar-settlement-navigation.tsx' : 'assistant-sidebar-continuity.tsx'
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures', fixture)],
        bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', define: { 'import.meta.env.DEV': 'false', 'import.meta.url': JSON.stringify(pathToFileURL(join(directory, 'fixture.js')).href) },
        alias: { '@/lib/settings': join(directory, 'settings.ts'), '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty', '.ttf': 'dataurl' },
        plugins: [{ name: 'unused-attachment-preview', setup(builder) {
            // This fixture opens no attachment editors. Keep Vite-only Monaco
            // workers out while exercising the actual message/footer renderer.
            builder.onResolve({ filter: /AssistantAttachmentPreviewModal$/ }, () => ({ path: 'attachment-preview', namespace: 'test-unused' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-unused' }, () => ({ contents: 'export default function UnusedPreview(){return null}', loader: 'js' }))
            builder.onResolve({ filter: /monaco\/runtime$/ }, () => ({ path: 'editor-runtime', namespace: 'test-editor-runtime' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-editor-runtime' }, () => ({ contents: 'export const monaco = {}; export function ensureMonacoRuntime(){throw new Error("Unexpected editor in agent message fixture")}', loader: 'js' }))
        } }], logLevel: 'silent' })
    // Compile the actual app styles, but keep test fonts/assets entirely local.
    const source = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import[^\n]+\n/gm, '')
    const css = await postcss([tailwind({ ...tailwindConfig, content: [join(desktop, 'src/renderer/**/*.{ts,tsx}'), join(desktop, 'scripts/fixtures/*.tsx')] })]).process(source, { from: undefined })
    const html = join(directory, 'index.html')
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css.css}
        :root{--color-text:#ebeef2;--color-text-secondary:#acb5c3;--color-text-muted:#828c96;--color-bg:#0a0f14;--text-primary:235 238 242;--text-secondary:172 181 195;--text-muted:130 140 150;--bg-primary:10 15 20;--surface-hover:#202833;--surface-active:#2b3a4b;--surface-divider:#303844;--accent-primary:#f29540;--accent-primary-rgb:242 149 64;--accent-secondary:#ab87ff;--status-success:#44cf92}
        :root{--color-secondary:#dd9448;--agent-presence-accent:#ab87ff}
        html,body,#root{height:100%;margin:0}body{background:#0a0f14;color:#ebeff2}
        </style></head><body><div id="root"></div><script>window.addEventListener('error',event=>{window.__fixtureError=String(event.error?.stack||event.message);console.error(window.__fixtureError)})</script><script src="./fixture.js"></script></body></html>`)
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `const {app,BrowserWindow}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timeout=setTimeout(()=>{console.error('Sidebar check timed out');app.exit(1)},30000);
        app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        window.webContents.on('console-message',(event,level,message)=>{if(level>=2)console.error(message)});
        await window.loadFile(${JSON.stringify(html)},${JSON.stringify(process.argv.includes('--settlement-navigation') ? { query: { settlementNavigation: '1' } } : process.argv.includes('--thread-messages') ? { query: { threadMessages: '1' } } : process.argv.includes('--unread-completion') ? { query: { unreadCompletion: '1' } } : process.argv.includes('--agent-colors') ? { query: { agentColors: '1' } } : process.argv.includes('--row-hover-actions') ? { query: { rowHoverActions: '1' } } : process.argv.includes('--voice-recorder-input') ? { query: { voiceRecorderInput: '1' } } : process.argv.includes('--conversation-markers') ? { query: { conversationMarkers: '1' } } : {})});
        let debuggerDocument=null;
        let pumping=true;const pointerPump=(async()=>{while(pumping){
            const request=await window.webContents.executeJavaScript('window.sidebarPointerRequest && !window.sidebarPointerRequest.done ? {x:window.sidebarPointerRequest.x,y:window.sidebarPointerRequest.y,click:window.sidebarPointerRequest.click,focusSelector:window.sidebarPointerRequest.focusSelector,pseudoClass:window.sidebarPointerRequest.pseudoClass,enabled:window.sidebarPointerRequest.enabled} : null');
            if(request){
                if(request.focusSelector){if(!window.webContents.debugger.isAttached()){window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('DOM.enable');await window.webContents.debugger.sendCommand('CSS.enable')}
                    // Reuse frontend node IDs so clearing an emulated keyboard
                    // state releases the same node that was forced earlier.
                    debuggerDocument ||= await window.webContents.debugger.sendCommand('DOM.getDocument');
                    const node=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:debuggerDocument.root.nodeId,selector:request.focusSelector});
                    await window.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:node.nodeId,forcedPseudoClasses:request.enabled?[request.pseudoClass||'focus-visible']:[]})}
                else {const point={x:Math.round(request.x),y:Math.round(request.y)};window.webContents.sendInputEvent({type:'mouseMove',...point});
                    if(request.click){window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})}}
                await window.webContents.executeJavaScript('window.sidebarPointerRequest.done=true')}
            await new Promise(resolve=>setTimeout(resolve,16));
        }})();
        let results;try{results=await window.webContents.executeJavaScript('window.sidebarContinuityCheck || Promise.reject(new Error(window.__fixtureError || "Fixture did not initialize"))')}finally{pumping=false;await pointerPump}

        for(const result of results)console.log('PASS: '+result);clearTimeout(timeout);app.quit()}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(electronPath, [harness], { cwd: desktop, env, windowsHide: true, shell: false, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1))
    })
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-sidebar-continuity-')) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
}
