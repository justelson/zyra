import assert from 'node:assert/strict'
import { createDesktopLinkDispatcher, desktopWebLink, normalizeDesktopLinkPreference, type DesktopLinkPreference } from '../src/shared/desktop-link-policy'
assert.equal(normalizeDesktopLinkPreference(null), 'ask')
assert.equal(normalizeDesktopLinkPreference('other'), 'ask')
assert.equal(normalizeDesktopLinkPreference('zyra'), 'zyra')
assert.equal(desktopWebLink('https://example.com/a?q=1'), 'https://example.com/a?q=1')
for (const url of ['file:///C:/private', 'javascript:alert(1)', 'data:text/html,test', 'mailto:me@example.com', 'https://user:pass@example.com', 'https://example.com/\nsecret', '/relative', 'https://' + 'a'.repeat(17000)]) assert.equal(desktopWebLink(url), null)
let preference: DesktopLinkPreference = 'ask'
let presented: string | null = null
let opened: Array<[string, string]> = []
let fail = false
const dispatch = createDesktopLinkDispatcher({ preference: () => preference, remember: value => { preference = value }, choose: url => { presented = url }, open: async (url, destination) => { opened.push([url, destination]); return fail ? { success: false, error: 'offline' } : { success: true } } })
const cancelled = dispatch.request('https://example.com/cancel')
assert.equal(presented, 'https://example.com/cancel'); assert.deepEqual(opened, [])
dispatch.cancel(); assert.equal((await cancelled).cancelled, true); assert.equal(preference, 'ask'); assert.deepEqual(opened, [])
const first = dispatch.request('https://example.com/first')
const next = dispatch.request('https://example.com/second')
assert.equal((await first).cancelled, true)
await dispatch.select('zyra', true)
assert.equal((await next).success, true); assert.equal(preference, 'zyra'); assert.equal(presented, null)
await dispatch.request('https://example.com/third'); assert.equal(opened.at(-1)?.[1], 'zyra')
preference = 'ask'; const once = dispatch.request('https://example.com/once'); await dispatch.select('system', false); await once; assert.equal(preference, 'ask')
fail = true; const failed = dispatch.request('https://example.com/fail'); await dispatch.select('zyra', true); assert.equal((await failed).success, false); assert.equal(preference, 'ask')
const before = opened.length; assert.equal((await dispatch.request('javascript:bad')).success, false); assert.equal(opened.length, before)
console.log('Desktop link policy: cancellation, validation, replacement, persistence, failures and both destinations passed')

const storageFailure = createDesktopLinkDispatcher({ preference: () => 'ask', remember: () => { throw Error('storage') }, choose: () => {}, open: async () => ({ success: true }) })
const unavailableStorage = storageFailure.request('https://example.com'); await storageFailure.select('system', true); assert.match((await unavailableStorage).error || '', /could not be saved/)

// Exercise presentation ownership independently of Electron: old modal leases hide,
// new chooser leases remain visible, and released origins are never restored.
const { getNativeOverlayHost } = await import('../src/renderer/src/components/ui/native-overlay-host')
const host = getNativeOverlayHost() as unknown as {
    leases: Set<symbol>; presented: Set<symbol>; suspended: Set<symbol>;
    setVisible: (value: boolean) => Promise<void>;
    hasPresented: () => boolean; suspendCurrentPresentation: () => () => void
}
const visibility: boolean[] = []
const originalSetVisible = host.setVisible
host.setVisible = async value => { visibility.push(value) }
const originalCancel = globalThis.cancelAnimationFrame
globalThis.cancelAnimationFrame = () => {}
const origin = Symbol('origin'), chooser = Symbol('chooser')
host.leases.add(origin); host.presented.add(origin)
const restorePresentation = host.suspendCurrentPresentation()
assert.equal(host.hasPresented(), false); assert.deepEqual(visibility, [false])
host.leases.add(chooser); host.presented.add(chooser)
assert.equal(host.hasPresented(), true)
restorePresentation(); assert.equal(host.suspended.size, 0); assert.equal(visibility.at(-1), true)
host.leases.delete(chooser); host.presented.delete(chooser)
const restoreReleased = host.suspendCurrentPresentation()
host.leases.delete(origin); host.presented.delete(origin)
const beforeRestore = visibility.length; restoreReleased(); assert.equal(visibility.length, beforeRestore)
host.setVisible = originalSetVisible
globalThis.cancelAnimationFrame = originalCancel
console.log('Native presentation suspension preserves new overlays and released origins')

