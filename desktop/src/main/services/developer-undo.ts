import { randomUUID, createHash } from 'node:crypto'
import { readFile, realpath, lstat } from 'node:fs/promises'
import { resolve, relative, dirname, isAbsolute } from 'node:path'
import { developerGit } from './developer-worktrees'

type UndoPlan = { token: string; root: string; patch: string; paths: string[]; fingerprints: string[]; expiresAt: number }
const plans = new Map<string, UndoPlan>()
function inside(root: string, path: string) { const value = relative(root, path); return value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(value) }
async function fingerprint(root: string, path: string): Promise<string> {
    const full = resolve(root, path)
    if (!inside(root, full) || !inside(root, await realpath(dirname(full)))) throw new Error('Restore path leaves the repository.')
    const metadata = await lstat(full).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!metadata) return 'missing'
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) throw new Error('Restore supports regular text files up to 8 MB.')
    return createHash('sha256').update(String(metadata.mode)).update(await readFile(full)).digest('hex')
}
export async function previewRecordedUndo(path: string, patch: string): Promise<{ token: string; paths: string[] }> {
    if (!patch?.trim() || patch.length > 1024 * 1024 || /^(?:GIT binary patch|Binary files|rename (?:from|to)|copy (?:from|to)|(?:old|new) mode)/m.test(patch)) throw new Error('This change cannot be safely restored from its recorded text patch.')
    const root = await realpath((await developerGit(path, ['rev-parse', '--show-toplevel'])).trim())
    const workspace = await realpath(path)
    const stats = await developerGit(root, ['apply', '--numstat', '-z', '-'], patch)
    const paths = [...new Set(stats.split('\0').filter(Boolean).map(entry => entry.split('\t').slice(2).join('\t')))]
    if (!paths.length || paths.length > 20 || paths.some(file => !file || !inside(workspace, resolve(root, file)))) throw new Error('Restore must stay inside the chat working folder.')
    if (paths.length !== 1) throw new Error('Restore one recorded file edit at a time.')
    const fingerprints = await Promise.all(paths.map(file => fingerprint(root, file)))
    await developerGit(root, ['apply', '--reverse', '--check', '--whitespace=nowarn', '-'], patch)
    const now = Date.now()
    for (const [key, plan] of plans) if (plan.expiresAt <= now) plans.delete(key)
    while (plans.size >= 20) plans.delete(plans.keys().next().value!)
    const token = randomUUID()
    plans.set(token, { token, root, patch, paths, fingerprints, expiresAt: now + 120_000 })
    return { token, paths }
}
export async function applyRecordedUndo(token: string): Promise<void> {
    const plan = plans.get(token)
    plans.delete(token)
    if (!plan || plan.expiresAt < Date.now()) throw new Error('Restore preview expired. Review the change again.')
    const current = await Promise.all(plan.paths.map(file => fingerprint(plan.root, file)))
    if (current.some((value, index) => value !== plan.fingerprints[index])) throw new Error('A file changed after the restore preview. Review it again.')
    // Git checks every hunk; without --reject a conflict prevents applying the patch.
    // Worktree only: staging, commits and unrelated files remain untouched.
    await developerGit(plan.root, ['apply', '--reverse', '--whitespace=nowarn', '-'], plan.patch)
}
