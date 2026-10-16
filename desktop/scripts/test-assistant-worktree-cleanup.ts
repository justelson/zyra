import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { mock } from 'bun:test'
import { developerGit, listDeveloperWorktrees, resolveChatWorktree } from '../src/main/services/developer-worktrees'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'

const fixture = await mkdtemp(join(tmpdir(), 'zyra-chat-worktree-cleanup-'))
const noop = () => {}
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({
    app: { getPath: () => fixture, isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [] }, nativeImage: {}, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false },
    globalShortcut: { register: () => false, unregister: noop }, shell: {}, dialog: {}
}))
const { AssistantService } = await import('../src/main/assistant/service')
const root = join(fixture, 'repo')
try {
    await mkdir(root)
    for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Cleanup fixture'], ['config', 'user.email', 'cleanup@example.test']]) await developerGit(root, args)
    await writeFile(join(root, 'file.txt'), 'committed\n')
    await writeFile(join(root, '.gitignore'), '.env\n')
    await developerGit(root, ['add', '.'])
    await developerGit(root, ['commit', '-m', 'fixture'])
    await writeFile(join(root, 'file.txt'), 'user edit\n')
    for (const stage of ['scope', 'plugin', 'session', 'published', 'dirty', 'ignored', 'assume', 'skip', 'existing', 'success']) {
        const snapshot = createDefaultAssistantSnapshot()
        const folders: Array<{ folderId: string; path: string }> = []
        const service = Object.create(AssistantService.prototype) as any
        let selectedPath = '', removedScopes = 0
        const inputWorkspace = stage === 'existing'
            ? { kind: 'existing-worktree', path: await resolveChatWorktree(root, { kind: 'new-worktree', branch: 'fixture/existing' }) }
            : { kind: 'new-worktree', branch: `fixture/${stage}` }
        Object.assign(service, {
            state: { snapshot }, stopCanonicalVoiceForNavigation: async () => {}, captureAnalytics: noop,
            persistence: {
                associateProjectFolder: async ({ path }: { path: string }) => { selectedPath = path; folders.push({ folderId: stage, path }); return { folders } },
                removeProjectFolder: async ({ folderId }: { folderId: string }) => { assert.equal(folderId, stage); folders.splice(0) },
                createProjectChatScope: async () => {
                    if (stage === 'scope') throw Error('fixture failure')
                    return { projectId: 'project', workingRoot: selectedPath, roots: [{ path: selectedPath, access: 'read-write' }] }
                }
            },
            pluginRegistry: {
                createChatScope: async () => {},
                ensureAvailableChatScope: async () => {
                    if (stage === 'dirty') await writeFile(join(selectedPath, 'user.txt'), 'keep this edit')
                    if (stage === 'ignored') await writeFile(join(selectedPath, '.env'), 'fixture ignored content')
                    if (stage === 'assume' || stage === 'skip') {
                        await developerGit(selectedPath, ['update-index', stage === 'assume' ? '--assume-unchanged' : '--skip-worktree', '--', 'file.txt'])
                        await writeFile(join(selectedPath, 'file.txt'), 'hidden user edit\n')
                        assert.equal(await developerGit(selectedPath, ['status', '--porcelain', '-z', '--untracked-files=all', '--ignored']), '', 'Git status alone hides this tracked edit')
                    }
                    if (['plugin', 'dirty', 'ignored', 'assume', 'skip', 'existing'].includes(stage)) throw Error('fixture failure')
                },
                removeChatScope: async () => { removedScopes++ }
            },
            actionDeps: {
                ensureReady: async () => { if (stage === 'session') throw Error('fixture failure') },
                getSnapshot: () => snapshot, getNewChatExecutionDefaults: async () => ({}),
                getSessionRuntimeCwd: () => selectedPath, runtime: {},
                appendEvent: (type: string, _at: string, payload: any) => {
                    if (type === 'session.created') snapshot.sessions.push(payload.session)
                    if (stage === 'published') throw Error('fixture failure')
                }
            },
            appendEvent: noop
        })
        const creating = service.createSession({ projectId: 'project', projectPath: root, workspace: inputWorkspace })
        if (stage === 'success') await creating
        else await assert.rejects(creating, /fixture failure/)
        const retained = ['published', 'dirty', 'ignored', 'assume', 'skip', 'existing', 'success'].includes(stage)
        assert.equal((await listDeveloperWorktrees(root)).some(tree => tree.path.replace(/\\/g, '/') === selectedPath.replace(/\\/g, '/')), retained, `${stage}: only an owned unchanged pre-session tree is removed`)
        assert.equal(folders.length, retained ? 1 : 0, `${stage}: the folder association follows the retained tree`)
        assert.equal((await developerGit(root, ['branch', '--list', `fixture/${stage}`])).trim().length > 0, retained)
        if (stage === 'dirty') assert.equal(await readFile(join(selectedPath, 'user.txt'), 'utf8'), 'keep this edit')
        if (stage === 'ignored') assert.equal(await readFile(join(selectedPath, '.env'), 'utf8'), 'fixture ignored content')
        if (stage === 'assume' || stage === 'skip') assert.equal(await readFile(join(selectedPath, 'file.txt'), 'utf8'), 'hidden user edit\n')
        if (stage === 'published' || stage === 'success') assert.equal(removedScopes, 0, 'published sessions keep their plugin scope')
        if (!retained) await assert.rejects(stat(selectedPath), { code: 'ENOENT' })
        assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'user edit\n')
    }
    console.log('Chat creation worktree cleanup: scope/plugin/session failure, association removal, published/existing/dirty/success preservation passed')
} finally {
    const suffix = relative(resolve(tmpdir()), resolve(fixture))
    if (suffix && !suffix.startsWith('..') && !isAbsolute(suffix)) await rm(fixture, { recursive: true, force: true })
}
