import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import type { AssistantDiffTarget } from './assistant-diff-types'

export function RecordedChangeUndo({ target, root, disabled }: { target: AssistantDiffTarget; root?: string; disabled?: boolean }) {
    const [plan, setPlan] = useState<{ token: string; paths: string[] } | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [restored, setRestored] = useState(false)
    if (!root || target.provisional !== false || target.truncated || target.unavailableReason) return null
    const preview = async () => {
        setBusy(true); setError('')
        try {
            const result = await window.devscope.previewRecordedUndo(root, target.patch)
            if (!result.success) throw new Error(result.error)
            setPlan({ token: result.token, paths: result.paths })
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Restore unavailable.') }
        finally { setBusy(false) }
    }
    const restore = async () => {
        const token = plan?.token
        setPlan(null)
        if (!token || disabled) return
        setBusy(true)
        try {
            const result = await window.devscope.applyRecordedUndo(token)
            if (!result.success) throw new Error(result.error)
            setRestored(true)
            window.dispatchEvent(new Event('zyra:developer-workspace-changed'))
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Restore failed.') }
        finally { setBusy(false) }
    }
    return <>
        <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-40" title={error || (disabled ? 'Wait for active work to finish.' : 'Restore this recorded edit, preserving other changes')} disabled={busy || disabled || restored} onClick={() => void preview()}><Undo2 size={11} />{restored ? 'Restored' : 'Undo edit'}</button>
        {error && <span role="alert" className="max-w-48 truncate text-[10px] text-red-400" title={error}>{error}</span>}
        <ConfirmModal isOpen={!!plan} title="Undo this agent edit?" message={`Reverse this recorded patch in:\n${plan?.paths.join('\n') || ''}\n\nUnrelated edits and staged changes are preserved. Conflicting edits block the restore.`} visual={<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px]">{target.patch}</pre>} confirmLabel="Undo edit" variant="warning" onCancel={() => setPlan(null)} onConfirm={() => void restore()} />
    </>
}
