import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DesktopAgentServerConnection, resolveDesktopAgentServerNamespace } from '../src/main/assistant/zyra-agent-server-worker'

class FakeWorker extends EventEmitter {
    activePrompt: ((value: Record<string, unknown>) => void) | null = null
    connectPayloads: Array<Record<string, unknown>> = []
    disposed = false
    isAlive(): boolean { return !this.disposed }
    request(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        if (type === 'connect') {
            this.connectPayloads.push(payload)
            return Promise.resolve({ threadId: 'chat:desktop-test', providerThreadId: sessionPath })
        }
        if (type === 'prompt') return new Promise((resolve) => { this.activePrompt = resolve })
        return Promise.resolve({})
    }
    finishPrompt(value: Record<string, unknown>): void {
        const resolve = this.activePrompt
        this.activePrompt = null
        resolve?.(value)
    }
    controlResponses: Array<Record<string, unknown>> = []
    sendControlResponse(message: Record<string, unknown>): boolean { this.controlResponses.push(message); return true }
    dispose(): void { this.disposed = true }
}

const root = path.resolve(import.meta.dirname, '../..')
const stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'zyra-desktop-agent-server-'))
const channel = `desktop-test-${process.pid}-${Date.now()}`
const devNamespace = resolveDesktopAgentServerNamespace(path.join(stateDirectory, 'Zyra-dev'))
const productionNamespace = resolveDesktopAgentServerNamespace(path.join(stateDirectory, 'Zyra'))
assert.equal(devNamespace.stateDirectory, path.resolve(stateDirectory, 'Zyra-dev', 'assistant', 'agent-server'))
assert.equal(devNamespace.channel, 'desktop')
assert.notEqual(devNamespace.stateDirectory, productionNamespace.stateDirectory, 'development and production desktop servers use separate userData state')
assert.deepEqual(
    resolveDesktopAgentServerNamespace(path.join(stateDirectory, 'ignored'), { stateDirectory, channel }),
    { stateDirectory: path.resolve(stateDirectory), channel },
    'explicit test and packaged server namespaces remain supported'
)
const project = path.join(stateDirectory, 'project')
const sessionPath = path.join(project, '.zyra', 'sessions', 'desktop-test.jsonl')
const pluginSkillSourceV1 = {
    dir: path.join(stateDirectory, 'plugins', 'release-one', 'skills'),
    installationRoot: path.join(stateDirectory, 'plugins'),
    scope: 'project',
    sourceId: 'plugin:release-helper:release-one',
    sourceLabel: 'Release Helper',
    loaderSource: 'project',
    allowRootMarkdown: false,
    enabled: true,
    pluginId: 'plugin-release-helper',
    releaseId: 'release-one',
    contentDigest: '1'.repeat(64)
}
const catalogModule = await import(pathToFileURL(path.join(root, 'src', 'agent-server', 'catalog.mjs')).href)
const serverModule = await import(pathToFileURL(path.join(root, 'src', 'agent-server', 'server.mjs')).href)
const workers: FakeWorker[] = []
const catalog = new catalogModule.CanonicalChatCatalog({
    stateDirectory,
    channel,
    loadSessionManager: async () => ({ list: async () => [{
        path: sessionPath,
        id: 'chat:desktop-test',
        cwd: project,
        name: 'Desktop server adapter test',
        created: new Date(),
        modified: new Date(),
        messageCount: 1
    }] })
})
const server = new serverModule.ZyraAgentServer({
    root,
    endpoint: 0,
    stateDirectory,
    channel,
    catalog,
    desktopAuthorityToken: 'desktop-test-authority',
    createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
    }
})

await server.start()
const connection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
const worker = connection.createWorker(project)
const events: Array<{ event: unknown; metadata: Record<string, unknown> | undefined }> = []
worker.onEvent((event, metadata) => events.push({ event, metadata }))
worker.setControlRequestHandler(async () => ({ owner: 'first' }))

