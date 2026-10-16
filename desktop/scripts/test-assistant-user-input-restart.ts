import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { UserInputResponses } from '../../src/agent-server/user-input-responses.mjs'
import { createDefaultSnapshot } from '../src/main/assistant/projector'
import type { AssistantPendingUserInput, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'

const root = mkdtempSync(join(tmpdir(), 'zyra-question-restart-'))
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: console.error, debug: noop } }))
mock.module('electron', () => ({
    app: { getPath: () => join(root, 'profile'), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] }; static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
ZyraRuntime.prototype.listCanonicalChats = async () => []
ZyraRuntime.prototype.readCanonicalChatHistory = async () => null
ZyraRuntime.prototype.prewarm = async () => []
const connected = new Set<string>()
const prompts: { threadId: string; prompt: string; options: any }[] = []
let responseError: Error | null = null
let responseCalls = 0
const freshServerResponses = new UserInputResponses(new Set(), async () => {})
ZyraRuntime.prototype.hasSession = id => connected.has(id)
ZyraRuntime.prototype.connect = async thread => { connected.add(thread.providerThreadId || thread.id) }
ZyraRuntime.prototype.ensurePromptAvailable = async () => {}
ZyraRuntime.prototype.respondUserInput = async (_threadId, requestId, answers) => {
    responseCalls++
    if (responseError) throw responseError
    return freshServerResponses.respond('desktop-fixture', { requestId, answers }, null, async () => ({}))
}
ZyraRuntime.prototype.sendPrompt = async (threadId, prompt, options) => {
    prompts.push({ threadId, prompt, options })
    return { turnId: options!.turnId!, providerThreadId: threadId }
}
const { AssistantService } = await import('../src/main/assistant/service')
const createdAt = '2026-10-01T00:00:00.000Z'
const question: AssistantPendingUserInput = {
    id: 'saved-question', requestId: 'saved-request', status: 'pending', answers: null,
    responseMessageId: null, turnId: 'completed-handoff', createdAt, resolvedAt: null,
    questions: [{ id: 'choice', header: 'Choice', question: 'Which outcome?', type: 'single_select',
        options: [{ label: 'Keep it', description: '' }], required: true, allowOther: true }]
}
const thread: AssistantThread = {
    id: 'local-thread', providerThreadId: 'canonical-thread', source: 'root', parentThreadId: null,
    providerParentThreadId: null, subagentDepth: null, agentNickname: null, agentRole: null,
    model: 'fixture/model', cwd: root, messageCount: 1, lastSeenCompletedTurnId: null,
    runtimeMode: 'full-access', interactionMode: 'default', state: 'ready', lastError: null,
    createdAt, updatedAt: createdAt, latestTurn: null, activePlan: null,
    messages: [{ id: 'prior-user', role: 'user', text: 'Inspect the fixture.', turnId: null, streaming: false, createdAt, updatedAt: createdAt }],
    activities: [], proposedPlans: [], pendingApprovals: [], pendingUserInputs: [question]
}
const session: AssistantSession = {
    id: 'session', title: 'Existing fixture', mode: 'work', projectPath: null,
    playgroundLabId: null, pendingLabRequest: null, archived: false, createdAt, updatedAt: createdAt,
    activeThreadId: thread.id, threadIds: [thread.id], threads: [thread]
}
const snapshot = createDefaultSnapshot()
snapshot.selectedSessionId = session.id
snapshot.sessions = [session]
let service: InstanceType<typeof AssistantService> | null = null
try {
    service = new AssistantService()
    await service.getSnapshot()
    ;(service as any).state.snapshot = snapshot
    ;(service as any).persistence.replaceSnapshot(snapshot)
    await (service as any).persistence.flush()
    assert.equal((await (service as any).persistence.load()).snapshot.sessions.length, 1, 'The seeded database contains the saved chat')
    await service.dispose()
    service = new AssistantService()
    await service.getSnapshot()
    const resident = (service as any).state.snapshot.sessions.find((s: any) => s.id === session.id).threads[0]
    assert.equal(resident.hasPendingUserInputs, true)
    assert.deepEqual(resident.pendingUserInputs, [], 'Cold catalog does not preload question history')
    const detail = await service.getThreadDetailBootstrap(thread.id)
    assert.equal(detail.detail.pendingUserInputs.find(input => input.requestId === question.requestId)?.status, 'pending', 'The reopened UI can show the saved form')
    for (const code of ['AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED', 'AGENT_SERVER_TIMEOUT', 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED']) {
        responseError = Object.assign(new Error('Unknown user-input request from a different failure'), { code })
        await assert.rejects(service.respondUserInput({ requestId: question.requestId, answers: { choice: 'Keep it' } }), error => (error as any).code === code)
        assert.equal(prompts.length, 0, `${code} never bypasses a rejected or uncertain response`)
        assert.equal((await service.getThreadDetailBootstrap(thread.id)).detail.pendingUserInputs[0]!.status, 'pending', 'Rejected answers remain retryable')
    }
    responseError = null
    const callsBeforeAnswer = responseCalls
    const response = { requestId: question.requestId, answers: { choice: 'Keep it' }, contextText: 'Supporting files for these answers:\nExact saved notes.' }
    const submissions = await Promise.allSettled([service.respondUserInput(response), service.respondUserInput(response)])
    assert.equal(submissions.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent submissions have one owner')
    assert.equal(responseCalls, callsBeforeAnswer + 1, 'The saved request reaches the reattached canonical runtime once')
    assert.equal(prompts.length, 1, 'Restart recovery continues exactly once')
    assert.equal(prompts[0]!.threadId, 'canonical-thread')
    assert.match(prompts[0]!.prompt, /Choice: Keep it/)
    assert.match(prompts[0]!.prompt, /Exact saved notes\./)
    await assert.rejects(service.respondUserInput({ requestId: question.requestId, answers: { choice: 'Keep it' } }), /Unknown user-input request|already/i)
    assert.equal(prompts.length, 1, 'A resolved question cannot send another turn')
    await (service as any).persistence.flush()
    await service.dispose()
    service = new AssistantService()
    await service.getSnapshot()
    const reopened = await service.getThreadDetailBootstrap(thread.id)
    const resolved = reopened.detail.pendingUserInputs.find(input => input.requestId === question.requestId)!
    assert.equal(resolved.status, 'resolved', 'Answer receipt survives another restart')
    assert.equal(resolved.answers?.choice, 'Keep it')
    assert.ok(resolved.responseMessageId)
    await assert.rejects(service.respondUserInput({ requestId: 'foreign-request', answers: { choice: 'Keep it' } }), /Unknown user-input request/)
    assert.equal(prompts.length, 1, 'Unknown requests never become free-form continuations')

    // The UI may submit a form from an inactive/detached chat. Recover the exact
    // owner without hydrating another selected chat or accepting caller schema.
    const second = { ...question, id: 'second-question', requestId: 'second-request' }
    const secondThread = { ...thread, id: 'second-thread', providerThreadId: 'second-canonical', pendingUserInputs: [second] }
    const secondSession = { ...session, id: 'second-session', activeThreadId: secondThread.id, threadIds: [secondThread.id], threads: [secondThread] }
    const nextSnapshot = createDefaultSnapshot()
    nextSnapshot.selectedSessionId = session.id
    nextSnapshot.sessions = [{ ...session, threads: [{ ...thread, pendingUserInputs: [resolved] }] }, secondSession]
    ;(service as any).state.snapshot = nextSnapshot
    ;(service as any).persistence.replaceSnapshot(nextSnapshot)
    await (service as any).persistence.flush()
    await service.dispose()
    service = new AssistantService()
    await service.getSnapshot()
    assert.equal((service as any).state.snapshot.selectedSessionId, session.id)
    await service.respondUserInput({ requestId: second.requestId, answers: { choice: 'A custom answer' } })
    assert.equal(prompts.length, 2)
    assert.equal(prompts[1]!.threadId, 'second-canonical', 'Saved request ownership wins over the currently selected chat')
    assert.match(prompts[1]!.prompt, /A custom answer/)
    assert.equal((service as any).state.snapshot.selectedSessionId, session.id, 'Recovering a detached form does not change selection')
    console.log('Cold persisted forms, fresh server, owner routing, rejected retries, one canonical continuation and durable answer receipt: ok')
} finally {
    await service?.dispose()
    rmSync(root, { recursive: true, force: true })
}
