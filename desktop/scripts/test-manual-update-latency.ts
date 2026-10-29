import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createInstallPreflight } from '../src/main/update/install-preflight'

// Execute the production entry points with an indefinitely pending online feed.
// Keep the real local preflight controller; no Electron app or installer runs.
const source = ts.createSourceFile('manager.ts', readFileSync(resolve(import.meta.dir,
    '../src/main/update/manager.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const names = ['hasCurrentManualInstallerRequest', 'preflightAppUpdate', 'installAppUpdate']
const code = names.map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node, `Missing production ${name}`)
    return node.getText(source)
}).join('\n')
const output = ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
} }).outputText

function harness(manual = true, activity = 0) {
    let initializeCalls = 0, inspections = 0, preparations = 0, installations = 0, releases = 0
    let valid = true, releaseNetwork!: () => void
    const request = { id: 'native-nonce', version: '0.7.2', agentServerUpdate: true }
    const network = new Promise<void>(resolve => { releaseNetwork = resolve })
    const context: Record<string, any> = {
        exports: {}, isInstallingUpdate: false, updaterConfigured: false, autoUpdaterRef: null,
        updateState: { externalInstaller: manual ? request : undefined, status: 'downloaded', downloadedVersion: '0.7.2' },
        installerRequests: { assertCurrent() { if (!valid) throw new Error('expired native request'); return request } },
        async initializeUpdater() { initializeCalls++; await network; context.updaterConfigured = true; context.autoUpdaterRef = {} },
        buildActionResult: (accepted: boolean, completed: boolean) => ({ accepted, completed }),
        rejectAction: (message: string) => ({ accepted: false, message }),
        getUpdaterUnavailableMessage: () => 'Updater unavailable',
        async cancelPendingAppInstallation() { releases++ },
        reduceUpdateStateOnInstallFailure: (state: unknown, message: string) => ({ ...state as object, message }),
        setUpdateState: (state: unknown) => { context.updateState = state },
        log: { error() {} }
    }
    context.installPreflight = createInstallPreflight({
        version: () => context.updateState.externalInstaller?.version || context.updateState.downloadedVersion,
        inspect: async () => { inspections++; return { instance: { instanceId: 'agent-a', namespaceId: 'profile-a' },
            activity: { activeTurns: activity, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 },
            methods: ['server.prepareUpdate'] } },
        prepare: async () => { if (manual) context.installerRequests.assertCurrent(); preparations++ },
        release: async () => { releases++ }, install: () => { installations++ }
    })
    runInNewContext(output, context)
    return { api: context.exports, context, releaseNetwork, expire: () => { valid = false },
        counts: () => ({ initializeCalls, inspections, preparations, installations, releases }) }
}
async function beforeNetwork<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout>
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Local installer waited for the online release feed')), 250)
        })])
    } finally { clearTimeout(timeout!) }
}

const manual = harness()
const plan = await beforeNetwork(manual.api.preflightAppUpdate()) as any
assert.equal(plan.state, 'ready')
const installed = await beforeNetwork(manual.api.installAppUpdate({ planId: plan.id, stopBlockers: false })) as any
assert.equal(installed.accepted, true)
assert.deepEqual(manual.counts(), { initializeCalls: 0, inspections: 1, preparations: 1, installations: 1, releases: 0 })

const blocked = harness(true, 1)
const blockedPlan = await beforeNetwork(blocked.api.preflightAppUpdate()) as any
await beforeNetwork(blocked.api.installAppUpdate({ planId: blockedPlan.id, stopBlockers: false }))
assert.equal(blocked.counts().installations, 0, 'Network independence cannot imply permission to stop work')

const expired = harness()
const expiredPlan = await beforeNetwork(expired.api.preflightAppUpdate()) as any
expired.expire()
const expiredInstall = expired.api.installAppUpdate({ planId: expiredPlan.id, stopBlockers: false })
assert.equal(expired.counts().initializeCalls, 1, 'Expired native requests do not qualify for the manual shortcut')
expired.releaseNetwork()
await expiredInstall
assert.equal(expired.counts().installations, 0, 'Final local request validation stays fail-closed')

const automatic = harness(false)
const automaticPlan = automatic.api.preflightAppUpdate()
assert.equal(automatic.counts().initializeCalls, 1)
assert.equal(automatic.counts().inspections, 0, 'Automatic updates still initialize their download owner')
automatic.releaseNetwork()
await automaticPlan
assert.equal(automatic.counts().inspections, 1)
console.log('PASS manual preflight/install proceed during a stalled feed; local consent, stale request and automatic-update gates remain enforced')
