import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, GitCommitHorizontal, GitPullRequest, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import type { DeveloperWorkspace } from '@shared/contracts/developer-workflow'
import type { DevScopeGitStatusDetail } from '@shared/contracts/devscope-git-contracts'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import PatchDiffViewer from '@/components/ui/diff-viewer/PatchDiffViewer'
import { parsePatchForRendering } from '@/lib/diffRendering'
import { openDesktopLink } from '@/lib/desktop-links'
import { useSettings } from '@/lib/settings'
import { DeveloperChangeFileRow } from './DeveloperChangeFileRow'
import { NO_DEVELOPER_ACTIONS, type DeveloperActionRunner } from './useDeveloperActions'
import { getProjectPullRequestConfig } from '@/lib/pullRequestWorkflow'

export function DeveloperChanges({ workspace, pending = NO_DEVELOPER_ACTIONS, run }: { workspace: DeveloperWorkspace; pending?: ReadonlySet<string>; run: DeveloperActionRunner }) {
    const { settings } = useSettings()
    const [entries, setEntries] = useState<DevScopeGitStatusDetail[]>([])
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState('')
    const [filter, setFilter] = useState('')
    const [scope, setScope] = useState<'all' | 'staged' | 'unstaged'>('all')
    const [diff, setDiff] = useState<{ name: string; patch: string } | null>(null)
    const [confirmation, setConfirmation] = useState<{ kind: 'commit' | 'pr'; diff: string; paths: string[] } | null>(null)
    const request = useRef(0)
    const root = workspace.gitRoot
    useEffect(() => {
        const token = ++request.current
        if (!root) return
        setLoading(true)
        void window.devscope.getGitStatusDetailed(root, { includeStats: false }).then(result => {
            if (token !== request.current) return
            if (result.success) { setEntries(result.entries); setError('') } else setError(result.error)
        }).catch(reason => { if (token === request.current) setError(String(reason.message || reason)) }).finally(() => { if (token === request.current) setLoading(false) })
        return () => { request.current++ }
    }, [root, workspace])
    if (!root) return <p className="text-xs text-sparkle-text-muted">This folder is not a Git repository.</p>
    const staged = entries.filter(entry => entry.staged)
    const latestChecks = workspace.tasks.reduce((map, task) => {
        const prior = map.get(task.name)
        if (!prior || task.startedAt >= prior.startedAt) map.set(task.name, task)
        return map
    }, new Map<string, DeveloperWorkspace['tasks'][number]>())
    const checks = [...latestChecks.values()].filter(task => /(?:test|check|lint|build|spec)/i.test(task.name))
    const prepare = (kind: 'commit' | 'pr') => void run(async () => {
        if (!message.trim() || !staged.length) throw new Error('Stage files and enter a commit message first.')
        const status = await window.devscope.getGitStatusDetailed(root, { includeStats: false })
        if (!status.success) throw new Error(status.error)
        const paths = status.entries.filter(entry => entry.staged).map(entry => entry.path)
        if (!paths.length) throw new Error('The staged files changed. Stage files before reviewing.')
        const result = await window.devscope.getWorkingDiff(root, undefined, 'staged')
        if (!result.success) throw new Error(result.error)
        setConfirmation({ kind, diff: result.diff, paths })
    }, `git:write:review:${kind}`)
    const confirm = () => {
        const prepared = confirmation
        setConfirmation(null)
        if (!prepared) return
        void run(async () => {
            const current = await window.devscope.getWorkingDiff(root, undefined, 'staged')
            if (!current.success) throw new Error(current.error)
            if (current.diff !== prepared.diff) throw new Error('Staged changes changed. Review them again.')
            if (prepared.kind === 'commit') {
                const result = await window.devscope.createCommit(root, message.trim())
                if (!result.success) throw new Error(result.error)
            } else {
                const config = getProjectPullRequestConfig(settings, workspace.root)
                const result = await window.devscope.commitPushAndCreatePullRequest(root, { commitMessage: message.trim(), targetBranch: config.targetBranch, draft: config.draft })
                if (!result.success) throw new Error(result.error)
                await openDesktopLink(result.pullRequest.url)
            }
            setMessage('')
        }, `git:write:${prepared.kind}`)
    }
    const parsed = diff ? parsePatchForRendering(diff.patch, `developer:${diff.name}:${diff.patch}`) : null
    const visible = entries.filter(entry => entry.path.toLowerCase().includes(filter.toLowerCase()) && (scope === 'all' || (scope === 'staged' ? entry.staged : entry.unstaged || !entry.staged)))
        .sort((a, b) => Number(b.staged) - Number(a.staged) || a.path.localeCompare(b.path))
    const reviewingCommit = pending.has('git:write:review:commit') || pending.has('git:write:commit')
    const reviewingPr = pending.has('git:write:review:pr') || pending.has('git:write:pr')
    const hasFilter = !!filter.trim()
    const clean = !entries.length
    const emptyTitle = clean ? 'Working tree clean' : hasFilter ? 'No matching files' : scope === 'staged' ? 'Nothing staged yet' : 'No unstaged files'
    const emptyAction = hasFilter && !clean ? 'Clear search' : !clean ? scope === 'staged' ? 'View unstaged files' : 'View staged files' : null
    return <div className="space-y-2.5 text-xs">
        {error && <p role="alert" className="text-rose-400">{error}</p>}
        {diff ? <>
            <button type="button" className="inline-flex max-w-full items-center gap-1.5 text-sparkle-text-muted" onClick={() => setDiff(null)}><ArrowLeft size={12} /><span className="truncate">{diff.name}</span></button>
            <div className="h-44 overflow-hidden rounded-lg border border-[var(--surface-divider)]">{parsed?.files.length ? <PatchDiffViewer fileDiffs={parsed.files} mode="stacked" flush workspaceRoot={root} /> : <pre className="h-full overflow-auto whitespace-pre-wrap p-2.5">{diff.patch || 'No text diff.'}</pre>}</div>
        </> : <>
            <label className="flex h-8 items-center gap-2 border-b border-[var(--surface-divider)] px-1 text-sparkle-text-muted"><Search size={13} /><input aria-label="Filter changed files" placeholder="Find a file…" value={filter} onChange={event => setFilter(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-sparkle-text outline-none" /></label>
            <div className="flex gap-1" role="group" aria-label="Changed file scope">{(['all', 'staged', 'unstaged'] as const).map(value => <button type="button" key={value} aria-pressed={scope === value} onClick={() => setScope(value)} className={`rounded-md px-2 py-1 text-[10px] ${scope === value ? 'bg-[var(--surface-hover)] text-sparkle-text' : 'text-sparkle-text-muted hover:text-sparkle-text'}`}>{value === 'all' ? 'All' : value === 'staged' ? 'Staged' : 'Unstaged'} <span className="ml-1 opacity-60">{value === 'all' ? entries.length : value === 'staged' ? staged.length : entries.filter(entry => entry.unstaged || !entry.staged).length}</span></button>)}</div>
            <div>{visible.map(entry => <DeveloperChangeFileRow key={entry.path} entry={entry} action={scope === 'unstaged' ? 'stage' : entry.staged ? 'unstage' : 'stage'} opening={pending.has(`git:diff:${entry.path}`)} staging={pending.has(`git:write:stage:${entry.path}`)} onOpen={() => void run(async () => {
                const result = await window.devscope.getWorkingDiff(root, entry.path, scope === 'all' ? 'combined' : scope)
                if (!result.success) throw new Error(result.error)
                setDiff({ name: entry.path, patch: result.diff })
            }, `git:diff:${entry.path}`)} onStage={(action) => void run(async () => {
                const result = action === 'unstage' ? await window.devscope.unstageFiles(root, [entry.path], { scope: 'repo' }) : await window.devscope.stageFiles(root, [entry.path], { scope: 'repo' })
                if (!result.success) throw new Error(result.error)
            }, `git:write:stage:${entry.path}`)} />)}
                {!visible.length && (loading ? <p role="status" className="px-1 py-3 text-sparkle-text-muted">Loading changes...</p> : !error && <div className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 py-3">
                    <div role="status" className="flex items-center gap-1.5 text-[11px] text-sparkle-text-secondary">{clean ? <Check size={14} className="text-emerald-400/70" /> : hasFilter ? <Search size={14} className="text-sparkle-text-muted" /> : <GitCommitHorizontal size={14} className="text-sparkle-text-muted" />}<span>{emptyTitle}</span></div>
                    {emptyAction && <button type="button" onClick={() => hasFilter ? setFilter('') : setScope(scope === 'staged' ? 'unstaged' : 'staged')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text">{emptyAction}<ArrowRight size={11} /></button>}
                </div>)}
            </div>
        </>}
        <details className="border-t border-[var(--surface-divider)] pt-1.5">
            <summary className="flex cursor-pointer items-center gap-1.5 py-1 text-[10px] text-sparkle-text-muted"><ShieldCheck size={12} /><span className="flex-1">Checks</span><span>{checks.length || 'Not run'}</span><ChevronDown size={11} /></summary>
            {checks.length > 0 && <div className="flex flex-wrap gap-1.5 py-1">{checks.map(task => <span key={task.id} title={`${task.command} · ${task.root}`} className={`rounded-md border border-[var(--surface-divider)] px-1.5 py-1 text-[10px] ${task.state === 'passed' && !task.stale ? 'text-emerald-400' : task.state === 'failed' && !task.stale ? 'text-rose-400' : 'text-sparkle-text-muted'}`}>{task.name}: {task.stale ? 'stale' : task.state}</span>)}</div>}
        </details>
        <div className="space-y-1.5 border-t border-[var(--surface-divider)] pt-2">
            <input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)} className="h-8 w-full rounded-md border border-[var(--surface-divider)] bg-transparent px-2 text-[11px] outline-none focus:border-[var(--accent-primary)]" />
            <div className="flex gap-1.5">
                <button type="button" aria-busy={reviewingCommit} disabled={reviewingCommit || reviewingPr || !staged.length || !message.trim()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--surface-divider)] px-2 py-1.5 text-[10px] hover:bg-[var(--surface-hover)] disabled:opacity-40" onClick={() => prepare('commit')}>{reviewingCommit ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}Review commit</button>
                <button type="button" aria-busy={reviewingPr} disabled={reviewingCommit || reviewingPr || !staged.length || !message.trim()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--surface-divider)] px-2 py-1.5 text-[10px] hover:bg-[var(--surface-hover)] disabled:opacity-40" onClick={() => prepare('pr')}>{reviewingPr ? <LoaderCircle size={12} className="animate-spin" /> : <GitPullRequest size={12} />}Review commit & PR</button>
            </div>
        </div>
        <ConfirmModal isOpen={!!confirmation} title={confirmation?.kind === 'pr' ? 'Commit, push & open PR?' : 'Commit staged changes?'} message={`${message}\n\n${root}\n\n${confirmation?.paths.join('\n') || ''}`} confirmLabel={confirmation?.kind === 'pr' ? 'Commit, push & open PR' : 'Commit'} variant="info" visual={<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px]">{confirmation?.diff}</pre>} onConfirm={confirm} onCancel={() => setConfirmation(null)} />
    </div>
}
