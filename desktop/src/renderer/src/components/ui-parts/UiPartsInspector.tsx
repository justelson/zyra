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
    const [browse, setBrowse] = useState(false)
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
        select(next); setBrowse(false); search('')
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
    const field = 'min-w-0 w-full h-8 rounded-md border border-[var(--surface-divider)] bg-[var(--surface-bg,var(--settings-control))] px-2 text-xs text-sparkle-text focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]'
    const button = 'rounded-md border border-[var(--surface-divider)] px-2.5 py-1.5 text-xs hover:bg-[var(--settings-control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:opacity-40'
    const results=UI_PARTS.filter(p=>`${p.id} ${p.label}`.toLowerCase().includes(query.toLowerCase()))
    return <><style>{rowStyle(compareSaved ? saved : draft ?? saved, settings.accessibilityReduceMotion)}</style>{open && <aside data-ui-inspector aria-label="Interface inspector" className="fixed bottom-3 right-3 z-50 flex max-h-[82dvh] w-[23rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] text-sm text-sparkle-text shadow-2xl">
        <style>{'[data-zyra-inspected]{outline:2px solid var(--accent-primary)!important;outline-offset:-2px}'}</style>
        <header className="flex items-center justify-between border-b border-[var(--surface-divider)] px-4 py-3"><strong>Interface inspector</strong><button className={button} onClick={close}>Close</button></header>
        <div className="grid min-h-0 gap-3 overflow-y-auto px-4 py-3"><div className="flex gap-2"><input ref={searchRef} className={field} aria-label="Find an interface part" placeholder="Find a part…" value={query} onClick={()=>setBrowse(true)} onChange={e=>{search(e.target.value);setBrowse(true)}} /><button className={button+' shrink-0'} aria-pressed={pick} onClick={()=>{setBrowse(false);picking(!pick)}}>{pick?'Cancel pick':'Pick on screen'}</button></div>
        {browse && <div aria-label="Parts" className="grid max-h-32 overflow-y-auto rounded-md border border-[var(--surface-divider)] p-1">{results.map(p=><button className="break-words rounded px-2 py-1 text-left text-xs hover:bg-[var(--settings-control-hover)]" key={p.id} aria-pressed={id===p.id} onClick={()=>locate(p.id)}>{p.label}</button>)}{!results.length && <small>No matching parts</small>}</div>}
        <div><h3 className="text-base font-semibold">{part.label}</h3><code className="break-all text-xs text-sparkle-text-secondary">{id}</code></div>
        <div className="flex gap-2"><button className={button} onClick={()=>locate(id,-1)}>Previous instance</button><button className={button} onClick={()=>locate(id,1)}>Next instance</button></div>
        {part.protection!=='normal' && <p className="text-xs">Read only · {part.protection}</p>}
        <div className="divide-y divide-[var(--surface-divider)]">{Object.entries(part.properties).map(([key,spec])=>{const value=(draft??saved).overrides[id]?.[key]??spec.default;return <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,7rem)_auto] items-center gap-2 py-2"><label htmlFor={'ui-edit-'+key} className="capitalize">{key}</label>{spec.type==='enum'?<select id={'ui-edit-'+key} className={field} value={value} onChange={e=>stage(key,e.target.value)}>{spec.values?.map(v=><option key={v}>{v}</option>)}</select>:<div className="relative">{spec.type==='color' && value==='theme' && <span aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center rounded-md border border-[var(--surface-divider)] bg-[var(--settings-control)] px-2 text-xs">Theme</span>}<input id={'ui-edit-'+key} className={field} aria-label={key} type={spec.type==='number'?'number':'color'} min={spec.min} max={spec.max} placeholder="Theme" title={value==='theme'?'Theme default':String(value)} value={value==='theme'?(spec.type==='color'?'#000000':''):value} onChange={e=>stage(key,spec.type==='number'?e.target.value===''?spec.default:Number(e.target.value):e.target.value)} /></div>}<button className={button} disabled={value===spec.default} onClick={()=>stage(key,spec.default)}>Reset</button></div>})}</div>
        {!!part.states.length && <details className="text-xs text-sparkle-text-secondary"><summary>Supported states</summary><p className="py-2">{part.states.join(', ')}</p></details>}
        {draft && <button className={button} aria-pressed={compareSaved} onClick={()=>setCompareSaved(!compareSaved)}>{compareSaved?'Show proposed appearance':'Show saved appearance'}</button>}</div>
        <footer className="border-t border-[var(--surface-divider)] px-4 py-3"><div className="flex gap-2"><button className={button+' mr-auto'} disabled={!undo||!!draft||busy||!same(saved,undo.after)} onClick={()=>undo&&void save(undo.before,undo.after,true)}>Undo</button><button className={button} disabled={!draft||busy} onClick={()=>{preview(null);report('Preview discarded.')}}>Discard</button><button className="rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-40" disabled={!draft||busy} onClick={()=>draft&&void save(draft,base.current,false)}>Apply</button></div><small className={status?'mt-2 block text-xs text-sparkle-text-secondary':'sr-only'} role="status">{status}</small></footer>
    </aside>}</>
}
