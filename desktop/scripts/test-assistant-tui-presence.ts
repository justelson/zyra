import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assistantMobileDevices, assistantSessionMobileDevices, hasAssistantTuiPresence, isAssistantSessionOpenInTui } from '../src/renderer/src/pages/assistant/assistant-tui-presence'
import { resolveAssistantAgentInboxSettledInitialCount } from '../src/renderer/src/pages/assistant/assistant-agent-inbox-settled-window'
import { resolveAssistantInboxModelPresentation } from '../src/renderer/src/pages/assistant/assistant-model-labels'
import { mergeCanonicalPresenceObservation } from '../src/main/assistant/service-canonical-presence'
import { areAssistantSessionsRailSelectionsEqual } from '../src/renderer/src/lib/assistant/assistant-store-selection-helpers'

const tuiPresence = {
    state: 'ready',
    clients: [{ clientId: 'desktop:1', surface: 'desktop' }, { clientId: 'tui:1', surface: 'tui' }]
}
const desktopPresence = {
    state: 'ready',
    clients: [{ clientId: 'desktop:1', surface: 'desktop' }]
}

assert.equal(hasAssistantTuiPresence(tuiPresence), true)
assert.equal(hasAssistantTuiPresence(desktopPresence), false)
assert.equal(hasAssistantTuiPresence(null), false)
const mixedPresence = { clients: [...tuiPresence.clients,
    { clientId: 'mobile:one', surface: 'mobile', displayName: 'My phone' },
    { clientId: 'mobile:two', surface: ' MOBILE ', displayName: 'Travel phone' }] }
assert.equal(hasAssistantTuiPresence(mixedPresence), true, 'terminal and phone can both be present')
assert.deepEqual(assistantMobileDevices(mixedPresence), ['My phone', 'Travel phone'])
assert.deepEqual(assistantMobileDevices(null), [])
assert.deepEqual(assistantMobileDevices(desktopPresence), [])
assert.deepEqual(assistantMobileDevices({ clients: [{ surface: 'mobile' }] }), ['Android phone'], 'legacy clients have a friendly fallback')
assert.deepEqual(assistantSessionMobileDevices({ threads: [{ canonicalPresence: mixedPresence }, { canonicalPresence: mixedPresence }] } as any), ['My phone', 'Travel phone'], 'same phone attached to two threads appears once')
assert.deepEqual(assistantMobileDevices({ clients: [{ surface: 'mobile', displayName: '\u202ePhone\n' }] }), ['Phone'])
const observed = mergeCanonicalPresenceObservation(undefined, {
    ...mixedPresence, state: 'ready', activeTurnId: null, backgroundWorkActive: false, latestSequence: 7
})
assert.deepEqual(assistantMobileDevices(observed), ['My phone', 'Travel phone'], 'Desktop canonical observation preserves device metadata')
const selection = (presence: typeof observed) => ({ playground: { rootPath: '', labs: [] }, sessions: [{
    id: 'chat', title: 'Chat', activeThreadId: 'thread', createdAt: '2026-09-14T00:00:00Z',
    threads: [{ id: 'thread', createdAt: '2026-09-14T00:00:00Z', canonicalPresence: presence }]
}] } as any)
const renamed = { ...observed, clients: observed.clients.map(client => client.clientId === 'mobile:one' ? { ...client, displayName: 'Renamed phone' } : client) }
assert.equal(areAssistantSessionsRailSelectionsEqual(selection(observed), selection(renamed)), false, 'device label changes redraw the rail without requiring a new turn')
const departed = { ...observed, clients: observed.clients.filter(client => client.surface.trim().toLowerCase() !== 'mobile') }
assert.equal(areAssistantSessionsRailSelectionsEqual(selection(observed), selection(departed)), false, 'detach redraws both sidebar layouts')
assert.deepEqual(assistantMobileDevices(departed), [])
assert.equal(isAssistantSessionOpenInTui({
    threads: [
        { canonicalPresence: desktopPresence },
        { canonicalPresence: tuiPresence }
    ]
} as any), true, 'a chat row reflects TUI presence from any of its own canonical threads')
assert.equal(isAssistantSessionOpenInTui({ threads: [{ canonicalPresence: desktopPresence }] } as any), false)
assert.equal(resolveAssistantAgentInboxSettledInitialCount(0), 1)
assert.equal(resolveAssistantAgentInboxSettledInitialCount(36), 1)
assert.equal(resolveAssistantAgentInboxSettledInitialCount(38), 2)
assert.equal(resolveAssistantAgentInboxSettledInitialCount(185), 5)
assert.deepEqual(resolveAssistantInboxModelPresentation('opencode-harness/opencode/mimo-v2.6-flash-free'), {
    modelName: 'mimo-v2.6-flash-free',
    provider: 'opencode-harness'
}, 'Inbox model text shows only the harness model name and identifies its source for the icon')
assert.deepEqual(resolveAssistantInboxModelPresentation('openai-codex/gpt-6-luna'), {
    modelName: 'gpt-6-luna',
    provider: 'openai-codex'
}, 'Codex model labels show only the model name and identify OpenAI for the icon')
assert.deepEqual(resolveAssistantInboxModelPresentation('openai/gpt-5'), {
    modelName: 'gpt-5',
    provider: 'openai'
}, 'all provider/model labels omit the provider text')
assert.deepEqual(resolveAssistantInboxModelPresentation('gpt-5'), { modelName: 'gpt-5', provider: null }, 'unqualified model names remain unchanged')
assert.deepEqual(resolveAssistantInboxModelPresentation(null), { modelName: '', provider: null })
assert.deepEqual(resolveAssistantInboxModelPresentation('opencode-harness/'), { modelName: '', provider: 'opencode-harness' }, 'an incomplete harness route never leaks its provider path into the model label')

const indicatorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTuiPresenceIndicator.tsx', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationHeader.tsx', import.meta.url), 'utf8')
const railSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const selectionSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-selection-helpers.ts', import.meta.url), 'utf8')
const inboxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx', import.meta.url), 'utf8')

assert.match(indicatorSource, /SquareTerminal/, 'TUI presence is represented by one terminal icon')
assert.match(indicatorSource, /This session is open in the TUI/, 'hover and keyboard focus expose the requested status copy')
assert.match(indicatorSource, /createPortal[\s\S]*role="tooltip"/, 'the tooltip escapes clipped header and sidebar rows')
assert.match(indicatorSource, /transition-\[opacity,transform\][\s\S]*duration-\[140ms\]/, 'the tooltip fades in and out without heavy motion')
assert.match(indicatorSource, /text-\[var\(--status-success\)\]/, 'the icon uses Zyra’s semantic green success color')
assert.match(indicatorSource, /compact \? 12 : 15/, 'the header icon is larger while dense chat rows stay compact')
assert.doesNotMatch(indicatorSource, /hover:scale|focus-visible:scale/, 'hover and focus never move or grow the presence icon')
assert.match(headerSource, /hasAssistantTuiPresence\(canonicalPresence\)[\s\S]*<AssistantTuiPresenceIndicator/, 'the selected chat header uses canonical TUI client presence')
assert.doesNotMatch(headerSource, /surface === 'tui' \? 'TUI'/, 'the old text-heavy TUI badge is removed')
assert.match(railSource, /isAssistantSessionOpenInTui\(session\)[\s\S]*<AssistantTuiPresenceIndicator focusable=\{false\} compact/, 'each chat row shows its own compact TUI presence icon')
assert.match(railSource, /hasAssistantTuiPresence\(thread\.canonicalPresence\)[\s\S]*<AssistantTuiPresenceIndicator focusable=\{false\} compact/, 'visible nested thread rows preserve thread-specific TUI presence')
assert.match(selectionSource, /presence\?\.clients[\s\S]*client\.clientId[\s\S]*client\.surface/, 'rail equality invalidates when TUI clients attach or detach without changing turn state')
assert.match(inboxSource, /tuiOpen: isAssistantSessionOpenInTui\(session\)/, 'Inbox items derive TUI presence from their own canonical chat')
assert.match(inboxSource, /resolveAssistantInboxModelPresentation\(item\.thread\?\.model\)/, 'Active work rows format the canonical thread model for display')
assert.match(inboxSource, /model\.provider[\s\S]*<SettingsProviderIcon provider=/, 'Active work rows use the provider icon instead of provider text')
assert.match(inboxSource, /\{model\.modelName \|\| 'Assistant'\}/, 'Active work rows show only the formatted model name')
assert.equal((inboxSource.match(/<AssistantTuiPresenceIndicator focusable=\{false\} \/>/g) || []).length, 2, 'both Inbox card and slim-row presentations show the TUI icon')
assert.equal((inboxSource.match(/mobileDevices=\{item\.mobileDevices\}/g) || []).length, 2, 'both Inbox layouts show the phone icon beside TUI presence')
assert.match(headerSource, /mobileDevices=\{mobileDevices\}/)
assert.equal((railSource.match(/mobileDevices=\{mobileDevices\}/g) || []).length, 2, 'chat and nested thread rows use their own attached phones')
assert.match(selectionSource, /client\.displayName/, 'device renames invalidate memoized rail metadata')
assert.doesNotMatch(inboxSource, /AssistantTuiPresenceIndicator focusable=\{false\} compact/, 'Inbox uses the slightly larger terminal icon')
assert.match(inboxSource, /mt-0\.5 flex h-4[\s\S]*data-assistant-presence-group[\s\S]*<AssistantTuiPresenceIndicator focusable=\{false\}/, 'Inbox cards align TUI presence in their model metadata row')
assert.match(inboxSource, /function AgentInboxSlimRow[\s\S]*<AssistantTuiPresenceIndicator focusable=\{false\}[\s\S]*formatAssistantSidebarRelativeTime\(item\.activityAt\)/, 'Inbox slim rows align TUI presence before relative time')
assert.match(railSource, /\{tuiOpen \? <AssistantTuiPresenceIndicator[\s\S]*\{timeLabel\}/, 'standard chat rows align TUI presence before relative time')
assert.ok(/function InboxRowActions[\s\S]*inFlow\s*\? 'relative grid[\s\S]*grid-cols-\[0fr\][\s\S]*group-hover\/agent-inbox-row:grid-cols-\[1fr\]/.test(inboxSource), 'slim-row actions expand inside the row as they enter')
assert.match(inboxSource, /function AgentInboxSlimRow[\s\S]*<AssistantTuiPresenceIndicator focusable=\{false\}[\s\S]*group-hover\/agent-inbox-row:max-w-0[\s\S]*<InboxRowActions[^>]*inFlow/, 'presence icons remain in flow while the time yields its space to the actions')
assert.match(inboxSource, /translate-x-1 opacity-0[\s\S]*group-hover\/agent-inbox-row:translate-x-0[\s\S]*group-hover\/agent-inbox-row:opacity-100/, 'Inbox actions keep their restrained slide-in motion')
assert.doesNotMatch(inboxSource, /group-hover\/agent-inbox-row:-translate-x-6/, 'presence icons no longer move into the action controls')
assert.match(inboxSource, /data-agent-inbox-layout-id[\s\S]*useLayoutEffect[\s\S]*cubic-bezier\(0\.22, 1, 0\.36, 1\)/, 'Inbox rows animate smoothly between Settled, Recent, and Active work')
assert.match(inboxSource, /measureSettledInitialWindow[\s\S]*header\.offsetTop \+ header\.offsetHeight[\s\S]*scroller\.clientHeight - headerContentBottom/, 'the initial Settled batch uses layout coordinates independent of motion and scrolling')
assert.match(inboxSource, /assistant-sidebar-scrollbar relative/, 'the settled header offset is relative to its scroller')
assert.match(inboxSource, /new ResizeObserver\(measureSettledInitialWindow\)/, 'resizing the sidebar recomputes the visible Settled batch')
assert.doesNotMatch(inboxSource, /SETTLED_INITIAL_COUNT/, 'Settled no longer renders an arbitrary fixed first batch')
assert.match(inboxSource, /See \{Math\.min\(hiddenSettledCount, SETTLED_PAGE_COUNT\)\} more/, 'the next Settled page is disclosed only after the viewport-sized first batch')
assert.match(railSource, /shrink-0 transition-opacity[\s\S]*group-hover:opacity-0[\s\S]*pointer-events-none absolute right-2\.5/, 'standard row metadata keeps a stable width while the action button overlays its right edge')
assert.doesNotMatch(railSource, /group-hover:grid-cols-\[0fr\]/, 'chat actions do not squeeze active-row titles or status metadata')
assert.doesNotMatch(railSource, /group-focus-within:(?:pointer-events-auto|opacity-100)/, 'selecting or focusing the active chat row cannot pin its ellipsis action open')

console.log('Assistant TUI presence indicators: ok')
