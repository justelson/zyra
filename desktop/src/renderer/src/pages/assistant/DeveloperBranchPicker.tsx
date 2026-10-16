import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GitBranch, Search } from 'lucide-react'
import type { DevScopeGitBranchSummary } from '@shared/contracts/devscope-git-contracts'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'

export function DeveloperBranchPicker({ root, current, busy, run }: {
    root: string
    current: string
    busy: boolean
    run: (action: () => Promise<void>) => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    const [branches, setBranches] = useState<DevScopeGitBranchSummary[]>([])
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const search = useRef<HTMLInputElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true); setError('')
        void window.devscope.listBranches(root).then(result => {
            if (cancelled) return
            if (!result.success) { setError(result.error); return }
            setBranches(result.branches.filter(branch => !branch.isRemote || branch.isLocal))
        }).catch(reason => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load branches.')
        }).finally(() => { if (!cancelled) setLoading(false) })
        search.current?.focus()
        return () => { cancelled = true }
    }, [open, root])
    const filtered = branches.filter(branch => branch.name.toLowerCase().includes(query.toLowerCase()))
        .sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name))
    const select = (name: string) => void run(async () => {
        const result = await window.devscope.checkoutBranch(root, name, { autoStash: false, autoCleanupLock: false })
        if (!result.success) throw new Error(result.error)
        setOpen(false); setQuery('')
        window.dispatchEvent(new CustomEvent('zyra:developer-workspace-changed'))
    })
    return <div className="mt-auto shrink-0 border-t border-[var(--surface-divider)] pt-1">
        <button ref={trigger} type="button" role="menuitem" aria-label="Choose branch" aria-expanded={open} disabled={busy} onClick={() => { setOpen(value => !value); setQuery('') }} className="flex h-8 w-full items-center gap-2 rounded-md bg-[var(--surface-hover)] px-2 text-left text-xs font-medium">
            <GitBranch size={13} className="shrink-0 text-sparkle-text-muted" /><span className="min-w-0 flex-1 truncate">{current}</span><ChevronDown size={12} className={`text-sparkle-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <AnchoredMenuPopover anchorRef={trigger} label="Choose a local branch" autoFocus onClose={() => setOpen(false)}>
            <div className="mb-1 flex items-center gap-2 border-b border-[var(--surface-divider)] px-2 py-2 text-sparkle-text-muted"><Search size={13} /><input ref={search} aria-label="Search branches" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search branches..." className="min-w-0 flex-1 bg-transparent text-xs text-sparkle-text outline-none" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }} /></div>
            <div role="menu" aria-label="Local branches" className="custom-scrollbar max-h-44 overflow-y-auto">
                {loading ? <p role="status" className="px-2 py-2 text-xs text-sparkle-text-muted">Loading branches...</p> : error ? <p role="alert" className="px-2 py-2 text-xs text-red-400">{error}</p> : filtered.length === 0 ? <p className="px-2 py-2 text-xs text-sparkle-text-muted">No matching branches</p> : filtered.map(branch => <button key={branch.name} type="button" role="menuitemradio" aria-checked={branch.current} disabled={busy || branch.current} title={branch.name} onClick={() => select(branch.name)} className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs disabled:cursor-default ${branch.current ? 'bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-sparkle-text' : 'text-sparkle-text-secondary hover:bg-[var(--surface-hover)]'}`}><span className="min-w-0 flex-1 truncate">{branch.name}</span>{branch.current && <span className="text-[10px] text-sparkle-text-muted">current</span>}</button>)}
            </div>
        </AnchoredMenuPopover>}
    </div>
}
