import type { DevScopeBrowserCaptureArtifact, DevScopeBrowserGuestTargetInput } from '@shared/contracts/devscope-api'
import { finalizeBrowserRecordingWebm } from '@shared/browser-recording-webm'
import { requestAssistantBrowserDisplayCapture } from './assistant-browser-display-capture'

export type BrowserRecordingSnapshot = {
    status: 'idle' | 'ready' | 'starting' | 'recording' | 'paused' | 'stopping' | 'saved' | 'error'
    tabId: string | null
    guestWebContentsId: number | null
    elapsedMs: number
    microphone: string
    microphonePending: boolean
    audioSource: 'off' | 'tab' | 'system'
    audioPending: boolean
    tabAudioSupported: boolean
    systemAudioSupported: boolean
    error: string | null
    artifact: DevScopeBrowserCaptureArtifact | null
    unsaved: boolean
    captureDestination?: { sessionId: string | null; enabled: boolean }
}
type ActiveRecording = {
    target: DevScopeBrowserGuestTargetInput
    recorder: MediaRecorder | null
    stream: MediaStream
    captureStream: MediaStream | null
    mediaAudioStream: MediaStream | null
    mediaAudioSource: MediaStreamAudioSourceNode | null
    audioRequest: number
    captureRequest: number
    audio: AudioContext
    destination: MediaStreamAudioDestinationNode
    silence: ConstantSourceNode
    microphoneStream: MediaStream | null
    microphoneSource: MediaStreamAudioSourceNode | null
    microphoneRequest: number
    chunks: Blob[]
    bytes: number
    mimeType: string
    startedAt: string
    elapsedMs: number
    resumedAt: number | null
    unsubscribe: () => void
    timer: ReturnType<typeof setInterval> | null
    stopping: Promise<DevScopeBrowserCaptureArtifact> | null
    mediaReleased: boolean
}
const EMPTY: BrowserRecordingSnapshot = { status: 'idle', tabId: null, guestWebContentsId: null, elapsedMs: 0, microphone: 'off', microphonePending: false, audioSource: 'off', audioPending: false, tabAudioSupported: false, systemAudioSupported: false, error: null, artifact: null, unsaved: false, captureDestination: undefined }
let snapshot = EMPTY
let active: ActiveRecording | null = null
let setup: { target: DevScopeBrowserGuestTargetInput; size: { width: number; height: number } } | null = null
let setupStart: Promise<string> | null = null
let unsavedVideo: Blob | null = null
const listeners = new Set<() => void>()
export const readAssistantBrowserRecording = () => snapshot
export const subscribeAssistantBrowserRecording = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(patch: Partial<BrowserRecordingSnapshot>) { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener() }
export function readActiveAssistantBrowserRecordingTarget(): DevScopeBrowserGuestTargetInput | null { return active?.target || null }
export function readActiveAssistantBrowserRecordingTabId(): string | null { return active?.target.tabId || null }
export function dismissAssistantBrowserRecording() { if (!active && !setupStart) { if (unsavedVideo && !window.confirm('Discard the unsaved recording?')) return; setup = null; unsavedVideo = null; snapshot = EMPTY; for (const listener of listeners) listener() } }
/** Opening setup only selects a target. Media/permissions/timers begin on explicit Start. */
export function prepareAssistantBrowserRecording(target: DevScopeBrowserGuestTargetInput, size: { width: number; height: number }, captureDestination?: BrowserRecordingSnapshot['captureDestination']): void {
    if (active || setupStart || snapshot.status === 'starting') throw new Error('Another Browser tab is already recording.')
    if (unsavedVideo) throw new Error('Save or discard the previous recording before starting another.')
    if (snapshot.status === 'ready' && setup?.target.tabId === target.tabId && setup.target.guestWebContentsId === target.guestWebContentsId) return
    const prepared = setup = { target, size }
    const canCapture = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
    publish({ ...EMPTY, captureDestination, status: 'ready', tabId: target.tabId, guestWebContentsId: target.guestWebContentsId,
        tabAudioSupported: canCapture, systemAudioSupported: canCapture && /Windows/i.test(navigator.userAgent || '') })
    // Runtime metadata is read-only; a late reply cannot revive dismissed setup.
    void window.devscope.window?.getRuntimeInfo().then(runtime => {
        if (setup === prepared && snapshot.status === 'ready') publish({ systemAudioSupported: canCapture && runtime.platform === 'win32' })
    }).catch(() => {})
}
export function startPreparedAssistantBrowserRecording(): Promise<string> {
    if (setupStart) return setupStart
    if (!setup || snapshot.status !== 'ready') return Promise.reject(new Error('Choose a Browser tab before starting a recording.'))
    const prepared = setup
    setupStart = startAssistantBrowserRecording(prepared.target, prepared.size).finally(() => { setupStart = null })
    return setupStart
}
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
function stopMediaRecorder(recorder: MediaRecorder | null): Promise<void> {
    if (!recorder || recorder.state === 'inactive') return Promise.resolve()
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
    recording.microphoneRequest++; recording.audioRequest++; recording.captureRequest++
    recording.unsubscribe(); if (recording.timer) clearInterval(recording.timer)
    releaseRecordingMedia(recording)
    if (active === recording) active = null
}
function releaseRecordingMedia(recording: ActiveRecording) {
    if (recording.mediaReleased) return
    recording.mediaReleased = true
    clearMicrophone(recording); clearMediaAudio(recording)
    recording.silence.stop(); recording.silence.disconnect()
    recording.captureStream?.getTracks().forEach(track => track.stop())
    recording.stream.getTracks().forEach(track => track.stop())
    void recording.audio.close().catch(() => {})
}
function clearMediaAudio(recording: ActiveRecording) {
    recording.mediaAudioSource?.disconnect()
    recording.mediaAudioStream?.getTracks().forEach(track => track.stop())
    recording.mediaAudioSource = null; recording.mediaAudioStream = null
}
async function captureDisplay(recording: ActiveRecording, withAudio: boolean, prepare: () => Promise<void>): Promise<MediaStream> {
    const request = ++recording.captureRequest
    const pending = requestAssistantBrowserDisplayCapture(async () => {
        const assertCurrent = () => {
            if (active !== recording || recording.stopping || request !== recording.captureRequest) throw new Error('The tab closed before recording finished starting.')
        }
        assertCurrent()
        await prepare()
        assertCurrent()
    }, {
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    })
    void pending.then(stream => {
        if (active !== recording || recording.stopping || request !== recording.captureRequest) stream.getTracks().forEach(track => track.stop())
    }).catch(() => {})
    try { return await bounded(pending, 'The Browser capture did not start. Try recording again.') }
    catch (error) { if (request === recording.captureRequest) recording.captureRequest++; throw error }
}
async function waitForFirstVideoFrame(stream: MediaStream): Promise<void> {
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.srcObject = stream
    try {
        await bounded(new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve()
            video.onerror = () => reject(new Error('The Browser video stream could not be read.'))
            void video.play().catch(reject)
        }), 'The Browser did not provide a video frame. Open the tab and try recording again.', 10_000)
    } finally { video.pause(); video.srcObject = null; video.onloadeddata = null; video.onerror = null }
}
export async function setAssistantBrowserRecordingAudioSource(source: 'off' | 'tab' | 'system'): Promise<void> {
    if (snapshot.status === 'ready' && setup) {
        if (source === 'system' && !snapshot.systemAudioSupported) { publish({ error: 'System audio is unavailable on this device. Choose tab audio.' }); return }
        publish({ audioSource: source, error: null }); return
    }
    const recording = active
    if (!recording || recording.stopping) return
    const request = ++recording.audioRequest
    clearMediaAudio(recording)
    publish({ audioSource: 'off', audioPending: source !== 'off', error: null })
    if (source === 'off') { recording.captureRequest++; return }
    try {
        if (source === 'system' && !snapshot.systemAudioSupported) throw new Error('System audio is unavailable on this device. Choose tab audio.')
        const stream = await captureDisplay(recording, true, async () => {
            if (request !== recording.audioRequest) throw new Error('Recording audio selection changed.')
            const ready = await bounded(window.devscope.prepareBrowserPreviewRecordingAudio({ ...recording.target, source }), 'Recording audio did not become ready.')
            if (!ready.success) throw new Error(ready.error || 'Could not prepare recording audio.')
        })
        if (active !== recording || recording.stopping || request !== recording.audioRequest) { stream.getTracks().forEach(track => track.stop()); return }
        // getDisplayMedia requires video; keep only its audio. The original native
        // video track and stable mixed audio track never change under MediaRecorder.
        stream.getVideoTracks().forEach(track => { stream.removeTrack(track); track.stop() })
        if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('This device did not provide recording audio. Video recording continues.') }
        recording.mediaAudioStream = stream
        recording.mediaAudioSource = recording.audio.createMediaStreamSource(stream)
        recording.mediaAudioSource.connect(recording.destination)
        stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
            if (active !== recording || recording.mediaAudioStream !== stream) return
            clearMediaAudio(recording); publish({ audioSource: 'off', audioPending: false, error: 'Recording audio disconnected. Video recording continues.' })
        }, { once: true }))
        publish({ audioSource: source, audioPending: false })
    } catch (error) {
        if (active !== recording || recording.stopping || request !== recording.audioRequest) return
        clearMediaAudio(recording)
        publish({ audioSource: 'off', audioPending: false, error: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Audio access was denied. Video recording continues.' : error instanceof Error ? error.message : 'Could not capture recording audio.' })
    }
}
export async function setAssistantBrowserRecordingMicrophone(deviceId: string): Promise<void> {
    if (snapshot.status === 'ready' && setup) { publish({ microphone: deviceId, error: null }); return }
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
    if (!active || active.stopping || active.recorder?.state !== 'recording') return
    active.recorder.pause(); active.elapsedMs = elapsed(active); active.resumedAt = null
    publish({ status: 'paused', elapsedMs: active.elapsedMs })
}
export function resumeAssistantBrowserRecording() {
    if (!active || active.stopping || active.recorder?.state !== 'paused') return
    active.recorder.resume(); active.resumedAt = performance.now(); publish({ status: 'recording' })
}
export async function startAssistantBrowserRecording(target: DevScopeBrowserGuestTargetInput, _size: { width: number; height: number }): Promise<string> {
    if (active) {
        if (active.target.tabId === target.tabId && active.target.guestWebContentsId === target.guestWebContentsId) return active.startedAt
        throw new Error('Another Browser tab is already recording.')
    }
    if (unsavedVideo) throw new Error('Save or discard the previous recording before starting another.')
    if (snapshot.status === 'starting') throw new Error('A recording is already starting.')
    const selected = snapshot.status === 'ready' && setup?.target.tabId === target.tabId && setup.target.guestWebContentsId === target.guestWebContentsId
        ? { microphone: snapshot.microphone, audioSource: snapshot.audioSource, captureDestination: snapshot.captureDestination } : { microphone: 'off', audioSource: 'off' as const }
    setup = null
    publish({ ...EMPTY, ...selected, status: 'starting', tabId: target.tabId, guestWebContentsId: target.guestWebContentsId })
    let recording: ActiveRecording | null = null
    let audio: AudioContext | null = null
    let stream: MediaStream | null = null
    try {
        if (typeof MediaRecorder === 'undefined') throw new Error('Video recording is unavailable.')
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Native tab recording is unavailable in this window.')
        audio = new AudioContext()
        const destination = audio.createMediaStreamDestination()
        // Keep the audio clock running even with every audio input off. An
        // unconnected destination may never emit its first sample, starving muxing.
        const silence = audio.createConstantSource()
        silence.offset.value = 0; silence.connect(destination); silence.start()
        stream = new MediaStream(destination.stream.getAudioTracks())
        // VP8 avoids the much heavier software VP9 encoder on everyday machines.
        const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
        if (!mimeType) throw new Error('A supported recording encoder is unavailable.')
        const current: ActiveRecording = {
            target, recorder: null, stream, audio, destination, silence, mimeType, chunks: [], bytes: 0,
            captureStream: null, mediaAudioStream: null, mediaAudioSource: null, audioRequest: 0, captureRequest: 0,
            microphoneStream: null, microphoneSource: null, microphoneRequest: 0,
            startedAt: new Date().toISOString(), elapsedMs: 0, resumedAt: null, unsubscribe: () => {}, timer: null, stopping: null, mediaReleased: false
        }
        recording = current; active = current
        current.unsubscribe = window.devscope.onBrowserPreviewRecordingFrame(frame => {
            if (frame.ended && frame.tabId === target.tabId && active === current) void stopAssistantBrowserRecording(target).catch(() => {})
        })
        await bounded(audio.resume(), 'Could not initialize recording audio.')
        let startedAt = current.startedAt
        const captured = await captureDisplay(current, false, async () => {
            const result = await bounded(window.devscope.startBrowserPreviewRecording(target), 'The Browser recorder did not start.')
            if (!result.success) throw new Error(result.error || 'Could not start Browser recording.')
            if (current.stopping || active !== current) throw new Error('The tab closed before recording finished starting.')
            startedAt = result.startedAt
            publish({ tabAudioSupported: result.tabAudioSupported, systemAudioSupported: result.systemAudioSupported })
        })
        if (current.stopping || active !== current) { captured.getTracks().forEach(track => track.stop()); throw new Error('The tab closed before recording finished starting.') }
        current.captureStream = captured
        const video = captured.getVideoTracks()[0]
        if (!video) throw new Error('The Browser did not provide a video stream.')
        await waitForFirstVideoFrame(captured)
        if (current.stopping || active !== current) throw new Error('The tab closed before recording finished starting.')
        stream.addTrack(video)
        video.addEventListener('ended', () => { if (active === current) void stopAssistantBrowserRecording(target).catch(() => {}) }, { once: true })
        // Setup choices become real inputs only after Start, before the encoded
        // timeline begins. Denied input access keeps video available and visible.
        const inputErrors: string[] = []
        if (selected.audioSource !== 'off') {
            await setAssistantBrowserRecordingAudioSource(selected.audioSource)
            if (snapshot.error) inputErrors.push(snapshot.error)
        }
        if (selected.microphone !== 'off' && !current.stopping && active === current) {
            await setAssistantBrowserRecordingMicrophone(selected.microphone)
            if (snapshot.error) inputErrors.push(snapshot.error)
        }
        if (current.stopping || active !== current) throw new Error('The tab closed before recording finished starting.')
        if (inputErrors.length) publish({ error: [...new Set(inputErrors)].join(' ') })
        // Native composited frames go directly to the encoder, without JPEG/base64
        // IPC, main-thread image decoding or duplicate canvas frames.
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
        current.recorder = recorder
        recorder.addEventListener('dataavailable', event => {
            if (!event.data.size) return
            current.chunks.push(event.data); current.bytes += event.data.size
            if (current.bytes >= 112 * 1024 * 1024 && !current.stopping) void stopAssistantBrowserRecording(target).catch(() => {})
        })
        recorder.addEventListener('error', () => { if (active === current) void stopAssistantBrowserRecording(target).catch(() => {}) })
        const encoding = new Promise<void>((resolve, reject) => {
            const onData = (event: BlobEvent) => { if (event.data.size > 4) { recorder.removeEventListener('dataavailable', onData); resolve() } }
            recorder.addEventListener('dataavailable', onData)
            recorder.addEventListener('error', () => reject(new Error('The Browser video encoder could not start.')), { once: true })
            recorder.addEventListener('stop', () => reject(new Error('The tab closed before recording finished starting.')), { once: true })
        })
        current.startedAt = startedAt; current.resumedAt = performance.now()
        recorder.start(250)
        // Chromium can expose a live stream before its encoder emits video. Keep
        // starting bounded so an immediate Stop cannot silently discard the clip.
        await bounded(encoding, 'The Browser video encoder did not produce frames. Try recording again.', 10_000)
        if (current.stopping || active !== current) throw new Error('The tab closed before recording finished starting.')
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
    publish({ status: 'stopping', elapsedMs: recording.elapsedMs, microphonePending: false, audioPending: false })
    clearMicrophone(recording); clearMediaAudio(recording); recording.microphoneRequest++; recording.audioRequest++; recording.captureRequest++
    recording.stopping = (async () => {
        try {
            // A closed/disconnected guest can still have a valid grant to save its captured frames.
            const stopped = bounded(window.devscope.stopBrowserPreviewRecording(target), 'The Browser recorder did not stop.').catch(() => {})
            await stopMediaRecorder(recording.recorder)
            releaseRecordingMedia(recording)
            await stopped
            const blob = new Blob(recording.chunks, { type: recording.mimeType })
            if (!blob.size) throw new Error('No video frames were recorded.')
            unsavedVideo = blob
            const original = new Uint8Array(await blob.arrayBuffer())
            const data = recording.mimeType.startsWith('video/webm') ? finalizeBrowserRecordingWebm(original, recording.elapsedMs) : original
            if (data !== original) unsavedVideo = new Blob([data as Uint8Array<ArrayBuffer>], { type: recording.mimeType })
            const result = await bounded(window.devscope.saveBrowserPreviewRecording({ ...target, mimeType:recording.mimeType, data }), 'Saving the recording timed out.', 30_000)
            if (!result.success) throw new Error(result.error || 'Could not save Browser recording.')
            unsavedVideo = null
            publish({ status:'saved', artifact:result.artifact, microphone:'off', audioSource:'off', error:null, unsaved:false })
            return result.artifact
        } catch (error) {
            publish({ status:'error', microphone:'off', audioSource:'off', unsaved:Boolean(unsavedVideo), error:error instanceof Error ? error.message : 'Could not save recording.' })
            throw error
        } finally { await stopMediaRecorder(recording.recorder).catch(() => {}); clearRecording(recording) }
    })()
    return recording.stopping
}
export function stopActiveAssistantBrowserRecording() {
    return active ? stopAssistantBrowserRecording(active.target) : Promise.reject(new Error('No Browser recording is active.'))
}
