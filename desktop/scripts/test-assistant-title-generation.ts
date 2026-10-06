import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mock } from 'bun:test'
import type { AssistantDomainEvent, AssistantSnapshot } from '../src/shared/assistant/contracts'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'

const electronNoop = (): undefined => undefined
mock.module('electron', () => ({
    app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: electronNoop, once: electronNoop },
    BrowserWindow: class { static getAllWindows(): never[] { return [] } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }
}))
const { createAssistantSessionRecord } = await import('../src/main/assistant/service-records')
const { sendAssistantPromptAction } = await import('../src/main/assistant/service-session-actions')
const { createAssistantThread } = await import('../src/main/assistant/service-state')
const { shouldGenerateSessionTitleForPrompt } = await import('../src/main/assistant/session-title-generation')

const createdAt = '2026-08-17T20:00:00.000Z'
const thread = createAssistantThread(createdAt, null, 'C:/workspace', { webSearch: true, webFetch: true })
const session = createAssistantSessionRecord({
    sessionId: 'session-title-model',
    // Canonical draft attachment imports this server-owned placeholder before
    // the first user message exists (unlike Desktop's initial New Session).
    title: 'New chat',
    projectPath: 'C:/workspace',
    createdAt,
    thread
})
let snapshot: AssistantSnapshot = {
    snapshotSequence: 0,
    updatedAt: createdAt,
    selectedSessionId: session.id,
    playground: { rootPath: null, labs: [] },
    sessions: [session],
    knownModels: [],
    fleetByThreadId: {}
}
let sequence = 0
const generatedModels: string[] = []
const canonicalTitles: string[] = []
const sentModels: Array<string | undefined> = []
const attachedModels: string[] = []
let releaseConnect!: () => void
let titleStarted!: () => void
const connectionGate = new Promise<void>(resolve => { releaseConnect = resolve })
const titleGenerationStarted = new Promise<void>(resolve => { titleStarted = resolve })
const events: AssistantDomainEvent[] = []
const appendEvent = (
    type: AssistantDomainEvent['type'],
    occurredAt: string,
    payload: Record<string, unknown>,
    sessionId?: string,
    threadId?: string
) => {
    const event: AssistantDomainEvent = {
        eventId: `title-test-${++sequence}`,
        sequence,
        type,
        occurredAt,
        sessionId,
        threadId,
        payload
    }
    events.push(event)
    snapshot = applyAssistantDomainEvent(snapshot, event)
}

assert.equal(shouldGenerateSessionTitleForPrompt(session, null), true, 'a warmed canonical draft remains eligible for first-send title generation')
const firstSend = sendAssistantPromptAction({
    ensureReady: async () => {},
    getSnapshot: () => snapshot,
    hydrateSelectedSession: async () => {},
    getFirstUserMessageText: async () => null,
    getNewChatExecutionDefaults: async () => ({ webSearch: true, webFetch: true }),
    getNewChatPreparationModel: async () => 'opencode-harness/openai/gpt-6.1-sol',
    getTitleGenerationModel: async () => 'openai-codex/gpt-5.6-luna',
    appendEvent,
    getSessionRuntimeCwd: () => 'C:/workspace',
    createSession: async () => ({ success: true as const, sessionId: session.id }),
    createPlaygroundLab: async () => ({ success: true as const, labId: 'unused', sessionId: null, playground: snapshot.playground }),
    sendPrompt: async () => ({ success: true as const, sessionId: session.id, threadId: thread.id }),
    suppressAssistantTextForTurn: () => {},
    runtime: {
        checkAvailability: async () => ({ available: true, reason: null }),
        listModels: async () => [],
        hasSession: () => false,
        connect: async (attachedThread) => { attachedModels.push(attachedThread.model); await connectionGate },
        sendPrompt: async (_threadId, _prompt, options) => {
            sentModels.push(options?.model)
            return { turnId: 'turn-title-model', providerThreadId: 'canonical-title-model' }
        },
        generateText: async (_prompt, options) => {
            generatedModels.push(options.model || '')
            titleStarted()
            return { success: true, text: 'First Send Layout Fix', model: options.model }
        },
        updateCanonicalChat: async (_threadId, patch) => {
            if (patch.title) canonicalTitles.push(patch.title)
        },
        interruptTurn: async () => {},
        rollbackThread: async () => {},
        respondApproval: async () => {},
        respondUserInput: async () => {},
        disconnect: () => {},
        dispose: () => {},
        on() { return this }
    }
} as never, 'Fix the blank first-send transition.', {
    sessionId: session.id
})
await titleGenerationStarted
assert.deepEqual(generatedModels, ['openai-codex/gpt-5.6-luna'], 'first-send title generation starts before attachment settles, without navigation')
assert.deepEqual(sentModels, [], 'the connection gate still holds conversation dispatch')
releaseConnect()
const result = await firstSend
assert.equal(result.success, true)
for (let attempt = 0; attempt < 20 && snapshot.sessions[0]?.title !== 'First Send Layout Fix'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
}
assert.ok(attachedModels.length > 0)
assert.ok(attachedModels.every(model => model === 'opencode-harness/openai/gpt-6.1-sol'), 'cold attachment receives the saved default rather than the engine fallback')
assert.deepEqual(sentModels, ['opencode-harness/openai/gpt-6.1-sol'], 'the first conversation dispatch receives the same saved model')
assert.equal(snapshot.sessions[0]?.threads[0]?.model, 'opencode-harness/openai/gpt-6.1-sol', 'the resolved first-send model becomes durable chat configuration')
assert.deepEqual(generatedModels, ['openai-codex/gpt-5.6-luna'], 'the independent title preference sends title utility work to Luna')
assert.deepEqual(canonicalTitles, ['First Send Layout Fix'])
assert.equal(
    events.some((event) => event.type === 'thread.message.user' && JSON.stringify(event.payload).includes('You write concise titles')),
    false,
    'the title utility prompt never enters canonical chat messages'
)
assert.equal(events.filter((event) => event.type === 'session.created').length, 0, 'title utility work cannot create another chat')
assert.equal(events.filter((event) => event.type === 'session.updated').length, 2, 'only the heuristic title and final generated title update session metadata')

