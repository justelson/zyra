import assert from 'node:assert/strict'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindConfig from '../tailwind.config.js'

// Real React, background/contrast hooks and application CSS; only the settings
// boundary and callback data are synthetic. No preload, user profile or network.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'zyra-new-tab-layout-'))
const artifacts = process.env.ZYRA_NEW_TAB_LAYOUT_ARTIFACTS
const candidate = process.env.ZYRA_NEW_TAB_LAYOUT_SOURCE
const inspect = process.argv.includes('--inspect')
const renderer = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AssistantBrowserNewTab} from './src/renderer/src/pages/assistant/AssistantBrowserNewTab';
const root=createRoot(document.getElementById('root'));
window.calls={navigate:[],newTab:[],history:0,refresh:0};
const servers=Array.from({length:5},(_,i)=>({pid:i+1,port:3100+i,url:'http://localhost:'+ (3100+i),processName:i===0?'node.exe':'Local development server',pageTitle:i===0?'A long project title that must truncate rather than collide with the new tab action':'',attachedToProject:i<3}));
window.mount=(state={})=>flushSync(()=>root.render(<AssistantBrowserNewTab key={state.key||'fixture'} projectServers={state.empty?[]:servers.slice(0,3)} otherServers={state.empty?[]:servers.slice(3)} loading={!!state.loading} error={state.error||null} onNavigate={url=>window.calls.navigate.push(url)} onOpenInNewTab={url=>window.calls.newTab.push(url)} onOpenHistory={()=>window.calls.history++} onRefresh={()=>window.calls.refresh++} getSearchSuggestions={async query=>query==='fail'?Promise.reject(Error('fixture failure')):Array.from({length:9},(_,i)=>query+' suggestion '+i)} />));
window.click=selector=>flushSync(()=>document.querySelector(selector).click());
window.toggle=()=>window.click('button[aria-controls="assistant-browser-local-servers-content"]');
window.freeze=ms=>{for(const animation of document.getAnimations()){animation.pause();animation.currentTime=ms;}};
window.finish=()=>{for(const animation of document.getAnimations()){animation.finish();animation.cancel();}};
const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
const styles=element=>{const s=getComputedStyle(element);return Object.fromEntries(['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius','borderTopWidth','borderBottomWidth','borderLeftWidth','backgroundColor','boxShadow','opacity','visibility','overflow','transform'].map(key=>[key,s[key]]));};
window.geometry=()=>{const form=document.querySelector('form'),search=form.firstElementChild,drawer=document.querySelector('section[aria-label="Running locally"]'),content=document.getElementById('assistant-browser-local-servers-content'),footer=drawer.lastElementChild,frame=document.querySelector('[data-new-tab-search-frame]');return {form:rect(form),search:rect(search),searchStyle:styles(search),drawer:rect(drawer),drawerStyle:styles(drawer),content:rect(content),contentStyle:styles(content),footer:rect(footer),frame:frame?rect(frame):null,frameStyle:frame?styles(frame):null,input:rect(document.querySelector('input')),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,paneWidth:document.querySelector("#root > div").clientWidth,suggestions:document.querySelector('[role="listbox"]')?rect(document.querySelector('[role="listbox"]')):null};};
window.hit=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
window.mount();
`

try {
    const bundle = await build({
        stdin: { contents: renderer, resolveDir: desktop, loader: 'tsx' },
        bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser',
        alias: { '@': join(desktop, 'src/renderer/src'), '@shared': join(desktop, 'src/shared') },
        define: { 'process.env.NODE_ENV': '"test"', 'import.meta.hot': 'undefined' },
        plugins: [{ name: 'isolated-settings', setup(builder) {
            if (candidate) builder.onLoad({ filter: /AssistantBrowserNewTab\.tsx$/ }, async args => ({ contents: await readFile(candidate, 'utf8'), loader: 'tsx', resolveDir: dirname(args.path) }))
            builder.onResolve({ filter: /^@\/lib\/settings$/ }, () => ({ path: 'settings', namespace: 'fixture' }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useSettings=()=>({settings:{assistantBrowserNewTabBackgroundMode:'unsplash',assistantBrowserNewTabBackgroundCategory:'all',assistantBrowserNewTabBackgroundRotation:'fixed',assistantBrowserNewTabBackgroundId:'fixture'},updateSettings:()=>{}});` }))
        } }]
    })
    const sourceCss = (await readFile(join(desktop, 'src/renderer/src/index.css'), 'utf8')).replace(/^@import .*;\r?\n/gm, '')
    const tokens = await readFile(join(desktop, 'src/renderer/src/styles/theme-tokens.css'), 'utf8')
    const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [candidate || join(desktop, 'src/renderer/src/pages/assistant/AssistantBrowserNewTab.tsx'), ...['AssistantBrowserPageIcon.tsx', 'AssistantBrowserBackgroundPicker.tsx'].map(file => join(desktop, 'src/renderer/src/pages/assistant', file))] }), autoprefixer]).process(tokens + sourceCss, { from: undefined })).css
    const wallpaper = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#56766d"/><path d="M0 330L800 190V270L0 410Z" fill="#a0b7ad"/></svg>')
    const html = join(directory, 'index.html')
    await writeFile(html, `<!doctype html><style>${css}</style><div id="root"></div><script>window.devscope={getBrowserBackgroundProviderStatus:async()=>({success:true,status:{unsplashConfigured:true}}),getBrowserRemoteBackgrounds:async()=>({success:true,backgrounds:[{id:'fixture',provider:'unsplash',imageUrl:${JSON.stringify(wallpaper)},photographer:'Fixture',photographerUrl:'https://example.invalid',downloadLocation:'fixture',color:'#56766d'}]}),trackBrowserRemoteBackground:async()=>({success:true})};</script><script>${bundle.outputFiles[0].text}</script>`)
    const harness = join(directory, 'run.cjs')
    await writeFile(harness, `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.setPath('sessionData',${JSON.stringify(join(directory, 'session'))});
app.disableHardwareAcceleration();
const inspect=${inspect},artifacts=${JSON.stringify(artifacts || null)},results=[];let win;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const eq=(a,b,message)=>assert.ok(Math.abs(a-b)<0.6,message+': '+a+' vs '+b);
const timer=setTimeout(()=>{console.error('New Tab layout renderer timed out');app.exit(1)},45000);
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,width:1000,height:800,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Fixture renderer: '+event.message)});
 const js=code=>win.webContents.executeJavaScript(code).catch(error=>{throw Error('Fixture expression '+code+': '+error.message)});
 const hit=selector=>js('window.hit('+JSON.stringify(selector)+')');const click=selector=>js('window.click('+JSON.stringify(selector)+')');
 const pointer=async selector=>{const point=await js('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait(30);};
 // Offscreen windows have no native focus-in event. Supply that boundary event;
 // text editing and arrow/Enter/Escape events still use Chromium's input path.
 const query=async value=>{await js('document.querySelector("input").focus();document.querySelector("input").dispatchEvent(new FocusEvent("focusin",{bubbles:true}));document.querySelector("input").select()');await win.webContents.insertText(value);};
 const shot=async name=>{if(artifacts){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await wait(80);const png=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{win.webContents.removeListener('paint',paint);reject(Error('Hidden renderer paint timed out'))},3000);const paint=(_,dirty,image)=>{clearTimeout(timeout);resolve(image.toPNG())};win.webContents.once('paint',paint);win.webContents.invalidate();});await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,name+'.png'),png);}};
 await win.loadFile(${JSON.stringify(html)});await wait(150);
 for(const width of [280,360,560,1000]){
  win.setContentSize(width,800);await js('window.mount({key:"width-'+width+'"})');await wait(80);
  let g=await js('window.geometry()');const searchWidth=g.form.width;eq(g.frame.width,Math.min((Math.min(g.paneWidth,720)-32)*0.88,460),'responsive shared frame width');eq(g.drawer.width,searchWidth,'collapsed drawer matches search');assert.equal(g.contentStyle.visibility,'hidden');assert.ok(g.scrollWidth<=g.viewport,'no horizontal overflow');await shot(width+'-collapsed');
  await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(0);resolve()}))');
  const samples=[];
  for(const ms of [0,100,200,420]){
   await js('window.freeze('+ms+')');g=await js('window.geometry()');samples.push({ms,...g});await shot(width+'-expand-'+ms);
   if(!inspect){assert.ok(g.frame,'one shared expansion frame');eq(g.frame.x+1,g.form.x,'single frame border on left');eq(g.frame.right-1,g.form.right,'single frame border on right');eq(g.drawer.x,g.form.x,'drawer left matches search throughout expansion');eq(g.drawer.right,g.form.right,'drawer right matches search throughout expansion');eq(g.drawer.y,g.search.bottom,'no gap or overlap at search/drawer join');assert.equal(g.frameStyle.borderTopLeftRadius,'22px');assert.equal(g.frameStyle.borderBottomLeftRadius,'12px');assert.equal(g.frameStyle.borderLeftWidth,'1px');assert.equal(g.frameStyle.overflow,'hidden');assert.equal(g.drawerStyle.boxShadow,'none');assert.equal(g.drawerStyle.backgroundColor,'rgba(0, 0, 0, 0)');assert.equal(g.searchStyle.boxShadow,'none','no separate search shadow seam');assert.equal(g.searchStyle.borderBottomWidth,'0px','no search bottom border seam');assert.ok(g.content.y>=g.input.bottom-0.6,'server content never crosses the input');assert.ok(g.content.bottom<=g.footer.y+0.6,'server scroller stays above footer');}
  }
  results.push({width,expansion:samples});await js('window.finish()');await wait(30);g=await js('window.geometry()');eq(g.drawer.width,searchWidth,'expanded drawer shares width');assert.ok(await hit('button[title="Open localhost:3100"]'),'server row is hit-testable');assert.ok(await hit('button[aria-label="Refresh running servers"]'),'refresh is hit-testable');
  if(!inspect){await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(0);resolve()}))');for(const ms of [0,100,200,420]){await js('window.freeze('+ms+')');g=await js('window.geometry()');eq(g.frame.width,searchWidth+2,'shared frame remains full width on collapse');eq(g.drawer.width,searchWidth,'drawer width stays fixed on collapse');eq(g.drawer.y,g.search.bottom,'collapse has no seam gap');assert.equal(g.frameStyle.borderTopLeftRadius,'22px');assert.equal(g.frameStyle.borderBottomLeftRadius,'12px');assert.equal(g.searchStyle.boxShadow,'none');assert.equal(g.drawerStyle.boxShadow,'none');await shot(width+'-collapse-'+ms);}await js('window.finish()');}
 }
 if(!inspect){
  // Reverse disclosure before it settles, then resize the pane mid-expansion.
  await js('window.mount({key:"interrupted"})');await wait(40);await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(100);resolve()}))');await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(100);resolve()}))');g=await js('window.geometry()');eq(g.drawer.width,g.form.width,'interrupted collapse shares width');eq(g.drawer.y,g.search.bottom,'interrupted collapse has no seam');await shot('interrupted-collapse');await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(200);resolve()}))');win.setContentSize(280,500);await wait(40);g=await js('window.geometry()');eq(g.drawer.width,g.form.width,'resize during expansion shares width');eq(g.frame.width,Math.min((g.paneWidth-32)*0.88,460),'resized frame follows pane');assert.ok(g.scrollWidth<=g.viewport);await shot('280-interrupted-resize');await js('window.finish()');
  win.setContentSize(360,800);await js('window.mount({key:"interactions"})');await wait(60);await js('window.toggle();window.finish()');await wait(450);
  for(const selector of ['button[title="Open localhost:3100"]','button[aria-label="Open localhost:3100 in a new Browser tab"]','button[aria-label="Refresh running servers"]','button[aria-label="Open Browser history"]'])await click(selector);
  let calls=await js('window.calls');assert.deepEqual(calls.navigate,['http://localhost:3100']);assert.deepEqual(calls.newTab,['http://localhost:3100']);assert.equal(calls.refresh,1);assert.equal(calls.history,1);
  await query('zyra');await wait(260);g=await js('window.geometry()');assert.ok(g.suggestions,'suggestions open after Chromium input');assert.ok(g.drawer.y>=g.suggestions.bottom-0.6,'suggestions and server content do not overlap');assert.ok(await js('document.querySelector("[data-new-tab-attribution]").getBoundingClientRect().y>=document.querySelector("[data-new-tab-search-frame]").getBoundingClientRect().bottom+12'),'attribution clears a long suggestions/server frame');await js('document.querySelector('+JSON.stringify('button[aria-label="Refresh running servers"]')+').scrollIntoView({block:"nearest"})');assert.ok(await hit('button[aria-label="Refresh running servers"]'),'long suggestions leave refresh reachable by scrolling');await shot('360-suggestions');
  const press=key=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:key});if(key==='Return')win.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});win.webContents.sendInputEvent({type:'keyUp',keyCode:key});};press('Down');await wait(20);assert.equal(await js('document.querySelector("input").getAttribute("aria-activedescendant")'),'assistant-browser-new-tab-suggestions-option-0');press('Up');await wait(20);assert.equal(await js('document.querySelector("input").getAttribute("aria-activedescendant")'),'assistant-browser-new-tab-suggestions-option-8');press('Return');await wait(30);assert.equal((await js('window.calls.navigate')).at(-1),'zyra suggestion 8');
  await query('pointer');await wait(260);await js('document.querySelector("[role=option]").scrollIntoView({block:"nearest"})');assert.ok(await hit('[role=option]'));await pointer('[role=option]');assert.equal((await js('window.calls.navigate')).at(-1),'pointer suggestion 0');
  await query('fail');await wait(260);assert.equal(await js('document.querySelector("[role=status]").textContent'),'Press Enter to search');press('Escape');await wait(30);assert.equal(await js('Boolean(document.querySelector("[role=listbox]"))'),false);
  for(const state of [{empty:true},{empty:true,loading:true},{empty:true,error:'Fixture unavailable'}]){await js('window.mount('+JSON.stringify({...state,key:JSON.stringify(state)})+')');await wait(30);await js('window.toggle()');await wait(460);g=await js('window.geometry()');assert.ok(g.content.bottom<=g.footer.y+0.6);assert.equal(await js('document.querySelector('+JSON.stringify('button[aria-label="Refresh running servers"]')+').disabled'),!!state.loading);}
  assert.match(await js('document.querySelector("main").firstElementChild.textContent'),/\\d{2}:\\d{2}/);assert.equal(await js('document.querySelector("img").style.opacity'),'1');
  await js('document.documentElement.style.setProperty("--color-bg","#f7f7f7");document.documentElement.style.setProperty("--color-text","#171717");document.documentElement.style.setProperty("--color-text-muted","#5a5a5a");window.mount({key:"light"})');await wait(40);await shot('360-light-collapsed');await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(()=>{window.freeze(200);resolve()}))');g=await js('window.geometry()');assert.match(g.frameStyle.backgroundColor,/0\.968/);eq(g.drawer.width,g.form.width);await shot('360-light-expand-200');// The offscreen compositor can hold an idle transition at time zero.
  // Verify the actual reduced duration and render its first 1ms keyframe.
  await js('window.finish();document.body.classList.add("zyra-reduce-motion");window.mount({key:"reduced"})');await wait(40);await js('window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(resolve))');assert.ok(await js('document.getAnimations().every(a=>Number(a.effect.getTiming().duration)<=0.011)'),'application reduced-motion durations apply');await js('window.freeze(1)');g=await js('window.geometry()');eq(g.drawer.height,224,'reduced-motion expansion at 1ms');await js('window.finish();window.toggle()');await js('new Promise(resolve=>requestAnimationFrame(resolve))');await js('window.freeze(1)');g=await js('window.geometry()');eq(g.drawer.height,34,'reduced-motion collapse at 1ms');await shot('360-reduced-collapsed');
 }
 if(artifacts)await fs.writeFile(path.join(artifacts,inspect?'before-geometry.json':'geometry.json'),JSON.stringify(results,null,2));
 console.log(inspect?JSON.stringify(results.map(({width,expansion})=>({width,expansion:expansion.map(({ms,search,drawer,searchStyle,drawerStyle,contentStyle})=>({ms,search,drawer,searchRadius:searchStyle.borderBottomLeftRadius,searchBorder:searchStyle.borderBottomWidth,searchShadow:searchStyle.boxShadow,drawerShadow:drawerStyle.boxShadow,fade:contentStyle.opacity}))})),null,2):'PASS: responsive 280/360/560/1000px panes; expansion/collapse at 0/100/200/420ms; interruption/resize; dark/light/reduced motion; suggestions keyboard/native pointer/error/Escape; server actions, history, clock/background, empty/loading/error');
 clearTimeout(timer);win.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(timer);if(win&&!win.isDestroyed())win.destroy();app.exit(1)});
`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const virtual = process.platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), harness]
    const code = await new Promise((done, reject) => {
        const child = spawn(virtual ? 'xvfb-run' : electronPath, virtual ? ['--auto-servernum', electronPath, ...args] : args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true, shell: false })
        child.once('error', reject)
        child.once('exit', code => done(code ?? 1))
    })
    assert.equal(code, 0, 'isolated Chromium renderer checks')
    if (artifacts) console.log('Renderer evidence: ' + artifacts)
} finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-new-tab-layout-')) throw Error('Unexpected fixture cleanup path')
    await rm(directory, { recursive: true, force: true })
}
