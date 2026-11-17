import { createRef, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import DOMPurify from 'dompurify'
import { createMarkdownComponents } from '../../src/renderer/src/components/ui/markdown/components'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import { captureAssistantTimelineMediaAnchor } from '../../src/renderer/src/pages/assistant/assistant-timeline-media-anchor'
import { VisualizationMessage } from '../../src/renderer/src/components/ui/visualization/VisualizationMessage'
import { getVisualizationDocumentCacheStats } from '../../src/renderer/src/components/ui/visualization/visualization-document'
import { visualizationFramePool } from '../../src/renderer/src/components/ui/visualization/visualization-frame-pool'
import { VisualizationThreadContext } from '../../src/renderer/src/components/ui/visualization/visualization-thread-context'
import { captureAssistantTimelineMediaAnchor, measureAssistantTimelineMediaAnchorDelta } from '../../src/renderer/src/pages/assistant/assistant-timeline-media-anchor'
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
declare const __VERIFY_FRAME_REUSE__: boolean
declare const __FRAME_LIFECYCLE_ONLY__: boolean
declare const __MEDIA_SCROLL_ONLY__: boolean

const root = createRoot(document.getElementById('root')!)
const activeFrames = () => [...document.querySelectorAll('iframe')].filter(frame => frame.dataset.visualizationActive !== 'false')
const listRef = createRef<LegendListRef>()
const scrollRef = createRef<HTMLDivElement>()
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))
const until = async (predicate: () => unknown, label: string) => {
    const deadline = performance.now() + 10_000
    while (performance.now() < deadline) { if (predicate()) return; await pause() }
    throw new Error(label + ': ' + JSON.stringify({ scrollTop: scrollRef.current?.scrollTop, rows: [...document.querySelectorAll('[data-assistant-timeline-row-id]')].map(row => row.getAttribute('data-assistant-timeline-row-id')), frames: activeFrames().map(frame => ({ title: frame.title, ready: frame.dataset.visualizationReady, rect: frame.getBoundingClientRect().toJSON() })), stats }))
}
const stats = { sanitizations: 0, sanitizeMs: 0, frameLoads: 0, frameReloads: 0, destructiveMoves: 0, atomicMoves: 0, rectReads: 0, rectReadMs: 0, caretReads: 0, caretReadMs: 0 }
const originalCaret = (document as any).caretRangeFromPoint?.bind(document)
if (originalCaret) (document as any).caretRangeFromPoint = (...args: number[]) => {
    const started = performance.now()
    try { return originalCaret(...args) } finally { stats.caretReads++; stats.caretReadMs += performance.now() - started }
}
const originalRect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function() {
    const started = performance.now()
    try { return originalRect.call(this) } finally { stats.rectReads++; stats.rectReadMs += performance.now() - started }
}
const loads = new WeakMap<HTMLIFrameElement, number>()
const sanitize = DOMPurify.sanitize.bind(DOMPurify)
DOMPurify.sanitize = ((...args: Parameters<typeof sanitize>) => {
    const start = performance.now()
    try { return sanitize(...args) } finally { stats.sanitizations++; stats.sanitizeMs += performance.now() - start }
}) as typeof DOMPurify.sanitize
const watchFrame = (iframe: HTMLIFrameElement) => {
    if (loads.has(iframe)) return
    loads.set(iframe, 0)
    iframe.addEventListener('load', () => {
        const before = loads.get(iframe) || 0
        loads.set(iframe, before + 1)
        stats.frameLoads++
        if (before > 0) stats.frameReloads++
    })
}
const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement) watchFrame(node)
        if (node instanceof Element) node.querySelectorAll('iframe').forEach(watchFrame)
    }
})
observer.observe(document.getElementById('root')!, { subtree: true, childList: true })
const tracksFrame = (node: Node) => node instanceof Element && node.isConnected && Boolean(node.querySelector('iframe'))
const insertBefore = Node.prototype.insertBefore
Node.prototype.insertBefore = function<T extends Node>(node: T, reference: Node | null): T {
    if (tracksFrame(node)) stats.destructiveMoves++
    return insertBefore.call(this, node, reference) as T
}
const appendChild = Node.prototype.appendChild
Node.prototype.appendChild = function<T extends Node>(node: T): T {
    if (tracksFrame(node)) stats.destructiveMoves++
    return appendChild.call(this, node) as T
}
const elementPrototype = Element.prototype as Element & { moveBefore?: (node: Node, reference: Node | null) => void }
const moveBefore = elementPrototype.moveBefore
if (moveBefore) elementPrototype.moveBefore = function(node, reference) {
    if (tracksFrame(node)) stats.atomicMoves++
    return moveBefore.call(this, node, reference)
}

