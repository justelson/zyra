import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import { CompletedAssistantMarkdown, StreamingAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { VisualizationThreadContext } from '../../src/renderer/src/components/ui/visualization/visualization-thread-context'
import { visualizationFramePool } from '../../src/renderer/src/components/ui/visualization/visualization-frame-pool'

const root = createRoot(document.getElementById('root')!)
const listRef = createRef<LegendListRef>(), scrollRef = createRef<HTMLDivElement>()
const pages = (window as any).longChatReplayPages as Array<{ messages: any[] }>
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate: () => unknown, label: string) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await pause(40) }
    throw new Error(label)
}
const date = '2026-01-01T00:00:00.000Z'
const messageRow = (message: any): TimelineDisplayRow => ({ id: message.id, kind: 'message', createdAt: message.createdAt, message })
const sourceRows = [...pages].reverse().flatMap(page => page.messages).map(messageRow)
const other: TimelineDisplayRow[] = [messageRow({ id: 'other-chat-message', role: 'user', text: 'Other chat stays selected while the first chat works.', createdAt: date, updatedAt: date, streaming: false })]
const live = (text: string, streaming = true) => messageRow({ id: 'replay-live-message', role: 'assistant', text, createdAt: date, updatedAt: date, streaming })
const renderRow = (row: TimelineDisplayRow) => row.kind === 'message' ? <article data-message-id={row.id}>
    {row.message.streaming
        ? <StreamingAssistantMarkdown cacheKey={row.id} content={row.message.text} mediaMode="images-and-videos" />
        : <CompletedAssistantMarkdown cacheKey={row.id} content={row.message.text} mediaMode="images-and-videos" />}
