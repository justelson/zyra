import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { ResponseTimingRecorder } from '../src/main/diagnostics/response-timing-recorder'
import { QueuedPromptDeliveryOwner } from '../src/main/assistant/queued-prompt-delivery'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ app: { getPath: () => tmpdir(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { sendAssistantPromptAction } = await import('../src/main/assistant/service-session-actions')
const { createAssistantThread } = await import('../src/main/assistant/service-state')
const { createAssistantSessionRecord } = await import('../src/main/assistant/service-records')
const { createDefaultAssistantSnapshot, applyAssistantDomainEvent } = await import('../src/shared/assistant/projector')
const directory = await mkdtemp(join(tmpdir(), 'zyra-timing-submission-'))
const recorder = new ResponseTimingRecorder(directory)
try {
    const thread = createAssistantThread(new Date().toISOString())
    thread.model = 'openai-codex/gpt-6.1-sol'
    const session = createAssistantSessionRecord({ sessionId: 'timing-session', title: 'Timing fixture', projectPath: null, thread, createdAt: new Date().toISOString() })
    let snapshot = { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let sequence = 0, delivered = 0
    const deps: any = {
        responseTiming: recorder, queuedPromptDeliveries: new QueuedPromptDeliveryOwner(join(directory, 'queue')),
        ensureReady: () => gate, getSnapshot: () => snapshot,
        getSessionRuntimeCwd: () => directory, getNewChatPreparationModel: async () => thread.model,
        appendEvent: (type: any, occurredAt: string, payload: any, sessionId: string, threadId: string) => {
            snapshot = applyAssistantDomainEvent(snapshot, { eventId: `event-${++sequence}`, sequence, type, occurredAt, payload, sessionId, threadId })
        },
        runtime: { ensurePromptAvailable: async () => {}, hasSession: () => true,
            sendPrompt: async (_id: string, _text: string, options: any) => {
                options.beforeSubmit?.()
                delivered++
                recorder.observe({ eventId: 'accepted', type: 'turn.accepted', threadId: thread.id, turnId: options.turnId, createdAt: new Date().toISOString(), payload: {} })
                return { turnId: options.turnId, providerThreadId: null }
            }
        }
    }
    const pending = sendAssistantPromptAction(deps, 'Synthetic task', { sessionId: session.id }, [])
    const preparing = (await recorder.read()).records
    assert.equal(preparing.length, 1, 'a cold/preparing submission is locally recorded before attachment can hang')
    assert.equal(preparing[0].dispatchMs, null)
    release(); const result = await pending
    assert.equal(result.turnId, preparing[0].turnId, 'one identity follows preparation, runtime and trace')
    const sent = (await recorder.read()).records[0]
    assert.equal(sent.model, 'gpt-6.1-sol')
    assert.notEqual(sent.acceptedMs, null)
    assert.notEqual(sent.dispatchMs, null)
    recorder.finish(result.turnId!, 'completed')
    gate = Promise.resolve()
    const opts = { sessionId: session.id, queueEntryId: 'shared-entry', responseTimingStartedAt: 1 }
    const one = await sendAssistantPromptAction(deps, 'Shared task', opts, [])
    const two = await sendAssistantPromptAction(deps, 'Shared task', { ...opts, responseTimingStartedAt: 2 }, [])
    assert.equal(one.turnId, two.turnId, 'timing metadata cannot change queue payload identity')
    assert.equal(delivered, 2, 'queue receipt replays do not submit or trace another turn')
    assert.equal((await recorder.read()).records.length, 2)
    recorder.finish(one.turnId!, 'completed')
    deps.runtime.ensurePromptAvailable = async () => { throw new Error('PRIVATE_SYNTHETIC_PREPARATION_ERROR') }
    await assert.rejects(sendAssistantPromptAction(deps, 'Synthetic failure', { sessionId: session.id }, []), /PREPARATION_ERROR/)
    const rows = (await recorder.read()).records
    assert.equal(rows.filter(row => row.outcome === 'failed').length, 1)
    assert(!JSON.stringify(rows).includes('PRIVATE_SYNTHETIC_PREPARATION_ERROR'))
    console.log('Response timing submission: early preparation, canonical acceptance, exact turn identity, queue deduplication and failure: ok')
} finally { await recorder.dispose(); await rm(directory, { recursive: true, force: true }) }
