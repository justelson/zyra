export interface AssistantBackgroundProcess {
    jobId: string
    toolCallId: string
    ownerAgentRunId?: string
    command: string
    status: 'running' | 'completed' | 'failed' | 'stopped'
    background: boolean
    startedAt: string
    completedAt?: string
    exitCode?: number | null
    output?: string
    errorMessage?: string
    /** The process tree has not been confirmed dead. */
    cleanupFailed?: boolean
}

/** Bind process controls to the displayed thread, never the current selection at dispatch. */
export interface AssistantBackgroundProcessesInput {
    sessionId: string
    threadId: string
}

export interface AssistantStopBackgroundProcessesInput extends AssistantBackgroundProcessesInput {
    jobId?: string
    all?: boolean
}

export interface AssistantBackgroundProcessesPayload {
    jobs: AssistantBackgroundProcess[]
    runtimeAvailable: boolean
}
