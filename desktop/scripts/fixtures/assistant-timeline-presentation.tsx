import { createRef, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { TimelineTurnWorkSummary } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { useAssistantVisibleText } from '../../src/renderer/src/pages/assistant/useAssistantVisibleText'
import { assistantStreamPresentation } from '../../src/renderer/src/lib/assistant/assistant-stream-presentation'
import type { AssistantDomainEvent } from '../../src/shared/assistant/contracts'
import { useAssistantQueuedComposer } from '../../src/renderer/src/pages/assistant/useAssistantQueuedComposer'
import { TimelineWorkingIndicator } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkingIndicator'
import { hasActiveAssistantCompaction } from '../../src/shared/assistant/compaction-state'
import { useNonPassiveWheel } from '../../src/renderer/src/lib/useNonPassiveWheel'
import { TimelineMessage } from '../../src/renderer/src/pages/assistant/AssistantTimelineRows'
import { projectVoiceLiveTimelineMessages } from '../../src/renderer/src/pages/assistant/assistant-voice-live-timeline'
import { TimelineVoiceTaskStatus } from '../../src/renderer/src/pages/assistant/AssistantTimelineVoiceTask'
import { getTimelineEntries, buildTimelineRows } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const container = document.getElementById('root')!
const root = createRoot(container)
const listRef = createRef<LegendListRef>()
const scrollContainerRef = createRef<HTMLDivElement>()
const results: string[] = []
type TimelineProps = ComponentProps<typeof AssistantVirtualTimeline>
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 20))

function check(condition: boolean, label: string) {
    if (!condition) throw new Error(label)
}

async function waitFor(condition: () => boolean, label: string) {
    const deadline = performance.now() + 2_000
    while (!condition() && performance.now() < deadline) await pause()
    if (!condition()) {
        const viewport = scrollContainerRef.current
        const state = listRef.current?.getState()
        throw new Error(`${label}: ${JSON.stringify({ scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight, clientHeight: viewport?.clientHeight, contentLength: state?.contentLength, scrollLength: state?.scrollLength })}`)
    }
}

function rows(key: string): TimelineDisplayRow[] {
    return (['user', 'assistant'] as const).map(role => {
        const id = `${key}-${role}`
        const createdAt = '2026-01-01T00:00:00.000Z'
        return {
            id, kind: 'message', createdAt,
            message: { id, role, text: `${role} greeting`, turnId: key, streaming: false, createdAt, updatedAt: createdAt }
        }
    })
}

function render(key: string, overrides: Partial<TimelineProps> = {}) {
    flushSync(() => root.render(<AssistantVirtualTimeline
        rows={rows(key)} windowKey={key} listRef={listRef} scrollContainerRef={scrollContainerRef}
        contentInsetEndAdjustment={0} isWorking={false} selectionHydrating={false} coldStart
        hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
        loadOlderError={null} loadNewerError={null} onLoadOlder={() => false}
        renderRow={row => row.kind === 'message' ? <p>{row.message.text}</p> : null}
        {...overrides}
    />))
}

function loading() {
    return container.textContent?.includes('Loading chat') === true
}

async function expectVisible(key: string, label: string) {
    await waitFor(() => {
        const message = container.querySelector(`[data-assistant-timeline-row-id="${key}-assistant"]`)
        return Boolean(message && getComputedStyle(message).visibility === 'visible' && !loading())
    }, label)
    results.push(label)
}

