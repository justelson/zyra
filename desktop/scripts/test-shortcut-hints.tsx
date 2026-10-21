import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hintBinding, hintsBlocked, isHintModifier, isHintTargetVisible, shortcutCommand, type HeldModifiers } from '../src/renderer/src/lib/shortcut-hints'
import { ShortcutKeycaps, shortcutKeyLabels } from '../src/renderer/src/components/ui/ShortcutKeycaps'

const held = (value: Partial<HeldModifiers> = {}): HeldModifiers => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...value })
assert.equal(hintBinding('app.files', 'win32', {}, held({ ctrlKey: true })), undefined, 'a partial modifier chord must not advertise an action')
assert.equal(hintBinding('app.files', 'win32', {}, held({ ctrlKey: true, altKey: true })), 'Ctrl+Alt+2')
assert.equal(hintBinding('app.files', 'win32', {}, held({ ctrlKey: true, altKey: true, shiftKey: true })), undefined, 'extra held modifiers must not match')
assert.equal(hintBinding('app.files', 'darwin', {}, held({ metaKey: true, altKey: true })), 'Meta+Alt+2')
assert.equal(hintBinding('app.files', 'darwin', {}, held({ ctrlKey: true, altKey: true })), undefined)
assert.equal(hintBinding('app.files', 'linux', { 'app.files': ['Mod+Shift+Q'] }, held({ ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+q')
assert.equal(hintBinding('app.files', 'win32', { 'app.files': [] }, held({ ctrlKey: true, altKey: true })), undefined, 'disabled commands have no hint')
assert.equal(hintBinding('app.search', 'win32', { 'app.search': ['Mod+N'] }, held({ ctrlKey: true })), undefined, 'ambiguous imported overrides fail closed like dispatch')
assert.equal(hintBinding('app.search', 'win32', {}, held({ ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+p', 'matching alternate binding is selected')
assert.equal(hintBinding('app.search', 'win32', {}, held()), undefined)
assert.equal(hintBinding('app.search', 'win32', {}, held({ shiftKey: true })), undefined)
assert.equal(shortcutCommand('app.chat9'), 'app.chat9')
assert.equal(shortcutCommand('not-a-command'), undefined)
assert.equal(isHintModifier('Shift'), true)
assert.equal(isHintModifier('k'), false)
assert.deepEqual(shortcutKeyLabels('Meta+Alt+Shift+arrowleft', 'darwin'), ['⌘', '⌥', '⇧', '←'])
const markup = renderToStaticMarkup(<ShortcutKeycaps id="app.files" platform="win32" overrides={{}} />)
assert.equal((markup.match(/<kbd\b/g) || []).length, 3, 'every individual key is a semantic keycap')
assert.ok(!markup.includes('Ctrl+Alt+2'), 'a binding is never a single keycap')
assert.equal(renderToStaticMarkup(<ShortcutKeycaps id="app.files" platform="win32" overrides={{ 'app.files': [] }} />).includes('Unassigned'), true)

// Geometry/style contracts use tiny DOM-shaped fixtures, without adding a DOM dependency.
function target({ hidden = false, disabled = false, connected = true, x = 10, width = 20, opacity = '1' } = {}): HTMLElement {
    const node = {
        isConnected: connected, parentElement: null,
        closest: () => hidden || disabled ? {} : null,
        getBoundingClientRect: () => ({ left: x, top: 10, right: x + width, bottom: 30, width, height: 20 }),
        ownerDocument: { defaultView: { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity, pointerEvents: 'auto' }) } }
    }
    return node as unknown as HTMLElement
}
assert.equal(isHintTargetVisible(target()), true)
for (const options of [{ hidden: true }, { disabled: true }, { connected: false }, { x: 900 }, { width: 0 }, { opacity: '0' }]) {
    assert.equal(isHintTargetVisible(target(options)), false, `ineligible target: ${JSON.stringify(options)}`)
}
const nativeChild = target()
const nativeContainer = target()
Object.assign(nativeChild, { parentElement: nativeContainer })
const view = nativeChild.ownerDocument.defaultView!
Object.assign(view, { getComputedStyle: (node: HTMLElement) => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: node === nativeContainer ? 'none' : 'auto' }) })
assert.equal(isHintTargetVisible(nativeChild), true, 'interactive descendants in passive native portal containers remain eligible')
assert.equal(hintsBlocked([{ querySelectorAll: () => [target()] } as unknown as Document]), true)
assert.equal(hintsBlocked([{ querySelectorAll: () => [target({ hidden: true })] } as unknown as Document]), false)
console.log('Shortcut hint exact chords, platform/overrides, conflicts, eligibility and per-key markup: ok')
