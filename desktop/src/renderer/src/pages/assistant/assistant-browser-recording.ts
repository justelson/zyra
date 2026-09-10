import type { DevScopeBrowserCaptureArtifact, DevScopeBrowserGuestTargetInput, DevScopeBrowserRecordingFrame } from '@shared/contracts/devscope-api'

export type BrowserRecordingSnapshot = {
    status: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'saved' | 'error'
    tabId: string | null
    elapsedMs: number
    microphone: string
    microphonePending: boolean
    error: string | null
    artifact: DevScopeBrowserCaptureArtifact | null
    unsaved: boolean
}
type ActiveRecording = {
    target: DevScopeBrowserGuestTargetInput
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
    recorder: MediaRecorder
    stream: MediaStream
    audio: AudioContext
    destination: MediaStreamAudioDestinationNode
    microphoneStream: MediaStream | null
    microphoneSource: MediaStreamAudioSourceNode | null
    microphoneRequest: number
    chunks: Blob[]
    bytes: number
    mimeType: string
    startedAt: string
    elapsedMs: number
    resumedAt: number | null
    frameSequence: number
    presentedFrameSequence: number
    unsubscribe: () => void
    timer: ReturnType<typeof setInterval> | null
    stopping: Promise<DevScopeBrowserCaptureArtifact> | null
}
const EMPTY: BrowserRecordingSnapshot = { status: 'idle', tabId: null, elapsedMs: 0, microphone: 'off', microphonePending: false, error: null, artifact: null, unsaved: false }
let snapshot = EMPTY
let active: ActiveRecording | null = null
let unsavedVideo: Blob | null = null
const listeners = new Set<() => void>()
export const readAssistantBrowserRecording = () => snapshot
export const subscribeAssistantBrowserRecording = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(patch: Partial<BrowserRecordingSnapshot>) { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }
export function readActiveAssistantBrowserRecordingTabId(): string | null { return active?.target.tabId || null }
export function dismissAssistantBrowserRecording() { if (!active) { if (unsavedVideo && !window.confirm('Discard the unsaved recording?')) return; unsavedVideo = null; snapshot = EMPTY; for (const listener of listeners) listener() } }
export function recordingElapsedMs(elapsedMs: number, resumedAt: number | null, now = performance.now()): number { return elapsedMs + (resumedAt === null ? 0 : Math.max(0, now - resumedAt)) }
export function downloadUnsavedAssistantBrowserRecording() {
    if (!unsavedVideo) return
    const url = URL.createObjectURL(unsavedVideo)
    const link = document.createElement('a')
    link.href = url; link.download = `tab-recording.${unsavedVideo.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
function elapsed(recording: ActiveRecording) { return recordingElapsedMs(recording.elapsedMs, recording.resumedAt) }
async function bounded<T>(promise: Promise<T>, message: string, ms = 15_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]) }
    finally { clearTimeout(timer) }
}
function stopMediaRecorder(recorder: MediaRecorder): Promise<void> {
    if (recorder.state === 'inactive') return Promise.resolve()
    return bounded(new Promise((resolve, reject) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.addEventListener('error', () => reject(new Error('The video encoder stopped unexpectedly.')), { once: true })
        recorder.stop()
    }), 'The video encoder did not finish.')
}
function clearMicrophone(recording: ActiveRecording) {
    recording.microphoneSource?.disconnect()
    recording.microphoneStream?.getTracks().forEach(track => track.stop())
    recording.microphoneStream = null; recording.microphoneSource = null
}
function clearRecording(recording: ActiveRecording) {
    recording.microphoneRequest++
    recording.unsubscribe(); if (recording.timer) clearInterval(recording.timer)
    clearMicrophone(recording)
    recording.stream.getTracks().forEach(track => track.stop())
    void recording.audio.close().catch(() => {})
    if (active === recording) active = null
}
function drawFrame(recording: ActiveRecording, frame: DevScopeBrowserRecordingFrame) {
    if (active !== recording || frame.tabId !== recording.target.tabId) return
    if (frame.ended) { void stopAssistantBrowserRecording(recording.target).catch(() => {}); return }
    const sequence = ++recording.frameSequence
    const image = new Image()
    image.onload = () => {
        if (active !== recording || sequence <= recording.presentedFrameSequence) return
        recording.presentedFrameSequence = sequence
        const { width, height } = recording.canvas
        const scale = Math.min(width / image.width, height / image.height)
        recording.context.fillStyle = '#101010'; recording.context.fillRect(0, 0, width, height)
        recording.context.drawImage(image, (width-image.width*scale)/2, (height-image.height*scale)/2, image.width*scale, image.height*scale)
    }
    image.src = `data:image/jpeg;base64,${frame.data}`
}
export async function setAssistantBrowserRecordingMicrophone(deviceId: string): Promise<void> {
    const recording = active
    if (!recording || recording.stopping) return
    const request = ++recording.microphoneRequest
    clearMicrophone(recording)
    publish({ microphone: 'off', microphonePending: deviceId !== 'off', error: null })
    if (deviceId === 'off') return
    try {
        const pending = navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true }, video: false })
        void pending.then(stream => { if (active !== recording || request !== recording.microphoneRequest) stream.getTracks().forEach(track => track.stop()) }).catch(() => {})
        const stream = await bounded(pending, 'Microphone access timed out. Choose a microphone again to retry.', 30_000)
        if (active !== recording || request !== recording.microphoneRequest) return
        recording.microphoneStream = stream
        recording.microphoneSource = recording.audio.createMediaStreamSource(stream)
        recording.microphoneSource.connect(recording.destination)
        for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
            if (active !== recording || recording.microphoneStream !== stream) return
            clearMicrophone(recording); publish({ microphone: 'off', error: 'The microphone disconnected. Video recording continues.' })
        }, { once: true })
        publish({ microphone: deviceId, microphonePending: false })
    } catch (error) {
        if (active !== recording || request !== recording.microphoneRequest) return
        recording.microphoneRequest++
        clearMicrophone(recording)
        publish({ microphone: 'off', microphonePending: false, error: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied. Video recording continues.' : error instanceof DOMException && error.name === 'NotFoundError' ? 'No microphone was found. Video recording continues.' : error instanceof Error ? error.message : 'Could not open the microphone.' })
    }
}
export function pauseAssistantBrowserRecording() {
    if (!active || active.stopping || active.recorder.state !== 'recording') return
    active.recorder.pause(); active.elapsedMs = elapsed(active); active.resumedAt = null
    publish({ status: 'paused', elapsedMs: active.elapsedMs })
}
export function resumeAssistantBrowserRecording() {
    if (!active || active.stopping || active.recorder.state !== 'paused') return
    active.recorder.resume(); active.resumedAt = performance.now(); publish({ status: 'recording' })
}
export async function startAssistantBrowserRecording(target: DevScopeBrowserGuestTargetInput, size: { width: number; height: number }): Promise<string> {
    if (active) {
        if (active.target.tabId === target.tabId && active.target.guestWebContentsId === target.guestWebContentsId) return active.startedAt
        throw new Error('Another Browser tab is already recording.')
    }
    if (unsavedVideo) throw new Error('Save or discard the previous recording before starting another.')
    if (snapshot.status === 'starting') throw new Error('A recording is already starting.')
    publish({ ...EMPTY, status: 'starting', tabId: target.tabId })
    let recording: ActiveRecording | null = null
    let audio: AudioContext | null = null
    let stream: MediaStream | null = null
    try {
        if (typeof MediaRecorder === 'undefined') throw new Error('Video recording is unavailable.')
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 1600 / Math.max(1,size.width), 1200 / Math.max(1,size.height))
        canvas.width = Math.max(1,Math.round(size.width*scale)); canvas.height = Math.max(1,Math.round(size.height*scale))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Could not create the recording canvas.')
        context.fillStyle = '#101010'; context.fillRect(0,0,canvas.width,canvas.height)
        audio = new AudioContext()
        const destination = audio.createMediaStreamDestination()
        stream = canvas.captureStream(24)
        // A stable audio track allows microphone changes without invalidating MediaRecorder.
        destination.stream.getAudioTracks().forEach(track => stream!.addTrack(track))
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
        if (!mimeType) throw new Error('A supported recording encoder is unavailable.')
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
        const current: ActiveRecording = { target,canvas,context,recorder,stream,audio,destination,mimeType,chunks:[],bytes:0,microphoneStream:null,microphoneSource:null,microphoneRequest:0,startedAt:new Date().toISOString(),elapsedMs:0,resumedAt:null,frameSequence:0,presentedFrameSequence:0,unsubscribe:()=>{},timer:null,stopping:null }
        recording = current; active = current
        current.unsubscribe = window.devscope.onBrowserPreviewRecordingFrame(frame => drawFrame(current, frame))
        recorder.addEventListener('dataavailable', event => {
            if (!event.data.size) return
            current.chunks.push(event.data); current.bytes += event.data.size
            if (current.bytes >= 112*1024*1024 && !current.stopping) void stopAssistantBrowserRecording(target).catch(() => {})
        })
        recorder.addEventListener('error', () => { if (active === current) void stopAssistantBrowserRecording(target).catch(() => {}) })
        await bounded(audio.resume(), 'Could not initialize recording audio.')
        recorder.start(1000)
        const result = await bounded(window.devscope.startBrowserPreviewRecording(target), 'The Browser recorder did not start.')
        if (!result.success) throw new Error(result.error || 'Could not start Browser recording.')
        if (current.stopping || active !== current) throw new Error('The tab closed before recording finished starting.')
        current.startedAt = result.startedAt; current.resumedAt = performance.now()
        current.timer = setInterval(() => { if (active === current && !current.stopping) publish({ elapsedMs: elapsed(current) }) }, 500)
        publish({ status: 'recording' })
        return current.startedAt
    } catch (error) {
        // A concurrent tab close owns settlement; a late start reply must not revive its controls.
        if (recording?.stopping) { await recording.stopping.catch(() => {}); throw error }
        if (recording) { await stopMediaRecorder(recording.recorder).catch(() => {}); clearRecording(recording) }
        else { stream?.getTracks().forEach(track => track.stop()); void audio?.close().catch(() => {}) }
        void window.devscope.stopBrowserPreviewRecording(target).catch(() => {})
        publish({ status: 'error', microphonePending: false, error: error instanceof Error ? error.message : 'Could not start recording.' })
        throw error
    }
}
export function stopAssistantBrowserRecording(target: DevScopeBrowserGuestTargetInput): Promise<DevScopeBrowserCaptureArtifact> {
    const recording = active
    if (!recording || recording.target.tabId !== target.tabId || recording.target.guestWebContentsId !== target.guestWebContentsId) return Promise.reject(new Error('This Browser tab is not recording.'))
    if (recording.stopping) return recording.stopping
    recording.elapsedMs = elapsed(recording); recording.resumedAt = null
    publish({ status: 'stopping', elapsedMs: recording.elapsedMs, microphonePending: false })
    clearMicrophone(recording); recording.microphoneRequest++
    recording.stopping = (async () => {
        try {
            // A closed/disconnected guest can still have a valid grant to save its captured frames.
            await bounded(window.devscope.stopBrowserPreviewRecording(target), 'The Browser recorder did not stop.').catch(() => {})
            await stopMediaRecorder(recording.recorder)
            const blob = new Blob(recording.chunks, { type: recording.mimeType })
            if (!blob.size) throw new Error('No video frames were recorded.')
            unsavedVideo = blob
            const result = await bounded(window.devscope.saveBrowserPreviewRecording({ ...target, mimeType:recording.mimeType, data:new Uint8Array(await blob.arrayBuffer()) }), 'Saving the recording timed out.', 30_000)
            if (!result.success) throw new Error(result.error || 'Could not save Browser recording.')
            unsavedVideo = null
            publish({ status:'saved', artifact:result.artifact, microphone:'off', error:null, unsaved:false })
            return result.artifact
        } catch (error) {
            publish({ status:'error', microphone:'off', unsaved:Boolean(unsavedVideo), error:error instanceof Error ? error.message : 'Could not save recording.' })
            throw error
        } finally { await stopMediaRecorder(recording.recorder).catch(() => {}); clearRecording(recording) }
    })()
    return recording.stopping
}
export function stopActiveAssistantBrowserRecording() {
    return active ? stopAssistantBrowserRecording(active.target) : Promise.reject(new Error('No Browser recording is active.'))
}
