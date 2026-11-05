import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const root = createRoot(document.getElementById('root')!)
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
function rows(count: number): TimelineDisplayRow[] {
    return Array.from({ length: count }, (_, index) => {
        const id = `message-${20 - count + index}`
        const position = 20 - count + index
        const createdAt = new Date(1_000_000 + position * 1_000).toISOString()
        const text = position === 18 ? 'hello' : position === 19 ? 'Hi! What would you like to work on?' : position % 2 === 0 ? `Earlier prompt ${position / 2}` : `Saved response ${Math.floor(position / 2)} with the earlier conversation still available.`
        return { kind: 'message', id, createdAt, message: { id, role: position % 2 === 0 ? 'user' : 'assistant', text, turnId: id, streaming: false, createdAt, updatedAt: createdAt } }
    })
}

let loads = 0
let concurrent = 0
let maxConcurrent = 0
function Fixture({ working, cold, fail = false, hydrating = false }: { working: boolean; cold: boolean; fail?: boolean; hydrating?: boolean }) {
    const listRef = useRef(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const [count, setCount] = useState(2)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <AssistantVirtualTimeline rows={rows(count)} windowKey="startup" listRef={listRef} scrollContainerRef={scrollRef}
        contentInsetEndAdjustment={0} isWorking={working} selectionHydrating={hydrating} coldStart={cold}
        hasOlder={count < 14} hasNewer={false} loadingOlder={loading} loadingNewer={false} loadOlderError={error} loadNewerError={null}
        onLoadOlder={async () => {
            loads++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent)
            setLoading(true)
            await pause(30)
            concurrent--
            setLoading(false)
            if (fail) { setError('Synthetic paging failure'); throw new Error('Synthetic paging failure') }
            setCount(value => value + 4)
            return true
        }} renderRow={row => row.kind === 'message' && <div style={{ height: 110, display: 'flex', justifyContent: row.message.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 32px' }} data-startup-message={row.id}>
            <div style={{ height: 'fit-content', padding: 16, borderRadius: 14, background: row.message.role === 'user' ? '#1b1b1b' : 'transparent' }}>{row.message.text}</div>
        </div>} />
}

;(window as any).captureHistoryStartup = async () => {
    flushSync(() => root.render(<Fixture key="capture" working cold />))
    await pause(350)
    const scroll = document.querySelector<HTMLElement>('.assistant-chat-scrollbar')!
    return { clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop, loads }
}

;(window as any).historyStartupCheck = (async () => {
    const results: string[] = []
    for (const working of [true, false]) {
        for (const cold of [true, false]) {
            loads = 0; maxConcurrent = 0
            flushSync(() => root.render(<Fixture key={`${working}:${cold}`} working={working} cold={cold} />))
            for (let attempt = 0; attempt < 70 && loads === 0; attempt++) await pause()
            check(loads > 0, `underfilled ${working ? 'working' : 'settled'} ${cold ? 'cold' : 'warm'} chat must fetch older history without user scrolling`)
            await pause(250)
            check(maxConcurrent === 1, 'initial history pages have one owner')
            const scroll = document.querySelector<HTMLElement>('.assistant-chat-scrollbar')!
            check(scroll.scrollHeight >= scroll.clientHeight, 'older conversation fills the viewport')
            check(getComputedStyle(scroll).visibility === 'visible', 'loaded history is visible')
            results.push(`${working ? 'working' : 'settled'}/${cold ? 'cold' : 'warm'}: filled viewport, serial paging, visible history`)
        }
    }
    flushSync(() => root.render(<Fixture key="failure" working={true} cold fail />))
    await pause(300)
    check(getComputedStyle(document.querySelector('.assistant-chat-scrollbar')!).visibility === 'visible', 'paging failure cannot hide the conversation')
    check(document.body.textContent?.includes('Retry earlier messages'), 'paging failure offers recovery')
    results.push('failed page retains visible conversation and retry')
    return results
})()
