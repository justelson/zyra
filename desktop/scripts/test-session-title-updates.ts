import assert from 'node:assert/strict'
import { mock } from 'bun:test'
mock.module('electron-log', () => ({ default: { warn: () => {}, info: () => {} } }))
const noop = () => undefined
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: {} }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { queueGeneratedSessionTitle } = await import('../src/main/assistant/session-title-generation')
const { renameAssistantSessionAction } = await import('../src/main/assistant/service-session-actions')
const { awaitCanonicalSessionTitleSaves, commitAssistantSessionTitle } = await import('../src/main/assistant/session-title-updates')
const session = { id: 'serialized-title', title: 'Fix startup', threads: [{ providerThreadId: 'synthetic-canonical' }] }
const canonical: string[] = []
let release!: () => void
const delayed = new Promise<void>(resolve => { release = resolve })
const appendEvent = (_type: unknown, _date: string, payload: Record<string, unknown>) => { Object.assign(session, payload.patch) }
const automatic = queueGeneratedSessionTitle({ sessionId: session.id, threadId: 'synthetic-thread', messageText: 'Fix startup', seedTitle: session.title, cwd: 'C:/synthetic-project',
    generateText: async () => ({ success: true, text: 'Startup repair' }), getSnapshot: () => ({ sessions: [session] as any }), appendEvent,
    onApplied: async title => { canonical.push(title); await delayed } })
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(canonical, ['Startup repair'])
const deps = { ensureReady: async () => {}, getSnapshot: () => ({ sessions: [session] }), appendEvent,
    runtime: { updateCanonicalChat: async (_id: string, patch: { title: string }) => { canonical.push(patch.title) } } }
const first = renameAssistantSessionAction(deps as never, session.id, 'My first name')
const second = renameAssistantSessionAction(deps as never, session.id, 'My latest name')
release()
await Promise.all([automatic, first, second])
assert.deepEqual(canonical, ['Startup repair', 'My first name', 'My latest name'], 'manual names commit after an already-running automatic write, without a compensating write')
assert.equal(session.title, 'My latest name')
await assert.rejects(commitAssistantSessionTitle(session.id, async () => { throw new Error('synthetic failed save') }))
assert.equal(await commitAssistantSessionTitle(session.id, () => 'Recovered'), 'Recovered', 'failed commits cannot poison later title updates')
await awaitCanonicalSessionTitleSaves([])
const firstCohortFailure = new Error('First cohort failure')
const laterCohortFailure = new Error('Later cohort failure')
await assert.rejects(awaitCanonicalSessionTitleSaves([
    Promise.resolve(), Promise.reject(firstCohortFailure), Promise.reject(laterCohortFailure)
]), error => error === firstCohortFailure, 'the cohort must propagate its first failure without swallowing errors')

