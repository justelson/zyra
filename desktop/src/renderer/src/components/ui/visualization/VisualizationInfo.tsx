import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, MoreVertical } from 'lucide-react'

const actionClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-sparkle-text hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none'

export function VisualizationInfo({ title, onCopy, onDownload }: { title: string; onCopy: () => void; onDownload: () => void }) {
    const id = useId()
    const trigger = useRef<HTMLButtonElement>(null)
    const panel = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const [position, setPosition] = useState({ left: 0, top: 0 })
    const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
    const focusFirst = () => requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus())
    useLayoutEffect(() => {
        if (!open) return
        const view = trigger.current!.ownerDocument.defaultView!
        const update = () => {
            const anchor = trigger.current?.getBoundingClientRect(), bounds = panel.current?.getBoundingClientRect()
            if (!anchor || !bounds) return
            setPosition({ left: Math.max(12, Math.min(anchor.left, view.innerWidth - bounds.width - 12)), top: Math.max(12, anchor.bottom + bounds.height + 6 <= view.innerHeight - 12 ? anchor.bottom + 6 : anchor.top - bounds.height - 6) })
        }
        update()
        view.addEventListener('resize', update); view.addEventListener('scroll', update, true)
        const observer = new ResizeObserver(update)
        if (panel.current) observer.observe(panel.current)
        return () => { view.removeEventListener('resize', update); view.removeEventListener('scroll', update, true); observer.disconnect() }
    }, [open])
    useEffect(() => {
        if (!open) return
        const owner = trigger.current!.ownerDocument
        const outside = (event: PointerEvent) => {
            const target = event.target as Node | null
            if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); event.preventDefault() } }
        owner.addEventListener('pointerdown', outside); owner.addEventListener('keydown', escape)
        return () => { owner.removeEventListener('pointerdown', outside); owner.removeEventListener('keydown', escape) }
    }, [open])
    return <>
        <button ref={trigger} type="button" aria-label={`Options for ${title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => { if (open) close(); else { setOpen(true); focusFirst() } }}
            onKeyDown={event => {
                if (event.key === 'ArrowDown' || (open && event.key === 'Tab' && !event.shiftKey)) { event.preventDefault(); setOpen(true); focusFirst() }
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-sparkle-text-muted hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"><MoreVertical size={14} aria-hidden="true" /></button>
        {open && trigger.current ? createPortal(<div ref={panel} id={id} role="menu" aria-label={`HTML options for ${title}`} style={position}
            onKeyDown={event => {
                const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
                const current = items.indexOf(event.target as HTMLButtonElement)
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault()
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                    items[next]?.focus()
                }
                if (event.key === 'Tab') setTimeout(() => setOpen(false), 0)
            }}
            className="fixed z-[3000] w-[min(190px,calc(100vw-24px))] rounded-md border border-[var(--surface-divider)] bg-sparkle-card p-1 shadow-xl">
            <button type="button" role="menuitem" className={actionClass} onClick={() => { close(); onCopy() }}><Copy size={13} aria-hidden="true" />Copy HTML</button>
            <button type="button" role="menuitem" className={actionClass} onClick={() => { close(); onDownload() }}><Download size={13} aria-hidden="true" />Download HTML</button>
        </div>, trigger.current.ownerDocument.body) : null}
    </>
}
