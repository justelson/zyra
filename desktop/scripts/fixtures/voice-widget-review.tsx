import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantVoiceWidget } from '../../src/renderer/src/pages/assistant/AssistantVoiceWidget'
import { useAppVoiceSession } from '../../src/renderer/src/pages/assistant/useAppVoiceSession'
import { VoiceHandoffDialog } from '../../src/renderer/src/pages/assistant/VoiceHandoffDialog'
import { idleVoiceWidgetState, type VoiceWidgetState, type VoiceWidgetLaunch } from '../../src/shared/assistant/voice-widget'

const w = window as any
w.IS_REACT_ACT_ENVIRONMENT = true
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 24)) }) }
async function until(check: () => boolean, message: string) { for (let i=0;i<120;i++) { if (check()) return; await tick() } throw new Error(message) }
const tracks: MediaStreamTrack[] = [], contexts: AudioContext[] = [], audio: any[] = []
async function syntheticStream() { const context = new AudioContext(); contexts.push(context); const sink = context.createMediaStreamDestination(); tracks.push(...sink.stream.getAudioTracks()); return sink.stream }
let releaseMicrophone!: () => void
const microphoneReady = new Promise<void>(resolve => { releaseMicrophone = resolve })
Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { await microphoneReady; return syntheticStream() } }, configurable: true })
class SilentAudio { muted=false; autoplay=false; volume=1; srcObject: unknown=null; constructor() { audio.push(this) } play() { return Promise.resolve() } pause() {} }
w.Audio = SilentAudio
const channels: any[] = []
class FixturePeer extends EventTarget {
    iceGatheringState='complete'; connectionState='new'; localDescription: any=null; channel: any
    onconnectionstatechange: any; ontrack: any
    createDataChannel() { this.channel = { readyState: 'open', send() {}, close() {} }; channels.push(this.channel); return this.channel }
    addTrack() {}
    async createOffer() { return { type:'offer', sdp:'synthetic-offer' } }
    async setLocalDescription(value: any) { this.localDescription=value }
    async setRemoteDescription() { this.connectionState='connected'; this.onconnectionstatechange?.(); this.channel.onopen?.(); this.ontrack?.({streams:[await syntheticStream()]}) }
    close() { this.connectionState='closed' }
}
w.RTCPeerConnection = FixturePeer
const launch = (id: string): VoiceWidgetLaunch => ({ sessionId:`session-${id}`,conversationId:`thread-${id}`,title:`Chat ${id}`,options:{instructions:'Synthetic continuity check.',voice:'cove',outputModality:'audio',executionConfiguration:{model:'fixture/original',effort:'high',runtimeMode:'approval-required',interactionMode:'default',profile:'default'}} })
let state: VoiceWidgetState = {...idleVoiceWidgetState(),callId:'call-A',launch:launch('A'),status:'connecting'}
const observers = new Set<(next: VoiceWidgetState) => void>(), commands = new Set<(next:any)=>void>(), pending = new Map<string,(result:any)=>void>()
const starts: any[] = [], stops: Array<() => void> = [], ingested: any[] = []
let stopCount=0, select: (id: string)=>void, probe: ReturnType<typeof useAppVoiceSession>
const publish = () => { state={...state,revision:state.revision+1}; for(const listener of observers)listener(state) }
const api = {
    getState: async()=>state,
    onState:(listener:any)=>{observers.add(listener);return()=>observers.delete(listener)},
    onCommand:(listener:any)=>{commands.add(listener);return()=>commands.delete(listener)},
    publish:async(callId:string,update:any)=>{if(callId===state.callId){state={...state,...update};publish()}},
    complete:async(id:string,result:any)=>{pending.get(id)?.(result);pending.delete(id)},
    command:async(command:any)=>{
        if(command.callId!==state.callId)return{success:false,error:'Stale call'}
        if(command.action==='return'){select(state.launch!.conversationId.slice(-1));return{success:true}}
        return new Promise(resolve=>{const commandId=crypto.randomUUID();pending.set(commandId,resolve);for(const listener of commands)listener({...command,commandId})})
    },
    open:async(next:VoiceWidgetLaunch,expected?:string)=>{
        if(state.status!=='idle'&&state.launch?.conversationId!==next.conversationId){
            if(expected!==state.callId)return{success:true,disposition:'handoff-required',state}
            const result:any=await api.command({callId:state.callId,action:'stop'});if(!result.success)return result
        }
        state={...idleVoiceWidgetState(),revision:state.revision+1,callId:crypto.randomUUID(),launch:next,status:'connecting'};publish()
        return{success:true,disposition:'started',state}
    }
}
w.devscope={voiceWidget:api,assistant:{
    onRealtimeVoiceEvent:()=>()=>{},connect:async()=>({success:true}),
    startRealtimeVoice:async(input:any)=>{starts.push(input);return{success:true,threadId:`provider-${input.conversationId}`,adapterSessionId:`adapter-${starts.length}`,realtimeSessionId:`realtime-${starts.length}`,realtimeSessionGeneration:starts.length,realtimeVersion:'v3',sdp:'synthetic-answer'}},
    stopRealtimeVoice:()=>{stopCount++;return new Promise(resolve=>stops.push(()=>resolve({success:true})))},
    ingestRealtimeVoiceEvent:async(input:any)=>{ingested.push(input);return{success:true}},sendRealtimeVoiceMessage:async()=>({success:true})
}}
function Probe(){const[id,setId]=useState('A');select=setId;probe=useAppVoiceSession({sessionId:`session-${id}`,conversationId:`thread-${id}`},`Chat ${id}`);return <>{probe.handoff&&<VoiceHandoffDialog currentTitle={probe.handoff.previous.launch!.title} nextTitle={probe.handoff.launch.title} onReturn={probe.returnToCall} onSwitch={probe.confirmHandoff} onCancel={probe.cancelHandoff}/>}</>}
const root=createRoot(document.getElementById('root')!)
w.voiceWidgetReview = (async()=>{
    await act(async()=>root.render(<><AssistantVoiceWidget/><Probe/></>))
    await until(()=>state.status==='requesting-microphone','Widget exposes controls while microphone setup is pending')
    await act(async()=>{(document.querySelector('[aria-label="Mute microphone"]')as HTMLButtonElement).click();(document.querySelector('[aria-label="Mute speaker"]')as HTMLButtonElement).click()})
    await act(async()=>releaseMicrophone())
    await until(()=>state.status==='active','Voice must become active with synthetic media')
    assert(!tracks[0].enabled&&audio.some(value=>value.muted),'Mute choices made during setup apply before tracks/output become active')
    await act(async()=>{(document.querySelector('[aria-label="Unmute microphone"]')as HTMLButtonElement).click();(document.querySelector('[aria-label="Unmute speaker"]')as HTMLButtonElement).click()})
    assert(tracks[0].enabled,'Connecting-time microphone mute can be undone after setup')
    assert(starts[0].conversationId==='thread-A','Original chat binding reaches actual Voice hook')
    assert(probe!.status==='active','Original pane observes active call')
    const mic=tracks[0]
    await act(async()=>{(document.querySelector('[aria-label="Mute microphone"]')as HTMLButtonElement).click()})
    assert(!mic.enabled,'Widget mute controls the actual stream track')
    await act(async()=>{(document.querySelector('[aria-label="Mute speaker"]')as HTMLButtonElement).click()})
    assert(audio.some(value=>value.muted),'Widget speaker mute controls actual output object')
    await act(async()=>{channels[0].onmessage({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'speech-one',transcript:'Remember this test sentence.'})})})
    await until(()=>probe!.transcript.some(entry=>entry.text.includes('Remember this')),'Voice transcript reaches owning pane')
    assert(ingested.length>0,'Voice transcript also crosses canonical ingest')
    await act(async()=>select('B'))
    assert(probe!.status==='idle','Other chat never inherits the active Voice identity')
    assert(mic.readyState==='live'&&stopCount===0,'Navigation keeps original call alive')
    document.dispatchEvent(new Event('visibilitychange'))
    assert(stopCount===0,'Visibility changes do not end Voice')
    await act(async()=>{void probe!.start(launch('B').options)})
    await until(()=>Boolean(document.querySelector('[role="dialog"]')),'Second chat requires handoff')
    const buttons=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    assert(buttons().length===3,'Handoff offers Cancel, Return and End-and-start')
    await act(async()=>buttons().find(button=>button.textContent==='Cancel')!.click())
    assert(stopCount===0&&mic.readyState==='live','Cancel preserves original call')
    await act(async()=>{void probe!.start(launch('B').options)})
    await until(()=>Boolean(document.querySelector('[role="dialog"]')),'Handoff can reopen')
    await act(async()=>buttons().find(button=>button.textContent==='Return to call')!.click())
    await until(()=>probe!.status==='active','Return selects original call without a new connection')
    assert(starts.length===1&&stopCount===0,'Return does not restart Voice')
    w.voiceWidgetScreenshotReady=true
    await until(()=>w.voiceWidgetScreenshotCaptured===true,'Hidden harness must capture widget')
    await act(async()=>select('B'))
    await act(async()=>{void probe!.start(launch('B').options)})
    await until(()=>Boolean(document.querySelector('[role="dialog"]')),'Handoff opens before switch')
    await act(async()=>buttons().find(button=>button.textContent==='End call and start here')!.click())
    await until(()=>stopCount===1,'Handoff initiates remote stop')
    assert(mic.readyState==='ended','Microphone stops before deferred network cleanup resolves')
    assert(starts.length===1,'B cannot start before A stop settles')
    await act(async()=>stops.shift()!())
    await until(()=>starts.length===2&&state.status==='active','B starts after A is fully stopped')
    assert(starts[1].conversationId==='thread-B','New connection binds B')
    assert(stopCount===1,'Old component cleanup cannot stop the replacement call')
    await act(async()=>{(document.querySelector('[aria-label="End Voice"]')as HTMLButtonElement).click()})
    await until(()=>stopCount===2,'End control stops B')
    await act(async()=>stops.shift()!())
    await until(()=>state.status==='idle','End control settles to idle')
    await act(async()=>root.unmount())
    assert(stopCount===2,'Idle unmount sends no stray remote hangup')
    for(const context of contexts)await context.close().catch(()=>{})
    return ['real widget mute/speaker/end controls','owning-chat transcript and navigation/visibility continuity','three-way handoff and immediate microphone shutdown','no replacement-call cleanup race']
})().catch(error=>{console.error(error);throw error})
