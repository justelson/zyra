import assert from 'node:assert/strict'
import { ChromePairingServer } from '../src/main/agent-control/chrome-pairing-server'
import { ChromeExtensionDriver } from '../src/main/agent-control/drivers/chrome-extension-driver'
const pairing = new ChromePairingServer()
const driver = new ChromeExtensionDriver(pairing, '')
const targets = new Map<string, unknown>()
let sequence = 0
driver.setRegistrationHandlers({register(input) {const id = `control-target:chrome-tab:${++sequence}`; targets.set(id,input); return id}, remove(id) {targets.delete(id)}})
pairing.resolveTabTarget = (pairId, tabId) => driver.getTargetId(pairId,tabId)
const extensionId = 'a'.repeat(32)
type Session = Awaited<ReturnType<typeof pairing.connectExtension>>
async function post(session:Session, route:string, body:object = {}) {
    const response = await fetch(`http://127.0.0.1:${session.port}${route}`, {method:'POST',headers:{Origin:`chrome-extension://${extensionId}`,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    const result = await response.json() as any
    if (result.nextToken) session.token = result.nextToken
    return {status:response.status, ...result}
}
try {
    const first = await pairing.connectExtension(extensionId,'chrome_profile_first')
    const second = await pairing.connectExtension(extensionId,'chrome_profile_second')
    const refresh = driver.refreshTargets()
    const polls = await Promise.all([post(first,'/v1/poll'),post(second,'/v1/poll')])
    assert.equal(polls[0].requests[0].operation.type,'discover-tabs')
    const registration = await post(first,'/v1/event',{type:'tabs.discover',tabs:[{tabId:41,url:'https://example.test/',title:'Review',browserName:'Chrome Review',documentId:'doc-41',mode:'control'}]})
    assert.equal(registration.status,200)
    assert.equal(registration.targets[0].targetId,driver.getTargetId(first.pairId,41))
    assert.equal(targets.size,1)
    const wrongProfile = await post(second,'/v1/respond',{requestId:polls[0].requests[0].requestId,ok:true,result:{}})
    assert.equal(wrongProfile.status,409,'another profile cannot complete a pending driver request')
    await post(first,'/v1/respond',{requestId:polls[0].requests[0].requestId,ok:true,result:{count:1}})
    await post(second,'/v1/respond',{requestId:polls[1].requests[0].requestId,ok:true,result:{count:0}})
    await refresh
    const anchor: any = { target: { kind: 'chrome-tab' }, trustedIdentity: (targets.get(registration.targets[0].targetId) as any).trustedIdentity }
    const opening = driver.openTab(anchor, 'https://example.test/new')
    const pendingOpen = await post(first, '/v1/poll')
    assert.equal(pendingOpen.requests[0].operation.type, 'open-tab')
    assert.equal(pendingOpen.requests[0].operation.tabId, 41)
    await post(first, '/v1/event', { type: 'tab.register', tabId: 42, url: 'https://example.test/new', title: 'New', browserName: 'Chrome Review', documentId: 'doc-42', mode: 'control' })
    await post(first, '/v1/respond', { requestId: pendingOpen.requests[0].requestId, ok: true, result: { tabId: 42 } })
    assert.equal(await opening, driver.getTargetId(first.pairId, 42), 'the driver resolves only the new target in the same authenticated browser connection')
    await post(first,'/v1/event',{type:'tab.closed',tabId:42})
    await post(first,'/v1/event',{type:'tab.closed',tabId:41})
    assert.equal(targets.size,0)
    console.log('Chrome catalog: broker identity mapping, profile isolation, release: ok')
} finally { await pairing.stop() }
