import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AssistantActivity, AssistantDomainEvent, AssistantSnapshot } from '../src/shared/assistant/contracts'
import { AssistantActivityDeltaBuffer } from '../src/main/assistant/assistant-activity-delta-buffer'
import {
    analyzeAssistantReadResult,
    buildAssistantReadPreview
} from '../src/shared/assistant/read-activity'
import { isAssistantToolLifecycleStartEvent } from '../src/shared/assistant/tool-lifecycle'
import { coalesceAssistantPersistenceEvents } from '../src/main/assistant/persistence-event-batching'
import {
    collapseAssistantDeltaEvents,
    isAssistantStreamingPresentationEvent
} from '../src/renderer/src/lib/assistant/event-batching'
import {
    assistantStreamPresentation,
    mergeAssistantPresentationText
} from '../src/renderer/src/lib/assistant/assistant-stream-presentation'
import {
    getAssistantInitialVisibleText,
    getAssistantStreamRevealCount,
    revealAssistantStreamText
} from '../src/renderer/src/pages/assistant/useAssistantVisibleText'
import {
    RENDERER_VISIBILITY_RESUME_GRACE_MS,
    RendererVisibilityStore,
    shouldSnapRendererPresentation,
    type RendererVisibilitySource
} from '../src/renderer/src/lib/renderer-visibility'

class FakeRendererVisibilitySource implements RendererVisibilitySource {
    visibilityState: DocumentVisibilityState = 'visible'
    private readonly listeners = new Set<EventListener>()

    addEventListener(_type: 'visibilitychange', listener: EventListener): void {
        this.listeners.add(listener)
    }

    removeEventListener(_type: 'visibilitychange', listener: EventListener): void {
        this.listeners.delete(listener)
    }

    setVisibility(visibilityState: DocumentVisibilityState): void {
        this.visibilityState = visibilityState
        for (const listener of this.listeners) listener(new Event('visibilitychange'))
    }
}

function event(
    sequence: number,
    type: AssistantDomainEvent['type'],
    payload: Record<string, unknown>
): AssistantDomainEvent {
    return {
        sequence,
        eventId: `event-${sequence}`,
        type,
        occurredAt: `2026-07-25T00:00:${String(sequence).padStart(2, '0')}.000Z`,
        sessionId: 'session-1',
        threadId: 'thread-1',
        payload
    }
}

const textDeltaA = event(1, 'thread.message.assistant.delta', {
    threadId: 'thread-1',
    messageId: 'message-1',
    delta: 'Hello '
})
const unrelatedUpdate = event(2, 'thread.updated', {
    threadId: 'thread-1',
    patch: { updatedAt: '2026-07-25T00:00:02.000Z' }
})
const textDeltaB = event(3, 'thread.message.assistant.delta', {
    threadId: 'thread-1',
    messageId: 'message-1',
    delta: 'world'
})
const collapsed = collapseAssistantDeltaEvents([textDeltaA, unrelatedUpdate, textDeltaB])
assert.equal(collapsed.length, 2, 'interleaved deltas should project as one authoritative update')
assert.equal(collapsed[0]?.sequence, 2, 'unrelated events must retain sequence order')
assert.equal(collapsed[1]?.sequence, 3)
assert.equal(collapsed[1]?.payload['delta'], 'Hello world')
assert.equal(isAssistantStreamingPresentationEvent(textDeltaA), true)

const streamingActivity: AssistantActivity = {
    id: 'activity-1',
    kind: 'assistant.internal',
    tone: 'tool',
    summary: 'Internal message',
    detail: 'Checking the project',
    turnId: 'turn-1',
    createdAt: '2026-07-25T00:00:01.000Z',
    payload: { status: 'streaming', output: 'Checking the project' }
}
const activityEvent = event(4, 'thread.activity.appended', {
    threadId: 'thread-1',
    activity: streamingActivity
})
assert.equal(isAssistantStreamingPresentationEvent(activityEvent), true)

