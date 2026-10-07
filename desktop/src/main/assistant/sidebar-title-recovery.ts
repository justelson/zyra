import type { AssistantSession } from '../../shared/assistant/contracts'

/** Bound startup repairs and serialize utility work away from the foreground. */
export async function recoverAssistantSidebarTitles(input: {
    sessions: AssistantSession[]
    selectedSessionId: string | null
    recover: (sessionId: string) => Promise<void>
    onError: (error: unknown) => void
}): Promise<void> {
    const candidates = input.sessions.filter(session => !session.archived && session.threads.length > 0)
        .sort((left, right) => Number(right.id === input.selectedSessionId) - Number(left.id === input.selectedSessionId)
            || right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12)
    for (const session of candidates) {
        try { await input.recover(session.id) } catch (error) { input.onError(error) }
    }
}
