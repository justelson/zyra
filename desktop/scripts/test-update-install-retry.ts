import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createInstallPreflight } from '../src/main/update/install-preflight'
import { createInstallerRequests } from '../src/main/update/installer-requests'

// Production manager + actual before-quit coordinator, with only the Electron
// event loop and service boundaries replaced. Never launch an app or installer.
const manager = ts.createSourceFile('manager.ts', readFileSync(resolve(import.meta.dir, '../src/main/update/manager.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const names = new Set(['installerFlag', 'releaseInstallationResources', 'shouldAbortUpdateQuit', 'cancelPendingAppInstallation', 'hasCurrentManualInstallerRequest', 'receiveInstallerUpdateRequest', 'preflightAppUpdate', 'installAppUpdate', 'installPreflight'])
const selected = manager.statements.filter(node => ts.isFunctionDeclaration(node) ? names.has(node.name?.text || '') : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(manager))))
assert.equal(selected.length, names.size)
const output = ts.transpileModule(selected.map(node => node.getText(manager)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const main = readFileSync(resolve(import.meta.dir, '../src/main/index.ts'), 'utf8')
const start = main.indexOf("app.on('before-quit', (event) => {")
const end = main.indexOf('// Handle window control IPC', start)
assert.ok(start >= 0 && end > start)
const directory = mkdtempSync(join(tmpdir(), 'zyra-update-retry-'))
const noop = () => undefined
try {
    const requests = join(directory, 'updates', 'installer-requests')
    mkdirSync(requests, { recursive: true })
    let prepareFails = true, preparations = 0, releases = 0, flushes = 0, quits = 0
    const app = Object.assign(new EventEmitter(), {
        getPath: () => directory, getVersion: () => '0.7.1', getName: () => 'Synthetic Zyra',
        quit() {
            quits++
            let prevented = false
            app.emit('before-quit', { preventDefault() { prevented = true } })
            if (!prevented) app.emit('will-quit')
        }
    })
    const assistant = {
        inspectRuntimeInstallation: async () => ({ instance: { instanceId: 'exact-instance', namespaceId: 'exact-namespace' }, methods: ['server.prepareUpdate'], activity: { activeTurns: 0, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 } }),
        prepareRuntimeInstallation: async () => { preparations++; if (prepareFails) throw Error('Worker cleanup has not finished. Installation has not started.') },
        cancelRuntimeInstallation: async () => { releases++ }
    }
    const context: Record<string, any> = {
        exports: {}, app, createInstallPreflight, createInstallerRequests, join, mkdirSync, writeFileSync, rmSync,
        installerRequests: null, installRelease: null, installVersion: null, installOperationId: '', readyOnQuit: null,
        abortUpdateQuit: false, installQuitScheduled: false, isInstallingUpdate: false,
        updateState: { enabled: false, status: 'idle' }, updaterConfigured: false, autoUpdaterRef: null,
        getAssistantService: () => assistant, initializeUpdater: async () => { throw Error('Manual request must not use the release feed') },
        clearUpdateTimers: noop, getUpdaterUnavailableMessage: () => 'unavailable',
        buildActionResult: (accepted: boolean, completed: boolean) => ({ accepted, completed, state: context.updateState }),
        rejectAction: (message: string) => ({ accepted: false, completed: false, state: { message } }),
        reduceUpdateStateOnInstallFailure: (state: object, message: string) => ({ ...state, message, errorContext: 'install' }),
        setUpdateState: (state: object) => { context.updateState = state }, log: { error: noop, warn: noop },
        quitCleanupComplete: false, quitCleanupStarted: false,
        flushGlobalBrowserProfileStorage: async () => { flushes++ },
        globalShortcut: { unregisterAll: noop }, browserRecordingOverlayManager: { dispose: noop }, nativeOverlayManager: { dispose: noop }, browserViewManager: { dispose: noop }, browserClientRuntime: null, disposeUpdater: noop,
        assistantUtilityWindowManager: { dispose: async () => undefined },
        setupServices: { onboarding: { isAccessAllowed: () => true }, auth: { dispose: async () => undefined }, analytics: { capture: noop, flush: async () => undefined, shutdown: async () => undefined } },
        disposeAgentControlBroker: async () => undefined, disposeBrowserThreatProtectionService: async () => undefined,
        disposeAssistantService: async () => undefined, disposeDeveloperWorkflowTasks: async () => undefined,
        rendererHangRecorder: { dispose: noop }, mainWindow: { isDestroyed: () => false, isVisible: () => true },
        dialog: { showErrorBox: () => { throw Error('Unexpected persistence failure') } }, createWindow: noop, ensureIpcHandlersRegistered: noop
    }
    runInNewContext(output + '\n' + main.slice(start, end), context)
    const api = context.exports
    const attempt = async (id: string) => {
        writeFileSync(join(requests, `${id}.request`), '0.7.2')
        assert.equal(api.receiveInstallerUpdateRequest([`--zyra-prepare-update=${id}`]), true)
        const plan = await api.preflightAppUpdate()
        return api.installAppUpdate({ planId: plan.id, stopBlockers: false })
    }
    const first = '11111111-1111-1111-1111-111111111111'
    const second = '22222222-2222-2222-2222-222222222222'
    assert.equal((await attempt(first)).completed, false)
    assert.equal(quits, 0, 'Failed preparation cannot schedule quit')
    assert.equal(existsSync(join(requests, `${first}.ready`)), false)
    assert.equal(existsSync(join(requests, `${first}.later`)), true)
    assert.equal(releases, 1, 'Failed preparation releases runtime admission exactly once')
    prepareFails = false
    assert.equal((await attempt(second)).completed, true)
    const deadline = Date.now() + 500
    while (!existsSync(join(requests, `${second}.ready`)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(flushes, 1, 'A failed pre-quit attempt must not abort the next successful quit')
    assert.equal(preparations, 2)
    assert.equal(quits, 2, 'First quit awaits persistence; second reaches will-quit')
    assert.equal(readFileSync(join(requests, `${second}.ready`), 'utf8'), '0.7.2')
    assert.equal(existsSync(join(requests, `${first}.ready`)), false, 'Only the current native nonce receives readiness')
    console.log('PASS production manager failure/retry reaches actual before-quit persistence and exact-nonce will-quit readiness')

    const rollbackMethod = (file: string, className: string) => {
        const source = ts.createSourceFile(file, readFileSync(resolve(import.meta.dir, file), 'utf8'), ts.ScriptTarget.Latest, true)
        const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ts.ClassDeclaration
        const method = owner.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'cancelRuntimeInstallation')!
        const code = ts.transpileModule(`class Rollback { ${method.getText(source)} }; globalThis.Rollback = Rollback`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
        const sandbox: Record<string, any> = {}
        runInNewContext(code, sandbox)
        return new sandbox.Rollback()
    }
    for (const failAt of ['cancel', 'close']) {
        const connection = rollbackMethod('../src/main/assistant/zyra-agent-server-worker.ts', 'DesktopAgentServerConnection')
        connection.installationPending = true
        connection.updateClient = { async cancelRuntimeInstallation() { if (failAt === 'cancel') throw Error('cancel failed') }, close() { if (failAt === 'close') throw Error('close failed') } }
        await assert.rejects(connection.cancelRuntimeInstallation(), new RegExp(`${failAt} failed`))
        assert.equal(connection.installationPending, false, 'Cleanup exceptions cannot strand Desktop update admission')
        assert.equal(connection.updateClient, null)
        const runtime = rollbackMethod('../src/main/assistant/zyra-runtime.ts', 'ZyraRuntime')
        runtime.preparedInstallConnection = { cancelRuntimeInstallation: async () => { throw Error('rollback failed') } }
        runtime.privateVoiceUpdatePending = []
        await assert.rejects(runtime.cancelRuntimeInstallation(), /rollback failed/)
        assert.equal(runtime.preparedInstallConnection, null)
        assert.equal(runtime.privateVoiceUpdatePending, null, 'Failed rollback cannot strand local voice admission')
    }
    console.log('PASS production cancellation clears local admission even when lease release or client close fails')
} finally { rmSync(directory, { recursive: true, force: true }) }
