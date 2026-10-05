import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the actual scheduled alignment callback at its ownership boundary.
// A late row measurement moves the end far beyond the last prompt, even while
// the opening/live-follow intent still owns the viewport.
const source = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const body = source.match(/const requestEndAlignment = useCallback\(\(\) => \{([\s\S]*?)\n    \}, \[/)![1]
let frame: (() => void) | null = null
let aligned = 0
const pending = { current: null }
const mode = { current: 'following-end' }
const key = { current: 'working-chat' }
const props = { listRef: { current: { scrollToEnd: () => { aligned++ } } }, scrollContainerRef: { current: { scrollHeight: 10000, scrollTop: 1000, clientHeight: 800 } } }
const request = new Function('window', 'props', 'endAlignmentFrameRef', 'scrollModeRef', 'activeWindowKeyRef', `${body};`)
const invoke = () => request({ requestAnimationFrame: (callback: () => void) => { frame = callback; return 1 } }, props, pending, mode, key)
invoke(); frame!()
assert.equal(aligned, 1, 'Owned end alignment must reach the latest work even when late content leaves the last prompt far from the end')
invoke(); mode.current = 'free-scrolling'; frame!()
assert.equal(aligned, 1, 'Manual history reading cancels pending automatic alignment')
mode.current = 'following-end'; invoke(); key.current = 'another-chat'; frame!()
assert.equal(aligned, 1, 'An old chat cannot align the newly selected chat')
console.log('Live end alignment: late geometry, manual navigation and exact window ownership passed')
