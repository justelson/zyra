import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
async function moduleAt(entry) {
  const output = await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',target:'node22'})
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=zyra-extension-test-' + entry.replaceAll('/', '-') + '.mjs').toString('base64')}#${Math.random()}`)
}
function fixture() {
  const listeners = {}, values = {}, sent = [], detached = []
  let tab = {id:41,url:'https://example.test/editor',title:'Editor',windowId:7,incognito:false}
  const event = name => ({addListener: callback => {listeners[name] = callback}})
  globalThis.chrome = {
    runtime:{id:'a'.repeat(32)},
    storage:{session:{get:async key=>({[key]:values[key]}),set:async input=>Object.assign(values,input),remove:async key=>{delete values[key]}}},
    tabs:{get:async()=>({...tab}),update:async(id,patch)=>{sent.push(['tabs.update',id,patch]);return tab},onRemoved:event('removed'),onUpdated:event('updated')},
    windows:{update:async(id,patch)=>sent.push(['windows.update',id,patch])},
    webNavigation:{onCommitted:event('committed')},
    debugger:{attach:async()=>{},detach:async input=>{detached.push(input.tabId)},onDetach:event('detach'),onEvent:event('debugger'),sendCommand:async(_target,method,params)=>{sent.push([method,params]);return {}}},
  }
  return {listeners,values,sent,detached,setTab:next=>{tab={...tab,...next}}}
}
test('packaged MV3 app extension has trusted input and no broad host authority or executable remote code',async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,'dist/unpacked/manifest.json'),'utf8'))
  assert.deepEqual(manifest.permissions,['debugger','tabs','storage','webNavigation','favicon','sidePanel','alarms'])
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*'])
  assert.equal(manifest.action.default_popup,undefined)
  assert.equal(manifest.side_panel.default_path,'chat/extension.html')
  assert.equal(manifest.incognito,'not_allowed')
  assert.doesNotMatch(manifest.content_security_policy.extension_pages,/script-src[^;]*'(?:unsafe-eval|unsafe-inline)'/)
  assert.match(manifest.content_security_policy.extension_pages, /(?:^|;\s*)worker-src 'self';/,
    'MV3 workers must load packaged modules; Chrome rejects blob worker sources at install time')
  for(const name of ['service-worker.js','ui.js','ui.css','popup.html','console.html','font.woff2']) assert.ok((await readFile(path.join(root,'dist/unpacked',name))).length>0)
  const popup=await readFile(path.join(root,'dist/unpacked/ui.js'),'utf8')
  assert.doesNotMatch(popup,/Start\.ps1|Install-Codex|local bridge|XXXX XXXX XXXX/)
})
test('URL and byte limits reject privileged pages, credentials and oversized non-ASCII messages',async()=>{
  const safety=await moduleAt('src/shared/safety.ts'),protocol=await moduleAt('src/protocol.ts')
  for(const url of ['chrome://settings','file:///C:/private','https://user:secret@example.test/']) assert.throws(()=>safety.pageUrl(url))
  assert.equal(safety.pageUrl('https://example.test/').origin,'https://example.test')
  assert.throws(()=>protocol.assertBoundedMessage({text:'界'.repeat(200000)}),/size limit/)
})
test('control is exact-tab and read-only, survives same-site navigation with fresh observations, ends on changed site',async()=>{
  const f=fixture(),{Controller}=await moduleAt('src/extension/control.ts'),{parseOperation}=await moduleAt('src/shared/protocol.ts')
  const c=new Controller(()=>{})
  await c.grant(41,'read')
  await assert.rejects(c.execute(parseOperation({method:'click',params:{tabId:41,ref:'abc-123:1'}}),new AbortController().signal),/read-only/)
  await assert.rejects(c.execute(parseOperation({method:'snapshot',params:{tabId:99}}),new AbortController().signal),/Grant this tab/)
  f.listeners.committed({tabId:41,frameId:0,url:'https://example.test/editor'})
  assert.equal(c.list().length,1,'same-site reload should retain explicit tab sharing')
  await c.grant(41,'control')
  await c.execute(parseOperation({method:'focus',params:{tabId:41}}),new AbortController().signal)
  assert.ok(f.sent.some(call=>call[0]==='windows.update'&&call[1]===7&&call[2].focused))
  f.listeners.updated(41,{url:'https://another.test/'})
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(c.list().length,0)
  assert.ok(f.detached.includes(41))
  f.setTab({incognito:true})
  await assert.rejects(c.grant(41,'control'),/Private browsing/)
  delete globalThis.chrome
})
test('late error responses rotate tokens without exposing or persisting credentials',async()=>{
  const f=fixture(),{sendEvent}=await moduleAt('src/pairing.ts'),originalFetch=globalThis.fetch
  f.values.zyraPairingSessionV1={port:43210,pairId:'pair:one',token:'previous-token',expiresAt:new Date(Date.now()+60000).toISOString()}
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url).includes('token'),false)
    assert.equal(options.headers.authorization,'Bearer previous-token')
    return {ok:false,status:409,json:async()=>({error:'unknown-or-late-request',nextToken:'next-token'})}
  }
  try{
    await assert.rejects(sendEvent({type:'tab.closed',tabId:41}),/unknown-or-late/)
    assert.equal(f.values.zyraPairingSessionV1.token,'next-token','a cancelled/late request must not break the next poll')
  }finally{globalThis.fetch=originalFetch;delete globalThis.chrome}
})

