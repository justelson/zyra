import type { AssistantChatScope, AssistantProject } from '../../shared/assistant/contracts'

export const forkWorkspacePathKey = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Owns only an unpublished preparation. The worktree owner supplies its safe,
 * unforced rollback; a refusal must also retain its Project association. */
export async function prepareAgentForkWorkspace(deps: {
    prepare: () => Promise<{ path: string; rollback?: () => Promise<void> }>
    project: () => Promise<AssistantProject>
    associate: (path: string) => Promise<AssistantProject>
    remove: (folderId: string) => Promise<unknown>
    scope: (path: string) => Promise<AssistantChatScope>
    referenced: (path: string) => Promise<boolean>
    ready?: (rollback: () => Promise<void>) => void
}): Promise<AssistantChatScope> {
    const workspace = await deps.prepare()
    let before: AssistantProject | undefined
    let consumed = false
    const rollback = async () => {
        if (consumed) throw new Error('Fork workspace cleanup was already attempted; inspect retained state.')
        consumed = true
        if (!workspace.rollback) return // Existing/user-owned worktrees have no cleanup authority.
        if (before?.folders.some(folder => forkWorkspacePathKey(folder.path) === forkWorkspacePathKey(workspace.path))) throw new Error('The fork workspace was already associated and was retained.')
        if (await deps.referenced(workspace.path)) throw new Error('The fork workspace is referenced by saved history and was retained.')
        const current = before ? await deps.project() : undefined
        const introduced = current?.folders.find(folder => forkWorkspacePathKey(folder.path) === forkWorkspacePathKey(workspace.path))
        await workspace.rollback()
        if (introduced) await deps.remove(introduced.folderId)
    }
    try {
        before = structuredClone(await deps.project())
        await deps.associate(workspace.path)
        const scope = await deps.scope(workspace.path)
        deps.ready?.(rollback)
        return scope
    } catch (error) {
        try { await rollback() }
        catch (cleanup) {
            throw new Error(`${error instanceof Error ? error.message : 'Fork preparation failed.'} Cleanup could not be confirmed: ${cleanup instanceof Error ? cleanup.message : 'inspect the retained workspace.'}`)
        }
        throw error
    }
}
