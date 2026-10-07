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
