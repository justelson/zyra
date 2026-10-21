import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import type { CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'
import { attachCodeSelection } from './selection-actions'

export function SelectionActionBar({ selection, onAttached, onDismiss }: { selection: CodeSelectionSnapshot; onAttached?: () => void; onDismiss?: () => void }) {
    const [error, setError] = useState('')
    const [pending, setPending] = useState(false)
    return <div role="toolbar" aria-label="Selected code actions" data-code-selection
        className="inline-flex w-max max-w-[calc(100vw-16px)] flex-nowrap items-center gap-2 whitespace-nowrap rounded-md border border-sparkle-border bg-[var(--surface-floating)] px-2 py-1 text-xs text-sparkle-text shadow-lg"
        style={{ width: 'max-content', maxWidth: 'calc(100vw - 16px)', whiteSpace: 'nowrap', flexWrap: 'nowrap' }}
        onPointerDown={event => { if (event.button === 0) event.preventDefault() }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss?.() } }}>
        <span className="shrink-0 text-sparkle-text-muted">{selection.side !== 'file' && selection.side ? `${selection.side} · ` : ''}Lines {selection.startLine}–{selection.endLine}</span>
        <button type="button" disabled={pending} className="inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-50"
            onClick={() => {
                setPending(true); setError('')
                void attachCodeSelection(selection).then(() => onAttached?.()).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not attach selection.')).finally(() => setPending(false))
            }}><MessageSquare size={12} className="shrink-0" />Ask Zyra</button>
        {error && <span role="alert" className="max-w-48 truncate text-red-400" title={error}>{error}</span>}
    </div>
}
