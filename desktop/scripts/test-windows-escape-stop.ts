import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mock } from 'bun:test'
const shortcuts = new Map<string, () => void>()
mock.module('electron', () => ({ BrowserWindow: class {}, screen: {}, globalShortcut: {
    isRegistered: (key: string) => shortcuts.has(key),
    register: (key: string, callback: () => void) => { shortcuts.set(key, callback); return true },
    unregister: (key: string) => shortcuts.delete(key)
} }))
const { WindowsControlOverlayManager } = await import('../src/main/agent-control/windows-control-overlay')
const reasons: string[] = []
const overlay = Object.create(WindowsControlOverlayManager.prototype) as any
overlay.broker = { emergencyStop: (reason: string) => { reasons.push(reason); return Promise.resolve() } }
overlay.hideOverlays = () => {}
overlay.activateEscapeShortcut()
assert(shortcuts.has('Esc'), 'physical Escape remains globally registered during computer use')
shortcuts.get('Esc')!()
assert.equal(reasons.length, 1, 'physical Escape immediately reaches emergency stop')
assert.match(reasons[0]!, /Escape/)
const inputSource = readFileSync(new URL('../../native/zyra-computer-use/src/Zyra.ComputerUse/Input/InputProvider.cs', import.meta.url), 'utf8')
assert.match(inputSource, /virtualKey == 0x1B && modifierKeys.Length == 0[\s\S]*TargetedEscapeDispatcher\.Dispatch[\s\S]*return;/, 'only plain agent Escape uses the selected-control message path')
assert.match(inputSource, /NativeMethods\.SendInput\(\(uint\)inputs.Count/, 'other keyboard actions retain the native SendInput path')
assert.doesNotMatch(inputSource, /unregister|suppressEscape|ignoreEscape/i, 'agent Escape cannot disable the physical stop shortcut')
console.log('Plain physical Escape emergency stop remains active; only agent plain Escape uses targeted dismissal: ok')
