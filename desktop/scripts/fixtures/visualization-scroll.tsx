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
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const root = createRoot(document.getElementById('root')!)
const listRef = createRef<LegendListRef>()
const scrollRef = createRef<HTMLDivElement>()
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))
const until = async (predicate: () => unknown, label: string) => {
    for (let i = 0; i < 120; i++) { if (predicate()) return; await pause() }
    throw new Error(label)
}
const stats = { sanitizations: 0, sanitizeMs: 0, frameLoads: 0, frameReloads: 0, destructiveMoves: 0, atomicMoves: 0 }
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
const svgImage = (width: number, height: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#568cff"/></svg>`)}`
let shortVideo = ''
let tallVideo = ''
function DeferredMedia({ id, kind = 'image' }: { id: string; kind?: 'image' | 'video' }) {
    const [released, setReleased] = useState(releasedMedia.has(id))
    mediaReleases.set(id, () => { releasedMedia.add(id); setReleased(true) })
    return kind === 'image'
        ? <RealImage src={released ? svgImage(560, id === 'previous' ? 680 : 540) : svgImage(16, 16)} alt={id} />
        : <RealLink href={`${released ? tallVideo : shortVideo}#clip.webm`}>{id}</RealLink>
}
const mixedRows: TimelineDisplayRow[] = Array.from({ length: 12 }, (_, i) => ({
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
        {Array.from({ length: 36 }, (_, i) => <p key={i} data-reading-probe={`${row.id}-${i}`}>Visible prose {i}. This text must remain in place while media above it finishes loading.</p>)}
        <VisualizationMessage content={chart(Number(row.id.slice(6)))} streaming={false} renderMarkdown={markdown} />
    </>
}
const render = (data: TimelineDisplayRow[]) => flushSync(() => root.render(<AssistantVirtualTimeline
    rows={data} windowKey="visual-scroll" listRef={listRef} scrollContainerRef={scrollRef}
    contentInsetEndAdjustment={0} isWorking={data.some(row => row.id === 'new-prompt')} selectionHydrating={false}
    hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
    loadOlderError={null} loadNewerError={null} renderRow={renderRow}
/>))
const delta = (before: typeof stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value - before[key as keyof typeof stats]]))
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]

