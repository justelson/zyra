import { applyAssistantTextUpdate } from '@shared/assistant/stream-text-update'
import type { AssistantActivity, AssistantDomainEvent } from '@shared/assistant/contracts'

export type AssistantStreamPresentationChannel = 'message' | 'activity'

export type AssistantStreamPresentationSnapshot = {
    text: string
    streaming: boolean
    revision: number
}

const EMPTY_STREAM_PRESENTATION_SNAPSHOT: AssistantStreamPresentationSnapshot = Object.freeze({
    text: '',
    streaming: false,
    revision: 0
})
const MAX_STREAM_PRESENTATION_RECORDS = 256

function streamKey(channel: AssistantStreamPresentationChannel, id: string): string {
    return `${channel}:${id}`
}

function readMessageId(event: AssistantDomainEvent): string {
    return String(event.payload['messageId'] || '')
}

function readActivity(event: AssistantDomainEvent): AssistantActivity | null {
    const activity = event.payload['activity']
    return activity && typeof activity === 'object' ? activity as AssistantActivity : null
}

function readActivityOutput(activity: AssistantActivity): string {
    const output = activity.payload?.['output']
    if (typeof output === 'string') return output
    return typeof activity.detail === 'string' ? activity.detail : ''
}

function normalizeStreamStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[-_\s]/g, '')
}

export function isAssistantActivityStreaming(activity: AssistantActivity): boolean {
    return ['streaming', 'running', 'inprogress', 'pending', 'started']
        .includes(normalizeStreamStatus(activity.payload?.['status']))
}

export function mergeAssistantPresentationText(baseText: string, streamedText: string): string {
    if (!streamedText) return baseText
    if (!baseText) return streamedText
    if (streamedText.startsWith(baseText)) return streamedText
    if (baseText.endsWith(streamedText)) return baseText

    const overlapLimit = Math.min(baseText.length, streamedText.length)
    for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
        if (baseText.endsWith(streamedText.slice(0, overlap))) {
            return `${baseText}${streamedText.slice(overlap)}`
        }
    }
    return `${baseText}${streamedText}`
}

class AssistantStreamPresentationStore {
    private readonly records = new Map<string, AssistantStreamPresentationSnapshot>()
    private readonly listeners = new Map<string, Set<() => void>>()

    getSnapshot(channel: AssistantStreamPresentationChannel, id: string): AssistantStreamPresentationSnapshot {
        return this.records.get(streamKey(channel, id)) || EMPTY_STREAM_PRESENTATION_SNAPSHOT
    }

    subscribe(channel: AssistantStreamPresentationChannel, id: string, listener: () => void): () => void {
        const key = streamKey(channel, id)
        const listeners = this.listeners.get(key) || new Set<() => void>()
        listeners.add(listener)
        this.listeners.set(key, listeners)
        return () => {
            listeners.delete(listener)
            if (listeners.size === 0) this.listeners.delete(key)
        }
    }

    ingestEvent(event: AssistantDomainEvent, projectedText = ''): void {
        if (event.type === 'thread.message.assistant.delta') {
            const id = readMessageId(event)
            if (!id) return
            const previous = this.getSnapshot('message', id)
            const baseText = previous.revision > 0 ? previous.text : projectedText
            this.publish('message', id, applyAssistantTextUpdate(baseText, event.payload), true)
            return
        }

        if (event.type === 'thread.message.assistant.completed') {
            const id = readMessageId(event)
            if (!id) return
            const previous = this.getSnapshot('message', id)
            const completedText = typeof event.payload['text'] === 'string'
                ? event.payload['text'] as string
                : previous.text
            this.publish('message', id, completedText, false)
            return
        }

        if (event.type !== 'thread.activity.appended') return
        const activity = readActivity(event)
        if (!activity?.id) return
        this.publish('activity', activity.id, readActivityOutput(activity), isAssistantActivityStreaming(activity))
    }

    clear(): void {
        const keys = [...this.records.keys()]
        this.records.clear()
        for (const key of keys) this.notify(key)
    }

    private publish(
        channel: AssistantStreamPresentationChannel,
        id: string,
        text: string,
        streaming: boolean
    ): void {
        const key = streamKey(channel, id)
        const previous = this.records.get(key)
        if (previous && previous.text === text && previous.streaming === streaming) return
        this.records.delete(key)
        this.records.set(key, {
            text,
            streaming,
            revision: (previous?.revision || 0) + 1
        })
        this.prune()
        this.notify(key)
    }

    private notify(key: string): void {
        for (const listener of this.listeners.get(key) || []) listener()
    }

    private prune(): void {
        if (this.records.size <= MAX_STREAM_PRESENTATION_RECORDS) return
        for (const [key] of this.records) {
            if (this.listeners.has(key)) continue
            this.records.delete(key)
            if (this.records.size <= MAX_STREAM_PRESENTATION_RECORDS) break
        }
    }
}

export const assistantStreamPresentation = new AssistantStreamPresentationStore()
