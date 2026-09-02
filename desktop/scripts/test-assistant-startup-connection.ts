import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
    AssistantRuntimeStatus,
    AssistantSnapshot,
    AssistantThread
} from '../src/shared/assistant/contracts'
import { deriveAssistantRuntimeStatus } from '../src/renderer/src/lib/assistant/assistant-store-runtime'
import {
    isPristineAssistantThread,
    isUnstartedAssistantThread,
    shouldEagerlyConnectAssistantThread
} from '../src/renderer/src/lib/assistant/assistant-new-chat-policy'
import { shouldAutoReconnectAssistantOnStartup } from '../src/renderer/src/lib/assistant/assistant-runtime-preferences'
import { areAssistantSessionsRailSelectionsEqual } from '../src/renderer/src/lib/assistant/assistant-store-selection-helpers'
import { getAssistantThreadPhase, isAssistantSessionBackgroundActive, isAssistantThreadActivelyWorking } from '../src/renderer/src/lib/assistant/selectors'
import { toAssistantThreadShell } from '../src/main/assistant/persistence-snapshot'
import { TrailingAsyncReconciler } from '../src/main/assistant/trailing-async-reconciler'
import { shouldAutoReconnectAssistantThread } from '../src/renderer/src/pages/assistant/assistant-connection-recovery-policy'
import { AssistantConnectionRecoveryBanner } from '../src/renderer/src/pages/assistant/AssistantConnectionRecoveryBanner'
import { MAX_ASSISTANT_RECONNECT_ATTEMPTS } from '../src/renderer/src/pages/assistant/assistant-runtime-recovery'
import { getPausedAssistantRuntimeRecovery } from '../src/renderer/src/pages/assistant/useAssistantConnectionRecovery'
import { deriveAssistantComposerCapabilities } from '../src/renderer/src/pages/assistant/assistant-composer-capabilities'
import { getAssistantThreadLastMessageAt, resolveAssistantThreadStatusPill } from '../src/renderer/src/pages/assistant/assistant-sessions-rail-utils'
import { mergeCanonicalPresenceLatestTurn, mergeCanonicalPresenceObservation, resolveCanonicalPresenceAttention, resolveCanonicalPresenceThreadState } from '../src/main/assistant/service-canonical-presence'
import { resolveAssistantComposerLaunchConfiguration } from '../src/renderer/src/pages/assistant/assistant-new-chat-composer-config'
import {
    resolveAssistantComposerFallbackState,
    resolveRetainedAssistantComposerModel
} from '../src/renderer/src/pages/assistant/assistant-composer-controller-derived'

const storeSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
const composerEffectsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantComposerControllerEffects.ts', import.meta.url), 'utf8')
const composerControllerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantComposerController.ts', import.meta.url), 'utf8')
const conversationPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(storeSource, /if \(!hasKnownModels\)[\s\S]*refreshModels/, 'an empty model cache must not launch provider discovery during startup')
assert.doesNotMatch(composerEffectsSource, /didAutoRefreshModelsRef/, 'the composer refreshes models only after the user opens its model controls')
assert.match(composerEffectsSource, /areAssistantComposerConfigurationsEqual[\s\S]{0,300}writeAssistantComposerSessionState\(sessionId, currentComposerState\)/u, 'thread configuration choices persist immediately instead of being lost to the draft debounce')
assert.match(conversationPaneSource, /useSettingsDefaults=\{selectedSessionIsDraft \|\| newChatHandoffActive\}/u, 'only a New Chat inherits global composer defaults')
assert.match(composerControllerSource, /resolveRetainedAssistantComposerModel/u, 'model catalog refreshes preserve an explicit thread model')
const reconnectingMarkup = renderToStaticMarkup(createElement(AssistantConnectionRecoveryBanner, {
    issue: { key: 'connection-lost', title: 'Connection lost', brief: 'fetch failed', recoverable: true, raw: 'fetch failed' },
    reconnectPending: true,
    reconnectAttempt: 1,
    reconnectMaxAttempts: 10,
    reconnectExhausted: false,
    onReconnect: () => {}
}))
assert.equal(MAX_ASSISTANT_RECONNECT_ATTEMPTS, 10, 'Desktop uses the shared ten-attempt recovery budget')
assert.match(reconnectingMarkup, /Reconnecting 1 of 10/, 'Desktop shows the first reconnect attempt in one compact status row')
assert.doesNotMatch(reconnectingMarkup, /fetch failed/i, 'Desktop hides raw transport errors from the primary recovery UI')
const pausedMarkup = renderToStaticMarkup(createElement(AssistantConnectionRecoveryBanner, {
    issue: { key: 'connection-lost', title: 'Connection lost', brief: 'fetch failed', recoverable: true, raw: 'fetch failed' },
    reconnectPending: false,
    reconnectAttempt: 10,
    reconnectMaxAttempts: 10,
    reconnectExhausted: true,
    onReconnect: () => {}
}))
assert.match(pausedMarkup, /Paused · Network issue/)
assert.match(pausedMarkup, /Try again/)
assert.deepEqual(getPausedAssistantRuntimeRecovery([{
    id: 'paused-network-recovery',
    kind: 'connection.recovery',
    tone: 'warning',
    summary: 'Paused · Network issue',
    turnId: 'turn-network-recovery',
    createdAt: new Date().toISOString(),
    payload: { category: 'connection-recovery', status: 'paused', attempt: 10, maxAttempts: 10 }
}]), { attempt: 10, maxAttempts: 10 }, 'runtime retry exhaustion hydrates the same manual recovery banner')
assert.equal(getPausedAssistantRuntimeRecovery([{
    id: 'new-network-recovery',
    kind: 'connection.recovery',
    tone: 'warning',
    summary: 'Reconnecting 1 of 10',
    turnId: 'new-turn',
    createdAt: new Date().toISOString(),
    payload: { category: 'connection-recovery', status: 'retrying', attempt: 1, maxAttempts: 10 }
}, {
    id: 'old-paused-network-recovery',
    kind: 'connection.recovery',
    tone: 'warning',
    summary: 'Paused · Network issue',
    turnId: 'old-turn',
    createdAt: new Date(0).toISOString(),
    payload: { category: 'connection-recovery', status: 'paused', attempt: 10, maxAttempts: 10 }
}]), null, 'an old paused recovery cannot block a newer reconnect cycle')

assert.match(
    composerControllerSource,
    /draftWarmKey[\s\S]{0,500}text\.trim\(\)[\s\S]{0,350}onDraftStarted\?\.\(\)/u,
    'the first typed draft must start the selected assistant connection before Send'
)
assert.match(
    conversationPaneSource,
    /onDraftStarted=\{actions\.warmSelectedSessionConnection\}/u,
    'the composer draft warmup must reach the canonical assistant store'
)
assert.match(
    storeSource,
    /warmSelectedSessionConnection\(voicePreparation\?: AssistantConnectOptions\['voicePreparation'\]\)[\s\S]{0,500}warmSessionConnection\(selected\.id, selected\.activeThreadId, false, false, voicePreparation\)/u,
    'draft warmup must reuse the deduplicated background connection path without surfacing speculative errors'
)

const canonicalThreadFallback = resolveAssistantComposerFallbackState({
    useSettingsDefaults: false,
    settingsDefaults: {
        draft: 'new-chat template',
        model: 'openai-codex/gpt-5.6-sol',
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        effort: 'medium',
        fastModeEnabled: false
    },
    activeModel: 'openai-codex/gpt-5.6-terra',
    runtimeMode: 'full-access',
    interactionMode: 'plan',
    activeEffort: 'high',
    activeFastModeEnabled: true
})
assert.deepEqual(canonicalThreadFallback, {
    model: 'openai-codex/gpt-5.6-terra',
    runtimeMode: 'full-access',
    interactionMode: 'default',
    effort: 'high',
    fastModeEnabled: true
}, 'an established thread restores its canonical configuration without inheriting new-chat defaults')
assert.equal(
    resolveRetainedAssistantComposerModel('openai-codex/thread-model', 'openai-codex/latest-model'),
    'openai-codex/thread-model',
    'a temporary catalog miss cannot replace an explicit thread model'
)
assert.equal(
    resolveRetainedAssistantComposerModel('', 'openai-codex/latest-model'),
    'openai-codex/latest-model',
    'a genuinely empty model selection still receives an available fallback'
)

const now = '2026-07-10T08:00:00.000Z'
const sessionId = 'startup-session'
const threadId = 'startup-thread'

const thread: AssistantThread = {
    id: threadId,
    providerThreadId: 'provider-startup-thread',
    source: 'main',
    parentThreadId: null,
    providerParentThreadId: null,
    subagentDepth: null,
    agentNickname: null,
    agentRole: null,
    model: 'openai-codex/gpt-5.5',
    cwd: 'C:\\workspace',
    messageCount: 1,
    lastSeenCompletedTurnId: null,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    state: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    latestTurn: null,
    activePlan: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    pendingApprovals: [],
    pendingUserInputs: []
}

