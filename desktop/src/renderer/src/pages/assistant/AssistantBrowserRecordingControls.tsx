import { useEffect, useState, useSyncExternalStore } from 'react'
import { Circle, Download, Loader2, Mic, MicOff, Pause, Play, Square, Video, X } from 'lucide-react'
import type { DevScopeBrowserCaptureArtifact } from '@shared/contracts/devscope-api'
import {
    dismissAssistantBrowserRecording, downloadUnsavedAssistantBrowserRecording, pauseAssistantBrowserRecording, readAssistantBrowserRecording,
    resumeAssistantBrowserRecording, setAssistantBrowserRecordingMicrophone, stopActiveAssistantBrowserRecording,
    subscribeAssistantBrowserRecording
} from './assistant-browser-recording'

const buttonClass = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'
export function AssistantBrowserRecordingControls({ tabTitle, onShowTab, onSaved, onError }: {
    tabTitle?: string
    onShowTab?: () => void
    onSaved: (artifact: DevScopeBrowserCaptureArtifact) => void
    onError: (message: string) => void
}) {
    const state = useSyncExternalStore(subscribeAssistantBrowserRecording, readAssistantBrowserRecording)
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
    useEffect(() => {
        if (state.status === 'idle' || !navigator.mediaDevices) return
        let disposed = false
        const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(all => { if (!disposed) setDevices(all.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')) }).catch(() => {}) }
        refresh(); navigator.mediaDevices.addEventListener('devicechange', refresh)
        return () => { disposed = true; navigator.mediaDevices.removeEventListener('devicechange', refresh) }
    }, [state.status === 'idle', state.microphone])
    if (state.status === 'idle') return null
    const busy = state.status === 'starting' || state.status === 'stopping'
    const live = state.status === 'recording' || state.status === 'paused'
    const seconds = Math.floor(state.elapsedMs / 1000)
    const duration = `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`
    const label = state.status === 'starting' ? 'Starting recording' : state.status === 'stopping' ? 'Saving recording' : state.status === 'paused' ? 'Paused' : state.status === 'saved' ? 'Recording saved' : state.status === 'error' ? 'Recording stopped' : tabTitle || 'Recording tab'
    return (
        // Reserve this small strip above the native page: controls stay clickable, the page stays live,
        // and the recorder controls are never captured into the video.
        <div className="relative z-30 shrink-0 px-2 py-1.5" data-browser-recording-controls={state.status}>
            <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-lg border border-[var(--surface-border)] bg-[var(--color-bg-secondary)] px-2 py-1 shadow-sm" role="toolbar" aria-label="Tab recording controls">
                {busy ? <Loader2 size={12} className="mr-1 motion-safe:animate-spin" /> : <Circle size={8} fill="currentColor" className={state.status === 'recording' ? 'mr-1 text-red-400' : 'mr-1 text-sparkle-text-muted'} />}
                <button type="button" disabled={!onShowTab} onClick={onShowTab} className="max-w-36 truncate text-[11px] text-sparkle-text-secondary disabled:cursor-default" title={label}>{label}</button>
                <span className="px-2 font-mono text-[11px] tabular-nums text-sparkle-text" aria-label={`Recorded duration ${duration}`}>{duration}</span>
                {live ? <>
                    <span className="mx-1 h-4 w-px bg-[var(--surface-divider)]" />
                    <button type="button" className={buttonClass} title={state.status === 'paused' ? 'Resume recording' : 'Pause recording'} aria-label={state.status === 'paused' ? 'Resume recording' : 'Pause recording'} onClick={state.status === 'paused' ? resumeAssistantBrowserRecording : pauseAssistantBrowserRecording}>{state.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}</button>
                    <button type="button" className={buttonClass} title="Stop and save recording" aria-label="Stop and save recording" onClick={() => void stopActiveAssistantBrowserRecording().then(onSaved).catch(error => onError(error instanceof Error ? error.message : 'Could not save recording.'))}><Square size={11} fill="currentColor" /></button>
                    <span className="mx-1 h-4 w-px bg-[var(--surface-divider)]" />
                    {state.microphonePending ? <Loader2 size={12} className="motion-safe:animate-spin" /> : state.microphone === 'off' ? <MicOff size={12} className="text-sparkle-text-muted" /> : <Mic size={12} className="text-[var(--accent-primary)]" />}
                    <select aria-label="Recording microphone" title={state.microphonePending ? 'Opening microphone; choose Mic off to cancel' : 'Recording microphone'} value={state.microphonePending ? 'pending' : state.microphone} onChange={event => void setAssistantBrowserRecordingMicrophone(event.target.value)} className="h-7 max-w-32 cursor-pointer rounded-md border-0 bg-transparent px-1 text-[11px] text-sparkle-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]">
                        <option value="off">Mic off</option>{state.microphonePending ? <option value="pending" disabled>Opening microphone…</option> : null}<option value="">Default microphone</option>
                        {devices.map((device,index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index+1}`}</option>)}
                    </select>
                </> : null}
                {state.unsaved ? <button type="button" className={buttonClass} onClick={downloadUnsavedAssistantBrowserRecording} aria-label="Save video copy" title="Save video copy"><Download size={14} /></button> : null}
                {state.artifact ? <button type="button" className={buttonClass} onClick={() => onSaved(state.artifact!)} title="View recording" aria-label="View recording"><Video size={14} /></button> : null}
                {!busy && !live ? <button type="button" className={buttonClass} onClick={dismissAssistantBrowserRecording} aria-label="Dismiss recording controls"><X size={13} /></button> : null}
            </div>
            {state.error ? <p role="alert" className="mx-auto mt-1 max-w-xl text-center text-[11px] text-[var(--status-warning)]">{state.error}</p> : null}
        </div>
    )
}