const date = '2026-01-01T12:00:00.000Z'
const chart = (id: number) => `<visualization title="Chart ${id}" summary="Synthetic chart for scroll testing." height="180">\n<details><summary>Details</summary><p>Native disclosure state must survive unrelated updates.</p></details><svg viewBox="0 0 640 140" role="img" aria-label="Synthetic chart ${id}">${Array.from({ length: 80 }, (_, i) => `<rect x="${i * 8}" y="${(i * 13 + id * 7) % 80}" width="6" height="50" fill="var(--viz-accent)"/>`).join('')}</svg>\n</visualization>`
const rows: TimelineDisplayRow[] = Array.from({ length: 20 }, (_, i) => ({
    id: `row-${i}`, kind: 'message', createdAt: date,
    message: { id: `row-${i}`, role: 'assistant', text: `Message ${i}\n${chart(i * 2)}\n${chart(i * 2 + 1)}`, streaming: false, createdAt: date, updatedAt: date }
}))
const marker: TimelineDisplayRow = { id: 'new-prompt', kind: 'message', createdAt: date, message: { id: 'new-prompt', role: 'user', text: 'A new prompt', streaming: false, createdAt: date, updatedAt: date } }
const markdown = (text: string) => text.trim() ? <p>{text}</p> : null
const mediaComponents = createMarkdownComponents(undefined, { mediaMode: 'images-and-videos', plainCodeBlocks: true })
const RealImage = mediaComponents.img as ComponentType<any>
const RealLink = mediaComponents.a as ComponentType<any>
const releasedMedia = new Set<string>()
const mediaReleases = new Map<string, () => void>()
const mediaFailures = new Map<string, () => void>()
const svgImage = (width: number, height: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#568cff"/></svg>`)}`
let shortVideo = ''
let tallVideo = ''
function DeferredMedia({ id, kind = 'image' }: { id: string; kind?: 'image' | 'video' }) {
    const [released, setReleased] = useState(releasedMedia.has(id))
    const [failed, setFailed] = useState(false)
    mediaReleases.set(id, () => { releasedMedia.add(id); setReleased(true) })
    mediaFailures.set(id, () => setFailed(true))
    return kind === 'image'
        ? <RealImage src={released ? svgImage(560, id === 'previous' ? 680 : 540) : svgImage(16, 16)} alt={id} />
        : <RealLink href={failed ? new URL('./missing.webm', location.href).href : released ? tallVideo : shortVideo}>{id}</RealLink>
}
// Exceed the cold list's initial container pool, so the remount check cannot
// accidentally keep every mixed-media row mounted in a media-only run.
const mixedRows: TimelineDisplayRow[] = Array.from({ length: 24 }, (_, i) => ({
    id: `mixed-${i}`, kind: 'message', createdAt: date,
    message: { id: `mixed-${i}`, role: 'assistant', text: `Mixed media ${i}`, streaming: false, createdAt: date, updatedAt: date }
}))
const renderRow = (row: TimelineDisplayRow) => {
    if (row.kind !== 'message') return null
    if (!row.id.startsWith('mixed-')) return <VisualizationMessage content={row.message.text} streaming={false} renderMarkdown={markdown} />
    if (row.id === 'mixed-0') return <><p>Previous row deferred image.</p><DeferredMedia id="previous" /></>
    return <>
        <DeferredMedia id={`same-${row.id}`} />
        <DeferredMedia id={`video-${row.id}`} kind="video" />
        <div data-media-burst={row.id} />
        {Array.from({ length: 36 }, (_, i) => <p key={i} data-reading-probe={`${row.id}-${i}`}>Visible prose {i}. This text must remain in place while media above it finishes loading.</p>)}
        <VisualizationMessage content={chart(Number(row.id.slice(6)))} streaming={false} renderMarkdown={markdown} />
        {row.id === mixedRows.at(-1)?.id ? <><button data-space-control onClick={() => { (window as any).spaceControlClicks = ((window as any).spaceControlClicks || 0) + 1 }}>Inspect details</button><textarea data-space-editor rows={1} defaultValue="" /></> : null}
    </>
}
const render = (data: TimelineDisplayRow[], thread = 'visual-scroll') => flushSync(() => root.render(<VisualizationThreadContext.Provider value={thread}><AssistantVirtualTimeline
    rows={data} windowKey={thread} listRef={listRef} scrollContainerRef={scrollRef}
    contentInsetEndAdjustment={0} isWorking={data.some(row => row.id === 'new-prompt')} selectionHydrating={false}
    hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
    loadOlderError={null} loadNewerError={null} renderRow={renderRow}
/></VisualizationThreadContext.Provider>))
const delta = (before: typeof stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value - before[key as keyof typeof stats]]))
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]
const idleFrames = async () => {
    const samples: number[] = []
    let previous = await frame()
    for (let i = 0; i < 40; i++) { const next = await frame(); samples.push(next - previous); previous = next }
    return { medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95), maxMs: Math.max(...samples) }
}

