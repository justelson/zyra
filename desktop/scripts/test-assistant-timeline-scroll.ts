import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createAssistantLongHistoryFixture } from './fixtures/assistant-long-history-fixture'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { computeStableAssistantTimelineRows } from '../src/renderer/src/pages/assistant/assistant-virtual-timeline-rows'
import {
    getAssistantTimelineDistanceFromEnd,
    isAssistantTimelineNearEnd,
    resolveAssistantTimelineModeAfterScroll,
    resolveAssistantTimelineScrollMode
} from '../src/renderer/src/pages/assistant/assistant-timeline-scroll-policy'
import {
    normalizeAssistantHistoryWheelDelta,
    resolveAssistantInitialHistoryBackfill,
    resolveAssistantHistoryStreamPlan,
    resolveAssistantScrollbarHistoryDemand,
    updateAssistantHistoryScrollVelocity
} from '../src/renderer/src/pages/assistant/assistant-history-streaming-policy'
import { replaceAssistantTimelineActivityEntry } from '../src/renderer/src/pages/assistant/useAssistantTimelineEntries'
import { resolveAssistantTimelineCompletionAnchor } from '../src/renderer/src/pages/assistant/assistant-timeline-scroll-events'

assert.equal(getAssistantTimelineDistanceFromEnd({ scrollHeight: 2_000, scrollTop: 1_100, clientHeight: 700 }), 200)
assert.equal(isAssistantTimelineNearEnd({ scrollHeight: 2_000, scrollTop: 1_220, clientHeight: 700 }), true, 'the 96px floor keeps a near-end reader attached')
assert.equal(isAssistantTimelineNearEnd({ scrollHeight: 2_000, scrollTop: 1_100, clientHeight: 700 }), false)
assert.equal(resolveAssistantTimelineScrollMode({ scrollHeight: 2_000, scrollTop: 1_220, clientHeight: 700 }), 'following-end')
assert.equal(resolveAssistantTimelineScrollMode({ scrollHeight: 2_000, scrollTop: 400, clientHeight: 700 }), 'free-scrolling')
assert.deepEqual(resolveAssistantTimelineModeAfterScroll({
    userNavigatedAway: false,
    resolvedMode: 'free-scrolling',
    movingTowardEnd: false,
    disclosureLayoutActive: false
}), { userNavigatedAway: false, mode: 'following-end' }, 'late measurements cannot detach a newly opened chat from its latest message without user intent')
assert.deepEqual(resolveAssistantTimelineModeAfterScroll({
    userNavigatedAway: true,
    resolvedMode: 'free-scrolling',
    movingTowardEnd: false,
    disclosureLayoutActive: false
}), { userNavigatedAway: true, mode: 'free-scrolling' }, 'explicit upward navigation still leaves live follow')
assert.deepEqual(resolveAssistantTimelineModeAfterScroll({
    userNavigatedAway: true,
    resolvedMode: 'following-end',
    movingTowardEnd: true,
    disclosureLayoutActive: false
}), { userNavigatedAway: false, mode: 'following-end' }, 'returning to the latest message reattaches end follow')
const idleStreamPlan = resolveAssistantHistoryStreamPlan({
    startupSettled: true,
    upwardIntent: false,
    distanceFromStart: 0,
    viewportSize: 700,
    velocityPxPerMs: 0,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false
})
assert.equal(idleStreamPlan.shouldRequest, false, 'opening at the latest turn cannot preload older history without user motion')
assert.deepEqual(resolveAssistantInitialHistoryBackfill({
    initialLayoutReady: true,
    selectionSettled: true,
    isWorking: false,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    requestPending: false,
    contentLength: 730,
    viewportSize: 829,
    pagesRequested: 0
}), { shouldRequest: true, turnLimit: 1 }, 'an underfilled reopened chat backfills one local turn before it can look like a one-turn transcript')
assert.equal(resolveAssistantInitialHistoryBackfill({
    initialLayoutReady: true,
    selectionSettled: true,
    isWorking: false,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    requestPending: false,
    contentLength: 940,
    viewportSize: 829,
    pagesRequested: 1
}).shouldRequest, false, 'a viewport with one row of readable context does not fetch another page')
assert.equal(resolveAssistantInitialHistoryBackfill({
    initialLayoutReady: true,
    isWorking: false,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    requestPending: false,
    contentLength: 200,
    viewportSize: 829,
    pagesRequested: 0,
    selectionSettled: false
}).shouldRequest, false, 'an underfilled Chat waits for selection hydration to release the same history cursor')
assert.equal(resolveAssistantInitialHistoryBackfill({
    initialLayoutReady: true,
    selectionSettled: true,
    isWorking: true,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    requestPending: false,
    contentLength: 200,
    viewportSize: 829,
    pagesRequested: 0
}).shouldRequest, false, 'an actively streaming chat prioritizes the live edge instead of backfilling history')
assert.equal(resolveAssistantInitialHistoryBackfill({
    initialLayoutReady: true,
    selectionSettled: true,
    isWorking: false,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false,
    requestPending: false,
    contentLength: 200,
    viewportSize: 829,
    pagesRequested: 3
}).shouldRequest, false, 'viewport backfill has a strict request cap for short historical turns')
const slowStreamPlan = resolveAssistantHistoryStreamPlan({
    startupSettled: true,
    upwardIntent: true,
    distanceFromStart: 2_000,
    viewportSize: 700,
    velocityPxPerMs: 0.35,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false
})
assert.equal(slowStreamPlan.shouldRequest, true, 'slow upward reading starts one turn several viewports before the edge')
assert.equal(slowStreamPlan.turnLimit, 1)
const fastStreamPlan = resolveAssistantHistoryStreamPlan({
    startupSettled: true,
    upwardIntent: true,
    distanceFromStart: 5_000,
    viewportSize: 700,
    velocityPxPerMs: 4,
    hasOlder: true,
    loadingOlder: false,
    hasLoadError: false
})
assert.equal(fastStreamPlan.shouldRequest, true, 'fast upward motion expands lookahead before the reader outruns loaded history')
assert.equal(fastStreamPlan.turnLimit, 3, 'fast upward motion batches a bounded three turns')
assert.equal(resolveAssistantHistoryStreamPlan({
    ...fastStreamPlan,
    startupSettled: true,
    upwardIntent: true,
    distanceFromStart: 0,
    viewportSize: 700,
    velocityPxPerMs: 4,
    hasOlder: true,
    loadingOlder: true,
    hasLoadError: false
}).shouldRequest, false, 'one in-flight page owns the cursor')
assert.ok(updateAssistantHistoryScrollVelocity(0, 700, 16) > updateAssistantHistoryScrollVelocity(0, 35, 16), 'scroll velocity distinguishes a fling from line-by-line reading')
assert.equal(normalizeAssistantHistoryWheelDelta(3, 0, 900), 3)
assert.equal(normalizeAssistantHistoryWheelDelta(3, 1, 900), 48, 'line-mode wheels match the Markdown viewer pixel normalization')
assert.equal(normalizeAssistantHistoryWheelDelta(1, 2, 900), 900, 'page-mode wheels normalize to the viewport')
assert.deepEqual(resolveAssistantScrollbarHistoryDemand({
    dragActive: false,
    dragDirection: null,
    scrollDelta: -640
}), { dragDirection: null, requestDirection: null }, 'a virtual-list anchor correction cannot masquerade as older-page user demand')
assert.deepEqual(resolveAssistantScrollbarHistoryDemand({
    dragActive: false,
    dragDirection: null,
    scrollDelta: 640
}), { dragDirection: null, requestDirection: null }, 'a prepend correction cannot reverse direction and request a newer page')
assert.deepEqual(resolveAssistantScrollbarHistoryDemand({
    dragActive: true,
    dragDirection: null,
    scrollDelta: -120
}), { dragDirection: null, requestDirection: null }, 'a layout correction cannot establish scrollbar direction before the pointer actually moves')
assert.deepEqual(resolveAssistantScrollbarHistoryDemand({
    dragActive: true,
    dragDirection: 'older',
    scrollDelta: -120
}), { dragDirection: 'older', requestDirection: 'older' }, 'an upward scrollbar drag can request older history after pointer motion establishes direction')
assert.deepEqual(resolveAssistantScrollbarHistoryDemand({
    dragActive: true,
    dragDirection: 'older',
    scrollDelta: 640
}), { dragDirection: 'older', requestDirection: null }, 'a scrollbar drag keeps its initial direction while an anchor correction moves the viewport oppositely')

