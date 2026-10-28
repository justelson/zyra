import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'
import { AssistantInlineDiffPreview } from './AssistantInlineDiffPreview'
import { InlineDiffStats } from './AssistantInlineDiffStats'
import './ComposerFileChangePreview.css'

/** Per-file inspection only. Opening or dismissing the preview never decides an approval. */
export function ComposerFileChangePreview({ displayPath, patch, additions, deletions }: {
    displayPath: string
    patch: string
    additions: number
    deletions: number
}) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLButtonElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const focusFrame = useRef(0)
    const suppressFocus = useRef(false)
    const clearTimers = useCallback(() => {
        if (openTimer.current) clearTimeout(openTimer.current)
        if (closeTimer.current) clearTimeout(closeTimer.current)
        openTimer.current = closeTimer.current = null
    }, [])
    const show = useCallback(() => { clearTimers(); setOpen(true) }, [clearTimers])
    const close = useCallback(() => {
        clearTimers()
        setOpen(false)
        // Escape restores the anchor's focus. Do not treat that restoration as new intent.
        suppressFocus.current = true
        if (focusTimer.current) clearTimeout(focusTimer.current)
        focusTimer.current = setTimeout(() => { suppressFocus.current = false; focusTimer.current = null }, 0)
    }, [clearTimers])
    const leave = () => {
        clearTimers()
        closeTimer.current = setTimeout(() => {
            const active = popupRef.current?.ownerDocument.activeElement
            if (active && popupRef.current?.contains(active) || anchorRef.current?.matches(':focus-visible')) return
            close()
        }, 180)
    }
    useEffect(() => () => {
        clearTimers()
        if (focusTimer.current) clearTimeout(focusTimer.current)
        cancelAnimationFrame(focusFrame.current)
    }, [clearTimers])
    return <>
        <button ref={anchorRef} type="button" data-composer-file-change-row className="composer-file-change-row"
            aria-label={`Preview changes in ${displayPath}`} aria-haspopup="dialog" aria-expanded={open}
            onMouseEnter={() => { clearTimers(); openTimer.current = setTimeout(show, 130) }} onMouseLeave={leave}
            onFocus={() => { if (!suppressFocus.current) show() }} onBlur={event => { if (!popupRef.current?.contains(event.relatedTarget)) leave() }}
            onClick={show} onKeyDown={event => {
                if (event.key !== 'ArrowDown') return
                event.preventDefault(); show()
                cancelAnimationFrame(focusFrame.current)
                focusFrame.current = requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus())
            }}>
            <FileText size={15} aria-hidden="true" /><span className="composer-file-change-path">{displayPath}</span>
            <InlineDiffStats additions={additions} deletions={deletions} /><span className="composer-file-change-kind">Edit</span>
        </button>
        {open ? <AnchoredMenuPopover anchorRef={anchorRef} contentRef={popupRef} label={`Changes to ${displayPath}`} role="dialog" width={680} align="end" onClose={close} browserZIndex={220}>
            <div className="composer-file-diff-surface" data-composer-file-diff onMouseEnter={clearTimers} onMouseLeave={leave} onFocusCapture={clearTimers} onBlurCapture={event => { if (!popupRef.current?.contains(event.relatedTarget) && event.relatedTarget !== anchorRef.current) leave() }}>
                <AssistantInlineDiffPreview patch={patch} displayPath={displayPath} additions={additions} deletions={deletions} />
            </div>
        </AnchoredMenuPopover> : null}
    </>
}