assert.deepEqual(resolveAssistantComposerLaunchConfiguration({
    useSettingsDefaults: true,
    settings: {
        assistantDefaultModel: 'openai-codex/gpt-5.6-sol',
        assistantDefaultFastMode: true,
        assistantDefaultRuntimeMode: 'full-access',
        assistantDefaultEffort: 'xhigh'
    },
    thread,
    fallbackModel: 'openai-codex/gpt-5.5'
}), {
    activeModel: 'openai-codex/gpt-5.6-sol',
    activeEffort: 'xhigh',
    activeFastModeEnabled: true,
    runtimeMode: 'full-access',
    interactionMode: 'default',
    activeProfile: 'yolo-fast'
}, 'a pristine New Chat must use Settings defaults instead of its placeholder backend thread configuration')
assert.deepEqual(resolveAssistantComposerLaunchConfiguration({
    useSettingsDefaults: false,
    settings: {
        assistantDefaultModel: 'openai-codex/gpt-5.6-sol',
        assistantDefaultFastMode: true,
        assistantDefaultRuntimeMode: 'full-access',
        assistantDefaultEffort: 'xhigh'
    },
    thread,
    fallbackModel: 'openai-codex/gpt-5.6-sol'
}), {
    activeModel: 'openai-codex/gpt-5.5',
    activeEffort: null,
    activeFastModeEnabled: false,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    activeProfile: 'safe-dev'
}, 'an established chat must continue to reflect its canonical runtime configuration')

const staleEmptyThread: AssistantThread = {
    ...thread,
    id: 'stale-empty-thread',
    providerThreadId: 'stale-provider-thread',
    cwd: 'C:\\stale',
    messageCount: 0,
    activityCount: 55,
    latestTurn: null,
    messages: [],
    state: 'ready'
}

const snapshot: AssistantSnapshot = {
    snapshotSequence: 12,
    updatedAt: now,
    selectedSessionId: sessionId,
    playground: { rootPath: null, labs: [] },
    sessions: [{
        id: sessionId,
        title: 'Restored chat',
        mode: 'work',
        projectPath: 'C:\\workspace',
        playgroundLabId: null,
        pendingLabRequest: null,
        archived: false,
        createdAt: now,
        updatedAt: now,
        activeThreadId: threadId,
        threadIds: [threadId],
        threads: [thread]
    }, {
        id: 'stale-empty-session',
        title: 'New Session',
        mode: 'work',
        projectPath: 'C:\\stale',
        playgroundLabId: null,
        pendingLabRequest: null,
        archived: false,
        createdAt: now,
        updatedAt: now,
        activeThreadId: staleEmptyThread.id,
        threadIds: [staleEmptyThread.id],
        threads: [staleEmptyThread]
    }],
    knownModels: [{ id: 'openai-codex/gpt-5.5', label: 'gpt-5.5' }]
}

const disconnectedStatus: AssistantRuntimeStatus = {
    available: true,
    connected: false,
    selectedSessionId: sessionId,
    activeThreadId: threadId,
    state: 'disconnected',
    reason: null
}

const connectedStatus: AssistantRuntimeStatus = {
    ...disconnectedStatus,
    connected: true,
    state: 'ready'
}

const connectCalls: Array<{ sessionId?: string } | undefined> = []
const selectThreadCalls: Array<{ sessionId: string; threadId: string }> = []
const disconnectCalls: Array<string | undefined> = []
const createSessionCalls: Array<{ projectPath?: string; mode?: string } | undefined> = []
let releaseStartupConnect!: () => void
const startupConnectGate = new Promise<void>((resolve) => { releaseStartupConnect = resolve })

