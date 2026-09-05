import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mock } from 'bun:test'
import { AssistantPluginRegistry } from '../src/main/assistant/assistant-plugin-registry'
import { PluginAuthorityMutations } from '../src/main/assistant/assistant-plugin-authority'
import { GrantStore } from '../src/main/agent-control/grant-store'
import type { ControlPrincipal } from '../src/shared/agent-control/contracts'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DesktopAgentServerConnection } from '../src/main/assistant/zyra-agent-server-worker'

const root = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'zyra-plugin-revocation-'))
const cleanup: Array<() => void | Promise<void>> = []
try {
    mock.module('electron', () => ({
        app: { getPath: () => fixture, isReady: () => true, on() {}, once() {} },
        BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
        screen: { getAllDisplays: () => [] }, nativeImage: {}, webContents: { fromId: () => null },
        safeStorage: { isEncryptionAvailable: () => false },
        globalShortcut: { register: () => false, unregister() {} }, shell: {}, dialog: {}
    }))
    const grants = new GrantStore()
    mock.module('../src/main/agent-control/index', () => ({ getAgentControlBroker: () => ({
        grants,
        revokePrincipal(principal: ControlPrincipal) { grants.revokeByPrincipal(principal); grants.removePendingByPrincipal(principal) }
    }) }))
    const { AssistantService } = await import('../src/main/assistant/service')
    const { ZyraPiRuntime } = await import('../src/main/assistant/zyra-pi-runtime')
    const { ZyraPluginRegistry } = await import(pathToFileURL(join(root, 'src/plugins/plugin-registry.mjs')).href)
    const { ZyraAgentServer } = await import(pathToFileURL(join(root, 'src/agent-server/server.mjs')).href)
    const { CanonicalChatCatalog } = await import(pathToFileURL(join(root, 'src/agent-server/catalog.mjs')).href)
    class FixtureWorker extends EventEmitter {
        disposed = false
        activePrompt: (() => void) | null = null
        requests: string[] = []
        connectPayload: Record<string, unknown> | null = null
        cleanupGate: Promise<void> | null = null
        cleanupFails = false
        connectGate: Promise<void> | null = null
        isAlive() { return !this.disposed }
        async request(type: string, payload: Record<string, unknown> = {}) {
            this.requests.push(type)
            if (type === 'connect') { this.connectPayload = payload; await this.connectGate; return { threadId: payload.threadId } }
            if (type === 'prompt') await new Promise<void>((resolve) => { this.activePrompt = resolve })
            if (type === 'plugin.revoke') {
                this.activePrompt?.(); this.activePrompt = null
                this.emit('event', { type: 'agent_end' })
                await this.cleanupGate
                if (this.cleanupFails) throw new Error('Fixture cleanup failure')
                return { revoked: true }
            }
            return {}
        }
        sendControlResponse() { return true }
        dispose() { this.disposed = true; this.activePrompt?.(); this.activePrompt = null }
    }
    const workers: FixtureWorker[] = []
    let nextConnectGate: Promise<void> | null = null
    let controlStarted = false
    let controlAborted = false
    const channel = `revocation-${process.pid}-${Date.now()}`
    const catalog = new CanonicalChatCatalog({ stateDirectory: fixture, channel, loadSessionManager: async () => ({ list: async () => [] }) })
    const server = new ZyraAgentServer({ root, stateDirectory: fixture, channel, endpoint: 0, catalog,
        desktopAuthorityToken: 'isolated-fixture-proof', createWorker: () => { const worker = new FixtureWorker(); worker.connectGate = nextConnectGate; nextConnectGate = null; workers.push(worker); return worker } })
    cleanup.push(() => server.stop())
    await server.start()
    const connection = new DesktopAgentServerConnection(root, { stateDirectory: fixture, channel, autoStart: false, authorityProof: 'isolated-fixture-proof',
        handleDetachedControl: async ({ signal }) => {
            controlStarted = true
            await new Promise<void>((resolve) => signal.addEventListener('abort', () => { controlAborted = true; resolve() }, { once: true }))
            return { cancelled: true }
        }
    })
    cleanup.push(() => connection.close())
    // Seed an inspected fixture release directly. No installer, package execution, or real sessions.
    const coreRegistry = new ZyraPluginRegistry({ rootPath: join(fixture, 'plugins') })
    await coreRegistry.initialize()
    const packageRoot = join(coreRegistry.releasesRoot, 'fixture-release')
    await mkdir(join(packageRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(packageRoot, 'skills', 'fixture-skill'), { recursive: true })
    await writeFile(join(packageRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture-plugin', description: 'Isolated revocation fixture.', version: '1.0.0', skills: './skills' }))
    await writeFile(join(packageRoot, 'skills', 'fixture-skill', 'SKILL.md'), '---\nname: fixture-skill\ndescription: Isolated revocation fixture.\n---\nFixture instructions.\n')
    const inspected = await coreRegistry.inspectLocalPackage(packageRoot)
    coreRegistry.state.plugins.push({ id: 'fixture-plugin', name: 'fixture-plugin', activeReleaseId: 'fixture-release', releaseIds: ['fixture-release'], state: 'active' })
    coreRegistry.state.releases.push({ ...inspected.release, id: 'fixture-release', pluginId: 'fixture-plugin', packagePath: packageRoot, manifest: inspected.manifest })
    await coreRegistry.setEnabledPlugins({ pluginIds: ['fixture-plugin'], expectedRevision: 1 })
    await coreRegistry.createChatScope({ sessionId: 'session:affected' })
    await coreRegistry.createChatScope({ sessionId: 'session:unrelated', inherit: false })
    const registry = new AssistantPluginRegistry({ rootPath: coreRegistry.rootPath })
    cleanup.push(() => registry.dispose())
    ;(registry as any).registryPromise = Promise.resolve(coreRegistry)
    const source = (await registry.getChatSkillSources('session:affected'))[0]!
    const runtime = new ZyraPiRuntime()
    ;(runtime as any).agentServerConnection = connection
    runtime.checkAvailability = async () => ({ available: true, reason: null })
    const session = { id: 'session:affected', mode: 'default', workingRoot: fixture, threads: [{ id: 'thread:affected', providerThreadId: 'chat:affected', runtimeMode: 'approval-required' }] }
    const service = Object.create(AssistantService.prototype) as any
    Object.assign(service, { readyPromise: Promise.resolve(), pluginRegistry: registry, runtime,
        pluginAuthorityMutations: new PluginAuthorityMutations(), state: { snapshot: { sessions: [session] } },
        persistence: { isInternalProjectPath: () => false } })
    const issueGrant = (principal: ControlPrincipal) => grants.issue({ principal, targetId: 'fixture-target', capabilities: [],
        expiresAt: new Date(Date.now() + 60000).toISOString(), maxActions: 10, issuedBy: 'user' })
    const rootGrant = issueGrant({ type: 'root', threadId: 'thread:affected', turnId: 'turn:affected' })
    const childGrant = issueGrant({ type: 'agent', parentThreadId: 'thread:affected', fleetId: 'fixture-fleet', agentRunId: 'fixture-child' })
    const unrelatedGrant = issueGrant({ type: 'root', threadId: 'thread:unrelated', turnId: 'turn:unrelated' })
    const pendingGrant = grants.addPending({ principal: childGrant.principal, targetId: 'fixture-target' } as any)
    const affected = connection.createWorker(fixture)
    const unrelated = connection.createWorker(fixture)
    const waitUntil = async (predicate: () => boolean) => {
        const deadline = Date.now() + 2000
        while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture timed out'); await new Promise((r) => setTimeout(r, 5)) }
    }
    await affected.request('connect', { cwd: fixture, threadId: 'chat:affected', pluginSkillSources: [source] })
    await unrelated.request('connect', { cwd: fixture, threadId: 'chat:unrelated', pluginSkillSources: [] })
    const affectedPrompt = affected.request('prompt', { turnId: 'turn:affected', prompt: 'fixture' })
    const unrelatedPrompt = unrelated.request('prompt', { turnId: 'turn:unrelated', prompt: 'fixture' })
    void affectedPrompt.catch(() => undefined)
    void unrelatedPrompt.catch(() => undefined)
    await waitUntil(() => Boolean(workers[0].activePrompt && workers[1].activePrompt))
    const affectedServerSession = server.sessions.get('chat:affected')
    affected.dispose()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(workers[0].disposed, false, 'ordinary detach preserves work')
    assert.ok(workers[0].activePrompt, 'ordinary detach preserves the active turn')
    workers[0].emit('control', { type: 'control.request', requestId: 'fixture:control', operation: { operation: 'observe' } })
    await waitUntil(() => controlStarted)
    const updateAuthority = connection.updatePluginAuthority.bind(connection)
    connection.updatePluginAuthority = async () => { throw new Error('Fixture server unavailable') }
    await assert.rejects(() => service.setPluginState(source.pluginId, 'disabled'), /server unavailable/)
    assert.equal((await registry.getCatalog()).plugins[0]?.state, 'active', 'preflight failure must not commit a disable that cannot revoke work')
    assert.ok(workers[0].activePrompt)
    connection.updatePluginAuthority = updateAuthority
    await service.setPluginState(source.pluginId, 'disabled')
    assert.equal((await registry.getCatalog()).plugins[0]?.state, 'disabled')
    await assert.rejects(() => service.getSessionPluginSkillSources(session), /disabled/i, 'next-turn resolution fails closed until explicit scope refresh')
    assert.equal(affectedServerSession.latestTurn.id, 'turn:affected')
    assert.equal(affectedServerSession.latestTurn.state, 'interrupted', 'late worker completion cannot turn a revoked turn into success')
    assert.equal(grants.list().find((grant) => grant.grantId === rootGrant.grantId)?.state, 'revoked', 'detached root grants are revoked before disable succeeds')
    assert.equal(grants.list().find((grant) => grant.grantId === childGrant.grantId)?.state, 'revoked', 'detached child grants are revoked before disable succeeds')
    assert.equal(grants.getPending(pendingGrant.requestId), undefined)
    assert.equal(grants.list().find((grant) => grant.grantId === unrelatedGrant.grantId)?.state, 'active', 'unrelated Chat grants remain valid')
    assert.equal(controlAborted, true, 'revocation cancels detached root/control work')
    assert.equal(workers[0].activePrompt, null, 'disabling must cancel an already-detached affected turn')
    assert.equal(workers[0].disposed, true, 'revocation must retire the worker that loaded revoked Skills')
    assert.ok(workers[1].activePrompt, 'an unrelated Chat keeps running')
    await affectedPrompt
    const stale = connection.createWorker(fixture)
    await assert.rejects(() => stale.request('connect', { cwd: fixture, threadId: 'chat:affected', pluginSkillSources: [source] }),
        (error: any) => error.code === 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED')
    await service.refreshChatPluginScope({ sessionId: session.id })
    assert.deepEqual(await service.getSessionPluginSkillSources(session), [], 'refresh removes disabled Skills from next-turn sources')
    await service.connectSessionRuntime(session, session.threads[0])
    assert.equal(workers.length, 3, 'explicit empty-scope refresh creates a clean worker')
    assert.deepEqual(workers[2].connectPayload?.pluginSkillSources, [], 'the next runtime receives no revoked Skill sources')
    workers[1].activePrompt?.()
    await unrelatedPrompt

    await connection.updatePluginAuthority({ pluginId: source.pluginId, state: 'active', chats: [] })
    const scoped = connection.createWorker(fixture)
    await scoped.request('connect', { cwd: fixture, threadId: 'chat:scoped', pluginSkillSources: [source] })
    const scopedWorker = workers.at(-1)!
    scopedWorker.emit('event', { type: 'managed_bash_job_update', jobId: 'fixture-job', status: 'running' })
    scopedWorker.emit('event', { type: 'fleet_snapshot', fleet: { agents: { child: { status: 'running' } }, workflows: {} } })
    scoped.dispose()
    await connection.updatePluginAuthority({ chats: [{ sessionKey: 'chat:scoped', sources: [source, { ...source, pluginId: 'extra-plugin' }] }] })
    assert.equal(scopedWorker.disposed, false, 'adding authority does not cancel background work using the pinned release')
    await connection.updatePluginAuthority({ chats: [{ sessionKey: 'chat:scoped', sources: [] }] })
    assert.equal(scopedWorker.disposed, true, 'removing a scoped release retires background-only work')
    assert.equal(scopedWorker.requests.filter((type) => type === 'plugin.revoke').length, 1)
    await assert.rejects(() => connection.createWorker(fixture).request('connect', { cwd: fixture, threadId: 'chat:scoped', pluginSkillSources: [source] }),
        (error: any) => error.code === 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED')
    const waiting = connection.createWorker(fixture)
    await waiting.request('connect', { cwd: fixture, threadId: 'chat:waiting', pluginSkillSources: [source] })
    const waitingWorker = workers.at(-1)!
    let releaseCleanup!: () => void
    waitingWorker.cleanupGate = new Promise((resolve) => { releaseCleanup = resolve })
    let acknowledged = false
    const revocation = connection.updatePluginAuthority({ chats: [{ sessionKey: 'chat:waiting', sources: [] }] }).then(() => { acknowledged = true })
    await waitUntil(() => waitingWorker.requests.includes('plugin.revoke'))
    assert.equal(acknowledged, false, 'Desktop waits for worker cleanup acknowledgement')
    await assert.rejects(() => waiting.request('prompt', { turnId: 'turn:blocked', prompt: 'fixture' }),
        (error: any) => error.code === 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED')
    releaseCleanup()
    await revocation
    assert.equal(acknowledged, true)

    const failing = connection.createWorker(fixture)
    await failing.request('connect', { cwd: fixture, threadId: 'chat:failing', pluginSkillSources: [source] })
    const failingWorker = workers.at(-1)!
    failingWorker.cleanupFails = true
    await assert.rejects(() => connection.updatePluginAuthority({ chats: [{ sessionKey: 'chat:failing', sources: [] }] }),
        (error: any) => error.code === 'AGENT_SERVER_PLUGIN_CLEANUP_FAILED')
    assert.equal(failingWorker.disposed, true, 'failed cleanup still retires the worker')
    await assert.rejects(() => connection.createWorker(fixture).request('connect', { cwd: fixture, threadId: 'chat:failing', pluginSkillSources: [source] }),
        (error: any) => error.code === 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED', 'cleanup failure never restores revoked authority')

    let releaseConnect!: () => void
    nextConnectGate = new Promise((resolve) => { releaseConnect = resolve })
    const pendingWorker = connection.createWorker(fixture)
    const pendingAttach = pendingWorker.request('connect', { cwd: fixture, threadId: 'chat:connecting', pluginSkillSources: [source] })
    void pendingAttach.catch(() => undefined)
    await waitUntil(() => workers.at(-1)?.connectPayload?.threadId === 'chat:connecting')
    const connectingWorker = workers.at(-1)!
    await connection.updatePluginAuthority({ pluginId: source.pluginId, state: 'disabled', chats: [] })
    releaseConnect()
    await assert.rejects(() => pendingAttach, (error: any) => error.code === 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED')
    assert.equal(connectingWorker.disposed, true, 'a connect already in flight cannot resurrect revoked authority')

    const { ZyraAgentServerClient } = await import(pathToFileURL(join(root, 'src/agent-server/client.mjs')).href)
    const untrusted = new ZyraAgentServerClient({ root, stateDirectory: fixture, channel, autoStart: false, clientId: 'fixture:tui', surface: 'tui' })
    try {
        await untrusted.connect()
        await assert.rejects(() => untrusted.request('session.pluginAuthority', { pluginId: source.pluginId, state: 'active', chats: [] }),
            (error: any) => error.code === 'AGENT_SERVER_AUTH_FAILED')
    } finally { untrusted.close() }
    console.log('Plugin registry → service → runtime → server revocation, stale scopes, background work, cleanup acknowledgement/failure and trusted authority: ok')
} finally {
    for (const close of cleanup.reverse()) await close()
    await rm(fixture, { recursive: true, force: true })
}
