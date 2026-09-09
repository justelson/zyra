export function shouldAutoReconnectAssistantThread(input: {
    threadState?: string | null
    hasRecoverableIssue: boolean
}): boolean {
    const { threadState, hasRecoverableIssue } = input
    if (threadState === 'stopped' || threadState === 'idle' || threadState === 'starting' || threadState === 'ready' || threadState === 'running' || threadState === 'waiting') return false
    if (hasRecoverableIssue || !threadState) return true

    return threadState === 'disconnected'
}
