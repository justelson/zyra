import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    buildAssistantChatRoute,
    buildAssistantMessageSearchRoute,
    parseAssistantChatRoute,
    parseAssistantMessageSearchTarget
} from '../src/renderer/src/pages/assistant/assistant-chat-route'
import { resolveCommandPaletteArrowIndex } from '../src/renderer/src/components/command-palette-navigation'

const sessionId = 'assistant-session:abc/123'
const threadId = 'assistant-thread:main value'
const route = buildAssistantChatRoute(sessionId, threadId)
assert.equal(
    route,
    '/assistant/chat/assistant-session%3Aabc%2F123/thread/assistant-thread%3Amain%20value',
    'chat URLs must safely encode stable session and thread identities'
)
assert.deepEqual(
    parseAssistantChatRoute(route),
    { kind: 'chat', sessionId, threadId },
    'a browser refresh must recover the exact chat and thread from its URL'
)
const messageId = 'message:voice/restart'
const messageRoute = buildAssistantMessageSearchRoute(sessionId, threadId, messageId)
assert.equal(messageRoute, `${route}?message=message%3Avoice%2Frestart`)
assert.equal(parseAssistantMessageSearchTarget(new URL(messageRoute, 'https://zyra.local').search), messageId)
assert.equal(parseAssistantMessageSearchTarget('?message=%20%20'), null)

assert.equal(resolveCommandPaletteArrowIndex(0, 'ArrowDown', 4), 1)
assert.equal(resolveCommandPaletteArrowIndex(3, 'ArrowDown', 4), 0, 'ArrowDown must wrap from the last result to the first')
assert.equal(resolveCommandPaletteArrowIndex(0, 'ArrowUp', 4), 3, 'ArrowUp must wrap from the first result to the last')
assert.equal(resolveCommandPaletteArrowIndex(12, 'ArrowUp', 4), 2, 'keyboard navigation must normalize stale result indexes')
assert.equal(resolveCommandPaletteArrowIndex(0, 'ArrowDown', 0), 0)

assert.deepEqual(
    parseAssistantChatRoute('/assistant/chat/assistant-session%3Aabc'),
    { kind: 'chat', sessionId: 'assistant-session:abc', threadId: null },
    'session-only chat links remain valid and canonicalize after loading'
)
assert.deepEqual(parseAssistantChatRoute('/assistant'), { kind: 'assistant-root' })
assert.deepEqual(parseAssistantChatRoute('/assistant/dev/full-chat'), { kind: 'reserved' }, 'browser design fixtures must retain their dedicated URLs')
assert.deepEqual(parseAssistantChatRoute('/settings/account'), { kind: 'outside-assistant' })

