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

const createdAt = '2026-08-17T20:00:00.000Z'
const thread = createAssistantThread(createdAt, null, 'C:/workspace', { webSearch: true, webFetch: true })
thread.model = 'openai-codex/gpt-5.6-sol'
const session = createAssistantSessionRecord({
    sessionId: 'session-title-model',
    title: 'New Session',
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

const result = await sendAssistantPromptAction({
    ensureReady: async () => {},
    getSnapshot: () => snapshot,
    hydrateSelectedSession: async () => {},
    getFirstUserMessageText: async () => null,
    getNewChatExecutionDefaults: async () => ({ webSearch: true, webFetch: true }),
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
        connect: async () => {},
        sendPrompt: async (_threadId, _prompt, options) => {
            sentModels.push(options?.model)
            return { turnId: 'turn-title-model', providerThreadId: 'canonical-title-model' }
        },
        generateText: async (_prompt, options) => {
            generatedModels.push(options.model || '')
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
    model: 'openai-codex/gpt-5.6-sol',
    sessionId: session.id
})
assert.equal(result.success, true)
for (let attempt = 0; attempt < 20 && snapshot.sessions[0]?.title !== 'First Send Layout Fix'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
}
assert.deepEqual(sentModels, ['openai-codex/gpt-5.6-sol'], 'the conversation keeps its selected Sol model')
assert.deepEqual(generatedModels, ['openai-codex/gpt-5.6-luna'], 'the independent title preference sends title utility work to Luna')
assert.deepEqual(canonicalTitles, ['First Send Layout Fix'])
assert.equal(
    events.some((event) => event.type === 'thread.message.user' && JSON.stringify(event.payload).includes('You write concise titles')),
    false,
    'the title utility prompt never enters canonical chat messages'
)
assert.equal(events.filter((event) => event.type === 'session.created').length, 0, 'title utility work cannot create another chat')
assert.equal(events.filter((event) => event.type === 'session.updated').length, 2, 'only the heuristic title and final generated title update session metadata')

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
