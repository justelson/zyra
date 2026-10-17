import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { mergeAssistantChatRecords } from '../src/shared/assistant/chat-identity'
import { remapAssistantFleetRoot } from '../src/shared/assistant/fleet-projection'
import { getAssistantEventHistoryThreadIds, shouldRehydrateAssistantHistoryAfterCanonicalEvent } from '../src/renderer/src/lib/assistant/assistant-history-state'

const root = mkdtempSync(join(tmpdir(), 'zyra-chat-identity-'))
const noop = () => undefined
mock.module('electron', () => ({
    app: { getPath: () => root, isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] }; static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const at = '2026-08-01T12:00:00.000Z'
const later = '2026-08-01T12:02:00.000Z'
const canonicalChatId = 'identity-fixture-chat'
let chats: any[] = []
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
ZyraRuntime.prototype.listCanonicalChats = async () => chats
ZyraRuntime.prototype.prewarm = async () => []
const { AssistantService } = await import('../src/main/assistant/service')
const service = new AssistantService()
const internal = service as any
try {
    await service.getSnapshot()
    const thread = createAssistantThread(at, null, root)
    thread.id = 'original-local-thread'
    thread.runtimeMode = 'approval-required'
    const original = createAssistantSessionRecord({ sessionId: 'original-session', title: 'Original chat', projectPath: null, createdAt: at, thread })
    internal.appendEvent('session.created', at, { session: original }, original.id, thread.id)
    chats = [{ canonicalChatId, aliases: [thread.id], sessionPath: join(root, 'session.jsonl'), project: root, cwd: root,
        title: 'Fixture chat', createdAt: at, modifiedAt: at, archived: false, messageCount: 0, entryCount: 1 }]
    // Catalog discovery wins the race against thread.started assigning providerThreadId.
    await internal.importCanonicalChats()
    let snapshot = internal.state.snapshot
    assert.equal(snapshot.sessions.length, 1, 'catalog aliases must reuse the local chat before its provider ID arrives')
    assert.equal(snapshot.sessions[0].threads[0].providerThreadId, canonicalChatId)
    assert.equal(snapshot.sessions[0].projectPath, null, 'discovering a global chat must not assign a Project')

    const duplicateThread = createAssistantThread(at, null, root)
    duplicateThread.id = 'assistant-thread:shared:fixture'
    duplicateThread.providerThreadId = canonicalChatId
    duplicateThread.runtimeMode = 'full-access'
    duplicateThread.latestTurn = { id: 'stopped-turn', state: 'interrupted', requestedAt: at, startedAt: at, completedAt: at, assistantMessageId: null }
    const duplicate = createAssistantSessionRecord({ sessionId: 'assistant-session:shared:fixture', title: 'Fixture chat', projectPath: root, createdAt: at, thread: duplicateThread })
    internal.appendEvent('session.created', at, { session: duplicate }, duplicate.id, duplicateThread.id)
    internal.appendEvent('thread.message.assistant.delta', later, { threadId: duplicateThread.id, messageId: 'saved-final', text: 'The completed final response.', turnId: 'completed-turn', phase: 'final_answer' }, duplicate.id, duplicateThread.id)
    internal.appendEvent('thread.message.assistant.completed', later, { threadId: duplicateThread.id, messageId: 'saved-final', text: 'The completed final response.', message: {
        id: 'saved-final', role: 'assistant', text: 'The completed final response.', turnId: 'completed-turn', streaming: false, createdAt: later, updatedAt: later, phase: 'final_answer'
    } }, duplicate.id, duplicateThread.id)
    internal.appendEvent('thread.latest-turn.updated', later, { threadId: thread.id, latestTurn: {
        id: 'completed-turn', state: 'completed', requestedAt: later, startedAt: later, completedAt: later, assistantMessageId: 'saved-final'
    } }, original.id, thread.id)
    const beforeRepair = internal.state.snapshot
    assert.equal(mergeAssistantChatRecords(beforeRepair, original.id, thread.id, original.id, thread.id), beforeRepair, 'a merge cannot delete its own survivor')
    const unrelated = { ...beforeRepair, sessions: beforeRepair.sessions.map((session: any) => session.id !== duplicate.id ? session : {
        ...session, threads: [{ ...session.threads[0], providerThreadId: 'different-chat' }]
    }) }
    assert.equal(mergeAssistantChatRecords(unrelated, original.id, thread.id, duplicate.id, duplicateThread.id), unrelated, 'different canonical chats never merge')
    const conflicting = structuredClone(beforeRepair)
    const originalThread = conflicting.sessions.find((session: any) => session.id === original.id).threads[0]
    const importedThread = conflicting.sessions.find((session: any) => session.id === duplicate.id).threads[0]
    originalThread.messages = [{ ...importedThread.messages[0], text: 'Partial answer', streaming: true }]
    importedThread.latestTurn = { ...originalThread.latestTurn, state: 'interrupted', completedAt: '2026-08-01T12:03:00.000Z' }
    const request = { id: 'pending-input', requestId: 'runtime-input', questions: [], status: 'pending', answers: null, turnId: 'completed-turn', createdAt: at, resolvedAt: null }
    originalThread.pendingUserInputs = [request]
    originalThread.pendingApprovals = [{ ...request, id: 'pending-approval', requestId: 'runtime-approval', requestType: 'command', decision: null }]
    originalThread.hasPendingApprovals = originalThread.hasPendingUserInputs = true
    originalThread.state = 'waiting'
    importedThread.pendingUserInputs = [{ ...request, id: 'resolved-input-alias', status: 'resolved', answers: { choice: 'yes' }, resolvedAt: later }]
    importedThread.pendingApprovals = [{ ...originalThread.pendingApprovals[0], status: 'resolved', decision: 'accept', resolvedAt: later }]
    const fleet = (rootThreadId: string, sequence: number, updatedAt: string) => ({ version: 1, fleetId: 'fixture-fleet', rootSessionId: original.id,
        rootThreadId, lastAppliedSequence: sequence, updatedAt, agents: {}, workflows: {}, relationships: [], artifacts: [], eventWindow: [], usage: {},
        truncated: { agents: false, workflows: false, relationships: false, artifacts: false, events: false } })
    const canonicalFleet = fleet(canonicalChatId, 1, at)
    assert.equal(remapAssistantFleetRoot(canonicalFleet,
        { rootThreadId: duplicateThread.id, rootSessionId: duplicate.id }, { rootThreadId: thread.id, rootSessionId: original.id }).rootThreadId,
    canonicalChatId, 'local alias repair must not replace canonical runtime root identity')
    conflicting.fleetByThreadId = { [thread.id]: fleet(thread.id, 3, later), [duplicateThread.id]: fleet(duplicateThread.id, 4, at) }
    conflicting.fleetByThreadId[duplicateThread.id].artifacts = [{ artifactId: 'retained-artifact', agentRunId: null, workflowRunId: null, kind: 'report', path: null, createdAt: at }]
    const merged = mergeAssistantChatRecords(conflicting, original.id, thread.id, duplicate.id, duplicateThread.id)
    const mergedThread = merged.sessions.find((session: any) => session.id === original.id)!.threads[0]
    assert.equal(mergedThread.messages[0].text, 'The completed final response.', 'a finished answer wins over a partial with the same message ID')
    assert.equal(mergedThread.messages[0].streaming, false)
    assert.equal(mergedThread.latestTurn?.state, 'completed', 'a stale later interruption cannot demote the same completed turn')
    assert.equal(mergedThread.pendingUserInputs.length, 1, 'runtime request identity collapses differing local aliases')
    assert.equal(mergedThread.pendingUserInputs[0].status, 'resolved', 'resolved input beats stale preferred pending state')
    assert.equal(mergedThread.pendingApprovals[0].status, 'resolved', 'resolved approval beats stale preferred pending state')
    assert.equal(mergedThread.hasPendingUserInputs, false)
    assert.equal(mergedThread.hasPendingApprovals, false)
    assert.notEqual(mergedThread.state, 'waiting', 'resolved requests cannot leave a completed chat blocked')
    assert.equal(merged.fleetByThreadId[thread.id].lastAppliedSequence, 4, 'newer fleet sequence wins after normalizing local aliases')
    assert.equal(merged.fleetByThreadId[thread.id].rootThreadId, thread.id)
    const reversed = structuredClone(conflicting)
    reversed.fleetByThreadId[thread.id].lastAppliedSequence = 5
    assert.equal(mergeAssistantChatRecords(reversed, original.id, thread.id, duplicate.id, duplicateThread.id).fleetByThreadId[thread.id].lastAppliedSequence, 5, 'stale duplicate fleet cannot replace survivor state')
    for (const [session, localThread, input, approval] of [[original, thread, request, originalThread.pendingApprovals[0]], [duplicate, duplicateThread, importedThread.pendingUserInputs[0], importedThread.pendingApprovals[0]]] as any[]) {
        internal.appendEvent('thread.user-input.updated', later, { threadId: localThread.id, userInput: input }, session.id, localThread.id)
        internal.appendEvent('thread.approval.updated', later, { threadId: localThread.id, approval }, session.id, localThread.id)
    }
    internal.appendEvent('thread.user-input.updated', later, { threadId: thread.id, userInput: { ...request, id: 'still-pending', requestId: 'unrelated-live-request' } }, original.id, thread.id)
    internal.persistence.projectFleet(thread.id, conflicting.fleetByThreadId[thread.id])
    internal.persistence.projectFleet(duplicateThread.id, conflicting.fleetByThreadId[duplicateThread.id])
    await internal.persistence.flush()
    // Match startup's unloaded summaries: the duplicate's response exists only in SQLite.
    internal.state.snapshot = (await internal.persistence.load()).snapshot
    assert.equal(internal.state.snapshot.sessions.length, 2)
    await internal.importCanonicalChats()
    snapshot = internal.state.snapshot
    assert.equal(snapshot.sessions.length, 1, 'already persisted duplicate imports must be merged, not just hidden')
    assert.equal(snapshot.sessions[0].id, original.id, 'retain the original local identity')
    assert.equal(snapshot.selectedSessionId, original.id, 'selection follows the duplicate into its survivor')
    const survivor = snapshot.sessions[0].threads[0]
    assert.equal(survivor.latestTurn?.state, 'completed', 'stale Interrupted cannot replace a newer completed final')
    assert.equal(survivor.runtimeMode, 'approval-required', 'imported permissions must never widen the original chat')
    assert.equal(snapshot.sessions[0].projectPath, null)
    await internal.persistence.flush()
    const cold = (await internal.persistence.load()).snapshot
    assert.equal(cold.sessions.length, 1, 'repair persists across restart')
    const hydrated = await internal.persistence.hydrateSelectedSession(cold, original.id)
    assert.ok(hydrated.sessions[0].threads[0].messages.some((message: any) => message.id === 'saved-final' && message.text === 'The completed final response.'), 'move unloaded final-response rows before deleting the duplicate cache')
    const hydratedThread = hydrated.sessions[0].threads[0]
    assert.equal(hydratedThread.pendingUserInputs.length, 2, 'resolved alias and unrelated cold pending request both persist')
    assert.equal(hydratedThread.pendingUserInputs.find((input: any) => input.requestId === request.requestId).status, 'resolved')
    assert.equal(survivor.hasPendingUserInputs, true, 'cold repair must retain unrelated pending attention')
    assert.equal(hydratedThread.pendingApprovals[0].status, 'resolved')
    assert.equal((await internal.persistence.readFleet(thread.id)).lastAppliedSequence, 4, 'newer fleet persists across cold repair')
    assert.equal((await internal.persistence.readFleet(thread.id)).rootThreadId, thread.id)
    assert.equal((await internal.persistence.readFleet(thread.id)).artifacts[0].artifactId, 'retained-artifact', 'newer fleet artifacts survive reprojection')
    assert.equal(await internal.persistence.readFleet(duplicateThread.id), null, 'only the redundant fleet projection is removed')
    const mergedEvent = internal.state.events.findLast((event: any) => event.type === 'session.merged')
    assert.ok(shouldRehydrateAssistantHistoryAfterCanonicalEvent(mergedEvent, thread.id), 'repair invalidates even an already open survivor history cache')
    assert.ok(getAssistantEventHistoryThreadIds(beforeRepair, [mergedEvent]).has(duplicateThread.id), 'renderer can materialize retained duplicate evidence during the merge')
    // The fleet payload can still name the removed local alias even after the
    // event's outer thread ID is routed to the survivor.
    internal.state.snapshot.fleetByThreadId[thread.id] = await internal.persistence.readFleet(thread.id)
    internal.fleetProjection.apply(thread.id, internal.state.snapshot.fleetByThreadId[thread.id])
    internal.handleRuntimeEvent({ eventId: 'late-stale-fleet', type: 'fleet.snapshot.updated', createdAt: later,
        threadId: duplicateThread.id, providerThreadId: canonicalChatId,
        payload: { eventType: 'agent.activity', event: {}, snapshot: { ...fleet(duplicateThread.id, 3, later), rootSessionId: duplicate.id } } })
    assert.equal(internal.state.snapshot.fleetByThreadId[thread.id].lastAppliedSequence, 4, 'late lower-sequence alias fleet cannot erase newer survivor state')
    internal.handleRuntimeEvent({ eventId: 'late-new-fleet', type: 'fleet.snapshot.updated', createdAt: later,
        threadId: duplicateThread.id, providerThreadId: canonicalChatId,
        payload: { eventType: 'agent.completed', event: {}, snapshot: { ...fleet(duplicateThread.id, 5, later), rootSessionId: duplicate.id } } })
    assert.equal(internal.state.snapshot.fleetByThreadId[thread.id].lastAppliedSequence, 5, 'fresh late fleet evidence still reaches the survivor')
    assert.equal(internal.state.snapshot.fleetByThreadId[thread.id].rootThreadId, thread.id)
    assert.equal(internal.state.snapshot.fleetByThreadId[thread.id].rootSessionId, original.id)
    await internal.persistence.flush()
    assert.equal((await internal.persistence.readFleet(thread.id)).lastAppliedSequence, 5, 'normalized fresh fleet survives persistence')
    internal.handleRuntimeEvent({ eventId: 'late-alias-config', type: 'session.config.updated', createdAt: later,
        threadId: duplicateThread.id, providerThreadId: canonicalChatId,
        payload: { model: 'different-model', runtimeMode: 'full-access', thinking: 'high', webSearch: true, webFetch: true } })
    assert.equal(internal.state.snapshot.sessions[0].threads[0].runtimeMode, 'approval-required', 'late imported-worker configuration cannot widen the original permissions')
    internal.handleRuntimeEvent({ eventId: 'late-alias-message', type: 'content.delta', createdAt: later,
        threadId: duplicateThread.id, providerThreadId: canonicalChatId, turnId: 'completed-turn', itemId: 'late-message',
        payload: { streamKind: 'assistant_text', delta: 'A late response from the imported worker.' } })
    internal.assistantTextDeltaBuffer.flush({ threadId: thread.id })
    assert.ok(internal.state.snapshot.sessions[0].threads[0].messages.some((message: any) => message.text.includes('A late response')), 'late worker events through the removed alias reach the survivor')
    await internal.importCanonicalChats()
    assert.equal(internal.state.snapshot.sessions.length, 1, 'repair is idempotent')
    // An older server, or a catalog read before alias registration, can still
    // discover the transcript first. The later attachment must trigger repair.
    const pendingThread = createAssistantThread(at, null, root)
    pendingThread.id = 'late-binding-local-thread'
    const pending = createAssistantSessionRecord({ sessionId: 'late-binding-session', title: 'Pending chat', projectPath: null, createdAt: at, thread: pendingThread })
    internal.appendEvent('session.created', at, { session: pending }, pending.id, pendingThread.id)
    chats.push({ ...chats[0], canonicalChatId: 'late-binding-chat', aliases: undefined })
    await internal.importCanonicalChats()
    assert.equal(internal.state.snapshot.sessions.length, 3, 'alias-less discovery demonstrates the pre-attachment duplicate')
    internal.runtime.emit('runtime', { eventId: 'late-bind', type: 'thread.started', createdAt: later,
        threadId: pendingThread.id, providerThreadId: 'late-binding-chat',
        payload: { providerThreadId: 'late-binding-chat', cwd: root, state: 'ready' } })
    await internal.queueCanonicalChatImport()
    assert.equal(internal.state.snapshot.sessions.length, 2, 'late attachment reconciles the alias-less imported copy')
    assert.ok(internal.state.snapshot.sessions.some((session: any) => session.id === pending.id && session.projectPath === null))
    console.log('Canonical chat alias race, saved duplicate repair and completed final continuity: ok')
} finally {
    await service.dispose()
    rmSync(root, { recursive: true, force: true })
}
