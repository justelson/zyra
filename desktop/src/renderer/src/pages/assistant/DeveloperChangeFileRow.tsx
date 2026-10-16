import { Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import type { DevScopeGitStatusDetail } from '@shared/contracts/devscope-git-contracts'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { useSettings } from '@/lib/settings'

export function DeveloperChangeFileRow({ entry, action, opening, staging, onOpen, onStage }: {
    entry: DevScopeGitStatusDetail; action: 'stage' | 'unstage'; opening: boolean; staging: boolean; onOpen: () => void; onStage: (action: 'stage' | 'unstage') => void
}) {
    const { settings } = useSettings()
    const unstage = action === 'unstage'
    const path = entry.path.replace(/\\/g, '/'), name = path.split('/').pop() || path
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const color = entry.status === 'deleted' ? 'text-rose-400' : entry.status === 'untracked' || entry.status === 'added' ? 'text-emerald-400' : 'text-amber-400'
    return <div className="flex min-h-10 items-center gap-2 border-b border-[var(--surface-divider)] last:border-b-0">
        <button type="button" disabled={opening} aria-label={`View changes for ${entry.path}`} aria-busy={opening} title={entry.path} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-[var(--surface-hover)]">
            {opening ? <LoaderCircle size={15} className="shrink-0 animate-spin text-sky-400" /> : <FileEntryIcon pathValue={entry.path} kind="file" theme={settings.appearanceResolvedMode} size={16} className="shrink-0" />}
            <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{name}</span>{directory && <span className="block truncate text-[10px] text-sparkle-text-muted">{directory}</span>}</span>
        </button>
        <span title={entry.status} className={`text-[10px] ${color}`}>{entry.status === 'untracked' ? 'New' : entry.status === 'modified' ? 'Edited' : entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}</span>
        <button type="button" disabled={staging} aria-busy={staging} title={unstage ? 'Unstage file' : 'Stage file'} aria-label={`${unstage ? 'Unstage' : 'Stage'} ${entry.path}`} onClick={() => onStage(action)} className={`group grid size-7 shrink-0 place-items-center rounded-md hover:bg-[var(--surface-hover)] ${unstage ? 'text-emerald-400' : 'text-sparkle-text-muted hover:text-sky-400'}`}>{staging ? <LoaderCircle size={13} className="animate-spin" /> : unstage ? <><Check size={13} className="group-hover:hidden" /><Minus size={13} className="hidden group-hover:block" /></> : <Plus size={13} />}</button>
    </div>
}
