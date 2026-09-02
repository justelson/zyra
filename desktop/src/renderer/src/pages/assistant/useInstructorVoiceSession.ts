import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    AssistantRealtimeVoiceClientCommandEvent,
    AssistantRealtimeVoiceEvent,
    AssistantSendRealtimeVoiceMessageInput,
    AssistantVoiceExecutionConfiguration,
    InstructorOutputModality,
    InstructorRealtimeVoice
} from '@shared/assistant/contracts'
import voiceEndedCueUrl from '../../assets/voice-cues/voice-ended.wav?url'
import voiceReadyCueUrl from '../../assets/voice-cues/voice-ready.wav?url'
import { shouldPlayInstructorAudio } from './instructor-voice-preferences'
import { calculateInstructorVoiceActivity, smoothInstructorVoiceActivity } from './instructor-voice-activity'
import { applyRealtimeTranscriptEvent, type InstructorTranscriptEntry } from './instructor-voice-transcript'
import { createAssistantVoicePayload } from './assistant-voice-recorder'
import {
    buildRecoveredRealtimeUserTranscript,
    readCompletedRealtimeUserTranscriptId,
    readRealtimeInputSpeechBoundary
} from './assistant-realtime-input-recovery'
import {
    consumeCanonicalVoiceSpeechReplay,
    isCurrentRealtimeVoiceClientCommand,
    isCurrentRealtimeVoicePresentationEvent,
    normalizeRealtimeVoiceSpeechText,
    readRealtimeVoiceAssistantCompletion,
    readRealtimeVoiceResponseActivity,
    sendRealtimeVoiceClientCommand,
    type RealtimeVoiceClientCommandBinding
} from './assistant-realtime-client-commands'

export type InstructorVoiceStatus = 'idle' | 'requesting-microphone' | 'connecting' | 'active' | 'stopping' | 'error'

type RealtimeReadiness = {
    peerConnected: boolean
    dataChannelOpen: boolean
    sessionInitialized: boolean
    outputReady: boolean
}

type InstructorVoiceStartOptions = {
    instructions: string
    voice: InstructorRealtimeVoice
    outputModality: InstructorOutputModality
    executionConfiguration?: AssistantVoiceExecutionConfiguration
}

type AudioMeter = {
    analyser: AnalyserNode
    source: MediaStreamAudioSourceNode
    samples: Uint8Array<ArrayBuffer>
}

type CanonicalVoiceBinding = {
    conversationId: string
    sessionId: string
}

const ACTIVITY_UPDATE_INTERVAL_MS = 96
const REALTIME_INPUT_TRANSCRIPT_FALLBACK_DELAY_MS = 1_500
const REALTIME_INPUT_CAPTURE_PREROLL_MS = 650
const REALTIME_PEER_DISCONNECT_GRACE_MS = 3_000

type RealtimeInputCapture = {
    providerItemId: string
    chunks: Float32Array[]
    resolved: boolean
    recovered: boolean
    fallbackTimer: number | null
}

function playVoiceCue(url: string): void {
    const cue = new Audio(url)
    cue.volume = 0.22
    void cue.play().catch(() => undefined)
}

function createAudioMeter(context: AudioContext, stream: MediaStream): AudioMeter {
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.42
    const source = context.createMediaStreamSource(stream)
    source.connect(analyser)
    return {
        analyser,
        source,
        samples: new Uint8Array(new ArrayBuffer(analyser.fftSize))
    }
}

function readAudioMeter(meter: AudioMeter | null): number {
    if (!meter) return 0
    meter.analyser.getByteTimeDomainData(meter.samples)
    return calculateInstructorVoiceActivity(meter.samples)
}

function waitForIceGatheringComplete(peer: RTCPeerConnection, timeoutMs = 10_000): Promise<void> {
    if (peer.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            peer.removeEventListener('icegatheringstatechange', handleChange)
            if (error) reject(error)
            else resolve()
        }
        const handleChange = () => {
            if (peer.iceGatheringState === 'complete') finish()
        }
        const timer = window.setTimeout(
            () => finish(new Error('Microphone connection setup timed out. Try again.')),
            timeoutMs
        )
        peer.addEventListener('icegatheringstatechange', handleChange)
    })
}

function isCanonicalTranscriptBridgeEvent(payload: Record<string, unknown>): boolean {
    const type = typeof payload.type === 'string' ? payload.type : ''
    return type === 'delegation.created'
        || type === 'turn.created'
        || type === 'turn.delta'
        || type === 'turn.done'
        || type === 'input_transcript.added'
        || type === 'output_transcript.added'
        || type === 'conversation.item.created'
        || type.endsWith('.transcript.delta')
        || type.endsWith('.transcript.done')
        || type.endsWith('.audio_transcript.delta')
        || type.endsWith('.audio_transcript.done')
        || type.endsWith('.input_audio_transcription.delta')
        || type.endsWith('.input_audio_transcription.completed')
}

