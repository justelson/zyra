import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info, TriangleAlert } from 'lucide-react'

export function SettingsInfoTooltip({ label, children, tone = 'info' }: { label: string; children: ReactNode; tone?: 'info' | 'warning' }) {
    const id = useId()
    const buttonRef = useRef<HTMLButtonElement>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [open, setOpen] = useState(false)
    const [position, setPosition] = useState({ left: 0, top: 0 })
    const cancelClose = () => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
    }
    const show = () => { cancelClose(); setOpen(true) }
    const close = () => { cancelClose(); setOpen(false) }
    const scheduleClose = () => {
        cancelClose()
        timerRef.current = setTimeout(() => {
            timerRef.current = null
            if (buttonRef.current?.ownerDocument.activeElement !== buttonRef.current) setOpen(false)
        }, 120)
    }

    useLayoutEffect(() => {
        if (!open) return
        const positionTooltip = () => {
            const anchor = buttonRef.current?.getBoundingClientRect()
            const tooltip = tooltipRef.current?.getBoundingClientRect()
            if (!anchor || !tooltip) return
            const view = buttonRef.current?.ownerDocument.defaultView || window
            const below = anchor.bottom + 6
            const top = below + tooltip.height <= view.innerHeight - 12 ? below : anchor.top - tooltip.height - 6
            setPosition({ left: Math.max(12, Math.min(anchor.left, view.innerWidth - tooltip.width - 12)), top: Math.max(12, top) })
        }
        positionTooltip()
        const view = buttonRef.current?.ownerDocument.defaultView || window
        view.addEventListener('resize', positionTooltip)
        view.addEventListener('scroll', positionTooltip, true)
        return () => {
            view.removeEventListener('resize', positionTooltip)
            view.removeEventListener('scroll', positionTooltip, true)
        }
    }, [open, children])

    useEffect(() => {
        if (!open) return
        const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) close()
        }
        const ownerDocument = buttonRef.current?.ownerDocument || document
        ownerDocument.addEventListener('keydown', keydown)
        ownerDocument.addEventListener('pointerdown', outside)
        return () => { ownerDocument.removeEventListener('keydown', keydown); ownerDocument.removeEventListener('pointerdown', outside) }
    }, [open])
    useEffect(() => () => cancelClose(), [])

    return <>
        <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            data-tone={tone}
            aria-describedby={open ? id : undefined}
            onMouseEnter={show}
            onMouseLeave={scheduleClose}
            onFocus={show}
            onBlur={close}
            onClick={show}
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-[var(--settings-control-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] ${tone === 'warning' ? 'text-[var(--status-warning)]' : 'text-[var(--settings-text-muted)] hover:text-[var(--settings-text)]'}`}
        >{tone === 'warning' ? <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" /> : <Info size={13} strokeWidth={1.8} aria-hidden="true" />}</button>
        {open ? createPortal(
            <div ref={tooltipRef} id={id} role="tooltip" style={position} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
                className="fixed z-[3000] max-h-[calc(100vh-24px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-md border border-[var(--settings-border-strong)] bg-[var(--settings-popover)] p-3 text-[12px] font-normal leading-5 text-[var(--settings-text-secondary)] shadow-xl">
                {children}
            </div>, buttonRef.current?.closest('dialog') || buttonRef.current?.ownerDocument.body || document.body
        ) : null}
    </>
}