// Main-process CDP compositor input, not dispatchEvent + scrollTop, proves wheel routing.
const inputRequests: { id: number; type: string; [key: string]: unknown }[] = []
const inputResolvers = new Map<number, () => void>()
let nextInputId = 0
;(window as any).visualizationScrollInputs = inputRequests
;(window as any).visualizationScrollInputDone = (id: number) => { inputResolvers.get(id)?.(); inputResolvers.delete(id) }
const hostInput = (input: { type: string; [key: string]: unknown }) => new Promise<void>(resolve => {
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
async function makeVideo(width: number, height: number) {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')!
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve() })
    recorder.start()
    for (let i = 0; i < 3; i++) { context.fillStyle = i % 2 ? '#568cff' : '#224488'; context.fillRect(0, 0, width, height); await pause(110) }
    recorder.stop(); await stopped
    stream.getTracks().forEach(track => track.stop())
    return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
}
async function checkMixedMediaScroll() {
    shortVideo = await makeVideo(320, 180)
    tallVideo = await makeVideo(180, 480)
    render(mixedRows)
    await pause(350)
    const scroller = scrollRef.current!
    let trustedWheels = 0
    scroller.addEventListener('wheel', event => { if (event.isTrusted) trustedWheels++ })
    await until(() => document.querySelector('iframe[data-visualization-ready="true"]'), 'Mixed visualization must be ready')
    const bottomFrame = [...document.querySelectorAll('iframe')].at(-1)!
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
    const stability: { label: string; driftPx: number }[] = []
    const stable = async (label: string, action: () => void | Promise<void>, row = 1, paragraph = 0) => {
        const node = probe(row, paragraph)
        const before = node.getBoundingClientRect().top
        await action()
        await pause(420)
        const driftPx = Math.abs(node.getBoundingClientRect().top - before)
        stability.push({ label, driftPx })
        if (!node.isConnected || driftPx > 2) throw new Error(`${label}: visible prose moved ${driftPx}px`)
    }
    await read(1)
    if (!mediaReleases.has('previous')) throw new Error('Previous row must still be mounted for growth test')
    await stable('previous-row image load (MVCP only)', () => mediaReleases.get('previous')!())
    await stable('same-row image load', () => mediaReleases.get('same-mixed-1')!())
    await stable('same-row video metadata', () => mediaReleases.get('video-mixed-1')!())
    await stable('viewport resize', () => hostInput({ type: 'resize', width: 880, height: 800 }))
    const oldProbe = probe()
    await read(10, 20)
    await until(() => !oldProbe.isConnected, 'Reading row must virtualize away')
    await read(1)
    if (probe() === oldProbe) throw new Error('Return must exercise a remounted row')
    await stable('remounted reader remains stable', async () => { await pause(300) })
    await listRef.current!.scrollToEnd({ animated: false }); await pause(200)
    await realWheel(-32)
    const distance = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    // A layout compensation near the end must not undo the last upward intent.
    const paragraphs = [...document.querySelectorAll<HTMLElement>('[data-reading-probe^="mixed-11-"]')]
    const visible = paragraphs.find(node => { const rect = node.getBoundingClientRect(); return rect.top > 0 && rect.bottom < scroller.clientHeight })!
    if (!visible) throw new Error('Near-end prose must be visible')
    const paragraph = Number(visible.dataset.readingProbe!.split('-').at(-1))
    await stable('near-end upward intent survives compensation', () => mediaReleases.get('same-mixed-11')!(), 11, paragraph)
    render([...mixedRows, marker]); await pause(250)
    if (distance() < 20) throw new Error('A layout correction falsely reacquired end follow after upward intent')
    scroller.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
    await until(() => distance() <= 2, 'Explicit Latest must restore end follow')
    if (!trustedWheels) throw new Error('No trusted Electron wheel reached chat')
    URL.revokeObjectURL(shortVideo); URL.revokeObjectURL(tallVideo)
    return { stability, trustedWheels, iframeWheel: true, explicitLatest: true, remount: true, syntheticMedia: 'real SVG decoding and canvas-recorded WebM metadata through production Markdown components' }
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

;(window as any).visualizationScrollCheck = (async () => {
    checkBoundedAnchorFallback()
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
    console.log('[visual-scroll] mounted')
    const beforeUpdate = { ...stats }
    const retained = [...document.querySelectorAll('iframe')]
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
    // Same-row content updates must still change the rendered document.
    const changed = rows.map((row, i) => i === 19 && row.kind === 'message' ? { ...row, message: { ...row.message, text: row.message.text.replace('Synthetic chart 39', 'Changed chart 39') } } : row)
    render(changed)
    await until(() => { const current = [...document.querySelectorAll('iframe')].find(node => node.title === 'Chart 39'); return current && !bottomFrames.includes(current) && current.dataset.visualizationReady === 'true' }, 'Changed source must not reuse stale content')
    if ([...document.querySelectorAll('iframe')].some(node => node.getAttribute('sandbox') !== 'allow-scripts')) throw new Error('Sandbox permissions changed')
    const mixedMedia = await checkMixedMediaScroll()
    return { mixedMedia, workload: { rows: 20, chartsPerRow: 2, barsPerChart: 80, samples: 3, framesPerSample: 64, warmup: 'initial mount and six prompt update pairs' }, supportsAtomicMove: Boolean(moveBefore), initial, updates, updateTrace, samples, totals: stats, cache: getVisualizationDocumentCacheStats(), correctness: ['source changes invalidate', 'trusted helper sandbox stays opaque'] }
})()
