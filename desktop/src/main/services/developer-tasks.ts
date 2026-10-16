import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat, lstat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { DeveloperTask, DeveloperWorkspace } from '../../shared/contracts/developer-workflow'
import { developerGit, hasProtectedWorktreeIndex, listDeveloperWorktrees } from './developer-worktrees'
import { writeJsonAtomically } from '../setup/atomic-json'

export async function workspaceRevision(root: string): Promise<string> {
    try {
        if (await hasProtectedWorktreeIndex(root)) return 'unverified'
        const hash = createHash('sha256')
        hash.update(await developerGit(root, ['rev-parse', 'HEAD']))
        hash.update(await developerGit(root, ['diff', '--binary', 'HEAD', '--', '.']))
        const untracked = (await developerGit(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', '.'])).split('\0').filter(Boolean).sort()
        let budget = 24 * 1024 * 1024
        if (untracked.length > 3000) return 'unverified'
        for (const file of untracked) {
            const target = join(root, file), metadata = await lstat(target)
            if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > budget) return 'unverified'
            budget -= metadata.size
            hash.update(file); hash.update(await readFile(target))
        }
        return hash.digest('hex')
    } catch { return 'unverified' }
}

async function projectScripts(root: string): Promise<Pick<DeveloperWorkspace, 'scripts' | 'runner'>> {
    let scripts: Record<string, string> = {}, runner: DeveloperWorkspace['runner'] = 'npm'
    try {
        if ((await stat(join(root, 'package.json'))).size > 1024 * 1024) throw new Error('Package manifest is too large.')
        const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
        if (manifest.scripts && typeof manifest.scripts === 'object') scripts = Object.fromEntries(Object.entries(manifest.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        const declared = String(manifest.packageManager || '').split('@')[0]
        if (['bun', 'pnpm', 'yarn', 'npm'].includes(declared)) runner = declared as typeof runner
        else for (const [lock, candidate] of [['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']] as const) {
            if (await stat(join(root, lock)).then(() => true, () => false)) { runner = candidate; break }
        }
    } catch { /* A project without package.json has no package tasks. */ }
    return { scripts, runner }
}

export async function stopDeveloperTaskProcess(
    child: ChildProcess,
    platform: NodeJS.Platform = process.platform,
    signalGroup: typeof process.kill = process.kill
): Promise<void> {
    if (!child.pid) throw new Error('Task has no owned process.')
    let closed = false
    let notifyClose!: () => void
    const completion = new Promise<void>(resolve => { notifyClose = resolve })
    const onClose = () => { closed = true; notifyClose() }
    child.once('close', onClose)
    const waitForClose = async (milliseconds: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([completion, new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds) })]) }
        finally { clearTimeout(timer) }
        return closed
    }
    try {
        if (platform === 'win32') {
            await new Promise<void>((resolve, reject) => {
                const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
                killer.once('error', reject)
                killer.once('exit', code => code === 0 || closed ? resolve() : reject(new Error('Could not stop task.')))
            })
        } else {
            try {
                signalGroup(-child.pid, 'SIGTERM')
                if (!await waitForClose(1_000)) signalGroup(-child.pid, 'SIGKILL')
            } catch (error) {
                // The OS may reap the group just before Node delivers close.
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH' || !await waitForClose(3_000)) throw error
            }
        }
        if (!await waitForClose(3_000)) throw new Error('The task has not exited. Its process is still tracked; try Stop again.')
    } finally { child.off('close', onClose) }
}

