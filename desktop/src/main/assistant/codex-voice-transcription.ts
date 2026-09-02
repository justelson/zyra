import { randomBytes } from 'node:crypto'
import type {
    AssistantTranscribeVoiceInput,
    AssistantVoiceTranscriptionState
} from '../../shared/assistant/contracts'
import { getSharedOpenAIAuthWorkerClient } from '../setup/openai-auth-worker-client'

export const CODEX_VOICE_TRANSCRIPTION_URL = 'https://chatgpt.com/backend-api/transcribe'
export const CODEX_VOICE_SAMPLE_RATE_HZ = 24_000
export const CODEX_VOICE_MAX_DURATION_MS = 120_000
export const CODEX_VOICE_MAX_AUDIO_BYTES = 10 * 1024 * 1024

const CODEX_VOICE_MAX_MULTIPART_BYTES = CODEX_VOICE_MAX_AUDIO_BYTES + 64 * 1024
const CODEX_VOICE_MAX_RESPONSE_BYTES = 1024 * 1024
const CODEX_VOICE_MAX_TRANSCRIPT_CHARS = 100_000
const CODEX_VOICE_REQUEST_TIMEOUT_MS = 30_000
const CODEX_VOICE_MAX_CONCURRENT_REQUESTS = 2
const BASE64_MAX_LENGTH = Math.ceil(CODEX_VOICE_MAX_AUDIO_BYTES / 3) * 4

type CodexVoiceCredentials = {
    accessToken: string
    accountId: string
}

type CodexVoiceRequest = {
    audio: Buffer
    accessToken: string
    accountId: string
    endpoint?: string
    fetchImpl?: typeof fetch
}

type CodexVoiceDependencies = {
    resolveCredentials: (refresh: boolean) => Promise<CodexVoiceCredentials>
    requestTranscription: (request: CodexVoiceRequest) => Promise<Response>
}

class CodexVoiceAuthError extends Error {
    constructor(readonly kind: 'signed-out' | 'unavailable', message: string) {
        super(message)
        this.name = 'CodexVoiceAuthError'
    }
}

let activeTranscriptionRequests = 0

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function readNonEmptyString(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : ''
    return normalized || null
}

async function readCodexVoiceCredentials(): Promise<CodexVoiceCredentials> {
    try {
        // Loading Pi auth and OAuth modules can be expensive on a cold Windows
        // profile. Keep that dependency graph in the shared auth worker so a
        // transcription request cannot block Electron's main event loop.
        const auth = await getSharedOpenAIAuthWorkerClient().account.resolveChatGptAccountAuth()
        const accessToken = readNonEmptyString(auth?.accessToken)
        const accountId = readNonEmptyString(auth?.accountId)
        if (!accessToken || !accountId) {
            throw new CodexVoiceAuthError('signed-out', 'Connect your ChatGPT account through Zyra to use ChatGPT transcription.')
        }
        return { accessToken, accountId }
    } catch (error) {
        if (error instanceof CodexVoiceAuthError) throw error
        throw new CodexVoiceAuthError('unavailable', 'Zyra could not read the ChatGPT account connected through Pi.')
    }
}

async function refreshCodexVoiceCredentials(): Promise<CodexVoiceCredentials> {
    try {
        return await readCodexVoiceCredentials()
    } catch {
        throw new CodexVoiceAuthError('signed-out', 'Zyra could not refresh the connected ChatGPT account. Reconnect it through Zyra and try again.')
    }
}

export async function getCodexVoiceTranscriptionState(): Promise<AssistantVoiceTranscriptionState> {
    try {
        await readCodexVoiceCredentials()
        return {
            provider: 'codex',
            status: 'ready',
            available: true,
            signedIn: true,
            message: 'Ready to transcribe with the ChatGPT account connected through Pi.'
        }
    } catch (error) {
        if (error instanceof CodexVoiceAuthError) {
            return {
                provider: 'codex',
                status: error.kind,
                available: error.kind === 'signed-out',
                signedIn: false,
                message: error.message
            }
        }
        return {
            provider: 'codex',
            status: 'unavailable',
            available: false,
            signedIn: false,
            message: 'ChatGPT transcription is unavailable right now.'
        }
    }
}

function normalizeVoiceBase64(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > BASE64_MAX_LENGTH + 1024) {
        throw new Error('The recorded audio could not be decoded.')
    }
    const normalized = value.trim().replace(/\s+/g, '')
    if (!normalized || normalized.length > BASE64_MAX_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw new Error('The recorded audio could not be decoded.')
    }
    return normalized
}

