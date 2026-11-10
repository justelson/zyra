import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    startAssistantBrowserRecording, stopActiveAssistantBrowserRecording, readAssistantBrowserRecording,
    pauseAssistantBrowserRecording, resumeAssistantBrowserRecording, setAssistantBrowserRecordingMicrophone,
    dismissAssistantBrowserRecording, recordingElapsedMs, setAssistantBrowserRecordingAudioSource,
    prepareAssistantBrowserRecording, startPreparedAssistantBrowserRecording, readActiveAssistantBrowserRecordingTarget
} from '../src/renderer/src/pages/assistant/assistant-browser-recording'

class Track extends EventTarget { stopped=false; constructor(public kind:string){super()} stop(){this.stopped=true} }
class Stream { tracks:Track[]; constructor(kind:string|Track[]='video'){this.tracks=Array.isArray(kind)?[...kind]:[new Track(kind)]} addTrack(track:Track){this.tracks.push(track)} getTracks(){return this.tracks} removeTrack(track:Track){this.tracks=this.tracks.filter(item=>item!==track)} getVideoTracks(){return this.tracks.filter(track=>track.kind==='video')} getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio')} }
const encoders: Encoder[]=[]
let audioContexts=0, displayRequests=0, microphoneRequests=0, grantRequests=0
let intervalStarts=0
const originalSetInterval=globalThis.setInterval
globalThis.setInterval=((...args: Parameters<typeof setInterval>)=>{intervalStarts++;return originalSetInterval(...args)}) as typeof setInterval
class Encoder extends EventTarget {
    state='inactive'; static isTypeSupported(){return true}
    constructor(public stream:Stream){super();encoders.push(this)}
    start(){this.state='recording';queueMicrotask(()=>this.dispatchEvent(Object.assign(new Event('dataavailable'),{data:new Blob(['fixture-start'])})))} pause(){this.state='paused'} resume(){this.state='recording'}
    stop(){this.state='inactive';this.dispatchEvent(Object.assign(new Event('dataavailable'),{data:new Blob(['fixture-video'])}));this.dispatchEvent(new Event('stop'))}
}
class Audio { constructor(){audioContexts++} state='running'; closed=false; resume(){return Promise.resolve()} close(){this.closed=true;return Promise.resolve()} createMediaStreamDestination(){return {stream:new Stream('audio')}} createMediaStreamSource(){return {connect(){},disconnect(){}}} createConstantSource(){return {offset:{value:0},connect(){},disconnect(){},start(){},stop(){}}} }
let receive: (frame:any)=>void=()=>{}
let failSave=false
let deferSave=false
let resolveSave:((value:any)=>void)|null=null
let resolveStart:((result:any)=>void)|null=null
let deferStart=false
let microphone:Stream|null=null
let denyAudio=false
let deferAudio=false
let resolveAudio:((stream:Stream)=>void)|null=null
let resolveMicrophone:((stream:Stream)=>void)|null=null
const saved:number[]=[]
Object.assign(globalThis, {
    MediaRecorder:Encoder, AudioContext:Audio, MediaStream:Stream,
    document:{createElement:()=>({onloadeddata:null as (()=>void)|null,play(){this.onloadeddata?.();return Promise.resolve()},pause(){}})},
    window:{devscope:{
        onBrowserPreviewRecordingFrame:(listener:(frame:any)=>void)=>{receive=listener;return()=>{receive=()=>{}}},
        startBrowserPreviewRecording:()=>{grantRequests++;return deferStart ? new Promise(resolve=>{resolveStart=resolve}) : Promise.resolve({success:true,startedAt:new Date().toISOString(),tabAudioSupported:true,systemAudioSupported:true})},
        prepareBrowserPreviewRecordingAudio:async()=>({success:true}),
        stopBrowserPreviewRecording:async()=>({success:true}),
        saveBrowserPreviewRecording:async(input:{data:Uint8Array})=>{if(deferSave)return new Promise(resolve=>{resolveSave=resolve});if(failSave)return {success:false,error:'Disk is full'};saved.push(input.data.length);return {success:true,artifact:{artifactId:'recording:fixture',kind:'recording'}}}
    }}
})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Windows Electron/43',mediaDevices:{getDisplayMedia:async(options:{audio:boolean})=>{displayRequests++;if(options.audio&&denyAudio)throw new DOMException('Denied','NotAllowedError');if(options.audio&&deferAudio)return new Promise<Stream>(resolve=>{resolveAudio=resolve});const stream=new Stream();if(options.audio)stream.addTrack(new Track('audio'));return stream},getUserMedia:()=>{microphoneRequests++;return new Promise<Stream>(resolve=>{resolveMicrophone=resolve})}}}})
const target={tabId:'tab:recording',guestWebContentsId:7}
assert.equal(recordingElapsedMs(2000,null,9000),2000,'paused time is excluded')
assert.equal(recordingElapsedMs(2000,5000,6500),3500,'resumed duration accumulates')
prepareAssistantBrowserRecording(target,{width:900,height:600},{sessionId:'session:original',enabled:true})
assert.equal(readAssistantBrowserRecording().status,'ready')
await setAssistantBrowserRecordingMicrophone('mic-selected')
await setAssistantBrowserRecordingAudioSource('system')
prepareAssistantBrowserRecording(target,{width:900,height:600},{sessionId:'session:original',enabled:true})
assert.equal(readAssistantBrowserRecording().microphone,'mic-selected','reopening setup retains its selection')
assert.equal(readAssistantBrowserRecording().audioSource,'system')
assert.equal(readAssistantBrowserRecording().elapsedMs,0)
assert.equal(readActiveAssistantBrowserRecordingTarget(),null,'setup has no active capture owner')
assert.deepEqual([audioContexts,displayRequests,microphoneRequests,grantRequests,intervalStarts,encoders.length],[0,0,0,0,0,0],'setup/options must not construct capture, request permissions or begin timers')
dismissAssistantBrowserRecording()
assert.equal(readAssistantBrowserRecording().status,'idle','dismissing setup is harmless')
await assert.rejects(startPreparedAssistantBrowserRecording(),/Choose a Browser tab/)

prepareAssistantBrowserRecording(target,{width:900,height:600},{sessionId:'session:original',enabled:true})
await startPreparedAssistantBrowserRecording()
assert.equal(readAssistantBrowserRecording().captureDestination?.sessionId,'session:original','Start preserves originating chat')
assert.equal(readAssistantBrowserRecording().status,'recording')
assert.equal(readAssistantBrowserRecording().microphone,'off','recording never opens a microphone by default')
pauseAssistantBrowserRecording();assert.equal(encoders[0]!.state,'paused');assert.equal(readAssistantBrowserRecording().status,'paused')
resumeAssistantBrowserRecording();assert.equal(encoders[0]!.state,'recording')
const micRequest=setAssistantBrowserRecordingMicrophone('')
microphone=new Stream('audio');resolveMicrophone!(microphone);await micRequest
assert.equal(readAssistantBrowserRecording().microphone,'')
await setAssistantBrowserRecordingMicrophone('off');assert(microphone.getTracks().every(track=>track.stopped),'Mic off releases hardware')
const lateRequest=setAssistantBrowserRecordingMicrophone('')
await setAssistantBrowserRecordingMicrophone('off')
const lateStream=new Stream('audio');resolveMicrophone!(lateStream);await lateRequest
assert(lateStream.getTracks().every(track=>track.stopped),'a cancelled late permission response cannot reopen the mic')
denyAudio=true;await setAssistantBrowserRecordingAudioSource('tab')
assert.equal(readAssistantBrowserRecording().audioPending,false);assert.match(readAssistantBrowserRecording().error!,/denied/);assert.equal(encoders[0]!.state,'recording','denied audio never stops video')
denyAudio=false;deferAudio=true
const pendingAudio=setAssistantBrowserRecordingAudioSource('tab')
for(let i=0;i<20&&!resolveAudio;i++)await Promise.resolve()
await setAssistantBrowserRecordingAudioSource('off')
const lateAudio=new Stream('audio');resolveAudio!(lateAudio);await pendingAudio
assert(lateAudio.getTracks().every(track=>track.stopped),'cancelled audio capture releases every late track')
assert.equal(readAssistantBrowserRecording().audioSource,'off')
deferAudio=false
await setAssistantBrowserRecordingAudioSource('tab');assert.equal(readAssistantBrowserRecording().audioSource,'tab')
await setAssistantBrowserRecordingAudioSource('system');assert.equal(readAssistantBrowserRecording().audioSource,'system')
await setAssistantBrowserRecordingAudioSource('off');assert.equal(readAssistantBrowserRecording().audioSource,'off')
assert.equal(encoders[0]!.stream.getTracks().length,2,'switching audio inputs preserves the encoder track set')
const firstStop=stopActiveAssistantBrowserRecording();assert.equal(stopActiveAssistantBrowserRecording(),firstStop,'double stop shares one save')
await firstStop;assert.equal(readAssistantBrowserRecording().captureDestination?.sessionId,'session:original','saved capture retains its attachment destination');assert.deepEqual(saved,[26]);assert.equal(readAssistantBrowserRecording().status,'saved')
assert(encoders[0]!.stream.getTracks().every(track=>track.stopped),'recording releases every capture track')
dismissAssistantBrowserRecording();assert.equal(readAssistantBrowserRecording().status,'idle')
prepareAssistantBrowserRecording(target,{width:900,height:600},{sessionId:'session:original',enabled:true})
await setAssistantBrowserRecordingAudioSource('tab')
await setAssistantBrowserRecordingMicrophone('mic-selected')
resolveMicrophone=null
const encoderCount=encoders.length
const preparedStart=startPreparedAssistantBrowserRecording()
assert.equal(startPreparedAssistantBrowserRecording(),preparedStart,'repeated Start shares one capture operation')
for(let index=0;index<30&&!resolveMicrophone;index++)await new Promise(resolve=>setTimeout(resolve,1))
assert(resolveMicrophone,'explicit Start opens the selected microphone')
assert.equal(readAssistantBrowserRecording().status,'starting')
assert.equal(readAssistantBrowserRecording().elapsedMs,0,'waiting for selected audio permission does not run the clock')
assert.equal(encoders.length,encoderCount,'selected inputs are ready before encoding begins')
const selectedMicrophone=new Stream('audio');resolveMicrophone!(selectedMicrophone);await preparedStart
assert.equal(readAssistantBrowserRecording().microphone,'mic-selected')
assert.equal(readAssistantBrowserRecording().audioSource,'tab','setup audio choice reaches the actual capture stream')
assert.equal(readAssistantBrowserRecording().status,'recording')
await stopActiveAssistantBrowserRecording();dismissAssistantBrowserRecording()
assert(selectedMicrophone.getTracks().every(track=>track.stopped))

await startAssistantBrowserRecording(target,{width:900,height:600})
receive({tabId:target.tabId,ended:true,data:'',width:0,height:0,receivedAt:new Date().toISOString()})
for(let index=0;index<20 && readAssistantBrowserRecording().status!=='saved';index++) await new Promise(resolve=>setTimeout(resolve,1))
assert.equal(readAssistantBrowserRecording().status,'saved','closed native pages save and settle the renderer recorder')
deferStart=true
const pendingStart=startAssistantBrowserRecording(target,{width:900,height:600})
for(let index=0;index<20 && !resolveStart;index++) await new Promise(resolve=>setTimeout(resolve,1))
const closing=stopActiveAssistantBrowserRecording()
resolveStart!({success:true,startedAt:new Date().toISOString(),tabAudioSupported:true,systemAudioSupported:true})
const closedCheck=assert.rejects(closing,/No video frames/)
await assert.rejects(pendingStart,/closed before recording/);await closedCheck
assert.equal(readAssistantBrowserRecording().status,'error','a late start reply cannot revive stopped recording controls')
deferStart=false
deferSave=true
await startAssistantBrowserRecording(target,{width:900,height:600})
const pendingSave=stopActiveAssistantBrowserRecording()
for(let i=0;i<30&&!resolveSave;i++)await Promise.resolve()
assert(resolveSave,'saving reached the disk boundary')
assert.equal(readAssistantBrowserRecording().status,'stopping')
assert(encoders.at(-1)!.stream.getTracks().every(track=>track.stopped),'video/audio capture is released before slow disk I/O finishes')
resolveSave!({success:true,artifact:{artifactId:'slow-save',kind:'recording'}})
await pendingSave;deferSave=false
failSave=true;await startAssistantBrowserRecording(target,{width:900,height:600})
await assert.rejects(stopActiveAssistantBrowserRecording(),/Disk is full/)
assert.equal(readAssistantBrowserRecording().status,'error','save failures settle instead of leaving a spinner')
assert.equal(readAssistantBrowserRecording().unsaved,true,'a failed save retains a downloadable copy')
assert(encoders.at(-1)!.stream.getTracks().every(track=>track.stopped))
const annotation=readFileSync(new URL('../src/main/ipc/handlers/browser-preview-annotation-script.ts',import.meta.url),'utf8')
assert.match(annotation,/\.drawing-plane\{position:fixed/)
assert.doesNotMatch(annotation,/(?:^|\n)\s*svg\{position:fixed/,'toolbar SVG icons must not inherit the full-window drawing plane')
console.log('Browser recorder ready setup, explicit Start, preserved inputs, lifecycle, microphone cleanup and annotation sizing: ok')
