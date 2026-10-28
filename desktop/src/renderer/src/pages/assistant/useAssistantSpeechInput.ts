import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { AssistantTranscriptionEngine } from '@/lib/settings'
import { createAssistantDictationJob, registerAssistantDictationOwner, type AssistantDictationJob } from './assistant-dictation-jobs'
import {
    ASSISTANT_VOICE_MAX_DURATION_MS,
    ASSISTANT_VOICE_MAX_WAVEFORM_SAMPLES,
    createAssistantVoicePcmPayload,
    ASSISTANT_VOICE_SAMPLE_RATE_HZ,
    resampleAssistantVoice,
    describeAssistantMicrophoneError,
    formatAssistantVoiceDuration,
    normalizeAssistantVoiceWaveformLevel
} from './assistant-voice-recorder'

type AssistantSpeechErrorKind =
    | 'permission'
    | 'capture'
    | 'network'
    | 'runtime'
    | 'no-speech'
    | 'unknown'

type BrowserSpeechRecognitionAlternative = { transcript: string }
type BrowserSpeechRecognitionResult = {
    isFinal: boolean
    length: number
    [index: number]: BrowserSpeechRecognitionAlternative
}
type BrowserSpeechRecognitionEvent = {
    resultIndex: number
    results: ArrayLike<BrowserSpeechRecognitionResult>
}
type BrowserSpeechRecognitionErrorEvent = { error: string }
type BrowserSpeechRecognition = {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
    onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}
type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition
type SpeechRecognitionWindow = Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor
    webkitAudioContext?: typeof AudioContext
}

type RecorderRuntime = {
    audioContext: AudioContext
    sourceNode: MediaStreamAudioSourceNode
    processorNode: ScriptProcessorNode
    silentGainNode: GainNode
    stream: MediaStream
    chunks: Int16Array[]
    capturedSampleCount: number
    sampleRateHz: number
    startedAt: number
}

const RECORDER_BUFFER_SIZE = 4096
const WAVEFORM_EMIT_INTERVAL_MS = 45
const DURATION_UPDATE_INTERVAL_MS = 100

const getSpeechRecognitionCtor = () => {
    if (typeof window === 'undefined') return null
    const recognitionWindow = window as SpeechRecognitionWindow
    return recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition || null
}

const getAudioContextCtor = () => {
    if (typeof window === 'undefined') return null
    const audioWindow = window as SpeechRecognitionWindow
    return window.AudioContext || audioWindow.webkitAudioContext || null
}

const microphoneErrorKind = (error: unknown): AssistantSpeechErrorKind => {
    const name = error instanceof DOMException
        ? error.name
        : typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name?: unknown }).name || '')
            : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission'
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'capture'
    return 'runtime'
}

