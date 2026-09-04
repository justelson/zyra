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
    connect(thread: AssistantThread, cwd: string, filesystemScope?: AssistantChatScope | null): Promise<void>
    hasSession(threadId: string): boolean
    getSessionUsage?(threadId: string): AssistantSessionUsageTotals | null
    generateText(
        prompt: string,
        options: { cwd: string; model?: string; effort?: AssistantReasoningEffort; timeoutMs?: number }
    ): Promise<{ success: boolean; text?: string; model?: string; error?: string }>
    updateCanonicalChat(
        threadId: string,
        patch: { title?: string; project?: string; cwd?: string; archived?: boolean; deleted?: boolean }
    ): Promise<void>
    sendPrompt(
        threadId: string,
        prompt: string,
        options?: {
            model?: string
            runtimeMode?: AssistantRuntimeMode
            interactionMode?: AssistantInteractionMode
            effort?: AssistantReasoningEffort
            serviceTier?: 'fast'
            profile?: string
            images?: PreparedAssistantPromptImage[]
            reasoningSummary?: AssistantRuntimePolicy['reasoningSummary']
            contextCompactionThresholdTokens?: number
        }
    ): Promise<{ turnId: string; providerThreadId: string | null }>
    interruptTurn(threadId: string, turnId?: string): Promise<void>
    rollbackThread(threadId: string, numTurns: number): Promise<void>
    respondApproval(threadId: string, requestId: string, decision: AssistantApprovalDecision): Promise<void>
    respondUserInput(
        threadId: string,
        requestId: string,
        answers: Record<string, string | string[]>,
        questions?: AssistantUserInputQuestion[]
    ): Promise<{ continuationPrompt: string | null }>
    disconnect(threadId: string): void
    dispose(): void
    on(event: 'runtime', listener: (event: AssistantRuntimeEvent) => void): this
}

export interface AssistantServiceActionDeps {
    readonly runtime: AssistantRuntimeBridge
    ensureReady(): Promise<void>
    getSnapshot(): AssistantSnapshot
    hydrateSelectedSession(sessionId: string): Promise<void>
    getFirstUserMessageText(sessionId: string): Promise<string | null>
    getNewChatExecutionDefaults(): Promise<AssistantNewChatExecutionDefaults>
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
