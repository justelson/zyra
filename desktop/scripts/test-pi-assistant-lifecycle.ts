import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mock } from 'bun:test'
import type {
    AssistantDomainEvent,
    AssistantModelInfo,
    AssistantRuntimeEvent,
    AssistantSession,
    AssistantSnapshot,
    AssistantThread
} from '../src/shared/assistant/contracts'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { handleAssistantRuntimeEvent, normalizeRuntimeActivityPayload } from '../src/main/assistant/service-runtime-events'
import { getAssistantModelNoticePresentation } from '../src/main/assistant/assistant-failure-presentation'
import { getTitleGenerationModelCandidates, queueGeneratedSessionTitle, shouldGenerateSessionTitleForPrompt } from '../src/main/assistant/session-title-generation'
import { getAssistantCanonicalThreadId, matchesAssistantThreadId } from '../src/main/assistant/thread-identity'
import { buildEffortSliderTicks, EFFORT_LABELS } from '../src/renderer/src/pages/assistant/assistant-composer-controller-constants'
import { getAssistantRecoveryIssue } from '../src/renderer/src/pages/assistant/assistant-runtime-recovery'
import { piEditFixture, piWriteExistingFixture, piWriteFailureFixture } from './fixtures/file-change-lifecycle-fixtures'
import {
    coerceAssistantReasoningEffortForModel,
    getAssistantModelReasoningEfforts
} from '../src/shared/assistant/reasoning-efforts'

const electronNoop = (): undefined => undefined
mock.module('electron', () => ({
    app: {
        getPath: () => process.env.TEMP || process.cwd(),
        isReady: () => true,
        on: electronNoop,
        once: electronNoop
    },
    BrowserWindow: class {
        static getAllWindows(): never[] { return [] }
        static fromWebContents(): null { return null }
    },
    screen: {
        getAllDisplays: () => [],
        getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }
}))
const { ZyraPiRuntime, buildArgumentPreviewPatch, buildLiveAssistantTurnUsage, completeAssistantTurnUsage, mergeAssistantTurnUsage, resolveAssistantUsageMessageIdentity, shouldAccountAssistantMessageUsage } = await import('../src/main/assistant/zyra-pi-runtime')
const { resolveLiveContextUsage } = await import('../../src/live-context-usage.mjs')
const { ZyraAccountService } = await import('../src/main/assistant/zyra-account-service')

const mergedTurnUsage = mergeAssistantTurnUsage(
    mergeAssistantTurnUsage(null, {
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 9_000,
        reasoningOutputTokens: 80,
        totalTokens: 10_200,
        modelContextWindow: 372_000,
        costUsd: 0.02
    }),
    {
        inputTokens: 2_000,
        outputTokens: 300,
        cachedInputTokens: 18_000,
        reasoningOutputTokens: 120,
        totalTokens: 20_300,
        modelContextWindow: 372_000,
        costUsd: 0.03
    }
)
assert.deepEqual(mergedTurnUsage, {
    inputTokens: 3_000,
    outputTokens: 500,
    cachedInputTokens: 27_000,
    cacheWriteTokens: null,
    reasoningOutputTokens: 200,
    totalTokens: 20_300,
    modelContextWindow: 372_000,
    costUsd: 0.05,
    sessionCostUsd: null,
    sessionCostComplete: null
}, 'a Desktop turn preserves the cumulative provider cost while retaining the latest context size')
assert.equal(
    completeAssistantTurnUsage(mergedTurnUsage, 95.268916, true)?.sessionCostUsd,
    95.268916,
    'turn persistence retains the complete canonical-session cost snapshot for disconnected Thread Details'
)
assert.equal(completeAssistantTurnUsage(mergedTurnUsage, 95.268916, true)?.sessionCostComplete, true)
assert.equal(shouldAccountAssistantMessageUsage({
    replay: true,
    turnId: 'turn:historical',
    activeTurnId: 'turn:current',
    turnCompleted: true,
    messageAlreadyAccounted: false
}), false, 'historical replay cannot contaminate current-turn usage')
assert.equal(shouldAccountAssistantMessageUsage({
    replay: true,
    turnId: 'turn:current',
    activeTurnId: 'turn:current',
    turnCompleted: false,
    messageAlreadyAccounted: false
}), true, 'replayed usage for the still-active turn can restore its aggregate after reconnect')
assert.equal(shouldAccountAssistantMessageUsage({
    replay: false,
    turnId: 'turn:current',
    activeTurnId: 'turn:current',
    turnCompleted: false,
    messageAlreadyAccounted: true
}), false, 'duplicate message_end events cannot double-count cost')
const anonymousUsageMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Completed.' }],
    usage: { input: 100, output: 20, cost: { total: 0.01 } }
}
assert.equal(
    resolveAssistantUsageMessageIdentity(anonymousUsageMessage, 'turn:current', 'generated:item:1'),
    resolveAssistantUsageMessageIdentity(anonymousUsageMessage, 'turn:current', 'generated:item:2'),
    'duplicate message_end events without provider ids retain a stable content-and-usage identity'
)
assert.notEqual(
    resolveAssistantUsageMessageIdentity(anonymousUsageMessage, 'turn:current', 'generated:item:1'),
    resolveAssistantUsageMessageIdentity({ ...anonymousUsageMessage, content: [{ type: 'text', text: 'A distinct response.' }] }, 'turn:current', 'generated:item:2')
)
assert.equal(buildLiveAssistantTurnUsage({
    lastUsage: mergedTurnUsage,
    sessionUsage: { threadId: 'thread:live', contextTokens: 32_000, modelContextWindow: 372_000 }
})?.totalTokens, 32_000, 'live context replaces the last completed context size without discarding exact turn usage')
const liveContext = resolveLiveContextUsage({
    reported: { tokens: 32_000, contextWindow: 372_000 },
    baselineTokens: 32_000,
    activeMessage: { role: 'assistant', content: [{ type: 'text', text: 'Streaming response tokens'.repeat(20) }] },
    contextWindow: 372_000
})
assert.ok((liveContext?.tokens || 0) > 32_000, 'streaming assistant content advances the context estimate before message_end')
const structuredEditPreview = buildArgumentPreviewPatch('edit', {
    path: 'desktop/src/example.ts',
    edits: [
        { oldText: 'const oldValue = true', newText: 'const newValue = true' },
        { oldText: 'export { oldValue }', newText: 'export { newValue }' }
    ]
})
assert.match(structuredEditPreview || '', /^--- a\/desktop\/src\/example\.ts/m, 'structured edit calls produce a Review-compatible provisional patch')
assert.match(structuredEditPreview || '', /-const oldValue = true[\s\S]*\+const newValue = true/)
assert.match(structuredEditPreview || '', /-export \{ oldValue \}[\s\S]*\+export \{ newValue \}/)
const zyraRuntimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
assert.match(zyraRuntimeSource, /sessionUsage && metadata\?\.replay !== true/, 'historical replay cannot replace the current cumulative session-cost snapshot')
const { deleteAssistantSessionAction } = await import('../src/main/assistant/service-session-actions')
const {
    findDuplicateProjectedActivityIds,
    findDuplicateProjectedMessageIds,
    findSupersededCanonicalActivityIds,
    findSupersededCanonicalMessageIds,
    projectCanonicalTimeline
} = await import('../src/main/assistant/service')

let accountResetRedeemed = false
const availableResetExpiresAt = '2099-08-20T12:00:00.000Z'
const accountServiceHarness = new ZyraAccountService(async () => ({
    buildChatGptAccountStatus: async () => ({
        provider: 'openai-codex',
        status: { configured: true, source: 'stored' },
        email: 'person@example.com',
        emailVerified: true,
        plan: 'pro',
        accountId: 'account-123',
        tokenExpiresAt: '2026-08-05T12:00:00.000Z',
        usage: {
            source: 'Pi auth storage',
            account: 'person@example.com',
            plan: 'pro',
            updatedAt: '2026-08-04T12:00:00.000Z',
            availableResetCount: accountResetRedeemed ? 0 : 1,
            limitWindows: [{
                id: 'codex:primary_window',
                label: 'Primary',
                usedPercent: 40,
                resetAt: '2026-08-04T17:00:00.000Z',
                windowSeconds: 18_000
            }]
        },
        updatedAt: '2026-08-04T12:00:00.000Z'
    }),
    fetchCodexResetCredits: async () => ({
        availableCount: accountResetRedeemed ? 0 : 1,
        credits: [{
            id: 'reset-1',
            title: 'Codex rate-limit reset',
            status: accountResetRedeemed ? 'redeemed' : 'available',
            expiresAt: availableResetExpiresAt
        }]
    }),
    redeemCodexResetCredit: async (creditId: string) => {
        assert.equal(creditId, 'reset-1')
        accountResetRedeemed = true
        return {
            code: 'ok',
            windowsReset: 2,
            redeemedAt: '2026-08-04T12:01:00.000Z',
            credit: { id: creditId, title: 'Codex rate-limit reset', status: 'redeemed', expiresAt: availableResetExpiresAt }
        }
    },
    isCodexResetCreditAvailable: (credit: unknown) => {
        const value = credit as { status?: string; expiresAt?: string }
        return value.status === 'available' && new Date(value.expiresAt || 0).getTime() > Date.now()
    }
}))
const accountOverview = await accountServiceHarness.getOverview()
assert.equal(accountOverview.source, 'Pi auth storage', 'Desktop account settings must identify Pi as the ChatGPT account source')
assert.equal(accountOverview.account?.email, 'person@example.com')
assert.equal(accountOverview.rateLimits?.primary?.remainingPercent, 60, 'Desktop account settings must map the real /codexusage limit window')
assert.equal(accountOverview.availableResetCount, 1)
assert.equal(accountOverview.resetCredits[0]?.available, true)
await assert.rejects(
    () => accountServiceHarness.redeemAccountReset({ creditId: 'reset-1', confirmed: false as true }),
    /Confirm the banked reset/,
    'a reset must never be spent without the explicit confirmation contract'
)
const resetResult = await accountServiceHarness.redeemAccountReset({ creditId: 'reset-1', confirmed: true })
assert.equal(resetResult.redemption.windowsReset, 2)
assert.equal(resetResult.overview?.availableResetCount, 0)
assert.equal(resetResult.overview?.resetCredits[0]?.available, false)

const canonicalUserTimestamp = 1_785_800_000_000
const canonicalAssistantTimestamp = canonicalUserTimestamp + 100
const canonicalProjection = projectCanonicalTimeline([
    {
        type: 'message',
        id: 'legacy-user-id',
        timestamp: new Date(canonicalUserTimestamp).toISOString(),
        message: { role: 'user', timestamp: canonicalUserTimestamp, content: [{ type: 'text', text: 'same prompt' }] }
    },
    {
        type: 'message',
        id: 'legacy-assistant-id',
        timestamp: new Date(canonicalAssistantTimestamp).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp,
            content: [
                { type: 'thinking', thinking: 'same thought' },
                { type: 'text', text: 'same response' }
            ]
        }
    }
], 'canonical:test', 'test-key', new Date(canonicalUserTimestamp).toISOString(), 0)
assert.deepEqual(
    canonicalProjection.messages.map((message) => message.id),
    [
        `assistant-message-user-pi-message:user:${canonicalUserTimestamp}`,
        `assistant-message-pi-message:assistant:${canonicalAssistantTimestamp}`
    ],
    'canonical history and live bridge events must project the same stable message IDs'
)

