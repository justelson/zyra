import type { AssistantTranscribeVoiceInput } from '../../shared/assistant/contracts'

/** Cancellation is scoped to the requesting window/client, never the account. */
export class VoiceTranscriptionJobs {
    private readonly jobs = new Map<string, AbortController>()
    constructor(
        private readonly transcribe: (
            input: AssistantTranscribeVoiceInput,
            signal: AbortSignal,
        ) => Promise<string>,
        private readonly recoverRejected?: (input: AssistantTranscribeVoiceInput, error: Error) => Promise<void>,
    ) {}
    async run(owner: string, input: AssistantTranscribeVoiceInput): Promise<string> {
        if (!input || typeof input !== 'object') throw new Error('A voice recording is required.')
        if (!input.requestId) return this.transcribe(input, new AbortController().signal)
        if (!/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new Error('Invalid voice transcription request.')
        const key = `${owner}:${input.requestId}`
        if (this.jobs.has(key)) throw new Error('This voice transcription is already running.')
        if (this.jobs.size >= 2) {
            const error = new Error(`Too many voice transcriptions are already running. ${this.recoverRejected ? 'The recording is available in transcription history.' : 'Try again shortly.'}`)
            await this.recoverRejected?.(input, error)
            throw error
        }
        const controller = new AbortController()
        this.jobs.set(key, controller)
        try {
            return await this.transcribe(input, controller.signal)
        } finally {
            this.jobs.delete(key)
        }
    }
    cancel(owner: string, requestId: string): boolean {
        const controller = this.jobs.get(`${owner}:${requestId}`)
        if (!controller) return false
        controller.abort(new Error('Voice transcription cancelled.'))
        return true
    }
    cancelAll(): void {
        for (const controller of this.jobs.values())
            controller.abort(new Error('Voice transcription cancelled.'))
    }
    cancelOwner(owner: string): void {
        for (const [key, controller] of this.jobs) {
            if (key.startsWith(`${owner}:`)) controller.abort(Object.assign(new Error('Voice transcription cancelled because its window closed. Recover the recording from history.'), { code: 'VOICE_OWNER_CLOSED' }))
        }
    }
}
