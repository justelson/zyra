import { APPEARANCE_FONT_FACES_CHANGED_EVENT, getAppearanceFontResource } from '@/lib/appearance-font-faces'
import { useSettings } from '@/lib/settings'
import { NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Download, MessageSquarePlus, Pause, Play, Square, Video, X } from 'lucide-react'
import type { BrowserRecordingOverlayCommand, BrowserRecordingOverlayPresentation, BrowserRecordingOverlayState } from '@shared/contracts/browser-recording-overlay'
import { ZYRA_THEME_CHANGED_EVENT } from '@/lib/theme-events'
import {
    dismissAssistantBrowserRecording, downloadUnsavedAssistantBrowserRecording, pauseAssistantBrowserRecording,
    readAssistantBrowserRecording, resumeAssistantBrowserRecording, setAssistantBrowserRecordingAudioSource,
    setAssistantBrowserRecordingMicrophone, startPreparedAssistantBrowserRecording, stopActiveAssistantBrowserRecording, subscribeAssistantBrowserRecording
} from './assistant-browser-recording'

function readTheme(): BrowserRecordingOverlayState['theme'] {
    const style = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
    return {
        background: token('--surface-floating', token('--color-card', '#252525')), foreground: token('--color-text', '#eeeeee'),
        muted: token('--color-text-secondary', '#aaaaaa'), accent: token('--accent-primary', '#ee9944'),
        border: token('--surface-divider', token('--color-border', '#ffffff1a')), dark: style.colorScheme !== 'light',
        fontFamily: style.fontFamily, fontCss: getAppearanceFontResource(document, style.fontFamily)?.css || ''
    }
}

