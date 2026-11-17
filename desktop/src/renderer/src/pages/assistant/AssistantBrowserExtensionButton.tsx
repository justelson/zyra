import { useEffect, useRef, useState } from 'react'
import { Puzzle } from 'lucide-react'
import type { BrowserExtensionRecord } from '@shared/browser-extensions'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { addOverlayEventListener, isOverlayEventInside } from '@/components/ui/native-overlay-portal'

export function AssistantBrowserExtensionButton({ className }: { className: string }) {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<BrowserExtensionRecord[] | null>(null)
    const [error, setError] = useState('')
    const root = useRef<HTMLDivElement>(null)
    const menu = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        let active = true
        setError('')
        setItems(null)
        void window.devscope.listBrowserExtensions().then(result => {
            if (!active) return
            if (result.success) setItems(result.extensions.filter(item => item.enabled))
            else setError(result.error || 'Could not load extensions.')
        }).catch(() => { if (active) setError('Could not load extensions.') })
        const remove = addOverlayEventListener('pointerdown', event => {
            if (!isOverlayEventInside(event, root.current, menu.current)) setOpen(false)
        }, true)
        return () => { active = false; remove() }
    }, [open])
    return <div ref={root} className="relative">
        <button type="button" title="Extensions" aria-label="Extensions" aria-expanded={open} className={className} onClick={() => setOpen(value => !value)}><Puzzle size={14} /></button>
        {open && <AnchoredNativeOverlay anchorRef={root} inputRegionRef={menu} scoped><div ref={menu} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }} className="absolute right-0 top-8 z-[380] w-56 rounded-lg border border-[var(--surface-divider)] bg-sparkle-card p-1 text-xs text-sparkle-text shadow-lg">
            {error ? <p role="alert" className="p-2">{error}</p> : items?.length ? items.map(item => <button key={item.id} type="button" disabled={!item.hasPopup} title={item.hasPopup ? item.name : 'This extension runs without a popup'} className="block w-full truncate rounded p-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-60" onClick={async () => {
                try {
                    const result = await window.devscope.openBrowserExtensionPopup(item.id)
                    if (!result.success) throw new Error(result.error || 'Could not open extension.')
                    setOpen(false)
                } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open extension.') }
            }}>{item.name}</button>) : <p className="p-2">{items ? 'No enabled extensions' : 'Loading extensions…'}</p>}
        </div></AnchoredNativeOverlay>}
    </div>
}
