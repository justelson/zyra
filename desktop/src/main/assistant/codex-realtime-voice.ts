import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import log from 'electron-log'
import { getSharedProviderWorkerClient } from '../setup/provider-worker-client'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
    AssistantRealtimeVoiceClientCommandEvent,
    AssistantRealtimeVoiceClientMessage,
    AssistantRealtimeVoiceEvent,
    InstructorOutputModality,
    InstructorRealtimeVoice
} from '../../shared/assistant/contracts'
import { resolveZyraRoot } from '../zyra/zyra-root'
import {
    chunkFramelessContextText,
    normalizeInstructorRealtimeVoice,
    normalizeInstructorVoiceInstructions,
    normalizeWebRtcOfferSdp
} from './codex-realtime-voice-contract'

type ChatGptRealtimeCallResult = {
    sdp: string
    callId: string
}

type ChatGptRealtimeCallInput = {
    sdp: string
    instructions: string
    voice: InstructorRealtimeVoice
    initialItems?: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>
    sessionId: string
    threadId: string
    signal?: AbortSignal
}

type ChatGptRealtimeAccountModule = {
    createChatGptRealtimeCall(input: ChatGptRealtimeCallInput, dependencies?: {
        resolveAuth: () => Promise<unknown>
        onFailure: (diagnostic: { phase: string; elapsedMs: number; timedOut: boolean; cancelled: boolean }) => void
    }): Promise<ChatGptRealtimeCallResult>
}

type ChatGptRealtimeVoiceDependencies = {
    createCall?: (input: ChatGptRealtimeCallInput) => Promise<ChatGptRealtimeCallResult>
}

type DirectRealtimeSession = {
    adapterSessionId: string
    conversationId: string | null
    threadId: string
    realtimeSessionId: string
    realtimeSessionGeneration: number
    closed: boolean
}

const MAX_CLIENT_COMMAND_MESSAGES = 32
const MAX_SPEAKABLE_TEXT_CHARACTERS = 8_000

let accountModulePromise: Promise<ChatGptRealtimeAccountModule> | null = null

async function loadChatGptRealtimeAccountModule(): Promise<ChatGptRealtimeAccountModule> {
    if (!accountModulePromise) {
        const moduleUrl = pathToFileURL(join(resolveZyraRoot(), 'src', 'chatgpt-account.mjs')).href
        accountModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<ChatGptRealtimeAccountModule>)
            .catch((error) => {
                accountModulePromise = null
                throw error
            })
    }
    return accountModulePromise
}

async function createDirectChatGptCall(input: ChatGptRealtimeCallInput): Promise<ChatGptRealtimeCallResult> {
    return (await loadChatGptRealtimeAccountModule()).createChatGptRealtimeCall(input, {
        // Reuse the same off-main auth boundary as voice transcription.
        resolveAuth: () => getSharedProviderWorkerClient().account.resolveChatGptAccountAuth(),
        onFailure: diagnostic => log.warn('[Voice signaling] Startup failed', diagnostic)
    })
}

/**
 * Main-process ownership for direct ChatGPT WebRTC signaling. Media and the
 * `oai-events` data channel remain exclusively in the owning renderer.
 */
export class ChatGptRealtimeVoiceRuntime extends EventEmitter {
    private readonly createCall: (input: ChatGptRealtimeCallInput) => Promise<ChatGptRealtimeCallResult>
    private activeSession: DirectRealtimeSession | null = null
    private startAbortController: AbortController | null = null
    private lifecycleGeneration = 0
    private nextCommandOrdinal = 0

    constructor(dependencies: ChatGptRealtimeVoiceDependencies = {}) {
        super()
        this.createCall = dependencies.createCall || createDirectChatGptCall
    }