// Main-process CDP compositor input, not dispatchEvent + scrollTop, proves wheel routing.
const inputRequests: { id: number; type: string; [key: string]: unknown }[] = []
const inputResolvers = new Map<number, (value: any) => void>()
let nextInputId = 0
;(window as any).visualizationScrollInputs = inputRequests
;(window as any).visualizationScrollInputDone = (id: number, value: unknown) => { inputResolvers.get(id)?.(value); inputResolvers.delete(id) }
const hostInput = (input: { type: string; [key: string]: unknown }) => new Promise<any>(resolve => {
    const id = ++nextInputId
    inputResolvers.set(id, resolve)
    inputRequests.push({ ...input, id })
})
const realWheel = async (deltaY: number, target: Element = scrollRef.current!) => {
    const rect = target.getBoundingClientRect()
    const element = scrollRef.current!
    const before = element.scrollTop
    await hostInput({ type: 'wheel', x: Math.round(rect.left + rect.width / 2), y: Math.round(Math.max(4, rect.top) + Math.min(rect.height / 2, 80)), deltaY })
    await pause(180)
    if (Math.abs(element.scrollTop - before) < 2) throw new Error(`Hidden Electron wheel must actually move chat: ${JSON.stringify({ before, after: element.scrollTop, deltaY, target: target.tagName, top: rect.top, bottom: rect.bottom })}`)
}
async function checkMixedMediaScroll() {
    const trace: unknown[] = []
    ;(window as any).visualizationAnchorTrace = trace
    for (const eventName of ['loadedmetadata', 'error', 'resize']) document.addEventListener(eventName, event => {
        if (event.target instanceof HTMLVideoElement) trace.push({ event: eventName, ready: event.target.readyState, width: event.target.videoWidth, height: event.target.videoHeight, error: event.target.error?.code })
    }, true)
    shortVideo = new URL('./short.webm', location.href).href
    tallVideo = new URL('./tall.webm', location.href).href
    render(mixedRows)
    await pause(350)
    const scroller = scrollRef.current!
    if (getComputedStyle(scroller).overflowAnchor !== 'none') throw new Error('Fixture must apply the production overflow-anchor:none rule before checking explicit media compensation')
    let trustedWheels = 0
    scroller.addEventListener('wheel', event => { if (event.isTrusted) trustedWheels++ })
    await until(() => activeFrames().some(frame => frame.dataset.visualizationReady === 'true'), 'Mixed visualization must be ready')
    const bottomFrame = activeFrames().at(-1)!
    await realWheel(-80, bottomFrame)
    const probe = (row = 1, paragraph = 0) => document.querySelector<HTMLElement>(`[data-reading-probe="mixed-${row}-${paragraph}"]`)!
    const read = async (row: number, paragraph = 0) => {
        // Programmatic positioning is setup only. The following real wheel owns reading mode.
        await listRef.current!.scrollToIndex({ index: row, animated: false })
        await until(() => probe(row, paragraph), 'Reading probe must mount')
        await pause(180)
        scroller.scrollTop += probe(row, paragraph).getBoundingClientRect().top - scroller.getBoundingClientRect().top - 50
        await pause(120)
        await realWheel(-24)
        await pause(120)
    }
    const stability: { label: string; driftPx: number; trace: unknown[] }[] = []
    const stable = async (label: string, action: () => void | Promise<void>, row = 1, paragraph = 0) => {
        const node = probe(row, paragraph)
        const before = node.getBoundingClientRect().top
        const anchor = captureAssistantTimelineMediaAnchor(scroller, 'visual-scroll')
        const scrollBefore = scroller.scrollTop
        const rowBefore = node.closest('[data-assistant-timeline-row-id]')!.getBoundingClientRect().top
        trace.length = 0
        trace.push({ event: 'before', label, scroll: scrollBefore, row: rowBefore, probe: before })
        await action()
        await pause(420)
        const driftPx = Math.abs(node.getBoundingClientRect().top - before)
        stability.push({ label, driftPx, trace: [...trace] })
        if (!node.isConnected || driftPx > 2) throw new Error(`${label}: visible prose moved ${driftPx}px: ` + JSON.stringify({ before, after: node.getBoundingClientRect().top, scrollBefore, scrollAfter: scroller.scrollTop, rowBefore, rowAfter: node.closest('[data-assistant-timeline-row-id]')!.getBoundingClientRect().top, anchor: anchor ? { row: anchor.rowId, text: anchor.textValue.slice(0, 100), offset: anchor.textOffset, insideBefore: anchor.offsetWithinRow, delta: measureAssistantTimelineMediaAnchorDelta(anchor, scroller, 'visual-scroll') } : null, trace: trace.slice(-120) }))
    }
    await read(1)
    const videoFor = (row: number) => document.querySelector<HTMLVideoElement>(`[data-assistant-timeline-row-id="mixed-${row}"] video`)
    await until(() => videoFor(1)?.videoHeight === 180 && videoFor(1)!.readyState >= 1, 'Initial real WebM metadata must decode')
    await read(1)
    if (!mediaReleases.has('previous')) throw new Error('Previous row must still be mounted for growth test')
    await stable('previous-row image load (MVCP only)', () => mediaReleases.get('previous')!())
    await stable('same-row image load', () => mediaReleases.get('same-mixed-1')!())
    await stable('same-row video metadata', async () => {
        mediaReleases.get('video-mixed-1')!()
        await until(() => videoFor(1)?.videoHeight === 480 && videoFor(1)!.readyState >= 1, 'Changed real WebM metadata must decode')
    })
    await stable('same-row video error fallback', async () => {
        mediaFailures.get('video-mixed-1')!()
        await until(() => document.querySelector('[data-assistant-timeline-row-id="mixed-1"] [data-video-player][data-media-state="error"] [role="alert"]'), 'Broken media must reach the real unavailable state')
    })
    await stable('media contracts before compensation scroll delivery', async () => {
        const burst = document.querySelector<HTMLElement>('[data-media-burst="mixed-1"]')!
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
        const before = scroller.scrollTop
        let contracted = false
        Object.defineProperty(scroller, 'scrollTop', { configurable: true, get() { return descriptor.get!.call(this) }, set(value: number) {
            descriptor.set!.call(this, value)
            if (!contracted && value > before + 100) {
                contracted = true
                burst.style.height = '0px'
                scroller.dispatchEvent(new Event('scroll'))
            }
        } })
        try {
            burst.style.height = '148px'
            await until(() => contracted, 'Transient growth must receive a real media compensation')
            await pause(100)
        } finally { delete (scroller as any).scrollTop; burst.style.height = '' }
    })
    await stable('viewport resize', () => hostInput({ type: 'resize', width: 880, height: 800 }))
    const oldProbe = probe()
    await read(mixedRows.length - 2, 20)
    await until(() => !oldProbe.isConnected, 'Reading row must virtualize away')
    await read(1)
    if (probe() === oldProbe) throw new Error('Return must exercise a remounted row')
    await stable('remounted reader remains stable', async () => { await pause(300) })
    await listRef.current!.scrollToEnd({ animated: false }); await pause(200)
    await realWheel(-32)
    const distance = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    // A layout compensation near the end must not undo the last upward intent.
    const lastRow = mixedRows.length - 1
    const paragraphs = [...document.querySelectorAll<HTMLElement>(`[data-reading-probe^="mixed-${lastRow}-"]`)]
    const visible = paragraphs.find(node => { const rect = node.getBoundingClientRect(); return rect.top > 0 && rect.bottom < scroller.clientHeight })!
    if (!visible) throw new Error('Near-end prose must be visible')
    const paragraph = Number(visible.dataset.readingProbe!.split('-').at(-1))
    await stable('near-end upward intent survives compensation', () => mediaReleases.get(`same-mixed-${lastRow}`)!(), lastRow, paragraph)
    render([...mixedRows, marker]); await pause(250)
    if (distance() < 20) throw new Error('A layout correction falsely reacquired end follow after upward intent')
    scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
    await until(() => distance() <= 2, 'Explicit Latest must restore end follow')
    const trackPointers: unknown[] = []
    scroller.addEventListener('pointerdown', event => { if (event.isTrusted) trackPointers.push({ x: event.clientX, y: event.clientY, target: (event.target as Element).tagName }) })
    for (const holdMs of [30, 600]) {
        render(mixedRows); await pause(250)
        scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
        await until(() => distance() <= 2, 'Scrollbar setup follows the latest content')
        await realWheel(-Math.round(scroller.clientHeight * 0.55))
        const bounds = scroller.getBoundingClientRect()
        await hostInput({ type: 'scrollbar', x: bounds.right - 1, y: bounds.top + scroller.clientHeight - 2, holdMs })
        await until(() => distance() <= 2, `Stationary scrollbar track press reaches bottom: ${JSON.stringify(trackPointers)}`)
        render([...mixedRows, marker]); await pause(300)
        if (distance() > 2) throw new Error(`Stationary scrollbar track ${holdMs}ms did not resume follow: distance=${distance()}, pointers=${JSON.stringify(trackPointers)}`)
    }
    render(mixedRows); await pause(200)
    scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
    await until(() => distance() <= 2, 'Space setup reaches latest')
    await realWheel(-Math.round(scroller.clientHeight * 0.45))
    scroller.tabIndex = 0
    scroller.focus({ preventScroll: true })
    if (document.activeElement !== scroller) throw new Error('Timeline owns native Space keyboard focus')
    await hostInput({ type: 'key', shift: false }); await pause(250)
    await until(() => distance() <= 2, 'Native Space pages to the bottom')
    render([...mixedRows, marker]); await pause(300)
    if (distance() > 2) throw new Error(`Native Space paging did not resume follow: distance=${distance()}`)
    await hostInput({ type: 'key', shift: true }); await pause(250)
    if (distance() < 20) throw new Error('Native Shift+Space must page upward')
    render(mixedRows); await pause(250)
    if (distance() < 20) throw new Error('Shift+Space must retain reading mode across a data update')
    render(mixedRows); await pause(150)
    scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
    await until(() => distance() <= 2, 'Thumb reversal setup reaches latest')
    const thumbBounds = scroller.getBoundingClientRect()
    const thumbSize = Math.max(parseFloat(getComputedStyle(scroller).getPropertyValue('--assistant-scrollbar-thumb-min-height')), scroller.clientHeight ** 2 / scroller.scrollHeight)
    await hostInput({ type: 'thumb-reverse', x: thumbBounds.right - 1, y: thumbBounds.top + scroller.clientHeight - thumbSize / 2,
        upY: thumbBounds.top + scroller.clientHeight - thumbSize / 2 - 100, downY: thumbBounds.top + scroller.clientHeight - 2 })
    await until(() => distance() <= 2, 'Reversed native thumb drag reaches bottom')
    const nativeThumb = (window as any).visualizationThumbTrace
    if (!(nativeThumb.before > nativeThumb.afterUp + 2 && nativeThumb.afterDown > nativeThumb.afterUp + 2)) throw new Error('Native thumb must really scroll in both directions')
    render([...mixedRows, marker]); await pause(300)
    if (distance() > 2) throw new Error(`Reversing a native thumb drag did not resume follow: distance=${distance()}, native=${JSON.stringify(nativeThumb)}`)
    for (const selector of ['[data-space-control]', '[data-space-editor]']) {
        render(mixedRows); await pause(150)
        scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
        await until(() => distance() <= 2, 'Control setup reaches latest')
        await realWheel(-40)
        const control = document.querySelector<HTMLElement>(selector)!
        if (control instanceof HTMLTextAreaElement) control.value = ''
        control.focus({ preventScroll: true })
        const clicks = (window as any).spaceControlClicks || 0
        await hostInput({ type: 'key', shift: false }); await pause(150)
        if (control instanceof HTMLTextAreaElement) {
            if (control.value !== ' ') throw new Error('Native Space inserts text in the focused editor')
        } else if ((window as any).spaceControlClicks !== clicks + 1) throw new Error('Native Space activates the focused button')
        // Positive layout compensation after a consuming key cannot count as
        // page-down intent or reacquire end-following.
        scroller.scrollTop = scroller.scrollHeight; await pause(150)
        render([...mixedRows, marker]); await pause(300)
        if (distance() < 20) throw new Error(`Space consumed by ${selector} falsely resumed following`)
    }
    if (trackPointers.length < 2) throw new Error('Both native scrollbar gestures must deliver trusted pointer input')
    if (!trustedWheels) throw new Error('No trusted Electron wheel reached chat')
    return { stability, trustedWheels, trustedScrollbarPresses: trackPointers.length, scrollbarTrack: true, thumbReversal: true, keyboardPaging: true, keyboardControls: true, iframeWheel: true, explicitLatest: true, remount: true, decodedVideoHeights: [180, 480], syntheticMedia: 'real SVG and fixed valid VP8/WebM metadata plus error fallback through production Markdown components' }
}

