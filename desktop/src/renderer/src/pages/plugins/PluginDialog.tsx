import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function PluginDialog({ title, subtitle, children, footer, busy = false, onClose }: {
    title: string
    subtitle?: string
    children: ReactNode
    footer?: ReactNode
    busy?: boolean
    onClose: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const subtitleId = useId()
    useEffect(() => {
        const dialog = ref.current
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog?.showModal()
        return () => {
            dialog?.close()
            if (previous?.isConnected) previous.focus()
        }
    }, [])

    return createPortal(
        <dialog
            ref={ref}
            className="plugin-dialog"
            aria-labelledby={titleId}
            aria-describedby={subtitle ? subtitleId : undefined}
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}
            onClick={(event) => {
                if (event.target !== event.currentTarget || busy) return
                const bounds = event.currentTarget.getBoundingClientRect()
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
            }}
        >
            <header className="plugin-dialog-header">
                <div>
                    <h2 id={titleId}>{title}</h2>
                    {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
                </div>
                <button type="button" className="plugin-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose} autoFocus><X size={18} /></button>
            </header>
            <div className="plugin-dialog-body custom-scrollbar">{children}</div>
            {footer ? <footer className="plugin-dialog-footer">{footer}</footer> : null}
        </dialog>, document.body
    )
}
