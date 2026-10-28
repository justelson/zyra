import type { AssistantSendRealtimeVoiceMessageInput, AssistantVoiceExecutionConfiguration, InstructorOutputModality, InstructorRealtimeVoice } from './contracts/realtime-voice'

export type VoiceWidgetStatus = 'idle' | 'requesting-microphone' | 'connecting' | 'active' | 'stopping' | 'error'
export interface VoiceWidgetLaunch {
    sessionId: string
    conversationId: string
    title: string
    options: { instructions: string; voice: InstructorRealtimeVoice; outputModality: InstructorOutputModality; executionConfiguration?: AssistantVoiceExecutionConfiguration }
}
export interface VoiceWidgetTranscript {
    id: string
    role: string
    text: string
    final: boolean
    canonicalMessageId?: string
    transcriptSource?: 'turn' | 'chunk'
    images?: Array<{ id: string; name: string; dataUrl: string }>
}
export interface VoiceWidgetState {
    revision: number
    callId: string | null
    launch: VoiceWidgetLaunch | null
    status: VoiceWidgetStatus
    startedAt: string | null
    error: string | null
    realtimeVersion: string | null
    activityLevel: number
    microphoneMuted: boolean
    speakerMuted: boolean
    transcript: VoiceWidgetTranscript[]
}
export type VoiceWidgetCommand = { callId: string; action: 'stop' | 'mute' | 'speaker' | 'clear' | 'send' | 'return'; input?: AssistantSendRealtimeVoiceMessageInput }
export type VoiceWidgetResult = { success: true } | { success: false; error: string }
export interface VoiceWidgetApi {
    getState(): Promise<VoiceWidgetState>
    open(launch: VoiceWidgetLaunch, expectedCallId?: string): Promise<VoiceWidgetResult & { disposition?: 'started' | 'existing' | 'handoff-required'; state?: VoiceWidgetState }>
    command(command: VoiceWidgetCommand): Promise<VoiceWidgetResult>
    publish(callId: string, state: Omit<VoiceWidgetState, 'callId' | 'launch' | 'revision'>): Promise<void>
    complete(commandId: string, result: VoiceWidgetResult): Promise<void>
    onState(listener: (state: VoiceWidgetState) => void): () => void
    onCommand(listener: (command: VoiceWidgetCommand & { commandId: string }) => void): () => void
}
export const VOICE_WIDGET_IPC = {
    getState: 'zyra:voice-widget:get-state', open: 'zyra:voice-widget:open', command: 'zyra:voice-widget:command',
    publish: 'zyra:voice-widget:publish', complete: 'zyra:voice-widget:complete', state: 'zyra:voice-widget:state', receive: 'zyra:voice-widget:receive'
} as const
export function idleVoiceWidgetState(): VoiceWidgetState {
    return { revision: 0, callId: null, launch: null, status: 'idle', startedAt: null, error: null, realtimeVersion: null, activityLevel: 0, microphoneMuted: false, speakerMuted: false, transcript: [] }
}
export function voiceWidgetHitTest(x: number, y: number): boolean {
    // Only the orb, controls and owning-chat button consume desktop input.
    const rounded = (left: number, top: number, width: number, height: number, radius: number) => {
        if (x < left || x > left + width || y < top || y > top + height) return false
        const dx = Math.max(left + radius - x, 0, x - (left + width - radius))
        const dy = Math.max(top + radius - y, 0, y - (top + height - radius))
        return dx * dx + dy * dy <= radius * radius
    }
    return Math.hypot(x - 120, y - 90) <= 72
        || rounded(28, 170, 184, 44, 22)
        || rounded(18, 222, 204, 44, 12)
}
