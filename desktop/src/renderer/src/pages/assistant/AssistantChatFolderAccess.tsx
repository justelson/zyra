import { useState } from 'react'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { isAssistantSessionProjectLocked } from '@shared/assistant/session-project'
import { useAssistantProjectCatalog } from './useAssistantProjectCatalog'

export function AssistantChatFolderAccess({ sessionId }: { sessionId: string }) {
    const session = useAssistantStoreSelector(state => state.snapshot.sessions.find(entry => entry.id === sessionId))
    const { setSessionProjectResult } = useAssistantStoreActions()
    const { catalog, loading, error: catalogError } = useAssistantProjectCatalog()
    const [reviewing, setReviewing] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const scope = session?.chatScope
    if (!scope) return null
    const project = catalog.projects.find(entry => entry.id === scope.projectId)
    const changed = Boolean(project && project.revision !== scope.revision)
    const locked = busy || isAssistantSessionProjectLocked(session)
    const roots = reviewing && project
        ? [{ path: project.homePath, label: 'Project home', access: 'read-write' }, ...project.folders]
        : scope.roots
    const apply = async () => {
        if (!project || locked) return
        setBusy(true)
        setError(null)
        try {
            const currentRoots = [project.homePath, ...project.folders.map(folder => folder.path)]
            const workingRoot = currentRoots.includes(scope.workingRoot) ? scope.workingRoot : project.homePath
            const result = await setSessionProjectResult(sessionId, { projectId: project.id, workingRoot })
            if (!result.success) throw new Error(result.error || 'Could not apply folder changes.')
            setReviewing(false)
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not apply folder changes.') }
        finally { setBusy(false) }
    }
    return <section className="space-y-2 border-t border-white/5 pt-3 text-xs" aria-label="Folder access">
        <div className="font-medium text-sparkle-text">Folder access</div>
        <p className="text-sparkle-text-secondary">{reviewing ? 'Review the folders this chat will use.' : 'Full access changes approvals, not these folder limits.'}</p>
        <ul className="space-y-1.5">
            {roots.map(root => <li key={root.path} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sparkle-text-secondary" title={root.path}>{root.path}</span>
                <span className="shrink-0 text-sparkle-text-muted">{root.access === 'read-only' ? 'Read only' : 'Read & write'}</span>
            </li>)}
        </ul>
        {changed && !loading && <div className="flex items-center gap-2">
            <button type="button" disabled={locked} onClick={() => reviewing ? void apply() : setReviewing(true)} className="rounded-md bg-white/[0.05] px-2 py-1.5 text-sparkle-text transition-colors hover:bg-white/[0.08] disabled:opacity-50">
                {busy ? 'Applying...' : reviewing ? 'Apply folder changes' : 'Review folder changes'}
            </button>
            {reviewing && <button type="button" disabled={busy} onClick={() => setReviewing(false)} className="text-sparkle-text-secondary">Cancel</button>}
        </div>}
        {changed && locked && !busy && <p className="text-sparkle-text-muted">Finish or stop the current work before applying changes.</p>}
        {!changed && <p className="text-sparkle-text-muted">Add folders in Settings &gt; Projects.</p>}
        {(error || catalogError) && <p role="alert" className="text-red-400">{error || catalogError}</p>}
    </section>
}