export class DeveloperTasks {
    private tasks: DeveloperTask[] = []
    private processes = new Map<string, ChildProcess>()
    private stopping = new Map<string, Promise<void>>()
    private stopRequested = new Set<string>()
    private starting = new Set<string>()
    private closing = false
    private ready: Promise<void>
    private saves = Promise.resolve()
    constructor(
        private storagePath: string,
        private environment: NodeJS.ProcessEnv = process.env,
        private stopProcess: (child: ChildProcess) => Promise<void> = stopDeveloperTaskProcess
    ) {
        this.ready = readFile(storagePath, 'utf8').then(raw => {
            const saved = JSON.parse(raw)
            if (Array.isArray(saved)) this.tasks = saved.filter(task => task && typeof task.id === 'string' && typeof task.root === 'string').slice(-100).map(task => ({ ...task, output: String(task.output || '').slice(-32_768), state: task.state === 'running' ? 'stopped' : task.state }))
        }).catch(() => undefined)
    }
    private save() {
        this.saves = this.saves.catch(() => undefined).then(() => writeJsonAtomically(this.storagePath, this.tasks))
        return this.saves
    }
    async workspace(path: string): Promise<DeveloperWorkspace> {
        await this.ready
        if (!isAbsolute(path)) throw new Error('Choose an absolute project folder.')
        const root = await realpath(path)
        let gitRoot: string | null = null, branch: string | null = null, worktrees: DeveloperWorkspace['worktrees'] = []
        try {
            gitRoot = (await developerGit(root, ['rev-parse', '--show-toplevel'])).trim()
            branch = (await developerGit(root, ['branch', '--show-current'])).trim() || '(detached)'
            worktrees = await listDeveloperWorktrees(root)
        } catch { /* Non-Git projects can still run scripts. */ }
        const rootTasks = this.tasks.filter(task => task.root === root).slice(-20)
        const revision = rootTasks.length ? await workspaceRevision(root) : 'unverified'
        return { root, gitRoot, branch, worktrees, ...await projectScripts(root), tasks: rootTasks.map(task => ({ ...task, stale: revision === 'unverified' || task.sourceRevision !== revision })) }
    }
    async start(path: string, name: string): Promise<DeveloperTask> {
        if (this.closing) throw new Error('Developer tasks are shutting down.')
        if (!isAbsolute(path)) throw new Error('Choose an absolute project folder.')
        const root = await realpath(path), key = `${root}\0${name}`
        if (this.closing) throw new Error('Developer tasks are shutting down.')
        if (this.starting.has(key)) throw new Error('This task is already starting.')
        if (this.processes.size + this.starting.size >= 8) throw new Error('Stop a running task before starting another.')
        this.starting.add(key)
        try { return await this.startTask(root, name) }
        finally { this.starting.delete(key) }
    }
    private async startTask(path: string, name: string): Promise<DeveloperTask> {
        await this.ready
        if (!isAbsolute(path)) throw new Error('Choose an absolute project folder.')
        const root = await realpath(path)
        if (!(await stat(root)).isDirectory()) throw new Error('Choose a project folder.')
        if (this.processes.size >= 8) throw new Error('Stop a running task before starting another.')
        const { scripts, runner } = await projectScripts(root)
        if (!/^[\w:.-]+$/.test(name) || !Object.hasOwn(scripts, name)) throw new Error('Choose an existing package script.')
        if (this.tasks.some(task => task.root === root && task.name === name && (task.state === 'running' || this.processes.has(task.id)))) throw new Error('This task is already running.')
        const task: DeveloperTask = { id: randomUUID(), root, name, command: `${runner} run ${name}`, state: 'running', startedAt: new Date().toISOString(), output: '', urls: [], sourceRevision: await workspaceRevision(root), stale: false }
        if (this.closing) throw new Error('Developer tasks are shutting down.')
        this.tasks.push(task)
        // Keep running processes and a bounded amount of completed evidence.
        this.tasks = [...this.tasks.filter(item => item.state !== 'running').slice(-92), ...this.tasks.filter(item => item.state === 'running')]
        const child = process.platform === 'win32'
            ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', task.command], { cwd: root, env: this.environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
            : spawn(runner, ['run', name], { cwd: root, env: this.environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
        this.processes.set(task.id, child)
        const output = (data: Buffer) => {
            task.output = (task.output + data.toString()).slice(-32_768)
            task.urls = [...new Set(task.output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s\x1b]*)?/g) || [])].slice(0, 8)
        }
        child.stdout?.on('data', output); child.stderr?.on('data', output)
        child.once('error', error => { task.output = `${task.output}\n${error.message}`.slice(-32_768); task.state = 'failed' })
        child.once('close', (code, signal) => {
            this.processes.delete(task.id)
            const stopRequested = this.stopRequested.delete(task.id)
            task.exitCode = code; task.finishedAt = new Date().toISOString()
            if (task.state === 'running') task.state = stopRequested || signal ? 'stopped' : code === 0 ? 'passed' : 'failed'
            void this.save()
        })
        await this.save()
        return { ...task }
    }
    async stop(id: string): Promise<void> {
        await this.ready
        const existing = this.stopping.get(id)
        if (existing) return existing
        const child = this.processes.get(id)
        if (!child?.pid) throw new Error('Task is no longer running.')
        this.stopRequested.add(id)
        const pending = (async () => {
            await this.stopProcess(child)
            this.stopRequested.delete(id)
            if (this.processes.get(id) === child) this.processes.delete(id)
            const task = this.tasks.find(item => item.id === id)
            if (task) task.state = 'stopped'
            await this.save()
        })()
        this.stopping.set(id, pending)
        try { await pending }
        finally { if (this.stopping.get(id) === pending) this.stopping.delete(id) }
    }
    async dispose(): Promise<void> {
        this.closing = true
        try {
            const outcomes = await Promise.allSettled([...this.processes.keys()].map(id => this.stop(id)))
            const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
            if (failure) throw failure.reason
            if (this.tasks.length) await this.save()
        } catch (error) {
            this.closing = false
            throw error
        }
    }
}