const canonicalAbortedProjection = projectCanonicalTimeline([
    {
        type: 'message',
        id: 'aborted-user-entry',
        timestamp: new Date(canonicalUserTimestamp).toISOString(),
        message: { role: 'user', timestamp: canonicalUserTimestamp, content: [{ type: 'text', text: 'Start research' }] }
    },
    {
        type: 'message',
        id: 'aborted-progress-entry',
        timestamp: new Date(canonicalAssistantTimestamp).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp,
            content: [{ type: 'text', text: 'Research is still running.' }],
            stopReason: 'toolUse'
        }
    },
    {
        type: 'message',
        id: 'aborted-terminal-entry',
        timestamp: new Date(canonicalAssistantTimestamp + 100).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp + 100,
            content: [{ type: 'thinking', thinking: '' }],
            stopReason: 'aborted',
            errorMessage: 'Request was aborted'
        }
    }
], 'canonical:aborted', 'aborted-key', new Date(canonicalUserTimestamp).toISOString(), 0)
const canonicalInterruptedActivity = canonicalAbortedProjection.activities.find((activity) => activity.id === `shared-error:pi-message:assistant:${canonicalAssistantTimestamp + 100}`)
assert.equal(canonicalInterruptedActivity?.tone, 'warning', 'a canonical TUI abort must project as an intentional interruption rather than an Assistant error')
assert.equal(canonicalInterruptedActivity?.summary, 'Assistant interrupted')
assert.equal(canonicalInterruptedActivity?.payload?.['status'], 'cancelled')
assert.equal(canonicalInterruptedActivity?.payload?.['stopReason'], 'aborted')
assert.equal(canonicalInterruptedActivity?.turnTerminalOutcome, 'interrupted', 'canonical replay marks a certain end-of-turn interruption explicitly')

const canonicalRecoveredProjection = projectCanonicalTimeline([
    {
        type: 'message',
        id: 'recovered-user-entry',
        timestamp: new Date(canonicalUserTimestamp).toISOString(),
        message: { role: 'user', timestamp: canonicalUserTimestamp, content: [{ type: 'text', text: 'Retry the request' }] }
    },
    {
        type: 'message',
        id: 'recovered-error-entry',
        timestamp: new Date(canonicalAssistantTimestamp).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp,
            content: [],
            stopReason: 'error',
            errorMessage: 'fetch failed'
        }
    },
    {
        type: 'message',
        id: 'recovered-final-entry',
        timestamp: new Date(canonicalAssistantTimestamp + 100).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp + 100,
            content: [{ type: 'text', text: 'Recovered response' }],
            stopReason: 'stop'
        }
    }
], 'canonical:recovered', 'recovered-key', new Date(canonicalUserTimestamp).toISOString(), 0)
const canonicalRecoveredError = canonicalRecoveredProjection.activities.find((activity) => activity.kind === 'error')
assert.equal(canonicalRecoveredError?.turnTerminalOutcome, undefined, 'a later successful assistant message clears the earlier in-turn error as a terminal candidate')

const canonicalEditPatch = [
    '--- C:/fixture/src/review-index.ts',
    '+++ C:/fixture/src/review-index.ts',
    '@@ -1 +1 @@',
    '-old review',
    '+new review'
].join('\n')
const canonicalFileChangeProjection = projectCanonicalTimeline([
    {
        type: 'message',
        timestamp: new Date(canonicalUserTimestamp).toISOString(),
        message: { role: 'user', timestamp: canonicalUserTimestamp, content: [{ type: 'text', text: 'Update review' }] }
    },
    {
        type: 'message',
        timestamp: new Date(canonicalAssistantTimestamp).toISOString(),
        message: {
            role: 'assistant',
            timestamp: canonicalAssistantTimestamp,
            content: [{
                type: 'toolCall',
                id: 'canonical-edit-call',
                name: 'edit',
                arguments: {
                    path: 'C:/fixture/src/review-index.ts',
                    edits: [{ oldText: 'old review', newText: 'new review' }]
                }
            }]
        }
    },
    {
        type: 'message',
        timestamp: new Date(canonicalAssistantTimestamp + 1).toISOString(),
        message: {
            role: 'toolResult',
            timestamp: canonicalAssistantTimestamp + 1,
            toolCallId: 'canonical-edit-call',
            toolName: 'edit',
            isError: false,
            content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
            details: { diff: canonicalEditPatch, patch: canonicalEditPatch }
        }
    }
], 'canonical:file-change', 'file-change-key', new Date(canonicalUserTimestamp).toISOString(), 0, 'C:/fixture')
const canonicalFileChange = canonicalFileChangeProjection.activities.find((activity) => activity.id === 'zyra-tool-canonical-edit-call')
assert.equal(canonicalFileChange?.kind, 'file-change', 'historical TUI edit calls must become Review file changes')
assert.equal(canonicalFileChange?.summary, 'Edited file')
assert.equal(canonicalFileChange?.payload?.['status'], 'completed')
assert.equal(canonicalFileChange?.payload?.['source'], 'provider-result')
assert.equal(canonicalFileChange?.payload?.['authoritative'], true)
assert.equal(canonicalFileChange?.payload?.['patch'], canonicalEditPatch)
assert.deepEqual(canonicalFileChange?.payload?.['paths'], ['C:/fixture/src/review-index.ts'])
assert.deepEqual(
    canonicalFileChange?.payload?.['changes'],
    [{ path: 'C:/fixture/src/review-index.ts', kind: 'update', diff: canonicalEditPatch, isNew: false }],
    'canonical provider patches must retain the indexed file path and status'
)

const replayedAssistantMessage: AssistantThread['messages'][number] = {
    ...canonicalProjection.messages[1],
    id: 'assistant-message-zyra-assistant-turn:test-2',
    createdAt: new Date(canonicalAssistantTimestamp + 120_000).toISOString(),
    updatedAt: new Date(canonicalAssistantTimestamp + 120_000).toISOString()
}
assert.deepEqual(
    new Set(findSupersededCanonicalMessageIds([
        { ...canonicalProjection.messages[1], id: 'legacy-assistant-id' },
        replayedAssistantMessage
    ], canonicalProjection.messages, canonicalProjection.legacyMessageIds)),
    new Set(['legacy-assistant-id', replayedAssistantMessage.id]),
    'canonical import must remove both legacy IDs and reconnect replay copies'
)
assert.deepEqual(
    findDuplicateProjectedMessageIds([canonicalProjection.messages[1], replayedAssistantMessage]),
    [replayedAssistantMessage.id],
    'legacy cleanup must prefer a timestamp-stable Pi message over a fallback replay ID'
)
const replayedThought: AssistantThread['activities'][number] = {
    ...canonicalProjection.activities.find((activity) => activity.detail === 'same thought')!,
    id: 'assistant-internal-zyra-assistant-turn:test-2',
    createdAt: new Date(canonicalAssistantTimestamp + 120_000).toISOString()
}
assert.deepEqual(
    findSupersededCanonicalActivityIds([replayedThought], canonicalProjection.activities, canonicalProjection.legacyActivityIds),
    [replayedThought.id],
    'canonical import must remove replayed internal activity copies'
)
const firstCanonicalGreeting: AssistantThread['messages'][number] = {
    ...canonicalProjection.messages[0],
    id: '11111111',
    text: 'hi',
    createdAt: new Date(canonicalUserTimestamp - 30 * 60_000).toISOString()
}
const secondCanonicalGreeting: AssistantThread['messages'][number] = {
    ...firstCanonicalGreeting,
    id: '22222222',
    createdAt: new Date(canonicalUserTimestamp).toISOString()
}
const replayedGreeting: AssistantThread['messages'][number] = {
    ...secondCanonicalGreeting,
    id: 'assistant-message-user-turn:replayed-hi',
    turnId: 'turn:replayed-hi',
    createdAt: new Date(canonicalUserTimestamp + 120_000).toISOString()
}
assert.deepEqual(
    findDuplicateProjectedMessageIds([firstCanonicalGreeting, secondCanonicalGreeting, replayedGreeting]),
    [replayedGreeting.id],
    'legacy cleanup must preserve distinct repeated prompts while removing the nearby replay copy'
)
const repeatedThought = {
    ...replayedThought,
    id: 'assistant-internal-zyra-assistant-turn:test-3',
    createdAt: new Date(canonicalAssistantTimestamp + 180_000).toISOString()
}
assert.deepEqual(
    findDuplicateProjectedActivityIds([replayedThought, repeatedThought]),
    [repeatedThought.id],
    'legacy cleanup must collapse same-turn internal replay activities'
)

const turnId = 'turn-lifecycle'
const planningText = 'I will inspect the harness and run its checks.'
const finalMarkdown = '# Harness results\n\n- File search: passed\n- Command run: passed'
const usageNotice = getAssistantModelNoticePresentation('Codex error: The usage limit has been reached', 'openai-codex/gpt-5.5')
assert.equal(usageNotice?.kind, 'usage-limit')
assert.equal(usageNotice?.title, 'Usage limit reached')
assert.match(usageNotice?.message || '', /gpt-5\.5/)
assert.equal(getAssistantModelNoticePresentation('Authentication failed', 'openai-codex/gpt-5.5'), null)
assert.deepEqual(
    getAssistantModelReasoningEfforts('openai-codex/gpt-5.6-sol'),
    ['low', 'medium', 'high', 'xhigh', 'max'],
    'desktop GPT-5.6 effort options must match the TUI capability contract'
)
assert.deepEqual(
    getAssistantModelReasoningEfforts('openai-codex/gpt-5.5'),
    ['low', 'medium', 'high', 'xhigh'],
    'desktop ChatGPT model effort options must begin at low'
)
const staleGpt56ModelCapabilities: AssistantModelInfo = {
    id: 'openai-codex/gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    supportedEfforts: ['low', 'medium', 'high', 'xhigh']
}
assert.deepEqual(
    getAssistantModelReasoningEfforts(staleGpt56ModelCapabilities),
    ['low', 'medium', 'high', 'xhigh', 'max'],
    'GPT-5.6 max must survive model metadata from a Pi adapter that only advertises xhigh'
)
assert.equal(coerceAssistantReasoningEffortForModel('max', staleGpt56ModelCapabilities), 'max')
assert.equal(coerceAssistantReasoningEffortForModel('max', 'openai-codex/gpt-5.6-terra'), 'max')
assert.equal(coerceAssistantReasoningEffortForModel('max', 'openai-codex/gpt-5.5'), 'xhigh')
assert.equal(coerceAssistantReasoningEffortForModel('minimal', 'openai-codex/gpt-5.6-sol'), 'low')
assert.equal(coerceAssistantReasoningEffortForModel('none', 'openai-codex/gpt-5.6-sol'), 'low')
assert.equal(EFFORT_LABELS.low, 'Light')
assert.equal(EFFORT_LABELS.max, 'Max')
assert.equal((buildEffortSliderTicks(5).match(/radial-gradient/g) || []).length, 5, 'the rail must render one evenly spaced point per available effort')
const thoughtMarkdown = '**Planning package read**\n\nI should inspect package.json before answering.'
const narrationText = 'I’ll read `package.json` once, then summarize it.'

const runtime = new ZyraPiRuntime()
const runtimeEvents: AssistantRuntimeEvent[] = []
runtime.on('runtime', (event: AssistantRuntimeEvent) => runtimeEvents.push(event))

const context = {
    localThreadId: 'thread-lifecycle',
    providerThreadId: 'provider-lifecycle',
    model: 'openai-codex/gpt-5.5',
    thinking: 'medium' as const,
    runtimeMode: 'approval-required' as const,
    interactionMode: 'default' as const,
    profile: 'default',
    activeTurnId: turnId,
    completedTurnIds: new Set<string>(),
    assistantMessageSequence: 0,
    activeAssistantItemId: null,
    toolArgsByCallId: new Map<string, Record<string, unknown>>(),
    toolStartedAtByCallId: new Map<string, string>(),
    commandActivityIdByJobId: new Map<string, string>(),
    runningManagedCommandJobIds: new Set<string>(),
    assistantTextByItemId: new Map<string, string>(),
    assistantCompletedItemIds: new Set<string>(),
    internalTextByItemId: new Map<string, string>(),
    internalCompletedItemIds: new Set<string>(),
    lastAssistantItemId: null,
    lastUsage: null
}

