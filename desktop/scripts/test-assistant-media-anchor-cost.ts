import assert from 'node:assert/strict'
import { captureAssistantTimelineMediaAnchor } from '../src/renderer/src/pages/assistant/assistant-timeline-media-anchor'

let caretQueries = 0
Object.assign(globalThis, { NodeFilter: { SHOW_ELEMENT: 1 } })
const document = { createTreeWalker: () => ({ nextNode: () => null }), caretRangeFromPoint: () => { caretQueries++; return null } }
const scroller = { isConnected: true, clientHeight: 800, ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800, bottom: 800 }), querySelectorAll: () => [] }
assert.equal(captureAssistantTimelineMediaAnchor(scroller as unknown as HTMLElement, 'chat'), null)
assert.equal(caretQueries, 0, 'a viewport occupied by native media cannot yield a text anchor and must not run caret layout queries')
scroller.isConnected = false
assert.equal(captureAssistantTimelineMediaAnchor(scroller as unknown as HTMLElement, 'chat'), null)
assert.equal(caretQueries, 0, 'detached timelines cannot yield a text anchor')
console.log('Media anchor cost: media-only viewports and detached timelines avoid caret layout queries')