function checkBoundedAnchorFallback() {
    const caretDescriptor = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
    const scroller = document.createElement('div')
    scroller.style.cssText = 'position:fixed;top:20px;left:20px;width:300px;height:80px;overflow:hidden'
    const row = document.createElement('div')
    row.dataset.assistantTimelineRowId = 'bounded-fallback'
    for (let i = 0; i < 256; i++) {
        const paragraph = document.createElement('p')
        paragraph.style.cssText = 'position:absolute;top:-2000px'
        paragraph.textContent = 'Offscreen prose'
        row.append(paragraph)
    }
    const visible = document.createElement('p')
    visible.textContent = 'Visible fallback reading anchor'
    row.append(visible)
    scroller.append(row)
    document.body.append(scroller)
    // The fallback must stop at 256 semantic matches, without allocating a full
    // querySelectorAll result for a long mounted reply.
    scroller.querySelectorAll = () => { throw new Error('Unbounded semantic query') }
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: undefined })
    try {
        if (captureAssistantTimelineMediaAnchor(scroller, 'fallback')) throw new Error('Fallback exceeded its 256-block bound')
        row.firstElementChild!.remove()
        const anchor = captureAssistantTimelineMediaAnchor(scroller, 'fallback')
        if (anchor?.text !== visible.firstChild || anchor.rowId !== 'bounded-fallback') throw new Error('Bounded fallback lost its visible character anchor')
    } finally {
        scroller.remove()
        if (caretDescriptor) Object.defineProperty(document, 'caretRangeFromPoint', caretDescriptor)
        else delete (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint
    }
}