try {
    const connected = await worker.request('connect', {
        cwd: project,
        localThreadId: 'assistant-thread:desktop-test',
        threadId: 'chat:desktop-test',
        providerThreadId: 'chat:desktop-test',
        model: 'openai-codex/gpt-5.5',
        thinking: 'medium',
        profile: 'default',
        pluginSkillSources: [pluginSkillSourceV1]
    })
    assert.equal(connected.threadId, 'chat:desktop-test')
    const secondWorker = connection.createWorker(project)
    const secondEvents: unknown[] = []
    secondWorker.onEvent((event) => secondEvents.push(event))
    secondWorker.setControlRequestHandler(async () => ({ owner: 'second' }))
    await secondWorker.request('connect', {
        cwd: project,
        localThreadId: 'assistant-thread:desktop-test-copy',
        threadId: 'chat:desktop-test',
        providerThreadId: 'chat:desktop-test',
        pluginSkillSources: [pluginSkillSourceV1]
    })
    assert.equal(workers.length, 1, 'the same exact Plugin release reuses the canonical worker')

    const internalClient = await (connection as any).getClient()
    const originalRequest = internalClient.request.bind(internalClient)
    let repeatedAttachRequests = 0
    internalClient.request = (method: string, ...args: unknown[]) => {
        if (method === 'session.attach') repeatedAttachRequests += 1
        return originalRequest(method, ...args)
    }
    await worker.request('clear_queue', {})
    await secondWorker.request('reload', {})
    assert.equal(repeatedAttachRequests, 0, 'already-attached workers must not attach again for every request')

    const prompt = worker.request('prompt', { prompt: 'continue', turnId: 'turn:desktop-test' })
    await waitUntil(() => workers[0]?.activePrompt !== null)
    workers[0].emit('control', { type: 'control.request', requestId: 'control:desktop-owner', operation: { action: 'observe' } })
    await waitUntil(() => workers[0].controlResponses.length === 1)
    assert.deepEqual(workers[0].controlResponses[0].result, { owner: 'first' }, 'control must follow the Desktop projection that initiated the turn')
    workers[0].emit('event', { type: 'message_update', message: { role: 'assistant', content: 'working' } })
    workers[0].finishPrompt({})
    await prompt
    await waitUntil(() => events.length === 3)
    assert.equal((events[0].event as { type: string }).type, 'zyra_server_prompt_accepted', 'the accepted turn becomes visible before provider output')
    assert.equal((events[1].event as { type: string }).type, 'message_update')
    assert.equal(events[1].metadata?.turnId, 'turn:desktop-test')
    assert.equal(events[1].metadata?.localThreadId, 'assistant-thread:desktop-test')
    assert.equal((events[2].event as { type: string }).type, 'zyra_server_turn_completed')
    assert.equal(secondEvents.length, 3, 'two local Desktop projections must receive the same canonical events')

    worker.dispose()
    assert.equal(workers[0].disposed, false, 'desktop detach must leave the server-owned worker alive')
    workers[0].emit('event', { type: 'message_update', message: { role: 'assistant', content: 'second projection remains' } })
    await waitUntil(() => secondEvents.length === 4)
    secondWorker.dispose()
    connection.close()

    const reconnectConnection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
    const reconnectWorker = reconnectConnection.createWorker(project, 1)
    const replay: Array<Record<string, unknown> | undefined> = []
    reconnectWorker.onEvent((_event, metadata) => replay.push(metadata))
    await reconnectWorker.request('connect', {
        cwd: project,
        localThreadId: 'assistant-thread:desktop-test',
        threadId: 'chat:desktop-test',
        providerThreadId: 'chat:desktop-test',
        pluginSkillSources: [pluginSkillSourceV1]
    })
    reconnectWorker.flushReplay()
    assert.equal(replay.length, 3, 'a persisted sequence watermark must skip the already-projected acceptance event')
    assert.equal(replay[0]?.replay, true)
    assert.equal(replay[0]?.turnId, 'turn:desktop-test')
    const latestSequence = reconnectWorker.latestSequence
    reconnectWorker.markRemoteDetached()
    assert.equal(reconnectWorker.latestSequence, latestSequence, 'transport reconnects must retain the replay watermark')
    reconnectWorker.dispose()
    reconnectConnection.close()

    const changedAuthorityConnection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
    const changedAuthorityWorker = changedAuthorityConnection.createWorker(project)
    await changedAuthorityWorker.request('connect', {
        cwd: project,
        localThreadId: 'assistant-thread:desktop-test',
        threadId: 'chat:desktop-test',
        providerThreadId: 'chat:desktop-test',
        pluginSkillSources: [{
            ...pluginSkillSourceV1,
            dir: path.join(stateDirectory, 'plugins', 'release-two', 'skills'),
            sourceId: 'plugin:release-helper:release-two',
            releaseId: 'release-two',
            contentDigest: '2'.repeat(64)
        }]
    })
    assert.equal(workers.length, 2, 'a changed Plugin release creates a fresh canonical worker')
    assert.equal(workers[0].disposed, true, 'the worker holding stale Plugin authority is disposed')
    assert.equal(workers[1]?.connectPayloads[0]?.pluginSkillSources instanceof Array, true)
    changedAuthorityWorker.dispose()
    changedAuthorityConnection.close()

    workers[1].emit('event', { type: 'approval_requested', requestId: 'approval:journal-gap', command: 'synthetic command' })
    workers[1].emit('event', { type: 'tool_execution_start', toolCallId: 'tool:journal-gap', toolName: 'read' })
    for (let index = 0; index < 520; index++) workers[1].emit('event', { type: 'status', index })
    const gapConnection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
    const gapWorker = gapConnection.createWorker(project, 0)
    const recoveredEvents: any[] = []
    gapWorker.onEvent(event => recoveredEvents.push(event))
    try {
        await gapWorker.request('connect', {
            cwd: project, localThreadId: 'assistant-thread:desktop-test', threadId: 'chat:desktop-test', providerThreadId: 'chat:desktop-test',
            pluginSkillSources: workers[1].connectPayloads[0]?.pluginSkillSources
        })
        gapWorker.flushReplay()
        assert.equal(recoveredEvents.filter(event => event.type === 'approval_requested' && event.requestId === 'approval:journal-gap').length, 1, 'Desktop must recover attention whose opening event was evicted')
        assert.equal(recoveredEvents.filter(event => event.type === 'tool_execution_start' && event.toolCallId === 'tool:journal-gap').length, 1, 'Desktop must recover pending tools after a journal gap')
    } finally { gapWorker.dispose(); gapConnection.close() }

    // Pending maintenance can start before both the retained replay and UI watermark.
    workers[1].emit('event', { type: 'compaction_start', reason: 'manual' })
    const maintainedSession = server.sessions.get('chat:desktop-test')!
    const maintainedSequence = maintainedSession.sequence
    for (let index = 0; index < 520; index++) workers[1].emit('event', { type: 'status', index })
    const maintenanceConnection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
    const maintenanceWorker = maintenanceConnection.createWorker(project, maintainedSession.sequence)
    const maintenanceEvents: Array<{ event: any; metadata: any }> = []
    maintenanceWorker.onEvent((event, metadata) => maintenanceEvents.push({ event, metadata }))
    try {
        const connected = await maintenanceWorker.request('connect', {
            cwd: project, localThreadId: 'assistant-thread:desktop-test', threadId: 'chat:desktop-test', providerThreadId: 'chat:desktop-test',
            pluginSkillSources: workers[1].connectPayloads[0]?.pluginSkillSources
        })
        assert.deepEqual(connected.agentServerPendingCompactions, [{ sequence: maintainedSequence, occurredAt: maintainedSession.pendingOperationEvents.get('compaction').occurredAt }])
        const watermark = maintenanceWorker.latestSequence
        maintenanceWorker.flushReplay()
        assert.equal(maintenanceEvents.filter(entry => entry.event.type === 'compaction_start').length, 1, 'authoritative maintenance bypasses the old watermark exactly once per attachment')
        assert.equal(maintenanceEvents.find(entry => entry.event.type === 'compaction_start')?.metadata.sequence, maintainedSequence)
        assert.equal(maintenanceWorker.latestSequence, watermark, 'older authoritative recovery never rewinds the event cursor')
        workers[1].emit('event', { type: 'compaction_end', reason: 'manual', aborted: true })
        await waitUntil(() => maintenanceEvents.some(entry => entry.event.type === 'compaction_end'))
        assert.equal(maintenanceEvents.find(entry => entry.event.type === 'compaction_end')?.event.startedSequence, maintainedSequence, 'live terminal retains identity even after its start was evicted')
    } finally { maintenanceWorker.dispose(); maintenanceConnection.close() }

    const terminalCursor = maintainedSession.sequence - 1
    const terminalConnection = new DesktopAgentServerConnection(root, { stateDirectory, channel, autoStart: false, authorityProof: 'desktop-test-authority' })
    const terminalWorker = terminalConnection.createWorker(project, terminalCursor)
    const terminalEvents: any[] = []
    terminalWorker.onEvent(event => terminalEvents.push(event))
    try {
        await terminalWorker.request('connect', { cwd: project, localThreadId: 'assistant-thread:desktop-test', threadId: 'chat:desktop-test', providerThreadId: 'chat:desktop-test', pluginSkillSources: workers[1].connectPayloads[0]?.pluginSkillSources })
        terminalWorker.flushReplay()
        assert.equal(terminalEvents.filter(event => event.type === 'compaction_start').length, 0, 'cursor already consumed the persisted start')
        assert.equal(terminalEvents.find(event => event.type === 'compaction_end')?.startedSequence, maintainedSequence, 'end-only reconnect carries exact identity without replaying a start')
    } finally { terminalWorker.dispose(); terminalConnection.close() }
    workers[1].emit('event', { type: 'compaction_start', reason: 'manual' })
    const legacyStartSequence = maintainedSession.sequence
    workers[1].emit('event', { type: 'compaction_end', reason: 'manual', aborted: true })
    const oldTerminal = maintainedSession.events.at(-1)
    delete oldTerminal.event.startedSequence
    delete oldTerminal.event.startedAt
    assert.equal(maintainedSession.replay(legacyStartSequence).at(-1).event.startedSequence, legacyStartSequence, 'retained old journals backfill terminal identity before cursor filtering')
    assert.equal(oldTerminal.event.startedSequence, undefined, 'legacy enrichment leaves stored history unchanged')

    const retryProbe = new DesktopAgentServerConnection(root, { autoStart: false })
    const recoveredClient = { close: () => undefined }
    let clientCreationAttempts = 0
    ;(retryProbe as any).createClient = async () => {
        clientCreationAttempts += 1
        if (clientCreationAttempts === 1) throw new Error('intentional startup race')
        return recoveredClient
    }
    await assert.rejects((retryProbe as any).getClient(), /intentional startup race/)
    assert.equal(await (retryProbe as any).getClient(), recoveredClient, 'a failed initial client connection must be retryable')
    assert.equal(clientCreationAttempts, 2, 'the rejected client promise must not poison every later connection attempt')
    retryProbe.close()

    process.stdout.write('desktop agent-server worker tests passed\n')
} finally {
    connection.close()
    await server.stop('test cleanup')
    rmSync(stateDirectory, { recursive: true, force: true })
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for test state.')
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
}
