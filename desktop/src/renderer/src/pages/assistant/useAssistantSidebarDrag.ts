import { useEffect, useRef, useState, type HTMLAttributes, type RefObject } from 'react'

type Group = 'pinned' | 'chats'
type DragRow = { id: string; group: Group; enabled: boolean }
type Preview = { id: string; target: string; group: Group; placement: 'before' | 'after' }
type DragProps = HTMLAttributes<HTMLDivElement> & {
    'data-sidebar-drag-id': string
    'data-sidebar-dragging': true | undefined
    'data-sidebar-drop': Preview['placement'] | undefined
}
type Options = {
    scrollRef: RefObject<HTMLDivElement | null>
    onAutoScroll: (top: number) => void
    rows: DragRow[]
    onMove: (id: string, target: string, group: Group, placement: 'before' | 'after') => void
}

/** Pointer-only reordering: the existing list is the sole preview, never a native drag image. */
export function useAssistantSidebarDrag(options: Options) {
    const [preview, setPreview] = useState<Preview | null>(null)
    const latest = useRef(options)
    latest.current = options
    const cleanupRef = useRef<(() => void) | null>(null)
    const clickCleanupRef = useRef<(() => void) | null>(null)
    const dragClickRef = useRef(false)
    useEffect(() => () => { cleanupRef.current?.(); clickCleanupRef.current?.() }, [])
    // A status/filter/command change must not leave a gesture targeting stale rows.
    const eligibility = JSON.stringify(options.rows)
    useEffect(() => { cleanupRef.current?.() }, [eligibility])

    const getRowProps = (row: DragRow): DragProps => ({
        'data-sidebar-drag-id': row.id,
        'data-sidebar-dragging': preview?.id === row.id || undefined,
        'data-sidebar-drop': preview?.target === row.id && preview.id !== row.id ? preview.placement : undefined,
        // Also block native image/link dragging within the row.
        onDragStart: event => event.preventDefault(),
        onClickCapture: event => {
            // Cancellation can release capture before mouseup (blur/status change).
            // Only its click has no new pointerdown; independent control clicks clear this flag.
            if (!dragClickRef.current || event.detail === 0) return
            dragClickRef.current = false
            event.preventDefault()
            event.stopPropagation()
        },
        onPointerDown: event => {
            dragClickRef.current = false
            if (!row.enabled || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return
            if ((event.target as Element).closest('button,input,textarea,select,a,[contenteditable]:not([contenteditable="false"]),[role="menuitem"]')) return
            cleanupRef.current?.()
            clickCleanupRef.current?.()
            const source = event.currentTarget
            // Capture on the stable viewport: FLIP reorders/moves the row's DOM node.
            const captureTarget = latest.current.scrollRef.current || source
            const pointerId = event.pointerId
            const origin = { x: event.clientX, y: event.clientY }
            let point = origin
            let active = false
            let cancelled = false
            let destination: Preview | null = null
            let frame = 0
            let lastFrame = 0
            const root = source.ownerDocument.documentElement
            const previousCursor = root.getAttribute('data-assistant-sidebar-dragging')
            const restoreCursor = () => {
                if (previousCursor === null) root.removeAttribute('data-assistant-sidebar-dragging')
                else root.setAttribute('data-assistant-sidebar-dragging', previousCursor)
            }
            const eligibleRow = (id: string) => latest.current.rows.find(candidate => candidate.id === id && candidate.enabled && candidate.group === row.group)
            const hitRow = () => {
                const scroller = latest.current.scrollRef.current
                if (!scroller || !eligibleRow(row.id)) return null
                const bounds = scroller.getBoundingClientRect()
                if (point.x < bounds.left || point.x >= bounds.right || point.y < bounds.top || point.y >= bounds.bottom) return null
                const hit = source.ownerDocument.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-sidebar-drag-id]')
                return hit && scroller.contains(hit) && eligibleRow(hit.dataset.sidebarDragId!) ? hit : null
            }
            const update = () => {
                const hit = hitRow()
                if (!hit || hit.dataset.sidebarDragId === row.id) return
                const bounds = hit.getBoundingClientRect()
                const placement = point.y > bounds.top + bounds.height / 2 ? 'after' : 'before'
                if (destination && destination.target === hit.dataset.sidebarDragId && destination.placement === placement) return
                destination = { id: row.id, target: hit.dataset.sidebarDragId!, group: row.group, placement }
                setPreview(destination)
            }
            const tick = (time: number) => {
                if (!active || cancelled) return
                const scroller = latest.current.scrollRef.current
                const bounds = scroller?.getBoundingClientRect()
                if (scroller && bounds && point.x >= bounds.left && point.x < bounds.right && point.y >= bounds.top && point.y < bounds.bottom) {
                    const edge = Math.min(40, bounds.height / 4)
                    const velocity = point.y < bounds.top + edge ? -(bounds.top + edge - point.y) / edge : point.y > bounds.bottom - edge ? (point.y - bounds.bottom + edge) / edge : 0
                    const before = scroller.scrollTop
                    scroller.scrollTop += velocity * Math.min(32, lastFrame ? time - lastFrame : 16) * 0.6
                    // Read the newly scrolled rows, including beneath a stationary pointer.
                    if (scroller.scrollTop !== before) {
                        latest.current.onAutoScroll(scroller.scrollTop)
                        update()
                    }
                }
                lastFrame = time
                frame = requestAnimationFrame(tick)
            }
            const stopPreview = () => {
                cancelAnimationFrame(frame)
                if (active) restoreCursor()
                setPreview(null)
            }
            const cleanup = () => {
                window.removeEventListener('pointermove', move, true)
                window.removeEventListener('pointerup', up, true)
                window.removeEventListener('pointercancel', cancel, true)
                window.removeEventListener('keydown', keydown, true)
                window.removeEventListener('blur', blur)
                captureTarget.removeEventListener('lostpointercapture', cancel)
                if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId)
                stopPreview()
                if (cleanupRef.current === cleanup) cleanupRef.current = null
            }
            const suppressClick = () => {
                // Installed during pointerup, before its one generated click. Never swallow
                // keyboard clicks or a later independent click on a row/control.
                let timer: ReturnType<typeof setTimeout>
                const clear = () => {
                    window.removeEventListener('click', swallow, true)
                    clearTimeout(timer)
                    if (clickCleanupRef.current === clear) clickCleanupRef.current = null
                }
                const swallow = (click: MouseEvent) => {
                    if (click.detail === 0) return
                    dragClickRef.current = false
                    click.preventDefault()
                    click.stopImmediatePropagation()
                    clear()
                }
                clickCleanupRef.current?.()
                clickCleanupRef.current = clear
                window.addEventListener('click', swallow, true)
                timer = setTimeout(clear, 0)
            }
            const move = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId || cancelled) return
                point = { x: moveEvent.clientX, y: moveEvent.clientY }
                if (!active) {
                    if (Math.hypot(point.x - origin.x, point.y - origin.y) < 6) return
                    if (!eligibleRow(row.id)) { cleanup(); return }
                    active = true
                    dragClickRef.current = true
                    destination = { id: row.id, target: row.id, group: row.group, placement: 'before' }
                    setPreview(destination)
                    root.setAttribute('data-assistant-sidebar-dragging', 'true')
                    captureTarget.setPointerCapture(pointerId)
                    frame = requestAnimationFrame(tick)
                }
                moveEvent.preventDefault()
                update()
            }
            const up = (upEvent: PointerEvent) => {
                if (upEvent.pointerId !== pointerId) return
                point = { x: upEvent.clientX, y: upEvent.clientY }
                if (active) {
                    upEvent.preventDefault()
                    suppressClick()
                    // Keep the saved destination when FLIP moves the source under the pointer.
                    if (!cancelled) update()
                    const accepted = !cancelled && hitRow() && destination && destination.target !== row.id && eligibleRow(destination.target) ? destination : null
                    cleanup()
                    if (accepted) latest.current.onMove(accepted.id, accepted.target, accepted.group, accepted.placement)
                } else cleanup()
            }
            const cancel = (cancelEvent: PointerEvent) => { if (cancelEvent.pointerId === pointerId) cleanup() }
            const blur = () => cleanup()
            const keydown = (keyEvent: KeyboardEvent) => {
                if (keyEvent.key !== 'Escape') return
                cancelled = true
                // Keep capture until pointerup so the cancelled drag cannot select a row.
                stopPreview()
            }
            cleanupRef.current = cleanup
            window.addEventListener('pointermove', move, { capture: true, passive: false })
            window.addEventListener('pointerup', up, true)
            window.addEventListener('pointercancel', cancel, true)
            window.addEventListener('keydown', keydown, true)
            window.addEventListener('blur', blur)
            captureTarget.addEventListener('lostpointercapture', cancel)
        }
    })
    return { preview, getRowProps }
}
