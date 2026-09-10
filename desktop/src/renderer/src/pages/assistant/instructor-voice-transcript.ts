import { isExtendedVoiceTranscriptPrefix } from '@shared/assistant/voice-transcript-reconciliation'

export interface InstructorTranscriptImage {
    id: string
    name: string
    dataUrl: string
}

export interface InstructorTranscriptEntry {
    id: string
    role: string
    text: string
    final: boolean
    transcriptSource?: 'turn' | 'chunk'
    canonicalMessageId?: string
    images?: InstructorTranscriptImage[]
}

export function latestStreamingVoiceTranscript(entries: InstructorTranscriptEntry[]): InstructorTranscriptEntry | null {
    return [...entries].reverse().find((entry) => !entry.final && entry.text.trim()) || null
}

type RealtimeTurn = {
    id: string
    role: string
    transcript: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

function readRealtimeTurn(value: unknown): RealtimeTurn | null {
    const turn = asRecord(value)
    const id = asNonEmptyString(turn?.id)
    const role = asNonEmptyString(turn?.role)
    if (!id || (role !== 'user' && role !== 'assistant')) return null
    return {
        id,
        role,
        transcript: typeof turn?.transcript === 'string' ? turn.transcript : ''
    }
}

function appendTranscriptDelta(currentValue: string, deltaValue: string): string {
    const current = currentValue
    const delta = current ? deltaValue : deltaValue.trimStart()
    if (!current) return delta
    if (delta.startsWith(current)) return delta
    if (current.endsWith(delta)) return current
    const maxOverlap = Math.min(current.length, delta.length)
    for (let size = maxOverlap; size > 0; size -= 1) {
        if (current.slice(-size) === delta.slice(0, size)) return `${current}${delta.slice(size)}`
    }
    return `${current}${delta}`
}

function removeMatchingComposerResponse(
    entries: InstructorTranscriptEntry[],
    role: string,
    text: string,
    providerItemId: string
): InstructorTranscriptEntry[] {
    if (role !== 'assistant' || !text) return entries
    const normalized = text.replace(/\s+/gu, ' ').trim()
    let index = -1
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
        const entry = entries[entryIndex]
        if (entry.id !== providerItemId
            && entry.id.startsWith('composer-response-')
            && entry.final
            && entry.text.replace(/\s+/gu, ' ').trim() === normalized) {
            index = entryIndex
            break
        }
    }
    return index < 0 ? entries : entries.filter((_, entryIndex) => entryIndex !== index)
}

function updateEntry(
    entries: InstructorTranscriptEntry[],
    id: string,
    update: (entry: InstructorTranscriptEntry) => InstructorTranscriptEntry
): InstructorTranscriptEntry[] {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index < 0) return entries
    const next = entries.slice()
    next[index] = update(entries[index])
    return next
}

function latestMirroredChunk(entries: InstructorTranscriptEntry[], role: string): InstructorTranscriptEntry | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry.role === role && entry.transcriptSource === 'chunk' && !entry.final) return entry
    }
    return undefined
}

function discardMirroredChunks(entries: InstructorTranscriptEntry[], role: string): InstructorTranscriptEntry[] {
    const mirrored = (entry: InstructorTranscriptEntry) => entry.role === role && entry.transcriptSource === 'chunk' && !entry.final
    return entries.some(mirrored) ? entries.filter(entry => !mirrored(entry)) : entries
}

function findActiveTranscriptEntry(entries: InstructorTranscriptEntry[], role: string): InstructorTranscriptEntry | null {
    let active: InstructorTranscriptEntry | null = null
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry.role !== role) continue
        if (entry.final) break
        // Different speakers can overlap, but multiple unfinished utterances of
        // the same speaker require an explicit provider identity to resolve.
        if (active) return null
        active = entry
    }
    return active
}

function findTranscriptCompletionTarget(
    entries: InstructorTranscriptEntry[],
    id: string,
    role: string
): InstructorTranscriptEntry | null {
    const existing = entries.find((entry) => entry.id === id)
    if (existing) return existing
    return findActiveTranscriptEntry(entries, role)
}

function removeAdjacentUserPrefix(
    entries: InstructorTranscriptEntry[],
    completedEntryId: string
): InstructorTranscriptEntry[] {
    const completedIndex = entries.findIndex((entry) => entry.id === completedEntryId)
    if (completedIndex <= 0) return entries
    const completed = entries[completedIndex]
    const previous = entries[completedIndex - 1]
    if (completed.role !== 'user'
        || previous.role !== 'user'
        || !completed.final
        || !previous.final
        || !isExtendedVoiceTranscriptPrefix(previous.text, completed.text)) return entries
    return entries.filter((_, index) => index !== completedIndex - 1)
}

/**
 * Applies the identity-bearing transcript events emitted on ChatGPT realtime v3's
 * WebRTC data channel. Turn IDs are the source of truth, so replaying a turn
 * updates its existing bubble while an intentional repeat receives a new ID.
 */
