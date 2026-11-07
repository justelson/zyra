import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Globe2, X } from 'lucide-react'
import { createDesktopLinkDispatcher, desktopWebLink } from '@shared/desktop-link-policy'
import { getDesktopLinkPreference, installDesktopLinkHandler, openDesktopLink, setDesktopLinkPreference } from '@/lib/desktop-links'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { addOverlayEventListener, NativeOverlayPortal } from './native-overlay-portal'
import { captureZyraBrowserLinkOpener } from '@/lib/zyra-browser-links'

export function DesktopLinkHost() {
    const [choice, setChoice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const dispatch = useMemo(() => createDesktopLinkDispatcher({
        preference: getDesktopLinkPreference,
        remember: setDesktopLinkPreference,
        choose: setChoice,
        captureContext: captureZyraBrowserLinkOpener,
        open: async (url, destination, openBrowser) => {
            if (destination === 'system' || !isElectronRendererRuntime()) return window.devscope.openBrowserPreviewExternal(url)
            return (openBrowser || captureZyraBrowserLinkOpener())(url)
        }
    }), [])
    useEffect(() => {
        const uninstall = installDesktopLinkHandler(async url => {
            setError(null)
            const result = await dispatch.request(url)
            if (!result.success) setError(result.error || 'Could not open this link.')
            return result
        })
        return () => { uninstall(); dispatch.cancel() }
    }, [dispatch])
    useEffect(() => {
        if (!isElectronRendererRuntime()) return
        return addOverlayEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
            const target = event.target as Element | null
            const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
            if (!anchor || anchor.hasAttribute('download') || anchor.dataset.desktopLink === 'external') return
            const url = desktopWebLink(anchor.getAttribute('href'))
            if (!url) return
            event.preventDefault()
            event.stopPropagation()
            const selection = anchor.ownerDocument.getSelection()
            if (selection && !selection.isCollapsed) return
            setError(null)
            void openDesktopLink(url).then(result => { if (!result.success) setError(result.error || 'Could not open this link.') })
        }, true)
    }, [])
    return <>
        {choice ? <DesktopLinkChoice key={choice} url={choice} onCancel={dispatch.cancel} onSelect={(destination, remember) => { void dispatch.select(destination, remember) }} /> : null}
        {error ? <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--color-border)] bg-sparkle-bg px-4 py-3 text-xs text-sparkle-text shadow-xl">{error}<button aria-label="Dismiss link error" onClick={() => setError(null)}><X size={14} /></button></div> : null}
    </>
}
function DesktopLinkChoice({ url, onCancel, onSelect }: { url: string; onCancel: () => void; onSelect: (destination: 'system' | 'zyra', remember: boolean) => void }) {
    const dialog = useRef<HTMLDialogElement>(null)
    const [remember, setRemember] = useState(true)
    return <NativeOverlayPortal autoFocus={false} onReady={() => { if (dialog.current && !dialog.current.open) dialog.current.showModal() }}>
        <dialog ref={dialog} onCancel={event => { event.preventDefault(); onCancel() }} aria-labelledby="desktop-link-choice-title" className="m-auto w-[min(400px,calc(100%-32px))] rounded-2xl border border-[var(--color-border)] bg-sparkle-bg p-5 text-sparkle-text shadow-2xl backdrop:bg-black/40">
            <div className="mb-4 flex items-center justify-between gap-4"><h2 id="desktop-link-choice-title" className="text-base font-medium">Open link in</h2><button type="button" autoFocus aria-label="Cancel opening link" onClick={onCancel} className="rounded-md p-1.5 text-sparkle-text-secondary hover:bg-[var(--color-accent)]"><X size={16} /></button></div>
            <p className="mb-4 truncate text-xs text-sparkle-text-muted">{new URL(url).hostname}</p>
            <div className="grid gap-2">
                <button type="button" onClick={() => onSelect('zyra', remember)} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-accent)]"><Globe2 size={19} /><span className="flex flex-col"><strong className="text-sm font-medium">Zyra Browser</strong><span className="text-xs text-sparkle-text-muted">Stay in the app</span></span></button>
                <button type="button" onClick={() => onSelect('system', remember)} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-accent)]"><ExternalLink size={19} /><span className="flex flex-col"><strong className="text-sm font-medium">Default browser</strong><span className="text-xs text-sparkle-text-muted">Use your computer's browser</span></span></button>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs text-sparkle-text-secondary"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} className="accent-[var(--color-primary)]" />Remember on this device</label>
            <p className="mt-2 text-[11px] text-sparkle-text-muted">Change later in Settings → Browser → Browsing.</p>
        </dialog>
    </NativeOverlayPortal>
}