const reconnectRuntime = new ZyraPiRuntime()
let reconnectWorkerAlive = false
let reconnectRequestCount = 0
const reconnectWorker = {
    serverOwnedLifecycle: true,
    onEvent: () => () => undefined,
    setControlRequestHandler: () => undefined,
    isAlive: () => reconnectWorkerAlive,
    request: async (type: string) => {
        assert.equal(type, 'connect')
        reconnectRequestCount += 1
        reconnectWorkerAlive = true
        return {
            threadId: 'provider-reconnect',
            providerThreadId: 'provider-reconnect',
            model: 'openai-codex/gpt-5.5',
            thinking: 'medium',
            profile: 'default',
            runtimeMode: 'approval-required',
            agentServerActiveTurnId: 'turn-reconnect'
        }
    },
    flushReplay: () => undefined,
    dispose: () => undefined
}
const reconnectContext = {
    ...context,
    localThreadId: 'thread-reconnect',
    providerThreadId: 'provider-reconnect',
    resumeProviderThreadId: 'provider-reconnect',
    worker: reconnectWorker,
    connected: true,
    connectPromise: Promise.resolve(),
    reconnectPromise: null,
    cwd: process.cwd(),
    activeTurnId: 'turn-reconnect',
    lastUsageTurnId: 'turn-reconnect',
    sessionUsage: null,
    fleetSnapshot: null
}
const reconnectRuntimeInternals = reconnectRuntime as any
reconnectRuntimeInternals.sessions.set(reconnectContext.localThreadId, reconnectContext)
reconnectRuntimeInternals.sessions.set(reconnectContext.providerThreadId, reconnectContext)
reconnectRuntimeInternals.aliases.set(reconnectContext.localThreadId, reconnectContext.localThreadId)
reconnectRuntimeInternals.aliases.set(reconnectContext.providerThreadId, reconnectContext.localThreadId)
reconnectRuntimeInternals.handleZyraEvent(reconnectContext, { type: 'server.transport.detached' })
const reconnectDeadline = Date.now() + 1_000
while (!reconnectContext.connected && Date.now() < reconnectDeadline) await new Promise((resolve) => setTimeout(resolve, 5))
assert.equal(reconnectRequestCount, 1, 'transport detachment reattaches without waiting for another user action')
assert.equal(reconnectContext.connected, true)
assert.equal(reconnectContext.connectPromise, null, 'a completed connect promise cannot block the next reconnect cycle')

const cancelledConnectRuntime = new ZyraPiRuntime()
const cancelledConnectEvents: AssistantRuntimeEvent[] = []
cancelledConnectRuntime.on('runtime', (event: AssistantRuntimeEvent) => cancelledConnectEvents.push(event))
let resolveCancelledConnect!: (result: Record<string, unknown>) => void
const cancelledConnectRequest = new Promise<Record<string, unknown>>((resolve) => {
    resolveCancelledConnect = resolve
})
let cancelledConnectWorkerAlive = true
const cancelledConnectWorker = {
    serverOwnedLifecycle: true,
    onEvent: () => () => undefined,
    setControlRequestHandler: () => undefined,
    isAlive: () => cancelledConnectWorkerAlive,
    request: async (type: string) => {
        assert.equal(type, 'connect')
        return cancelledConnectRequest
    },
    flushReplay: () => undefined,
    dispose: () => {
        cancelledConnectWorkerAlive = false
    }
}
const cancelledConnectContext = {
    ...reconnectContext,
    localThreadId: 'thread-cancelled-connect',
    providerThreadId: 'thread-cancelled-connect',
    resumeProviderThreadId: null,
    worker: cancelledConnectWorker,
    connected: false,
    connectPromise: null,
    reconnectPromise: null,
    activeTurnId: null,
    lastUsageTurnId: null
}
const cancelledConnectInternals = cancelledConnectRuntime as any
cancelledConnectInternals.sessions.set(cancelledConnectContext.localThreadId, cancelledConnectContext)
cancelledConnectInternals.aliases.set(cancelledConnectContext.localThreadId, cancelledConnectContext.localThreadId)
const cancelledConnectPending = cancelledConnectInternals.ensureConnected(cancelledConnectContext)
cancelledConnectRuntime.disconnect(cancelledConnectContext.localThreadId)
resolveCancelledConnect({
    threadId: 'provider-cancelled-connect',
    providerThreadId: 'provider-cancelled-connect',
    model: 'openai-codex/gpt-5.5',
    thinking: 'medium',
    profile: 'default',
    runtimeMode: 'approval-required'
})
await cancelledConnectPending
assert.equal(cancelledConnectContext.connected, false, 'an intentionally disconnected warmup cannot revive its old runtime context')
assert.equal(cancelledConnectInternals.sessions.has(cancelledConnectContext.localThreadId), false)
assert.equal(cancelledConnectInternals.sessions.has('provider-cancelled-connect'), false)
assert.equal(
    cancelledConnectEvents.some((event) => event.type === 'thread.started' && event.payload.state === 'ready'),
    false,
    'an intentionally disconnected warmup cannot publish a stale ready state'
)

const handleEvent = (
    event: unknown,
    metadata?: { turnId?: string; localThreadId?: string; replay?: boolean }
): void => {
    const handleZyraEvent = runtime as unknown as {
        handleZyraEvent: (
            targetContext: typeof context,
            eventValue: unknown,
            eventMetadata?: { turnId?: string; localThreadId?: string; replay?: boolean }
        ) => void
    }
    handleZyraEvent.handleZyraEvent(context, event, metadata)
}

handleEvent({
    type: 'session_config',
    model: 'openai-codex/gpt-5.5',
    thinking: 'high',
    profile: 'builder',
    runtimeMode: 'full-access'
})
const synchronizedConfigEvent = runtimeEvents.findLast((event) => event.type === 'session.config.updated')
assert.equal(synchronizedConfigEvent?.type === 'session.config.updated' ? synchronizedConfigEvent.payload.model : null, 'openai-codex/gpt-5.5')
assert.equal(synchronizedConfigEvent?.type === 'session.config.updated' ? synchronizedConfigEvent.payload.thinking : null, 'high')
assert.equal(synchronizedConfigEvent?.type === 'session.config.updated' ? synchronizedConfigEvent.payload.runtimeMode : null, 'full-access')

const externalPrompt = 'Inspect the shared server from the TUI.'
handleEvent({
    type: 'message_start',
    message: { role: 'user', content: [{ type: 'text', text: externalPrompt }] }
}, { turnId, localThreadId: 'tui-thread:external' })
const externalUserMessageEvent = runtimeEvents.findLast((event) => event.type === 'user.message.received')
assert.equal(externalUserMessageEvent?.type === 'user.message.received' ? externalUserMessageEvent.payload.text : null, externalPrompt)
assert.equal(externalUserMessageEvent?.type === 'user.message.received' ? externalUserMessageEvent.payload.messageId : null, `assistant-message-user-${turnId}`)
const externalUserEventCount = runtimeEvents.filter((event) => event.type === 'user.message.received').length
handleEvent({
    type: 'message_start',
    message: { role: 'user', content: [{ type: 'text', text: 'Desktop already projected this prompt.' }] }
}, { turnId, localThreadId: context.localThreadId })
assert.equal(
    runtimeEvents.filter((event) => event.type === 'user.message.received').length,
    externalUserEventCount,
    'the server echo for a Desktop-originated prompt must not create a duplicate user bubble'
)

const emitAssistantMessage = (
    type: 'message_start' | 'message_update' | 'message_end',
    text: string,
    delta = text,
    telemetry?: { contextTokens: number; input?: number; output?: number }
): void => {
    handleEvent({
        type,
        message: {
            role: 'assistant',
            content: text ? [{ type: 'text', text }] : [],
            usage: type === 'message_end' && telemetry
                ? { input: telemetry.input || 0, output: telemetry.output || 0, total: telemetry.contextTokens, modelContextWindow: 372_000 }
                : undefined
        },
        sessionUsage: telemetry ? { input: telemetry.input || 0, output: telemetry.output || 0 } : undefined,
        contextUsage: telemetry ? { tokens: telemetry.contextTokens, contextWindow: 372_000 } : undefined,
        autoCompactionEnabled: true,
        assistantMessageEvent: type === 'message_update'
            ? {
                type: 'text_delta',
                delta,
                partial: { content: text ? [{ type: 'text', text }] : [] }
            }
            : undefined
    })
}

emitAssistantMessage('message_start', '', '', { contextTokens: 20_000 })
emitAssistantMessage('message_update', planningText, planningText, { contextTokens: 20_600 })
emitAssistantMessage('message_end', planningText, planningText, { contextTokens: 21_000, input: 19_000, output: 2_000 })
const liveUsageBeforeTool = runtimeEvents.findLast((event) => event.type === 'thread.token-usage.updated')
assert.equal(liveUsageBeforeTool?.type === 'thread.token-usage.updated' ? liveUsageBeforeTool.payload.usage.totalTokens : null, 21_000, 'running turns publish the latest context before tool execution and before turn completion')
assert.equal(context.activeTurnId, turnId, 'publishing live usage does not complete the active turn')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-search',
    toolName: 'bash',
    args: { command: 'rg -n harness .' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-search',
    toolName: 'bash',
    result: { output: 'match', details: { jobId: 'cmd-1', status: 'completed' } },
    isError: false
})

const finalHeading = '# Harness results'
emitAssistantMessage('message_start', '')
emitAssistantMessage('message_update', finalHeading)
emitAssistantMessage('message_update', finalMarkdown, finalMarkdown.slice(finalHeading.length))
emitAssistantMessage('message_end', finalMarkdown)

for (const type of ['message_start', 'message_end'] as const) {
    handleEvent({
        type,
        message: {
            role: 'assistant',
            content: [
                { type: 'thinking', thinking: thoughtMarkdown },
                { type: 'text', text: `${thoughtMarkdown}${narrationText}` }
            ]
        }
    })
}

const assistantContentEvents = runtimeEvents.filter((event) =>
    (event.type === 'content.delta' || event.type === 'content.completed')
    && event.payload.streamKind === 'assistant_text'
)
const completions = assistantContentEvents.filter((event) => event.type === 'content.completed')

assert.equal(completions.length, 3, 'planning, final, and narration lifecycles must each complete')
assert.equal(completions[0]?.itemId, `zyra-assistant-${turnId}-1`)
assert.equal(completions[1]?.itemId, `zyra-assistant-${turnId}-2`)
assert.equal(completions[2]?.itemId, `zyra-assistant-${turnId}-3`)
assert.notEqual(completions[0]?.itemId, completions[1]?.itemId, 'assistant lifecycles must not share an item ID')
assert.equal(completions[0]?.payload.text, planningText)
assert.equal(completions[1]?.payload.text, finalMarkdown)
assert.equal(completions[2]?.payload.text, narrationText, 'thought text must never leak into the public narration message')
const internalCompletion = runtimeEvents.findLast((event) => (
    event.type === 'content.completed'
    && event.payload.streamKind === 'reasoning_summary_text'
))
assert.equal(internalCompletion?.type === 'content.completed' ? internalCompletion.payload.text : null, thoughtMarkdown)
assert.equal(context.activeAssistantItemId, null, 'message_end must clear the active assistant lifecycle')

handleEvent({ type: 'compaction_start', reason: 'threshold' })
const runningCompactionEvent = runtimeEvents.findLast((event) => event.type === 'activity' && event.payload.kind === 'context.compaction')
assert.equal(runningCompactionEvent?.type === 'activity' ? runningCompactionEvent.payload.summary : null, 'AUTO-COMPACTING')
assert.equal(runningCompactionEvent?.type === 'activity' ? runningCompactionEvent.payload.data?.['status'] : null, 'running')
assert.equal(typeof (runningCompactionEvent?.type === 'activity' ? runningCompactionEvent.payload.activityId : null), 'string')

handleEvent({
    type: 'compaction_end',
    reason: 'threshold',
    result: {
        firstKeptEntryId: 'kept-entry',
        tokensBefore: 150_000,
        estimatedTokensAfter: 32_000
    },
    aborted: false,
    willRetry: false
})
const completedCompactionEvent = runtimeEvents.findLast((event) => event.type === 'activity' && event.payload.kind === 'context.compaction')
assert.equal(completedCompactionEvent?.type === 'activity' ? completedCompactionEvent.payload.summary : null, 'AUTO-COMPACTED')
assert.equal(completedCompactionEvent?.type === 'activity' ? completedCompactionEvent.payload.data?.['status'] : null, 'completed')
assert.equal(completedCompactionEvent?.type === 'activity' ? completedCompactionEvent.payload.data?.['tokensBefore'] : null, 150_000)
assert.equal(
    completedCompactionEvent?.type === 'activity' ? completedCompactionEvent.payload.activityId : null,
    runningCompactionEvent?.type === 'activity' ? runningCompactionEvent.payload.activityId : null,
    'compaction_end must update the same activity emitted by compaction_start'
)
const compactedUsageEvent = runtimeEvents.findLast((event) => event.type === 'thread.token-usage.updated')
assert.equal(compactedUsageEvent?.type === 'thread.token-usage.updated' ? compactedUsageEvent.payload.usage.totalTokens : null, 32_000, 'successful compaction resets the live context meter immediately')