export function applyRealtimeTranscriptEvent(
    entries: InstructorTranscriptEntry[],
    value: unknown
): InstructorTranscriptEntry[] {
    const payload = asRecord(value)
    const type = asNonEmptyString(payload?.type)

    if (type === 'turn.created') {
        const turn = readRealtimeTurn(payload?.turn)
        if (!turn) return entries
        const provisional = latestMirroredChunk(entries, turn.role)
        const logicalEntries = discardMirroredChunks(entries, turn.role)
        const existing = logicalEntries.find((entry) => entry.id === turn.id)
        if (existing) {
            if (existing.final && existing.transcriptSource === 'turn') return logicalEntries
            return updateEntry(logicalEntries, turn.id, (entry) => ({
                ...entry,
                transcriptSource: 'turn',
                ...(entry.final ? {} : { role: turn.role, text: turn.transcript.trimStart() || entry.text })
            }))
        }
        return [...logicalEntries, {
            id: turn.id,
            role: turn.role,
            text: turn.transcript.trimStart() || provisional?.text || '',
            final: false,
            transcriptSource: 'turn'
        }]
    }

    if (type === 'turn.delta') {
        const turnId = asNonEmptyString(payload?.turn_id)
        const delta = typeof payload?.delta === 'string' ? payload.delta : ''
        if (!turnId || !delta) return entries
        return updateEntry(entries, turnId, (entry) => entry.final ? entry : {
            ...entry,
            text: appendTranscriptDelta(entry.text, delta),
            transcriptSource: 'turn'
        })
    }

    if (type === 'turn.done') {
        const turn = readRealtimeTurn(payload?.turn)
        if (!turn) return entries
        const provisional = latestMirroredChunk(entries, turn.role)
        const text = turn.transcript.trim() || provisional?.text.trim() || ''
        const logicalEntries = discardMirroredChunks(entries, turn.role)
        const deduplicatedEntries = removeMatchingComposerResponse(logicalEntries, turn.role, text, turn.id)
        const streamingEntry = findTranscriptCompletionTarget(
            deduplicatedEntries,
            turn.id,
            turn.role
        )
        const completedEntries: InstructorTranscriptEntry[] = streamingEntry
            ? updateEntry(deduplicatedEntries, streamingEntry.id, (entry) => ({
                ...entry,
                id: turn.id,
                role: turn.role,
                text: text || entry.text,
                final: true,
                transcriptSource: 'turn'
            }))
            : [...deduplicatedEntries, {
                id: turn.id,
                role: turn.role,
                text,
                final: true,
                transcriptSource: 'turn'
            }]
        return removeAdjacentUserPrefix(completedEntries, turn.id)
    }

    const item = asRecord(payload?.item)
    const itemId = asNonEmptyString(item?.id)
        || asNonEmptyString(payload?.item_id)
        || asNonEmptyString(payload?.turn_id)
    const explicitRole = asNonEmptyString(item?.role) || asNonEmptyString(payload?.role)
    // Frameless emits conversation items for transcript chunks, not logical
    // utterances. Speech boundaries, turn events, and transcript data create
    // the visible entry; projecting this envelope would split one utterance.
    if (type === 'conversation.item.created') return entries
    const role = explicitRole === 'user'
        || type?.includes('input_transcript')
        || type?.includes('input_audio_transcription')
        ? 'user'
        : 'assistant'
    const delta = typeof payload?.delta === 'string'
        ? payload.delta
        : typeof item?.text === 'string'
            ? item.text
            : ''
    if (type === 'input_transcript.added' || type === 'output_transcript.added') {
        // Frameless sends each word through both chunk items and logical turns.
        // Once this speaker's turn stream is known, only that stream owns text.
        if (!delta || entries.some(entry => entry.role === role && entry.transcriptSource === 'turn')) return entries
        // Frameless v3 assigns an item ID to each transcript chunk rather than
        // to the whole turn. Keep the active role's chunks in one provisional
        // entry; turn.done below finalizes that entry with the complete text.
        const exact = itemId ? entries.find(entry => entry.id === itemId && !entry.final) : null
        const latest = entries.at(-1)
        const active = exact || (latest?.role === role && !latest.final ? latest : findActiveTranscriptEntry(entries, role))
        if (active) {
            return updateEntry(entries, active.id, (entry) => ({
                ...entry,
                text: appendTranscriptDelta(entry.text, delta),
                transcriptSource: 'chunk'
            }))
        }
        const fallbackId = itemId
            || asNonEmptyString(payload?.event_id)
            || asNonEmptyString(payload?.response_id)
            || `frameless-${role}-${entries.length + 1}`
        return [...entries, { id: fallbackId, role, text: delta.trimStart(), final: false, transcriptSource: 'chunk' }]
    }
    if (!itemId) return entries
    if (type?.endsWith('.transcript.delta')
        || type?.endsWith('.audio_transcript.delta')
        || type?.endsWith('.input_audio_transcription.delta')) {
        if (!delta) return entries
        const existing = entries.find((entry) => entry.id === itemId)
        if (!existing) return [...entries, { id: itemId, role, text: delta.trimStart(), final: false }]
        return updateEntry(entries, itemId, (entry) => entry.final ? entry : {
            ...entry,
            role,
            text: appendTranscriptDelta(entry.text, delta)
        })
    }
    if (type?.endsWith('.transcript.done')
        || type?.endsWith('.audio_transcript.done')
        || type?.endsWith('.input_audio_transcription.completed')) {
        const text = String(payload?.transcript ?? payload?.text ?? '').trim()
        const final = role === 'user'
        const deduplicatedEntries = final ? removeMatchingComposerResponse(entries, role, text, itemId) : entries
        const streamingEntry = findTranscriptCompletionTarget(deduplicatedEntries, itemId, role)
        const completedEntries = streamingEntry
            ? updateEntry(deduplicatedEntries, streamingEntry.id, (entry) => ({
                ...entry,
                id: itemId,
                role,
                text: text || entry.text,
                final
            }))
            : text ? [...deduplicatedEntries, { id: itemId, role, text, final }] : deduplicatedEntries
        return final ? removeAdjacentUserPrefix(completedEntries, itemId) : completedEntries
    }

    return entries
}