async function run() {
    // Real React, LegendList, layout and animation frames; no mocked readiness state.
    render('first')
    await expectVisible('first', 'A cold one-turn chat reveals without a further render or user input')
    const originalList = listRef.current

    render('second')
    await expectVisible('second', 'Switching the reused timeline completes the new presentation')
    check(originalList === listRef.current, 'Chat switching must preserve the virtual list instance')

    const rapidLongRows = Array.from({ length: 80 }, (_, index) => rows(`rapid-long-${index}`)).flat()
    const rapidShortRows: TimelineDisplayRow[] = [...rows('rapid-short'), {
        kind: 'turn-work-summary', id: 'rapid-short-work', createdAt: '2026-01-01T00:00:01.000Z', turnId: 'rapid-short',
        startedAt: '2026-01-01T00:00:00.000Z', completedAt: null, running: true, terminalResponseVisible: false, outcome: null, rows: [], liveNarrationRow: null
    }]
    const rapidRenderer = (row: TimelineDisplayRow) => row.kind === 'turn-work-summary'
        ? <TimelineTurnWorkSummary startedAt={row.startedAt} completedAt={null} running hasWork renderChildren={() => <p>Current short-chat action</p>} />
        : <div style={{ height: 100 }}>{row.kind === 'message' ? row.message.text : ''}</div>
    for (let index = 0; index < 12; index++) {
        render('rapid-long', { rows: rapidLongRows, renderRow: rapidRenderer, coldStart: false })
        await new Promise(resolve => setTimeout(resolve, index % 3))
        render('rapid-short', { rows: rapidShortRows, renderRow: rapidRenderer, coldStart: false, isWorking: true })
        await new Promise(resolve => setTimeout(resolve, index % 2))
    }
    await waitFor(() => {
        const user = container.querySelector<HTMLElement>('[data-assistant-timeline-row-id="rapid-short-user"]')
        const assistant = container.querySelector<HTMLElement>('[data-assistant-timeline-row-id="rapid-short-assistant"]')
        const viewport = scrollContainerRef.current
        return Boolean(user && assistant && viewport && getComputedStyle(user).visibility === 'visible'
            && user.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top
            && assistant.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top
            && viewport.scrollHeight <= viewport.clientHeight + 2 && !loading())
    }, 'Rapid long/working-short switches retain the conversation and discard old virtual-list space')
    check(listRef.current === originalList, 'Rapid switching continues reusing the list without a remount workaround')
    results.push('Repeated rapid switches preserve messages, live work, and current-chat list geometry')

    render('hydrating', { rows: [], selectionHydrating: true })
    await pause()
    check(loading(), 'A chat with pending hydration stays in its loading presentation')
    render('hydrating')
    await expectVisible('hydrating', 'Delayed hydration reveals the newly received messages')

    let pageRequests = 0
    let resolvePage!: (accepted: boolean) => void
    const page = new Promise<boolean>(resolve => { resolvePage = resolve })
    render('paging', { hasOlder: true, onLoadOlder: () => { pageRequests++; return page } })
    await waitFor(() => pageRequests === 1, 'The underfilled initial viewport requests older history')
    check(loading(), 'Initial paging keeps the incomplete one-turn view hidden')
    render('paging', { rows: [...rows('older'), ...rows('paging')] })
    resolvePage(true)
    await expectVisible('paging', 'The completed initial page reveals the filled timeline')
    check(pageRequests === 1, 'Initial history requests cannot overlap')

    render('failed-page', { hasOlder: true, onLoadOlder: async () => { throw new Error('Page unavailable') } })
    await expectVisible('failed-page', 'A failed older page still reveals the available messages')

    let resolveAbandonedPage!: (accepted: boolean) => void
    let abandonedPageStarted = false
    const abandonedPage = new Promise<boolean>(resolve => { resolveAbandonedPage = resolve })
    render('abandoned', { hasOlder: true, onLoadOlder: () => { abandonedPageStarted = true; return abandonedPage } })
    await waitFor(() => abandonedPageStarted, 'The old chat starts paging')
    render('current', { rows: [], selectionHydrating: true })
    resolveAbandonedPage(true)
    await pause()
    check(loading(), 'An abandoned page cannot reveal the next chat before it hydrates')
    render('current')
    await expectVisible('current', 'Navigation during paging leaves the current chat usable')
    const historyRows = Array.from({ length: 80 }, (_, index) => rows(`send-history-${index}`)).flat()
    const renderTallRow = (row: TimelineDisplayRow) => <div style={{ height: 120 }}>{row.kind === 'message' ? row.message.text : 'Current work'}</div>
    const distanceFromEnd = () => {
        const element = scrollContainerRef.current!
        return element.scrollHeight - element.scrollTop - element.clientHeight
    }
    render('send-regression', { rows: historyRows, renderRow: renderTallRow, coldStart: false })
    await waitFor(() => Boolean(scrollContainerRef.current) && distanceFromEnd() < 96, 'The scroll fixture opens at the latest message')
    const viewport = scrollContainerRef.current!
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }))
    viewport.scrollTop = 1_000
    await waitFor(() => distanceFromEnd() > 500, 'Reading an older prompt deliberately leaves end-follow')
    await pause()
    render('send-regression', { rows: historyRows, renderRow: renderTallRow, coldStart: false, followLatestRequestKey: 'send:one' })
    const newPromptRows = [...historyRows, rows('new-prompt')[0]!]
    render('send-regression', { rows: newPromptRows, renderRow: renderTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:one' })
    await waitFor(() => distanceFromEnd() < 96, 'Sending a prompt resumes the latest edge instead of restoring an older prompt anchor')
    results.push('Sending from history abandons the previous prompt anchor and follows the new prompt')
    render('send-regression', { rows: [...newPromptRows, rows('new-prompt')[1]!], renderRow: renderTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:one' })
    await waitFor(() => distanceFromEnd() < 96, 'New updates remain visible after the send realigns the list')
    results.push('Follow-end remains active as the new response grows')
    const responseRows = [...newPromptRows, rows('new-prompt')[1]!]
    const renderVeryTallRow = (row: TimelineDisplayRow) => <div style={{ height: row.id === 'new-prompt-assistant' ? 2_000 : 120 }}>{row.kind === 'message' ? row.message.text : 'Current work'}</div>
    render('send-regression', { rows: responseRows.map(row => row.id === 'new-prompt-assistant' && row.kind === 'message' ? { ...row, message: { ...row.message, text: 'A much longer response', updatedAt: '2026-01-01T00:00:02.000Z' } } : row), renderRow: renderVeryTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:one' })
    await waitFor(() => distanceFromEnd() < 2, 'A response taller than the viewport cannot break active end-follow')
    results.push('Large response inserts and late row measurements keep the live edge visible')

    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }))
    viewport.scrollTop = 1_000
    await pause()
    const readingPosition = viewport.scrollTop
    render('send-regression', { rows: [...responseRows, rows('later-update')[1]!], renderRow: renderTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:one' })
    await pause()
    check(distanceFromEnd() > 500 && Math.abs(viewport.scrollTop - readingPosition) < 2, 'New response updates cannot steal the viewport after deliberate upward navigation')
    results.push('Manual history reading remains anchored until a fresh send or latest request')

    const anchor = viewport.querySelector<HTMLElement>('[data-assistant-timeline-row-id]')!
    anchor.dispatchEvent(new CustomEvent('assistant:timeline-disclosure-toggle', { bubbles: true, detail: { anchor, duration: 600 } }))
    render('send-regression', { rows: [...responseRows, rows('second-send')[0]!], renderRow: renderTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:two' })
    await waitFor(() => distanceFromEnd() < 2, 'A fresh send clears an older disclosure anchor')
    await new Promise(resolve => setTimeout(resolve, 750))
    check(distanceFromEnd() < 2, 'An older disclosure timeout cannot snap back after the send')
    results.push('Pending disclosure anchoring cannot reclaim the viewport after a second prompt')

    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }))
    viewport.scrollTop = 1_000
    await pause()
    viewport.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { detail: { animated: false } }))
    await waitFor(() => distanceFromEnd() < 2, 'The latest button explicitly resumes end-follow')
    render('send-regression', { rows: [...responseRows, ...rows('second-send'), rows('after-latest')[1]!], renderRow: renderTallRow, coldStart: false, isWorking: true, followLatestRequestKey: 'send:two' })
    await waitFor(() => distanceFromEnd() < 2, 'Updates keep following after clicking the latest button')
    results.push('The latest button restores ongoing follow rather than behaving like a history jump')
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }))
    viewport.scrollTop = 1_000
    await pause()
    const liveRows = [...Array.from({ length: 30 }, (_, index) => rows(`working-history-${index}`)).flat(), ...rows('live-working')]
    const liveRenderer = (row: TimelineDisplayRow) => <div style={{ height: row.id === 'live-working-assistant' ? 3_000 : 120 }}>{row.kind === 'message' ? row.message.text : 'Live work'}</div>
    render('live-working-chat', { rows: liveRows, renderRow: liveRenderer, isWorking: true, coldStart: false })
    await waitFor(() => distanceFromEnd() < 2, 'Opening a working chat reaches the latest work instead of its prompt')
    render('live-working-chat', { rows: [...liveRows, rows('live-new-update')[1]!], renderRow: liveRenderer, isWorking: true, coldStart: false })
    await waitFor(() => distanceFromEnd() < 2, 'The reopened working chat continues following new updates')
    results.push('Switching from history into an already-working chat reaches and follows the live end')

    const summaryRenderer = (row: TimelineDisplayRow) => row.id === 'live-working-assistant'
        ? <TimelineTurnWorkSummary startedAt="2026-01-01T00:00:00Z" completedAt={null} running hasWork
            renderChildren={() => <div style={{ height: 3_000 }}>Latest agent work</div>} />
        : liveRenderer(row)
    render('live-summary-chat', { rows: liveRows, renderRow: summaryRenderer, isWorking: true, coldStart: false })
    await new Promise(resolve => setTimeout(resolve, 500))
    check(distanceFromEnd() < 2, 'Opening actual live work does not replay its disclosure or leave the viewport at the prompt')
    results.push('Reopening real expanded work lands at its latest end after layout settles')

    for (const working of [false, true]) {
        const key = `late-history-${working}`
        render(key, { rows: [], selectionHydrating: true, isWorking: working })
        await new Promise(resolve => setTimeout(resolve, 120))
        render(key, { rows: liveRows, renderRow: liveRenderer, selectionHydrating: false, isWorking: working })
        await waitFor(() => distanceFromEnd() < 2, 'Hydrated long history opens at the actual latest edge')
    }
    results.push('Late completed and working history both open at the latest content')

    const messageId = 'reopened-response'
    const ingest = (type: string, payload: Record<string, unknown>) => flushSync(() => assistantStreamPresentation.ingestEvent({
        type, payload: { messageId, ...payload }
    } as AssistantDomainEvent))
    let presentation: ReturnType<typeof useAssistantVisibleText>
    function Response({ text, streaming }: { text: string; streaming: boolean }) {
        presentation = useAssistantVisibleText({ streamId: messageId, channel: 'message', text, streaming, mode: 'stream' })
        return <p>{presentation.text}</p>
    }
    assistantStreamPresentation.clear()
    ingest('thread.message.assistant.delta', { delta: 'Partial response' })
    ingest('thread.message.assistant.completed', { text: 'Partial response, now fully complete.' })
    flushSync(() => root.render(<Response text="Partial response" streaming />))
    check(presentation!.text === 'Partial response, now fully complete.' && !presentation!.presenting,
        'Reopening a cached completed response shows all text immediately without replay')
    flushSync(() => root.render(<div />))
    assistantStreamPresentation.clear()
    ingest('thread.message.assistant.delta', { delta: 'The work so far.' })
    flushSync(() => root.render(<Response text="The work so far." streaming />))
    check(presentation!.text === 'The work so far.', 'Reopened live text catches up immediately')
    ingest('thread.message.assistant.delta', { delta: ' New live update.' })
    check(presentation!.text === 'The work so far.' && presentation!.presenting, 'New live updates still animate')
    await waitFor(() => presentation!.text === 'The work so far. New live update.', 'New live updates drain normally')
    results.push('Completed history is immediate, reopened live text catches up, and new deltas keep streaming')

    const voiceStartedAt = '2026-10-04T10:00:00.000Z'
    const firstSpeech = projectVoiceLiveTimelineMessages({ transcript: [{ id: 'voice-intro', role: 'assistant', text: 'I will check', final: false }], canonicalMessages: [], voiceStartedAt, nowMs: Date.parse(voiceStartedAt) + 1000 })
    const task = { id: 'primary-task', kind: 'voice.strong-task', tone: 'tool' as const, summary: 'Primary agent working', turnId: 'primary-task', createdAt: '2026-10-04T10:00:02.000Z', payload: { status: 'running' } }
    const showVoice = (speech: typeof firstSpeech) => render('voice-stream', {
        rows: buildTimelineRows(getTimelineEntries(speech.messages, [task]), false, null),
        renderRow: row => row.kind === 'message' ? <TimelineMessage message={row.message} /> : row.kind === 'activity' ? <TimelineVoiceTaskStatus activity={row.activity} /> : null
    })
    showVoice(firstSpeech)
    await waitFor(() => Boolean(container.querySelector('[data-assistant-streaming-markdown]')) && container.textContent!.includes('I will check'), 'Assistant speech renders before completion in the real chat rail')
    const continuedSpeech = projectVoiceLiveTimelineMessages({ transcript: [{ id: 'voice-intro', role: 'assistant', text: 'I will check the available plugins.', final: false }], canonicalMessages: [], activities: [task], voiceStartedAt, previousAnchors: firstSpeech.anchors, nowMs: Date.parse(voiceStartedAt) + 3000 })
    showVoice(continuedSpeech)
    await waitFor(() => container.textContent!.includes('I will check the available plugins.'), 'Assistant speech grows live as more words arrive')
    check(container.textContent!.indexOf('I will check') < container.textContent!.indexOf('Primary agent working'), 'The primary task stays below its spoken introduction')
    results.push('Real Voice message rows stream unfinished assistant words above primary-agent activity')

    const sent: string[] = []
    let interrupted = 0
    let queued: ReturnType<typeof useAssistantQueuedComposer>
    function Composer({ compacting }: { compacting: boolean }) {
        queued = useAssistantQueuedComposer({
            selectedSessionId: 'compaction-chat',
            sessionStates: [{ sessionId: 'compaction-chat', threadState: 'ready', latestTurnState: 'completed',
                pendingApprovalCount: 0, pendingUserInputCount: 0, compacting }],
            isAssistantBusy: false, commandPending: false, isThreadWorking: false,
            activeTurnId: 'previous-turn', busyMessageMode: 'force',
            dispatchPrompt: async (_id, prompt, files) => { sent.push(`${prompt}:${files.length}`); return true },
            interruptTurn: async () => { interrupted++ }
        })
        return <div>{queued.queuedComposerMessageItems.map(item => <p key={item.id}>{item.prompt}</p>)}
            <TimelineWorkingIndicator startedAt="2026-01-01T00:00:00Z" label={compacting ? 'Letting compaction finish' : 'Working...'} />
        </div>
    }
    const compaction = { id: 'compaction', kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTING',
        createdAt: '2026-01-01T00:00:00Z', payload: { status: 'running' } } as const
    check(hasActiveAssistantCompaction([compaction]), 'Projected running compaction is recognized')
    flushSync(() => root.render(<Composer compacting />))
    check(await queued!.handleSendPrompt('next request', [{ id: 'file', name: 'example.ts', path: 'example.ts' } as any],
        { dispatchMode: 'force' } as any), 'Send accepts a message during compaction')
    await pause()
    check(sent.length === 0 && interrupted === 0, 'Sending during compaction waits without force-aborting maintenance')
    check(queued!.queuedComposerMessageItems[0]?.status === 'compacting' && container.textContent!.includes('Letting compaction finish'),
        'The accepted message remains visible with the compaction waiting status')
    await queued!.handleForceQueuedMessage(queued!.queuedComposerMessageItems[0]!.id)
    await pause()
    check(interrupted === 0 && sent.length === 0, 'Even a force attempt cannot cancel ongoing compaction')
    const finished = { ...compaction, payload: { status: 'completed' } }
    check(!hasActiveAssistantCompaction([finished]), 'The projected completion clears compaction availability')
    flushSync(() => root.render(<Composer compacting={false} />))
    await waitFor(() => sent.length === 1 && queued!.queuedComposerMessageCount === 0, 'Compaction completion dispatches the accepted message once')
    check(sent[0] === 'next request:1', 'Queued message text and attachments survive compaction')
    check(container.textContent!.includes('Working for') && !container.textContent!.includes('Letting compaction finish'),
        'The status changes to Working after compaction')
    results.push('Send during compaction accepts and retains the message, never interrupts, then dispatches once with its attachments')
    flushSync(() => root.render(<TimelineTurnWorkSummary startedAt="2026-01-01T00:00:00Z" completedAt={null}
        running statusLabel="Letting compaction finish" renderChildren={() => <div>Prior turn context maintenance</div>} />))
    check(container.textContent!.includes('Letting compaction finish') && !container.textContent!.includes('Working for'),
        'A prior turn still marked running shows compaction waiting rather than falsely starting new work')

    let wheelCalls = 0
    function WheelSurface({ enabled = true }: { enabled?: boolean }) {
        const ref = useNonPassiveWheel<HTMLDivElement>(enabled ? event => { event.preventDefault(); wheelCalls++ } : undefined)
        return <div ref={ref}>Composer wheel surface</div>
    }
    flushSync(() => root.render(<WheelSurface />))
    const wheelElement = container.firstElementChild!
    const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, deltaY: 40 })
    check(!wheelElement.dispatchEvent(event) && event.defaultPrevented && wheelCalls === 1,
        'Composer wheel routing can prevent the native default without a passive listener warning')
    flushSync(() => root.render(<WheelSurface enabled={false} />))
    check(wheelElement.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true, deltaY: 40 })),
        'Disabling wheel forwarding restores normal native handling')
    flushSync(() => root.render(<div />))
    wheelElement.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true, deltaY: 40 }))
    check(wheelCalls === 1, 'Unmounted wheel surfaces release their listener')
    results.push('Composer wheel forwarding is cancelable, updates without duplicate listeners, and cleans up on unmount')
    root.unmount()
    return results
}

Object.assign(window, { timelinePresentationCheck: run() })
