import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { developerGit, listDeveloperWorktrees, resolveChatWorktree, scopeChatWorktree } from '../src/main/services/developer-worktrees'
import { DeveloperTasks, workspaceRevision, stopDeveloperTaskProcess } from '../src/main/services/developer-tasks'
import { previewRecordedUndo, applyRecordedUndo } from '../src/main/services/developer-undo'
import { diffCodeSelection } from '../src/renderer/src/components/ui/diff-viewer/diff-code-selection'
import { parsePatchFiles } from '@pierre/diffs'
import { selectionContextFile } from '../src/renderer/src/pages/assistant/assistant-code-context'

const fixture = await mkdtemp(join(tmpdir(), 'zyra-developer-workflow-'))
const root = join(fixture, 'repo'), storage = join(fixture, 'tasks.json')
const tasks = new DeveloperTasks(storage)
async function waitTask(id: string) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        const task = (await tasks.workspace(root)).tasks.find(item => item.id === id)
        if (task && task.state !== 'running') return task
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Task did not finish')
}
try {
    await mkdir(root)
    await developerGit(root, ['init', '-b', 'main'])
    await developerGit(root, ['config', 'core.autocrlf', 'false'])
    await developerGit(root, ['config', 'user.name', 'Workflow Test'])
    await developerGit(root, ['config', 'user.email', 'workflow@example.test'])
    await writeFile(join(root, 'file.txt'), 'base\nbefore\ntail\n')
    await writeFile(join(root, 'other.txt'), 'original\n')
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'bun@1', scripts: { test: 'node -e "console.log(\'passed\')"', fail: 'node -e "console.error(\'failed\');process.exit(2)"', dev: 'node -e "console.log(\'http://localhost:3456/\');setInterval(()=>{},1000)"' } }))
    await developerGit(root, ['add', '.'])
    await developerGit(root, ['commit', '-m', 'fixture'])
    await writeFile(join(root, 'file.txt'), 'user edit\nbefore\ntail\n')
    const tree = await resolveChatWorktree(root, { kind: 'new-worktree', branch: 'zyra/test-worktree' })
    assert.equal((await developerGit(root, ['branch', '--show-current'])).trim(), 'main')
    assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'user edit\nbefore\ntail\n')
    assert.equal(await readFile(join(tree, 'file.txt'), 'utf8'), 'base\nbefore\ntail\n')
    assert.equal(await resolveChatWorktree(root, { kind: 'existing-worktree', path: tree }), tree)
    assert.ok((await listDeveloperWorktrees(root)).some(entry => entry.branch === 'zyra/test-worktree'))
    const scope = { projectId: 'project', revision: 1, workingRoot: tree, createdAt: '', updatedAt: '', roots: [{ id: 'original', kind: 'associated-folder' as const, path: root, label: 'Original', access: 'read-write' as const }, { id: 'worktree', kind: 'associated-folder' as const, path: tree, label: 'Worktree', access: 'read-write' as const }] }
    const isolated = scopeChatWorktree(scope, tree)
    assert.equal(isolated.roots[0]!.access, 'read-only'); assert.equal(isolated.roots[1]!.access, 'read-write')
    assert.equal(scope.roots[0]!.access, 'read-write', 'existing chat scope is not mutated')
    assert.throws(() => scopeChatWorktree({ ...scope, workingRoot: root }, tree), /unavailable/)
    await assert.rejects(resolveChatWorktree(root, { kind: 'existing-worktree', path: fixture }), /repository/)
    await assert.rejects(resolveChatWorktree(root, { kind: 'new-worktree', branch: '--bad' }), /branch name/)

    const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n user edit\n-before\n+agent edit\n tail\n'
    await writeFile(join(root, 'file.txt'), 'user edit\nagent edit\ntail\n')
    await writeFile(join(root, 'other.txt'), 'unrelated staged edit\n')
    await developerGit(root, ['add', 'other.txt'])
    const indexBefore = await developerGit(root, ['diff', '--cached'])
    const plan = await previewRecordedUndo(root, patch)
    assert.deepEqual(plan.paths, ['file.txt'])
    await applyRecordedUndo(plan.token)
    assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'user edit\nbefore\ntail\n')
    assert.equal(await developerGit(root, ['diff', '--cached']), indexBefore)
    await assert.rejects(applyRecordedUndo(plan.token), /expired/)
    await writeFile(join(root, 'file.txt'), 'user edit\nagent edit\ntail\n')
    const conflict = await previewRecordedUndo(root, patch)
    await writeFile(join(root, 'file.txt'), 'user edit\nlater user edit\ntail\n')
    await assert.rejects(applyRecordedUndo(conflict.token), /changed after/)
    assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'user edit\nlater user edit\ntail\n')
    await assert.rejects(previewRecordedUndo(root, patch), /patch|apply|failed/i)
    await assert.rejects(previewRecordedUndo(root, patch.replaceAll('file.txt', '../outside.txt')), /outside|leaves|repository|working folder|invalid/i)

    const before = await workspaceRevision(root)
    await writeFile(join(root, 'untracked.txt'), 'one')
    const untracked = await workspaceRevision(root)
    await writeFile(join(root, 'untracked.txt'), 'two')
    assert.notEqual(before, untracked)
    assert.notEqual(untracked, await workspaceRevision(root))
    const pass = await waitTask((await tasks.start(root, 'test')).id)
    assert.equal(pass.state, 'passed'); assert.equal(pass.exitCode, 0); assert.match(pass.output, /passed/)
    assert.equal(pass.stale, false)
    const manifestBefore = await readFile(join(root, 'package.json'), 'utf8')
    for (const flag of ['assume-unchanged', 'skip-worktree']) {
        await developerGit(root, ['update-index', `--${flag}`, '--', 'package.json'])
        try {
            await writeFile(join(root, 'package.json'), manifestBefore + '\n')
            assert.equal(await workspaceRevision(root), 'unverified', `${flag} cannot certify hidden source edits`)
            assert.equal((await tasks.workspace(root)).tasks.find(task => task.id === pass.id)?.stale, true, 'completed task evidence is stale when tracked edits cannot be verified')
        } finally {
            await writeFile(join(root, 'package.json'), manifestBefore)
            await developerGit(root, ['update-index', `--no-${flag}`, '--', 'package.json'])
        }
    }
    assert.equal((await tasks.workspace(root)).tasks.find(task => task.id === pass.id)?.stale, false, 'clearing the flag and restoring exact source restores evidence validity')
    await writeFile(join(root, 'untracked.txt'), 'changed')
    assert.equal((await tasks.workspace(root)).tasks.find(task => task.id === pass.id)?.stale, true)
    const fail = await waitTask((await tasks.start(root, 'fail')).id)
    assert.equal(fail.state, 'failed'); assert.equal(fail.exitCode, 2)
    await assert.rejects(tasks.start(root, 'missing'), /existing/)
    await assert.rejects(tasks.start(root, 'test & echo unsafe'), /existing/)
    const running = await tasks.start(root, 'dev')
    await assert.rejects(tasks.start(root, 'dev'), /already running/)
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.ok((await tasks.workspace(root)).tasks.find(task => task.id === running.id)?.urls.includes('http://localhost:3456/'))
    await tasks.stop(running.id)
    assert.equal((await waitTask(running.id)).state, 'stopped')
    assert.equal((tasks as any).processes.has(running.id), false, 'Stop resolves only after the owned process closes')

    // Real owner and POSIX policy, controlled signal transport on every host.
    // No operating-system process receives the synthetic group signals.
    for (const force of [false, true]) {
        const child = Object.assign(new EventEmitter(), { pid: 2147483000 })
        const signals: string[] = []
        const synthetic = new DeveloperTasks(join(fixture, `stop-${force}.json`), process.env,
            process => stopDeveloperTaskProcess(process, 'linux', ((pid: number, signal: string) => {
                assert.equal(pid, -child.pid)
                signals.push(signal)
                if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
                return true
            }) as typeof globalThis.process.kill))
        await synthetic.workspace(root)
        const record = { ...running, id: `synthetic-stop-${force}`, state: 'running' }
        ;(synthetic as any).tasks.push(record)
        ;(synthetic as any).processes.set(record.id, child)
        const stopping = synthetic.stop(record.id)
        try {
            await new Promise(resolve => setTimeout(resolve, 20))
            assert.equal(record.state, 'running', 'Sending SIGTERM alone must not report a still-running task as stopped')
            assert.equal((synthetic as any).processes.has(record.id), true)
            await assert.rejects(synthetic.start(root, 'dev'), /already running/, 'A task awaiting close cannot start a duplicate')
            if (!force) child.emit('close', 0, null)
            await stopping
            assert.equal(record.state, 'stopped')
            assert.equal((synthetic as any).processes.has(record.id), false)
            assert.deepEqual(signals, force ? ['SIGTERM', 'SIGKILL'] : ['SIGTERM'])
        } finally {
            child.emit('close', null, 'SIGKILL')
            await stopping.catch(() => undefined)
        }
    }
    const reapedChild = Object.assign(new EventEmitter(), { pid: 2147483000 })
    await stopDeveloperTaskProcess(reapedChild as any, 'linux', (() => {
        queueMicrotask(() => reapedChild.emit('close', 0, null))
        throw Object.assign(new Error('Group already exited'), { code: 'ESRCH' })
    }) as typeof process.kill)
    const failedStop = new DeveloperTasks(join(fixture, 'failed-stop.json'), process.env, async () => { throw new Error('Synthetic stop failure') })
    await failedStop.workspace(root)
    const retained = { ...running, id: 'retained-process', state: 'running' }
    ;(failedStop as any).tasks.push(retained)
    ;(failedStop as any).processes.set(retained.id, { pid: 2147483000 })
    await assert.rejects(failedStop.stop(retained.id), /Synthetic stop failure/)
    assert.equal(retained.state, 'running', 'Failed termination must not report stopped')
    assert.equal((failedStop as any).processes.has(retained.id), true, 'Failed termination retains the owned process')
    await assert.rejects(failedStop.start(root, 'dev'), /already running/)
    ;(failedStop as any).processes.delete(retained.id)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok((await new DeveloperTasks(storage).workspace(root)).tasks.some(task => task.id === pass.id && task.state === 'passed'))

    const partial = parsePatchFiles('diff --git a/code.ts b/code.ts\n--- a/code.ts\n+++ b/code.ts\n@@ -40,2 +40,2 @@\n unchanged\n-old\n+new\n')[0]!.files[0]!
    const selection = diffCodeSelection(partial, { start: 41, end: 41, side: 'additions' }, root)!
    assert.equal(selection.text, 'new'); assert.equal(selection.startLine, 41); assert.equal(selection.side, 'after')
    assert.equal(diffCodeSelection(partial, { start: 1, end: 2, side: 'additions' }, root), null)
    assert.equal(diffCodeSelection(partial, { start: 40, end: 41, side: 'deletions', endSide: 'additions' }, root), null)
    const attachment = selectionContextFile({ ...selection, stale: true })
    assert.match(attachment.name!, /41/); assert.match(attachment.content!, /Source changed/); assert.ok(attachment.content!.endsWith('new'))
    console.log('Developer workflow: worktree isolation, repository scope, task exit/output/persistence/staleness/stop, safe undo conflicts/index preservation, exact partial-diff selections passed.')
} finally {
    await tasks.dispose()
    const cleanup = resolve(fixture), container = resolve(tmpdir()), suffix = relative(container, cleanup)
    if (!suffix.startsWith('..') && !isAbsolute(suffix) && cleanup !== container) await rm(cleanup, { recursive: true, force: true })
}