async function checkFrameReuse() {
    const stateRow: TimelineDisplayRow = { id: 'state-row', kind: 'message', createdAt: date, message: { id: 'state-row', role: 'assistant', text: chart(999), streaming: false, createdAt: date, updatedAt: date } }
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Synthetic composer')
    document.body.append(input)
    const mount = async (thread: string, changed = false) => {
        render([changed && stateRow.kind === 'message' ? { ...stateRow, message: { ...stateRow.message, text: stateRow.message.text.replace('Synthetic chart 999', 'Changed chart 999') } } : stateRow], thread)
        await until(() => activeFrames().some(frame => frame.title === 'Chart 999' && frame.dataset.visualizationReady === 'true'), 'State preview must mount')
        return activeFrames().find(frame => frame.title === 'Chart 999')!
    }
    const evaluate = (frame: HTMLIFrameElement, expression: string) => {
        frame.dataset.frameProbe = 'current'
        return hostInput({ type: 'frame-eval', selector: 'iframe[data-frame-probe="current"]', expression }).finally(() => { delete frame.dataset.frameProbe })
    }
    const first = await mount('reuse-a')
    await evaluate(first, `document.body.dataset.lifecycleToken='chat-a';document.querySelector('summary').click();document.querySelector('[role="tooltip"]').hidden=false;document.querySelector('svg').animate([{opacity:1},{opacity:.8}],{duration:10000,iterations:Infinity}).id='lifecycle-motion';true`)
    await pause(400)
    input.focus({ preventScroll: true })
    const beforeLoads = stats.frameLoads
    render([], 'reuse-a')
    await until(() => first.dataset.visualizationActive === 'false', 'Unloaded row must park its frame')
    if (!first.isConnected || document.activeElement !== input) throw new Error('Parking detached a reusable frame or stole composer focus')
    const paused = await evaluate(first, `document.getAnimations().find(animation=>animation.id==='lifecycle-motion')?.playState`)
    if (paused !== 'paused') throw new Error('Parked media animation kept running')
    const second = await mount('reuse-a')
    if (first !== second || stats.frameLoads !== beforeLoads) throw new Error('Returning to a row recreated its loaded frame')
    const retained = await evaluate(second, `({token:document.body.dataset.lifecycleToken,open:document.querySelector('details').open,tooltipHidden:document.querySelector('[role="tooltip"]').hidden,motion:document.getAnimations().find(animation=>animation.id==='lifecycle-motion')?.playState})`)
    if (retained.token !== 'chat-a' || !retained.open || !retained.tooltipHidden || retained.motion !== 'running') throw new Error('Native disclosure/context state or parked presentation cleanup was lost: '+JSON.stringify(retained))
    const other = await mount('reuse-b')
    if (other === first) throw new Error('A different chat reused another chat’s frame')
    const isolated = await evaluate(other, `({token:document.body.dataset.lifecycleToken||null,open:document.querySelector('details').open})`)
    if (isolated.token !== null || isolated.open) throw new Error('Embedded state leaked between chats')
    const returned = await mount('reuse-a')
    if (returned !== first || document.activeElement !== input) throw new Error('Chat return lost its own frame or stole composer focus')
    const changed = await mount('reuse-a', true)
    const content = await evaluate(changed, `({label:document.querySelector('svg').getAttribute('aria-label'),token:document.body.dataset.lifecycleToken||null})`)
    if (changed === first || content.label !== 'Changed chart 999' || content.token !== null) throw new Error('A source edit reused an obsolete document')
    input.remove()
    console.log('[visual-scroll] frame state, chat isolation and focus passed')
    return { passed: true, sameContext: true, nativeDisclosure: true, chatIsolation: true, sourceInvalidation: true, tooltipReset: true, animationPauseResume: true, composerFocus: true }
}

