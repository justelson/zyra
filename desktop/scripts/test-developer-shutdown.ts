import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { DeveloperTasks, stopDeveloperTaskProcess } from '../src/main/services/developer-tasks'

const directory = await mkdtemp(join(tmpdir(), 'zyra-developer-shutdown-'))
const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const begin = main.indexOf("app.on('before-quit', (event) => {")
const end = main.indexOf('// Handle window control IPC', begin)
assert.ok(begin >= 0 && end > begin)
const shutdown = main.slice(begin, end)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const noop = () => undefined
async function fixture(tasks: DeveloperTasks) {
    const app = Object.assign(new EventEmitter(), { quit: () => { state.quits++ } })
    const state: any = {
        app, quits: 0, prevented: 0, quitCleanupComplete: false, quitCleanupStarted: false,
        flushGlobalBrowserProfileStorage: async () => undefined,
        globalShortcut: { unregisterAll: noop }, browserRecordingOverlayManager: { dispose: noop },
        nativeOverlayManager: { dispose: noop }, browserViewManager: { dispose: noop },
        browserClientRuntime: null, disposeUpdater: noop,
        assistantUtilityWindowManager: { dispose: async () => undefined },
        setupServices: { onboarding: { isAccessAllowed: () => true }, auth: { dispose: async () => undefined },
            analytics: { capture: noop, flush: async () => undefined, shutdown: async () => undefined } },
        disposeAgentControlBroker: async () => undefined, disposeBrowserThreatProtectionService: async () => undefined,
        disposeAssistantService: async () => undefined, disposeDeveloperWorkflowTasks: () => tasks.dispose(),
        rendererHangRecorder: { dispose: noop }, mainWindow: { isDestroyed: () => false, isVisible: () => true },
        log: { warn: noop, error: (...args: unknown[]) => state.errors.push(args) }, errors: [],
        dialog: { showErrorBox: noop }, createWindow: () => { throw Error('Unexpected window creation') }, ensureIpcHandlersRegistered: noop
    }
    runInNewContext(shutdown, state)
    app.emit('before-quit', { preventDefault: () => state.prevented++ })
    return state
}
try {
    const child = Object.assign(new EventEmitter(), { pid: 2147483000 })
    const tasks = new DeveloperTasks(join(directory, 'tasks.json'), process.env,
        process => stopDeveloperTaskProcess(process, 'linux', (() => true) as typeof globalThis.process.kill))
    await tasks.workspace(directory)
    const record = { id: 'owned-shutdown-task', root: directory, name: 'dev', state: 'running', output: '', urls: [], startedAt: '', sourceRevision: '' }
    ;(tasks as any).tasks.push(record)
    ;(tasks as any).processes.set(record.id, child)
    const state = await fixture(tasks)
    await delay(30)
    assert.equal(state.prevented, 1)
    assert.equal(state.quits, 0, 'The actual Electron before-quit coordinator must wait for owned developer processes to close')
    await assert.rejects(tasks.start(directory, 'test'), /shutting down/)
    child.emit('close', 0, null)
    const deadline = Date.now() + 5_000
    while (!state.quitCleanupComplete && Date.now() < deadline) await delay(10)
    assert.equal(state.quits, 1)
    assert.equal(record.state, 'stopped')
    assert.equal((tasks as any).processes.size, 0)
    await assert.rejects(tasks.start(directory, 'test'), /shutting down/, 'Pending starts cannot spawn after successful disposal')

    const failed = new DeveloperTasks(join(directory, 'failed.json'), process.env, async () => { throw Error('Synthetic shutdown failure') })
    await failed.workspace(directory)
    ;(failed as any).tasks.push({ ...record, state: 'running' })
    ;(failed as any).processes.set(record.id, { pid: 2147483000 })
    const failure = await fixture(failed)
    await delay(30)
    assert.equal(failure.quits, 0, 'Task cleanup failure keeps the application alive rather than orphaning a process')
    assert.equal(failure.quitCleanupStarted, false, 'A failed cleanup permits a later quit retry')
    assert.equal((failed as any).processes.size, 1)
    ;(failed as any).processes.clear()
    console.log('Real before-quit coordinator waits for owned task close, prevents late starts and retains failed cleanup for retry.')
} finally { await rm(directory, { recursive: true, force: true }) }
