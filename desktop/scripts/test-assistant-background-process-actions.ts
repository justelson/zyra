import assert from 'node:assert/strict'
import { requestAssistantBackgroundProcesses } from '../src/main/assistant/service-background-processes'
import { readAssistantBackgroundProcessList } from '../src/shared/assistant/background-processes'

const job = { jobId: 'cmd-1', toolCallId: 'call-1', command: 'npm run dev', status: 'running', background: true, startedAt: '2026-10-04T12:00:00Z' }
const jobs = readAssistantBackgroundProcessList([job])
assert.equal(jobs[0]!.status, 'running')
assert.throws(() => readAssistantBackgroundProcessList(undefined), /process list/)
assert.throws(() => readAssistantBackgroundProcessList([{ ...job, status: 'unknown' }]), /snapshot/)
assert.throws(() => readAssistantBackgroundProcessList([{ ...job, background: undefined }]), /snapshot/)
const thread = { id: 'thread-a', providerThreadId: 'zyra_canonical-a' }
const otherThread = { id: 'thread-b', providerThreadId: 'zyra_canonical-b' }
const sessions = [{ id: 'session-a', activeThreadId: otherThread.id, threads: [thread, otherThread] }]
let attached = false
const calls: unknown[][] = []
const deps = {
    ensureReady: async () => {},
    getSnapshot: () => ({ selectedSessionId: 'some-other-session', sessions }),
    connectSessionRuntime: async (_session: unknown, target: unknown) => { assert.equal(target, thread); attached = true },
    runtime: {
        hasSession: () => attached,
        requestBackgroundProcessOperation: async (...args: unknown[]) => { calls.push(args); return jobs }
    }
}
const target = { sessionId: 'session-a', threadId: 'thread-a' }
assert.equal((await requestAssistantBackgroundProcesses(deps as never, 'list', target)).jobs[0]!.jobId, 'cmd-1')
assert.deepEqual(calls[0], ['zyra_canonical-a', 'list', {}], 'process reads bind to the displayed thread, not changed global selection')
await requestAssistantBackgroundProcesses(deps as never, 'stop', { ...target, jobId: 'cmd-1' })
assert.deepEqual(calls[1], ['zyra_canonical-a', 'stop', { jobId: 'cmd-1', all: undefined }])
await requestAssistantBackgroundProcesses(deps as never, 'stop', { ...target, all: true })
assert.deepEqual(calls[2], ['zyra_canonical-a', 'stop', { jobId: undefined, all: true }])
for (const invalid of [undefined, {}, { ...target, threadId: 'foreign-thread' }, { ...target, sessionId: 'missing' }]) {
    await assert.rejects(requestAssistantBackgroundProcesses(deps as never, 'list', invalid as never))
}
for (const invalid of [{ ...target }, { ...target, jobId: 'cmd-1', all: true }, { ...target, jobId: '' }, { ...target, all: false }]) {
    await assert.rejects(requestAssistantBackgroundProcesses(deps as never, 'stop', invalid), /Choose one process/)
}
assert.equal(calls.length, 3, 'invalid controls must never reach any worker')
deps.runtime.requestBackgroundProcessOperation = async () => { throw new Error('Process cleanup could not be confirmed') }
await assert.rejects(requestAssistantBackgroundProcesses(deps as never, 'stop', { ...target, jobId: 'cmd-1' }), /could not be confirmed/)
console.log('Background process actions: live snapshots, captured ownership, reattachment, explicit controls and cleanup failure passed')