const editStartEvent = event(5, 'thread.activity.appended', {
    threadId: 'thread-1',
    activity: {
        id: 'edit-activity',
        kind: 'file-change',
        tone: 'tool',
        summary: 'Editing files',
        turnId: 'turn-1',
        createdAt: '2026-07-25T00:00:05.000Z',
        payload: { status: 'running', toolLifecyclePhase: 'start', paths: ['src/app.ts'] }
    }
})
const editEndEvent = event(6, 'thread.activity.appended', {
    threadId: 'thread-1',
    activity: {
        id: 'edit-activity',
        kind: 'file-change',
        tone: 'tool',
        summary: 'Edited file',
        turnId: 'turn-1',
        createdAt: '2026-07-25T00:00:05.000Z',
        payload: { status: 'completed', toolLifecyclePhase: 'end', paths: ['src/app.ts'] }
    }
})
assert.equal(isAssistantToolLifecycleStartEvent(editStartEvent), true)
assert.deepEqual(
    collapseAssistantDeltaEvents([editStartEvent, editEndEvent]).map((entry) => entry.sequence),
    [5, 6],
    'a fast completion must not erase Pi’s tool start lifecycle boundary'
)

const shortReadOutput = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n')
const shortReadPreview = buildAssistantReadPreview(shortReadOutput)
assert.equal(shortReadPreview.text, shortReadOutput, 'short Read output remains complete when expanded')
assert.equal(shortReadPreview.presentationTruncated, false)

const longReadOutput = Array.from({ length: 75 }, (_, index) => `line ${index + 1}`).join('\n')
const longReadPreview = buildAssistantReadPreview(longReadOutput)
assert.equal(longReadPreview.displayedLines, 50)
assert.equal(longReadPreview.totalReadLines, 75)
assert.equal(longReadPreview.presentationTruncated, true, 'expanded Read output is presentation-bounded to 50 lines')
assert.equal(longReadPreview.text.split('\n').at(-1), 'line 50')

const partialReadBody = Array.from({ length: 50 }, (_, index) => `line ${index + 51}`).join('\n')
const partialReadOutput = `${partialReadBody}\n\n[Showing lines 51-100 of 240. Use offset=101 to continue.]`
const partialRead = analyzeAssistantReadResult({
    args: { path: 'src/app.ts', offset: 51, limit: 50 },
    output: partialReadOutput,
    status: 'completed'
})
assert.equal(partialRead.readStartLine, 51)
assert.equal(partialRead.readEndLine, 100)
assert.equal(partialRead.readLineCount, 50)
assert.equal(partialRead.readTotalLines, 240)
assert.equal(partialRead.readComplete, false)
assert.equal(buildAssistantReadPreview(partialReadOutput).continuationNotice?.startsWith('[Showing lines 51-100'), true)

const assistantMainServiceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const assistantStoreSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
const assistantVisibleTextSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantVisibleText.ts', import.meta.url), 'utf8')
const assistantVirtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const instructorConversationSource = readFileSync(new URL('../src/renderer/src/pages/assistant/InstructorVoiceConversation.tsx', import.meta.url), 'utf8')
const instructorLiveTranscriptSource = readFileSync(new URL('../src/renderer/src/pages/assistant/InstructorVoiceLiveTranscript.tsx', import.meta.url), 'utf8')
const strandsSource = readFileSync(new URL('../src/renderer/src/components/ui/strands/Strands.tsx', import.meta.url), 'utf8')
const desktopMainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
assert.match(
    assistantMainServiceSource,
    /isAssistantToolLifecycleStartEvent\(event\)[\s\S]*?this\.flushBroadcastEvents\(\)/,
    'main IPC batching must flush a Pi tool start before a fast completion can join its batch'
)
assert.match(
    assistantStoreSource,
    /isAssistantToolLifecycleStartEvent\(event\)[\s\S]*?this\.flushPendingAssistantEvents\(\)/,
    'renderer projection must commit a new running tool row without the normal stream checkpoint delay'
)
assert.match(
    assistantStoreSource,
    /rendererVisibility\.subscribe\([\s\S]*?getSnapshot\(\)\.visible[\s\S]*?flushPendingAssistantEvents\(\)/,
    'restoring the renderer must flush one authoritative projection instead of leaving RAF work queued'
)
assert.match(
    assistantVisibleTextSource,
    /shouldSnapRendererPresentation[\s\S]*?assistantStreamPresentation\.getSnapshot\(channel, streamId\)/,
    'visible text must read the latest stream snapshot when hidden presentation is reconciled'
)
assert.match(
    assistantVirtualTimelineSource,
    /shouldSnapRendererPresentation[\s\S]*?clearCompletionEndFollow\(\)[\s\S]*?cancelEndAlignment\(\)[\s\S]*?scrollToEnd\(\{ animated: false \}\)/,
    'hidden timeline presentation collapses pending follow work into one non-animated end alignment'
)
assert.equal(
    assistantVirtualTimelineSource.includes('scrollElement.scrollTop ='),
    false,
    'hidden reconciliation leaves viewport ownership with LegendList'
)
assert.match(
    instructorConversationSource,
    /reduceMotion \|\| shouldSnap \? 'auto' : 'smooth'/,
    'voice conversation scrolling must become immediate across hidden time'
)
assert.match(
    instructorLiveTranscriptSource,
    /useLayoutEffect\(\(\) => \{[\s\S]{0,180}viewport\.scrollTop = viewport\.scrollHeight/,
    'voice transcript scrolling must settle directly without animation batches'
)
assert.doesNotMatch(
    instructorLiveTranscriptSource,
    /requestAnimationFrame|behavior:\s*'smooth'|scrollToLatest/,
    'the live Voice transcript must not retain an animated scroll queue while hidden'
)
assert.match(
    strandsSource,
    /snapPresentationToProps[\s\S]*?rendererVisibility\.subscribe\(reconcileVisibility\)/,
    'decorative WebGL state must pause and snap current props on restore'
)
assert.match(
    desktopMainSource,
    /webviewTag: false,[\s\S]{0,240}?backgroundThrottling: true/,
    'the main renderer should disable webview tags and pause hidden presentation rather than animate off-screen'
)
assert.match(
    readFileSync(new URL('../src/main/browser-view-manager.ts', import.meta.url), 'utf8'),
    /backgroundThrottling: false/,
    'main-owned Browser pages retain their existing background execution policy'
)

const visibilitySource = new FakeRendererVisibilitySource()
const visibilityStore = new RendererVisibilityStore(visibilitySource)
let visibilityNotifications = 0
const unsubscribeVisibility = visibilityStore.subscribe(() => {
    visibilityNotifications += 1
})
assert.deepEqual(visibilityStore.getSnapshot(), {
    visible: true,
    revision: 0,
    resumeRevision: 0,
    resumedAt: null
})
visibilitySource.setVisibility('hidden')
const hiddenVisibility = visibilityStore.getSnapshot()
assert.deepEqual(hiddenVisibility, {
    visible: false,
    revision: 1,
    resumeRevision: 0,
    resumedAt: null
})
assert.equal(shouldSnapRendererPresentation(hiddenVisibility, 0), true)
visibilitySource.setVisibility('visible')
const restoredVisibility = visibilityStore.getSnapshot()
assert.equal(restoredVisibility.visible, true)
assert.equal(restoredVisibility.revision, 2)
assert.equal(restoredVisibility.resumeRevision, 1)
assert.equal(typeof restoredVisibility.resumedAt, 'number')
const resumedAt = restoredVisibility.resumedAt as number
assert.equal(shouldSnapRendererPresentation(restoredVisibility, 0, resumedAt), true)
assert.equal(shouldSnapRendererPresentation(restoredVisibility, 1, resumedAt + 1), true)
assert.equal(
    shouldSnapRendererPresentation(
        restoredVisibility,
        1,
        resumedAt + RENDERER_VISIBILITY_RESUME_GRACE_MS + 1
    ),
    false
)
assert.equal(visibilityNotifications, 2)
unsubscribeVisibility()

assistantStreamPresentation.clear()
let presentationNotifications = 0
const unsubscribeMessage = assistantStreamPresentation.subscribe('message', 'message-1', () => {
    presentationNotifications += 1
})
assistantStreamPresentation.ingestEvent(textDeltaA)
assistantStreamPresentation.ingestEvent(textDeltaB)
assert.deepEqual(assistantStreamPresentation.getSnapshot('message', 'message-1'), {
    text: 'Hello world',
    streaming: true,
    revision: 2
})
assistantStreamPresentation.ingestEvent(event(5, 'thread.message.assistant.completed', {
    threadId: 'thread-1',
    messageId: 'message-1',
    text: 'Hello world!'
}))
assert.equal(assistantStreamPresentation.getSnapshot('message', 'message-1').text, 'Hello world!')
assert.equal(assistantStreamPresentation.getSnapshot('message', 'message-1').streaming, false)
assert.equal(presentationNotifications, 3)
unsubscribeMessage()

assistantStreamPresentation.clear()
assistantStreamPresentation.ingestEvent(textDeltaB, 'Hello ')
assert.deepEqual(assistantStreamPresentation.getSnapshot('message', 'message-1'), {
    text: 'Hello world',
    streaming: true,
    revision: 1
}, 'a late presentation subscriber seeds its short-lived stream from the projected authoritative prefix')

assistantStreamPresentation.ingestEvent(activityEvent)
assert.deepEqual(assistantStreamPresentation.getSnapshot('activity', 'activity-1'), {
    text: 'Checking the project',
    streaming: true,
    revision: 1
})
assert.equal(mergeAssistantPresentationText('saved prefix ', 'new suffix'), 'saved prefix new suffix')
assert.equal(mergeAssistantPresentationText('Hello ', 'Hello world'), 'Hello world')
assert.equal(mergeAssistantPresentationText('Hello world', 'world'), 'Hello world')
assert.equal(mergeAssistantPresentationText('prefix overlap', 'overlap suffix'), 'prefix overlap suffix')

const bufferedActivityEntries: string[] = []
const activityBuffer = new AssistantActivityDeltaBuffer({
    flushDelayMs: 10_000,
    onFlush: (entry) => bufferedActivityEntries.push(entry.delta)
})
activityBuffer.queue({
    sessionId: 'session-1',
    threadId: 'thread-1',
    activityId: 'activity-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    streamKind: 'reasoning_text',
    delta: 'Checking ',
    occurredAt: '2026-07-25T00:00:01.000Z'
})
activityBuffer.queue({
    sessionId: 'session-1',
    threadId: 'thread-1',
    activityId: 'activity-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    streamKind: 'reasoning_text',
    delta: 'files',
    occurredAt: '2026-07-25T00:00:02.000Z'
})
activityBuffer.flush({ threadId: 'thread-1' })
assert.deepEqual(bufferedActivityEntries, ['Checking files'])
activityBuffer.dispose()

const fakeSnapshot = { snapshotSequence: 0 } as AssistantSnapshot
const persisted = coalesceAssistantPersistenceEvents([
    { event: textDeltaA, snapshot: fakeSnapshot },
    { event: unrelatedUpdate, snapshot: fakeSnapshot },
    { event: textDeltaB, snapshot: fakeSnapshot },
    { event: activityEvent, snapshot: fakeSnapshot },
    {
        event: event(5, 'thread.activity.appended', {
            threadId: 'thread-1',
            activity: {
                ...streamingActivity,
                detail: 'Checking the project files',
                payload: { status: 'completed', output: 'Checking the project files' }
            }
        }),
        snapshot: fakeSnapshot
    }
])
assert.deepEqual(persisted.map((entry) => entry.event.sequence), [2, 3, 5])

assert.equal(getAssistantInitialVisibleText('first burst', true), 'first burst')
assert.equal(getAssistantInitialVisibleText('settled response', false), 'settled response')
assert.equal(getAssistantInitialVisibleText('A'.repeat(500), true).length, 500)
assert.equal(getAssistantStreamRevealCount(100, 'stream', false), 10)
assert.equal(getAssistantStreamRevealCount(100, 'stream', true), 20)
let visible = ''
const target = 'A'.repeat(100)
let frames = 0
const normalBurstBudget = getAssistantStreamRevealCount(target.length, 'stream', false)
while (visible !== target && frames < 20) {
    const next = revealAssistantStreamText(visible, target, 'stream', false, normalBurstBudget)
    assert.ok(next.startsWith(visible), 'the visual stream must only reveal an additional prefix')
    visible = next
    frames += 1
}
assert.equal(visible, target)
assert.ok(frames <= 10, 'a normal burst should drain within its bounded visual lag')

visible = ''
frames = 0
const completionBurstBudget = getAssistantStreamRevealCount(target.length, 'stream', true)
while (visible !== target && frames < 20) {
    visible = revealAssistantStreamText(visible, target, 'stream', true, completionBurstBudget)
    frames += 1
}
assert.equal(visible, target)
assert.ok(frames <= 5, 'completion should drain its remaining text quickly')
assert.equal(revealAssistantStreamText('', '🙂 done', 'stream', false), '🙂', 'a frame must not split a surrogate pair')
assert.equal(revealAssistantStreamText('', 'one complete phrase, then more', 'chunks', false), '', 'chunk mode waits for a complete paragraph/line or completion')

assistantStreamPresentation.clear()
console.log('Assistant streaming contracts passed.')
