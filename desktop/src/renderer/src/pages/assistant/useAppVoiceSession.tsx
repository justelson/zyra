import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssistantSendRealtimeVoiceMessageInput } from '@shared/assistant/contracts'
import { idleVoiceWidgetState, type VoiceWidgetLaunch, type VoiceWidgetState } from '@shared/assistant/voice-widget'
import { useInstructorVoiceSession } from './useInstructorVoiceSession'

type Voice = ReturnType<typeof useInstructorVoiceSession>
type StartResult = { success: boolean; error?: string; disposition?: 'started' | 'existing' | 'handoff-required'; state?: VoiceWidgetState }
type BrowserOwner = { voice: Voice; state: VoiceWidgetState; open(launch: VoiceWidgetLaunch, expectedCallId?: string): Promise<StartResult> }
const BrowserVoice = createContext<BrowserOwner | null>(null)
function BrowserVoiceProvider({ children }: { children: ReactNode }) {
    const [launchState, setLaunchState] = useState<{ callId: string; launch: VoiceWidgetLaunch } | null>(null)
    const voice = useInstructorVoiceSession(launchState ? { conversationId: launchState.launch.conversationId, sessionId: launchState.launch.sessionId } : undefined)
    const voiceRef = useRef(voice), startedRef = useRef<string | null>(null)
    voiceRef.current = voice
    const state: VoiceWidgetState = { ...idleVoiceWidgetState(), ...launchState, status: launchState && startedRef.current !== launchState.callId ? 'connecting' : voice.status, startedAt: voice.startedAt, transcript: voice.transcript, error: voice.error, microphoneMuted: voice.microphoneMuted, speakerMuted: voice.speakerMuted, realtimeVersion: voice.realtimeVersion, activityLevel: voice.activityLevel }
    const stateRef = useRef(state)
    stateRef.current = state
    useEffect(() => {
        if (!launchState || startedRef.current === launchState.callId) return
        startedRef.current = launchState.callId
        void voice.start(launchState.launch.options)
    }, [launchState, voice.start])
    const open = useCallback(async (launch: VoiceWidgetLaunch, expectedCallId?: string): Promise<StartResult> => {
        const current = stateRef.current
        if (current.callId && current.status !== 'idle' && current.status !== 'error') {
            if (current.launch?.conversationId === launch.conversationId) return { success: true, disposition: 'existing', state: current }
            if (current.callId !== expectedCallId) return { success: true, disposition: 'handoff-required', state: current }
            if (!await voiceRef.current.stop()) return { success: false, error: 'Voice could not end the previous call.' }
        } else if (expectedCallId && expectedCallId !== current.callId) return { success: false, error: 'The active call changed. Start Voice again.' }
        setLaunchState({ launch, callId: crypto.randomUUID() })
        return { success: true, disposition: 'started' }
    }, [])
    return <BrowserVoice.Provider value={{ voice, state, open }}>{children}</BrowserVoice.Provider>
}
/** Browser fallback owns audio at application lifetime, never at the selected conversation. */
export function AssistantVoiceProvider({ children }: { children: ReactNode }) {
    return window.devscope.voiceWidget ? children : <BrowserVoiceProvider>{children}</BrowserVoiceProvider>
}
export function useAppVoiceSession(binding?: { conversationId: string; sessionId: string }, title = 'Voice chat') {
    const browser = useContext(BrowserVoice)
    const [nativeState, setNativeState] = useState(idleVoiceWidgetState)
    const [localError, setLocalError] = useState<string | null>(null)
    const [handoff, setHandoff] = useState<{ launch: VoiceWidgetLaunch; previous: VoiceWidgetState } | null>(null)
    const api = window.devscope.voiceWidget
    const bindingKey = `${binding?.sessionId || ''}:${binding?.conversationId || ''}`
    const bindingKeyRef = useRef(bindingKey)
    bindingKeyRef.current = bindingKey
    useEffect(() => { setLocalError(null); setHandoff(null) }, [bindingKey])
    useEffect(() => {
        if (!api) return
        let mounted = true
        const apply = (next: VoiceWidgetState) => { if (mounted) setNativeState(current => next.revision >= current.revision ? next : current) }
        const off = api.onState(apply)
        void api.getState().then(apply).catch(() => undefined)
        return () => { mounted = false; off() }
    }, [api])
    const state = browser?.state || nativeState
    const own = Boolean(binding && state.launch?.conversationId === binding.conversationId && state.launch.sessionId === binding.sessionId)
    const requestStart = useCallback(async (launch: VoiceWidgetLaunch, expectedCallId?: string) => {
        setLocalError(null)
        const requestedBinding = bindingKeyRef.current
        try {
            const result = api ? await api.open(launch, expectedCallId) : await browser?.open(launch, expectedCallId)
            if (bindingKeyRef.current !== requestedBinding) return
            if (!result?.success) { setLocalError(result?.error || 'Voice is unavailable.'); return }
            if (result.disposition === 'handoff-required' && result.state) setHandoff({ launch, previous: result.state })
            else setHandoff(null)
        } catch (error) { if (bindingKeyRef.current === requestedBinding) setLocalError(error instanceof Error ? error.message : 'Voice could not start.') }
    }, [api, browser])
    const start = useCallback(async (options: VoiceWidgetLaunch['options']) => {
        if (!binding) { setLocalError('Select a chat before starting Voice.'); return }
        await requestStart({ ...binding, title, options })
    }, [binding, title, requestStart])
    const command = useCallback(async (action: 'stop' | 'mute' | 'speaker' | 'clear' | 'send', input?: AssistantSendRealtimeVoiceMessageInput) => {
        if (!own || !state.callId) return { success: false as const, error: 'This chat has no active Voice call.' }
        if (api) return api.command({ callId: state.callId, action, input })
        if (!browser) return { success: false as const, error: 'Voice is unavailable.' }
        if (action === 'stop') return await browser.voice.stop() ? { success: true as const } : { success: false as const, error: 'Voice did not end cleanly.' }
        if (action === 'mute') browser.voice.toggleMicrophone()
        if (action === 'speaker') browser.voice.toggleSpeaker()
        if (action === 'clear') browser.voice.clearTranscript()
        if (action === 'send') return browser.voice.sendMessage(input || {})
        return { success: true as const }
    }, [api, browser, own, state.callId])
    return {
        status: own ? state.status : localError ? 'error' as const : 'idle' as const,
        startedAt: own ? state.startedAt : null, error: localError || (own ? state.error : null),
        transcript: own ? state.transcript : [], realtimeVersion: own ? state.realtimeVersion : null,
        activityLevel: own ? state.activityLevel : 0, microphoneMuted: own && state.microphoneMuted, speakerMuted: own && state.speakerMuted,
        start, stop: async () => (await command('stop')).success,
        toggleMicrophone: () => { void command('mute') }, toggleSpeaker: () => { void command('speaker') },
        clearTranscript: () => { void command('clear') }, sendMessage: (input: AssistantSendRealtimeVoiceMessageInput) => command('send', input),
        handoff, cancelHandoff: () => setHandoff(null),
        confirmHandoff: async () => { if (handoff?.previous.callId) await requestStart(handoff.launch, handoff.previous.callId) },
        returnToCall: async () => {
            if (handoff?.previous.callId && api) await api.command({ callId: handoff.previous.callId, action: 'return' })
            else if (handoff?.previous.launch) await window.devscope.assistant.selectSession(handoff.previous.launch.sessionId)
            setHandoff(null)
        }
    }
}