for (const canonicalThreadIds of [['unavailable'], ['saved-remotely', 'unavailable']]) {
    const failedSession = {
        id: `failed-rename-${canonicalThreadIds.length}`,
        title: 'Original title',
        updatedAt: 'original-date',
        threads: canonicalThreadIds.map(providerThreadId => ({ providerThreadId }))
    }
    const appendedTitles: string[] = []
    const remoteWrites: Array<{ id: string; title: string }> = []
    let releaseFailure!: () => void
    let releaseRecovery!: () => void
    let markFailureStarted!: () => void
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve })
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve })
    const failureStarted = new Promise<void>(resolve => { markFailureStarted = resolve })
    const failedDeps = {
        ensureReady: async () => {},
        getSnapshot: () => ({ sessions: [failedSession] }),
        appendEvent: (_type: unknown, _date: string, payload: { patch: { title: string } }) => {
            appendedTitles.push(payload.patch.title)
            Object.assign(failedSession, payload.patch)
        },
        runtime: {
            updateCanonicalChat: async (id: string, patch: { title: string }) => {
                remoteWrites.push({ id, title: patch.title })
                if (patch.title === 'Failed rename' && id === 'unavailable') {
                    markFailureStarted()
                    await failureGate
                    throw new Error('Canonical chat unavailable')
                }
                if (patch.title === 'Queued recovery') await recoveryGate
            }
        }
    }
    const failedRename = renameAssistantSessionAction(failedDeps as never, failedSession.id, 'Failed rename')
    const rejected = assert.rejects(failedRename, /Canonical chat unavailable/)
    await failureStarted
    assert.equal(failedSession.title, 'Original title', 'pending canonical writes must not publish the proposed local title')
    assert.deepEqual(appendedTitles, [])
    const recovery = renameAssistantSessionAction(failedDeps as never, failedSession.id, 'Queued recovery')
    releaseFailure()
    await rejected
    assert.equal(failedSession.title, 'Original title', 'failed canonical writes must leave the local title unchanged')
    assert.equal(failedSession.updatedAt, 'original-date', 'failed canonical writes must leave local recency unchanged')
    assert.deepEqual(appendedTitles, [], 'unavailable or partially saved canonical titles must not emit a local commit')
    releaseRecovery()
    assert.deepEqual(await recovery, { success: true }, 'a rename queued behind a failed action must still succeed')
    assert.equal(failedSession.title, 'Queued recovery')
    assert.deepEqual(appendedTitles, ['Queued recovery'])
    assert.deepEqual(remoteWrites, [
        ...canonicalThreadIds.map(id => ({ id, title: 'Failed rename' })),
        ...canonicalThreadIds.map(id => ({ id, title: 'Queued recovery' }))
    ], 'failed actions must not add compensating remote writes')
}
const cohortSession = {
    id: 'slow-failed-cohort', title: 'Original cohort title',
    threads: [{ providerThreadId: 'slow-chat' }, { providerThreadId: 'fast-failure-chat' }]
}
const cohortWrites: Array<{ id: string; title: string }> = []
const cohortEvents: string[] = []
const remoteTitles = new Map<string, string>()
const fastFailure = new Error('Fast canonical failure')
let releaseSlowSave!: () => void
let markFastFailure!: () => void
let failedActionSettled = false
const slowSave = new Promise<void>(resolve => { releaseSlowSave = resolve })
const fastFailureStarted = new Promise<void>(resolve => { markFastFailure = resolve })
const cohortDeps = {
    ensureReady: async () => {},
    getSnapshot: () => ({ sessions: [cohortSession] }),
    appendEvent: (_type: unknown, _date: string, payload: { patch: { title: string } }) => {
        cohortEvents.push(`local:${payload.patch.title}`)
        Object.assign(cohortSession, payload.patch)
    },
    runtime: {
        updateCanonicalChat: async (id: string, patch: { title: string }) => {
            cohortWrites.push({ id, title: patch.title })
            cohortEvents.push(`start:${id}:${patch.title}`)
            if (patch.title === 'Old rename') {
                if (id === 'fast-failure-chat') {
                    markFastFailure()
                    throw fastFailure
                }
                await slowSave
            }
            remoteTitles.set(id, patch.title)
            cohortEvents.push(`saved:${id}:${patch.title}`)
        }
    }
}
const oldRename = renameAssistantSessionAction(cohortDeps as never, cohortSession.id, 'Old rename')
const oldRejected = assert.rejects(oldRename, error => error === fastFailure)
void oldRename.then(() => { failedActionSettled = true }, () => { failedActionSettled = true })
await fastFailureStarted
const newRename = renameAssistantSessionAction(cohortDeps as never, cohortSession.id, 'New rename')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(failedActionSettled, false, 'a fast failure must wait for the slow canonical save before releasing the queue')
assert.equal(cohortWrites.length, 2, 'the queued rename must not start any canonical writes while the prior cohort is pending')
assert.equal(cohortSession.title, 'Original cohort title')
assert.equal(cohortEvents.some(event => event.startsWith('local:')), false)
releaseSlowSave()
await oldRejected
assert.deepEqual(await newRename, { success: true })
assert.ok(cohortEvents.indexOf('saved:slow-chat:Old rename') < cohortEvents.indexOf('start:slow-chat:New rename'))
assert.equal(cohortSession.title, 'New rename')
assert.deepEqual([...remoteTitles.values()], ['New rename', 'New rename'], 'a slow prior save cannot overwrite the newer remote title')
assert.deepEqual(cohortWrites, [
    { id: 'slow-chat', title: 'Old rename' }, { id: 'fast-failure-chat', title: 'Old rename' },
    { id: 'slow-chat', title: 'New rename' }, { id: 'fast-failure-chat', title: 'New rename' }
], 'each rename sends exactly its own cohort, without compensating writes')
assert.deepEqual(cohortEvents.filter(event => event.startsWith('local:')), ['local:New rename'])
console.log('Title commits: automatic/manual ordering, canonical failures, queued recovery and fast-failure/slow-save cohort ordering: ok')
