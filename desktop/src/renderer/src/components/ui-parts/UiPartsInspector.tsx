import { useEffect, useRef, useState } from 'react'
import { UI_PARTS, validateUiPartConfig, type UiPartConfig } from '@shared/ui-parts'
import { useSettings } from '@/lib/settings'
import { rowStyle } from './row-style'

const EMPTY: UiPartConfig = { version: 1, overrides: {} }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const openUiPartsInspector = () => window.dispatchEvent(new Event('zyra:inspect-ui'))

export function UiPartsInspector() {
    const { settings, updateSettings } = useSettings()
    const saved = settings.appearanceUiParts ?? EMPTY
    const [open, show] = useState(false), [pick, picking] = useState(false), [query, search] = useState('')
    const [id, select] = useState('sidebar.chatRow'), [status, report] = useState('')
    const [draft, preview] = useState<UiPartConfig | null>(null), [busy, pending] = useState(false)
    const [undo, remember] = useState<{ before: UiPartConfig; after: UiPartConfig } | null>(null)
    const [compareSaved, setCompareSaved] = useState(false)
    const base = useRef(saved), searchRef = useRef<HTMLInputElement>(null), origin = useRef<HTMLElement | null>(null)
    const marked = useRef<HTMLElement | null>(null)
    const part = UI_PARTS.find(p => p.id === id)!
    function mark(el: HTMLElement | null) {
        marked.current?.removeAttribute('data-zyra-inspected'); marked.current = el
        el?.setAttribute('data-zyra-inspected','')
    }
    function close() { show(false); picking(false); preview(null); mark(null); origin.current?.focus() }
    useEffect(() => {
        const start = () => { origin.current = document.activeElement as HTMLElement; show(true) }
        window.addEventListener('zyra:inspect-ui', start)
        return () => { window.removeEventListener('zyra:inspect-ui', start); mark(null) }
    }, [])
    useEffect(() => { if (open) searchRef.current?.focus() }, [open])
    useEffect(() => {
        if (!open) return
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); pick ? picking(false) : close() } }
        const capture = (e: Event) => {
            if (!pick || !(e.target instanceof Element) || e.target.closest('[data-ui-inspector]')) return
            e.preventDefault(); e.stopImmediatePropagation()
            if (e.type !== 'click') return
            const el = e.target.closest<HTMLElement>('[data-zyra-part]')
            const found = UI_PARTS.find(p => p.id === el?.dataset.zyraPart)
            if (!el || !found || el.hasAttribute('data-zyra-screen-boundary') && el !== e.target) { mark(null); report('This element has no mapped part yet.') }
            else { select(found.id); mark(el); report(el.dataset.zyraState || 'Present on screen') }
            picking(false)
        }
        window.addEventListener('keydown',key,true)
        const events = ['pointerdown','pointerup','mousedown','mouseup','click']
        for (const event of events) window.addEventListener(event,capture,true)
        return () => { window.removeEventListener('keydown',key,true); for (const event of events) window.removeEventListener(event,capture,true) }
    }, [open,pick])
    function locate(next: string, direction = 0) {
        select(next)
        const matches = [...document.querySelectorAll<HTMLElement>(`[data-zyra-part="${CSS.escape(next)}"]`)].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
        const current = marked.current ? matches.indexOf(marked.current) : -1
        const index = !direction || current < 0 ? 0 : (current + direction + matches.length) % matches.length
        const el = matches[index] ?? null
        mark(el); el?.scrollIntoView({ block:'nearest', inline:'nearest' }); report(el ? `Instance ${index + 1} of ${matches.length} · ${el.dataset.zyraState || 'Present on screen'}` : 'Not present on this screen')
    }
    function stage(key: string, value: number | string) {
        const previous = draft ?? saved
        try {
            const next = validateUiPartConfig({ version:1, overrides:{ ...previous.overrides, [id]:{ ...previous.overrides[id], [key]:value } } })
            if (!draft) base.current = saved
            setCompareSaved(false); preview(next); report('Preview only. Apply to keep this change.')
        } catch (e) { report(String(e)) }
    }
    async function save(next: UiPartConfig, expected: UiPartConfig, reverting: boolean) {
        if (!same(saved,expected)) { report('Settings changed elsewhere. Discard this preview before editing again.'); return }
        pending(true)
        try { await updateSettings({appearanceUiParts: validateUiPartConfig(next)}); remember(reverting ? null : {before:saved,after:next}); preview(null); report(reverting ? 'Undone.' : 'Applied.') }
        catch(e) { report(String(e)) } finally { pending(false) }
    }
    return <><style>{rowStyle(compareSaved ? saved : draft ?? saved, settings.accessibilityReduceMotion)}</style>{open && <aside data-ui-inspector aria-label="Interface inspector" className="fixed bottom-4 right-4 z-50 grid max-h-[75vh] w-80 max-w-[95vw] gap-2 overflow-auto rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-3 text-sm text-sparkle-text shadow-xl">
        <style>{'[data-zyra-inspected]{outline:2px solid var(--accent-primary)!important;outline-offset:-2px}'}</style>
        <header className="flex justify-between"><strong>Interface inspector</strong><button onClick={close}>Close</button></header>
        <input ref={searchRef} aria-label="Find an interface part" placeholder="Find a part…" value={query} onChange={e => search(e.target.value)} />
        <div aria-label="Parts" className="grid max-h-32 overflow-auto">{UI_PARTS.filter(p => `${p.id} ${p.label}`.toLowerCase().includes(query.toLowerCase())).map(p => <button className="text-left" key={p.id} aria-pressed={id === p.id} onClick={() => locate(p.id)}>{p.label}</button>)}</div>
        <button aria-pressed={pick} onClick={() => picking(!pick)}>{pick ? 'Select a part onscreen (Esc to cancel)' : 'Pick on screen'}</button>
        <div className="flex gap-2"><button type="button" onClick={() => locate(id,-1)}>Previous instance</button><button type="button" onClick={() => locate(id,1)}>Next instance</button></div>
        <code>{id}</code><div>{part.protection === 'normal' ? part.label : `${part.label} · ${part.protection}, read only`}</div>
        {part.states.length > 0 && <small>States: {part.states.join(', ')}</small>}
        {Object.entries(part.properties).map(([key,spec]) => { const value = (draft ?? saved).overrides[id]?.[key] ?? spec.default; return <label key={key} className="flex items-center justify-between gap-2">{key}{spec.type === 'enum' ? <select value={value} onChange={e => stage(key,e.target.value)}>{spec.values?.map(v => <option key={v}>{v}</option>)}</select> : <input aria-label={key} type={spec.type === 'number' ? 'number' : 'color'} min={spec.min} max={spec.max} placeholder="Theme" value={value === 'theme' ? (spec.type === 'color' ? '#000000' : '') : value} onChange={e => stage(key,spec.type === 'number' ? e.target.value === '' ? spec.default : Number(e.target.value) : e.target.value)} />}<button onClick={() => stage(key,spec.default)}>Reset</button></label> })}
        {draft && <button type="button" aria-pressed={compareSaved} onClick={() => setCompareSaved(!compareSaved)}>{compareSaved ? 'Show proposed appearance' : 'Show saved appearance'}</button>}
        <div className="flex gap-3"><button disabled={!draft || busy} onClick={() => draft && void save(draft,base.current,false)}>Apply</button><button disabled={!draft || busy} onClick={() => { preview(null); report('Preview discarded.') }}>Discard</button><button disabled={!undo || !!draft || busy || !same(saved,undo.after)} onClick={() => undo && void save(undo.before,undo.after,true)}>Undo</button></div><small role="status">{status}</small>
    </aside>}</>
}
