import { execFile } from 'node:child_process'
import { realpath, mkdir } from 'node:fs/promises'
import { dirname, join, basename, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatWorkspaceChoice, DeveloperWorktree } from '../../shared/contracts/developer-workflow'
import type { AssistantChatScope } from '../../shared/assistant/contracts/project'

export function scopeChatWorktree(scope: AssistantChatScope, expectedRoot: string): AssistantChatScope {
    const key = (value: string) => { const normalized = value.replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? normalized.toLowerCase() : normalized }
    if (key(scope.workingRoot) !== key(expectedRoot) || !scope.roots.some(root => key(root.path) === key(expectedRoot) && root.access === 'read-write')) throw new Error('The selected worktree is unavailable; the chat was not created.')
    return { ...scope, roots: scope.roots.map(root => ({ ...root, access: key(root.path) === key(expectedRoot) ? 'read-write' : 'read-only' })) }
}

export async function developerGit(root: string, args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = execFile('git', ['-C', root, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout))
        child.stdin?.end(input)
    })
}
export async function hasProtectedWorktreeIndex(root: string): Promise<boolean> {
    const indexed = await developerGit(root, ['ls-files', '-v', '-z'])
    return indexed.split('\0').some(entry => entry && !entry.startsWith('H '))
}
export async function listDeveloperWorktrees(root: string): Promise<DeveloperWorktree[]> {
    const raw = await developerGit(root, ['worktree', 'list', '--porcelain', '-z'])
    return raw.split('\0\0').flatMap(record => {
        const fields = record.split('\0'), path = fields.find(field => field.startsWith('worktree '))?.slice(9)
        return path ? [{ path, branch: fields.find(field => field.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') || '(detached)', head: fields.find(field => field.startsWith('HEAD '))?.slice(5) || '', locked: fields.some(field => field.startsWith('locked')) }] : []
    })
}
export async function resolveChatWorktree(root: string, choice: ChatWorkspaceChoice): Promise<string> {
    return (await prepareChatWorktree(root, choice)).path
}

export async function prepareChatWorktree(root: string, choice: ChatWorkspaceChoice): Promise<{ path: string; rollback?: () => Promise<void> }> {
    if (!isAbsolute(root)) throw new Error('Choose an absolute project folder.')
    const canonical = await realpath(root)
    if (choice.kind === 'existing-worktree') {
        const target = await realpath(choice.path)
        const trees = await listDeveloperWorktrees(canonical)
        for (const tree of trees) if (!tree.locked && await realpath(tree.path) === target) return { path: target }
        throw new Error('Choose an unlocked worktree belonging to this repository.')
    }
    if (choice.kind !== 'new-worktree') throw new Error('Invalid workspace choice.')
    const id = randomUUID().slice(0, 12)
    const branch = choice.branch?.trim() || `zyra/chat-${id}`
    if (branch.startsWith('-') || branch.length > 150) throw new Error('Invalid branch name.')
    await developerGit(canonical, ['check-ref-format', '--branch', branch])
    const gitRoot = (await developerGit(canonical, ['rev-parse', '--show-toplevel'])).trim()
    // A sibling keeps the main tree clean and lets users inspect retained worktrees.
    const directory = join(dirname(gitRoot), '.zyra-worktrees', `${basename(gitRoot)}-${id}`)
    const createdHead = (await developerGit(canonical, ['rev-parse', 'HEAD'])).trim()
    await mkdir(dirname(directory), { recursive: true })
    await developerGit(canonical, ['worktree', 'add', '-b', branch, '--', directory, createdHead])
    return { path: directory, rollback: async () => {
        const tree = (await listDeveloperWorktrees(canonical)).find(tree => tree.path.replace(/\\/g, '/') === directory.replace(/\\/g, '/'))
        if (!tree || tree.locked || tree.branch !== branch || tree.head !== createdHead) throw new Error('The new worktree changed and was retained after chat creation failed.')
        // Status omits assume-unchanged and skip-worktree entries. Only normal
        // cached entries (H) are eligible for cleanup; retain every other state.
        if (await hasProtectedWorktreeIndex(directory)) throw new Error('The new worktree has protected index entries and was retained after chat creation failed.')
        // Unforced worktree removal can still delete ignored files. Preserve all
        // tracked, untracked and ignored additions before requesting any removal.
        if (await developerGit(directory, ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '-z', '--untracked-files=all', '--ignored'])) throw new Error('The new worktree contains files or edits and was retained after chat creation failed.')
        // Never force removal or branch deletion.
        await developerGit(canonical, ['worktree', 'remove', '--', directory])
        await developerGit(canonical, ['branch', '-d', '--', branch])
    } }
}
