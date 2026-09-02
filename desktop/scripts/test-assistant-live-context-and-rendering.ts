import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AssistantSessionTurnUsageEntry, AssistantTurnUsage } from '../src/shared/assistant/contracts'
import { resolveAssistantComposerContextUsage } from '../src/renderer/src/pages/assistant/assistant-composer-context-usage'
import { buildAssistantTurnUsageIndex } from '../src/renderer/src/pages/assistant/assistant-turn-usage-index'

const usage = (totalTokens: number): AssistantTurnUsage => ({
    inputTokens: Math.max(0, totalTokens - 200),
    outputTokens: 200,
    totalTokens,
    modelContextWindow: 128_000
})
const turn = (id: string, threadId: string, turnUsage: AssistantTurnUsage | null): AssistantSessionTurnUsageEntry => ({
    id,
    sessionId: 'session-1',
    threadId,
    model: 'gpt-test',
    state: turnUsage ? 'completed' : 'running',
    requestedAt: `2026-01-01T00:00:0${id}.000Z`,
    startedAt: `2026-01-01T00:00:0${id}.000Z`,
    completedAt: turnUsage ? `2026-01-01T00:00:0${id}.500Z` : null,
    assistantMessageId: turnUsage ? `message-${id}` : null,
    usage: turnUsage,
    updatedAt: `2026-01-01T00:00:0${id}.500Z`
})

const previousUsage = usage(18_000)
const activeUsage = usage(21_000)
const sessionTurns = [
    turn('1', 'thread-main', previousUsage),
    turn('2', 'thread-child', usage(8_000)),
    turn('3', 'thread-main', null)
]
assert.equal(resolveAssistantComposerContextUsage({ sessionTurns, threadId: 'thread-main' }), previousUsage, 'a newly running turn retains the latest reported context instead of showing a blank ring')
assert.equal(resolveAssistantComposerContextUsage({ liveUsage: activeUsage, sessionTurns, threadId: 'thread-main' }), activeUsage, 'live usage updates replace the retained completed-turn value as soon as they arrive')
assert.equal(resolveAssistantComposerContextUsage({ sessionTurns, threadId: 'thread-missing' }), null, 'usage never leaks across threads')

const staleFailedTurn = {
    ...turn('4', 'thread-main', null),
    state: 'error' as const,
    completedAt: '2026-01-01T00:00:04.250Z'
}
const liveCompletedTurn = {
    id: staleFailedTurn.id,
    state: 'completed' as const,
    requestedAt: staleFailedTurn.requestedAt,
    startedAt: staleFailedTurn.startedAt,
    completedAt: '2026-01-01T00:00:04.500Z',
    assistantMessageId: 'message-4',
    usage: activeUsage
}
const liveTurnIndex = buildAssistantTurnUsageIndex([], [staleFailedTurn], {
    sessionId: 'session-1',
    threadId: 'thread-main',
    model: 'gpt-test',
    latestTurn: liveCompletedTurn
})
assert.equal(liveTurnIndex.get(staleFailedTurn.id)?.state, 'completed', 'the live explicit turn completion overrides a stale asynchronous usage row')

const conversationSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const reviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTurnReview.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/renderer/src/lib/settings.tsx', import.meta.url), 'utf8')
const generalSettingsSource = readFileSync(new URL('../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
const railSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const connectedRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConnectedSessionsRail.tsx', import.meta.url), 'utf8')
const settingsShellSource = readFileSync(new URL('../src/renderer/src/pages/settings/SettingsShell.tsx', import.meta.url), 'utf8')
const preferenceContractsSource = readFileSync(new URL('../src/shared/preferences/contracts.ts', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
const agentWorkerSource = readFileSync(new URL('../src/main/assistant/zyra-agent-server-worker.ts', import.meta.url), 'utf8')
const runtimeEventsSource = readFileSync(new URL('../src/main/assistant/service-runtime-events.ts', import.meta.url), 'utf8')
const threadDetailsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/ConnectedAssistantThreadDetailsPanel.tsx', import.meta.url), 'utf8')
const composerEffectsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantComposerControllerEffects.ts', import.meta.url), 'utf8')
const composerControlsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerSections.tsx', import.meta.url), 'utf8')
const composerViewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerView.tsx', import.meta.url), 'utf8')
const contextIndicatorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerContextIndicator.tsx', import.meta.url), 'utf8')
const busySendSplitButtonSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBusySendSplitButton.tsx', import.meta.url), 'utf8')
const connectedDropdownButtonSource = readFileSync(new URL('../src/renderer/src/components/ui/ConnectedDropdownButton.tsx', import.meta.url), 'utf8')
const rendererCssSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')

assert.match(conversationSource, /latestTurnUsage=\{composerContextUsage\}/, 'the composer receives live-or-retained usage rather than the empty running-turn field')
assert.match(conversationSource, /buildAssistantTurnUsageIndex\([^]*latestTurn: controller\.activeThread\.latestTurn/, 'the timeline status index receives the live explicit turn ledger instead of waiting for a history refresh')
assert.match(reviewSource, /label="You"[^\n]+primary renderMarkdown collapsible/, 'turn review renders sent user prompts as Markdown while retaining Show more')
assert.match(reviewSource, /\[&_p\]:whitespace-pre-wrap/, 'turn review preserves ordinary prompt line breaks')
assert.match(reviewSource, /preparedSelectedDiff\.patch\.trim\(\)/, 'Review never sends a missing patch into an empty raw-diff surface')
assert.match(bridgeSource, /now - lastLiveContextPublishedAt >= 250/, 'active assistant messages publish bounded live context snapshots')
assert.match(runtimeSource, /type: 'thread\.token-usage\.updated'/, 'live bridge context reaches the canonical thread usage state')
assert.match(agentWorkerSource, /agentServerLatestTurnId: presenceLatestTurn\?\.\['id'\]/, 'canonical attachment carries the server’s latest turn identity')
assert.match(runtimeSource, /const attachedUsage = buildLiveAssistantTurnUsage\(context\)[^]*agentServerLatestTurnId[^]*type: 'thread\.token-usage\.updated'/, 'reattaching a chat publishes its current context usage immediately instead of waiting for another model event')
assert.match(runtimeEventsSource, /usage: \{[^]*existingThread\.latestTurn!\.usage[^]*event\.payload\.usage/, 'partial live context refreshes preserve detailed token metrics already known for the turn')
assert.match(conversationSource, /controller\.selectionHydrating[^]*\? null[^]*resolveAssistantComposerContextUsage/, 'the footer never presents cached context as live during thread synchronization')
assert.match(threadDetailsSource, /selectionHydrating[^]*'Syncing…'/, 'Thread Details shows a truthful synchronization state instead of values from the previous hydration')
assert.match(composerEffectsSource, /useLayoutEffect\(\(\) => \{[^]*initializationKey/, 'composer thread configuration resets before the switched chat can paint stale controls')
assert.equal((composerControlsSource.match(/assistant-model-name-shimmer/g) || []).length, 2, 'the current model name shimmers in both composer control surfaces while models refresh')
assert.doesNotMatch(composerControlsSource, /Loader2 size=\{11\} className="shrink-0 animate-spin/, 'model refresh no longer adds a spinner beside the model name')
assert.match(rendererCssSource, /assistantTextShimmer 2\.8s linear infinite/, 'composer and title-generation shimmer use the same slower constant sweep')
assert.match(rendererCssSource, /color-text-secondary\) 76%/, 'the shimmer base remains readable between highlight passes')
assert.match(composerControlsSource, /aria-label="Reasoning effort"/, 'the compact effort slider retains a semantic label without a redundant visible header')
assert.doesNotMatch(composerControlsSource, />Reasoning</, 'the compact effort card omits the redundant visible header')
assert.match(composerControlsSource, />Faster<[^]*>Smarter</, 'the discrete effort slider uses the reference endpoint labels')
assert.match(composerControlsSource, /flex min-w-0 flex-1 flex-nowrap items-center/, 'composer model, effort, and access controls stay on one footer row')
assert.match(composerControlsSource, /relative min-w-0 flex-\[1_1_0%\] max-w-full/, 'the model control truncates before forcing the access pill onto another row')
assert.match(composerControlsSource, /assistant-composer-footer-model-label/, 'the footer model label participates in container-aware collapse')
assert.match(composerControlsSource, /assistant-composer-footer-access-control[^]*assistant-composer-footer-access-label/, 'the access control can collapse its visible label without losing the button')
assert.match(rendererCssSource, /@container \(max-width: 620px\)[^]*assistant-composer-footer-model-label[^]*max-width: 0[^]*opacity: 0/, 'tight footers smoothly collapse the model name before shrinking live controls')
assert.match(rendererCssSource, /@container \(max-width: 520px\)[^]*assistant-composer-footer-access-control[^]*width: 36px[^]*height: 36px[^]*assistant-composer-footer-access-label[^]*max-width: 0/, 'tighter footers turn access state into a voice-sized icon control')
assert.match(contextIndicatorSource, /assistant-composer-footer-context/, 'context usage exposes a footer-responsive transition wrapper')
assert.match(rendererCssSource, /assistant-composer-footer-context\[data-visible='false'\][^]*width: 0[^]*opacity: 0[^]*visibility: hidden/, 'the hidden context indicator leaves the footer without retaining invisible spacing')
assert.match(rendererCssSource, /prefers-reduced-motion: reduce[^]*assistant-composer-footer-context[^]*transition-duration: 0\.01ms/, 'adaptive footer transitions respect reduced-motion preferences')
assert.match(composerViewSource, /<AssistantBusySendSplitButton[^]*onQueue=\{controller\.handleQueueSend\}[^]*onForce=\{controller\.handleForceSend\}/, 'busy Queue and Force paths share one connected action control')
assert.doesNotMatch(composerViewSource, /secondaryBusyActionLabel/, 'the footer no longer renders a second standalone busy-send pill')
assert.match(busySendSplitButtonSource, /<ConnectedDropdownButton/, 'busy-send presentation reuses DevScope’s established connected action control')
assert.match(busySendSplitButtonSource, /ListEnd[^]*Zap/, 'Queue and Force use the app’s normal Lucide icon language')
assert.match(busySendSplitButtonSource, /direction="up"[^]*shape="pill"[^]*size="composer"/, 'the composer adapts the DevScope control into the upward rounded blueprint structure')
assert.match(composerViewSource, /\[container-type:inline-size\]/, 'the footer exposes its actual width to responsive action controls')
assert.match(busySendSplitButtonSource, /w-\[clamp\(120px,26cqi,136px\)\]/, 'the busy-send control shows full labels and grows modestly when footer space is available')
assert.match(connectedDropdownButtonSource, /shape === 'pill' \? 'bottom-full -mb-\[18px\]'/, 'the upward menu fills the complete area behind the unchanged pill instead of leaving a seam')
assert.match(connectedDropdownButtonSource, /shape === 'pill'[^]*\? 'relative z-\[121\][^]*\[border-top-color:transparent\][^]*: 'rounded-t-none/, 'the pill layers above the menu without a duplicate top-border contour')
assert.match(connectedDropdownButtonSource, /rounded-t-\[18px\] pb-\[19px\]/, 'hidden menu padding absorbs the full overlap without covering the Force row')
assert.match(connectedDropdownButtonSource, /shape === 'pill' \? 'rounded-full'/, 'the trigger uses the pill shape in its resting state')
assert.match(connectedDropdownButtonSource, /borderBottomLeftRadius: 9999, borderBottomRightRadius: 9999/, 'the trigger pins both bottom corners to the identical pill radius while expanded')
assert.match(busySendSplitButtonSource, /onModeUsed\(mode\)[^]*mode === 'queue' \? onQueue\(\) : onForce\(\)/, 'a chosen action becomes last-used before executing its explicit dispatch path')
assert.match(composerViewSource, /updateSettings\(\{ assistantBusyMessageMode \}\)/, 'the compact trigger persists whichever busy-send action was used last')
assert.match(composerViewSource, /queuedCount=\{controller\.queuedMessageCount\}/, 'the busy-send control receives the canonical queued-message count')
assert.doesNotMatch(composerViewSource, /queuedMessageCount > 0 \? \(/, 'queued count no longer renders as a separate footer pill')
assert.match(busySendSplitButtonSource, /primarySuffix=\{queuedCount > 0 \? <span className="text-\[10px\] font-semibold tabular-nums opacity-70"/, 'queued count appears as plain text inside the busy-send button')
assert.match(composerControlsSource, /closest\('\.assistant-conversation-pane'\)/, 'nested model and speed menus measure the conversation boundary')
assert.match(composerControlsSource, /style=\{\{ left: submenuLeft\.speed \}\}/, 'the speed flyout uses its collision-adjusted horizontal position')
assert.match(rendererCssSource, /zyra-effort-slider::\-webkit-slider-runnable-track \{[^]*height: 16px/, 'the effort slider uses the thicker reference rail')
assert.match(rendererCssSource, /zyra-effort-slider::\-webkit-slider-thumb \{[^]*width: 22px[^]*background: rgb\(255 255 255\)/, 'the effort slider uses the reference white thumb')
assert.match(settingsSource, /sidebarHoverPreviewEnabled: true/, 'existing hover-preview behavior remains enabled by default')
assert.match(settingsSource, /sidebarHoverPreviewEnabled: candidate\.sidebarHoverPreviewEnabled !== false/, 'the preference survives settings hydration')
assert.match(generalSettingsSource, /title="Sidebar hover preview"/, 'the preference is exposed alongside the chat rail setting')
assert.match(connectedRailSource, /hoverPreviewEnabled=\{settings\.sidebarHoverPreviewEnabled\}/, 'the chat rail receives the persisted preference')
assert.match(railSource, /collapsed && hoverPreviewEnabled && !loadingScreenActive/, 'the minimized chat edge trigger is omitted when hover preview is disabled')
assert.match(settingsShellSource, /settings\.sidebarCollapsed && settings\.sidebarHoverPreviewEnabled/, 'the minimized Settings edge trigger follows the same preference')
assert.match(preferenceContractsSource, /'sidebarHoverPreviewEnabled'/, 'the surface preference persists through the managed device-preference bridge')

console.log('Assistant live context and sent-message rendering: ok')
