import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { PrivateVoiceTaskContext } from '../src/main/assistant/voice/private-voice-task-context'

// Exercise real runtime methods and bridge IPC, without SDK/provider calls or a user profile.
const root = await mkdtemp(join(tmpdir(), 'zyra-private-voice-'))
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ app: { getPath: () => root, isReady: () => true, on: noop, once: noop } }))
mock.module('../src/main/zyra/zyra-root', () => ({ resolveZyraRoot: () => root }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => new Proxy({
    grants: { list: () => [], listPending: () => [] }
}, { get: (target, key) => key in target ? target[key as keyof typeof target] : noop }) }))
await mkdir(join(root, 'src'), { recursive: true })
const logFile = join(root, 'bridge-requests.jsonl')
await writeFile(join(root, 'src', 'zyra-ui-bridge.mjs'), `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = ${JSON.stringify(logFile)};
let jobs = [];
let activePrompt = null;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const event = value => send({ type: 'event', event: value });
const reply = (id, result = {}) => send({ type: 'response', id, ok: true, result });
createInterface({ input: process.stdin }).on('line', async line => {
  const { id, type, payload = {} } = JSON.parse(line);
  appendFileSync(log, JSON.stringify({ pid: process.pid, type, payload }) + '\\n');
  if (type === 'connect') return reply(id, { threadId: 'fixture-private-' + process.pid });
  if (type === 'dispose') return process.exit(0);
  if (type === 'managed_bash.list') return reply(id, { jobs });
  if (type === 'managed_bash.stop') {
    jobs = jobs.map(job => payload.all || payload.jobId === job.jobId ? { ...job, status: 'stopped' } : job);
    return reply(id, { jobs });
  }
  if (type === 'abort') {
    if (activePrompt !== null) send({ type: 'response', id: activePrompt, ok: false, error: 'synthetic task stopped' });
    activePrompt = null;
    return reply(id);
  }
  if (type !== 'prompt') return reply(id);
  event({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'artifact.txt' } });
  event({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', isError: false,
    result: { content: [{ type: 'text', text: 'completed-evidence:artifact-v1' }, { type: 'image', data: 'DO-NOT-RESTORE-IMAGE' }] } });
  if (payload.turnId === 'failure') return send({ type: 'response', id, ok: false, error: 'synthetic provider failure' });
  if (payload.turnId === 'server' || payload.turnId === 'foreground') {
    jobs = [{ jobId: 'cmd-1', toolCallId: 'bash-1', command: 'synthetic server', status: 'running',
      background: payload.turnId === 'server', startedAt: new Date().toISOString() }];
    event({ type: 'managed_bash_job_update', ...jobs[0] });
  }
  if (payload.turnId === 'long' || payload.turnId === 'cancelled') {
    activePrompt = id;
    await new Promise(resolve => setTimeout(resolve, 120));
    if (activePrompt !== id) return;
    activePrompt = null;
  }
  event({ type: 'message_end', message: { id: payload.turnId, role: 'assistant', stopReason: payload.turnId === 'provider-error' ? 'error' : 'stop', errorMessage: payload.turnId === 'provider-error' ? 'synthetic terminal failure' : undefined,
    content: [{ type: 'text', text: 'verified-result:' + payload.turnId }] } });
  reply(id);
});
`)
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const runtimes: InstanceType<typeof ZyraRuntime>[] = []
const runtime = () => { const value = new ZyraRuntime(); runtimes.push(value); return value }
const requests = async () => (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const input = (taskId: string, localThreadId = 'chat-a') => ({ taskId, localThreadId, cwd: root, prompt: `request:${taskId}`, signal: new AbortController().signal })
const latestPrompt = async () => (await requests()).filter(value => value.type === 'prompt').at(-1).payload.prompt as string
try {
    const first = runtime()
    await first.preparePrivateVoiceTask(input('prepare'))
    assert.equal((await first.runPrivateVoiceTask({ ...input('first'), prompt: 'INTERNAL_LONG_PREAMBLE '.repeat(1500), taskRequest: 'Actual original user goal.' })).text, 'verified-result:first')
    await assert.rejects(first.runPrivateVoiceTask(input('failure')), /synthetic provider failure/)
    await first.runPrivateVoiceTask(input('replacement'))
    const restored = await latestPrompt()
    assert.match(restored, /verified-result:first/)
    assert.match(restored, /"status":"failed"/)
    assert.match(restored, /completed-evidence:artifact-v1/)
    assert.doesNotMatch(restored, /DO-NOT-RESTORE-IMAGE/)
    const summary = await first.readPrivateVoiceTaskSummary('chat-a')
    assert.match(summary, /verified-result:replacement/)
    assert.match(summary, /Actual original user goal/)
    assert.doesNotMatch(summary, /INTERNAL_LONG_PREAMBLE/, 'Recovery stores the request, not a truncated execution preamble')
    assert.doesNotMatch(summary, /completed-evidence|completedToolEvidence/)
    assert.ok(Buffer.byteLength(summary, 'utf8') <= 12_000)
    first.dispose()

    const replacement = runtime()
    await replacement.runPrivateVoiceTask(input('after-runtime-replacement'))
    assert.match(await latestPrompt(), /verified-result:replacement/)
    await assert.rejects(replacement.runPrivateVoiceTask(input('provider-error', 'chat-terminal')), /synthetic terminal failure/)
    assert.match(await replacement.readPrivateVoiceTaskSummary('chat-terminal'), /"status":"failed"/)
    await replacement.runPrivateVoiceTask(input('isolated', 'chat-b'))
    assert.equal(await latestPrompt(), 'request:isolated', 'different Chats must never receive private history')

    const narrowed = { ...input('narrowed'), filesystemScope: {
        projectId: 'synthetic-project', revision: 2, workingRoot: root,
        roots: [{ id: 'root', kind: 'project-home' as const, path: root, label: 'Fixture', access: 'read-only' as const }],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }, runtimeMode: 'read-only' as const, model: 'openai-codex/fixture', profile: 'builder' }
    await replacement.runPrivateVoiceTask(narrowed)
    const connected = (await requests()).filter(value => value.type === 'connect').at(-1).payload
    assert.equal(connected.noSession, true, 'private work must not create a canonical session')
    assert.equal(connected.runtimeMode, 'read-only')
    assert.equal(connected.model, narrowed.model)
    assert.deepEqual(connected.filesystemScope, narrowed.filesystemScope)
    assert.equal(connected.profile, 'builder')
    assert.match(await latestPrompt(), /Use current filesystem scope, approvals and configuration/)

    const journalDirectory = join(root, 'assistant', 'agent-server', 'private-voice-tasks')
    const abandoned = new PrivateVoiceTaskContext(journalDirectory)
    await abandoned.begin('chat-crash', 'crashed', 'unfinished request')
    await abandoned.recordEvidence('chat-crash', 'crashed', { type: 'tool_execution_end', toolName: 'write', result: { content: [{ type: 'text', text: 'artifact already written' }] } })
    const recovered = runtime()
    await recovered.runPrivateVoiceTask(input('recover-crash', 'chat-crash'))
    assert.match(await latestPrompt(), /"status":"interrupted"/)
    assert.match(await latestPrompt(), /artifact already written/)

    await recovered.preparePrivateVoiceTask(input('prepare-long', 'chat-long'))
    const pending = recovered.runPrivateVoiceTask(input('long', 'chat-long'))
    for (let attempt = 0; attempt < 100; attempt++) {
        if ((await requests()).some(value => value.type === 'prompt' && value.payload.turnId === 'long')) break
        await new Promise(resolve => setTimeout(resolve, 5))
    }
    recovered.disposePreparedPrivateVoiceTask() // Voice ended while accepted work was running.
    assert.equal((await pending).text, 'verified-result:long')

    const controller = new AbortController()
    const cancelled = recovered.runPrivateVoiceTask({ ...input('cancelled', 'chat-cancelled'), signal: controller.signal })
    const rejected = assert.rejects(cancelled, /synthetic task stopped|cancelled|abort/i)
    for (let attempt = 0; attempt < 100; attempt++) {
        if ((await requests()).some(value => value.type === 'prompt' && value.payload.turnId === 'cancelled')) break
        await new Promise(resolve => setTimeout(resolve, 5))
    }
    controller.abort()
    await rejected
    assert.match(await recovered.readPrivateVoiceTaskSummary('chat-cancelled'), /"status":"cancelled"/)
    await recovered.runPrivateVoiceTask(input('after-stop', 'chat-cancelled'))
    assert.match(await latestPrompt(), /"status":"cancelled"/)
    assert.match(await latestPrompt(), /completed-evidence:artifact-v1/)

    await recovered.runPrivateVoiceTask(input('server', 'chat-server'))
    recovered.disposePreparedPrivateVoiceTask()
    const jobs = await recovered.requestBackgroundProcessOperation('chat-server', 'list')
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].background, true)
    assert.equal(jobs[0].status, 'running', 'managed background handoff survives task/call ending')
    assert.match(jobs[0].jobId, /voice-private:.*\/cmd-1$/)
    await assert.rejects(recovered.requestBackgroundProcessOperation('chat-unrelated', 'list'))
    await assert.rejects(recovered.requestBackgroundProcessOperation('chat-unrelated', 'stop', { jobId: jobs[0].jobId }), /does not belong/)
    const stopped = await recovered.requestBackgroundProcessOperation('chat-server', 'stop', { jobId: jobs[0].jobId })
    assert.equal(stopped[0].status, 'stopped')
    await assert.rejects(recovered.runPrivateVoiceTask(input('foreground', 'chat-foreground')), /foreground command finished/)
    assert.match(await recovered.readPrivateVoiceTaskSummary('chat-foreground'), /"status":"failed"/)

    const history = new PrivateVoiceTaskContext(join(root, 'bounded-history'))
    for (let i = 0; i < 12; i++) {
        await history.begin('bounded', String(i), 'request'.repeat(3_000))
        await history.settle('bounded', String(i), 'completed', 'outcome'.repeat(3_000))
    }
    assert.ok(Buffer.byteLength(await history.readSummary('bounded'), 'utf8') <= 12_000)
    await history.begin('unicode', 'unicode', '界'.repeat(12_000))
    await history.settle('unicode', 'unicode', 'completed', '界'.repeat(12_000))
    const unicode = await history.readSummary('unicode')
    assert.ok(Buffer.byteLength(unicode, 'utf8') <= 12_000)
    assert.match(unicode, /"status":"completed"/)
    await history.begin('emoji', 'emoji', '🌍'.repeat(12_000))
    await history.settle('emoji', 'emoji', 'completed', '🌍'.repeat(12_000))
    const emoji = await history.readSummary('emoji')
    assert.ok(Buffer.byteLength(emoji, 'utf8') <= 12_000)
    assert.match(emoji, /"status":"completed"/, 'UTF-8 budgeting must retain the latest status, not omit its entire record')
    assert.equal(await history.readSummary('other'), '')
    console.log('PASS private Voice task continuity: real runtime/bridge failure, replacement, crash recovery, Chat isolation, authority config, call end, managed process handoff and bounded summaries')
} finally {
    for (const value of runtimes) value.dispose()
    // Workers are disposable synthetic children, never an app or real server.
    await new Promise(resolve => setTimeout(resolve, 100))
    await rm(root, { recursive: true, force: true })
}