const workRow = { dataset: {} } as unknown as HTMLElement
const finalResponseRow = { dataset: { assistantMessageRole: 'assistant' } } as unknown as HTMLElement
const timelineElement = {
    querySelectorAll: () => [workRow, finalResponseRow]
} as unknown as HTMLElement
const workTrigger = {
    closest: (selector: string) => selector.includes('data-assistant-timeline-row-id') ? workRow : timelineElement
} as unknown as HTMLElement
assert.equal(resolveAssistantTimelineCompletionAnchor(workTrigger), finalResponseRow, 'automatic Working collapse anchors the final response below it')

const snapshot = createAssistantLongHistoryFixture()
const thread = snapshot.sessions[0]!.threads[0]!
const activityFeed = [...thread.activities].reverse()
const derivationSamples: number[] = []
let entries = getTimelineEntries(thread.messages, activityFeed, thread.proposedPlans)
for (let sample = 0; sample < 3; sample += 1) {
    const startedAt = performance.now()
    entries = getTimelineEntries(thread.messages, activityFeed, thread.proposedPlans)
    derivationSamples.push(performance.now() - startedAt)
}
assert.equal(entries.length, 3_020, 'the 1,000-turn fixture keeps grouped tool rows while retaining every message and plan')

const renderRows = buildTimelineRows(entries, false, null)
const displayRows = groupTimelineRowsIntoWorkSummaries({
    rows: renderRows,
    messages: thread.messages,
    latestAssistantMessageId: thread.messages.findLast((message) => message.role === 'assistant')?.id || null,
    latestTurnStartedAt: null,
    isWorking: false
})
assert.equal(displayRows.length, 3_020)

