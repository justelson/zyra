import type { AssistantBackgroundProcess } from './contracts/background-process'

/** Only live worker snapshots are eligible for process controls. */
export function readAssistantBackgroundProcessList(value: unknown): AssistantBackgroundProcess[] {
    if (!Array.isArray(value)) throw new Error('The runtime did not return a process list.')
    return value.map(entry => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid runtime process snapshot.')
        const job = entry as Record<string, unknown>
        if (typeof job.jobId !== 'string' || !job.jobId.trim()
            || typeof job.command !== 'string' || typeof job.startedAt !== 'string'
            || !Number.isFinite(Date.parse(job.startedAt))
            || !['running', 'completed', 'failed', 'stopped'].includes(String(job.status))
            || typeof job.background !== 'boolean') throw new Error('Invalid runtime process snapshot.')
        return {
            jobId: job.jobId,
            toolCallId: typeof job.toolCallId === 'string' ? job.toolCallId : '',
            ownerAgentRunId: typeof job.ownerAgentRunId === 'string' ? job.ownerAgentRunId : undefined,
            command: job.command,
            status: job.status as AssistantBackgroundProcess['status'],
            background: job.background,
            startedAt: job.startedAt,
            completedAt: typeof job.completedAt === 'string' ? job.completedAt : undefined,
            exitCode: typeof job.exitCode === 'number' || job.exitCode === null ? job.exitCode : undefined,
            output: typeof job.output === 'string' ? job.output : undefined,
            errorMessage: typeof job.errorMessage === 'string' ? job.errorMessage : undefined,
            cleanupFailed: job.cleanupFailed === true
        }
    })
}
