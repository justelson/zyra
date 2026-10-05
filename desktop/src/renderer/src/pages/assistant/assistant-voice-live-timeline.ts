import type {
    AssistantActivity,
    AssistantMessage,
    AssistantProposedPlan
} from '@shared/assistant/contracts'
import type { InstructorTranscriptEntry } from './instructor-voice-transcript'
import { filterVoiceHydrationReplay } from './assistant-voice-hydration-replay'

export type VoiceLiveTimelineProjection = {
    messages: AssistantMessage[]
    anchors: Map<string, number>
}

function transcriptSignature(role: 'user' | 'assistant', text: string): string {
    return `${role}\0${text.replace(/\s+/gu, ' ').trim()}`
}

export function projectVoiceLiveTimelineMessages(input: {
    transcript: InstructorTranscriptEntry[]
    canonicalMessages: AssistantMessage[]
    activities?: AssistantActivity[]
    proposedPlans?: AssistantProposedPlan[]
    voiceStartedAt: string | null
    previousAnchors?: ReadonlyMap<string, number>
    nowMs?: number
}): VoiceLiveTimelineProjection {
    const committedProviderItems = new Set(input.canonicalMessages
        .map((message) => message.providerItemId)
        .filter((value): value is string => Boolean(value)))
    const voiceStartedAtMs = Date.parse(input.voiceStartedAt || '')
    const missingIdentityCommitBudget = new Map<string, number>()
    if (Number.isFinite(voiceStartedAtMs)) {
        for (const message of input.canonicalMessages) {
            const createdAt = Date.parse(message.createdAt)
            if (message.providerItemId
                || (message.role !== 'user' && message.role !== 'assistant')
                || !Number.isFinite(createdAt)
                || createdAt < voiceStartedAtMs) continue
            const signature = transcriptSignature(message.role, message.text)
            missingIdentityCommitBudget.set(signature, (missingIdentityCommitBudget.get(signature) || 0) + 1)
        }
    }
    const projectableTranscript = filterVoiceHydrationReplay(
        input.transcript,
        input.canonicalMessages,
        input.voiceStartedAt
    ).filter((entry) => {
        if (!entry.text.trim()
            || entry.canonicalMessageId
            || entry.id.startsWith('local-composer-')
            || entry.id.startsWith('composer-response-')
            || committedProviderItems.has(entry.id)) return false
        if (!entry.final) return entry.role === 'user' || entry.role === 'assistant'
        const role = entry.role === 'user' ? 'user' : 'assistant'
        const signature = transcriptSignature(role, entry.text)
        const remaining = missingIdentityCommitBudget.get(signature) || 0
        if (remaining === 0) return true
        if (remaining === 1) missingIdentityCommitBudget.delete(signature)
        else missingIdentityCommitBudget.set(signature, remaining - 1)
        return false
    })

    const canonicalEntries = [
        ...input.canonicalMessages,
        ...(input.activities || []),
        ...(input.proposedPlans || [])
    ]
    const latestCanonicalMs = canonicalEntries.reduce((latest, entry) => {
        const createdAt = Date.parse(entry.createdAt)
        return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest
    }, 0)
    const highestSequence = canonicalEntries.reduce(
        (highest, entry) => Math.max(highest, entry.timelineSequence || 0),
        0
    )
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
    const anchors = new Map<string, number>()
    let previousAnchor = 0

    const messages = projectableTranscript.map((entry, index): AssistantMessage => {
        const role = entry.role === 'user' ? 'user' : 'assistant'
        const anchorKey = `${role}:${entry.id}`
        const previous = input.previousAnchors?.get(anchorKey)
        // Arrival fixes a message's place. Later tool events must not push
        // speech that introduced the work below the work itself.
        const anchor = Number.isFinite(previous) ? Number(previous) : Math.max(
            nowMs + index,
            latestCanonicalMs + index + 1,
            previousAnchor + 1
        )
        previousAnchor = anchor
        anchors.set(anchorKey, anchor)
        const createdAt = new Date(anchor).toISOString()
        return {
            id: `voice-live-${anchorKey}`,
            role,
            text: entry.text,
            turnId: `voice-live-turn-${anchorKey}`,
            streaming: !entry.final,
            timelineSequence: highestSequence + index + 1,
            providerItemId: entry.id,
            modality: 'voice',
            createdAt,
            updatedAt: new Date(anchor + Math.max(1, entry.text.length)).toISOString()
        }
    })

    return { messages, anchors }
}