/** One host per renderer: recording survives workspace navigation and tab transfers. */
export function AssistantBrowserRecordingHost() {
    const { settings } = useSettings()
    const state = useSyncExternalStore(subscribeAssistantBrowserRecording, readAssistantBrowserRecording)
    const attachingRef = useRef(false)
    const sentFontCss = useRef<string | undefined>(undefined)
    const stateRef = useRef(state)
    stateRef.current = state
    const [devices, setDevices] = useState<BrowserRecordingOverlayState['microphones']>([])
    const [theme, setTheme] = useState<BrowserRecordingOverlayState['theme'] | null>(null)
    const [presentation, setPresentation] = useState<BrowserRecordingOverlayPresentation | null>(null)
    const [bridgeError, setBridgeError] = useState<string | null>(null)
    const active = state.status !== 'idle'
    const canAttach = Boolean(state.captureDestination?.enabled && (state.captureDestination.sessionId || settings.assistantBrowserStandaloneAiTools !== false))
    const native = typeof window.devscope?.setBrowserRecordingOverlay === 'function'
    const refreshRequest = useRef(0)
    const refreshDevices = useCallback(async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const request = ++refreshRequest.current
        try {
            const all = await navigator.mediaDevices.enumerateDevices()
            if (request !== refreshRequest.current) return
            setDevices(all.filter(device => device.kind === 'audioinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId))
                .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` })))
        } catch {
            // Labels can stay private until the user enables the default microphone.
            if (request === refreshRequest.current) setDevices([])
        }
    }, [])
    useEffect(() => {
        if (!active) return
        void refreshDevices()
        navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
        return () => { refreshRequest.current++; navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices) }
    }, [active, state.microphone, refreshDevices])
    useEffect(() => {
        if (!active) return
        const refresh = () => setTheme(readTheme())
        refresh()
        window.addEventListener(ZYRA_THEME_CHANGED_EVENT, refresh)
        window.addEventListener(APPEARANCE_FONT_FACES_CHANGED_EVENT, refresh)
        return () => { window.removeEventListener(ZYRA_THEME_CHANGED_EVENT, refresh); window.removeEventListener(APPEARANCE_FONT_FACES_CHANGED_EVENT, refresh) }
    }, [active])
    const command = useCallback(async (action: BrowserRecordingOverlayCommand) => {
        try {
            switch (action.kind) {
                case 'start': await startPreparedAssistantBrowserRecording(); await refreshDevices(); break
                case 'pause': pauseAssistantBrowserRecording(); break
                case 'resume': resumeAssistantBrowserRecording(); break
                case 'stop': await stopActiveAssistantBrowserRecording(); break
                case 'microphone': await setAssistantBrowserRecordingMicrophone(action.deviceId); await refreshDevices(); break
                case 'audio': await setAssistantBrowserRecordingAudioSource(action.source); break
                case 'refresh-devices': await refreshDevices(); break
                case 'save-copy': downloadUnsavedAssistantBrowserRecording(); break
                case 'dismiss': dismissAssistantBrowserRecording(); setBridgeError(null); break
                case 'attach-chat': {
                    const current = stateRef.current
                    if (!current.artifact || !current.captureDestination?.enabled || !canAttach || attachingRef.current) break
                    attachingRef.current = true
                    try {
                        const result = await window.devscope.attachBrowserCaptureToChat({ artifactId: current.artifact.artifactId, sessionId: current.captureDestination.sessionId })
                        if (!result.success) throw new Error(result.error || 'Could not attach recording.')
                        dismissAssistantBrowserRecording()
                    } finally { attachingRef.current = false }
                    break
                }
                case 'show-artifact': {
                    const artifact = stateRef.current.artifact
                    if (artifact) {
                        const result = await window.devscope.openBrowserPreviewArtifact(artifact.artifactId)
                        if (!result.success) throw new Error(result.error || 'Could not open recording.')
                    }
                    break
                }
            }
        } catch (error) {
            // Encoder/save errors already live in the store and its overlay.
            if (!readAssistantBrowserRecording().error) setBridgeError(error instanceof Error ? error.message : 'Recording action failed.')
        }
    }, [canAttach, refreshDevices])
    useEffect(() => {
        if (!native || !active) return
        const unsubscribeCommand = window.devscope.onBrowserRecordingOverlayCommand(action => { void command(action) })
        const unsubscribePresentation = window.devscope.onBrowserRecordingOverlayPresentation(setPresentation)
        return () => {
            unsubscribeCommand(); unsubscribePresentation()
            sentFontCss.current = undefined
            void window.devscope.setBrowserRecordingOverlay(null).catch(() => {})
            setPresentation(null)
        }
    }, [native, active, command])
    useEffect(() => {
        if (!native || !active || !theme || !state.tabId || !state.guestWebContentsId) return
        let disposed = false
        const fontCss = sentFontCss.current === theme.fontCss ? undefined : theme.fontCss
        sentFontCss.current = theme.fontCss
        void window.devscope.setBrowserRecordingOverlay({
            target: { tabId: state.tabId, guestWebContentsId: state.guestWebContentsId }, status: state.status as BrowserRecordingOverlayState['status'],
            title: 'Recording tab', elapsedMs: state.elapsedMs, microphone: state.microphone, microphonePending: state.microphonePending,
            microphones: devices, audioSource: state.audioSource, audioPending: state.audioPending,
            tabAudioSupported: state.tabAudioSupported, systemAudioSupported: state.systemAudioSupported,
            error: state.error, unsaved: state.unsaved, hasArtifact: Boolean(state.artifact), canAttachToChat: canAttach, theme: { ...theme, fontCss }
        }).then(result => { if (!disposed && !result.success) setBridgeError(result.error || 'Recording controls could not open.') })
            .catch(error => { if (!disposed) setBridgeError(error instanceof Error ? error.message : 'Recording controls could not open.') })
        return () => { disposed = true }
    }, [native, active, canAttach, state, devices, theme])
    useEffect(() => { setBridgeError(null); setPresentation(null) }, [state.tabId, state.guestWebContentsId])
    useEffect(() => {
        if (state.status === 'ready' && presentation?.targetGone
            && presentation.target.tabId === state.tabId && presentation.target.guestWebContentsId === state.guestWebContentsId) {
            dismissAssistantBrowserRecording()
        }
    }, [state.status, state.tabId, state.guestWebContentsId, presentation])

    // Closed-tab recovery stays reachable in the app. Normal recording consumes no layout space.
    const matchingPresentation = presentation?.target.guestWebContentsId === state.guestWebContentsId
        && presentation.target.tabId === state.tabId ? presentation : null
    if (!active || (native && !bridgeError && !matchingPresentation?.targetGone && !matchingPresentation?.error)) return null
    const live = state.status === 'recording' || state.status === 'paused'
    const busy = state.status === 'starting' || state.status === 'stopping'
    const seconds = Math.floor(state.elapsedMs / 1000)
    const duration = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
    const label = state.status === 'ready' ? 'Ready to record' : state.status === 'stopping' ? 'Saving recording…' : state.status === 'starting' ? 'Starting recording…' : state.status === 'saved' ? 'Recording saved' : 'Browser recording'
    const buttonClass = 'inline-flex size-8 items-center justify-center rounded-md hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'
    return <NativeOverlayPortal><div data-browser-recording-recovery className="fixed right-3 top-12 z-[500] max-w-sm rounded-xl border border-[var(--surface-divider)] bg-[var(--color-bg-secondary)] p-3 text-xs text-sparkle-text shadow-lg">
        <div className="flex items-center gap-2" role="toolbar" aria-label="Recording recovery">
            <span className="mr-auto">{label} {state.status !== 'ready' ? <span className="ml-2 tabular-nums">{duration}</span> : null}</span>
            {state.status === 'ready' ? <button className={buttonClass} title="Start recording" onClick={() => void command({ kind: 'start' })}><Play size={13} /></button> : null}
            {live ? <><button className={buttonClass} title={state.status === 'paused' ? 'Resume recording' : 'Pause recording'} onClick={() => void command({ kind: state.status === 'paused' ? 'resume' : 'pause' })}>{state.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}</button><button className={buttonClass} title="Stop and save recording" onClick={() => void command({ kind: 'stop' })}><Square size={12} /></button></> : null}
            {state.unsaved ? <button className={buttonClass} title="Save video copy" onClick={() => void command({ kind: 'save-copy' })}><Download size={14} /></button> : null}
            {state.artifact && canAttach ? <button className={buttonClass} title="Attach to chat" onClick={() => void command({ kind: 'attach-chat' })}><MessageSquarePlus size={14} /></button> : null}
            {state.artifact ? <button className={buttonClass} title="View recording" onClick={() => void command({ kind: 'show-artifact' })}><Video size={14} /></button> : null}
            {!busy && !live ? <button className={buttonClass} title="Dismiss recording controls" onClick={() => void command({ kind: 'dismiss' })}><X size={14} /></button> : null}
        </div>
        {state.error || bridgeError || matchingPresentation?.error ? <p role="alert" className="mt-2 text-sparkle-text-secondary">{state.error || bridgeError || matchingPresentation?.error}</p> : null}
    </div></NativeOverlayPortal>
}
