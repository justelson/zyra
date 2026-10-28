import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAssistantDictationJob, registerAssistantDictationOwner } from '../src/renderer/src/pages/assistant/assistant-dictation-jobs'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState, type AssistantComposerSessionState } from '../src/renderer/src/pages/assistant/assistant-composer-session-state'

const storage = new Map<string, string>()
Object.assign(globalThis, {
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    window: new EventTarget()
})
const file = { id: 'captured', path: '/original.ts', name: 'original.ts', kind: 'code' as const }
let original: AssistantComposerSessionState = { draft: 'original', contextFiles: [file], model: 'old/model', effort: 'high', runtimeMode: 'full-access' }
let other: AssistantComposerSessionState = { draft: 'other typing', model: 'new/model' }
let ownerWrites = 0
const ownOriginal = () => registerAssistantDictationOwner('one', {
    read: () => original,
    apply: state => { original = state; ownerWrites++; writeAssistantComposerSessionState('one', state) }
})
let detach = ownOriginal()
const detachOther = registerAssistantDictationOwner('two', { read: () => other, apply: state => { other = state } })
const calls: { target: string; text: string; model?: string; files: typeof file[] }[] = []
let activeTarget = 'one'
const capturedTarget = activeTarget
const capturedModel = original.model
const capturedFiles = [file]
let accept!: (accepted: boolean) => void
const job = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original, sentContextFiles: capturedFiles,
    send: async text => {
        calls.push({ target: capturedTarget, text, model: capturedModel, files: capturedFiles })
        return new Promise<boolean>(resolve => { accept = resolve })
    }
})
// Simulate the composer flushing its unsaved draft and unregistering on navigation.
original = { ...original, draft: 'original plus typed edits' }
writeAssistantComposerSessionState('one', original)
detach()
activeTarget = 'two'
const result = job.transcript('late words')
assert.equal(result, 'original plus typed edits late words')
assert.equal(readAssistantComposerSessionState('one').draft, result, 'detached completion persists the original draft')
assert.equal(other.draft, 'other typing', 'completion never applies to the selected owner')
assert.equal(calls.length, 0, 'transcription alone cannot send')
const sending = job.submit(result)
assert.equal(calls.length, 1)
assert.equal(calls[0].target, 'one')
assert.equal(calls[0].model, 'old/model')
assert.deepEqual(calls[0].files, [file])
// Return to the original chat while send acceptance is pending, then edit it.
original = { ...readAssistantComposerSessionState('one'), draft: `${result} newer typing` }
detach = ownOriginal()
accept(true)
await sending
assert.equal(original.draft, `${result} newer typing`, 'accepted send cannot clear newer typed edits')
assert.equal(ownerWrites, 0)

const failure = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original, send: async () => false })
const failureDraft = failure.transcript('retained speech')
await failure.submit(failureDraft)
assert.equal(original.draft, failureDraft, 'rejection preserves the full transcript without optimistic clear')
const cancelled = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original, send: async () => { throw new Error('must not send') } })
cancelled.cancel()
assert.equal(cancelled.transcript('discard this'), failureDraft)
await cancelled.submit(failureDraft)
assert.equal(original.draft, failureDraft, 'explicit cancellation suppresses late text and send')

// Two pending recordings must merge against the latest backing state, not start snapshots.
detach()
const a = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original })
const b = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original })
a.transcript('first completion')
b.transcript('second completion')
assert.equal(readAssistantComposerSessionState('one').draft, `${failureDraft} first completion second completion`)
original = readAssistantComposerSessionState('one')
detach = ownOriginal()
const capturedOnly = createAssistantDictationJob({ ownerKey: 'one', sessionId: 'one', initialState: original, sentContextFiles: [file], send: async () => true })
original = { ...original, contextFiles: [file, { id: 'new', path: '/new.ts', name: 'new.ts' }] }
const acceptedDraft = capturedOnly.transcript('submitted')
await capturedOnly.submit(acceptedDraft)
assert.equal(original.draft, '')
assert.deepEqual(original.contextFiles?.map(item => item.id), ['new'], 'successful send removes only captured attachments')

// Edits after the explicit Send gesture are neither silently sent nor cleared.
original = { draft: 'clicked draft' }
let clickedPrompt = ''
const clickedJob = createAssistantDictationJob({ ownerKey: 'one', initialState: original,
    send: async text => { clickedPrompt = text; return true }
})
const clickedSubmission = clickedJob.captureSubmission()
original = { draft: 'clicked draft plus newer typing' }
clickedJob.transcript('late transcript')
await clickedSubmission('late transcript')
assert.equal(clickedPrompt, 'clicked draft late transcript', 'send text is captured before transcription awaits')
assert.equal(original.draft, 'clicked draft plus newer typing late transcript', 'post-click edits survive an accepted delayed transcription send')

// Browser partials own a replaceable segment, never the whole recording-start draft.
original = { draft: 'typed prefix' }
const browser = createAssistantDictationJob({ ownerKey: 'one', initialState: original })
browser.transcript('first partial', true)
original = { ...original, draft: `inserted ${original.draft} trailing edit` }
browser.transcript('second partial', true)
// A change on both sides is conservatively ambiguous, so preserve every user edit.
assert.equal(original.draft, 'inserted typed prefix first partial trailing edit')
original = { draft: 'prefix' }
const browser2 = createAssistantDictationJob({ ownerKey: 'one', initialState: original })
browser2.transcript('partial', true)
original = { draft: `${original.draft} typed tail` }
browser2.transcript('final words', true)
assert.equal(original.draft, 'prefix final words typed tail', 'browser updates replace only their segment, retaining typed suffixes')
original = { draft: 'prefix user corrected words typed tail' }
browser2.transcript('must not overwrite correction', true)
assert.equal(original.draft, 'prefix user corrected words typed tail', 'user edits inside dictated text are never overwritten')

// Structural wiring checks supplement the actual hook/controller Chromium fixture.
const controller = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantComposerController.ts', import.meta.url), 'utf8')
const hook = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantSpeechInput.ts', import.meta.url), 'utf8')
assert.match(controller, /registerAssistantDictationOwner/)
assert.match(controller, /latestDraftStatesRef\.current\.set\(normalizedSessionId, next\)/)
assert.match(controller, /window\.clearTimeout\(persistTimeoutRef\.current\)/)
assert.doesNotMatch(controller, /latestHandlersRef\.current\.handleSendTranscript/)
assert.doesNotMatch(hook, /textarea\.focus\(/, 'late transcription never steals focus')
assert.match(hook, /recoverRecordingRef\.current\(\)/)
detach(); detachOther()
console.log('dictation continuity: detached persistence, explicit captured dispatch, returned-owner CAS, concurrent completion, rejection/cancel, attachment preservation and browser segment edits: ok')