    async start(input: {
        cwd: string
        sdp: string
        instructions?: string
        voice?: InstructorRealtimeVoice
        outputModality?: InstructorOutputModality
        initialItems?: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>
        clientManagedHandoffs?: boolean
        adapterSessionId?: string
        conversationId?: string
        realtimeSessionGeneration?: number
        signal?: AbortSignal
    }): Promise<{
        threadId: string
        sdp: string
        realtimeVersion: string
        realtimeSessionId: string
        realtimeSessionGeneration: number
        adapterSessionId: string
    }> {
        const generation = ++this.lifecycleGeneration
        this.closeLocalSession(true)
        const controller = new AbortController()
        this.startAbortController = controller
        const abortFromCaller = () => controller.abort(input.signal?.reason)
        if (input.signal?.aborted) abortFromCaller()
        else input.signal?.addEventListener('abort', abortFromCaller, { once: true })

        const instructions = normalizeInstructorVoiceInstructions(input.instructions)
        const offerSdp = normalizeWebRtcOfferSdp(input.sdp)
        const voice = normalizeInstructorRealtimeVoice(input.voice)
        const adapterSessionId = normalizeRuntimeIdentifier(
            input.adapterSessionId || `voice_lab_adapter_${randomUUID()}`,
            'Voice adapter session'
        )
        const threadId = `zyra_realtime_thread_${randomUUID()}`
        const requestSessionId = `zyra_realtime_session_${randomUUID()}`
        const realtimeSessionGeneration = normalizeSessionGeneration(input.realtimeSessionGeneration)
        this.emitVoiceEvent({ type: 'session.starting', threadId })

        try {
            const result = await this.createCall({
                sdp: offerSdp,
                instructions,
                voice,
                initialItems: input.initialItems,
                sessionId: requestSessionId,
                threadId,
                signal: controller.signal
            })
            if (generation !== this.lifecycleGeneration || controller.signal.aborted) {
                throw new Error('ChatGPT Voice startup was superseded.')
            }
            const realtimeSessionId = normalizeRuntimeIdentifier(result.callId, 'ChatGPT Voice call')
            const session: DirectRealtimeSession = {
                adapterSessionId,
                conversationId: normalizeOptionalRuntimeIdentifier(input.conversationId),
                threadId,
                realtimeSessionId,
                realtimeSessionGeneration,
                closed: false
            }
            this.activeSession = session
            this.emitVoiceEvent({
                type: 'session.started',
                threadId,
                realtimeSessionId,
                realtimeVersion: 'v3'
            })
            return {
                threadId,
                sdp: result.sdp,
                realtimeVersion: 'v3',
                realtimeSessionId,
                realtimeSessionGeneration,
                adapterSessionId
            }
        } catch (error) {
            if (generation === this.lifecycleGeneration && !controller.signal.aborted) {
                this.emitVoiceEvent({
                    type: 'session.error',
                    threadId,
                    message: error instanceof Error ? error.message : 'ChatGPT Voice signaling failed.'
                })
            }
            throw error
        } finally {
            input.signal?.removeEventListener('abort', abortFromCaller)
            if (this.startAbortController === controller) this.startAbortController = null
        }
    }

    async appendContext(items: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>): Promise<void> {
        const session = this.requireActiveSession()
        const messages = items.flatMap((item) => chunkFramelessContextText(String(item.text || '').trim()).map((text): AssistantRealtimeVoiceClientMessage => ({
            type: 'session.context.append' as const,
            channel: 'commentary' as const,
            content: [{ type: 'input_text' as const, text }]
        })))
        this.emitClientMessages(session, messages)
    }

    async requestSpeech(text: string, canonicalMessageId?: string): Promise<void> {
        const session = this.requireActiveSession()
        const normalized = String(text || '').trim()
        if (!normalized) throw new Error('Speech text is required.')
        if (normalized.length > MAX_SPEAKABLE_TEXT_CHARACTERS) {
            throw new Error(`Voice narration must be ${MAX_SPEAKABLE_TEXT_CHARACTERS.toLocaleString()} characters or fewer.`)
        }
        const messages: AssistantRealtimeVoiceClientMessage[] = chunkFramelessContextText(normalized).map((chunk) => ({
            type: 'session.context.append',
            channel: 'speakable',
            content: [{ type: 'input_text', text: chunk }]
        }))
        this.emitClientMessages(session, messages, canonicalMessageId)
    }

    presentComposerResponse(input: { turnId: string; text?: string; error?: string; canonicalMessageId?: string }): void {
        const session = this.requireActiveSession()
        const turnId = normalizeRuntimeIdentifier(input.turnId, 'typed Voice turn')
        const text = String(input.text || '').trim()
        const error = String(input.error || '').trim()
        if (!text && !error) throw new Error('Typed Voice response text is required.')
        this.emitVoiceEvent({
            type: 'composer.response.done',
            adapterSessionId: session.adapterSessionId,
            threadId: session.threadId,
            realtimeSessionId: session.realtimeSessionId,
            realtimeSessionGeneration: session.realtimeSessionGeneration,
            turnId,
            text,
            ...(input.canonicalMessageId ? { canonicalMessageId: input.canonicalMessageId } : {}),
            ...(error ? { error } : {})
        })
    }