const bridgeSource = readFileSync(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
assert.match(bridgeSource, /type === ["']compaction_end["']/, 'the Pi bridge must forward compaction_end instead of reducing it to a bare event type')
assert.match(bridgeSource, /estimatedTokensAfter/, 'the Pi bridge must retain bounded compaction result metrics')
assert.match(bridgeSource, /requestedThreadId = payload\.threadId \|\| payload\.providerThreadId/, 'desktop must prefer the canonical threadId while accepting the legacy providerThreadId alias')
assert.match(bridgeSource, /type === ["']generate_text["']/, 'title generation must use the Pi bridge instead of launching a detached Codex app-server')
assert.match(bridgeSource, /normalizeAgentSurfaceTool/, 'Pi tool events must cross the desktop bridge through the shared agent-surface normalizer')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
const accountServiceSource = readFileSync(new URL('../src/main/assistant/zyra-account-service.ts', import.meta.url), 'utf8')
const chatGptAccountSource = readFileSync(new URL('../../src/chatgpt-account.mjs', import.meta.url), 'utf8')
assert.match(runtimeSource, /threadId: requestedThreadId[\s\S]*noSession: false/, 'desktop chats must create persistent Pi threads that the TUI can resolve')
assert.doesNotMatch(runtimeSource, /CodexAppServerRuntime|codex-app-server/, 'the Pi runtime must not launch the retired Codex CLI for account data')
assert.match(accountServiceSource, /chatgpt-account\.mjs/, 'Desktop account settings must use the Electron-safe ChatGPT account module')
assert.doesNotMatch(accountServiceSource, /zyra-sdk\.mjs/, 'Desktop account settings must not import the full Pi SDK into Electron')
assert.doesNotMatch(chatGptAccountSource, /getCodexCliUsageAuth|Codex CLI auth|sign in with the Codex CLI|\.codex[\\/]auth/, '/codexusage must never fall back to the retired Codex CLI credentials')
assert.doesNotMatch(chatGptAccountSource, /Zyra auth storage|Zyra subscription login/, 'the account source must not be presented as a Zyra-owned subscription')

const separationRuntime = new ZyraPiRuntime()
const separationEvents: AssistantRuntimeEvent[] = []
separationRuntime.on('runtime', (event: AssistantRuntimeEvent) => separationEvents.push(event))
const separationContext = {
    ...context,
    activeTurnId: 'turn-separation',
    assistantMessageSequence: 0,
    activeAssistantItemId: null,
    assistantTextByItemId: new Map<string, string>(),
    assistantCompletedItemIds: new Set<string>(),
    internalTextByItemId: new Map<string, string>(),
    internalCompletedItemIds: new Set<string>()
}
const handleSeparationEvent = (event: unknown): void => {
    const handleZyraEvent = separationRuntime as unknown as {
        handleZyraEvent: (targetContext: typeof separationContext, eventValue: unknown) => void
    }
    handleZyraEvent.handleZyraEvent(separationContext, event)
}
handleSeparationEvent({
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'text', text: thoughtMarkdown }] },
    assistantMessageEvent: {
        type: 'thinking_delta',
        delta: thoughtMarkdown,
        partial: { content: [{ type: 'text', text: thoughtMarkdown }] }
    }
})
handleSeparationEvent({
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'text', text: `${thoughtMarkdown}${narrationText}` }] },
    assistantMessageEvent: {
        type: 'text_delta',
        delta: narrationText,
        partial: { content: [{ type: 'text', text: `${thoughtMarkdown}${narrationText}` }] }
    }
})
handleSeparationEvent({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: `${thoughtMarkdown}${narrationText}` }] }
})
const separatedAssistantCompletion = separationEvents.findLast((event) => (
    event.type === 'content.completed' && event.payload.streamKind === 'assistant_text'
))
const separatedInternalCompletion = separationEvents.findLast((event) => (
    event.type === 'content.completed' && event.payload.streamKind === 'reasoning_summary_text'
))
assert.equal(
    separatedAssistantCompletion?.type === 'content.completed' ? separatedAssistantCompletion.payload.text : null,
    narrationText,
    'thinking_delta snapshots encoded as text must not create a duplicate public thought message'
)
assert.equal(
    separatedInternalCompletion?.type === 'content.completed' ? separatedInternalCompletion.payload.text : null,
    thoughtMarkdown
)

const planningCompletedIndex = runtimeEvents.indexOf(completions[0]!)
const toolIndex = runtimeEvents.findIndex((event) => event.type === 'activity' && event.itemId === 'tool-search')
const finalCompletedIndex = runtimeEvents.indexOf(completions[1]!)
assert.ok(planningCompletedIndex < toolIndex, 'tool activity must follow the planning response')
assert.ok(toolIndex < finalCompletedIndex, 'final completion must follow tool activity')

const replayGuardRuntime = new ZyraPiRuntime()
const replayGuardEvents: AssistantRuntimeEvent[] = []
replayGuardRuntime.on('runtime', (event: AssistantRuntimeEvent) => replayGuardEvents.push(event))
const replayGuardContext = {
    ...context,
    activeTurnId: null,
    completedTurnIds: new Set<string>(['turn-already-completed']),
    assistantMessageSequence: 0,
    activeAssistantItemId: null,
    assistantTextByItemId: new Map<string, string>(),
    assistantCompletedItemIds: new Set<string>(),
    internalTextByItemId: new Map<string, string>(),
    internalCompletedItemIds: new Set<string>(),
    lastAssistantItemId: null
}
const replayGuardHandler = replayGuardRuntime as unknown as {
    handleZyraEvent: (
        targetContext: typeof replayGuardContext,
        eventValue: unknown,
        eventMetadata?: { turnId?: string; localThreadId?: string; replay?: boolean }
    ) => void
}
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'agent_end'
}, { turnId: 'turn-historical-replay', replay: true })
assert.equal(
    replayGuardEvents.filter((event) => event.type === 'turn.completed' && event.turnId === 'turn-historical-replay').length,
    1,
    'a replayed agent_end repairs a historical turn from the durable provider boundary'
)
replayGuardEvents.length = 0
replayGuardContext.completedTurnIds.clear()
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_end',
    message: { id: 'replayed-final', role: 'assistant', content: [{ type: 'text', text: 'Historical final response' }] }
}, { turnId: 'turn-historical-replay', replay: true })
assert.equal(
    replayGuardEvents.some((event) => event.type === 'turn.started'),
    false,
    'historical replay correlation cannot reactivate a settled turn when a chat is opened'
)
assert.equal(replayGuardContext.activeTurnId, null, 'replay must leave the runtime idle')
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_start',
    message: { id: 'live-external', role: 'assistant', content: [] }
}, { turnId: 'turn-live-external', replay: false })
assert.equal(
    replayGuardEvents.some((event) => event.type === 'turn.started' && event.turnId === 'turn-live-external'),
    true,
    'a live externally-started canonical turn must still become active'
)
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'agent_end'
}, { turnId: 'turn-live-external', replay: false })
assert.equal(
    replayGuardEvents.filter((event) => event.type === 'turn.completed' && event.turnId === 'turn-live-external').length,
    1,
    'Pi agent_end is the authoritative final-response boundary for a live turn'
)
assert.equal(replayGuardContext.activeTurnId, null, 'authoritative completion clears the active turn')
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'zyra_server_turn_completed',
    outcome: 'completed'
}, { turnId: 'turn-live-external', replay: false })
assert.equal(
    replayGuardEvents.filter((event) => event.type === 'turn.completed' && event.turnId === 'turn-live-external').length,
    1,
    'the later synthetic server completion cannot duplicate agent_end completion'
)

replayGuardEvents.length = 0
replayGuardContext.completedTurnIds.clear()
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_end',
    message: {
        id: 'live-aborted-response',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '' }],
        stopReason: 'aborted',
        errorMessage: 'Request was aborted'
    }
}, { turnId: 'turn-live-aborted', replay: false })
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'agent_end'
}, { turnId: 'turn-live-aborted', replay: false })
const liveAbortedCompletion = replayGuardEvents.find((event) => event.type === 'turn.completed' && event.turnId === 'turn-live-aborted')
assert.equal(
    liveAbortedCompletion?.type === 'turn.completed' ? liveAbortedCompletion.payload.outcome : null,
    'interrupted',
    'agent_end must preserve the aborted assistant response as an interrupted TUI turn'
)
assert.equal(replayGuardContext.activeTurnId, null)

replayGuardEvents.length = 0
replayGuardContext.completedTurnIds.clear()
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_end',
    message: {
        id: 'live-retry-error',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'The provider request failed and will be retried.'
    }
}, { turnId: 'turn-live-recovered', replay: false })
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_start',
    message: {
        id: 'live-retry-success',
        role: 'assistant',
        content: []
    }
}, { turnId: 'turn-live-recovered', replay: false })
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'message_end',
    message: {
        id: 'live-retry-success',
        role: 'assistant',
        content: [{ type: 'text', text: 'Recovered response' }]
    }
}, { turnId: 'turn-live-recovered', replay: false })
assert.equal(
    replayGuardEvents.some((event) => event.type === 'turn.completed' && event.turnId === 'turn-live-recovered'),
    false,
    'an in-turn provider error must not finish the turn while later assistant events are still arriving'
)
replayGuardHandler.handleZyraEvent(replayGuardContext, {
    type: 'agent_end'
}, { turnId: 'turn-live-recovered', replay: false })
const recoveredCompletion = replayGuardEvents.find((event) => (
    event.type === 'turn.completed' && event.turnId === 'turn-live-recovered'
))
assert.equal(
    recoveredCompletion?.type === 'turn.completed' ? recoveredCompletion.payload.outcome : null,
    'completed',
    'a successful assistant message after an in-turn error must clear the stale failure outcome'
)
assert.equal(replayGuardContext.activeTurnId, null)

const completedToolEvent = runtimeEvents.findLast((event) => event.type === 'activity' && event.itemId === 'tool-search')
const completedToolData = completedToolEvent?.type === 'activity'
    ? completedToolEvent.payload.data as Record<string, unknown>
    : null
assert.equal(completedToolData?.['command'], 'rg -n harness .', 'tool completion must retain start arguments when the end event omits them')
assert.equal(typeof completedToolData?.['startedAt'], 'string')
assert.equal(typeof completedToolData?.['completedAt'], 'string')
assert.equal(typeof completedToolData?.['durationMs'], 'number')

handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-surface-contract',
    toolName: 'provider_lookup',
    args: { query: 'agent surface contract' },
    surface: {
        version: 1,
        kind: 'search',
        lifecycle: 'completed',
        toolName: 'provider_lookup',
        toolKey: 'provider lookup',
        primaryText: 'agent surface contract',
        query: 'agent surface contract',
        paths: [],
        summary: 'Searched'
    }
})
const canonicalSurfaceEvent = runtimeEvents.findLast((event) => event.type === 'activity' && event.itemId === 'tool-surface-contract')
assert.equal(canonicalSurfaceEvent?.type === 'activity' ? canonicalSurfaceEvent.payload.kind : null, 'search')
assert.equal(canonicalSurfaceEvent?.type === 'activity' ? canonicalSurfaceEvent.payload.summary : null, 'Searched')
const canonicalSurfaceData = canonicalSurfaceEvent?.type === 'activity'
    ? canonicalSurfaceEvent.payload.data?.['surface'] as Record<string, unknown> | undefined
    : undefined
