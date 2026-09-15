import assert from 'node:assert/strict'
import { BrowserSurfaceHost } from '../src/main/agent-control/browser-surface-host'
const principal = { type: 'root' as const, threadId: 'fixture:chat', turnId: 'fixture:turn' }
const requests: any[] = [], cancelled: string[] = [], settled: string[] = []
let sequence = 0
let resolved: any
const host = new BrowserSurfaceHost({send: request => requests.push(request),cancel: id=>cancelled.push(id),settled: id=>settled.push(id),resolveTarget:()=>resolved,makeId:()=>String(++sequence),timeoutMs:1000})
const target=(request:any,ownerThreadId=request.threadId)=>({kind:'zyra-browser' as const,targetId:'control:'+request.tabId,tabId:request.tabId,ownerThreadId,sessionMode:request.sessionMode,guestIdentity:'fixture:guest',origin:null})
try {
    const opening=host.openTab(principal,true,'normal')
    const request=requests.at(-1)
    assert.equal(host.acknowledge(request),true)
    assert.equal(host.acknowledge(request),false)
    assert.equal(host.completeRegisteredTarget(target(request,'another:chat')),false)
    assert.equal(host.completeRegisteredTarget(target(request)),true)
    assert.equal((await opening).sessionMode,'normal')
    assert.deepEqual(settled,[request.requestId])
    const signal=new AbortController()
    const cancelledOpen=host.openTab(principal,true,'normal',signal.signal)
    const cancelledRequest=requests.at(-1)
    const cancelledResult=assert.rejects(cancelledOpen,/cancelled/)
    signal.abort();await cancelledResult
    assert.equal(host.acknowledge(cancelledRequest),false)
    assert.equal(host.completeRegisteredTarget(target(cancelledRequest)),false)
    const timed=host.openTab(principal,true,'normal')
    const timedRequest=requests.at(-1)
    const timedResult=assert.rejects(timed,/Open that chat in Zyra Desktop/)
    await new Promise(resolve=>setTimeout(resolve,1050));await timedResult
    assert.equal(host.acknowledge(timedRequest),false)
    assert.ok(cancelled.includes(timedRequest.requestId))
    const original=target(request)
    const reveal=host.revealTabs(principal,original,null)
    const revealResult=assert.rejects(reveal,/different control target/)
    const revealRequest=requests.at(-1)
    host.acknowledge(revealRequest)
    resolved={...original,ownerThreadId:'another:chat'}
    host.complete({...revealRequest,success:true,targetId:original.targetId})
    await revealResult
    assert.equal(settled.length,4,'every completed, cancelled, timed-out or rejected request releases its routing entry')
} finally { host.dispose() }
console.log('Browser surface lifecycle: registration, ownership, timeout, cancellation, late replies and cleanup passed.')