    async stop(): Promise<void> {
        this.lifecycleGeneration += 1
        this.closeLocalSession(true)
    }

    currentSessionIdentity(): {
        adapterSessionId: string
        threadId: string
        realtimeSessionId: string
        realtimeSessionGeneration: number
    } | null {
        const session = this.activeSession
        return session && !session.closed ? {
            adapterSessionId: session.adapterSessionId,
            threadId: session.threadId,
            realtimeSessionId: session.realtimeSessionId,
            realtimeSessionGeneration: session.realtimeSessionGeneration
        } : null
    }

    isCurrentClientCommand(event: AssistantRealtimeVoiceClientCommandEvent): boolean {
        const session = this.activeSession
        return Boolean(session
            && !session.closed
            && event.adapterSessionId === session.adapterSessionId
            && event.threadId === session.threadId
            && event.realtimeSessionId === session.realtimeSessionId
            && event.realtimeSessionGeneration === session.realtimeSessionGeneration)
    }

    dispose(): void {
        this.lifecycleGeneration += 1
        this.closeLocalSession(false)
        this.removeAllListeners()
    }

    private requireActiveSession(): DirectRealtimeSession {
        const session = this.activeSession
        if (!session || session.closed) throw new Error('Start ChatGPT Voice before sending to the realtime session.')
        return session
    }

    private emitClientMessages(
        session: DirectRealtimeSession,
        messages: AssistantRealtimeVoiceClientMessage[],
        canonicalMessageId?: string
    ): void {
        if (this.activeSession !== session || session.closed || messages.length === 0) return
        for (let offset = 0; offset < messages.length; offset += MAX_CLIENT_COMMAND_MESSAGES) {
            const command: AssistantRealtimeVoiceClientCommandEvent = {
                type: 'client.command',
                commandId: `voice_command_${++this.nextCommandOrdinal}_${randomUUID()}`,
                adapterSessionId: session.adapterSessionId,
                threadId: session.threadId,
                realtimeSessionId: session.realtimeSessionId,
                realtimeSessionGeneration: session.realtimeSessionGeneration,
                ...(canonicalMessageId ? { canonicalMessageId } : {}),
                messages: messages.slice(offset, offset + MAX_CLIENT_COMMAND_MESSAGES)
            }
            this.emitVoiceEvent(command)
        }
    }

    private closeLocalSession(notifyRenderer: boolean): void {
        this.startAbortController?.abort()
        this.startAbortController = null
        const session = this.activeSession
        if (!session || session.closed) {
            this.activeSession = null
            return
        }
        if (notifyRenderer) this.emitClientMessagesForClosedSession(session)
        session.closed = true
        this.activeSession = null
    }

    private emitClientMessagesForClosedSession(session: DirectRealtimeSession): void {
        const command: AssistantRealtimeVoiceClientCommandEvent = {
            type: 'client.command',
            commandId: `voice_command_${++this.nextCommandOrdinal}_${randomUUID()}`,
            adapterSessionId: session.adapterSessionId,
            threadId: session.threadId,
            realtimeSessionId: session.realtimeSessionId,
            realtimeSessionGeneration: session.realtimeSessionGeneration,
            messages: [{ type: 'session.close' }]
        }
        this.emitVoiceEvent(command)
    }

    private emitVoiceEvent(event: AssistantRealtimeVoiceEvent): void {
        this.emit('event', event)
    }
}

// Persisted/internal callers may still use the historical class name. Active
// Desktop wiring imports ChatGptRealtimeVoiceRuntime.
export { ChatGptRealtimeVoiceRuntime as CodexRealtimeVoiceRuntime }

function normalizeRuntimeIdentifier(value: unknown, label: string): string {
    const normalized = String(value || '').trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(normalized)) {
        throw new Error(`${label} identity is invalid.`)
    }
    return normalized
}

function normalizeOptionalRuntimeIdentifier(value: unknown): string | null {
    const normalized = String(value || '').trim()
    return normalized ? normalizeRuntimeIdentifier(normalized, 'Voice conversation') : null
}

function normalizeSessionGeneration(value: unknown): number {
    if (value === undefined) return 1
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new Error('Voice session generation is invalid.')
    }
    return value as number
}