const initialWindow = displayRows.slice(-120)
const stableInitial = computeStableAssistantTimelineRows(null, initialWindow)
const prependedWindow = displayRows.slice(-180, -120)
const stablePrepend = computeStableAssistantTimelineRows(stableInitial, [...prependedWindow, ...initialWindow])
assert.equal(stablePrepend.rows[prependedWindow.length], stableInitial.rows[0], 'a long-history prepend preserves the first previously visible row reference')
assert.equal(stablePrepend.rows.at(-1), stableInitial.rows.at(-1), 'a long-history prepend preserves the live-edge row reference')

const previousActivity = activityFeed[0]!
const nextActivity = {
    ...previousActivity,
    detail: `${previousActivity.detail || ''}:updated`,
    payload: { ...previousActivity.payload, output: 'updated without rebuilding 1,000 turns' }
}
const incrementalStartedAt = performance.now()
const incrementallyUpdatedEntries = replaceAssistantTimelineActivityEntry(entries, previousActivity, nextActivity)
const incrementalMs = performance.now() - incrementalStartedAt
assert.ok(incrementallyUpdatedEntries, 'a lifecycle update inside a grouped tool row uses the incremental projection path')
const changedEntryIndices = incrementallyUpdatedEntries!.flatMap((entry, index) => entry === entries[index] ? [] : [index])
assert.deepEqual(changedEntryIndices.length, 1, 'one tool lifecycle update changes exactly one virtual timeline entry')
const changedEntry = incrementallyUpdatedEntries![changedEntryIndices[0]!]!
assert.equal(
    changedEntry.type === 'activity-group'
        ? changedEntry.activities.some((activity) => activity === nextActivity)
        : changedEntry.type === 'activity' && changedEntry.activity === nextActivity,
    true,
    'the updated activity reaches its existing standalone or grouped row'
)
assert.ok(incrementalMs < 100, 'a single tool lifecycle update remains bounded on the 1,000-turn fixture')

const virtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
assert.equal(virtualTimelineSource.includes('selectionSettled: !props.selectionHydrating'), true, 'initial backfill waits until Chat selection and detail hydration release the history cursor')
assert.equal(virtualTimelineSource.includes('if (accepted === false) initialHistoryBackfillActiveRef.current = false'), false, 'a transiently rejected page cannot permanently disable first-screen context')
assert.match(virtualTimelineSource, /accepted === false[\s\S]{0,180}initialHistoryBackfillPagesRef\.current = Math\.max/, 'a rejected page restores its bounded retry budget')
assert.match(virtualTimelineSource, /initialHistoryBackfillWindowKeyRef\.current !== props\.windowKey[\s\S]{0,420}olderLoadRequestOwnerRef\.current = null[\s\S]{0,120}newerLoadRequestOwnerRef\.current = null/, 'each Chat window clears stale page-request ownership synchronously')
assert.equal(virtualTimelineSource.includes('requestId: ++nextHistoryLoadRequestIdRef.current'), true, 'revisiting the same Chat receives a new page owner instead of reusing its window key')
const stylesSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimeline.tsx', import.meta.url), 'utf8')
const workSummarySource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary.tsx', import.meta.url), 'utf8')
const conversationPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const assistantPageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const inspectorSidebarSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantInspectorSidebar.tsx', import.meta.url), 'utf8')
const checkpointRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineCheckpointRail.tsx', import.meta.url), 'utf8')
const chatSessionsRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const legendListPatchSource = readFileSync(new URL('./maint/apply-legend-list-scroll-patch.mjs', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>
}
assert.equal(virtualTimelineSource.includes('initialScrollAtEnd'), true, 'LegendList owns initial positioning at the newest row')
assert.equal(virtualTimelineSource.includes('alignItemsAtEnd'), false, 'short chats preserve the intended top-aligned conversation hierarchy')
assert.equal(virtualTimelineSource.includes('onLoad={handleInitialLoad}'), true, 'history loading is armed only after LegendList reports initial layout and scrolling complete')
assert.equal(virtualTimelineSource.includes("startupSettled ? 'visible' : 'invisible'"), false, 'a warm chat never blanks while virtual row measurements settle')
assert.equal(virtualTimelineSource.includes('key={props.windowKey}'), false, 'warm chat switches reuse the measured list surface instead of mounting a blank list')
assert.equal(virtualTimelineSource.includes('dataKey={props.windowKey}'), true, 'a reused list resets stale row measurements when the logical chat dataset changes')
assert.match(
    virtualTimelineSource,
    /maintainVisibleContentPosition = useMemo\(\(\) => \(\{[\s\S]{0,180}size:\s*startupSettled\s*&&\s*scrollMode\s*===\s*'free-scrolling'/,
    'row-size anchoring waits for startup and only protects a reader who moved away from the live edge'
)
const startupPresentationSource = virtualTimelineSource.split('const scheduleInitialPresentation')[1]?.split('const stopFollowingForUserNavigation')[0] || ''
const initialLoadSource = virtualTimelineSource.split('const handleInitialLoad')[1]?.split('useLayoutEffect')[0] || ''
assert.doesNotMatch(startupPresentationSource, /scrollToEnd/, 'startup settling must not override LegendList measured end positioning with estimated geometry')
assert.doesNotMatch(initialLoadSource, /scrollToEnd/, 'LegendList onLoad already reports completed initial positioning and must not be followed by another end jump')
assert.match(startupPresentationSource, /requestAnimationFrame[\s\S]{0,700}requestAnimationFrame[\s\S]{0,700}settleInitialPresentation/, 'startup still settles deterministically when LegendList does not repeat onLoad')
assert.match(virtualTimelineSource, /stopFollowingForUserNavigation[\s\S]{0,500}cancelStartupAlignment\(\)[\s\S]{0,350}settleInitialPresentation/, 'an immediate wheel or touch gesture cancels pending startup alignment instead of snapping back afterward')
assert.equal(conversationPaneSource.includes('ASSISTANT_HISTORY_PREFETCH_SETTLE_MS'), false, 'chat open has no timer-driven older-history request')
assert.equal(conversationPaneSource.includes('prefetchedHistoryThreadIdsRef'), false, 'older history is driven exclusively by current upward scroll demand')
assert.equal(timelineSource.includes('initialLayoutWindowKey !== windowKey'), true, 'Markdown prewarming waits until the current virtual window finishes initial layout')
assert.equal(timelineSource.includes('ASSISTANT_MARKDOWN_PREWARM_MAX_LENGTH = 32_000'), true, 'chat-entry prewarming skips large Markdown bodies')
assert.equal(timelineSource.includes('prewarmCodeBlocks: false'), true, 'chat-entry prewarming never starts syntax highlighting in the first scroll window')
assert.equal(virtualTimelineSource.includes('INITIAL_END_FOLLOW_DELAYS_MS'), false, 'bootstrap positioning has no retry-timer ladder')
assert.equal(virtualTimelineSource.includes('COMPLETION_END_FOLLOW_DELAYS_MS'), false, 'completion positioning has no retry-timer ladder')
assert.match(virtualTimelineSource, /addEventListener\('wheel', handleWheel, \{ passive: true \}\)/, 'chat leaves physical wheel movement on Chromium’s compositor instead of blocking input')
assert.equal(virtualTimelineSource.includes('wheelTargetRef'), false, 'chat cannot accumulate a delayed synthetic target ahead of the viewport')
assert.equal(virtualTimelineSource.includes('event.preventDefault()'), false, 'chat wheel input cannot be swallowed while pagination intent is observed')
assert.equal(virtualTimelineSource.includes('wheelAnimationFrameRef'), false, 'chat cannot retain a JavaScript animation-frame scroll loop')
assert.match(virtualTimelineSource, /const scrollbarDemand = resolveAssistantScrollbarHistoryDemand\(/, 'scroll events can request history only while a real scrollbar drag owns the direction')
assert.match(virtualTimelineSource, /addEventListener\('pointermove', trackScrollbarDragDirection, \{ passive: true \}\)/, 'scrollbar pagination direction comes from pointer motion rather than corrected scroll geometry')
assert.equal(virtualTimelineSource.includes('movingTowardStart && userNavigationAwayRef.current'), false, 'virtual-list anchor corrections cannot be mistaken for pagination input')
assert.match(stylesSource, /\.assistant-chat-scrollbar \{[\s\S]{0,120}scroll-behavior: auto;/, 'timeline anchor corrections remain immediate while explicit navigation can still opt into animation')
assert.match(stylesSource, /body\.zyra-reduce-motion \*[\s\S]{0,220}scroll-behavior: auto !important;/, 'chat smooth navigation follows the app reduced-motion preference')
assert.equal(virtualTimelineSource.includes('previousContentInsetEndRef'), false, 'LegendList alone applies animated composer inset adjustments')
assert.equal(virtualTimelineSource.includes('[scrollbar-gutter:stable]'), false, 'the chat does not reserve a second static-looking scrollbar rail')
assert.match(conversationPaneSource, /assistant-conversation-pane[^\n]+min-h-0[^\n]+overflow-hidden/, 'the conversation shell cannot become a competing vertical scroll owner')
assert.match(assistantPageSource, /flex min-h-0 min-w-0 flex-1 overflow-hidden/, 'the chat and Inspector share one height-constrained split surface')
assert.equal(inspectorSidebarSource.includes('GripVertical'), false, 'the Inspector resize target no longer resembles a fixed scrollbar thumb')
assert.match(checkpointRailSource, /opacity-0[^"]+hover:opacity-100[^"]+focus-within:opacity-100/, 'the checkpoint minimap stays invisible until deliberate hover or keyboard focus, so it cannot resemble a second scrollbar')
assert.equal(chatSessionsRailSource.includes('h-16 w-1.5 -translate-y-1/2 rounded-full'), false, 'the collapsed sidebar hover target no longer masquerades as a fixed scrollbar thumb')
assert.match(chatSessionsRailSource, /group\/sidebar-peek[\s\S]*group-hover\/sidebar-peek:bg-\[var\(--surface-panel-divider\)\]/, 'collapsed sidebar discovery is a hover-only edge divider')
assert.equal(virtualTimelineSource.includes('maintainVisibleContentPosition={maintainVisibleContentPosition}'), true, 'prepends and late row measurements preserve their visible anchor')
assert.equal(virtualTimelineSource.includes("size: startupSettled && scrollMode === 'free-scrolling'"), true, 'late Markdown and disclosure measurements preserve the visible row only while freely reading history')
assert.equal(virtualTimelineSource.includes('shouldRestorePosition'), true, 'disclosure resizing keeps the user-selected row as the restoration anchor')
assert.match(desktopPackage.scripts?.postinstall || '', /apply-legend-list-scroll-patch\.mjs/, 'dependency installs preserve the verified LegendList web anchoring fix')
assert.equal(legendListPatchSource.includes("const LEGEND_LIST_VERSION = '3.3.5'"), true, 'the dependency patch is pinned to the verified LegendList version')
assert.equal(legendListPatchSource.includes("['react.js', 'react.mjs']"), true, 'both LegendList web module formats receive the anchoring fix')
assert.equal(virtualTimelineSource.includes("scrollMode === 'following-end'"), true, 'the virtual list stops end-follow as soon as the user starts navigating')
assert.equal(virtualTimelineSource.includes('detail?.anchor'), true, 'work disclosures consume the requested viewport anchor instead of ignoring it')
assert.equal(virtualTimelineSource.includes('const preserveAnchor = () =>'), false, 'LegendList owns row-size restoration without a competing animation-frame correction loop')
assert.equal(virtualTimelineSource.includes("scrollElement.scrollBy({ top: delta, behavior: 'auto' })"), false, 'the timeline has one scroll-position owner during disclosure layout')
const pointerHandlerSource = virtualTimelineSource.slice(virtualTimelineSource.indexOf('const handleTimelinePointerDown'), virtualTimelineSource.indexOf('const handleKeyboardClick'))
assert.match(pointerHandlerSource, /event\.clientX < bounds\.right - scrollbarGutter\) return/, 'an ordinary empty-area click cannot masquerade as scrollbar navigation')
assert.match(pointerHandlerSource, /const button = target\.closest\('button\[aria-expanded\]'\)[\s\S]*if \(!button[\s\S]*return[\s\S]*stopFollowingForUserNavigation\(\)/, 'ordinary links, copy buttons, and text selection cannot disable live follow')
assert.equal(virtualTimelineSource.includes("addEventListener(ASSISTANT_TIMELINE_USER_JUMP_EVENT"), true, 'checkpoint and latest-button navigation explicitly leave live-follow mode')
assert.equal(virtualTimelineSource.includes('completionFollowTimerRef'), true, 'completion retains one bounded post-layout correction')
assert.equal(virtualTimelineSource.includes('if (endAlignmentFrameRef.current !== null) return'), true, 'end corrections coalesce to one animation frame')
assert.match(virtualTimelineSource, /scrollHeight - element\.scrollTop - element\.clientHeight\) > 1\) return/, 'completion cannot snap the viewport after a visible layout shift')
assert.match(workSummarySource, /resolveAssistantTimelineCompletionAnchor\(triggerRef\.current\)/, 'automatic Working minimization preserves the final-answer row rather than its own disappearing content')
assert.equal(virtualTimelineSource.includes('onStartReached='), false, 'LegendList geometry alone cannot start pagination during bootstrap or measurement')
assert.equal(virtualTimelineSource.includes('resolveAssistantHistoryStreamPlan'), true, 'pagination uses the velocity-aware lookahead policy')
assert.match(virtualTimelineSource, /lastUpwardIntentAtRef\.current = now[\s\S]{0,900}requestOlderPage\(\)/, 'actual upward input records demand before requesting history')
assert.equal(virtualTimelineSource.includes('shouldContinueAssistantHistoryStream'), false, 'a completed page cannot chain another history request without fresh user input')
assert.equal(virtualTimelineSource.includes('olderDemandBlockedByLoadRef'), false, 'wheel events received during an in-flight page are not queued into a later request storm')
assert.equal(virtualTimelineSource.includes('olderLoadBoundaryLockedRef'), false, 'pagination no longer stalls until a direction reversal')
assert.match(virtualTimelineSource, /olderLoadRequestOwnerRef\.current = requestOwner[\s\S]{0,220}finally\(\(\) => \{[\s\S]{0,180}olderLoadRequestOwnerRef\.current !== requestOwner[\s\S]{0,160}olderLoadRequestPendingRef\.current = false/, 'page completion releases only the exact request that owns the current Chat window')
assert.equal(virtualTimelineSource.includes('olderLoadIntentWindowKey'), false, 'remount-prone component intent state cannot trigger or block pages')
assert.equal(virtualTimelineSource.includes('<span className="sr-only" role="status">Loading earlier messages</span>'), true, 'normal older-history loading remains visually silent')
assert.equal(virtualTimelineSource.includes("props.loadOlderError ? 'Retry earlier messages'"), false, 'the visible pill is reserved for a real retry state')

console.log(JSON.stringify({
    fixture: { turns: 1_000, entries: entries.length, displayRows: displayRows.length },
    timelineDerivationMs: derivationSamples.map((value) => Number(value.toFixed(2))),
    incrementalActivityUpdateMs: Number(incrementalMs.toFixed(2))
}, null, 2))
console.log('Assistant timeline scroll contract: ok')
