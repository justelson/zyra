export type AssistantRuntimeMode = 'approval-required' | 'auto-review' | 'edits-only' | 'full-access'

export function isAssistantRuntimeMode(value: unknown): value is AssistantRuntimeMode {
    return value === 'approval-required'
        || value === 'auto-review'
        || value === 'edits-only'
        || value === 'full-access'
}
export type AssistantInteractionMode = 'default' | 'plan'
export type AssistantReasoningEffort = 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AssistantThreadState =
    | 'idle'
    | 'starting'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'interrupted'
    | 'stopped'
    | 'error'

export type AssistantTurnOutcome = 'completed' | 'failed' | 'interrupted' | 'cancelled'
export type AssistantContentStreamKind =
    | 'assistant_text'
    | 'reasoning_text'
    | 'reasoning_summary_text'
    | 'plan_text'
    | 'command_output'
    | 'file_change_output'

export interface AssistantTurnUsage {
    inputTokens?: number | null
    outputTokens?: number | null
    reasoningOutputTokens?: number | null
    cachedInputTokens?: number | null
    cacheWriteTokens?: number | null
    totalTokens?: number | null
    modelContextWindow?: number | null
    /** Cost attributed to this Desktop turn. */
    costUsd?: number | null
    /** Cumulative model cost recorded for the canonical thread at turn completion. */
    sessionCostUsd?: number | null
    /** True only when every metered provider response was represented in sessionCostUsd. */
    sessionCostComplete?: boolean | null
}

export type AssistantApprovalRequestType = 'command' | 'file-read' | 'file-change'
export type AssistantApprovalDecision = 'acceptOnce' | 'acceptForSession' | 'decline'

export type AssistantPlanStepStatus = 'pending' | 'inProgress' | 'completed'

export interface AssistantPlanStep {
    step: string
    description?: string
    status: AssistantPlanStepStatus
}

export type AssistantUserInputQuestionType =
    | 'text'
    | 'single_select'
    | 'multi_select'
    | 'confirm'
    | 'file_select'
    | 'number'
    | 'date'
    | 'ranking'

export type AssistantUserInputAnswer = string | string[]

export interface AssistantUserInputQuestionOption {
    label: string
    description: string
    recommended?: boolean
}

export interface AssistantUserInputQuestion {
    id: string
    header: string
    question: string
    type: AssistantUserInputQuestionType
    options: AssistantUserInputQuestionOption[]
    required: boolean
    allowOther: boolean
    placeholder?: string
    multiple?: boolean
    min?: number
    max?: number
    step?: number
    minSelections?: number
    maxSelections?: number
}

export interface AssistantRuntimeEventBase {
    eventId: string
    createdAt: string
    threadId: string
    turnId?: string
    itemId?: string
    requestId?: string
    providerThreadId?: string
    rawMethod?: string
    rawPayload?: Record<string, unknown>
    sourceSequence?: number
}

export type AssistantRuntimeEvent =
    | (AssistantRuntimeEventBase & {
        type: 'fleet.snapshot.updated'
        payload: import('./fleet').FleetSnapshotEventPayload
    })
    | (AssistantRuntimeEventBase & {
        type: 'session.started'
        payload: {
            cwd: string
            model: string
            runtimeMode: AssistantRuntimeMode
            interactionMode: AssistantInteractionMode
            profile?: string
            webSearch?: boolean
            webFetch?: boolean
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'session.config.updated'
        payload: {
            model: string
            thinking: AssistantReasoningEffort
            profile: string
            runtimeMode: AssistantRuntimeMode
            webSearch?: boolean
            webFetch?: boolean
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'session.state.changed'
        payload: {
            state: AssistantThreadState
            message?: string
            error?: string
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'thread.started'
        payload: {
            providerThreadId: string
            source?: 'root' | 'subagent' | 'other'
            parentProviderThreadId?: string
            agentNickname?: string
            agentRole?: string
            subagentDepth?: number
            threadName?: string
            cwd?: string
            state?: AssistantThreadState
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'turn.started'
        payload: {
            model?: string
            interactionMode: AssistantInteractionMode
            profile?: string
            effort?: AssistantReasoningEffort
            serviceTier?: 'fast' | 'flex'
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'turn.completed'
        payload: {
            outcome: AssistantTurnOutcome
            errorMessage?: string
            effort?: AssistantReasoningEffort
            serviceTier?: 'fast' | 'flex'
            usage?: AssistantTurnUsage | null
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'user.message.received'
        payload: {
            messageId: string
            text: string
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'thread.token-usage.updated'
        payload: {
            usage: AssistantTurnUsage
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'content.delta'
        payload: {
            streamKind: AssistantContentStreamKind
            delta: string
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'content.completed'
        payload: {
            streamKind: AssistantContentStreamKind
            text?: string
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'plan.updated'
        payload: {
            explanation?: string
            plan: AssistantPlanStep[]
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'approval.requested'
        payload: {
            requestType: AssistantApprovalRequestType
            title?: string
            detail?: string
            command?: string
            paths?: string[]
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'approval.resolved'
        payload: {
            decision: AssistantApprovalDecision
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'user-input.requested'
        payload: {
            questions: AssistantUserInputQuestion[]
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'user-input.resolved'
        payload: {
            answers: Record<string, AssistantUserInputAnswer>
        }
    })
    | (AssistantRuntimeEventBase & {
        type: 'activity'
        payload: {
            activityId?: string
            kind: string
            summary: string
            detail?: string
            tone: 'info' | 'tool' | 'warning' | 'error'
            data?: Record<string, unknown>
        }
    })