</article> : null
function render(rows: TimelineDisplayRow[], key = 'source', working = false, onLoadOlder?: () => Promise<boolean>) {
    flushSync(() => root.render(<VisualizationThreadContext.Provider value={key}><AssistantVirtualTimeline rows={rows} windowKey={key} listRef={listRef} scrollContainerRef={scrollRef}
        contentInsetEndAdjustment={0} isWorking={working} selectionHydrating={false} hasOlder={Boolean(onLoadOlder)} hasNewer={false}
        loadingOlder={false} loadingNewer={false} loadOlderError={null} loadNewerError={null} onLoadOlder={onLoadOlder} renderRow={renderRow} /></VisualizationThreadContext.Provider>))
}
const latest = () => scrollRef.current!.dispatchEvent(new CustomEvent('assistant:timeline-follow-end', { bubbles: true }))
const bottom = () => { const node = scrollRef.current!; return node.scrollHeight - node.clientHeight - node.scrollTop }
;(window as any).longChatReplayCheck = (async () => {
    if (!sourceRows.length) throw new Error('Replay needs real message data')
    const checks: string[] = []
    render(sourceRows)
    await until(() => scrollRef.current && document.querySelector('article'), 'Source chat must render')
    await pause(500)
    latest(); await pause(250)
    const resident = document.querySelectorAll('article').length
    if (sourceRows.length > 50 && resident >= sourceRows.length / 2) throw new Error('Long history must stay virtualized')
    checks.push('bounded mounted message count')
    const ids = [0, Math.floor(sourceRows.length / 2), sourceRows.length - 1]
    for (const index of ids) {
        await listRef.current!.scrollToIndex({ index, animated: false })
        await until(() => [...document.querySelectorAll('article')].some(node => node.getAttribute('data-message-id') === sourceRows[index].id), `Missing exact source row at ${index}`)
        await pause(180)
    }
    checks.push('oldest, middle and latest real message render')
    let rows = [...sourceRows, live('Replay is working.\n\nPartial response.')]
    render(rows, 'source', true); latest(); await pause(250)
    if (!document.querySelector('[data-message-id="replay-live-message"]')) throw new Error('Working message must render')
    for (let cycle = 0; cycle < 15; cycle++) {
        render(other, 'other', false)
        await until(() => document.querySelector('[data-message-id="other-chat-message"]'), 'Switch must show destination')
        rows = [...sourceRows, live(`Replay is working.\n\nUpdate ${cycle}.`)]
        await pause(20)
        if (document.querySelector('[data-message-id="replay-live-message"]')) throw new Error('Background stream leaked into selected chat')
        render(rows, 'source', true)
        await until(() => document.querySelector('[data-message-id="replay-live-message"]')?.textContent?.includes(`Update ${cycle}.`), 'Return must show latest background update')
    }
    checks.push('15 working-chat switch and background update cycles')
    rows = [...sourceRows, live('Replay completed.', false)]
    render(other, 'other', false); await pause()
    render(rows, 'source', false); latest(); await pause(300)
    await until(() => document.querySelector('[data-message-id="replay-live-message"]')?.textContent?.includes('Replay completed.'), 'Completion while away must survive returning')
    if (bottom() > 3) throw new Error(`Returning completed chat failed latest alignment: ${bottom()}`)
    checks.push('completion while away and latest alignment')
    let resolveOlder!: (value: boolean) => void
    let olderRequests = 0
    const pendingOlder = new Promise<boolean>(resolve => { resolveOlder = resolve })
    render(rows, 'source', false, () => { olderRequests++; return pendingOlder })
    await pause(160) // Let the new history callback's passive subscription commit.
    scrollRef.current!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -500 }))
    await listRef.current!.scrollToIndex({ index: 0, animated: false })
    await pause(160)
    scrollRef.current!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -500 }))
    await until(() => olderRequests > 0, 'Upward navigation must request older history')
    render(other, 'other')
    resolveOlder(false)
    await pause(200)
    if (!document.querySelector('[data-message-id="other-chat-message"]') || document.querySelector('[data-message-id="replay-live-message"]')) throw new Error('Late history completion changed the selected chat')
    checks.push('late history response after switching preserves selected chat')
    render(rows, 'source'); latest(); await pause(200)
    const intervals: number[] = []
    let previous = await new Promise<number>(resolve => requestAnimationFrame(resolve))
    for (let step = 0; step < 80; step++) {
        const node = scrollRef.current!
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: step < 40 ? -200 : 200 }))
        node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight) * (step < 40 ? 1 - step / 39 : (step - 40) / 39)
        const now = await new Promise<number>(resolve => requestAnimationFrame(resolve))
        intervals.push(now - previous); previous = now
    }
    checks.push('80-frame source-history scroll sweep (programmatic geometry)')
    // A full-history sweep can jump many viewports per frame. Also record a
    // fixed-distance local sweep, without presenting either as installed FPS.
    const mediaIndex = sourceRows.findIndex((row, index) => index >= sourceRows.length / 2 && row.kind === 'message' && /!\[|<img|<video|\.mp4/i.test(row.message.text))
    const localIndex = mediaIndex >= 0 ? mediaIndex : Math.floor(sourceRows.length / 2)
    await listRef.current!.scrollToIndex({ index: localIndex, animated: false })
    await until(() => document.querySelector(`[data-message-id="${CSS.escape(sourceRows[localIndex].id)}"]`), 'Local sweep row must mount')
    await pause(200)
    const localIntervals: number[] = []
    previous = await new Promise<number>(resolve => requestAnimationFrame(resolve))
    for (let step = 0; step < 80; step++) {
        const node = scrollRef.current!
        const delta = step < 40 ? 250 : -250
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta }))
        node.scrollTop += delta
        const now = await new Promise<number>(resolve => requestAnimationFrame(resolve))
        localIntervals.push(now - previous); previous = now
    }
    checks.push('80-frame local source-history sweep at 250 px/frame (programmatic geometry)')
    render(other, 'other'); await pause(200)
    root.unmount()
    const frameCache = visualizationFramePool(document).stats()
    if (document.getElementById('root')!.querySelector('iframe,video,article') || frameCache.active !== 0) throw new Error('Replay left active media after teardown')
    if (frameCache.entries > frameCache.maxEntries || frameCache.bytes > frameCache.maxBytes) throw new Error('Replay exceeded parked-frame limits')
    checks.push('media/message teardown')
    const sorted = [...intervals].sort((a,b) => a-b)
    const localSorted = [...localIntervals].sort((a,b) => a-b)
    return { checks, frameCache, messages: sourceRows.length, residentMessages: resident, scroll: { medianMs: sorted[40], p95Ms: sorted[76], maxMs: Math.max(...intervals), framesOver32ms: intervals.filter(value => value > 32).length }, localScroll: { medianMs: localSorted[40], p95Ms: localSorted[76], maxMs: Math.max(...localIntervals), framesOver32ms: localIntervals.filter(value => value > 32).length }, limitations: ['No live provider; working updates are synthetic.', 'Source media URLs are preserved, but external network is blocked; decode/late-size/wheel checks use the separate mixed-media fixture.', 'Work/tool bodies are checked by native pagination, not mounted in this message-only renderer.'] }
})()
