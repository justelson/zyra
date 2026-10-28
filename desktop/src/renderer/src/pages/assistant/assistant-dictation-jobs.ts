import { areComposerContextFilesEqual, readAssistantComposerSessionState, writeAssistantComposerSessionState, type AssistantComposerSessionState } from './assistant-composer-session-state'

export type AssistantDictationOwner = {
    read: () => AssistantComposerSessionState
    apply: (state: AssistantComposerSessionState) => void
}
const owners = new Map<string, AssistantDictationOwner>()

export function registerAssistantDictationOwner(key: string, owner: AssistantDictationOwner): () => void {
    owners.set(key, owner)
    return () => { if (owners.get(key) === owner) owners.delete(key) }
}

export function appendAssistantDictation(text: string, transcript: string): string {
    const spoken = transcript.trim()
    if (!spoken) return text
    return !text.trim() ? spoken : `${text}${/\s$/.test(text) ? '' : ' '}${spoken}`
}

/** A recording owns its target and dispatch closure, never the currently selected composer. */
export function createAssistantDictationJob(input: {
    ownerKey: string
    sessionId?: string | null
    initialState: AssistantComposerSessionState
    send?: (draft: string) => Promise<boolean>
    sentContextFiles?: AssistantComposerSessionState['contextFiles']
}) {
    let cancelled = false
    let fallback = input.initialState
    let segment: { before: string; start: number; value: string } | null = null
    const read = () => owners.get(input.ownerKey)?.read()
        || (input.sessionId ? readAssistantComposerSessionState(input.sessionId, fallback) : fallback)
    const apply = (state: AssistantComposerSessionState) => {
        fallback = state
        const owner = owners.get(input.ownerKey)
        if (owner) owner.apply(state)
        else if (input.sessionId) writeAssistantComposerSessionState(input.sessionId, state)
    }
    const submit = async (draft: string) => {
        if (cancelled || !input.send) return
        const submitted = read()
        // Do not optimistically clear: a rejected send keeps the complete transcript.
        if (!await input.send(draft) || cancelled) return
        const latest = read()
        if ((latest.draft || '') !== draft) return
        // Attachments added or changed while dispatch awaited acceptance belong to the user.
        if (!areComposerContextFilesEqual(latest.contextFiles, submitted.contextFiles)) return
        const sentFiles = input.sentContextFiles || submitted.contextFiles || []
        apply({ ...latest, draft: '', contextFiles: (latest.contextFiles || []).filter(file =>
            !sentFiles.some(sent => areComposerContextFilesEqual([sent], [file]))) })
    }
    return {
        cancel() { cancelled = true },
        get cancelled() { return cancelled },
        /** Live browser results replace only the unchanged segment owned by this recording. */
        transcript(spoken: string, live = false): string {
            const state = read()
            const current = state.draft || ''
            if (cancelled || (live && !spoken.trim())) return current
            let next: string
            if (live && segment) {
                // Map the segment through a single user edit using common prefix/suffix.
                const previous = segment.before
                let prefix = 0
                while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++
                let suffix = 0
                while (suffix < previous.length - prefix && suffix < current.length - prefix
                    && previous[previous.length - suffix - 1] === current[current.length - suffix - 1]) suffix++
                const end = segment.start + segment.value.length
                const start = prefix >= end ? segment.start
                    : previous.length - suffix <= segment.start ? segment.start + current.length - previous.length : -1
                // Once the user edits dictated text, it belongs to them. Never replace it.
                if (start < 0 || current.slice(start, start + segment.value.length) !== segment.value) return current
                const value = spoken.trim()
                next = current.slice(0, start) + value + current.slice(start + segment.value.length)
                segment = { before: next, start, value }
            } else {
                next = appendAssistantDictation(current, spoken)
                if (live) segment = { before: next, start: next.length - spoken.trim().length, value: spoken.trim() }
            }
            apply({ ...state, draft: next })
            return next
        },
        submit,
        /** Capture text at the explicit send gesture, before the transcription awaits. */
        captureSubmission() {
            const capturedDraft = read().draft || ''
            return (spoken: string) => submit(appendAssistantDictation(capturedDraft, spoken))
        }
    }
}
export type AssistantDictationJob = ReturnType<typeof createAssistantDictationJob>
