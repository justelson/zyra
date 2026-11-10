import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { visualizationFrameDocument } from './maint/visualization-frame-document.mjs'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(os.tmpdir(), 'zyra-visual-scroll-'))
const report = process.argv.find(argument => argument.endsWith('.json'))
try {
    const bundle = await build({ entryPoints: [join(desktop, 'scripts/fixtures/visualization-scroll.tsx')], bundle: true, write: false, outfile: join(directory, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' }, alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') } })
    const shell = await readFile(join(desktop, 'src/renderer/index.html'), 'utf8')
    const policy = shell.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    if (!policy) throw new Error('Real app CSP must be present')
    await writeFile(join(directory, 'fixture.js'), bundle.outputFiles[0].text)
    const playerCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''
    const includePlayerCss = process.env.ZYRA_QA_PLAYER_CSS === '1'
    await writeFile(join(directory, 'visualization-frame.html'), visualizationFrameDocument())
    const appCss = await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')
    const scrollbarCss = (appCss.match(/\.assistant-(?:chat|timeline)-scrollbar[^{}]*\{[^{}]*\}/g) || []).join('\n')
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head>${policy}<style>${scrollbarCss}
    ${includePlayerCss ? playerCss : ''}
    html,body,#root{height:100%;margin:0}:root{--color-bg:#101318;--color-card:#181c22;--color-text:#eef1f6;--color-text-muted:#a8b0bd;--accent-primary:#568cff;--surface-divider:#343b46}
    body{font:14px system-ui;background:var(--color-bg);color:var(--color-text)}.h-full{height:100%}.w-full{width:100%}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.pb-4{padding-bottom:16px}.my-3{margin:12px 0}.mb-2{margin-bottom:8px}.flex{display:flex}.items-center{align-items:center}iframe{display:block;width:100%;border:0}figure{margin:12px 0}p{margin:8px 0}header{height:26px}.markdown-image-frame,.markdown-image-open,.markdown-video-frame{display:block}.markdown-image-open{position:relative;width:fit-content;max-width:100%}.markdown-image-open-label,.markdown-image-loading{display:none}img{height:auto;max-width:100%}video{display:block;max-width:100%;max-height:560px}.min-w-0{min-width:0}.gap-1{gap:4px}.text-sparkle-text-muted{color:var(--color-text-muted)}
    </style></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>`)
    const metadata = JSON.parse(await readFile(join(desktop, 'node_modules/@legendapp/list/package.json'), 'utf8'))
    await writeFile(join(directory, 'run.cjs'), `
        const {app,BrowserWindow}=require('electron');
        const fs=require('node:fs');
        app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
        const timer=setTimeout(()=>{console.error('Visualization scroll fixture timed out');app.exit(1)},60000);
        app.whenReady().then(async()=>{
            const window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
            window.webContents.on('console-message',event=>{if(event.message.startsWith('[visual-scroll]'))console.log(event.message)});
            await window.loadFile(${JSON.stringify(join(directory, 'index.html'))});
            // CDP dispatch reaches an offscreen Chromium surface without OS focus.
            // These are trusted compositor inputs, not synthetic DOM wheel events.
            window.webContents.debugger.attach('1.3');
            await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
            let draining=false;
            const inputTimer=setInterval(async()=>{
                if(draining||window.isDestroyed())return;
                draining=true;
                try{
                    const inputs=await window.webContents.executeJavaScript('(window.visualizationScrollInputs||[]).splice(0)');
                    for(const input of inputs){
                        if(input.type==='resize')window.setSize(input.width,input.height);
                        else if(input.type==='thumb-reverse'){
                            const thumbTrace={before:await window.webContents.executeJavaScript('document.querySelector(".assistant-timeline-scrollbar").scrollTop')};
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:input.x,y:input.y});
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:input.x,y:input.y,button:'left',buttons:1,clickCount:1});
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:input.x,y:input.upY,button:'left',buttons:1});
                            await new Promise(resolve=>setTimeout(resolve,150));
                            thumbTrace.afterUp=await window.webContents.executeJavaScript('document.querySelector(".assistant-timeline-scrollbar").scrollTop');
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:input.x,y:input.downY,button:'left',buttons:1});
                            await new Promise(resolve=>setTimeout(resolve,150));
                            thumbTrace.afterDown=await window.webContents.executeJavaScript('document.querySelector(".assistant-timeline-scrollbar").scrollTop');
                            await window.webContents.executeJavaScript('window.visualizationThumbTrace='+JSON.stringify(thumbTrace));
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:input.x,y:input.downY,button:'left',buttons:0,clickCount:1});
                        } else if(input.type==='key'){
                            const parameters={key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32,modifiers:input.shift?8:0};
                            await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',...parameters,text:' ',unmodifiedText:' '});
                            await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',...parameters});
                        } else if(input.type==='scrollbar'){
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:input.x,y:input.y});
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:input.x,y:input.y,button:'left',buttons:1,clickCount:1});
                            await new Promise(resolve=>setTimeout(resolve,input.holdMs));
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:input.x,y:input.y,button:'left',buttons:0,clickCount:1});
                        } else {
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:input.x,y:input.y});
                            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:input.x,y:input.y,deltaX:0,deltaY:input.deltaY});
                        }
                        await new Promise(resolve=>setTimeout(resolve,100));
                        await window.webContents.executeJavaScript('window.visualizationScrollInputDone('+input.id+')');
                    }
                }catch(error){console.error(error)}finally{draining=false}
            },25);
            let result;
            try{result=await window.webContents.executeJavaScript('window.visualizationScrollCheck')}finally{clearInterval(inputTimer);window.webContents.debugger.detach()};
            result.environment={electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,legendList:${JSON.stringify(metadata.version)},productionReact:true,hiddenWindow:true,offscreen:true,input:'trusted CDP Input.dispatchMouseEvent/Input.dispatchKeyEvent',os:${JSON.stringify(os.release())},cpu:${JSON.stringify(os.cpus()[0]?.model)},logicalCpus:${os.cpus().length},totalMemoryGiB:${Math.round(os.totalmem() / 2 ** 30)}};
            fs.writeFileSync(${JSON.stringify(join(directory, 'report.json'))},JSON.stringify(result,null,2));
            console.log(JSON.stringify(result,null,2));
            clearTimeout(timer);window.destroy();app.quit();
        }).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1)});
    `)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((done, reject) => {
        const child = spawn(electronPath, [join(directory, 'run.cjs')], { cwd: desktop, env, stdio: 'inherit', windowsHide: true })
        child.once('error', reject)
        child.once('exit', value => done(value ?? 1))
    })
    if (code !== 0) throw new Error(`Visualization scroll fixture exited ${code}`)
    if (process.argv.includes('--verify')) {
        const result = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))
        if (result.supportsAtomicMove && (result.updates.frameReloads > 0 || result.samples.some(sample => sample.frameReloads > 0))) throw new Error('Unchanged previews reloaded during chat updates or scrolling')
        if (result.cache.entries > result.cache.maxEntries || result.cache.bytes > result.cache.maxBytes) throw new Error('Visualization cache exceeded its memory limit')
        if (result.samples[2].sanitizations > 0) throw new Error('Warm scrolling must reuse sanitized documents')
        if (!result.mixedMedia?.trustedWheels || !result.mixedMedia.iframeWheel || !result.mixedMedia.explicitLatest || !result.mixedMedia.scrollbarTrack || !result.mixedMedia.thumbReversal || !result.mixedMedia.keyboardPaging || !result.mixedMedia.keyboardControls || result.mixedMedia.trustedScrollbarPresses < 2 || result.mixedMedia.stability.some(check => check.driftPx > 2)) throw new Error('Mixed-media reading/follow checks did not pass')
        console.log('PASS: unchanged-frame reuse, bounded cache, trusted wheel input and stable mixed-media prose within 2px')
    }
    if (report) { await mkdir(dirname(resolve(report)), { recursive: true }); await writeFile(resolve(report), await readFile(join(directory, 'report.json'))) }
} finally { await rm(directory, { recursive: true, force: true }) }