test('sidebar tab access follows that tab across websites but still rejects privileged pages',async()=>{
  const f=fixture(),{Controller}=await moduleAt('src/extension/control.ts')
  const c=new Controller(()=>{})
  await c.grant(41,'control','tab')
  f.setTab({url:'https://another.test/editor'})
  f.listeners.updated(41,{url:'https://another.test/editor'})
  assert.equal(c.list().length,1)
  assert.equal(c.list()[0].origin,'https://another.test')
  f.listeners.committed({tabId:41,frameId:0,url:'chrome://settings'})
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(c.list().length,0)
  assert.ok(f.detached.includes(41))
  delete globalThis.chrome
})

test('browser scope shares website tabs, adds new tabs and stops adding after release',async()=>{
  const f=fixture(),{BrowserScope}=await moduleAt('src/browser-scope.ts')
  let tabs=[{id:41,url:'https://one.test',incognito:false},{id:42,url:'chrome://settings',incognito:false},{id:43,url:'https://private.test',incognito:true}]
  globalThis.chrome.tabs.query=async()=>tabs
  globalThis.chrome.tabs.get=async(id)=>tabs.find(tab=>tab.id===id)
  const grants=[],calls=[]
  const controller={control:{list:()=>grants},grant:async(id,mode,scope)=>{calls.push(id);grants.push({tabId:id,mode,scope})},release:async(id)=>{const i=grants.findIndex(grant=>grant.tabId===id);if(i>=0)grants.splice(i,1)}}
  const scope=new BrowserScope(controller,()=>{})
  await scope.enable();assert.equal(scope.active,true);assert.deepEqual(calls,[41])
  tabs.push({id:44,url:'https://two.test',incognito:false})
  await scope.tabCompleted(44);assert.deepEqual(calls,[41,44])
  scope.disable();tabs.push({id:45,url:'https://three.test',incognito:false});await scope.tabCompleted(45)
  assert.deepEqual(calls,[41,44])
  delete globalThis.chrome
})


