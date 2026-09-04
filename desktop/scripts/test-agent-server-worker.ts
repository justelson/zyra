import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DesktopAgentServerConnection, resolveDesktopAgentServerNamespace } from '../src/main/assistant/zyra-agent-server-worker'

class FakeWorker extends EventEmitter {
    activePrompt: ((value: Record<string, unknown>) => void) | null = null
    disposed = false
    isAlive(): boolean { return !this.disposed }
    request(type: string): Promise<Record<string, unknown>> {
        if (type === 'connect') return Promise.resolve({ threadId: 'chat:desktop-test', providerThreadId: sessionPath })
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
        profile: 'default'
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
        providerThreadId: 'chat:desktop-test'
    })

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
    await waitUntil(() => events.length === 2)
    assert.equal((events[0].event as { type: string }).type, 'message_update')
    assert.equal(events[0].metadata?.turnId, 'turn:desktop-test')
    assert.equal(events[0].metadata?.localThreadId, 'assistant-thread:desktop-test')
    assert.equal((events[1].event as { type: string }).type, 'zyra_server_turn_completed')
    assert.equal(secondEvents.length, 2, 'two local Desktop projections must receive the same canonical events')

    worker.dispose()
    assert.equal(workers[0].disposed, false, 'desktop detach must leave the server-owned worker alive')
    workers[0].emit('event', { type: 'message_update', message: { role: 'assistant', content: 'second projection remains' } })
    await waitUntil(() => secondEvents.length === 3)
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
        providerThreadId: 'chat:desktop-test'
    })
    reconnectWorker.flushReplay()
    assert.equal(replay.length, 2, 'a persisted sequence watermark must skip already-projected events')
    assert.equal(replay[0]?.replay, true)
    assert.equal(replay[0]?.turnId, 'turn:desktop-test')
    const latestSequence = reconnectWorker.latestSequence
    reconnectWorker.markRemoteDetached()
    assert.equal(reconnectWorker.latestSequence, latestSequence, 'transport reconnects must retain the replay watermark')
    reconnectWorker.dispose()
    reconnectConnection.close()

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