assert.equal(canonicalSurfaceData?.['version'], 1)
assert.equal(canonicalSurfaceData?.['kind'], 'search')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-status',
    toolName: 'bash',
    args: { action: 'status', jobId: 'cmd-1' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-status',
    toolName: 'bash',
    result: { output: 'still running' },
    isError: false
})
const completedStatusEvent = runtimeEvents.findLast((event) => event.type === 'activity' && event.itemId === 'tool-status')
const completedStatusData = completedStatusEvent?.type === 'activity'
    ? completedStatusEvent.payload.data as Record<string, unknown>
    : null
assert.equal(completedStatusEvent?.type === 'activity' ? completedStatusEvent.payload.kind : null, 'command.checkpoint')
assert.equal(completedStatusData?.['commandAction'], 'status')
assert.equal(completedStatusData?.['jobId'], 'cmd-1')
assert.equal(
    completedStatusData?.['relatedCommandActivityId'],
    'zyra-tool-tool-search',
    'managed shell checks must link back to the original command activity'
)
const normalizedStatusPayload = completedStatusEvent?.type === 'activity'
    ? normalizeRuntimeActivityPayload(completedStatusEvent.payload)
    : null
assert.equal(normalizedStatusPayload?.kind, 'command.checkpoint', 'service normalization must preserve checkpoint semantics')
assert.equal(normalizedStatusPayload?.data?.['category'], 'command-checkpoint')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-long-command',
    toolName: 'bash',
    args: { command: 'node long-running-task.mjs' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-long-command',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command still running (cmd-2).' }],
        details: { jobId: 'cmd-2', status: 'running' }
    },
    isError: false
})
const runningManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-long-command'
))
const runningManagedCommandData = runningManagedCommand?.type === 'activity'
    ? runningManagedCommand.payload.data as Record<string, unknown>
    : null
assert.equal(runningManagedCommandData?.['status'], 'running', 'an ended tool call with a live managed job must keep the original command running')
assert.equal(runningManagedCommandData?.['completedAt'], undefined, 'a live managed job must not persist a false command completion time')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-long-poll',
    toolName: 'bash',
    args: { action: 'status', jobId: 'cmd-2' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-long-poll',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command still running (cmd-2).\nCommand: node long-running-task.mjs' }],
        details: { jobId: 'cmd-2', status: 'running' }
    },
    isError: false
})
const runningCheckpoint = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-long-poll'
))
const runningCheckpointData = runningCheckpoint?.type === 'activity'
    ? runningCheckpoint.payload.data as Record<string, unknown>
    : null
assert.equal(runningCheckpointData?.['status'], 'completed', 'the checkpoint call must complete even while the managed job remains running')
const stillRunningManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-long-command'
))
assert.equal(
    stillRunningManagedCommand?.type === 'activity' ? stillRunningManagedCommand.payload.data?.['status'] : null,
    'running',
    'a non-terminal checkpoint must keep the original managed command running'
)

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-long-status',
    toolName: 'bash',
    args: { action: 'status', jobId: 'cmd-2' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-long-status',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command completed (cmd-2).' }],
        details: { jobId: 'cmd-2', status: 'completed' }
    },
    isError: false
})
const completedManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-long-command'
))
const completedManagedCommandData = completedManagedCommand?.type === 'activity'
    ? completedManagedCommand.payload.data as Record<string, unknown>
    : null
assert.equal(completedManagedCommandData?.['status'], 'completed', 'a terminal checkpoint must complete the original managed command activity')
assert.equal(typeof completedManagedCommandData?.['completedAt'], 'string')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-stoppable-command',
    toolName: 'bash',
    args: { command: 'node stoppable-task.mjs' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-stoppable-command',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command still running (cmd-3).\nCommand: node stoppable-task.mjs' }],
        details: { jobId: 'cmd-3', status: 'running' }
    },
    isError: false
})
handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-stop-command',
    toolName: 'bash',
    args: { action: 'stop', jobId: 'cmd-3' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-stop-command',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command stopped (cmd-3).\nCommand: node stoppable-task.mjs' }],
        details: { jobId: 'cmd-3', status: 'stopped' }
    },
    isError: false
})
const stoppedManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-stoppable-command'
))
assert.equal(stoppedManagedCommand?.type === 'activity' ? stoppedManagedCommand.payload.data?.['status'] : null, 'stopped')
assert.equal(stoppedManagedCommand?.type === 'activity' ? stoppedManagedCommand.payload.tone : null, 'warning')
const normalizedStoppedCommand = stoppedManagedCommand?.type === 'activity'
    ? normalizeRuntimeActivityPayload(stoppedManagedCommand.payload)
    : null
assert.equal(normalizedStoppedCommand?.data?.['status'], 'stopped')
assert.equal(normalizedStoppedCommand?.tone, 'warning', 'a deliberate stop must not normalize into a failed command')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-failing-command',
    toolName: 'bash',
    args: { command: 'node failing-task.mjs' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-failing-command',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command still running (cmd-4).\nCommand: node failing-task.mjs' }],
        details: { jobId: 'cmd-4', status: 'running' }
    },
    isError: false
})
handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-failing-status',
    toolName: 'bash',
    args: { action: 'status', jobId: 'cmd-4' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-failing-status',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command failed (cmd-4).\nCommand: node failing-task.mjs' }],
        details: { jobId: 'cmd-4', status: 'failed' }
    },
    isError: true
})
const failedManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-failing-command'
))
assert.equal(failedManagedCommand?.type === 'activity' ? failedManagedCommand.payload.data?.['status'] : null, 'failed')
assert.equal(failedManagedCommand?.type === 'activity' ? failedManagedCommand.payload.tone : null, 'error')

handleEvent({
    type: 'tool_execution_start',
    toolCallId: 'tool-observed-command',
    toolName: 'bash',
    args: { command: 'node observed-task.mjs' }
})
handleEvent({
    type: 'tool_execution_end',
    toolCallId: 'tool-observed-command',
    toolName: 'bash',
    result: {
        content: [{ type: 'text', text: 'Command still running (cmd-5).\nCommand: node observed-task.mjs' }],
        details: { jobId: 'cmd-5', status: 'running' }
    },
    isError: false
})
const activeTurnBeforeObservedCompletion = context.activeTurnId
;(context as { activeTurnId: string | null }).activeTurnId = null
handleEvent({
    type: 'managed_bash_job_update',
    jobId: 'cmd-5',
    toolCallId: 'tool-observed-command',
    command: 'node observed-task.mjs',
    status: 'completed',
    output: 'observer done',
    startedAt: '2026-07-10T16:00:00.000Z',
    completedAt: '2026-07-10T16:00:20.000Z',
    exitCode: 0
})
;(context as { activeTurnId: string | null }).activeTurnId = activeTurnBeforeObservedCompletion
const observedManagedCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === 'zyra-tool-tool-observed-command'
))
assert.equal(observedManagedCommand?.type === 'activity' ? observedManagedCommand.payload.data?.['status'] : null, 'completed')
assert.equal(observedManagedCommand?.turnId, undefined, 'background completion must remain deliverable after the model turn ends')
assert.equal(observedManagedCommand?.type === 'activity' ? observedManagedCommand.payload.data?.['durationMs'] : null, 20_000)
assert.equal(
    context.runningManagedCommandJobIds.has('cmd-5'),
    false,
    'an observed terminal job update must clear the private Voice task command barrier'
)

const observedRunningCommand = runtimeEvents.findLast((event) => (
    event.type === 'activity'
    && event.payload.activityId === 'zyra-tool-tool-observed-command'
    && event.payload.data?.['status'] === 'running'
))
assert.ok(observedRunningCommand?.type === 'activity')
assert.ok(observedManagedCommand?.type === 'activity')