test('desktop discovery exposes metadata without attaching; approved observation acquires the exact tab',async()=>{
  const f=fixture()
  chrome.tabs.query=async()=>[{id:41,url:'https://example.test/editor?token=private',title:'Editor',incognito:false},{id:42,url:'chrome://settings',title:'Settings'},{id:43,url:'https://example.test/private',incognito:true}]
  f.values.zyraPairingSessionV1={pairId:'pair-test',token:'token-test',port:45678,expiresAt:new Date(Date.now()+60000).toISOString()}
  const originalFetch=globalThis.fetch
  const registered=[]
  globalThis.fetch=async(_url,init)=>{
    const event=JSON.parse(init.body)
    if(event.type==='tabs.discover') registered.push(...event.tabs)
    return new Response(JSON.stringify({ok:true,nextToken:'token-test',targets:event.tabs?.map(tab=>({tabId:tab.tabId,targetId:'control-target:chrome-tab:41'}))}),{status:200})
  }
  try {
    const {AppController}=await moduleAt('src/app-controller.ts')
    const controller=new AppController(()=>{},()=> 'Chrome Review')
    await controller.execute({type:'discover-tabs'},new AbortController().signal)
    assert.equal(registered.length,1)
    assert.equal(registered[0].url,'https://example.test/editor')
    assert.equal(registered[0].browserName,'Chrome Review')
    assert.deepEqual(controller.control.list(),[],'metadata enumeration grants no page access')
    assert.equal(controller.targetId(41),'control-target:chrome-tab:41')
    await assert.rejects(controller.execute({type:'observe',tabId:41,documentId:'wrong'},new AbortController().signal),/no longer shared/)
    await assert.rejects(controller.execute({type:'action',tabId:41,documentId:registered[0].documentId,observationRevision:1,action:{type:'click'}},new AbortController().signal),/Stale observation/)
    const acquired=[]
    controller.control.grant=async(...args)=>{acquired.push(args)}
    controller.control.execute=async()=>({url:'https://example.test/editor',title:'Editor',viewport:{width:800,height:600},elements:[
      {ref:'count:1',role:'status',name:'Save count: 1',interactive:false},
      {ref:'save:2',role:'button',name:'Save note',interactive:true}
    ]})
    const observation=await controller.execute({type:'observe',tabId:41,documentId:registered[0].documentId,observationRevision:1},new AbortController().signal)
    assert.equal(observation.elements[0].name,'Save count: 1','readable page status reaches the agent')
    assert.deepEqual(observation.elements[0].actions,[],'static status text is not offered as a clickable control')
    assert.deepEqual(observation.elements[1].actions,['click'])
    assert.deepEqual(acquired,[[41,'control','tab']])
    await controller.release(41)
    assert.equal(controller.targetId(41),undefined)
  } finally { globalThis.fetch=originalFetch }
})

test('desktop tab creation stays in the granted Chrome window without focus or automatic page access',async()=>{
  const f=fixture(),originalFetch=globalThis.fetch,created=[],removed=[],events=[]
  chrome.tabs.query=async()=>[{id:41,url:'https://example.test/editor',title:'Editor',incognito:false}]
  chrome.tabs.create=async input=>{created.push(input);return {id:42,...input}}
  chrome.tabs.remove=async id=>{removed.push(id)}
  f.values.zyraPairingSessionV1={pairId:'pair-test',token:'token-test',port:45678,expiresAt:new Date(Date.now()+60000).toISOString()}
  globalThis.fetch=async(_url,init)=>{
    const event=JSON.parse(init.body);events.push(event)
    return Response.json({ok:true,nextToken:'token-test',targetId:'chrome:new',targets:event.tabs?.map(tab=>({tabId:tab.tabId,targetId:'chrome:anchor'}))})
  }
  try {
    const {AppController}=await moduleAt('src/app-controller.ts'),controller=new AppController(()=>{})
    await controller.execute({type:'discover-tabs'},new AbortController().signal)
    const documentId=events.find(event=>event.type==='tabs.discover').tabs[0].documentId
    const request={type:'open-tab',tabId:41,documentId,url:'https://example.test/new'}
    await assert.rejects(controller.execute({...request,documentId:'foreign'},new AbortController().signal),/no longer shared/)
    await assert.rejects(controller.execute({...request,url:'chrome://settings'},new AbortController().signal),/HTTP/)
    const opened=await controller.execute(request,new AbortController().signal)
    assert.equal(opened.tabId,42)
    assert.deepEqual(created,[{windowId:7,url:'https://example.test/new',active:false}])
    assert.equal(controller.targetId(42),'chrome:new')
    assert.equal(controller.control.list().length,0,'creation registers metadata and leaves page access to a new exact-target grant')
    const abort=new AbortController()
    chrome.tabs.create=async()=>{abort.abort();return {id:43}}
    await assert.rejects(controller.execute(request,abort.signal))
    assert.deepEqual(removed,[43],'cancellation removes only the tab created by this request')
    f.setTab({incognito:true})
    await assert.rejects(controller.execute(request,new AbortController().signal),/Private browsing/)
  } finally {globalThis.fetch=originalFetch;delete globalThis.chrome}
})