const appSource = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const connectedRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConnectedSessionsRail.tsx', import.meta.url), 'utf8')
const browserAssistantSource = readFileSync(new URL('../src/renderer/src/lib/browser-assistant-bridge-adapter.ts', import.meta.url), 'utf8')
const assistantStoreSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
const assistantTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimeline.tsx', import.meta.url), 'utf8')
const assistantVirtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const commandPaletteSource = readFileSync(new URL('../src/renderer/src/components/CommandPalette.tsx', import.meta.url), 'utf8')
const commandPaletteResultsSource = readFileSync(new URL('../src/renderer/src/components/CommandPaletteResults.tsx', import.meta.url), 'utf8')
const createAndNavigateSource = readFileSync(new URL('../src/renderer/src/pages/assistant/create-assistant-chat-and-navigate.ts', import.meta.url), 'utf8')
assert.equal(appSource.includes('<Route path="/assistant/*"'), true, 'deep chat URLs must remain inside the Assistant route')
assert.equal(pageSource.includes('useAssistantChatRouting'), true, 'Assistant selection must synchronize with browser history')
assert.equal(pageSource.includes('loadHistoryAroundMessage'), true, 'message search routes must request a bounded page around the exact canonical message')
assert.equal(pageSource.includes('shell.commandPending || !shell.selectedSessionId'), true, 'cross-chat message search must wait for authoritative route selection before applying its anchor page')
assert.equal(pageSource.includes('focusMessageId={messageSearchTarget}'), true, 'message search routes must carry the exact canonical identity into the timeline')
assert.equal(assistantTimelineSource.includes('const messageId = focusMessageId'), true, 'exact-message navigation must retry layout when the anchored rows arrive after the route')
assert.equal(assistantTimelineSource.includes("scrollToIndex({ index: rowIndex, viewPosition: 0.5"), true, 'exact-message navigation must center virtualized rows without hydrating full history')
assert.equal(assistantTimelineSource.includes('revealContent={Boolean(focusMessageId'), true, 'exact-message navigation must reveal a target inside a collapsed work summary')
assert.equal(assistantVirtualTimelineSource.includes('if (!props.focusMessageId) return'), true, 'exact-message navigation must release follow-end before centering the virtual row')
assert.equal(commandPaletteSource.includes('role="combobox"'), true, 'chat search must expose its keyboard-controlled combobox semantics')
assert.equal(commandPaletteSource.includes('aria-activedescendant='), true, 'chat search must expose the visually selected result to assistive technology')
assert.equal(commandPaletteSource.includes("scrollIntoView({ block: 'nearest' })"), true, 'arrow-key navigation must keep the active result visible without scrolling the full page')
assert.equal(commandPaletteResultsSource.includes('onMouseMove={() => setSelectedIndex(index)}'), true, 'a stationary pointer must not override keyboard selection while the list scrolls')
assert.equal(commandPaletteSource.includes('role="listbox"'), true, 'chat search results must expose listbox semantics')
assert.equal(commandPaletteSource.includes('role="status"'), true, 'async chat-search state and result counts must use a polite live region')
assert.equal(commandPaletteResultsSource.includes('aria-selected={isSelected}'), true, 'chat search options must expose their selected state')
assert.equal(commandPaletteResultsSource.includes('tabIndex={-1}'), true, 'active-descendant options must keep DOM focus on the combobox')
assert.equal(commandPaletteSource.includes('event.target !== inputRef.current'), true, 'result activation keys must be scoped to the combobox to avoid duplicate actions')
assert.equal(commandPaletteSource.includes('if (!result || activationPendingRef.current) return'), true, 'result activation must single-flight before running an action')
assert.equal(commandPaletteSource.includes('previouslyFocusedElement?.focus()'), true, 'closing search must restore the invoking control focus')
assert.equal(connectedRailSource.includes('navigate(buildAssistantChatRoute(sessionId'), true, 'chat clicks must update the URL immediately instead of waiting for backend selection')
assert.equal(connectedRailSource.includes('navigate(buildAssistantChatRoute(input.sessionId, input.threadId))'), true, 'thread clicks must receive their own URL immediately')
assert.equal(connectedRailSource.includes('createAssistantChatAndNavigate(railController, navigate)'), true, 'New Chat must route from the returned session identity instead of waiting for shared selection')
assert.equal(createAndNavigateSource.includes('navigate(buildAssistantChatRoute(result.sessionId'), true, 'newly created browser chats must receive a stable URL before the old route can reclaim selection')
const directSessionSelectionIndex = connectedRailSource.indexOf('void railController.selectSession(sessionId)')
const sessionNavigationIndex = connectedRailSource.indexOf('navigate(buildAssistantChatRoute(sessionId')
assert.ok(directSessionSelectionIndex >= 0 && directSessionSelectionIndex < sessionNavigationIndex, 'chat clicks synchronously select the cached target before committing its one browser-history entry')
const directThreadSelectionIndex = connectedRailSource.indexOf('void railController.selectThread(input)')
const threadNavigationIndex = connectedRailSource.indexOf('navigate(buildAssistantChatRoute(input.sessionId, input.threadId))')
assert.ok(directThreadSelectionIndex >= 0 && directThreadSelectionIndex < threadNavigationIndex, 'sub-thread clicks synchronously select their cached target before route synchronization')
assert.equal(connectedRailSource.includes('await railController.selectSession'), false, 'sidebar selection never waits for authoritative IPC before navigation')
assert.equal(connectedRailSource.includes('await railController.selectThread'), false, 'sub-thread selection never waits for authoritative IPC before navigation')
assert.equal(browserAssistantSource.includes('projectBrowserRouteSnapshot'), true, 'a cold browser deep link must survive bootstrap selection from Desktop')
assert.equal(browserAssistantSource.includes('bootstrap: getBrowserBootstrap'), true, 'browser bootstrap must project its stable route before the store hydrates')
assert.equal(assistantStoreSource.includes('claimBrowserRoutedConnection'), true, 'browser stream reconnects must reclaim the routed session after the lease activates')
assert.equal(assistantStoreSource.includes('window.devscope.assistant.connect({ sessionId })'), true, 'thread routes must reconnect the selected session so Back and Forward remain usable')
assert.equal(assistantStoreSource.includes('return stillAnchored || await applyAnchor()'), true, 'a late route hydration must not overwrite the exact message search anchor')

console.log('Assistant chat routing: ok')