;(globalThis as typeof globalThis & { window: unknown }).window = {
    devscope: {
        assistant: {
            bootstrap: async () => ({ snapshot, status: disconnectedStatus }),
            selectThread: async (input: { sessionId: string; threadId: string }) => {
                selectThreadCalls.push(input)
                return { success: true as const, ...input }
            },
            connect: async (options?: { sessionId?: string }) => {
                connectCalls.push(options)
                if (connectCalls.length === 1) await startupConnectGate
                return { success: true as const, threadId }
            },
            selectSession: async (targetSessionId: string) => ({
                success: true as const,
                sessionId: targetSessionId,
                snapshot: { ...snapshot, selectedSessionId: targetSessionId }
            }),
            createSession: async (input?: { projectPath?: string; mode?: string }) => {
                createSessionCalls.push(input)
                return { success: false as const, error: 'Intentional new-chat regression sentinel.' }
            },
            disconnect: async (targetSessionId?: string) => {
                disconnectCalls.push(targetSessionId)
                return { success: true as const }
            },
            getStatus: async () => connectedStatus,
            listModels: async () => ({ success: true as const, models: snapshot.knownModels }),
            onEvent: () => () => undefined
        }
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    setTimeout,
    clearTimeout
}

const { assistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')

assistantStore.retain()

const deadline = Date.now() + 2_000
while (!assistantStore.getState().hydrated && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
}

assert.equal(assistantStore.getState().hydrated, true, 'assistant store should paint before runtime reconnection finishes')
while (connectCalls.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
}
assert.equal(assistantStore.getState().status.connected, false, 'background warmup must not masquerade as a live connection')
releaseStartupConnect()
while (!assistantStore.getState().status.connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
}
const state = assistantStore.getState()
assistantStore.release()

assert.deepEqual(
    selectThreadCalls,
    [{ sessionId, threadId }],
    'cold bootstrap should restore the routed thread before reconnecting'
)
assert.deepEqual(
    connectCalls,
    [{ sessionId }],
    'cold bootstrap should warm the restored selected session exactly once'
)
assert.deepEqual(disconnectCalls, [], 'cold bootstrap should not disconnect before its first connection attempt')
assert.equal(state.status.connected, true, 'store status should become connected after background warmup')
assert.equal(state.status.activeThreadId, threadId)
const createResult = await assistantStore.createSession({ mode: 'work', projectPath: 'C:\\stale' })
assert.equal(createResult.success, false, 'the regression sentinel should stop after proving a fresh session was requested')
assert.equal(
    createSessionCalls.length,
    1,
    'New chat must create a fresh session instead of reviving an old provider-bound empty session'
)
assert.equal(isUnstartedAssistantThread(staleEmptyThread), true, 'an empty old thread can still be composed into lazily')
assert.equal(isPristineAssistantThread(staleEmptyThread), false, 'provider binding and prior activity make an old empty thread unsafe to reuse')
assert.equal(shouldEagerlyConnectAssistantThread(staleEmptyThread), false, 'an untouched chat should not block its empty composer on runtime startup')
assert.equal(
    deriveAssistantRuntimeStatus(snapshot, disconnectedStatus).connected,
    false,
    'persisted ready state must not masquerade as a live runtime connection'
)
assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'ready', hasRecoverableIssue: false }),
    false,
    'the recovery hook must not race the explicit background warmup when a thread becomes ready'
)
assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'ready', hasRecoverableIssue: true }),
    false,
    'historical error activity must not tear down a runtime that just became ready'
)
assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'starting', hasRecoverableIssue: false }),
    false,
    'connection recovery must not disconnect a background warmup that is already in progress'
)
assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'starting', hasRecoverableIssue: true }),
    false,
    'an older recoverable activity must not cancel the current background warmup'
)
const warmingComposer = deriveAssistantComposerCapabilities({
    mode: 'standard',
    disabled: false,
    isConnected: false,
    isConnecting: true,
    isSending: false,
    isThinking: false,
    allowEmptySubmit: false,
    hasContent: true
})
assert.equal(warmingComposer.sendDisabled, false, 'the composer must remain sendable while its runtime warms in the background')
assert.equal(warmingComposer.voiceDisabled, false, 'Voice must remain available while the strong runtime warms in the background')
assert.equal(shouldAutoReconnectAssistantOnStartup(), true, 'startup reconnect should remain enabled by default')
;(globalThis as any).window.localStorage = {
    getItem: () => JSON.stringify({ assistantAutoReconnect: false })
}
assert.equal(shouldAutoReconnectAssistantOnStartup(), false, 'the persisted connection setting should disable startup reconnect')

assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'idle', hasRecoverableIssue: false }),
    false,
    'opening an idle historical chat must not start a second eager reconnect path'
)
assert.equal(
    shouldAutoReconnectAssistantThread({ threadState: 'stopped', hasRecoverableIssue: false }),
    false,
    'an intentional in-session disconnect should remain stopped'
)

