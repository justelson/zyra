import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, Volume2, VolumeX } from 'lucide-react'
import { idleVoiceWidgetState, type VoiceWidgetState } from '@shared/assistant/voice-widget'
import { useInstructorVoiceSession } from './useInstructorVoiceSession'
import { InstructorVoiceOrb } from './InstructorVoiceOrb'
import './AssistantVoiceWidget.css'

function VoiceWidgetCall({ launchState }: { launchState: VoiceWidgetState }) {
    const { callId, launch } = launchState
    const voice = useInstructorVoiceSession(launch ? { conversationId: launch.conversationId, sessionId: launch.sessionId } : undefined)
    const current = useRef(voice)
    current.current = voice
    const began = useRef(false)
    const [commandError, setCommandError] = useState<string | null>(null)
    useEffect(() => {
        if (!launch || began.current) return
        began.current = true
        void voice.start(launch.options)
    }, [launch, voice.start])
    useEffect(() => {
        if (!callId) return
        return window.devscope.voiceWidget!.onCommand(command => {
            if (command.callId !== callId) return
            void (async () => {
                const session = current.current
                if (command.action === 'stop') {
                    const stopped = await session.stop()
                    if (!stopped) return { success: false as const, error: 'Voice could not stop cleanly. The call has not been replaced.' }
                    // Acknowledgement follows remote cleanup and immediate local microphone shutdown.
                } else if (command.action === 'mute') session.toggleMicrophone()
                else if (command.action === 'speaker') session.toggleSpeaker()
                else if (command.action === 'clear') session.clearTranscript()
                else if (command.action === 'send') return await session.sendMessage(command.input || {})
                return { success: true as const }
            })().then(result => window.devscope.voiceWidget!.complete(command.commandId, result))
                .catch(error => window.devscope.voiceWidget!.complete(command.commandId, { success: false, error: error instanceof Error ? error.message : 'Voice command failed.' }))
        })
    }, [callId])
    useEffect(() => {
        if (!callId || !began.current) return
        // start() schedules connecting state; don't publish its initial idle render over a pending launch.
        if (voice.status === 'idle' && !voice.startedAt) return
        void window.devscope.voiceWidget!.publish(callId, {
            status: voice.status, startedAt: voice.startedAt, error: voice.error, realtimeVersion: voice.realtimeVersion,
            activityLevel: voice.activityLevel, microphoneMuted: voice.microphoneMuted, speakerMuted: voice.speakerMuted, transcript: voice.transcript
        })
    }, [callId, voice.status, voice.startedAt, voice.error, voice.realtimeVersion, voice.activityLevel, voice.microphoneMuted, voice.speakerMuted, voice.transcript])
    if (!callId || !launch) return null
    const command = async (action: 'stop' | 'return') => {
        const result = await window.devscope.voiceWidget!.command({ callId, action })
        if (!result.success) setCommandError(result.error)
    }
    return <div className="voice-widget-surface" aria-label={`Voice call: ${launch.title}`}>
        <div className="voice-widget-orb" title="Drag to move Voice">
            <InstructorVoiceOrb voice={launch.options.voice} status={voice.status} activityLevel={voice.activityLevel} compact />
        </div>
        <div className="voice-widget-controls" aria-label="Voice controls">
            <button type="button" onClick={voice.toggleMicrophone} aria-label={voice.microphoneMuted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={voice.microphoneMuted} title={voice.microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}>{voice.microphoneMuted ? <MicOff size={18} /> : <Mic size={18} />}</button>
            <button type="button" className="voice-widget-end" onClick={() => { void command('stop') }} aria-label="End Voice" title="End Voice" disabled={voice.status === 'stopping'}><PhoneOff size={19} /></button>
            <button type="button" onClick={voice.toggleSpeaker} aria-label={voice.speakerMuted ? 'Unmute speaker' : 'Mute speaker'} aria-pressed={voice.speakerMuted} title={voice.speakerMuted ? 'Unmute speaker' : 'Mute speaker'}>{voice.speakerMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        </div>
        <button type="button" className="voice-widget-owner" onClick={() => { void command('return') }} title={`Return to ${launch.title}`}>
            <span>{launch.title}</span><small>{voice.error || commandError || (voice.status === 'active' ? voice.microphoneMuted ? 'Microphone muted' : 'Voice connected' : voice.status === 'stopping' ? 'Ending Voice…' : 'Connecting…')}</small>
        </button>
    </div>
}
export function AssistantVoiceWidget() {
    const [state, setState] = useState(idleVoiceWidgetState)
    useEffect(() => {
        document.documentElement.style.background = 'transparent'
        document.body.style.background = 'transparent'
        const apply = (next: VoiceWidgetState) => setState(current => next.revision >= current.revision ? next : current)
        const unsubscribe = window.devscope.voiceWidget!.onState(apply)
        void window.devscope.voiceWidget!.getState().then(apply)
        return unsubscribe
    }, [])
    return state.callId ? <VoiceWidgetCall key={state.callId} launchState={state} /> : null
}