function validateWav(audio: Buffer, claimedDurationMs: number): void {
    if (audio.length < 44
        || audio.toString('ascii', 0, 4) !== 'RIFF'
        || audio.toString('ascii', 8, 12) !== 'WAVE'
        || audio.readUInt32LE(4) !== audio.length - 8) {
        throw new Error('The recorded audio is not a valid WAV file.')
    }

    let offset = 12
    let formatFound = false
    let dataBytes = 0
    while (offset + 8 <= audio.length) {
        const chunkId = audio.toString('ascii', offset, offset + 4)
        const chunkSize = audio.readUInt32LE(offset + 4)
        const chunkStart = offset + 8
        const chunkEnd = chunkStart + chunkSize
        if (chunkEnd > audio.length) {
            throw new Error('The recorded audio is not a valid WAV file.')
        }

        if (chunkId === 'fmt ') {
            if (chunkSize < 16
                || audio.readUInt16LE(chunkStart) !== 1
                || audio.readUInt16LE(chunkStart + 2) !== 1
                || audio.readUInt32LE(chunkStart + 4) !== CODEX_VOICE_SAMPLE_RATE_HZ
                || audio.readUInt32LE(chunkStart + 8) !== CODEX_VOICE_SAMPLE_RATE_HZ * 2
                || audio.readUInt16LE(chunkStart + 12) !== 2
                || audio.readUInt16LE(chunkStart + 14) !== 16) {
                throw new Error('Voice transcription requires 24 kHz mono 16-bit WAV audio.')
            }
            formatFound = true
        } else if (chunkId === 'data') {
            dataBytes += chunkSize
        }

        offset = chunkEnd + (chunkSize % 2)
    }

    if (!formatFound || dataBytes <= 0 || dataBytes % 2 !== 0) {
        throw new Error('The recorded audio is not a valid WAV file.')
    }

    const audioDurationMs = (dataBytes / (CODEX_VOICE_SAMPLE_RATE_HZ * 2)) * 1000
    if (audioDurationMs > CODEX_VOICE_MAX_DURATION_MS + 1) {
        throw new Error('Voice notes are limited to 120 seconds.')
    }
    if (Math.abs(audioDurationMs - claimedDurationMs) > 2_000) {
        throw new Error('The recorded audio duration is invalid.')
    }
}

export function decodeCodexVoiceInput(input: AssistantTranscribeVoiceInput): Buffer {
    if (!input || typeof input !== 'object') {
        throw new Error('A voice recording is required.')
    }
    if (input.mimeType !== 'audio/wav') {
        throw new Error('Only WAV audio is supported for voice transcription.')
    }
    if (input.sampleRateHz !== CODEX_VOICE_SAMPLE_RATE_HZ) {
        throw new Error('Voice transcription requires 24 kHz mono WAV audio.')
    }
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
        throw new Error('Voice notes must include a positive duration.')
    }
    if (input.durationMs > CODEX_VOICE_MAX_DURATION_MS) {
        throw new Error('Voice notes are limited to 120 seconds.')
    }

    const normalizedBase64 = normalizeVoiceBase64(input.audioBase64)
    const audio = Buffer.from(normalizedBase64, 'base64')
    if (!audio.length || audio.length > CODEX_VOICE_MAX_AUDIO_BYTES || audio.toString('base64') !== normalizedBase64) {
        throw new Error(audio.length > CODEX_VOICE_MAX_AUDIO_BYTES
            ? 'Voice notes are limited to 10 MB.'
            : 'The recorded audio could not be decoded.')
    }
    validateWav(audio, input.durationMs)
    return audio
}

function assertAllowedTranscriptionUrl(value: string): string {
    let parsed: URL
    try {
        parsed = new URL(value)
    } catch {
        throw new Error('The ChatGPT transcription endpoint is invalid.')
    }
    const allowed = new URL(CODEX_VOICE_TRANSCRIPTION_URL)
    if (parsed.href !== allowed.href
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash) {
        throw new Error('The ChatGPT transcription endpoint is not allowed.')
    }
    return parsed.href
}

function encodeMultipartWav(audio: Buffer): { body: Buffer; contentType: string } {
    const boundary = `----zyra-voice-${randomBytes(16).toString('hex')}`
    const prefix = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
        'utf8'
    )
    const suffix = Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
        'utf8'
    )
    const body = Buffer.concat([prefix, audio, suffix])
    if (body.length > CODEX_VOICE_MAX_MULTIPART_BYTES) {
        throw new Error('Voice notes are limited to 10 MB.')
    }
    return {
        body,
        contentType: `multipart/form-data; boundary=${boundary}`
    }
}

async function fetchCodexVoiceFromDesktopSession(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    try {
        const { session } = await import('electron')
        return await session.defaultSession.fetch(input instanceof URL ? input.href : input, {
            ...init,
            credentials: 'include'
        })
    } catch (error) {
        if (error instanceof Error && !/Cannot find module|Unknown built-in module/u.test(error.message)) throw error
        return await fetch(input, init)
    }
}

