import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantReadPreviewScope } from '../../src/renderer/src/pages/assistant/AssistantReadPreviewScope'
import { TimelineToolCallList } from '../../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import type { AssistantActivity } from '../../src/shared/assistant/contracts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
async function wait(test: () => unknown, message: string) { for (let n = 0; n < 150; n++) { if (test()) return; await sleep(20) } throw new Error(message) }
const source = (color: string, label: string) => btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="288"><rect width="512" height="288" fill="${color}"/><text x="30" y="150" font-size="40" fill="white">${label}</text></svg>`)
const firstSource = source('#8b263c', 'First captured image')
const secondSource = source('#245ba0', 'Second captured image')
const imageResult = (data: string) => ({ content: [{ type: 'image', mimeType: 'image/svg+xml', data }] })
const now = '2026-10-01T12:00:00.000Z'
const read = (id: string, path: string, payload: Record<string, unknown>): AssistantActivity => ({ id, kind: 'file-read', tone: 'tool', summary: 'Read file', turnId: 'turn', createdAt: now, payload: { toolName: 'read', paths: [path], status: 'completed', ...payload } })
const ref = (id: string) => ({ version: 1, canonicalChatId: 'fixture', entryIndex: id === 'history-first' ? 1 : 2, entryId: id, entrySha256: 'a'.repeat(64), imageCount: 1, contentTypes: ['image'] })
const rows = [
    read('text-read', 'C:/synthetic/source.ts', { output: '\nconst original = true\n\n[Showing lines 20-22 of 80]', readStartLine: 20, readEndLine: 22, readTotalLines: 80 }),
    read('first-image', 'C:/synthetic/same-file.svg', { readIsImage: true, output: 'Read image file [image/svg+xml]', result: imageResult(firstSource) }),
    read('second-image', 'C:/synthetic/same-file.svg', { readIsImage: true, output: 'Read image file [image/svg+xml]', result: imageResult(secondSource) }),
    read('history-first', 'C:/synthetic/history-first', { historyBodyRef: ref('history-first') }),
    read('history-second', 'C:/synthetic/history-second', { historyBodyRef: ref('history-second') }),
    read('history-error', 'C:/synthetic/history-error', { historyBodyRef: ref('history-error') }),
    read('broken-image', 'C:/synthetic/broken.png', { readIsImage: true, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] } }),
    read('binary', 'C:/synthetic/archive.zip', { output: '\u0000binary' })
]
const requests: Record<string, { resolve: (body: any) => void; reject: (error: Error) => void }> = {}
const reads: Record<string, number> = {}
;(window as any).devscope = { window: {
    getRuntimeInfo: async () => ({ platform: 'win32', architecture: 'x64', appVersion: 'fixture', electronVersion: 'fixture', isPackaged: false, nativeFrame: false, customWindowControls: true }),
    isMaximized: async () => false, onMaximizedChange: () => () => undefined
}, assistant: {
    hydrateHistoryBody: async ({ activityId }: { activityId: string }) => {
        reads[activityId] = (reads[activityId] || 0) + 1
        return new Promise((resolve, reject) => { requests[activityId] = { resolve, reject } })
    },
    getRecentAppActions: async () => ({ success: true, actions: [] })
} }
const root = createRoot(document.getElementById('root')!)
let owner = 'thread-A'
function render() { flushSync(() => root.render(<main className="h-full overflow-auto p-4"><AssistantReadPreviewScope owner={owner}><TimelineToolCallList activities={rows} /></AssistantReadPreviewScope></main>)) }
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-assistant-typed-action="${id}"] [data-assistant-action-row]`)!
const dialogs = () => document.querySelectorAll('[aria-label="Close preview"]')
const mainImage = () => document.querySelector<HTMLImageElement>('[data-assistant-read-media="image"] img:not([aria-hidden])')
async function click(element: HTMLElement) {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await sleep(30)
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    check(element.contains(document.elementFromPoint(x, y)), `Control is actually reachable: ${JSON.stringify({ action: element.closest('[data-assistant-typed-action]')?.getAttribute('data-assistant-typed-action'), rect: rect.toJSON(), hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250), dialogs: dialogs().length })}`)
    const request = { x, y, click: true, done: false }; (window as any).sidebarPointerRequest = request
    await wait(() => request.done, 'Pointer event delivered')
}
async function close() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(() => !dialogs().length, 'Escape closes the read preview') }
async function run() {
    render(); await sleep(100)
    const batch = document.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
    await click(batch); await sleep(300)
    check(document.querySelectorAll('[data-assistant-typed-action]').length === rows.length, 'Consecutive repeated reads retain distinct rows and IDs')
    check(row('first-image').querySelector('.lucide-image') && row('text-read').querySelector('.lucide-file-text'), 'Image and source rows have the correct icons')
    await click(row('text-read'))
    await wait(() => document.querySelector('[data-assistant-read-snapshot="exact"]'), 'Text opens the captured snapshot')
    check((window as any).fixtureSyntaxPreviewProps.content === '\nconst original = true\n', 'Text uses exact captured bytes, not a fresh file read')
    check((window as any).fixtureSyntaxPreviewProps.lineNumberStart === 20, 'Captured line numbers are retained')
    await close()
    for (const [id, expected] of [['first-image', firstSource], ['second-image', secondSource]]) {
        await click(row(id))
        await wait(() => mainImage()?.complete && mainImage()!.naturalWidth === 512, 'Actual captured image decodes')
        check(mainImage()!.src.endsWith(expected), 'Each consecutive call opens its own captured image, even for the same source path')
        check(!document.querySelector('[data-assistant-read-snapshot]'), 'Image never enters the source editor')
        const surface = document.querySelector('[data-preview-expanded]')!
        // Hidden offscreen Chromium can leave CSS animation clocks at zero.
        // This check owns settled geometry, not entrance-motion acceptance.
        for (const animation of surface.getAnimations()) animation.finish()
        const bounds = surface.getBoundingClientRect()
        check(bounds.left >= -.5 && bounds.right <= innerWidth + .5 && bounds.top >= -.5 && bounds.bottom <= innerHeight + .5, `Media preview fits the viewport: ${JSON.stringify({ bounds: bounds.toJSON(), width: innerWidth, height: innerHeight, rootTransform: getComputedStyle(document.querySelector('[data-preview-expanded]')!).transform, bodyTransform: getComputedStyle(document.body).transform, animations: document.querySelector('[data-preview-expanded]')!.getAnimations().map(a => ({ time: a.currentTime, state: a.playState, rate: a.playbackRate })) })}`)
        await close()
    }
    await click(row('first-image')); await wait(() => mainImage()?.naturalWidth === 512, 'Image opens before navigation')
    owner = 'thread-B'; render(); await wait(() => !dialogs().length, 'Changing chat closes its preview')
    owner = 'thread-A'; render(); await sleep(50)
    check(!dialogs().length, 'Returning to the chat never reopens an old preview intent')
    await click(row('history-first')); await click(row('history-first'))
    check(reads['history-first'] === 1, 'Repeated clicks share one history hydration')
    check(!dialogs().length, 'Deferred bodies do not open empty source snapshots')
    await click(row('history-second'))
    requests['history-second'].resolve({ success: true, body: { payload: { imageAttachments: [{ path: (window as any).fixtureMediaCaptureURL }] } } })
    await wait(() => mainImage()?.naturalWidth === 512, 'Canonical cached image opens after hydration')
    requests['history-first'].resolve({ success: true, body: { payload: { result: imageResult(firstSource) } } })
    await sleep(150)
    check(dialogs().length === 1 && mainImage()!.src.includes('canonical-capture.svg'), 'Late earlier hydration cannot cover the later selected call')
    await close()
    await click(row('history-error'))
    requests['history-error'].reject(new Error('Cannot load fixture snapshot'))
    await wait(() => document.querySelector('[data-assistant-read-load-error="history-error"]')?.textContent?.includes('Cannot load fixture snapshot'), 'Hydration failures remain visible without a fake snapshot')
    check(!dialogs().length, 'Failed history never opens a misleading empty editor')
    await click(row('history-error'))
    check(reads['history-error'] === 2, 'History failures can be retried')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    requests['history-error'].resolve({ success: true, body: { payload: { result: imageResult(secondSource) } } })
    await sleep(100)
    check(!dialogs().length, 'Escape cancels a pending preview intent even when its read completes later')
    await click(row('broken-image'))
    await wait(() => document.querySelector('[data-assistant-read-unavailable]')?.textContent?.includes('Image unavailable'), 'Decode failure has an explicit image error')
    check(Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Retry'), 'Missing images have Retry, not a blank editor')
    await close()
    await click(row('binary'))
    await wait(() => document.querySelector('[data-assistant-read-unavailable]')?.textContent?.includes('No preview available'), 'Binary files have an honest fallback')
    await close()
    // Final screenshot shows the second real captured image.
    await click(row('second-image')); await wait(() => mainImage()?.naturalWidth === 512, 'Final image is decoded')
    for (const animation of document.querySelector('[data-preview-expanded]')!.getAnimations()) animation.finish()
    await sleep(100)
    return ['actual image previews, typed icons, exact text snapshots, grouped same-path calls, canonical hydration, single-flight/stale selection, image errors and binary fallback']
}
;(window as any).sidebarContinuityCheck = run()
