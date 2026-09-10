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
  assert.deepEqual(manifest.permissions,['debugger','tabs','storage','webNavigation','favicon'])
  assert.deepEqual(manifest.optional_host_permissions,['http://127.0.0.1/*'])
  assert.equal(manifest.host_permissions,undefined)
  assert.equal(manifest.incognito,'not_allowed')
  assert.doesNotMatch(manifest.content_security_policy.extension_pages,/unsafe-eval|unsafe-inline/)
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