export async function requestCodexVoiceTranscription(request: CodexVoiceRequest): Promise<Response> {
    const endpoint = assertAllowedTranscriptionUrl(request.endpoint || CODEX_VOICE_TRANSCRIPTION_URL)
    const multipart = encodeMultipartWav(request.audio)
    const controller = new AbortController()
    const requestBody = Uint8Array.from(multipart.body).buffer
    const timeout = setTimeout(() => controller.abort(), CODEX_VOICE_REQUEST_TIMEOUT_MS)
    const fetchImpl = request.fetchImpl || fetchCodexVoiceFromDesktopSession

    try {
        return await fetchImpl(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${request.accessToken}`,
                'ChatGPT-Account-Id': request.accountId,
                'Content-Type': multipart.contentType,
                'User-Agent': 'Zyra Desktop Voice Transcription',
                originator: 'zyra_desktop'
            },
            body: requestBody
        })
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error('Voice transcription timed out. Try again.')
        }
        throw new Error('Could not reach ChatGPT transcription. Check your connection and try again.')
    } finally {
        clearTimeout(timeout)
    }
}

async function readBoundedResponseText(response: Response): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(declaredLength) && declaredLength > CODEX_VOICE_MAX_RESPONSE_BYTES) {
        throw new Error('ChatGPT returned an invalid transcription response.')
    }
    if (!response.body) return ''

    const reader = response.body.getReader()
    const readBody = async () => {
        const chunks: Uint8Array[] = []
        let totalBytes = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            totalBytes += value.byteLength
            if (totalBytes > CODEX_VOICE_MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => undefined)
                throw new Error('ChatGPT returned an invalid transcription response.')
            }
            chunks.push(value)
        }

        const body = new Uint8Array(totalBytes)
        let offset = 0
        for (const chunk of chunks) {
            body.set(chunk, offset)
            offset += chunk.byteLength
        }
        return new TextDecoder().decode(body)
    }

    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
        return await Promise.race([
            readBody(),
            new Promise<string>((_resolve, reject) => {
                timeout = setTimeout(() => {
                    void reader.cancel().catch(() => undefined)
                    reject(new Error('Voice transcription timed out. Try again.'))
                }, CODEX_VOICE_REQUEST_TIMEOUT_MS)
            })
        ])
    } finally {
        if (timeout) clearTimeout(timeout)
    }
}

function readStatusError(response: Response): string {
    if (response.status === 401) {
        return 'Your ChatGPT login has expired. Reconnect ChatGPT through Zyra and try again.'
    }
    if (response.status === 403) {
        const browserChallenge = response.headers.get('cf-mitigated') === 'challenge'
            || response.headers.get('content-type')?.toLowerCase().includes('text/html')
        return browserChallenge
            ? 'ChatGPT blocked transcription with a browser check. Use Browser dictation or try again later.'
            : 'ChatGPT did not allow transcription for this account. Reconnect ChatGPT or use Browser dictation.'
    }
    if (response.status === 413) return 'Voice notes are limited to 10 MB.'
    if (response.status === 429) return 'ChatGPT transcription is busy or rate-limited. Try again shortly.'
    if (response.status >= 500) return 'ChatGPT transcription is temporarily unavailable. Try again shortly.'
    return `Voice transcription failed with status ${response.status}.`
}

export async function transcribeCodexVoiceWithDependencies(
    input: AssistantTranscribeVoiceInput,
    dependencies: CodexVoiceDependencies
): Promise<string> {
    const audio = decodeCodexVoiceInput(input)
    let credentials = await dependencies.resolveCredentials(false)
    let response = await dependencies.requestTranscription({
        audio,
        accessToken: credentials.accessToken,
        accountId: credentials.accountId
    })

    if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined)
        credentials = await dependencies.resolveCredentials(true)
        response = await dependencies.requestTranscription({
            audio,
            accessToken: credentials.accessToken,
            accountId: credentials.accountId
        })
    }

    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(readStatusError(response))
    }

    const raw = await readBoundedResponseText(response)
    let payload: Record<string, unknown> | null = null
    try {
        payload = asRecord(JSON.parse(raw))
    } catch {
        throw new Error('ChatGPT returned an invalid transcription response.')
    }
    const text = readNonEmptyString(payload?.['text']) || readNonEmptyString(payload?.['transcript'])
    if (!text || text.length > CODEX_VOICE_MAX_TRANSCRIPT_CHARS) {
        throw new Error('ChatGPT returned an invalid transcription response.')
    }
    return text
}

export async function transcribeVoiceWithCodex(input: AssistantTranscribeVoiceInput): Promise<string> {
    if (activeTranscriptionRequests >= CODEX_VOICE_MAX_CONCURRENT_REQUESTS) {
        throw new Error('Too many voice transcriptions are already running. Try again shortly.')
    }
    activeTranscriptionRequests += 1
    try {
        return await transcribeCodexVoiceWithDependencies(input, {
            resolveCredentials: (refresh) => refresh ? refreshCodexVoiceCredentials() : readCodexVoiceCredentials(),
            requestTranscription: requestCodexVoiceTranscription
        })
    } finally {
        activeTranscriptionRequests -= 1
    }
}
