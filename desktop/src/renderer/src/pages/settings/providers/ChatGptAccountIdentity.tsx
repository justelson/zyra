import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Pencil, X } from 'lucide-react'
import type { ChatGptAccountProfile } from '@shared/onboarding/contracts'
import { accountLabel } from './chatgpt-account-presentation'

export function ChatGptAccountIdentity({ account, onRename, disabled = false }: {
    account: ChatGptAccountProfile
    onRename: (alias: string) => Promise<boolean>
    disabled?: boolean
}) {
    const label = accountLabel(account)
    const host = useRef<HTMLSpanElement>(null)
    const input = useRef<HTMLInputElement>(null)
    const saving = useRef(false)
    const [revealed, setRevealed] = useState(false)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(label)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => { setRevealed(false); setEditing(false); setError('') }, [account.id, account.email])
    useEffect(() => {
        if (!revealed) return
        const document = host.current?.ownerDocument || window.document
        const owner = document.defaultView || window
        const hide = () => setRevealed(false)
        const visibility = () => { if (document.visibilityState === 'hidden') hide() }
        const timer = window.setTimeout(hide, 20_000)
        owner.addEventListener('blur', hide)
        if (owner !== window) window.addEventListener('blur', hide)
        document.addEventListener('visibilitychange', visibility)
        return () => {
            window.clearTimeout(timer)
            owner.removeEventListener('blur', hide)
            if (owner !== window) window.removeEventListener('blur', hide)
            document.removeEventListener('visibilitychange', visibility)
        }
    }, [revealed])
    useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])
    const save = async () => {
        if (saving.current || disabled) return
        if (!draft.trim() || draft.trim().length > 40) { setError('Use 1 to 40 characters.'); return }
        saving.current = true
        setBusy(true)
        setError('')
        try {
            if (await onRename(draft.trim())) setEditing(false)
            else setError('Could not save account name.')
        } catch { setError('Could not save account name.') }
        finally { saving.current = false; setBusy(false) }
    }
    return <span ref={host} data-account-identity={account.id} className="inline-flex max-w-full min-w-0 flex-col align-middle" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <span className="inline-flex min-w-0 items-center gap-1">
            {editing ? <>
                <input ref={input} aria-label={`Account name for ${label}`} value={draft} maxLength={40} disabled={busy} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } else if (event.key === 'Escape' && !busy) { event.preventDefault(); setEditing(false); setError('') } }} className="h-6 min-w-0 flex-1 rounded border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-1.5 text-[11px] font-normal text-sparkle-text outline-none focus:border-[var(--accent-primary)]" />
                <button type="button" aria-label="Save account name" disabled={busy || disabled} onClick={() => void save()} className="grid size-6 shrink-0 place-items-center rounded text-[var(--accent-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}</button>
                <button type="button" aria-label="Cancel account rename" disabled={busy} onClick={() => { setEditing(false); setError('') }} className="grid size-6 shrink-0 place-items-center rounded text-sparkle-text-muted hover:bg-[var(--surface-hover)]"><X size={12} /></button>
            </> : <>
                <button type="button" disabled={!account.email} aria-label={`${revealed ? 'Hide' : 'Show'} email for ${label}`} aria-pressed={revealed} title={account.email ? revealed ? 'Hide email' : 'Show email' : 'Email unavailable'} onClick={() => setRevealed(current => !current)} className="inline-flex min-w-0 items-center rounded-sm text-left hover:text-[var(--accent-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] disabled:cursor-default"><span className="min-w-0 truncate">{revealed ? account.email : label}</span></button>
                <button type="button" aria-label={`Rename ${label}`} title="Rename account" disabled={disabled} onClick={() => { setDraft(label); setError(''); setRevealed(false); setEditing(true) }} className="grid size-6 shrink-0 place-items-center rounded text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:opacity-40"><Pencil size={11} /></button>
            </>}
        </span>
        {error && <span role="alert" className="mt-1 text-[10px] font-normal text-[var(--status-danger)]">{error}</span>}
    </span>
}