export function useAssistantSpeechInput({
    text,
    setText,
    disabled,
    engine,
    scopeKey,
    onSubmitTranscript,
    createDictationJob
}: {
    text: string
    setText: Dispatch<SetStateAction<string>>
    setComposerCursor: Dispatch<SetStateAction<number>>
    textareaRef: RefObject<HTMLTextAreaElement | null>
    disabled: boolean
    isConnected: boolean
    engine: AssistantTranscriptionEngine
    scopeKey: string
    onSubmitTranscript?: (draftText: string) => void | Promise<void>
    createDictationJob?: () => AssistantDictationJob
}) {
    const speechRecognitionCtor = useMemo(() => getSpeechRecognitionCtor(), [])
    const audioContextCtor = useMemo(() => getAudioContextCtor(), [])
    const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
    const recorderRuntimeRef = useRef<RecorderRuntime | null>(null)
    const recorderTimerRef = useRef<number | null>(null)
    const waveformLevelsRef = useRef<number[]>([])
    const waveformLastEmitAtRef = useRef(0)
    const jobRef = useRef<AssistantDictationJob | null>(null)
    const draftRef = useRef(text)
    draftRef.current = text
    const localOwnerKey = useRef(crypto.randomUUID()).current
    useEffect(() => registerAssistantDictationOwner(`${localOwnerKey}:${scopeKey}`, {
        read: () => ({ draft: draftRef.current }),
        apply: state => { draftRef.current = state.draft || ''; setText(draftRef.current) }
    }), [localOwnerKey, scopeKey, setText])
    const captureJobRef = useRef<() => AssistantDictationJob>(() => { throw new Error('Dictation target is not initialized.') })
    captureJobRef.current = () => createDictationJob?.() || createAssistantDictationJob({
        ownerKey: `${localOwnerKey}:${scopeKey}`,
        initialState: { draft: text },
        send: onSubmitTranscript ? async draft => { await onSubmitTranscript(draft); return false } : undefined
    })
    const finalTranscriptRef = useRef('')
    const latestBrowserTranscriptRef = useRef('')
    const browserStopRequestedRef = useRef(false)
    const requestIdRef = useRef(0)
    const mountedRef = useRef(true)
    const startingRef = useRef(false)
    const autoSubmitRef = useRef(false)
    const availableRef = useRef({ disabled, engine, scopeKey })
    availableRef.current = { disabled, engine, scopeKey }
    const submittingRef = useRef<number | null>(null)
    const transcriptionRequestRef = useRef<string | null>(null)
    const cancelPendingTranscription = useCallback(() => {
        const requestId = transcriptionRequestRef.current
        transcriptionRequestRef.current = null
        if (requestId) void window.devscope.assistant.cancelVoiceTranscription?.(requestId).catch(() => undefined)
    }, [])

    const [isStarting, setIsStarting] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [durationMs, setDurationMs] = useState(0)
    const [waveformLevels, setWaveformLevels] = useState<number[]>([])
    const [speechError, setSpeechError] = useState<string | null>(null)
    const [speechErrorKind, setSpeechErrorKind] = useState<AssistantSpeechErrorKind | null>(null)

    const isSupported = useMemo(() => {
        return typeof navigator !== 'undefined'
            && Boolean(navigator.mediaDevices?.getUserMedia)
            && Boolean(audioContextCtor)
            && (engine === 'browser'
                ? Boolean(speechRecognitionCtor)
                : typeof window.devscope?.assistant?.transcribeVoice === 'function')
    }, [audioContextCtor, engine, speechRecognitionCtor])

    const durationLabel = useMemo(() => formatAssistantVoiceDuration(durationMs), [durationMs])

    const clearRecorderTimer = useCallback(() => {
        if (recorderTimerRef.current !== null) {
            window.clearInterval(recorderTimerRef.current)
            recorderTimerRef.current = null
        }
    }, [])

    const resetRecorderPresentation = useCallback(() => {
        waveformLevelsRef.current = []
        waveformLastEmitAtRef.current = 0
        autoSubmitRef.current = false
        setDurationMs(0)
        setWaveformLevels([])
    }, [])

    const teardownRecorder = useCallback(async (resetPresentation: boolean) => {
        const runtime = recorderRuntimeRef.current
        recorderRuntimeRef.current = null
        clearRecorderTimer()
        if (mountedRef.current) setIsRecording(false)

        if (!runtime) {
            if (resetPresentation) resetRecorderPresentation()
            return null
        }

        runtime.processorNode.onaudioprocess = null
        try { runtime.sourceNode.disconnect() } catch {}
        try { runtime.processorNode.disconnect() } catch {}
        try { runtime.silentGainNode.disconnect() } catch {}
        runtime.stream.getTracks().forEach((track) => track.stop())
        await runtime.audioContext.close().catch(() => undefined)
        if (resetPresentation) resetRecorderPresentation()

        return {
            chunks: runtime.chunks,
            sampleRateHz: runtime.sampleRateHz
        }
    }, [clearRecorderTimer, resetRecorderPresentation])

    const applyTranscript = useCallback((spokenText: string) => {
        return jobRef.current?.transcript(spokenText, true) || ''
    }, [])

    const stopBrowserRecording = useCallback(() => {
        if (browserStopRequestedRef.current) return
        browserStopRequestedRef.current = true
        finalTranscriptRef.current = latestBrowserTranscriptRef.current
        try { recognitionRef.current?.stop() } catch {}
        if (mountedRef.current) setIsRecording(false)
    }, [])

    const cancelBrowserRecording = useCallback(() => {
        const recognition = recognitionRef.current
        recognitionRef.current = null
        if (recognition) {
            recognition.onresult = null
            recognition.onerror = null
            recognition.onend = null
            recognition.abort()
        }
        if (mountedRef.current) setIsRecording(false)
    }, [])

    const startBrowserRecording = useCallback(() => {
        if (!speechRecognitionCtor || recognitionRef.current) return
        setSpeechError(null)
        setSpeechErrorKind(null)
        finalTranscriptRef.current = ''
        latestBrowserTranscriptRef.current = ''
        browserStopRequestedRef.current = false

        const recognition = new speechRecognitionCtor()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.lang = 'en-US'
        let finished = false
        let browserError: string | null = null
        const finish = () => {
            if (finished) return
            finished = true
            if (recognitionRef.current === recognition) recognitionRef.current = null
            recognition.onresult = null
            recognition.onerror = null
            recognition.onend = null
            if (mountedRef.current) setIsRecording(false)
            const requestId = requestIdRef.current
            const transcript = (finalTranscriptRef.current || latestBrowserTranscriptRef.current).trim()
            void (async () => {
                try {
                    const recording = await teardownRecorder(false)
                    const payload = recording && createAssistantVoicePcmPayload(recording.chunks)
                    if (!payload) throw new Error('No audio was captured. Try dictation again.')
                    const saved = await window.devscope.assistant.saveVoiceHistory({
                        engine: 'browser', recording: payload,
                        ...(browserError ? { error: browserError } : transcript ? { transcript } : { error: 'Browser speech did not recognize anything.' })
                    })
                    if (!saved.success) throw new Error(saved.error || 'Could not save voice history.')
                    if (mountedRef.current && requestIdRef.current === requestId && !browserError && !transcript) {
                        setSpeechErrorKind('no-speech')
                        setSpeechError('Browser speech did not recognize anything.')
                    }
                } catch (error) {
                    if (mountedRef.current && requestIdRef.current === requestId) {
                        setSpeechErrorKind('runtime')
                        setSpeechError(error instanceof Error ? error.message : 'Could not save browser dictation.')
                    }
                } finally {
                    if (mountedRef.current && requestIdRef.current === requestId) resetRecorderPresentation()
                }
            })()
        }
        recognition.onresult = (event) => {
            if (browserStopRequestedRef.current) return
            const finalParts: string[] = []
            const interimParts: string[] = []
            for (let index = 0; index < event.results.length; index += 1) {
                const result = event.results[index]
                const transcript = String(result?.[0]?.transcript || '').trim()
                if (!transcript) continue
                if (result.isFinal) finalParts.push(transcript)
                else interimParts.push(transcript)
            }
            finalTranscriptRef.current = finalParts.join(' ')
            latestBrowserTranscriptRef.current = [...finalParts, ...interimParts].join(' ')
            applyTranscript(latestBrowserTranscriptRef.current)
        }
        recognition.onerror = (event) => {
            if (browserStopRequestedRef.current && event.error === 'aborted') return
            browserError = event.error === 'not-allowed'
                ? 'Microphone access was denied for browser dictation.'
                : event.error === 'network'
                    ? 'Browser speech service could not connect.'
                    : event.error === 'no-speech'
                        ? 'Browser speech did not recognize anything.'
                        : `Browser dictation failed (${event.error || 'unknown error'}).`
            setSpeechErrorKind(event.error === 'not-allowed' ? 'permission' : event.error === 'network' ? 'network' : event.error === 'no-speech' ? 'no-speech' : 'runtime')
            setSpeechError(browserError)
            finish()
            try { recognition.abort() } catch {}
        }
        recognition.onend = finish

        try {
            recognitionRef.current = recognition
            setIsRecording(true)
            recognition.start()
        } catch {
            recognitionRef.current = null
            browserError = 'Browser dictation could not start.'
            setSpeechErrorKind('runtime')
            setSpeechError(browserError)
            finish()
        }
    }, [applyTranscript, resetRecorderPresentation, speechRecognitionCtor, teardownRecorder, text])

    const startCodexRecording = useCallback(async (recordingEngine: AssistantTranscriptionEngine = 'codex') => {
        if (!audioContextCtor || disabled || isRecording || isTranscribing || startingRef.current) return
        if (!navigator.mediaDevices?.getUserMedia) {
            setSpeechErrorKind('runtime')
            setSpeechError('Microphone capture is unavailable in this runtime.')
            return
        }

        startingRef.current = true
        setIsStarting(true)
        setSpeechError(null)
        setSpeechErrorKind(null)
        resetRecorderPresentation()
        jobRef.current = captureJobRef.current()
        requestIdRef.current += 1
        const recordingRequestId = requestIdRef.current
        const recordingScopeKey = scopeKey

        let stream: MediaStream | null = null
        let audioContext: AudioContext | null = null
        let sourceNode: MediaStreamAudioSourceNode | null = null
        let processorNode: ScriptProcessorNode | null = null
        let silentGainNode: GainNode | null = null
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            })
            const latest = availableRef.current
            if (!mountedRef.current
                || requestIdRef.current !== recordingRequestId
                || latest.disabled
                || latest.engine !== recordingEngine
                || latest.scopeKey !== recordingScopeKey) {
                stream.getTracks().forEach((track) => track.stop())
                return
            }

            audioContext = new audioContextCtor()
            await audioContext.resume()
            if (!mountedRef.current || requestIdRef.current !== recordingRequestId
                || availableRef.current.scopeKey !== recordingScopeKey || availableRef.current.engine !== recordingEngine) {
                stream.getTracks().forEach((track) => track.stop())
                await audioContext.close().catch(() => undefined)
                return
            }
            sourceNode = audioContext.createMediaStreamSource(stream)
            processorNode = audioContext.createScriptProcessor(RECORDER_BUFFER_SIZE, 1, 1)
            silentGainNode = audioContext.createGain()
            silentGainNode.gain.value = 0

            const runtime: RecorderRuntime = {
                audioContext,
                sourceNode,
                processorNode,
                silentGainNode,
                stream,
                chunks: [],
                capturedSampleCount: 0,
                sampleRateHz: audioContext.sampleRate,
                startedAt: performance.now()
            }
            processorNode.onaudioprocess = (event) => {
                const input = event.inputBuffer
                const channelCount = Math.max(1, input.numberOfChannels)
                const mono = new Float32Array(input.length)
                for (let channelIndex = 0; channelIndex < input.numberOfChannels; channelIndex += 1) {
                    const channel = input.getChannelData(channelIndex)
                    for (let sampleIndex = 0; sampleIndex < input.length; sampleIndex += 1) {
                        mono[sampleIndex] += (channel[sampleIndex] ?? 0) / channelCount
                    }
                }
                const maximumSampleCount = Math.ceil(ASSISTANT_VOICE_SAMPLE_RATE_HZ * ASSISTANT_VOICE_MAX_DURATION_MS / 1000)
                const remainingSampleCount = Math.max(0, maximumSampleCount - runtime.capturedSampleCount)
                if (remainingSampleCount === 0) return
                const resampled = resampleAssistantVoice(mono, runtime.sampleRateHz)
                const captured = resampled.subarray(0, remainingSampleCount)
                const pcm = new Int16Array(captured.length)
                for (let i = 0; i < captured.length; i++) {
                    const sample = Math.max(-1, Math.min(1, captured[i]))
                    pcm[i] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
                }
                runtime.chunks.push(pcm)
                runtime.capturedSampleCount += pcm.length

                let sumSquares = 0
                for (const sample of captured) sumSquares += sample * sample
                const rawRms = Math.sqrt(sumSquares / Math.max(1, captured.length))
                const waveformLevel = normalizeAssistantVoiceWaveformLevel(rawRms)
                const now = performance.now()
                if (now - waveformLastEmitAtRef.current >= WAVEFORM_EMIT_INTERVAL_MS) {
                    waveformLastEmitAtRef.current = now
                    const next = [...waveformLevelsRef.current, waveformLevel].slice(-ASSISTANT_VOICE_MAX_WAVEFORM_SAMPLES)
                    waveformLevelsRef.current = next
                    setWaveformLevels(next)
                }
            }

            sourceNode.connect(processorNode)
            processorNode.connect(silentGainNode)
            silentGainNode.connect(audioContext.destination)
            recorderRuntimeRef.current = runtime
            setIsRecording(true)
            recorderTimerRef.current = window.setInterval(() => {
                const activeRuntime = recorderRuntimeRef.current
                if (!activeRuntime) return
                setDurationMs(Math.min(
                    ASSISTANT_VOICE_MAX_DURATION_MS,
                    Math.max(0, performance.now() - activeRuntime.startedAt)
                ))
            }, DURATION_UPDATE_INTERVAL_MS)
        } catch (error) {
            try { processorNode?.disconnect() } catch {}
            try { sourceNode?.disconnect() } catch {}
            try { silentGainNode?.disconnect() } catch {}
            stream?.getTracks().forEach((track) => track.stop())
            await audioContext?.close().catch(() => undefined)
            if (mountedRef.current && requestIdRef.current === recordingRequestId) {
                setSpeechErrorKind(microphoneErrorKind(error))
                setSpeechError(describeAssistantMicrophoneError(error))
                resetRecorderPresentation()
            }
        } finally {
            startingRef.current = false
            if (mountedRef.current) setIsStarting(false)
        }
    }, [audioContextCtor, disabled, isRecording, isTranscribing, resetRecorderPresentation, scopeKey, text])

    const submitCodexRecording = useCallback(async (send = false) => {
        if (!recorderRuntimeRef.current || submittingRef.current !== null) return
        const job = jobRef.current
        const submission = send ? job?.captureSubmission() : undefined
        const submittedScope = availableRef.current.scopeKey
        const requestId = requestIdRef.current + 1
        const transcriptionRequestId = crypto.randomUUID()
        requestIdRef.current = requestId
        submittingRef.current = requestId
        if (mountedRef.current) {
            setSpeechError(null)
            setSpeechErrorKind(null)
            setIsTranscribing(true)
        }

        try {
            const recording = await teardownRecorder(false)
            if (!recording || job?.cancelled) return
            const payload = createAssistantVoicePcmPayload(recording.chunks)
            if (!payload) throw new Error('No audio was captured. Try recording again.')
            payload.requestId = transcriptionRequestId
            if (mountedRef.current && requestIdRef.current === requestId && availableRef.current.scopeKey === submittedScope) {
                transcriptionRequestRef.current = transcriptionRequestId
            }
            const result = await window.devscope.assistant.transcribeVoice(payload)
            if (job?.cancelled) return
            if (!result.success) throw new Error(result.error || 'Voice transcription failed.')
            if (!result.text.trim()) throw new Error('ChatGPT returned an empty transcription.')
            job?.transcript(result.text)
            if (submission) await submission(result.text)
        } catch (error) {
            if (mountedRef.current && availableRef.current.scopeKey === submittedScope && requestIdRef.current === requestId) {
                setSpeechErrorKind('runtime')
                setSpeechError(error instanceof Error ? error.message : 'Voice transcription failed.')
            }
        } finally {
            if (transcriptionRequestRef.current === transcriptionRequestId) transcriptionRequestRef.current = null
            if (submittingRef.current === requestId) submittingRef.current = null
            if (mountedRef.current && availableRef.current.scopeKey === submittedScope && requestIdRef.current === requestId) {
                setIsTranscribing(false)
                resetRecorderPresentation()
            }
        }
    }, [resetRecorderPresentation, teardownRecorder])

    const cancelCodexRecording = useCallback(() => {
        jobRef.current?.cancel()
        cancelPendingTranscription()
        requestIdRef.current += 1
        submittingRef.current = null
        setIsTranscribing(false)
        void teardownRecorder(true)
    }, [cancelPendingTranscription, teardownRecorder])

    const stopBrowserOnInput = useCallback(() => {
        if (engine !== 'browser') return
        if (!recognitionRef.current && (startingRef.current || recorderRuntimeRef.current)) {
            cancelCodexRecording()
            return
        }
        if (recognitionRef.current) stopBrowserRecording()
    }, [cancelCodexRecording, engine, stopBrowserRecording])

    const startRecording = useCallback(() => {
        if (recognitionRef.current || recorderRuntimeRef.current || startingRef.current || isTranscribing) return
        if (engine === 'browser') {
            void startCodexRecording('browser').then(() => {
                if (mountedRef.current && availableRef.current.scopeKey === scopeKey
                    && availableRef.current.engine === engine && recorderRuntimeRef.current) startBrowserRecording()
            })
        } else {
            void startCodexRecording()
        }
    }, [engine, isTranscribing, scopeKey, startBrowserRecording, startCodexRecording])

    const submitRecording = useCallback(() => {
        if (engine === 'browser') {
            if (recognitionRef.current) stopBrowserRecording()
        } else {
            void submitCodexRecording()
        }
    }, [engine, stopBrowserRecording, submitCodexRecording])

    const submitAndSendRecording = useCallback(() => {
        if (engine === 'codex') void submitCodexRecording(true)
    }, [engine, submitCodexRecording])

    const cancelRecording = useCallback(() => {
        if (engine === 'browser') {
            cancelBrowserRecording()
            cancelCodexRecording()
        } else {
            cancelCodexRecording()
        }
    }, [cancelBrowserRecording, cancelCodexRecording, engine])

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            submitRecording()
        } else {
            startRecording()
        }
    }, [isRecording, startRecording, submitRecording])

    useEffect(() => {
        if (!isRecording || durationMs < ASSISTANT_VOICE_MAX_DURATION_MS || autoSubmitRef.current) return
        autoSubmitRef.current = true
        submitRecording()
    }, [durationMs, engine, isRecording, submitRecording])

    useEffect(() => {
        if (disabled) recoverRecordingRef.current()
    }, [disabled])

    const recoverRecordingRef = useRef(() => {})
    recoverRecordingRef.current = () => {
        // Only a captured Chat job has a durable destination after navigation.
        // Replaced question scopes must discard their recording and late answers.
        if (!createDictationJob) {
            cancelBrowserRecording()
            cancelCodexRecording()
            return
        }
        if (recognitionRef.current) {
            stopBrowserRecording()
            // Some engines never emit onend after leaving the page.
            recognitionRef.current?.onend?.()
        } else if (recorderRuntimeRef.current) {
            void submitCodexRecording(false)
        }
    }
    const previousScopeRef = useRef({ scopeKey, engine })
    useEffect(() => {
        const previous = previousScopeRef.current
        previousScopeRef.current = { scopeKey, engine }
        if (previous.scopeKey === scopeKey && previous.engine === engine) return
        recoverRecordingRef.current()
        // Detach presentation only. The captured job continues to own the old draft.
        requestIdRef.current += 1
        submittingRef.current = null
        transcriptionRequestRef.current = null
        setIsTranscribing(false)
        setIsStarting(false)
        setSpeechError(null)
        setSpeechErrorKind(null)
        resetRecorderPresentation()
    }, [engine, resetRecorderPresentation, scopeKey])

    useEffect(() => {
        mountedRef.current = true
        const recover = () => recoverRecordingRef.current()
        window.addEventListener('pagehide', recover)
        return () => {
            window.removeEventListener('pagehide', recover)
            mountedRef.current = false
            recover()
            requestIdRef.current += 1
        }
    }, [])

    return {
        isSupported,
        isStarting,
        isRecording,
        isTranscribing,
        durationMs,
        durationLabel,
        waveformLevels,
        speechError,
        speechErrorKind,
        startRecording,
        submitRecording,
        submitAndSendRecording,
        cancelRecording,
        toggleRecording,
        stopBrowserOnInput,
        stopRecording: submitRecording
    }
}
