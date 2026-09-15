import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAssistantBrowserSurfaceRequests } from '../../src/renderer/src/pages/assistant/useAssistantBrowserSurfaceRequests'
import { AssistantChatFolderAccess } from '../../src/renderer/src/pages/assistant/AssistantChatFolderAccess'
import { BrowserSurfaceInbox } from '../../src/preload/adapters/browser-surface-inbox'
import { session, changed, applies, setFailure } from './issue-recovery-state'
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)}
const pause=()=>new Promise(resolve=>setTimeout(resolve,20))
const inbox=new BrowserSurfaceInbox<any>()
const failed:any[]=[]
const cancelListeners=new Set<(id:string)=>void>()
let accepted=true, revealCount=0, releaseAck:(()=>void)|null=null, delayed=false
;(window as any).devscope={agentControl:{
    onBrowserSurfaceRequest:(callback:any)=>inbox.subscribe(callback),
    onBrowserSurfaceCancel:(callback:any)=>{cancelListeners.add(callback);return()=>cancelListeners.delete(callback)},
    acknowledgeBrowserSurfaceRequest:async()=>{if(delayed)await new Promise<void>(resolve=>{releaseAck=resolve});return {success:true,accepted}},
    completeBrowserSurfaceRequest:async(value:any)=>{failed.push(value);return {success:true}}
}}
const request=(id:string)=>({requestId:id,threadId:'thread:a',tabId:'tab:'+id,reveal:true,mode:'open'})
function BrowserHarness({thread='thread:a'}:{thread?:string}) {
    const state=useAssistantBrowserSurfaceRequests({threadId:thread,revealInspector:()=>{revealCount++},resizeInspector:()=>{}})
    return <div id="request">{state.request?.requestId||''}</div>
}
const root=createRoot(document.getElementById('root')!)
const mount=(element:any)=>{flushSync(()=>root.render(element))}
const click=(label:string)=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent===label);assert(button,'missing '+label);button!.click()}
;(window as any).issueRecoveryCheck=(async()=>{
    const results:string[]=[]
    inbox.receive(request('before-mount'))
    mount(<BrowserHarness/>);await pause()
    assert(document.getElementById('request')?.textContent==='before-mount'&&revealCount===1,'closed inspector reveals a buffered request')
    mount(null);await pause()
    assert(failed.some(entry=>entry.requestId==='before-mount'&&!entry.success),'unmount settles pending browser request')
    accepted=false;inbox.receive(request('expired'));mount(<BrowserHarness/>);await pause()
    assert(!document.getElementById('request')?.textContent&&revealCount===1,'expired acknowledgement must not open a late tab')
    accepted=true;delayed=true;inbox.receive(request('unmount-in-flight'));await pause();mount(null);releaseAck?.();await pause()
    assert(revealCount===1,'late ack after unmount must not reveal or insert')
    delayed=false;mount(<BrowserHarness thread="thread:b"/>);await pause();inbox.receive(request('wrong-thread'));await pause()
    assert(failed.some(entry=>entry.requestId==='wrong-thread')&&revealCount===1,'request cannot enter another chat')
    mount(<BrowserHarness/>);await pause();inbox.receive(request('retry'));await pause()
    assert(document.getElementById('request')?.textContent==='retry','retry recovers after remount')
    results.push('Browser hook: buffered reveal, remount, stale ack, unmount race, wrong thread and retry')
    mount(<AssistantChatFolderAccess sessionId="chat"/>);await pause()
    assert(document.getElementById('root')?.textContent?.includes('Review folder changes'),'existing chat offers scope refresh')
    click('Review folder changes');await pause()
    assert(document.getElementById('root')?.textContent?.includes('C:/fixture/docs')&&document.getElementById('root')?.textContent?.includes('Read only'),'review displays newly granted root and ceiling')
    session.threads[0].state='running';changed();await pause()
    assert((document.querySelector('button') as HTMLButtonElement).disabled,'active work blocks scope change')
    session.threads[0].state='idle';changed();await pause();setFailure(true);click('Apply folder changes');await pause()
    assert(document.querySelector('[role="alert"]')?.textContent==='Fixture connection unavailable','failed apply keeps review and shows error')
    setFailure(false);click('Apply folder changes');await pause()
    assert(applies===2&&session.chatScope.revision===2,'retry applies to existing chat once')
    assert(!document.getElementById('root')?.textContent?.includes('Apply folder changes')&&document.getElementById('root')?.textContent?.includes('C:/fixture/docs'),'saved scope is displayed after apply')
    results.push('Folder access: review, read-only ceiling, active-turn lock, failed apply and successful retry')
    root.unmount()
    return results
})()