;(window as any).visualizationScrollCheck = (async () => {
    checkBoundedAnchorFallback()
    if (__FRAME_LIFECYCLE_ONLY__) return { frameReuse: await checkFrameReuse(), frameCache: visualizationFramePool(document).stats() }
    if (__MEDIA_SCROLL_ONLY__) return { mixedMedia: await checkMixedMediaScroll(), frameCache: visualizationFramePool(document).stats() }
    const emptyIdle = await idleFrames()
    const started = performance.now()
    render(rows)
    await until(() => scrollRef.current && document.querySelector('iframe'), 'Real virtualized previews must mount')
    await until(() => {
        const bottom = document.querySelector('[data-assistant-timeline-row-id="row-19"]')
        const frames = [...bottom?.querySelectorAll('iframe') || []]
        return frames.length === 2 && frames.every(node => node.dataset.visualizationReady === 'true')
    }, 'The initial bottom previews must finish loading before measurements')
    await pause(200)
    const initial = { ...stats, mountMs: performance.now() - started }
    const mountedIdle = await idleFrames()
    console.log('[visual-scroll] mounted')
    const beforeUpdate = { ...stats }
    const retained = activeFrames()
    const bottomFrames = retained.filter(node => node.title === 'Chart 38' || node.title === 'Chart 39')
    const updateTrace: unknown[] = []
    const traceUpdate = (step: string) => {
        const row = document.querySelector('[data-assistant-timeline-row-id="row-19"]')
        const bounds = row?.getBoundingClientRect()
        updateTrace.push({ step, scrollTop: scrollRef.current?.scrollTop, viewport: scrollRef.current?.clientHeight, bottomRowTop: bounds?.top, bottomRowBottom: bounds?.bottom, originalFramesConnected: bottomFrames.map(node => node.isConnected), currentFrames: [...row?.querySelectorAll('iframe') || []].map(node => node.title) })
    }
    traceUpdate('before')
    for (let i = 0; i < 6; i++) {
        render([...rows, { ...marker, message: { ...marker.message, text: `A new prompt ${i}` } } as TimelineDisplayRow])
        await pause(80)
        traceUpdate(`append-${i}`)
        render(rows)
        await pause(80)
        traceUpdate(`remove-${i}`)
    }
    const updates = { ...delta(beforeUpdate), retainedFrames: retained.filter(node => node.isConnected).length, bottomFramesRetained: retained.filter(node => node.title === 'Chart 38' || node.title === 'Chart 39').every(node => node.isConnected) }
    console.log('[visual-scroll] prompt updates complete')
    const samples = []
    for (let sample = 0; sample < 3; sample++) {
        const before = { ...stats }
        const intervals: number[] = []
        let previous = await frame()
        for (let step = 0; step < 64; step++) {
            const element = scrollRef.current!
            element.dispatchEvent(new WheelEvent('wheel', { deltaY: step < 32 ? -250 : 250, bubbles: true }))
            const phase = step < 32 ? step / 31 : (63 - step) / 31
            element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight) * (1 - phase)
            const now = await frame()
            intervals.push(now - previous)
            previous = now
        }
        await pause(220)
        console.log(`[visual-scroll] sample ${sample + 1} complete`)
        samples.push({ ...delta(before), medianFrameMs: percentile(intervals, .5), p95FrameMs: percentile(intervals, .95), maxFrameMs: Math.max(...intervals), framesOver32ms: intervals.filter(value => value > 32).length })
    }
    // The measured scroll can finish with the last row outside the lazy-load
    // viewport. Exercise that case explicitly, then mount the target before
    // testing same-row invalidation rather than timing its offscreen loading.
    const lastChart = () => activeFrames().find(frame => frame.title === 'Chart 39')
    scrollRef.current!.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, bubbles: true }))
    await listRef.current!.scrollToIndex({ index: 0, animated: false })
    await until(() => !lastChart(), 'Source-change setup must virtualize the target away')
    scrollRef.current!.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
    await until(() => lastChart()?.dataset.visualizationReady === 'true', 'Source-change target must mount and load')
    const beforeChange = lastChart()
    // Same-row content updates must still change the rendered document.
    const changed = rows.map((row, i) => i === 19 && row.kind === 'message' ? { ...row, message: { ...row.message, text: row.message.text.replace('Synthetic chart 39', 'Changed chart 39') } } : row)
    render(changed)
    await until(() => { const current = lastChart(); return current && current !== beforeChange && current.dataset.visualizationReady === 'true' }, 'Changed source must not reuse stale content')
    if ([...document.querySelectorAll('iframe')].some(node => node.getAttribute('sandbox') !== 'allow-scripts')) throw new Error('Sandbox permissions changed')
    const mixedMedia = await checkMixedMediaScroll()
    const frameReuse = __VERIFY_FRAME_REUSE__ && moveBefore ? await checkFrameReuse() : null
    return { idle: { empty: emptyIdle, mounted: mountedIdle }, mixedMedia, frameReuse, frameCache: visualizationFramePool(document).stats(), workload: { rows: 20, chartsPerRow: 2, barsPerChart: 80, samples: 3, framesPerSample: 64, warmup: 'initial mount and six prompt update pairs' }, supportsAtomicMove: Boolean(moveBefore), initial, updates, updateTrace, samples, totals: stats, cache: getVisualizationDocumentCacheStats(), correctness: ['source changes invalidate', 'trusted helper sandbox stays opaque'] }
})()
