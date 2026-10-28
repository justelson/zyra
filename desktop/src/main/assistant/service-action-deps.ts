import type {
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantDeleteMessageInput,
    AssistantDomainEvent,
    AssistantApprovalDecision,
    AssistantChatScope,
    AssistantInteractionMode,
    AssistantModelInfo,
    AssistantPlaygroundState,
    AssistantPluginSkillSource,
    AssistantPluginMcpSource,
    AssistantReasoningEffort,
    AssistantRuntimeEvent,
    AssistantRuntimeMode,
    AssistantSendPromptOptions,
    AssistantSession,
    AssistantSessionUsageTotals,
    AssistantSnapshot,
    AssistantThread,
    AssistantUserInputQuestion
} from '../../shared/assistant/contracts'
import type { PreparedAssistantPromptImage } from './prompt-images'
import type { AssistantNewChatExecutionDefaults } from './service-state'
import type { AssistantRuntimePolicy } from '../../shared/assistant/runtime-policy'

export interface AssistantRuntimeBridge {
    checkAvailability(): Promise<{ available: boolean; reason: string | null }>
    listModels(forceRefresh?: boolean): Promise<AssistantModelInfo[]>
    prepareChatRuntime?(model: string | null): Promise<void>
    connect(
        thread: AssistantThread,
        cwd: string,
        filesystemScope?: AssistantChatScope | null,
        pluginSkillSources?: AssistantPluginSkillSource[],
        pluginMcpSources?: AssistantPluginMcpSource[]
    ): Promise<void>
    hasSession(threadId: string): boolean
    ensurePromptAvailable?(threadId: string): Promise<void>
    getCanonicalChat?(threadId: string, project?: string): Promise<{ presence?: { activeTurnId: string | null } } | null>
    getSessionUsage?(threadId: string): AssistantSessionUsageTotals | null
    generateText(
        prompt: string,
        options: { cwd: string; model?: string; effort?: AssistantReasoningEffort; timeoutMs?: number }
    ): Promise<{ success: boolean; text?: string; model?: string; error?: string }>
    updateCanonicalChat(
        threadId: string,
        patch: { title?: string; expectedTitle?: string; project?: string; cwd?: string; archived?: boolean; deleted?: boolean; settled?: boolean; settlementIfAbsent?: boolean }
    ): Promise<void>
    sendPrompt(
        threadId: string,
        prompt: string,
        options?: {
            turnId?: string
            initialManualTitle?: string
            model?: string
            runtimeMode?: AssistantRuntimeMode
            interactionMode?: AssistantInteractionMode
            effort?: AssistantReasoningEffort
            serviceTier?: 'fast'
            profile?: string
            startInNewWorktree?: boolean
            images?: PreparedAssistantPromptImage[]
            reasoningSummary?: AssistantRuntimePolicy['reasoningSummary']
            contextCompactionThresholdTokens?: number
            modelCompactionOverrides?: Record<string, number>
        }
    ): Promise<{ turnId: string; providerThreadId: string | null }>
    steerPrompt?(threadId: string, prompt: string, options: { targetTurnId: string; images?: PreparedAssistantPromptImage[] }): Promise<{ turnId: string }>
    pingModel?(threadId: string, targetTurnId: string, requestId: string): Promise<void>
    cancelPendingPrompt?(threadId: string, turnId?: string): Promise<boolean>
    interruptTurn(threadId: string, turnId?: string): Promise<void>
    requestBackgroundProcessOperation?(threadId: string, action: 'list' | 'stop', payload?: { jobId?: string; all?: boolean }): Promise<import('../../shared/assistant/contracts').AssistantBackgroundProcess[]>
    rollbackThread(threadId: string, numTurns: number): Promise<void>
    respondApproval(threadId: string, requestId: string, decision: AssistantApprovalDecision): Promise<void>
    respondUserInput(
        threadId: string,
        requestId: string,
        answers: Record<string, string | string[]>,
        questions?: AssistantUserInputQuestion[],
        options?: { mode?: 'blocking' | 'async'; cancelled?: boolean }
    ): Promise<{ continuationPrompt: string | null }>
    disconnect(threadId: string, options?: { preserveThreadState?: boolean }): void
    setNavigationBackgrounded?(threadId: string, backgrounded: boolean): void
    releaseNavigationBackgroundedThread?(threadId: string): void
    dispose(): void
    on(event: 'runtime', listener: (event: AssistantRuntimeEvent) => void): this
}

export interface AssistantServiceActionDeps {
    readonly runtime: AssistantRuntimeBridge
    readonly queuedPromptDeliveries?: import('./queued-prompt-delivery').QueuedPromptDeliveryOwner
    ensureReady(): Promise<void>
    getSnapshot(): AssistantSnapshot
    hydrateSelectedSession(sessionId: string): Promise<void>
    recoverPendingUserInput?(requestId: string): Promise<void>
    getFirstUserMessageText(sessionId: string): Promise<string | null>
    getNewChatExecutionDefaults(): Promise<AssistantNewChatExecutionDefaults>
    getNewChatPreparationModel?(): Promise<string | null>
    getTitleGenerationModel(): Promise<string | null>
    getRuntimePolicy?(): Promise<AssistantRuntimePolicy>
    appendEvent(
        type: AssistantDomainEvent['type'],
        occurredAt: string,
        payload: Record<string, unknown>,
        sessionId?: string,
        threadId?: string
    ): void
    getSessionRuntimeCwd(
        session: AssistantSession,
        thread: AssistantThread
    ): string
    getSessionPluginSkillSources?(session: AssistantSession): Promise<AssistantPluginSkillSource[]>
    connectSessionRuntime?(session: AssistantSession, thread: AssistantThread): Promise<void>
    createSession(input?: AssistantCreateSessionInput): Promise<{ success: true; sessionId: string }>
    createPlaygroundLab(
        input: AssistantCreatePlaygroundLabInput
    ): Promise<{ success: true; labId: string; sessionId: string | null; playground: AssistantPlaygroundState }>
    sendPrompt(
        prompt: string,
        options?: AssistantSendPromptOptions
    ): Promise<{ success: true; sessionId: string; threadId: string; turnId?: string }>
    suppressAssistantTextForTurn(threadId: string, turnId: string): void
}

export type AssistantServicePlaygroundApprovalInput =
    | AssistantApprovePendingPlaygroundLabRequestInput
    | AssistantDeclinePendingPlaygroundLabRequestInput

export type AssistantServiceDeleteMessageInput = AssistantDeleteMessageInput