const projectedThread: AssistantThread = {
    id: context.localThreadId,
    providerThreadId: context.providerThreadId,
    source: 'root',
    parentThreadId: null,
    providerParentThreadId: null,
    subagentDepth: null,
    agentNickname: null,
    agentRole: null,
    model: 'openai-codex/gpt-5.5',
    cwd: 'C:\\workspace',
    messageCount: 0,
    lastSeenCompletedTurnId: null,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    state: 'ready',
    lastError: null,
    createdAt: '2026-07-10T16:00:00.000Z',
    updatedAt: '2026-07-10T16:00:00.000Z',
    latestTurn: null,
    activePlan: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    pendingApprovals: [],
    pendingUserInputs: []
}
const projectedSession: AssistantSession = {
    id: 'session-lifecycle-projection',
    title: 'Lifecycle projection',
    mode: 'work',
    projectPath: 'C:\\workspace',
    playgroundLabId: null,
    pendingLabRequest: null,
    archived: false,
    createdAt: projectedThread.createdAt,
    updatedAt: projectedThread.updatedAt,
    activeThreadId: projectedThread.id,
    threadIds: [projectedThread.id],
    threads: [projectedThread]
}
const deletionFallbackSession: AssistantSession = {
    ...projectedSession,
    id: 'session-deletion-fallback',
    activeThreadId: 'thread-deletion-fallback',
    threadIds: ['thread-deletion-fallback'],
    threads: [{ ...projectedThread, id: 'thread-deletion-fallback', providerThreadId: null }]
}
let deletionSnapshot: AssistantSnapshot = {
    snapshotSequence: 0,
    updatedAt: projectedThread.createdAt,
    selectedSessionId: projectedSession.id,
    playground: { rootPath: null, labs: [] },
    sessions: [projectedSession, deletionFallbackSession],
    knownModels: []
}
const deletionOrder: string[] = []
await deleteAssistantSessionAction({
    ensureReady: async () => undefined,
    getSnapshot: () => deletionSnapshot,
    runtime: {
        updateCanonicalChat: async (threadId: string, patch: Record<string, unknown>) => {
            deletionOrder.push(`canonical:${threadId}:${String(patch.deleted)}`)
        },
        disconnect: (threadId: string) => deletionOrder.push(`disconnect:${threadId}`)
    },
    appendEvent: (type: string, _occurredAt: string, payload: Record<string, unknown>) => {
        deletionOrder.push(type)
        if (type === 'session.deleted') {
            deletionSnapshot = {
                ...deletionSnapshot,
                selectedSessionId: null,
                sessions: deletionSnapshot.sessions.filter((entry) => entry.id !== payload.sessionId)
            }
        } else if (type === 'session.selected') {
            deletionSnapshot = { ...deletionSnapshot, selectedSessionId: String(payload.sessionId) }
        }
    },
    createSession: async () => ({ success: true as const, sessionId: 'unused' })
} as never, projectedSession.id)
assert.deepEqual(
    deletionOrder.slice(0, 3),
    ['canonical:provider-lifecycle:true', 'disconnect:provider-lifecycle', 'session.deleted'],
    'Desktop deletion must persist a canonical tombstone before removing its local projection'
)
assert.deepEqual(
    getTitleGenerationModelCandidates('openai-codex/gpt-5.6-sol'),
    ['openai-codex/gpt-5.6-sol', 'openai-codex/gpt-5.6-luna', 'openai-codex/gpt-5.4-mini'],
    'an explicit title model should retain Luna and mini fallbacks'
)
assert.deepEqual(
    getTitleGenerationModelCandidates(),
    ['openai-codex/gpt-5.6-luna', 'openai-codex/gpt-5.4-mini'],
    'new title generation defaults to GPT-5.6 Luna without inheriting the conversation model'
)
assert.equal(getAssistantCanonicalThreadId(projectedThread), 'provider-lifecycle')
assert.equal(getAssistantCanonicalThreadId({ ...projectedThread, providerThreadId: null }), projectedThread.id)
assert.equal(matchesAssistantThreadId(projectedThread, projectedThread.id), true, 'legacy desktop thread keys must remain resolvable')
assert.equal(matchesAssistantThreadId(projectedThread, projectedThread.providerThreadId), true, 'canonical Pi thread IDs must resolve the same chat')
assert.equal(
    shouldGenerateSessionTitleForPrompt({ ...projectedSession, title: 'New Session' }),
    true,
    'a new chat should queue one cheap-model title generation pass'
)
assert.equal(
    shouldGenerateSessionTitleForPrompt({
        ...projectedSession,
        title: 'New Session',
        threads: [{ ...projectedThread, messageCount: 1 }]
    }),
    true,
    'an existing chat that still has the default title must retry generation'
)
const failedTitleThread: AssistantThread = {
    ...projectedThread,
    messageCount: 1,
    messages: [{
        id: 'message-title-seed',
        role: 'user',
        text: 'hello',
        turnId: null,
        streaming: false,
        createdAt: projectedThread.createdAt,
        updatedAt: projectedThread.createdAt
    }]
}
const failedTitleSession: AssistantSession = {
    ...projectedSession,
    title: 'hello',
    threads: [failedTitleThread]
}
assert.equal(
    shouldGenerateSessionTitleForPrompt(failedTitleSession),
    true,
    'an existing chat whose title is still the first-message heuristic must retry generation'
)
assert.equal(
    shouldGenerateSessionTitleForPrompt({
        ...failedTitleSession,
        threads: [{ ...failedTitleThread, messages: [] }]
    }, 'hello'),
    true,
    'paged shell snapshots must recover titles from the lightweight persisted first-message lookup'
)
assert.equal(
    shouldGenerateSessionTitleForPrompt({ ...failedTitleSession, title: 'Manually named chat' }),
    false,
    'manual titles must never be replaced by recovery'
)
const generatedTitleEvents: Array<{ type: AssistantDomainEvent['type']; payload: Record<string, unknown> }> = []
await queueGeneratedSessionTitle({
    sessionId: failedTitleSession.id,
    threadId: failedTitleThread.id,
    messageText: 'Standardize desktop and TUI thread IDs without breaking existing chats.',
    seedTitle: failedTitleSession.title,
    cwd: 'C:\\workspace',
    preferredModel: failedTitleThread.model,
    generateText: async () => ({ success: true, text: 'Standardize Zyra Thread IDs' }),
    getSnapshot: () => ({ sessions: [failedTitleSession] }),
    appendEvent: (type, _occurredAt, payload) => generatedTitleEvents.push({ type, payload })
})
assert.equal(generatedTitleEvents.length, 1)
assert.equal(generatedTitleEvents[0]?.type, 'session.updated')
assert.equal((generatedTitleEvents[0]?.payload.patch as { title?: string })?.title, 'Standardize Zyra Thread IDs')
let projectedSnapshot: AssistantSnapshot = {
    snapshotSequence: 0,
    updatedAt: projectedThread.createdAt,
    selectedSessionId: projectedSession.id,
    playground: { rootPath: null, labs: [] },
    sessions: [projectedSession],
    knownModels: []
}
let projectedSequence = 0
const findProjectedRecord = (threadId: string): { session: AssistantSession; thread: AssistantThread } | null => {
    for (const session of projectedSnapshot.sessions) {
        const thread = session.threads.find((entry) => entry.id === threadId || entry.providerThreadId === threadId)
        if (thread) return { session, thread }
    }
    return null
}
const projectedDeps = {
    planBuffers: new Map<string, string>(),
    assistantTextBuffers: new Map<string, string>(),
    isAssistantTextSuppressed: () => false,
    findSessionByThreadId: (threadId: string) => findProjectedRecord(threadId)?.session || null,
    requireThread: (threadId: string) => {
        const thread = findProjectedRecord(threadId)?.thread
        if (!thread) throw new Error(`Missing projected thread ${threadId}`)
        return thread
    },
    findThreadRecord: findProjectedRecord,
    queueAssistantTextDelta: () => {},
    flushAssistantTextDelta: () => {},
    queueAssistantActivityDelta: () => {},
    flushAssistantActivityDelta: () => {},
    appendEvent: (
        type: AssistantDomainEvent['type'],
        occurredAt: string,
        payload: Record<string, unknown>,
        sessionId?: string,
        threadId?: string
    ) => {
        projectedSequence += 1
        projectedSnapshot = applyAssistantDomainEvent(projectedSnapshot, {
            sequence: projectedSequence,
            eventId: `projected-event-${projectedSequence}`,
            type,
            occurredAt,
            sessionId,
            threadId,
            payload
        })
    },
    updateLatestTurnAssistantMessage: () => {}
}
const recoveredTurnEvents = replayGuardEvents.filter((event) => event.turnId === 'turn-live-recovered')
const recoveredTurnCompletionIndex = recoveredTurnEvents.findIndex((event) => event.type === 'turn.completed')
assert.ok(recoveredTurnCompletionIndex > 0)
for (const event of recoveredTurnEvents.slice(0, recoveredTurnCompletionIndex)) {
    handleAssistantRuntimeEvent(event, projectedDeps)
}
const recoveringProjectedThread = findProjectedRecord(projectedThread.id)?.thread
assert.equal(recoveringProjectedThread?.state, 'running')
assert.equal(recoveringProjectedThread?.latestTurn?.state, 'running')
assert.equal(recoveringProjectedThread?.lastError, null)
handleAssistantRuntimeEvent(recoveredTurnEvents[recoveredTurnCompletionIndex]!, projectedDeps)
const recoveredProjectedThread = findProjectedRecord(projectedThread.id)?.thread
assert.equal(recoveredProjectedThread?.state, 'ready')
assert.equal(recoveredProjectedThread?.latestTurn?.state, 'completed')
assert.equal(recoveredProjectedThread?.lastError, null)

const stalePreviousTurnStartedAt = '2026-07-10T15:00:00.000Z'
projectedDeps.appendEvent('thread.latest-turn.updated', stalePreviousTurnStartedAt, {
    threadId: projectedThread.id,
    latestTurn: {
        id: 'previous-app-server-turn',
        state: 'completed',
        requestedAt: stalePreviousTurnStartedAt,
        startedAt: stalePreviousTurnStartedAt,
        completedAt: '2026-07-10T15:05:00.000Z',
        assistantMessageId: 'previous-assistant-message',
        effort: 'medium',
        serviceTier: null,
        usage: null
    }
}, projectedSession.id, projectedThread.id)
const externalTurnStartedAt = '2026-07-10T16:00:30.000Z'
handleAssistantRuntimeEvent({
    eventId: 'external-app-server-turn-started',
    type: 'turn.started',
    createdAt: externalTurnStartedAt,
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId,
    payload: {
        model: projectedThread.model,
        interactionMode: 'default',
        effort: 'high'
    }
}, projectedDeps)
const externallyStartedTurn = findProjectedRecord(projectedThread.id)?.thread.latestTurn
assert.equal(externallyStartedTurn?.id, turnId, 'a new app-server turn must replace the previous Desktop latest-turn identity')
assert.equal(externallyStartedTurn?.startedAt, externalTurnStartedAt, 'a new app-server timer must start from its own event time')
assert.equal(externallyStartedTurn?.completedAt, null)
assert.equal(externallyStartedTurn?.assistantMessageId, null)
assert.equal(externallyStartedTurn?.state, 'running')
if (synchronizedConfigEvent?.type === 'session.config.updated') {
    handleAssistantRuntimeEvent(synchronizedConfigEvent, projectedDeps)
}
assert.equal(findProjectedRecord(context.localThreadId)?.thread.model, 'openai-codex/gpt-5.5')
assert.equal(findProjectedRecord(context.localThreadId)?.thread.thinking, 'high')
assert.equal(findProjectedRecord(context.localThreadId)?.thread.profile, 'builder')
assert.equal(findProjectedRecord(context.localThreadId)?.thread.runtimeMode, 'full-access')
if (externalUserMessageEvent?.type === 'user.message.received') {
    handleAssistantRuntimeEvent(externalUserMessageEvent, projectedDeps)
    handleAssistantRuntimeEvent(externalUserMessageEvent, projectedDeps)
}
const projectedExternalUserMessages = findProjectedRecord(context.localThreadId)?.thread.messages.filter((message) => (
    message.id === `assistant-message-user-${turnId}`
)) || []
assert.equal(projectedExternalUserMessages.length, 1, 'external user-message replay must remain idempotent')
assert.equal(projectedExternalUserMessages[0]?.text, externalPrompt)
assert.equal(projectedExternalUserMessages[0]?.turnId, turnId)

if (runningCompactionEvent?.type === 'activity' && completedCompactionEvent?.type === 'activity') {
    handleAssistantRuntimeEvent(runningCompactionEvent, projectedDeps)
    handleAssistantRuntimeEvent(completedCompactionEvent, projectedDeps)
}
const projectedCompactionActivities = findProjectedRecord(context.localThreadId)?.thread.activities.filter((activity) => activity.kind === 'context.compaction') || []
assert.equal(projectedCompactionActivities.length, 1, 'start and end must persist as one compaction activity')
assert.equal(projectedCompactionActivities[0]?.payload?.['status'], 'completed')
assert.equal(projectedCompactionActivities[0]?.payload?.['startedAt'], runningCompactionEvent?.type === 'activity' ? runningCompactionEvent.payload.data?.['startedAt'] : null)
assert.equal(typeof projectedCompactionActivities[0]?.payload?.['completedAt'], 'string')

handleAssistantRuntimeEvent(observedRunningCommand, projectedDeps)
const runningProjectedActivity = findProjectedRecord(context.localThreadId)?.thread.activities.find((activity) => activity.id === 'zyra-tool-tool-observed-command')
assert.match(String(runningProjectedActivity?.payload?.['output'] || ''), /Command still running/)
const runningTimelineSequence = runningProjectedActivity?.timelineSequence
handleAssistantRuntimeEvent(observedManagedCommand, projectedDeps)
const completedProjectedActivities = findProjectedRecord(context.localThreadId)?.thread.activities || []
const completedProjectedCommands = completedProjectedActivities.filter((activity) => activity.id === 'zyra-tool-tool-observed-command')
assert.equal(completedProjectedCommands.length, 1, 'same-ID observer updates must replace the original persisted activity')
assert.equal(completedProjectedCommands[0]?.payload?.['status'], 'completed')
assert.equal(completedProjectedCommands[0]?.payload?.['output'], 'observer done', 'terminal observer output must replace the stale still-running wrapper')
assert.equal(completedProjectedCommands[0]?.timelineSequence, runningTimelineSequence, 'same-ID updates must preserve timeline position')

handleAssistantRuntimeEvent({
    eventId: 'external-app-server-turn-completed',
    type: 'turn.completed',
    createdAt: '2026-07-10T16:00:45.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId,
    payload: { outcome: 'completed' }
}, projectedDeps)
const externallyCompletedTurn = findProjectedRecord(projectedThread.id)?.thread.latestTurn
assert.equal(externallyCompletedTurn?.id, turnId)
assert.equal(externallyCompletedTurn?.startedAt, externalTurnStartedAt, 'completion must preserve the matching turn start time')
assert.equal(externallyCompletedTurn?.completedAt, '2026-07-10T16:00:45.000Z')
assert.equal(externallyCompletedTurn?.state, 'completed')

const nextExternalTurnId = 'turn-after-external-completion'
const nextExternalTurnStartedAt = '2026-07-10T16:00:50.000Z'
handleAssistantRuntimeEvent({
    eventId: 'next-external-app-server-turn-started',
    type: 'turn.started',
    createdAt: nextExternalTurnStartedAt,
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId: nextExternalTurnId,
    payload: {
        model: projectedThread.model,
        interactionMode: 'default'
    }
}, projectedDeps)
const nextExternallyStartedTurn = findProjectedRecord(projectedThread.id)?.thread.latestTurn
assert.equal(nextExternallyStartedTurn?.id, nextExternalTurnId, 'consecutive app-server turns must receive distinct ledger rows')
assert.equal(nextExternallyStartedTurn?.startedAt, nextExternalTurnStartedAt)
assert.equal(nextExternallyStartedTurn?.assistantMessageId, null)
assert.equal(nextExternallyStartedTurn?.usage, null)