const readyPresence = {
    state: 'ready' as const,
    activeTurnId: null,
    clients: [{ clientId: 'desktop:test', surface: 'desktop' }],
    backgroundWorkActive: false
}
const observedPresence = mergeCanonicalPresenceObservation(
    { ...readyPresence, latestSequence: 2, observedSequence: 2 },
    { ...readyPresence, latestSequence: 113 }
)
assert.equal(observedPresence.latestSequence, 2, 'catalog presence cannot acknowledge canonical events Desktop has not projected')
assert.equal(observedPresence.observedSequence, 113, 'Thread Details can retain the server high-water mark without using it as a replay cursor')
assert.equal(
    resolveCanonicalPresenceThreadState({ currentState: 'starting', presence: readyPresence }),
    'ready',
    'canonical ready presence should clear a stale Desktop starting state even when the runtime object still exists'
)
assert.equal(
    getAssistantThreadPhase({ ...thread, state: 'starting', canonicalPresence: readyPresence }).key,
    'ready',
    'the renderer should trust canonical ready presence instead of showing Connecting forever'
)
assert.equal(
    isAssistantThreadActivelyWorking({ ...thread, state: 'starting', canonicalPresence: undefined }),
    false,
    'runtime attachment is connection progress, not an active assistant turn'
)
assert.equal(
    getAssistantThreadPhase({
        ...thread,
        state: 'running',
        latestTurn: {
            id: 'settled-turn',
            state: 'completed',
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            assistantMessageId: 'assistant-final'
        },
        canonicalPresence: readyPresence
    }).key,
    'ready',
    'canonical ready presence must clear a stale running shell after the final response'
)
assert.equal(
    isAssistantThreadActivelyWorking({
        ...thread,
        state: 'running',
        latestTurn: {
            id: 'settled-turn',
            state: 'completed',
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            assistantMessageId: 'assistant-final'
        },
        canonicalPresence: readyPresence
    }),
    false,
    'a completed response with canonical ready presence cannot remain Working'
)
const detachedRunningThread: AssistantThread = {
    ...thread,
    state: 'running',
    latestTurn: {
        id: 'stale-turn',
        state: 'running',
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        assistantMessageId: null,
        usage: null
    },
    canonicalPresence: { ...readyPresence, state: 'detached', clients: [] }
}
assert.equal(
    getAssistantThreadPhase(detachedRunningThread).key,
    'stale',
    'a detached canonical worker must remain visibly stale while Desktop reconnects'
)
assert.equal(
    isAssistantThreadActivelyWorking(detachedRunningThread),
    true,
    'a transport detachment cannot finish an explicitly running turn'
)
assert.equal(
    isAssistantThreadActivelyWorking({ ...detachedRunningThread, state: 'error', canonicalPresence: undefined }),
    true,
    'a recoverable thread error cannot override the running turn ledger'
)
assert.equal(
    resolveAssistantThreadStatusPill(detachedRunningThread, true)?.label,
    'Working',
    'the chat rail cannot label an explicitly running turn stale or failed'
)
assert.equal(
    isAssistantSessionBackgroundActive({ ...snapshot.sessions[0]!, threads: [detachedRunningThread] }, null),
    true,
    'an explicitly running turn remains background-active while Desktop reconnects'
)
const explicitlyFailedThread: AssistantThread = {
    ...detachedRunningThread,
    state: 'ready',
    canonicalPresence: readyPresence,
    latestTurn: {
        ...detachedRunningThread.latestTurn!,
        state: 'error',
        completedAt: now
    }
}
assert.equal(
    resolveAssistantThreadStatusPill(explicitlyFailedThread, true)?.label,
    'Failed',
    'an explicit failed turn remains failed even after the connection returns to ready'
)
assert.equal(
    resolveAssistantThreadStatusPill({
        ...explicitlyFailedThread,
        state: 'error',
        canonicalPresence: undefined,
        latestTurn: { ...explicitlyFailedThread.latestTurn!, state: 'completed' }
    }, true)?.label,
    'Connection issue',
    'a connection error after explicit turn completion cannot relabel that turn failed'
)

const pendingApprovalThread: AssistantThread = {
    ...thread,
    hasPendingApprovals: true,
    hasPendingUserInputs: false
}
assert.equal(
    getAssistantThreadPhase(pendingApprovalThread).key,
    'waiting-approval',
    'sidebar phase must trust shell-level pending approval state before a thread is opened'
)
assert.equal(
    resolveAssistantThreadStatusPill(pendingApprovalThread, false)?.label,
    'Pending',
    'both sidebar renderers must show unopened approval state immediately'
)