// A delayed destination choice belongs to its originating chat, even if navigation changes.
const { captureZyraBrowserLinkOpener, installChatBrowserLinkHandler } = await import('../src/renderer/src/lib/zyra-browser-links')
const { subscribeAssistantInspectorNavigation, acknowledgeAssistantInspectorNavigation, isAssistantInspectorNavigationForChat } = await import('../src/renderer/src/pages/assistant/assistant-inspector-navigation')
const originalWindow = globalThis.window
const accessories: unknown[] = []
;(globalThis as any).window = { devscope: { accessories: { open: async (input: unknown) => { accessories.push(input); return { success: true } } } } }
const browserRequests: any[] = []
const releaseRequests = subscribeAssistantInspectorNavigation(request => { browserRequests.push(request); acknowledgeAssistantInspectorNavigation(request) })
const outside = captureZyraBrowserLinkOpener()
await outside('https://example.com/outside')
assert.equal(accessories.length, 1, 'non-chat links retain the standalone browser')
const releaseFirstChat = installChatBrowserLinkHandler({ sessionId: 'chat-one', threadId: 'thread-one' })
const scopedDispatch = createDesktopLinkDispatcher({ preference: () => 'ask', remember: () => {}, choose: () => {}, captureContext: captureZyraBrowserLinkOpener,
    open: (url, _destination, captured) => captured!(url) })
const scopedPending = scopedDispatch.request('https://example.com/chat')
await scopedDispatch.select('zyra', false)
assert.equal((await scopedPending).success, true)
assert.deepEqual(browserRequests.at(-1), { workspace: 'browser', sessionId: 'chat-one', threadId: 'thread-one', url: 'https://example.com/chat' })
assert.equal(accessories.length, 1, 'chat opening never creates an accessory window')
const stalePending = scopedDispatch.request('https://example.com/stale')
const releaseSecondChat = installChatBrowserLinkHandler({ sessionId: 'chat-two', threadId: 'thread-two' })
releaseFirstChat()
await scopedDispatch.select('zyra', false)
assert.equal((await stalePending).success, false, 'a delayed choice cannot move to another chat')
assert.equal(browserRequests.length, 1)
const currentChat = captureZyraBrowserLinkOpener()
assert.equal((await currentChat('https://example.com/current')).success, true, 'old cleanup cannot unregister a newer chat')
assert.equal(browserRequests.at(-1).sessionId, 'chat-two')
assert.equal(isAssistantInspectorNavigationForChat(browserRequests.at(-1), 'chat-one', 'thread-one'), false)
assert.equal(isAssistantInspectorNavigationForChat(browserRequests.at(-1), 'chat-two', 'thread-two'), true)
assert.equal((await currentChat('javascript:bad')).success, false)
releaseSecondChat()
assert.equal((await currentChat('https://example.com/released')).success, false, 'unmounted chat cannot fall back into a new window')
releaseRequests()
const releaseMounting = installChatBrowserLinkHandler({ sessionId: 'chat-mounting', threadId: 'thread-mounting' })
await captureZyraBrowserLinkOpener()('https://example.com/deferred')
const deferred: unknown[] = []
const notReady = subscribeAssistantInspectorNavigation(request => deferred.push(request), false)
assert.equal(deferred.length, 0, 'link remains pending while the inspector is mounting')
notReady()
const ready = subscribeAssistantInspectorNavigation(request => { deferred.push(request); acknowledgeAssistantInspectorNavigation(request) })
assert.deepEqual(deferred, [{ workspace: 'browser', sessionId: 'chat-mounting', threadId: 'thread-mounting', url: 'https://example.com/deferred' }])
ready()
const again = subscribeAssistantInspectorNavigation(request => deferred.push(request))
assert.equal(deferred.length, 1, 'acknowledged link cannot reopen on remount')
again(); releaseMounting()
;(globalThis as any).window = originalWindow
console.log('Chat browser routing: exact owner, delayed chooser isolation, stale cleanup, safe URLs and standalone fallback passed')
