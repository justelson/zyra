import { GitBranch } from 'lucide-react'

export function NewChatGitDrawer({ branch, selected, onChange }: { branch: string; selected: boolean; onChange: (value: boolean) => void }) {
    return <div data-new-chat-git-drawer className="pointer-events-auto absolute inset-x-4 top-full z-20 -mt-4 rounded-b-xl border border-t-0 border-[var(--surface-divider)] bg-[var(--surface-floating)] pt-4">
        <div className="flex h-8 items-center gap-2 px-3 text-[11px] text-sparkle-text-muted">
            <GitBranch size={12} />
            <span className="min-w-0 flex-1 truncate" title={branch}>{branch || 'Current branch'}</span>
            <label className="flex h-8 shrink-0 cursor-pointer items-center gap-2" title="Start in a new worktree">
                <span>New worktree</span>
                <input type="checkbox" aria-label="Start in a new worktree" checked={selected} onChange={event => onChange(event.target.checked)} className="size-3.5 cursor-pointer accent-[var(--accent-primary)]" />
            </label>
        </div>
    </div>
}
