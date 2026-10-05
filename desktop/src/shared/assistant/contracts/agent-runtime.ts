import type { AssistantReasoningEffort, AssistantTurnUsage } from './runtime'

export type AgentRunStatus = 'queued' | 'starting' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'recovering'
export type AgentIsolationMode = 'shared' | 'shared-read' | 'serialized-write' | 'worktree'
export type AgentDefinitionScope = 'built-in' | 'personal' | 'project' | 'session'

export interface AgentModelRoute {
    requested: string
    selectedKey?: string
    selectedTier?: string
    fallback: boolean
    fallbackReason: string | null
    escalationReason?: string | null
    candidatesConsidered?: Array<{ selector: string; key?: string; accepted: boolean; reasons: string[]; availability?: string }>
}

export interface AgentActivityState {
    kind?: string
    summary: string
    updatedAt?: string
}

export interface AgentRunState {
    version: number
    rootSessionId: string
    agentRunId: string
    agentId: string
    definitionName: string | null
    label: string
    parentAgentRunId: string | null
    workflowRunId: string | null
    workflowPhaseId: string | null
    workflowCallId: string | null
    goal: string
    status: AgentRunStatus
    depth: number
    contextFork: boolean
    conversationKind?: 'thread' | 'subagent'
    attempt: number
    maxAttempts: number
    requestedModel: string
    selectedModel: string
    modelRoute: AgentModelRoute | null
    effort: AssistantReasoningEffort
    requestedTools: string[]
    grantedTools: string[]
    deniedTools: string[]
    deniedCapabilities: string[]
    controlLease: {
        grantId: string
        parentGrantId: string
        targetId: string
        capabilities: string[]
        expiresAt: string
        maxActions: number
        actionCount: number
        state: 'active' | 'expired' | 'revoked' | 'consumed'
    } | null
    permissionMode: string
    isolation: AgentIsolationMode
    readScope: string[]
    writeScope: string[]
    sessionFile: string | null
    providerSessionId: string | null
    activity: AgentActivityState | null
    worktree: { directory: string; branch: string | null; status?: string; retained?: boolean } | null
    usage: AssistantTurnUsage & { requests?: number; cost?: number }
    result: { text: string; warnings?: string[]; truncated?: boolean; source?: { agentRunId: string; attemptId: string; label: string }; untrusted?: boolean; transcriptRef?: Record<string, unknown> } | null
    error: { code?: string; name?: string; message: string; retryable?: boolean; details?: Record<string, unknown> } | null
    createdAt: string
    queuedAt: string
    startedAt: string | null
    completedAt: string | null
    heartbeatAt?: string | null
    elapsedMs: number
}

export interface AgentDefinitionSummary {
    name: string
    description: string
    scope: AgentDefinitionScope
    sourcePath: string
    valid: boolean
    runnable: boolean
    errors: string[]
    warnings: string[]
    model: string | null
    effort: AssistantReasoningEffort | null
    tools: string[]
    isolation: AgentIsolationMode
}

export interface AgentTranscriptPage {
    entries: Array<Record<string, unknown> & { index: number }>
    nextBefore: number | null
    totalEntries: number
    bytes: number
    truncatedEntries: number
    hydrated: number
}
