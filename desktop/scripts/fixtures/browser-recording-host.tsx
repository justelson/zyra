import { addAppearanceManagedFontFaces } from '../../src/renderer/src/lib/appearance-font-faces'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantBrowserRecordingHost } from '../../src/renderer/src/pages/assistant/AssistantBrowserRecordingHost'
import type { BrowserRecordingSnapshot } from '../../src/renderer/src/pages/assistant/assistant-browser-recording'
import type { BrowserRecordingOverlayCommand, BrowserRecordingOverlayPresentation, BrowserRecordingOverlayState } from '../../src/shared/contracts/browser-recording-overlay'

const results: string[] = []
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const pause = () => new Promise(resolve => setTimeout(resolve, 20))
async function waitFor(predicate: () => boolean, message: string) { for(let i=0;i<100&&!predicate();i++)await pause();check(predicate(),message) }
const initial: BrowserRecordingSnapshot = { status:'idle',tabId:null,guestWebContentsId:null,elapsedMs:0,microphone:'off',microphonePending:false,audioSource:'off',audioPending:false,tabAudioSupported:true,systemAudioSupported:true,error:null,artifact:null,unsaved:false }
let state = initial
const subscribers = new Set<()=>void>()
const commands = new Set<(command:BrowserRecordingOverlayCommand)=>void>()
const presentations = new Set<(value:BrowserRecordingOverlayPresentation)=>void>()
const actions: string[] = []
const updates: Array<BrowserRecordingOverlayState|null> = []
const artifacts: string[]=[]
const devicesChanged = new Set<EventListenerOrEventListenerObject>()
let labels = false
let enumerations = 0
let deferredDevices: ((value:unknown[])=>void)|null = null
let deferDevices = false
function patch(value: Partial<BrowserRecordingSnapshot>) { state={...state,...value}; for(const listener of subscribers)listener() }
function action(name:string){actions.push(name)}
;(globalThis as any).__recordingHostStore = {
    readAssistantBrowserRecording:()=>state,
    subscribeAssistantBrowserRecording:(listener:()=>void)=>{subscribers.add(listener);return()=>subscribers.delete(listener)},
    pauseAssistantBrowserRecording:()=>{action('pause');patch({status:'paused'})},
    resumeAssistantBrowserRecording:()=>{action('resume');patch({status:'recording'})},
    stopActiveAssistantBrowserRecording:async()=>{action('stop');patch({status:'saved'})},
    startPreparedAssistantBrowserRecording:async()=>{action('start');labels=state.microphone!=='off';patch({status:'recording'})},
    setAssistantBrowserRecordingMicrophone:async(deviceId:string)=>{action('microphone:'+deviceId);if(state.status!=='ready')labels=true;patch({microphone:deviceId})},
    setAssistantBrowserRecordingAudioSource:async(source:'off'|'tab'|'system')=>{action('audio:'+source);patch({audioSource:source})},
    dismissAssistantBrowserRecording:()=>{action('dismiss');state=initial;for(const listener of subscribers)listener()},
    downloadUnsavedAssistantBrowserRecording:()=>action('save-copy')
}
;(window as any).devscope={
    setBrowserRecordingOverlay:async(value:BrowserRecordingOverlayState|null)=>{updates.push(value);return{success:true}},
    onBrowserRecordingOverlayCommand:(listener:(command:BrowserRecordingOverlayCommand)=>void)=>{commands.add(listener);return()=>commands.delete(listener)},
    onBrowserRecordingOverlayPresentation:(listener:(value:BrowserRecordingOverlayPresentation)=>void)=>{presentations.add(listener);return()=>presentations.delete(listener)},
    attachBrowserCaptureToChat:async(input:any)=>{action('attach:'+input.sessionId);return{success:true}},
    openBrowserPreviewArtifact:async(id:string)=>{artifacts.push(id);return{success:true}}
}
const deviceList=()=>[
    {kind:'audioinput',deviceId:'default',label:'Default'},
    {kind:'audioinput',deviceId:'communications',label:'Communications'},
    {kind:'audiooutput',deviceId:'speaker',label:'Speaker'},
    {kind:'audioinput',deviceId:'mic-a',label:labels?'Desk microphone':''},
    {kind:'audioinput',deviceId:'mic-b',label:labels?'Headset':''}
]
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
    enumerateDevices:()=>{enumerations++;return deferDevices?new Promise(resolve=>{deferredDevices=resolve}):Promise.resolve(deviceList())},
    addEventListener:(type:string,listener:EventListenerOrEventListenerObject)=>{if(type==='devicechange')devicesChanged.add(listener)},
    removeEventListener:(type:string,listener:EventListenerOrEventListenerObject)=>{if(type==='devicechange')devicesChanged.delete(listener)}
}})
function emit(command:BrowserRecordingOverlayCommand){for(const listener of commands)listener(command)}
function present(value:Partial<BrowserRecordingOverlayPresentation>={}){for(const listener of presentations)listener({target:{tabId:state.tabId!,guestWebContentsId:state.guestWebContentsId!},visible:true,targetGone:false,error:null,...value})}
const container=document.getElementById('root')!
const root=createRoot(container)
const latest=()=>updates.at(-1)
;(window as any).recordingHostCheck=(async()=>{
    flushSync(()=>root.render(<StrictMode><AssistantBrowserRecordingHost/></StrictMode>))
    await pause()
    check(commands.size===0&&presentations.size===0&&enumerations===0,'idle must keep native bridge and microphone enumeration cold')
    patch({status:'ready',tabId:'tab:fixture',guestWebContentsId:7})
    await waitFor(()=>latest()?.status==='ready'&&latest()?.microphones.length===2,'setup publishes native controls and available devices')
    check(container.innerHTML===''&&latest()?.elapsedMs===0,'setup remains native and has no elapsed recording')
    emit({kind:'microphone',deviceId:'mic-a'});emit({kind:'audio',source:'tab'})
    await waitFor(()=>latest()?.microphone==='mic-a'&&latest()?.audioSource==='tab','setup choices flow through to native state')
    check(!labels&&!actions.includes('start'),'choosing setup options must not imply media permission or start')
    emit({kind:'dismiss'});await waitFor(()=>commands.size===0&&latest()===null,'setup closes without a stop or save')
    check(!actions.includes('stop')&&!actions.includes('start'),'dismissed setup must not invoke capture controls')
    patch({status:'ready',tabId:'tab:fixture',guestWebContentsId:7,microphone:'mic-a',audioSource:'tab'})
    await waitFor(()=>latest()?.status==='ready','reopened setup')
    emit({kind:'start'});await waitFor(()=>latest()?.status==='recording','explicit Start is forwarded')
    check(actions.filter(item=>item==='start').length===1,'one Start command starts once')
    results.push('ready setup preserves choices, dismisses harmlessly, and waits for explicit Start')
    patch({status:'recording',tabId:'tab:fixture',guestWebContentsId:7,elapsedMs:1200})
    await waitFor(()=>latest()?.microphones.length===2,'recording must publish native state and real device IDs')
    check(commands.size===1&&presentations.size===1,'one global Host must own one live subscription per channel')
    check(container.innerHTML==='','normal recording must add no DOM toolbar or page occluder')
    check(latest()?.target.guestWebContentsId===7&&latest()?.elapsedMs===1200,'native state must retain exact target and duration')
    results.push('native presentation has no DOM toolbar; idle services remain cold')
    for(let i=0;i<4;i++)patch({elapsedMs:1300+i})
    await pause();emit({kind:'pause'});await waitFor(()=>latest()?.status==='paused','pause forwarded')
    emit({kind:'resume'});await waitFor(()=>latest()?.status==='recording','resume forwarded')
    check(actions.filter(a=>a==='pause').length===1&&actions.filter(a=>a==='resume').length===1,'state changes must not duplicate command listeners')
    emit({kind:'microphone',deviceId:''});await waitFor(()=>latest()?.microphones[0]?.label==='Desk microphone','enabling microphone must refresh formerly private labels')
    check(actions.filter(a=>a==='microphone:').length===1,'one microphone command opens one device request')
    check(latest()?.microphones.map(d=>d.id).join(',')==='mic-a,mic-b','microphone list must exclude output/default/communications duplicates')
    const previous=enumerations
    for(const listener of devicesChanged)(listener as EventListener)(new Event('devicechange'))
    await waitFor(()=>enumerations>previous,'devicechange must refresh options')
    emit({kind:'audio',source:'system'});await waitFor(()=>latest()?.audioSource==='system','audio-source command forwarded')
    results.push('commands forward once; microphone labels and hotplug options refresh')
    document.documentElement.style.setProperty('--accent-primary','#abcdef')
    document.documentElement.style.colorScheme='light'
    window.dispatchEvent(new Event('zyra:theme-changed'))
    await waitFor(()=>latest()?.theme.accent==='#abcdef'&&latest()?.theme.dark===false,'theme changes must propagate to native overlay')
    present({target:{tabId:'tab:unrelated',guestWebContentsId:9},targetGone:true});await pause()
    check(container.innerHTML==='','another target disappearing must not show this recording recovery')
    present({targetGone:true,visible:false});await waitFor(()=>Boolean(document.querySelector('[data-browser-recording-recovery]')),'closed target must reveal reachable recovery controls')
    const stop=document.querySelector<HTMLButtonElement>('[data-browser-recording-recovery] button[title="Stop and save recording"]')
    check(stop,'closed target must retain stop control');stop.click()
    await waitFor(()=>state.status==='saved','recovery stop forwards to recorder')
    patch({artifact:{artifactId:'latest-artifact',kind:'recording'} as any,unsaved:true})
    await pause();emit({kind:'show-artifact'});await waitFor(()=>artifacts[0]==='latest-artifact','artifact command must read current store, not its subscription snapshot')
    document.documentElement.style.setProperty('--surface-floating','#163042')
    document.documentElement.style.setProperty('--surface-divider','#345678')
    document.documentElement.style.fontFamily='Fixture UI, sans-serif'
    addAppearanceManagedFontFaces(document,[],{family:'Fixture UI',css:'@font-face{font-family:"Fixture UI";src:url(data:font/woff2;base64,AA==)}'})
    await waitFor(()=>latest()?.theme.fontFamily?.includes('Fixture UI')&&latest()?.theme.fontCss?.includes('data:font/woff2'),'app font registration propagates to isolated recording overlay')
    patch({elapsedMs:4000});await pause();check(latest()?.theme.fontCss===undefined,'timer updates do not resend font data')
    check(latest()?.theme.background==='#163042'&&latest()?.theme.border==='#345678','recording surface uses current app surface and divider tokens')
    results.push('theme changes propagate; target-close recovery uses current recording/artifact')
    patch({captureDestination:{sessionId:'session:original',enabled:true},unsaved:false});await waitFor(()=>latest()?.canAttachToChat===true,'original chat attachment becomes available');emit({kind:'attach-chat'});emit({kind:'attach-chat'});emit({kind:'attach-chat'});await waitFor(()=>actions.includes('attach:session:original'),'recording attaches to its original chat');check(actions.filter(a=>a==='attach:session:original').length===1,'double attachment shares one handoff');
    await waitFor(()=>commands.size===0&&presentations.size===0&&latest()===null,'successful attachment dismisses saved controls')
    check(devicesChanged.size===0&&container.innerHTML==='','idle must release device listeners and recovery UI')
    patch({status:'ready',tabId:'tab:closed-setup',guestWebContentsId:10})
    await waitFor(()=>latest()?.status==='ready','closed-target setup attached')
    const stopCount=actions.filter(item=>item==='stop').length
    present({targetGone:true,visible:false})
    await waitFor(()=>state.status==='idle'&&latest()===null,'closed or transferred ready target dismisses setup')
    check(actions.filter(item=>item==='stop').length===stopCount,'closing a prepared target does not stop or save nonexistent media')
    patch({status:'recording',tabId:'tab:next',guestWebContentsId:11})
    await waitFor(()=>commands.size===1&&latest()?.target.guestWebContentsId===11,'new recording must attach once')
    deferDevices=true;emit({kind:'refresh-devices'});await waitFor(()=>Boolean(deferredDevices),'deferred enumeration started')
    flushSync(()=>root.unmount())
    check(commands.size===0&&presentations.size===0&&devicesChanged.size===0&&subscribers.size===0,'unmount must release all native/store/device subscriptions')
    check(latest()===null,'unmount must close native controls')
    const count=updates.length;deferredDevices!([{kind:'audioinput',deviceId:'late',label:'Late'}]);await pause()
    check(updates.length===count,'late device enumeration must not revive unmounted controls')
    results.push('idle/unmount remove subscriptions; late device replies cannot revive controls')
    return results
})()