function readDataChannelError(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null
    const payload = value as Record<string, unknown>
    const type = typeof payload.type === 'string' ? payload.type : ''
    const error = payload.error && typeof payload.error === 'object'
        ? payload.error as Record<string, unknown>
        : null
    const message = typeof error?.message === 'string'
        ? error.message
        : (typeof payload.message === 'string' ? payload.message : null)
    if (error || type === 'error' || type.endsWith('.error')) {
        return message || 'ChatGPT Voice reported a connection error.'
    }
    return null
}

export function useInstructorVoiceSession(binding?: CanonicalVoiceBinding) {
    const peerRef = useRef<RTCPeerConnection | null>(null)
    const dataChannelRef = useRef<RTCDataChannel | null>(null)
    const mediaStreamRef = useRef<MediaStream | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const meterContextRef = useRef<AudioContext | null>(null)
    const inputMeterRef = useRef<AudioMeter | null>(null)
    const outputMeterRef = useRef<AudioMeter | null>(null)
    const inputCaptureProcessorRef = useRef<ScriptProcessorNode | null>(null)
    const inputCaptureSinkRef = useRef<GainNode | null>(null)
    const inputCaptureSampleRateRef = useRef(0)
    const rollingInputChunksRef = useRef<Float32Array[]>([])
    const rollingInputSampleCountRef = useRef(0)
    const activeInputCaptureIdRef = useRef<string | null>(null)
    const inputCapturesRef = useRef(new Map<string, RealtimeInputCapture>())
    const meterFrameRef = useRef<number | null>(null)
    const activityLevelRef = useRef(0)
    const activityUpdatesEnabledRef = useRef(false)
    const lastActivityUpdateRef = useRef(0)
    const connectionTimerRef = useRef<number | null>(null)
    const peerDisconnectTimerRef = useRef<number | null>(null)
    const mountedRef = useRef(true)
    const generationRef = useRef(0)
    const startPendingRef = useRef(false)
    const terminalHandledRef = useRef(false)
    const readyCuePlayedRef = useRef(false)
    const activeThreadIdRef = useRef<string | null>(null)
    const adapterSessionIdRef = useRef<string | null>(null)
    const realtimeClientBindingRef = useRef<RealtimeVoiceClientCommandBinding | null>(null)
    const pendingClientCommandsRef = useRef<AssistantRealtimeVoiceClientCommandEvent[]>([])
    const sentClientCommandIdsRef = useRef(new Set<string>())
    const realtimeResponseActiveRef = useRef(false)
    const pendingCanonicalSpeechReplaysRef = useRef<Array<{ canonicalMessageId: string; normalizedText: string }>>([])
    const bridgeQueueRef = useRef<Promise<void>>(Promise.resolve())
    const [status, setStatus] = useState<InstructorVoiceStatus>('idle')
    const [startedAt, setStartedAt] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [transcript, setTranscript] = useState<InstructorTranscriptEntry[]>([])
    const [realtimeVersion, setRealtimeVersion] = useState<string | null>(null)
    const [activityLevel, setActivityLevel] = useState(0)
    const [microphoneMuted, setMicrophoneMuted] = useState(false)

    const flushClientCommands = useCallback(() => {
        const binding = realtimeClientBindingRef.current
        const channel = dataChannelRef.current
        if (!binding || !channel || channel.readyState !== 'open') return
        const remaining: AssistantRealtimeVoiceClientCommandEvent[] = []
        for (const command of pendingClientCommandsRef.current) {
            if (sentClientCommandIdsRef.current.has(command.commandId)) continue
            if (!isCurrentRealtimeVoiceClientCommand(command, binding)) continue
            const startsResponse = command.messages.some((message) =>
                message.type === 'session.context.append' && message.channel === 'speakable'
            )
            const requiresIdleResponse = command.messages.some((message) => message.type === 'session.context.append')
            if (requiresIdleResponse && realtimeResponseActiveRef.current) {
                remaining.push(command)
                continue
            }
            if (sendRealtimeVoiceClientCommand(channel, command, binding)) {
                sentClientCommandIdsRef.current.add(command.commandId)
                if (startsResponse) {
                    realtimeResponseActiveRef.current = true
                    if (command.canonicalMessageId) {
                        const speechText = command.messages
                            .filter((message) => message.type === 'session.context.append' && message.channel === 'speakable')
                            .map((message) => message.type === 'session.context.append' ? message.content[0].text : '')
                            .join('')
                        const normalizedText = normalizeRealtimeVoiceSpeechText(speechText)
                        if (normalizedText) {
                            pendingCanonicalSpeechReplaysRef.current.push({
                                canonicalMessageId: command.canonicalMessageId,
                                normalizedText
                            })
                            if (pendingCanonicalSpeechReplaysRef.current.length > 32) {
                                pendingCanonicalSpeechReplaysRef.current.shift()
                            }
                        }
                    }
                }
            } else {
                remaining.push(command)
            }
        }
        pendingClientCommandsRef.current = remaining
        while (sentClientCommandIdsRef.current.size > 256) {
            const oldest = sentClientCommandIdsRef.current.values().next().value
            if (!oldest) break
            sentClientCommandIdsRef.current.delete(oldest)
        }
    }, [])

    const queueClientCommand = useCallback((command: AssistantRealtimeVoiceClientCommandEvent) => {
        if (sentClientCommandIdsRef.current.has(command.commandId)
            || pendingClientCommandsRef.current.some((entry) => entry.commandId === command.commandId)) return
        pendingClientCommandsRef.current.push(command)
        if (pendingClientCommandsRef.current.length > 64) pendingClientCommandsRef.current.shift()
        flushClientCommands()
    }, [flushClientCommands])

    const sendLocalSessionClose = useCallback(() => {
        const channel = dataChannelRef.current
        if (channel?.readyState !== 'open') return
        try {
            channel.send(JSON.stringify({ type: 'session.close' }))
        } catch {
            // Main still releases canonical ownership even if the peer closed first.
        }
    }, [])

    const releaseLocalMedia = useCallback(() => {
        if (connectionTimerRef.current !== null) {
            window.clearTimeout(connectionTimerRef.current)
            connectionTimerRef.current = null
        }
        if (peerDisconnectTimerRef.current !== null) {
            window.clearTimeout(peerDisconnectTimerRef.current)
            peerDisconnectTimerRef.current = null
        }

        if (meterFrameRef.current !== null) {
            window.cancelAnimationFrame(meterFrameRef.current)
            meterFrameRef.current = null
        }
        for (const capture of inputCapturesRef.current.values()) {
            if (capture.fallbackTimer !== null) window.clearTimeout(capture.fallbackTimer)
        }
        inputCapturesRef.current.clear()
        activeInputCaptureIdRef.current = null
        rollingInputChunksRef.current = []
        rollingInputSampleCountRef.current = 0
        inputCaptureSampleRateRef.current = 0
        if (inputCaptureProcessorRef.current) {
            inputCaptureProcessorRef.current.onaudioprocess = null
            inputCaptureProcessorRef.current.disconnect()
            inputCaptureProcessorRef.current = null
        }
        inputCaptureSinkRef.current?.disconnect()
        inputCaptureSinkRef.current = null
        inputMeterRef.current?.source.disconnect()
        inputMeterRef.current?.analyser.disconnect()
        outputMeterRef.current?.source.disconnect()
        outputMeterRef.current?.analyser.disconnect()
        inputMeterRef.current = null
        outputMeterRef.current = null
        const meterContext = meterContextRef.current
        meterContextRef.current = null
        if (meterContext && meterContext.state !== 'closed') void meterContext.close().catch(() => undefined)
        activityLevelRef.current = 0
        activityUpdatesEnabledRef.current = false
        lastActivityUpdateRef.current = 0
        if (mountedRef.current) setActivityLevel(0)

        realtimeClientBindingRef.current = null
        pendingClientCommandsRef.current = []
        sentClientCommandIdsRef.current.clear()
        realtimeResponseActiveRef.current = false
        pendingCanonicalSpeechReplaysRef.current = []
        const dataChannel = dataChannelRef.current
        dataChannelRef.current = null
        if (dataChannel) {
            dataChannel.onopen = null
            dataChannel.onmessage = null
            dataChannel.onerror = null
            dataChannel.onclose = null
            if (dataChannel.readyState !== 'closed') dataChannel.close()
        }

        const peer = peerRef.current
        peerRef.current = null
        if (peer) {
            peer.ontrack = null
            peer.onconnectionstatechange = null
            peer.close()
        }

        for (const track of mediaStreamRef.current?.getTracks() || []) track.stop()
        mediaStreamRef.current = null
        if (mountedRef.current) setMicrophoneMuted(false)

        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.srcObject = null
            audioRef.current = null
        }
    }, [])

    const beginActivityMeter = useCallback((stream: MediaStream) => {
        if (typeof AudioContext === 'undefined') return
        try {
            const context = new AudioContext()
            meterContextRef.current = context
            const inputMeter = createAudioMeter(context, stream)
            inputMeterRef.current = inputMeter
            inputCaptureSampleRateRef.current = context.sampleRate
            const processor = context.createScriptProcessor(2_048, 1, 1)
            const silentSink = context.createGain()
            silentSink.gain.value = 0
            inputMeter.source.connect(processor)
            processor.connect(silentSink)
            silentSink.connect(context.destination)
            processor.onaudioprocess = (event) => {
                const chunk = event.inputBuffer.getChannelData(0).slice()
                if (chunk.length === 0) return
                rollingInputChunksRef.current.push(chunk)
                rollingInputSampleCountRef.current += chunk.length
                const maxPrerollSamples = Math.ceil(context.sampleRate * (REALTIME_INPUT_CAPTURE_PREROLL_MS / 1000))
                while (rollingInputSampleCountRef.current > maxPrerollSamples && rollingInputChunksRef.current.length > 1) {
                    const removed = rollingInputChunksRef.current.shift()
                    rollingInputSampleCountRef.current -= removed?.length || 0
                }
                const activeCaptureId = activeInputCaptureIdRef.current
                const activeCapture = activeCaptureId ? inputCapturesRef.current.get(activeCaptureId) : null
                if (activeCapture && !activeCapture.resolved) activeCapture.chunks.push(chunk)
            }
            inputCaptureProcessorRef.current = processor
            inputCaptureSinkRef.current = silentSink
            void context.resume().catch(() => undefined)

            const update = (timestamp: number) => {
                if (!mountedRef.current || meterContextRef.current !== context || context.state === 'closed') return
                const measured = Math.max(
                    readAudioMeter(inputMeterRef.current),
                    readAudioMeter(outputMeterRef.current)
                )
                const smoothed = smoothInstructorVoiceActivity(activityLevelRef.current, measured)
                activityLevelRef.current = smoothed < 0.004 ? 0 : smoothed
                if (activityUpdatesEnabledRef.current
                    && timestamp - lastActivityUpdateRef.current >= ACTIVITY_UPDATE_INTERVAL_MS) {
                    lastActivityUpdateRef.current = timestamp
                    setActivityLevel(activityLevelRef.current)
                }
                meterFrameRef.current = window.requestAnimationFrame(update)
            }
            meterFrameRef.current = window.requestAnimationFrame(update)
        } catch {
            // Voice remains usable if visual metering is unavailable.
        }
    }, [])

    const attachOutputActivityMeter = useCallback((stream: MediaStream) => {
        const context = meterContextRef.current
        if (!context || context.state === 'closed') return
        try {
            outputMeterRef.current?.source.disconnect()
            outputMeterRef.current?.analyser.disconnect()
            outputMeterRef.current = createAudioMeter(context, stream)
        } catch {
            outputMeterRef.current = null
        }
    }, [])

    const stopRemoteSilently = useCallback(() => {
        void bridgeQueueRef.current
            .catch(() => undefined)
            .then(() => window.devscope.assistant.stopRealtimeVoice())
            .catch(() => undefined)
    }, [])

    const endWithError = useCallback((message: string) => {
        if (terminalHandledRef.current) return
        sendLocalSessionClose()
        if (readyCuePlayedRef.current) playVoiceCue(voiceEndedCueUrl)
        readyCuePlayedRef.current = false
        terminalHandledRef.current = true
        generationRef.current += 1
        activeThreadIdRef.current = null
        adapterSessionIdRef.current = null
        releaseLocalMedia()
        if (mountedRef.current) {
            setError(message)
            setStatus('error')
        }
        stopRemoteSilently()
    }, [releaseLocalMedia, sendLocalSessionClose, stopRemoteSilently])

    useEffect(() => {
        mountedRef.current = true
        const unsubscribe = window.devscope.assistant.onRealtimeVoiceEvent((event: AssistantRealtimeVoiceEvent) => {
            if (!mountedRef.current) return
            if (event.type === 'client.command') {
                queueClientCommand(event)
                return
            }
            if (terminalHandledRef.current) return
            if (activeThreadIdRef.current && event.threadId && event.threadId !== activeThreadIdRef.current) return

            if (event.type === 'session.started') {
                if (event.realtimeVersion && event.realtimeVersion !== 'v3') {
                    endWithError(`ChatGPT connected with unsupported Voice version ${event.realtimeVersion}.`)
                    return
                }
                setRealtimeVersion(event.realtimeVersion || null)
                return
            }
            if ((event.type === 'composer.response.delta' || event.type === 'composer.response.done')
                && !isCurrentRealtimeVoicePresentationEvent(event, realtimeClientBindingRef.current)) return
            if (event.type === 'composer.response.delta') {
                const entryId = `composer-response-${event.turnId}`
                setTranscript((current) => {
                    const index = current.findIndex((entry) => entry.id === entryId)
                    if (index < 0) {
                        return [...current, {
                            id: entryId,
                            role: 'assistant',
                            text: event.delta,
                            final: false
                        }]
                    }
                    const next = current.slice()
                    next[index] = { ...next[index], text: `${next[index].text}${event.delta}` }
                    return next
                })
                return
            }
            if (event.type === 'composer.response.done') {
                const entryId = `composer-response-${event.turnId}`
                setTranscript((current) => {
                    const index = current.findIndex((entry) => entry.id === entryId)
                    const text = event.text.trim() || event.error || 'The typed voice turn ended without a response.'
                    if (index < 0) {
                        return [...current, {
                            id: entryId,
                            role: 'assistant',
                            text,
                            final: true,
                            canonicalMessageId: event.canonicalMessageId
                        }]
                    }
                    const next = current.slice()
                    next[index] = { ...next[index], text, final: true, canonicalMessageId: event.canonicalMessageId }
                    return next
                })
                return
            }
            if (event.type === 'session.error') {
                endWithError(event.message)
                return
            }
            if (event.type === 'session.closed') {
                if (readyCuePlayedRef.current) playVoiceCue(voiceEndedCueUrl)
                readyCuePlayedRef.current = false
                terminalHandledRef.current = true
                generationRef.current += 1
                activeThreadIdRef.current = null
                adapterSessionIdRef.current = null
                releaseLocalMedia()
                setStatus('idle')
            }
        })

        return () => {
            mountedRef.current = false
            terminalHandledRef.current = true
            generationRef.current += 1
            activeThreadIdRef.current = null
            adapterSessionIdRef.current = null
            unsubscribe()
            releaseLocalMedia()
            stopRemoteSilently()
        }
    }, [endWithError, queueClientCommand, releaseLocalMedia, stopRemoteSilently])

    const start = useCallback(async (options: InstructorVoiceStartOptions) => {
        if (startPendingRef.current || peerRef.current) return

        startPendingRef.current = true
        terminalHandledRef.current = false
        readyCuePlayedRef.current = false
        const generation = ++generationRef.current
        activeThreadIdRef.current = null
        adapterSessionIdRef.current = null
        realtimeClientBindingRef.current = null
        pendingClientCommandsRef.current = []
        sentClientCommandIdsRef.current.clear()
        realtimeResponseActiveRef.current = false
        bridgeQueueRef.current = Promise.resolve()
        setStartedAt(new Date().toISOString())
        setError(null)
        setRealtimeVersion(null)
        setTranscript([])
        setMicrophoneMuted(false)
        releaseLocalMedia()

        const isCurrent = () => mountedRef.current
            && generationRef.current === generation
            && !terminalHandledRef.current

        const failConnection = (message: string) => {
            if (!isCurrent()) return
            endWithError(message)
        }

        try {
            if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
                throw new Error('WebRTC microphone access is unavailable in this window.')
            }

            if (binding?.sessionId) {
                void window.devscope.assistant.connect({
                    sessionId: binding.sessionId,
                    voicePreparation: options.executionConfiguration
                }).catch(() => undefined)
            }

            setStatus('requesting-microphone')
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            })
            if (!isCurrent()) {
                for (const track of stream.getTracks()) track.stop()
                return
            }

            beginActivityMeter(stream)

            const readiness: RealtimeReadiness = {
                peerConnected: false,
                dataChannelOpen: false,
                sessionInitialized: false,
                outputReady: !shouldPlayInstructorAudio(options.outputModality)
            }
            const peer = new RTCPeerConnection()
            const dataChannel = peer.createDataChannel('oai-events')
            const audio = new Audio()
            audio.autoplay = true

            const queueCanonicalPayload = (payload: Record<string, unknown>) => {
                const adapterSessionId = adapterSessionIdRef.current
                if (!binding || !adapterSessionId || !isCanonicalTranscriptBridgeEvent(payload)) return
                const ingest = window.devscope.assistant.ingestRealtimeVoiceEvent({
                    adapterSessionId,
                    payload
                }).then((result) => {
                    if (!result.success) throw new Error(result.error || 'Voice transcript bridge failed.')
                })
                const bridge = Promise.all([bridgeQueueRef.current, ingest]).then(() => undefined)
                bridgeQueueRef.current = bridge
                void bridge.catch((bridgeError) => failConnection(
                    bridgeError instanceof Error ? bridgeError.message : 'Voice transcript bridge failed.'
                ))
            }

            const recoverMissingInputTranscript = async (capture: RealtimeInputCapture) => {
                if (!isCurrent() || capture.resolved) return
                const payload = createAssistantVoicePayload(
                    capture.chunks,
                    inputCaptureSampleRateRef.current
                )
                if (!payload || payload.durationMs < 250) return
                try {
                    const result = await window.devscope.assistant.transcribeVoice(payload)
                    if (!isCurrent() || capture.resolved) return
                    if (!result.success) throw new Error(result.error || 'Voice transcription recovery failed.')
                    const recoveredPayload = buildRecoveredRealtimeUserTranscript(
                        capture.providerItemId,
                        result.text
                    )
                    if (!recoveredPayload) return
                    capture.resolved = true
                    capture.recovered = true
                    capture.chunks = []
                    setTranscript((current) => applyRealtimeTranscriptEvent(current, recoveredPayload))
                    queueCanonicalPayload(recoveredPayload)
                } catch {
                    if (!isCurrent() || capture.resolved) return
                    setTranscript((current) => {
                        const index = current.findIndex((entry) => entry.id === capture.providerItemId)
                        const fallbackEntry: InstructorTranscriptEntry = {
                            id: capture.providerItemId,
                            role: 'user',
                            text: 'Voice message · transcript unavailable',
                            final: true
                        }
                        if (index < 0) return [...current, fallbackEntry]
                        const next = current.slice()
                        next[index] = fallbackEntry
                        return next
                    })
                }
            }

            const markActiveIfReady = (): boolean => {
                if (!isCurrent()) return false
                const ready = readiness.peerConnected
                    && readiness.dataChannelOpen
                    && readiness.sessionInitialized
                    && readiness.outputReady
                if (ready) {
                    if (connectionTimerRef.current !== null) {
                        window.clearTimeout(connectionTimerRef.current)
                        connectionTimerRef.current = null
                    }
                    activityUpdatesEnabledRef.current = true
                    setStatus('active')
                    if (!readyCuePlayedRef.current) {
                        readyCuePlayedRef.current = true
                        playVoiceCue(voiceReadyCueUrl)
                    }
                }
                return ready
            }

            dataChannel.onopen = () => {
                readiness.dataChannelOpen = true
                flushClientCommands()
                markActiveIfReady()
            }
            dataChannel.onmessage = (event) => {
                if (!isCurrent() || typeof event.data !== 'string') return
                try {
                    const payload = JSON.parse(event.data) as Record<string, unknown>
                    const dataError = readDataChannelError(payload)
                    if (dataError) {
                        failConnection(dataError)
                        return
                    }
                    if (payload.type === 'session.started' || payload.type === 'session.updated') {
                        readiness.sessionInitialized = true
                        markActiveIfReady()
                    }
                    const assistantCompletion = readRealtimeVoiceAssistantCompletion(payload)
                    const speechReplay = assistantCompletion
                        ? consumeCanonicalVoiceSpeechReplay(
                            pendingCanonicalSpeechReplaysRef.current,
                            assistantCompletion.text
                        )
                        : { canonicalMessageId: null, remaining: pendingCanonicalSpeechReplaysRef.current }
                    pendingCanonicalSpeechReplaysRef.current = speechReplay.remaining
                    const canonicalSpeechMessageId = speechReplay.canonicalMessageId || undefined
                    const responseActivity = readRealtimeVoiceResponseActivity(payload)
                    if (responseActivity === 'started') realtimeResponseActiveRef.current = true
                    else if (responseActivity === 'finished') {
                        realtimeResponseActiveRef.current = false
                        flushClientCommands()
                    }
                    const speechBoundary = readRealtimeInputSpeechBoundary(payload)
                    if (speechBoundary?.kind === 'started') {
                        const previous = inputCapturesRef.current.get(speechBoundary.providerItemId)
                        if (previous?.fallbackTimer !== null && previous?.fallbackTimer !== undefined) {
                            window.clearTimeout(previous.fallbackTimer)
                        }
                        const capture: RealtimeInputCapture = {
                            providerItemId: speechBoundary.providerItemId,
                            chunks: rollingInputChunksRef.current.map((chunk) => chunk.slice()),
                            resolved: false,
                            recovered: false,
                            fallbackTimer: null
                        }
                        inputCapturesRef.current.set(capture.providerItemId, capture)
                        activeInputCaptureIdRef.current = capture.providerItemId
                        setTranscript((current) => current.some((entry) => entry.id === capture.providerItemId)
                            ? current
                            : [...current, {
                                id: capture.providerItemId,
                                role: 'user',
                                text: '',
                                final: false
                            }])
                    } else if (speechBoundary?.kind === 'stopped') {
                        if (activeInputCaptureIdRef.current === speechBoundary.providerItemId) {
                            activeInputCaptureIdRef.current = null
                        }
                        const capture = inputCapturesRef.current.get(speechBoundary.providerItemId)
                        if (capture && !capture.resolved && capture.fallbackTimer === null) {
                            capture.fallbackTimer = window.setTimeout(() => {
                                capture.fallbackTimer = null
                                void recoverMissingInputTranscript(capture)
                            }, REALTIME_INPUT_TRANSCRIPT_FALLBACK_DELAY_MS)
                        }
                    }
                    const completedUserItemId = readCompletedRealtimeUserTranscriptId(payload)
                    if (completedUserItemId) {
                        const capture = inputCapturesRef.current.get(completedUserItemId)
                        if (capture?.recovered) return
                        if (capture) {
                            capture.resolved = true
                            capture.chunks = []
                            if (capture.fallbackTimer !== null) {
                                window.clearTimeout(capture.fallbackTimer)
                                capture.fallbackTimer = null
                            }
                        }
                        if (activeInputCaptureIdRef.current === completedUserItemId) {
                            activeInputCaptureIdRef.current = null
                        }
                    }
                    setTranscript((current) => {
                        const next = applyRealtimeTranscriptEvent(current, payload)
                        if (!assistantCompletion || !canonicalSpeechMessageId) return next
                        return next.map((entry) => entry.id === assistantCompletion.providerItemId
                            ? { ...entry, canonicalMessageId: canonicalSpeechMessageId }
                            : entry)
                    })
                    // Invoke IPC immediately so any later navigation request is
                    // ordered after this provider event in Electron. The aggregate
                    // promise remains only as the local Stop/unmount drain barrier.
                    queueCanonicalPayload(payload)
                } catch {
                    // Ignore unrelated non-JSON realtime payloads.
                }
            }
            dataChannel.onerror = () => failConnection('The ChatGPT Voice data connection failed.')
            dataChannel.onclose = () => {
                if (isCurrent()) failConnection('The ChatGPT Voice data connection closed.')
            }

            peer.ontrack = (event) => {
                if (!isCurrent()) return
                const remoteStream = event.streams[0] || new MediaStream([event.track])
                attachOutputActivityMeter(remoteStream)
                if (!shouldPlayInstructorAudio(options.outputModality)) {
                    readiness.outputReady = true
                    markActiveIfReady()
                    return
                }
                audio.srcObject = remoteStream
                void audio.play()
                    .then(() => {
                        readiness.outputReady = true
                        markActiveIfReady()
                    })
                    .catch(() => failConnection('Zyra connected, but could not play the instructor audio.'))
            }
            peer.onconnectionstatechange = () => {
                if (!isCurrent()) return
                if (peer.connectionState === 'connected') {
                    if (peerDisconnectTimerRef.current !== null) {
                        window.clearTimeout(peerDisconnectTimerRef.current)
                        peerDisconnectTimerRef.current = null
                    }
                    readiness.peerConnected = true
                    markActiveIfReady()
                } else if (peer.connectionState === 'disconnected') {
                    readiness.peerConnected = false
                    if (peerDisconnectTimerRef.current === null) {
                        peerDisconnectTimerRef.current = window.setTimeout(() => {
                            peerDisconnectTimerRef.current = null
                            if (isCurrent() && peer.connectionState === 'disconnected') {
                                failConnection('The ChatGPT Voice connection was interrupted.')
                            }
                        }, REALTIME_PEER_DISCONNECT_GRACE_MS)
                    }
                } else if (peer.connectionState === 'failed') {
                    failConnection('The ChatGPT Voice connection failed.')
                }
            }
            for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)

            mediaStreamRef.current = stream
            peerRef.current = peer
            dataChannelRef.current = dataChannel
            audioRef.current = audio
            setStatus('connecting')

            const offer = await peer.createOffer()
            await peer.setLocalDescription(offer)
            await waitForIceGatheringComplete(peer)
            if (!isCurrent()) return

            const offerSdp = peer.localDescription?.sdp
            if (!offerSdp) throw new Error('The browser could not create a WebRTC offer.')

            const result = await window.devscope.assistant.startRealtimeVoice({
                conversationId: binding?.conversationId,
                sessionId: binding?.sessionId,
                transcriptBridgeVersion: binding ? 1 : undefined,
                executionConfiguration: options.executionConfiguration,
                sdp: offerSdp,
                instructions: options.instructions,
                voice: options.voice,
                outputModality: options.outputModality
            })
            if (!isCurrent()) {
                stopRemoteSilently()
                return
            }
            if (!result.success) throw new Error(result.error || 'ChatGPT Voice could not start.')
            if (result.realtimeVersion !== 'v3') {
                throw new Error(`ChatGPT connected with unsupported Voice version ${result.realtimeVersion || 'unknown'}.`)
            }
            if (!result.adapterSessionId || !result.realtimeSessionId
                || !Number.isSafeInteger(result.realtimeSessionGeneration)
                || (result.realtimeSessionGeneration as number) < 1) {
                throw new Error('ChatGPT Voice did not return a stable owner-scoped session binding.')
            }

            activeThreadIdRef.current = result.threadId
            adapterSessionIdRef.current = result.adapterSessionId
            realtimeClientBindingRef.current = {
                adapterSessionId: result.adapterSessionId,
                realtimeSessionId: result.realtimeSessionId,
                realtimeSessionGeneration: result.realtimeSessionGeneration as number
            }
            flushClientCommands()
            readiness.sessionInitialized = true
            setRealtimeVersion(result.realtimeVersion)
            await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
            if (!isCurrent()) return

            if (!markActiveIfReady() && connectionTimerRef.current === null) {
                connectionTimerRef.current = window.setTimeout(
                    () => failConnection('ChatGPT Voice connected, but media did not become ready.'),
                    30_000
                )
            }
        } catch (startError) {
            if (isCurrent()) {
                endWithError(startError instanceof Error ? startError.message : 'Voice connection failed.')
            }
        } finally {
            startPendingRef.current = false
        }
    }, [attachOutputActivityMeter, beginActivityMeter, binding, endWithError, flushClientCommands, releaseLocalMedia, stopRemoteSilently])

    const toggleMicrophone = useCallback(() => {
        const stream = mediaStreamRef.current
        if (!stream) return
        const nextMuted = !microphoneMuted
        for (const track of stream.getAudioTracks()) track.enabled = !nextMuted
        setMicrophoneMuted(nextMuted)
    }, [microphoneMuted])

    const sendMessage = useCallback(async (input: AssistantSendRealtimeVoiceMessageInput) => {
        if (status !== 'active') {
            return { success: false as const, error: 'Wait for the voice session to finish connecting.' }
        }

        const clientMessageId = `voice-typed-${crypto.randomUUID()}`
        const clientMessageCreatedAt = new Date().toISOString()
        const localEntryId = `local-composer-${clientMessageId}`
        const imageCount = input.images?.length || 0
        setTranscript((current) => [...current, {
            id: localEntryId,
            role: 'user',
            text: input.text?.trim() || `Shared ${imageCount === 1 ? 'an image' : `${imageCount} images`}.`,
            final: true,
            images: input.images?.map((image, index) => ({
                id: `${localEntryId}:${index}`,
                name: image.name || `Image ${index + 1}`,
                dataUrl: image.dataUrl
            }))
        }])

        try {
            const result = await window.devscope.assistant.sendRealtimeVoiceMessage({
                ...input,
                clientMessageId,
                clientMessageCreatedAt
            })
            if (result.success) return { success: true as const }
            setTranscript((current) => current.filter((entry) => entry.id !== localEntryId))
            return { success: false as const, error: result.error || 'The voice message could not be sent.' }
        } catch (sendError) {
            setTranscript((current) => current.filter((entry) => entry.id !== localEntryId))
            return {
                success: false as const,
                error: sendError instanceof Error ? sendError.message : 'The voice message could not be sent.'
            }
        }
    }, [status])

    const stop = useCallback(async () => {
        if (status === 'idle' || status === 'stopping') return

        sendLocalSessionClose()
        terminalHandledRef.current = true
        generationRef.current += 1
        if (readyCuePlayedRef.current) playVoiceCue(voiceEndedCueUrl)
        readyCuePlayedRef.current = false
        setStatus('stopping')

        try {
            const bridgeError = await bridgeQueueRef.current.then(() => null).catch((error) => error)
            const result = await window.devscope.assistant.stopRealtimeVoice()
            if (!result.success) throw new Error(result.error || 'ChatGPT Voice could not stop cleanly.')
            if (bridgeError) throw bridgeError
            if (mountedRef.current) setStatus('idle')
        } catch (stopError) {
            if (!mountedRef.current) return
            setError(stopError instanceof Error ? stopError.message : 'Voice session could not stop cleanly.')
            setStatus('error')
        } finally {
            activeThreadIdRef.current = null
            adapterSessionIdRef.current = null
            releaseLocalMedia()
        }
    }, [releaseLocalMedia, sendLocalSessionClose, status])

    return {
        status,
        startedAt,
        error,
        transcript,
        realtimeVersion,
        activityLevel,
        microphoneMuted,
        start,
        stop,
        sendMessage,
        toggleMicrophone,
        clearTranscript: () => setTranscript([])
    }
}