// Neither a retained chat choice nor an explicit Send choice reads or adopts
// a global new-chat default, even on the first attachment after a restart.
snapshot.sessions[0]!.title = 'My explicit chat name'
for (const explicitSendModel of [undefined, 'synthetic-provider/send-choice']) {
    snapshot.sessions[0]!.threads[0]!.model = 'synthetic-provider/chat-choice'
    const capturedModels: Array<string | undefined> = []
    await sendAssistantPromptAction({
        ensureReady: async () => {}, getSnapshot: () => snapshot,
        getFirstUserMessageText: async () => 'Original user request',
        getNewChatPreparationModel: async () => { throw Error('Explicit chat/send models must not read the global default') },
        getSessionRuntimeCwd: () => 'C:/workspace', appendEvent,
        runtime: {
            hasSession: () => false,
            connect: async (attachedThread: { model: string }) => { capturedModels.push(attachedThread.model) },
            sendPrompt: async (_id: string, _prompt: string, options: { model?: string; turnId: string }) => {
                capturedModels.push(options.model)
                return { turnId: options.turnId, providerThreadId: 'canonical-title-model' }
            }
        }
    } as never, 'Keep my selected model', { sessionId: session.id, model: explicitSendModel })
    assert.ok(capturedModels.every(model => model === (explicitSendModel || 'synthetic-provider/chat-choice')),
        'explicit Send choices precede retained chat models, which precede global defaults')
}

const serviceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-runtime.ts', import.meta.url), 'utf8')
const promptTurnStart = runtimeSource.indexOf('private async runPromptTurn')
const promptTurnSource = runtimeSource.slice(promptTurnStart, runtimeSource.indexOf('private async ensureConnected', promptTurnStart))
const recoverySource = serviceSource.slice(serviceSource.indexOf('private async recoverSessionTitle'), serviceSource.indexOf('private async ensureReady'))
assert.match(recoverySource, /getTitleGenerationModel/, 'startup title recovery must read the same title-model preference')
assert.match(recoverySource, /preferredModel,\s*generateText/, 'startup title recovery must pass the configured utility model')
assert.doesNotMatch(recoverySource, /preferredModel: thread\.model/, 'startup recovery cannot silently inherit the conversation model')
for (const [start, end] of [
    ['async regenerateSessionTitle(', 'async archiveSession('],
    ['private async maybeAutoRegenerateSessionTitle(', 'private recoverSidebarSessionTitles('],
    ['private async recoverSessionTitle(', 'private async ensureReady(']
]) {
    const titleCallbackSource = serviceSource.slice(serviceSource.indexOf(start), serviceSource.indexOf(end))
    assert.match(titleCallbackSource, /await awaitCanonicalSessionTitleSaves\(/, 'each multi-chat title callback must settle its complete save cohort before releasing the commit queue')
    assert.doesNotMatch(titleCallbackSource, /await Promise\.all\(/, 'multi-chat title callbacks cannot reject while prior canonical writes remain in flight')
}
assert.match(promptTurnSource, /skipTitleGeneration: true/, 'Desktop-owned prompts must disable the bridge worker\'s second hardcoded title request')

console.log('Assistant title-generation model boundary: ok')
