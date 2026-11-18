export const INSTRUCTOR_REALTIME_VOICES = [
    'arbor',
    'breeze',
    'cove',
    'ember',
    'juniper',
    'maple',
    'sol',
    'spruce',
    'vale'
] as const

export type InstructorRealtimeVoice = typeof INSTRUCTOR_REALTIME_VOICES[number]
export type InstructorOutputModality = 'audio' | 'text'

export const DEFAULT_INSTRUCTOR_REALTIME_VOICE: InstructorRealtimeVoice = 'cove'
export const DEFAULT_INSTRUCTOR_OUTPUT_MODALITY: InstructorOutputModality = 'audio'

export const DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS = `You are my patient, practical instructor.

Teach one clear step at a time. Use plain language and short examples. Ask a brief question when you need to check my understanding or choose the next direction. Adapt to my level without talking down to me. Keep answers concise unless I ask to go deeper.

This is an instructional conversation. Do not edit files, execute commands, or make system changes.`

export interface AssistantVoiceExecutionConfiguration {
    model: string
    effort: import('./runtime').AssistantReasoningEffort
    runtimeMode: import('./runtime').AssistantRuntimeMode
    interactionMode: import('./runtime').AssistantInteractionMode
    profile: string
    serviceTier?: 'fast' | 'ultrafast'
}

export interface AssistantStartRealtimeVoiceInput {
    /** Local Assistant thread ID. Omit only for the legacy isolated Voice Lab. */
    conversationId?: string
    sessionId?: string
    transcriptBridgeVersion?: 1
    /** Exact visible Chat configuration to snapshot for delegated Voice work. */
    executionConfiguration?: AssistantVoiceExecutionConfiguration
    sdp: string
    instructions?: string
    voice?: InstructorRealtimeVoice
    outputModality?: InstructorOutputModality
}

export interface AssistantRealtimeVoiceImageInput {
    name?: string
    mimeType: string
    dataUrl: string
}

export interface AssistantSendRealtimeVoiceMessageInput {
    clientMessageId?: string
    clientMessageCreatedAt?: string
    text?: string
    images?: AssistantRealtimeVoiceImageInput[]
}

export interface AssistantIngestRealtimeVoiceEventInput {
    adapterSessionId: string
    payload: unknown
}

export type AssistantRealtimeVoiceClientMessage =
    | {
        type: 'session.context.append'
        channel: 'speakable' | 'commentary'
        content: [{ type: 'input_text'; text: string }]
    }
    | { type: 'session.close' }

export interface AssistantRealtimeVoiceClientCommandEvent {
    type: 'client.command'
    commandId: string
    adapterSessionId: string
    threadId: string
    realtimeSessionId: string
    realtimeSessionGeneration: number
    canonicalMessageId?: string
    voiceTaskId?: string
    messages: AssistantRealtimeVoiceClientMessage[]
}

export interface AssistantRealtimeVoiceEventIdentity {
    adapterSessionId?: string
    realtimeSessionId?: string
    realtimeSessionGeneration?: number
}

export type AssistantRealtimeVoiceEvent = AssistantRealtimeVoiceEventIdentity & (
    | {
        type: 'session.starting'
        threadId?: string
    }
    | {
        type: 'session.started'
        threadId?: string
        realtimeSessionId?: string
        realtimeVersion?: string
    }
    | {
        type: 'transcript.delta'
        threadId?: string
        providerItemId?: string
        transcriptSource?: 'turn' | 'chunk'
        role: string
        delta: string
    }
    | {
        type: 'transcript.done'
        threadId?: string
        providerItemId?: string
        transcriptSource?: 'turn' | 'chunk'
        role: string
        text: string
    }
    | {
        type: 'transcript.suppressed'
        threadId?: string
        providerItemId: string
        role: 'user' | 'assistant'
    }
    | {
        type: 'composer.response.delta'
        threadId?: string
        adapterSessionId: string
        realtimeSessionId: string
        realtimeSessionGeneration: number
        turnId: string
        delta: string
    }
    | {
        type: 'composer.response.done'
        threadId?: string
        adapterSessionId: string
        realtimeSessionId: string
        realtimeSessionGeneration: number
        turnId: string
        text: string
        canonicalMessageId?: string
        error?: string
    }
    | AssistantRealtimeVoiceClientCommandEvent
    | {
        type: 'session.error'
        threadId?: string
        message: string
    }
    | {
        type: 'session.closed'
        threadId?: string
        reason?: string
    }
)