handleAssistantRuntimeEvent({
    eventId: 'stale-external-app-server-turn-completed',
    type: 'turn.completed',
    createdAt: '2026-07-10T16:00:46.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId,
    payload: { outcome: 'completed' }
}, projectedDeps)
const turnAfterStaleCompletion = findProjectedRecord(projectedThread.id)?.thread.latestTurn
assert.equal(turnAfterStaleCompletion?.id, nextExternalTurnId, 'an older completion must not overwrite the newer running turn')
assert.equal(turnAfterStaleCompletion?.state, 'running')
assert.equal(turnAfterStaleCompletion?.startedAt, nextExternalTurnStartedAt)

handleAssistantRuntimeEvent({
    eventId: 'usage-limit-turn',
    type: 'turn.completed',
    createdAt: '2026-07-10T16:01:00.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId: 'turn-usage-limit',
    payload: {
        outcome: 'failed',
        errorMessage: 'Codex error: The usage limit has been reached'
    }
}, projectedDeps)
const noticeProjectedThread = findProjectedRecord(projectedThread.id)?.thread
const projectedModelNotice = noticeProjectedThread?.activities.find((activity) => activity.kind === 'model.notice')
assert.equal(noticeProjectedThread?.state, 'ready', 'a usage limit is a model notice, not a broken runtime state')
assert.equal(noticeProjectedThread?.lastError, null)
assert.equal(noticeProjectedThread?.latestTurn?.state, 'interrupted')
assert.equal(projectedModelNotice?.summary, 'Usage limit reached')
assert.equal(projectedModelNotice?.payload?.['model'], 'gpt-5.5')

const persistenceBuffers = new Map<string, string>()
const persistedMessages = new Map<string, string>()
for (const event of assistantContentEvents) {
    const messageId = `assistant-message-${event.itemId}`
    if (event.type === 'content.delta') {
        persistenceBuffers.set(messageId, `${persistenceBuffers.get(messageId) || ''}${event.payload.delta}`)
        continue
    }

    const completedText = event.payload.text || persistenceBuffers.get(messageId) || ''
    persistenceBuffers.delete(messageId)
    persistedMessages.set(messageId, completedText)
}

const finalMessageId = `assistant-message-${completions[1]?.itemId}`
assert.equal(persistenceBuffers.size, 0, 'no assistant delta may remain stranded without a completion')
assert.equal(persistedMessages.size, 3)
assert.equal(persistedMessages.get(finalMessageId), finalMarkdown, 'the persistence-facing final message must preserve exact Markdown')
assert.equal(persistedMessages.get(finalMessageId)?.includes(planningText), false, 'the final message must not inherit planning text')

const fileChangeRuntime = new ZyraPiRuntime()
const fileChangeEvents: AssistantRuntimeEvent[] = []
fileChangeRuntime.on('runtime', (event: AssistantRuntimeEvent) => fileChangeEvents.push(event))
const fileChangeContext = {
    ...context,
    cwd: 'C:\\workspace',
    activeTurnId: 'turn-file-change',
    toolArgsByCallId: new Map<string, Record<string, unknown>>(),
    toolStartedAtByCallId: new Map<string, string>(),
    commandActivityIdByJobId: new Map<string, string>()
}
const handleFileChangeEvent = (event: unknown): void => {
    const handler = fileChangeRuntime as unknown as {
        handleZyraEvent: (targetContext: typeof fileChangeContext, eventValue: unknown) => void
    }
    handler.handleZyraEvent(fileChangeContext, event)
}
handleFileChangeEvent(piEditFixture.start)
const piEditStart = fileChangeEvents.findLast((event) => event.type === 'activity')
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.activityId : null, `zyra-tool-${piEditFixture.toolCallId}`)
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.kind : null, 'file-change')
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['status'] : null, 'running')
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['toolLifecyclePhase'] : null, 'start')
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['source'] : null, 'args-preview')
assert.equal(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['patch'] : null, undefined)
assert.match(String(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['previewPatch'] : ''), /const answer = 42/)
assert.deepEqual(piEditStart?.type === 'activity' ? piEditStart.payload.data?.['paths'] : null, [piEditFixture.path])
if (piEditStart?.type === 'activity') handleAssistantRuntimeEvent(piEditStart, projectedDeps)
const projectedRunningEdit = findProjectedRecord(context.localThreadId)?.thread.activities.find((activity) => activity.id === `zyra-tool-${piEditFixture.toolCallId}`)
assert.equal(projectedRunningEdit?.payload?.['status'], 'running', 'Pi edit start must become a visible running activity before completion')
assert.equal(projectedRunningEdit?.payload?.['toolLifecyclePhase'], 'start', 'service normalization must preserve the urgent start boundary')

handleFileChangeEvent(piEditFixture.update)
handleFileChangeEvent(piEditFixture.end)
const piEditEnd = fileChangeEvents.findLast((event) => event.type === 'activity')
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.activityId : null, `zyra-tool-${piEditFixture.toolCallId}`)
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['status'] : null, 'completed')
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['toolLifecyclePhase'] : null, 'end')
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['source'] : null, 'provider-result')
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['authoritative'] : null, true)
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['patch'] : null, piEditFixture.end.result.details.patch)
assert.equal(piEditEnd?.type === 'activity' ? piEditEnd.payload.data?.['displayDiff'] : null, piEditFixture.end.result.details.diff)
const piEditRawResult = piEditEnd?.type === 'activity'
    ? piEditEnd.payload.data?.['result'] as Record<string, unknown> | undefined
    : undefined
const piEditRawDetails = piEditRawResult?.['details'] as Record<string, unknown> | undefined
assert.equal(piEditRawDetails?.['patch'], undefined, 'raw file-change results must not duplicate canonical patches')
assert.equal(piEditRawDetails?.['diff'], undefined, 'raw file-change results must not duplicate canonical display diffs')
assert.deepEqual(piEditRawResult?.['content'], piEditFixture.end.result.content, 'raw result text remains available after patch stripping')
assert.equal(
    fileChangeEvents.filter((event) => event.type === 'activity' && event.payload.activityId === `zyra-tool-${piEditFixture.toolCallId}`).length,
    3,
    'Pi start/update/end emit revisions for one stable activity instead of separate IDs'
)
if (piEditEnd?.type === 'activity') handleAssistantRuntimeEvent(piEditEnd, projectedDeps)
const projectedCompletedEdits = findProjectedRecord(context.localThreadId)?.thread.activities.filter((activity) => activity.id === `zyra-tool-${piEditFixture.toolCallId}`) || []
assert.equal(projectedCompletedEdits.length, 1, 'edit completion updates the already-visible running row')
assert.equal(projectedCompletedEdits[0]?.payload?.['status'], 'completed')

handleFileChangeEvent({
    type: 'tool_execution_start',
    toolCallId: 'pi-read-lines',
    toolName: 'read',
    args: { path: 'src/large.ts', offset: 51, limit: 50 }
})
const piReadStart = fileChangeEvents.findLast((event) => event.type === 'activity' && event.itemId === 'pi-read-lines')
assert.equal(piReadStart?.type === 'activity' ? piReadStart.payload.kind : null, 'file-read')
assert.equal(piReadStart?.type === 'activity' ? piReadStart.payload.data?.['status'] : null, 'running')
assert.equal(piReadStart?.type === 'activity' ? piReadStart.payload.data?.['toolLifecyclePhase'] : null, 'start')
const readBody = Array.from({ length: 50 }, (_, index) => `line ${index + 51}`).join('\n')
handleFileChangeEvent({
    type: 'tool_execution_end',
    toolCallId: 'pi-read-lines',
    toolName: 'read',
    result: {
        content: [{ type: 'text', text: `${readBody}\n\n[Showing lines 51-100 of 240. Use offset=101 to continue.]` }]
    },
    isError: false
})
const piReadEnd = fileChangeEvents.findLast((event) => event.type === 'activity' && event.itemId === 'pi-read-lines')
assert.equal(piReadEnd?.type === 'activity' ? piReadEnd.payload.data?.['readStartLine'] : null, 51)
assert.equal(piReadEnd?.type === 'activity' ? piReadEnd.payload.data?.['readEndLine'] : null, 100)
assert.equal(piReadEnd?.type === 'activity' ? piReadEnd.payload.data?.['readLineCount'] : null, 50)
assert.equal(piReadEnd?.type === 'activity' ? piReadEnd.payload.data?.['readTotalLines'] : null, 240)
assert.equal(piReadEnd?.type === 'activity' ? piReadEnd.payload.data?.['readComplete'] : null, false)

handleFileChangeEvent({
    type: 'tool_execution_start',
    toolCallId: piWriteFailureFixture.toolCallId,
    toolName: 'write',
    args: piWriteFailureFixture.args
})
handleFileChangeEvent({
    type: 'tool_execution_end',
    toolCallId: piWriteFailureFixture.toolCallId,
    toolName: 'write',
    result: piWriteFailureFixture.result,
    isError: true
})
const failedWrite = fileChangeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === `zyra-tool-${piWriteFailureFixture.toolCallId}`
))
assert.equal(failedWrite?.type === 'activity' ? failedWrite.payload.data?.['status'] : null, 'failed')
assert.equal(failedWrite?.type === 'activity' ? failedWrite.payload.data?.['authoritative'] : null, false)
assert.equal(failedWrite?.type === 'activity' ? failedWrite.payload.data?.['patch'] : null, undefined)
assert.match(String(failedWrite?.type === 'activity' ? failedWrite.payload.data?.['previewPatch'] : ''), /uncommitted/)

const writeExistingPatch = `--- a/${piWriteExistingFixture.path}\n+++ b/${piWriteExistingFixture.path}\n@@ -1 +1 @@\n-export const version = 1\n+export const version = 2\n`
handleFileChangeEvent({
    type: 'tool_execution_start',
    toolCallId: piWriteExistingFixture.toolCallId,
    toolName: 'write',
    args: { path: piWriteExistingFixture.path, content: piWriteExistingFixture.after }
})
handleFileChangeEvent({
    type: 'tool_execution_end',
    toolCallId: piWriteExistingFixture.toolCallId,
    toolName: 'write',
    result: {
        content: [{ type: 'text', text: 'Successfully wrote file' }],
        details: {
            source: 'synthetic-snapshot',
            snapshotBacked: true,
            authoritative: true,
            path: piWriteExistingFixture.path,
            paths: [piWriteExistingFixture.path],
            changes: [{ path: piWriteExistingFixture.path, kind: 'update', diff: writeExistingPatch }],
            patch: writeExistingPatch,
            diff: '- export const version = 1\n+ export const version = 2'
        }
    },
    isError: false
})
const writeExisting = fileChangeEvents.findLast((event) => (
    event.type === 'activity' && event.payload.activityId === `zyra-tool-${piWriteExistingFixture.toolCallId}`
))
assert.equal(writeExisting?.type === 'activity' ? writeExisting.payload.data?.['source'] : null, 'synthetic-snapshot')
assert.equal(writeExisting?.type === 'activity' ? writeExisting.payload.data?.['authoritative'] : null, true)
assert.equal(writeExisting?.type === 'activity' ? writeExisting.payload.data?.['snapshotBacked'] : null, true)
assert.equal(writeExisting?.type === 'activity' ? writeExisting.payload.data?.['patch'] : null, writeExistingPatch)