const runningPresence = { ...readyPresence, state: 'running' as const, activeTurnId: 'turn:sidebar-sync' }
assert.deepEqual(
    toAssistantThreadShell({ ...thread, canonicalPresence: runningPresence }).canonicalPresence,
    runningPresence,
    'shell snapshots must retain canonical presence for unopened sidebar threads'
)

const completedAt = '2026-07-10T08:05:00.000Z'
const completedLatestTurn = mergeCanonicalPresenceLatestTurn(null, {
    ...readyPresence,
    attention: null,
    latestTurn: {
        id: 'turn:sidebar-complete',
        state: 'completed',
        requestedAt: now,
        startedAt: now,
        completedAt,
        assistantMessageId: null
    }
})
assert.equal(completedLatestTurn?.state, 'completed', 'canonical completion must reach unopened thread shells')
const completedLatestTurnWithProviderMessage = mergeCanonicalPresenceLatestTurn(null, {
    ...readyPresence,
    attention: null,
    latestTurn: {
        id: 'turn:sidebar-complete-with-message',
        state: 'completed',
        requestedAt: now,
        startedAt: now,
        completedAt,
        assistantMessageId: 'pi-message:assistant:canonical-final'
    }
})
assert.equal(
    completedLatestTurnWithProviderMessage?.assistantMessageId,
    'assistant-message-pi-message:assistant:canonical-final',
    'canonical provider references enter persistence in the Desktop message-id namespace'
)
assert.equal(
    resolveAssistantThreadStatusPill({ ...thread, latestTurn: completedLatestTurn }, false)?.label,
    'Done',
    'both sidebar renderers must show canonical completion before the thread is opened'
)
assert.equal(
    getAssistantThreadLastMessageAt({ ...thread, latestTurn: completedLatestTurn }),
    completedAt,
    'sidebar recency must use canonical turn completion when history is not hydrated'
)
assert.equal(
    getAssistantThreadLastMessageAt({ ...thread, updatedAt: '2026-07-11T08:00:00.000Z' }),
    thread.createdAt,
    'runtime attachment timestamps must not make an old chat look newly active'
)
assert.deepEqual(
    resolveCanonicalPresenceAttention({
        currentHasPendingApprovals: false,
        currentHasPendingUserInputs: false,
        hasLocalPendingApproval: false,
        hasLocalPendingInput: false,
        presence: { ...readyPresence, attention: 'approval' }
    }),
    { hasPendingApprovals: true, hasPendingUserInputs: false },
    'canonical approval attention must update unopened thread shells'
)

const pendingSnapshot: AssistantSnapshot = {
    ...snapshot,
    sessions: snapshot.sessions.map((session) => ({
        ...session,
        threads: session.threads.map((candidate) => candidate.id === threadId ? pendingApprovalThread : candidate)
    }))
}
const baseRailSelection = {
    snapshot,
    sessions: snapshot.sessions,
    playground: snapshot.playground,
    activeSessionId: snapshot.selectedSessionId,
    activeThreadId: threadId,
    connected: true,
    commandPending: false
}
const pendingRailSelection = {
    ...baseRailSelection,
    snapshot: pendingSnapshot,
    sessions: pendingSnapshot.sessions
}
assert.equal(
    areAssistantSessionsRailSelectionsEqual(baseRailSelection, pendingRailSelection),
    false,
    'both sidebar variants must rerender when unopened thread attention state changes'
)

let reconciliationRuns = 0
let releaseFirstReconciliation!: () => void
let markFirstReconciliationStarted!: () => void
const firstReconciliationStarted = new Promise<void>((resolve) => { markFirstReconciliationStarted = resolve })
const reconciler = new TrailingAsyncReconciler(async () => {
    reconciliationRuns += 1
    if (reconciliationRuns !== 1) return
    markFirstReconciliationStarted()
    await new Promise<void>((resolve) => { releaseFirstReconciliation = resolve })
})
const firstReconciliation = reconciler.request()
await firstReconciliationStarted
const trailingReconciliation = reconciler.request()
releaseFirstReconciliation()
await Promise.all([firstReconciliation, trailingReconciliation])
assert.equal(
    reconciliationRuns,
    2,
    'a canonical presence change received during reconciliation must trigger one trailing refresh'
)

console.log('Assistant startup connection: ok')
