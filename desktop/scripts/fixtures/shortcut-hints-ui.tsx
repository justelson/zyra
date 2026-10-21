import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter } from 'react-router-dom'
import { ShortcutHints } from '../../src/renderer/src/components/layout/ShortcutHints'
import { setShortcutRecording } from '../../src/renderer/src/lib/keybindings'

const w = window as any
const sleep = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function wait(test: () => unknown, label: string) { for (let i = 0; i < 100; i++) { if (test()) return; await sleep() }; throw new Error(label) }
const hint = () => document.querySelector<HTMLElement>('[data-shortcut-hint="app.files"]')
function key(type: string, name: string, modifiers: KeyboardEventInit = {}) { document.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, ...modifiers })) }
function release() { key('keyup', 'Shift'); key('keyup', 'Alt'); key('keyup', 'Control') }
w.__selectionUICheck = (async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    w.__fixtureSettings = { keyboardShortcuts: {} }
    w.__fixturePaletteOpen = false
    const root = createRoot(document.getElementById('root')!)
    const render = () => flushSync(() => root.render(<MemoryRouter><div style={{ padding: 40 }}>
        <input id="focus" defaultValue="Keep focus" />
        <button id="files" data-shortcut-command="app.files" style={{ position: 'fixed', left: 100, top: 100, width: 150, height: 32 }}>Files</button>
        <button disabled data-shortcut-command="app.terminal" style={{ position: 'fixed', left: 100, top: 150 }}>Disabled terminal</button>
        <button hidden data-shortcut-command="app.browser">Hidden browser</button>
        <ShortcutHints />
    </div></MemoryRouter>))
    try {
        render(); await sleep(50)
        const input = document.getElementById('focus') as HTMLInputElement
        input.focus()
        const control = document.getElementById('files')!
        const before = control.getBoundingClientRect()
        key('keydown', 'Control', { ctrlKey: true }); await sleep(500)
        check(!hint(), 'Partial held chord cannot advertise Files')
        key('keydown', 'Alt', { ctrlKey: true, altKey: true })
        await wait(hint, 'Exact Ctrl+Alt hold reveals local Files hint')
        const caps = hint()!.querySelectorAll('kbd'), rect = hint()!.getBoundingClientRect()
        check(caps.length === 3 && [...caps].map(cap => cap.textContent).join('|') === 'Ctrl|Alt|2', 'Individual keycaps use real registry binding')
        check(Math.abs(rect.top - before.top) < 3 && rect.left >= before.right && rect.left - before.right < 12, 'Hint anchors beside the related visible control')
        check(getComputedStyle(hint()!).pointerEvents === 'none' && hint()!.getAttribute('aria-hidden') === 'true', 'Passive hint does not intercept clicks/focus')
        check(control.getBoundingClientRect().left === before.left && control.getBoundingClientRect().width === before.width && document.activeElement === input, 'Hint causes no layout or focus change')
        check(!document.querySelector('[data-shortcut-hint="app.terminal"]') && !document.querySelector('[data-shortcut-hint="app.browser"]'), 'Hidden and disabled controls never advertise actions')
        key('keyup', 'Alt', { ctrlKey: true }); await wait(() => !hint(), 'Release removes stale exact-chord hint'); release()
        w.__fixtureSettings = { keyboardShortcuts: { 'app.files': ['Mod+Shift+Q'] } }; render(); await sleep(20)
        key('keydown', 'Control', { ctrlKey: true }); key('keydown', 'Shift', { ctrlKey: true, shiftKey: true })
        await wait(hint, 'Configured replacement chord reveals hint')
        check([...hint()!.querySelectorAll('kbd')].map(cap => cap.textContent).join('|') === 'Ctrl|Shift|Q', 'Overlay reflects effective remapped binding, not defaults')
        window.dispatchEvent(new Event('blur')); await wait(() => !hint(), 'Blur clears hints'); release()
        const blocked = async (label: string) => { key('keydown', 'Control', { ctrlKey: true }); key('keydown', 'Shift', { ctrlKey: true, shiftKey: true }); await sleep(520); check(!hint(), label); release() }
        await setShortcutRecording(true); await blocked('Recording suppresses hints'); await setShortcutRecording(false)
        document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await blocked('IME composition suppresses hints'); document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        hidden = true; document.dispatchEvent(new Event('visibilitychange')); await blocked('Hidden document suppresses hints'); hidden = false
        const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); modal.style.cssText = 'position:fixed;left:500px;top:100px;width:100px;height:80px'; document.body.append(modal)
        await blocked('Visible modal suppresses hints'); modal.remove()
        w.__fixturePaletteOpen = true; render(); await blocked('Palette suppresses hints'); w.__fixturePaletteOpen = false; render()
        const altGraph = new KeyboardEvent('keydown', { key: 'Alt', ctrlKey: true, altKey: true, bubbles: true }); Object.defineProperty(altGraph, 'getModifierState', { value: (name: string) => name === 'AltGraph' }); document.dispatchEvent(altGraph); await sleep(520)
        check(!hint(), 'AltGraph text input never becomes a shortcut hint gesture')
        return ['actual hint portal: exact held modifiers, remapped registry keycaps, target-local geometry, hidden/disabled filtering, no layout/click/focus interference', 'actual hint lifecycle with synthetic foreground/modifier events: release, blur, recording, IME, visibility, modal, palette and AltGraph suppression']
    } finally { release(); await setShortcutRecording(false); root.unmount() }
})()