const backgroundLifecycleThreadBefore = findProjectedRecord(projectedThread.id)?.thread
assert.ok(backgroundLifecycleThreadBefore)
const backgroundLifecycleActivityCount = backgroundLifecycleThreadBefore.activities.length
const backgroundConnectError = 'Agent bridge request connect timed out.'
handleAssistantRuntimeEvent({
    eventId: 'background-connect-timeout',
    type: 'session.state.changed',
    createdAt: '2026-07-10T17:00:00.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    payload: { state: 'error', error: backgroundConnectError, message: backgroundConnectError }
}, projectedDeps)
const backgroundConnectThread = findProjectedRecord(projectedThread.id)?.thread
assert.equal(backgroundConnectThread?.lastError, backgroundConnectError)
assert.equal(backgroundConnectThread?.state, 'error')
assert.equal(backgroundConnectThread?.updatedAt, '2026-07-10T17:00:00.000Z')
assert.equal(
    backgroundConnectThread?.activities.length,
    backgroundLifecycleActivityCount,
    'background connection failures must not become durable Agent Inbox timeline work'
)
handleAssistantRuntimeEvent({
    eventId: 'background-session-disconnect',
    type: 'session.state.changed',
    createdAt: '2026-07-10T17:00:01.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    payload: { state: 'stopped', message: 'Zyra session disconnected.' }
}, projectedDeps)
const disconnectedBackgroundThread = findProjectedRecord(projectedThread.id)?.thread
assert.equal(disconnectedBackgroundThread?.state, 'stopped')
assert.equal(disconnectedBackgroundThread?.lastError, null)
assert.equal(
    disconnectedBackgroundThread?.activities.length,
    backgroundLifecycleActivityCount,
    'navigation disconnects must not become durable Agent Inbox timeline work'
)
handleAssistantRuntimeEvent({
    eventId: 'turn-scoped-runtime-error',
    type: 'session.state.changed',
    createdAt: '2026-07-10T17:00:02.000Z',
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId: 'turn-visible-runtime-error',
    payload: { state: 'error', error: 'Provider request failed.', message: 'Provider request failed.' }
}, projectedDeps)
assert.equal(
    findProjectedRecord(projectedThread.id)?.thread.activities.length,
    backgroundLifecycleActivityCount + 1,
    'turn-scoped runtime failures must remain visible in the canonical timeline'
)

const failedTurnRuntime = new ZyraPiRuntime()
const failedTurnEvents: AssistantRuntimeEvent[] = []
let failedPromptPayload: Record<string, unknown> | null = null
failedTurnRuntime.on('runtime', (event: AssistantRuntimeEvent) => failedTurnEvents.push(event))
const failedTurnId = 'turn-provider-error'
const failedTurnContext = {
    localThreadId: 'thread-provider-error',
    providerThreadId: 'provider-error',
    resumeProviderThreadId: 'provider-error',
    worker: {
        request: async (_type: string, payload?: Record<string, unknown>) => {
            failedPromptPayload = payload || null
            throw new Error('Codex error: The usage limit has been reached')
        },
        isAlive: () => true
    },
    connected: true,
    connectPromise: null,
    cwd: 'C:\\workspace',
    model: 'openai-codex/gpt-5.5',
    thinking: 'medium' as const,
    runtimeMode: 'approval-required' as const,
    interactionMode: 'default' as const,
    profile: 'default',
    activeTurnId: failedTurnId,
    completedTurnIds: new Set<string>(),
    assistantMessageSequence: 0,
    activeAssistantItemId: null,
    toolArgsByCallId: new Map<string, Record<string, unknown>>(),
    toolStartedAtByCallId: new Map<string, string>(),
    commandActivityIdByJobId: new Map<string, string>(),
    assistantTextByItemId: new Map<string, string>(),
    assistantCompletedItemIds: new Set<string>(),
    internalTextByItemId: new Map<string, string>(),
    internalCompletedItemIds: new Set<string>(),
    lastAssistantItemId: null,
    lastUsage: null
}
const failedTurnRunner = failedTurnRuntime as unknown as {
    runPromptTurn: (targetContext: typeof failedTurnContext, targetTurnId: string, prompt: string) => Promise<void>
}
await failedTurnRunner.runPromptTurn(failedTurnContext, failedTurnId, 'hello')
const failedTurnCompletion = failedTurnEvents.find((event) => event.type === 'turn.completed')
const postFailureSessionState = failedTurnEvents.findLast((event) => event.type === 'session.state.changed')
assert.equal(failedTurnCompletion?.type === 'turn.completed' ? failedTurnCompletion.payload.outcome : null, 'failed')
assert.equal(
    postFailureSessionState?.type === 'session.state.changed' ? postFailureSessionState.payload.state : null,
    'ready',
    'a provider request failure must keep a live bridge connected'
)
assert.equal(failedTurnContext.activeTurnId, null)
assert.equal(failedPromptPayload?.['skipTitleGeneration'], true, 'Desktop prompt transport must suppress the bridge worker\'s duplicate title request')

const transportFailureRuntime = new ZyraPiRuntime()
const transportFailureEvents: AssistantRuntimeEvent[] = []
transportFailureRuntime.on('runtime', (event: AssistantRuntimeEvent) => transportFailureEvents.push(event))
const transportFailureTurnId = 'turn-transport-error'
const transportFailureContext = {
    ...failedTurnContext,
    localThreadId: 'thread-transport-error',
    providerThreadId: 'provider-transport-error',
    resumeProviderThreadId: 'provider-transport-error',
    worker: {
        request: async () => { throw new Error('fetch failed') },
        isAlive: () => true
    },
    connected: true,
    activeTurnId: transportFailureTurnId,
    completedTurnIds: new Set<string>()
}
const transportFailureRunner = transportFailureRuntime as unknown as {
    runPromptTurn: (targetContext: typeof transportFailureContext, targetTurnId: string, prompt: string) => Promise<void>
}
await transportFailureRunner.runPromptTurn(transportFailureContext, transportFailureTurnId, 'hello')
const transportFailureSessionState = transportFailureEvents.findLast((event) => event.type === 'session.state.changed')
assert.equal(
    transportFailureSessionState?.type === 'session.state.changed' ? transportFailureSessionState.payload.state : null,
    'error',
    'a failed provider fetch must invalidate the stale transport so the desktop reconnects'
)
assert.equal(transportFailureContext.connected, false)
assert.equal(transportFailureContext.activeTurnId, null)

const serverOwnedDisconnectRuntime = new ZyraPiRuntime()
const serverOwnedDisconnectEvents: AssistantRuntimeEvent[] = []
serverOwnedDisconnectRuntime.on('runtime', (event: AssistantRuntimeEvent) => serverOwnedDisconnectEvents.push(event))
const serverOwnedTurnId = 'turn-server-owned-disconnect'
const serverOwnedDisconnectContext = {
    ...transportFailureContext,
    localThreadId: 'thread-server-owned-disconnect',
    providerThreadId: 'provider-server-owned-disconnect',
    resumeProviderThreadId: 'provider-server-owned-disconnect',
    worker: {
        serverOwnedLifecycle: true,
        request: async () => {
            throw Object.assign(new Error('Zyra agent-server connection closed.'), { code: 'AGENT_SERVER_DISCONNECTED' })
        },
        isAlive: () => false
    },
    connected: true,
    connectPromise: null,
    reconnectPromise: null,
    activeTurnId: serverOwnedTurnId,
    completedTurnIds: new Set<string>()
}
const serverOwnedDisconnectRunner = serverOwnedDisconnectRuntime as unknown as {
    runPromptTurn: (targetContext: typeof serverOwnedDisconnectContext, targetTurnId: string, prompt: string) => Promise<void>
}
await serverOwnedDisconnectRunner.runPromptTurn(serverOwnedDisconnectContext, serverOwnedTurnId, 'keep working')
assert.equal(serverOwnedDisconnectEvents.some((event) => event.type === 'turn.completed'), false, 'Desktop socket loss cannot falsely complete a server-owned turn')
assert.equal(serverOwnedDisconnectEvents.some((event) => event.type === 'session.state.changed'), false, 'transient Desktop detachment cannot overwrite canonical running state')
assert.equal(serverOwnedDisconnectContext.activeTurnId, serverOwnedTurnId)
assert.equal(serverOwnedDisconnectContext.completedTurnIds.has(serverOwnedTurnId), false, 'the later canonical completion must remain eligible')

const networkRetryRuntime = new ZyraPiRuntime()
const networkRetryEvents: AssistantRuntimeEvent[] = []
networkRetryRuntime.on('runtime', (event: AssistantRuntimeEvent) => networkRetryEvents.push(event))
const networkRetryTurnId = 'turn-network-recovery'
const networkRetryContext = {
    ...failedTurnContext,
    localThreadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || 'provider-network-recovery',
    resumeProviderThreadId: projectedThread.providerThreadId || 'provider-network-recovery',
    activeTurnId: networkRetryTurnId,
    completedTurnIds: new Set<string>(),
    terminalAssistantMessageOutcome: null,
    activeRetry: null
}
const networkRetryHandler = networkRetryRuntime as unknown as {
    handleZyraEvent: (
        targetContext: typeof networkRetryContext,
        event: Record<string, unknown>,
        metadata?: { turnId?: string; replay?: boolean; sequence?: number }
    ) => void
}
networkRetryHandler.handleZyraEvent(networkRetryContext, {
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 10,
    delayMs: 100,
    errorMessage: 'fetch failed',
    recoveryKind: 'network'
}, { turnId: networkRetryTurnId })
networkRetryHandler.handleZyraEvent(networkRetryContext, {
    type: 'agent_end',
    willRetry: true
}, { turnId: networkRetryTurnId })
assert.equal(networkRetryEvents.some((event) => event.type === 'turn.completed'), false, 'a retryable agent_end keeps the canonical turn running')
networkRetryHandler.handleZyraEvent(networkRetryContext, {
    type: 'auto_retry_start',
    attempt: 10,
    maxAttempts: 10,
    delayMs: 51_200,
    errorMessage: 'fetch failed',
    recoveryKind: 'network'
}, { turnId: networkRetryTurnId })
networkRetryHandler.handleZyraEvent(networkRetryContext, {
    type: 'agent_end',
    willRetry: false
}, { turnId: networkRetryTurnId })
const exhaustedNetworkTurn = networkRetryEvents.find((event) => event.type === 'turn.completed')
assert.equal(
    exhaustedNetworkTurn?.type === 'turn.completed' ? exhaustedNetworkTurn.payload.outcome : null,
    'interrupted',
    'network retry exhaustion pauses the turn instead of reporting an application failure'
)
networkRetryHandler.handleZyraEvent(networkRetryContext, {
    type: 'auto_retry_end',
    success: false,
    attempt: 10,
    finalError: 'fetch failed'
}, { turnId: networkRetryTurnId })
const networkRetryActivities = networkRetryEvents.filter((event) => event.type === 'activity')
assert.equal(new Set(networkRetryActivities.map((event) => event.eventId)).size, networkRetryActivities.length, 'runtime events remain uniquely sequenced')
assert.equal(new Set(networkRetryActivities.map((event) => event.type === 'activity' ? event.payload.activityId : null)).size, 1, 'all retry attempts target one Desktop activity component')
assert.equal(networkRetryActivities.at(-1)?.type === 'activity' ? networkRetryActivities.at(-1)?.payload.summary : null, 'Paused · Network issue')
assert.equal(networkRetryActivities.some((event) => event.type === 'activity' && /fetch failed/i.test(event.payload.detail || '')), false)
const beforeProjectedRecoveryCount = findProjectedRecord(projectedThread.id)?.thread.activities.length || 0
for (const event of networkRetryActivities) handleAssistantRuntimeEvent(event, projectedDeps)
const projectedNetworkRecoveries = findProjectedRecord(projectedThread.id)?.thread.activities.filter((activity) => activity.kind === 'connection.recovery') || []
assert.equal(projectedNetworkRecoveries.length, 1, 'Desktop projection upserts retry progress instead of appending one row per attempt')
assert.equal(projectedNetworkRecoveries[0]?.summary, 'Paused · Network issue')
assert.equal(findProjectedRecord(projectedThread.id)?.thread.activities.length, beforeProjectedRecoveryCount + 1)
handleAssistantRuntimeEvent({
    eventId: 'network-recovery-paused-state',
    type: 'session.state.changed',
    createdAt: new Date().toISOString(),
    threadId: projectedThread.id,
    providerThreadId: projectedThread.providerThreadId || undefined,
    turnId: networkRetryTurnId,
    payload: { state: 'error', error: 'Network issue', message: 'Network issue' }
}, projectedDeps)
assert.equal(
    findProjectedRecord(projectedThread.id)?.thread.activities.length,
    beforeProjectedRecoveryCount + 1,
    'the paused connection state updates the existing recovery component without adding a generic error row'
)

const transportRecoveryIssue = getAssistantRecoveryIssue({ threadLastError: 'fetch failed' })
assert.equal(transportRecoveryIssue?.key, 'connection-lost')
assert.equal(transportRecoveryIssue?.recoverable, true)

console.log('Pi assistant lifecycle capture: ok')
