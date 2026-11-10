import assert from 'node:assert/strict'
import { mock } from 'bun:test'
const noop = () => {}
mock.module('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {}, screen: {}, dialog: {} }))
mock.module('../src/main/ipc/trusted-ipc', () => ({ ipcMain: { handle: noop } }))
const { NativeOverlayManager } = await import('../src/main/native-overlay-manager')
const manager = new NativeOverlayManager() as any
let keyboardOwner = 'composer', visible = false, focusCalls = 0
const contents = { isDestroyed: () => false, getZoomFactor: () => 1, isFocused: () => keyboardOwner === 'overlay',
    focus: () => { keyboardOwner = 'overlay'; focusCalls++ }, setZoomFactor: noop }
const view = { getVisible: () => visible, setVisible: (value: boolean) => { visible = value }, setBounds: noop }
const owner = { window: { isDestroyed: () => false, isFocused: () => true, isVisible: () => true, isMinimized: () => false,
    getContentBounds: () => ({ width: 1000, height: 700 }), contentView: { children: [view] } },
    contents: { isDestroyed: () => false, getZoomFactor: () => 1, focus: () => { keyboardOwner = 'composer' } } }
const slot = { contents, view, companion: null, visible: true, focus: true, kind: 'interactive', bounds: { x: 0, y: 0, width: 400, height: 300 } }
manager.present(owner, slot)
assert.equal(keyboardOwner, 'overlay', 'deliberate opening can focus the overlay once')
keyboardOwner = 'browser'
slot.bounds.width = 420
manager.present(owner, slot)
assert.equal(keyboardOwner, 'browser', 'native layout updates cannot reclaim focus from the page')
keyboardOwner = 'composer'
manager.present(owner, slot)
assert.equal(keyboardOwner, 'composer', 'owner focus events cannot replay an old overlay focus request')
assert.equal(focusCalls, 1)
owner.window.isFocused = () => false
slot.focus = true
manager.present(owner, slot)
assert.equal(focusCalls, 1, 'an inactive app cannot consume the user’s keyboard focus')
owner.window.isFocused = () => true
manager.present(owner, slot)
assert.equal(focusCalls, 1, 'returning to the app cannot revive that stale focus request')
console.log('Native overlay focus: explicit opening only; bounds and owner updates preserve Browser/composer ownership')
