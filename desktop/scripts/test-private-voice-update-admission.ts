import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'

// Real ZyraRuntime prototype and real private-worker IPC. No SDK, app, installer,
// existing profile, real server or process outside this temporary fixture.
const root = await mkdtemp(join(tmpdir(), 'zyra-voice-update-'))
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ app: { getPath: () => root, isReady: () => true, on: noop, once: noop } }))
mock.module('../src/main/zyra/zyra-root', () => ({ resolveZyraRoot: () => root }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => new Proxy({
    grants: { list: () => [], listPending: () => [] }
}, { get: (target, key) => key in target ? target[key as keyof typeof target] : noop }) }))
await mkdir(join(root, 'src'), { recursive: true })
const logFile = join(root, 'requests.jsonl')
await writeFile(join(root, 'src', 'zyra-ui-bridge.mjs'), `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
let jobs = [], failCleanup = false;
const log = value => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(value) + '\\n');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (id, result = {}) => send({ type: 'response', id, ok: true, result });
const event = value => send({ type: 'event', event: value });
createInterface({ input: process.stdin }).on('line', async line => {
  const { id, type, payload = {} } = JSON.parse(line);
  log({ pid: process.pid, type, payload });
  if (type === 'connect') {
    if (payload.profile === 'delayed-connect') await new Promise(resolve => setTimeout(resolve, 100));
    return reply(id, { threadId: 'fixture-' + process.pid });
  }
  if (type === 'dispose') {
    await new Promise(resolve => setTimeout(resolve, 80));
    if (failCleanup) return send({ type: 'response', id, ok: false, error: 'synthetic cleanup failed' });
    jobs = jobs.map(job => ({ ...job, status: 'stopped' }));
    log({ type: 'cleanup-confirmed', pid: process.pid });
    reply(id);
    await new Promise(resolve => setTimeout(resolve, 100));
    log({ type: 'worker-exiting', pid: process.pid });
    return process.exit(0);
  }
  if (type === 'managed_bash.list') return reply(id, { jobs });
  if (type !== 'prompt') return reply(id);
  failCleanup = payload.turnId === 'cleanup-fail';
  if (payload.turnId === 'long') return; // only acknowledged cleanup can settle this task
  if (payload.turnId === 'server' || failCleanup) {
    jobs = [{ jobId: 'cmd-1', command: 'synthetic background', startedAt: new Date().toISOString(),
      status: 'running', background: true }];
    event({ type: 'managed_bash_job_update', ...jobs[0] });
  }
  event({ type: 'message_end', message: { id: payload.turnId, role: 'assistant', stopReason: 'stop',
    content: [{ type: 'text', text: 'fixture result' }] } });
  reply(id);
});
`)
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const runtimes: InstanceType<typeof ZyraRuntime>[] = []
const activity = { activeTurns: 0, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 }
const input = (taskId: string) => ({ taskId, localThreadId: 'chat-' + taskId, cwd: root, prompt: taskId, signal: new AbortController().signal })
const install = (stopBlockers: boolean) => ({ expectedInstanceId: 'exact-instance', expectedNamespaceId: 'exact-namespace', targetVersion: 'fixture', stopBlockers, operationId: 'exact-operation' })
const requests = async (): Promise<any[]> => {
    try { return (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error }
}
const until = async (predicate: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (await predicate()) return
        await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Fixture did not reach expected state')
}
const fixture = () => {
    const runtime = new ZyraRuntime()
    runtimes.push(runtime)
    let prepared = 0, committed = 0, cancelled = 0, legacyActivations = 0
    const connection = {
        inspectRuntimeInstallation: async () => ({ instance: { instanceId: 'exact-instance', namespaceId: 'exact-namespace' }, activity: { ...activity }, methods: ['server.prepareUpdate'] }),
        prepareRuntimeInstallation: async (value: unknown, onPrepared: () => Promise<void>) => {
            assert.deepEqual(value, install((value as any).stopBlockers), 'exact lease identity/options must pass through unchanged')
            prepared++
            await onPrepared()
            committed++
        },
        activateRuntimeUpdate: async (value: any) => {
            if (value === undefined) { legacyActivations++; return }
            assert.equal(value.expectedInstanceId, 'exact-instance')
            prepared++
            await value.onPrepared()
            committed++
        },
        cancelRuntimeInstallation: async () => { cancelled++ },
        close: noop
    }
    ;(runtime as any).agentServerConnection = connection
    return { runtime, counts: () => ({ prepared, committed, cancelled, legacyActivations }) }
}
try {
    const active = fixture()
    const running = active.runtime.runPrivateVoiceTask(input('long'))
    const stopped = assert.rejects(running, /update|stopped|bridge/i)
    await until(async () => (await requests()).some(value => value.type === 'prompt' && value.payload.turnId === 'long'))
    assert.equal((await active.runtime.inspectRuntimeInstallation()).activity.activeTurns, 1, 'canonical idle must include private active work')
    await assert.rejects(active.runtime.prepareRuntimeInstallation(install(false)), /work|blocker|review/i)
    await assert.rejects(active.runtime.activateRuntimeUpdate({ expectedInstanceId: 'exact-instance', stopBlockers: false }), /work|blocker|review/i)
    assert.equal(active.counts().prepared, 0)
    assert.equal((await requests()).filter(value => value.type === 'dispose').length, 0, 'false consent must not stop anything')
    let orchestration = false
    const preparing = active.runtime.prepareRuntimeInstallation(install(true), async () => { orchestration = true })
    await until(async () => (await requests()).some(value => value.type === 'dispose'))
    assert.equal(orchestration, true)
    assert.equal(active.counts().committed, 0, 'cannot hand off while cleanup is pending')
    await assert.rejects(active.runtime.runPrivateVoiceTask(input('late')), /update|prepared/i)
    await assert.rejects(active.runtime.preparePrivateVoiceTask(input('late-cache')), /update|prepared/i)
    await preparing
    await stopped
    assert.equal(active.counts().committed, 1)
    assert.ok((await requests()).some(value => value.type === 'cleanup-confirmed'))
    assert.ok((await requests()).some(value => value.type === 'worker-exiting'), 'installer admission waits for actual worker exit after the cleanup acknowledgement')
    await assert.rejects(active.runtime.runPrivateVoiceTask(input('still-prepared')), /update|prepared/i)
    await active.runtime.cancelRuntimeInstallation()
    await active.runtime.runPrivateVoiceTask(input('after-cancel'))

    const background = fixture()
    await background.runtime.runPrivateVoiceTask(input('server'))
    const observed = await background.runtime.inspectRuntimeInstallation()
    assert.equal(observed.activity.activeTurns, 0)
    assert.equal(observed.activity.backgroundChats, 1, 'retained background-only work blocks installation')
    await assert.rejects(background.runtime.prepareRuntimeInstallation(install(false)), /work|blocker|review/i)
    await background.runtime.prepareRuntimeInstallation(install(true))
    assert.equal((await background.runtime.inspectRuntimeInstallation()).activity.backgroundChats, 0)
    await background.runtime.cancelRuntimeInstallation()

    const idle = fixture()
    await idle.runtime.prepareRuntimeInstallation(install(false), async () => {
        // An attempted new admission during the remote lease/prepared callback is refused.
        await assert.rejects(idle.runtime.runPrivateVoiceTask(input('callback-late')), /update|prepared/i)
    })
    assert.equal(idle.counts().committed, 1, 'normal idle/no-consent path remains usable')
    await idle.runtime.cancelRuntimeInstallation()
    await idle.runtime.runPrivateVoiceTask(input('idle-released'))
    await idle.runtime.activateRuntimeUpdate({ expectedInstanceId: 'exact-instance', stopBlockers: false })
    await idle.runtime.runPrivateVoiceTask(input('activation-released'))
    await idle.runtime.activateRuntimeUpdate()
    assert.equal(idle.counts().legacyActivations, 1, 'an idle legacy caller retains the existing no-options retirement path')
    await idle.runtime.runPrivateVoiceTask(input('legacy-activation-released'))

    const fresh = fixture()
    await assert.rejects(fresh.runtime.prepareRuntimeInstallation(install(false), async () => {
        // Synthetic pre-existing local admission becoming visible during async orchestration.
        ;(fresh.runtime as any).privateVoiceActiveChats.add('late-visible')
    }), /work|blocker|review/i)
    assert.equal(fresh.counts().committed, 0, 'final admission must inspect fresh local state')
    ;(fresh.runtime as any).privateVoiceActiveChats.clear()
    await fresh.runtime.runPrivateVoiceTask(input('failed-prepare-released'))

    const claiming = fixture()
    const delayed = { ...input('claimed-before-update'), profile: 'delayed-connect' }
    const warming = claiming.runtime.preparePrivateVoiceTask(delayed)
    await until(async () => (await requests()).some(value => value.type === 'connect' && value.payload.profile === 'delayed-connect'))
    const claimedWorker = (claiming.runtime as any).preparedPrivateVoiceWorker.worker
    try {
        const claim = claiming.runtime.runPrivateVoiceTask(delayed)
        const claimStopped = assert.rejects(claim, /update|prepared|stopped/i)
        await until(async () => (claiming.runtime as any).preparedPrivateVoiceWorker?.claimed === true)
        const pid = (await requests()).find(value => value.type === 'connect' && value.payload.profile === 'delayed-connect').pid
        await claiming.runtime.prepareRuntimeInstallation(install(true), async () => {
            // Voice ending during confirmation may invalidate the cache while an
            // already-accepted task is awaiting its prewarmed worker connection.
            claiming.runtime.disposePreparedPrivateVoiceTask()
        })
        await warming
        await claimStopped
        assert.ok((await requests()).some(value => value.pid === pid && value.type === 'cleanup-confirmed'), 'claimed prewarmed worker cleanup must be acknowledged even after cache invalidation')
        await claiming.runtime.cancelRuntimeInstallation()
    } finally { claimedWorker.dispose() }

    const failed = fixture()
    await failed.runtime.runPrivateVoiceTask(input('cleanup-fail'))
    await assert.rejects(failed.runtime.prepareRuntimeInstallation(install(true)), /cleanup failed/)
    assert.equal(failed.counts().committed, 0)
    assert.equal((await failed.runtime.inspectRuntimeInstallation()).activity.backgroundChats, 1, 'failed cleanup retains ownership/blocker')
    await assert.rejects(failed.runtime.prepareRuntimeInstallation(install(false)), /work|blocker|review/i)

    const unknown = fixture()
    await unknown.runtime.runPrivateVoiceTask({ ...input('server'), localThreadId: 'chat-unknown-background' })
    const owner = [...(unknown.runtime as any).privateVoiceBackgroundWorkers.values()][0] as any
    owner.worker.dispose() // loss of the owner cannot be interpreted as proof its command stopped
    await assert.rejects(unknown.runtime.prepareRuntimeInstallation(install(true)), /cleanup.*confirmed/i)
    assert.equal(unknown.counts().committed, 0)
    console.log('PASS private Voice update admission: active/background inspection, false consent, fresh final check, await cleanup, held admission, cancellation, activation and fail-closed cleanup')
} finally {
    for (const runtime of runtimes) runtime.dispose()
    await new Promise(resolve => setTimeout(resolve, 150))
    await rm(root, { recursive: true, force: true })
}
