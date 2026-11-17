import { useContext, useLayoutEffect, useRef } from 'react'
import { subscribeVisualizationFrameMessages } from './visualization-frame-messages'
import { attachVisualizationFrame, visualizationFramePool, type VisualizationFrameLease } from './visualization-frame-pool'
import { VisualizationThreadContext } from './visualization-thread-context'

type VisualizationFrameProps = {
    source: string
    identity: number
    title: string
    summary?: string
    height: number | string
    ready: boolean
    reducedMotion: boolean
    fill: boolean
    onReset: () => void
    onHeight: (height: number) => void
    onWheel: (delta: number) => void
}

export function VisualizationFrame(props: VisualizationFrameProps) {
    const host = useRef<HTMLDivElement>(null)
    const current = useRef<VisualizationFrameLease | null>(null)
    const threadId = useContext(VisualizationThreadContext)
    const callbacks = useRef(props)
    callbacks.current = props
    useLayoutEffect(() => {
        const element = host.current
        if (!element) return
        const owner = element.ownerDocument
        const view = owner.defaultView!
        const rowId = element.closest<HTMLElement>('[data-assistant-timeline-row-id]')?.dataset.assistantTimelineRowId
        const scope = !props.fill && threadId && rowId ? `${threadId}\0${rowId}\0${props.identity}` : null
        const pool = visualizationFramePool(owner)
        const lease = pool.acquire(props.source, scope)
        const entry = lease.entry
        const frame = entry.frame
        current.current = lease
        const initialize = () => {
            if (entry.owner !== lease.token) return
            if (entry.initialized) frame.contentWindow?.postMessage({ type: 'zyra:visualization-resume', channel: entry.channel }, '*')
            else {
                entry.initialized = true
                frame.contentWindow?.postMessage({ type: 'zyra:visualization-init', channel: entry.channel, document: props.source, fitContent: !props.fill }, '*')
            }
        }
        const receive = (event: MessageEvent) => {
            if (entry.owner !== lease.token) return
            if (event.data?.type === 'zyra:visualization-ready') { initialize(); return }
            if (event.data?.channel !== entry.channel) return
            if (event.data.type === 'zyra:visualization-wheel' && !props.fill) {
                const delta = event.data.deltaY
                if (typeof delta === 'number' && Number.isFinite(delta) && Math.abs(delta) <= 10_000) callbacks.current.onWheel(delta)
            }
            if (event.data.type !== 'zyra:visualization-height') return
            const height = event.data.height, width = event.data.width
            if (typeof height !== 'number' || !Number.isFinite(height) || height < 0 || height > 100_000) return
            entry.ready = true
            entry.height = height
            if (typeof width === 'number' && Number.isFinite(width) && width > 0 && width <= 100_000) entry.width = width
            callbacks.current.onHeight(height)
        }
        frame.addEventListener('load', initialize)
        attachVisualizationFrame(element, frame)
        const unsubscribe = subscribeVisualizationFrameMessages(view, frame.contentWindow!, receive)
        if (entry.ready) callbacks.current.onHeight(entry.height)
        else callbacks.current.onReset()
        if (entry.initialized) initialize()
        return () => {
            unsubscribe()
            frame.removeEventListener('load', initialize)
            if (current.current === lease) current.current = null
            pool.release(lease)
        }
    }, [props.source, props.identity, props.fill, threadId])
    useLayoutEffect(() => {
        const frame = current.current?.entry.frame
        if (!frame) return
        frame.title = props.title
        if (props.summary) frame.setAttribute('aria-description', props.summary)
        else frame.removeAttribute('aria-description')
        if (props.ready && current.current?.entry.ready) { frame.dataset.visualizationReady = 'true'; frame.removeAttribute('aria-hidden') }
        else { delete frame.dataset.visualizationReady; frame.setAttribute('aria-hidden', 'true') }
    }, [props.ready, props.title, props.summary, props.source, props.identity, props.fill, threadId])
    return <div ref={host} className="block w-full" style={{ height: props.height, opacity: props.ready ? 1 : 0, transition: props.reducedMotion ? 'none' : 'opacity 220ms ease-out' }} />
}
