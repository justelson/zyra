import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import DOMPurify from 'dompurify'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
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
const renderRow = (row: TimelineDisplayRow) => row.kind === 'message' ? <VisualizationMessage content={row.message.text} streaming={false} renderMarkdown={markdown} /> : null
const render = (data: TimelineDisplayRow[]) => flushSync(() => root.render(<AssistantVirtualTimeline
    rows={data} windowKey="visual-scroll" listRef={listRef} scrollContainerRef={scrollRef}
    contentInsetEndAdjustment={0} isWorking={false} selectionHydrating={false}
    hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
    loadOlderError={null} loadNewerError={null} renderRow={renderRow}
/>))
const delta = (before: typeof stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value - before[key as keyof typeof stats]]))
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]

;(window as any).visualizationScrollCheck = (async () => {
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
    return { workload: { rows: 20, chartsPerRow: 2, barsPerChart: 80, samples: 3, framesPerSample: 64, warmup: 'initial mount and six prompt update pairs' }, supportsAtomicMove: Boolean(moveBefore), initial, updates, updateTrace, samples, totals: stats, cache: getVisualizationDocumentCacheStats(), correctness: ['source changes invalidate', 'trusted helper sandbox stays opaque'] }
})()
