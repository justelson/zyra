import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    startAssistantBrowserRecording, stopActiveAssistantBrowserRecording, readAssistantBrowserRecording,
    pauseAssistantBrowserRecording, resumeAssistantBrowserRecording, setAssistantBrowserRecordingMicrophone,
    dismissAssistantBrowserRecording, recordingElapsedMs
} from '../src/renderer/src/pages/assistant/assistant-browser-recording'

class Track extends EventTarget { stopped=false; constructor(public kind:string){super()} stop(){this.stopped=true} }
class Stream { tracks:Track[]; constructor(kind='video'){this.tracks=[new Track(kind)]} addTrack(track:Track){this.tracks.push(track)} getTracks(){return this.tracks} getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio')} }
const encoders: Encoder[]=[]
class Encoder extends EventTarget {
    state='inactive'; static isTypeSupported(){return true}
    constructor(public stream:Stream){super();encoders.push(this)}
    start(){this.state='recording'} pause(){this.state='paused'} resume(){this.state='recording'}
    stop(){this.state='inactive';this.dispatchEvent(Object.assign(new Event('dataavailable'),{data:new Blob(['fixture-video'])}));this.dispatchEvent(new Event('stop'))}
}
class Audio { state='running'; closed=false; resume(){return Promise.resolve()} close(){this.closed=true;return Promise.resolve()} createMediaStreamDestination(){return {stream:new Stream('audio')}} createMediaStreamSource(){return {connect(){},disconnect(){}}} }
let receive: (frame:any)=>void=()=>{}
let failSave=false
let resolveStart:((result:any)=>void)|null=null
let deferStart=false
let microphone:Stream|null=null
let resolveMicrophone:((stream:Stream)=>void)|null=null
const saved:number[]=[]
Object.assign(globalThis, {
    MediaRecorder:Encoder, AudioContext:Audio,
    document:{createElement:()=>({width:1,height:1,getContext:()=>({fillRect(){},drawImage(){}}),captureStream:()=>new Stream()})},
    window:{devscope:{
        onBrowserPreviewRecordingFrame:(listener:(frame:any)=>void)=>{receive=listener;return()=>{receive=()=>{}}},
        startBrowserPreviewRecording:()=>deferStart ? new Promise(resolve=>{resolveStart=resolve}) : Promise.resolve({success:true,startedAt:new Date().toISOString()}),
        stopBrowserPreviewRecording:async()=>({success:true}),
        saveBrowserPreviewRecording:async(input:{data:Uint8Array})=>{if(failSave)return {success:false,error:'Disk is full'};saved.push(input.data.length);return {success:true,artifact:{artifactId:'recording:fixture',kind:'recording'}}}
    }}
})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise<Stream>(resolve=>{resolveMicrophone=resolve})}}})
const target={tabId:'tab:recording',guestWebContentsId:7}
assert.equal(recordingElapsedMs(2000,null,9000),2000,'paused time is excluded')
assert.equal(recordingElapsedMs(2000,5000,6500),3500,'resumed duration accumulates')
await startAssistantBrowserRecording(target,{width:900,height:600})
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
const firstStop=stopActiveAssistantBrowserRecording();assert.equal(stopActiveAssistantBrowserRecording(),firstStop,'double stop shares one save')
await firstStop;assert.deepEqual(saved,[13]);assert.equal(readAssistantBrowserRecording().status,'saved')
assert(encoders[0]!.stream.getTracks().every(track=>track.stopped),'recording releases every capture track')
dismissAssistantBrowserRecording();assert.equal(readAssistantBrowserRecording().status,'idle')
await startAssistantBrowserRecording(target,{width:900,height:600})
receive({tabId:target.tabId,ended:true,data:'',width:0,height:0,receivedAt:new Date().toISOString()})
for(let index=0;index<20 && readAssistantBrowserRecording().status!=='saved';index++) await new Promise(resolve=>setTimeout(resolve,1))
assert.equal(readAssistantBrowserRecording().status,'saved','closed native pages save and settle the renderer recorder')
deferStart=true
const pendingStart=startAssistantBrowserRecording(target,{width:900,height:600})
for(let index=0;index<20 && !resolveStart;index++) await new Promise(resolve=>setTimeout(resolve,1))
const closing=stopActiveAssistantBrowserRecording()
resolveStart!({success:true,startedAt:new Date().toISOString()})
await assert.rejects(pendingStart,/closed before recording/);await closing
assert.equal(readAssistantBrowserRecording().status,'saved','a late start reply cannot revive stopped recording controls')
deferStart=false
failSave=true;await startAssistantBrowserRecording(target,{width:900,height:600})
await assert.rejects(stopActiveAssistantBrowserRecording(),/Disk is full/)
assert.equal(readAssistantBrowserRecording().status,'error','save failures settle instead of leaving a spinner')
assert.equal(readAssistantBrowserRecording().unsaved,true,'a failed save retains a downloadable copy')
assert(encoders.at(-1)!.stream.getTracks().every(track=>track.stopped))
const annotation=readFileSync(new URL('../src/main/ipc/handlers/browser-preview-annotation-script.ts',import.meta.url),'utf8')
assert.match(annotation,/\.drawing-plane\{position:fixed/)
assert.doesNotMatch(annotation,/(?:^|\n)\s*svg\{position:fixed/,'toolbar SVG icons must not inherit the full-window drawing plane')
console.log('Browser recorder lifecycle, microphone cleanup and annotation sizing: ok')
