import type { AssistantSnapshot } from '@shared/assistant/contracts'
import {
    hasRenderableAssistantRetainedHistory,
    isAssistantRetainedHistoryFresh,
    replaceAssistantVisibleHistory
} from './assistant-history-state'
import type { AssistantStoreState } from './assistant-store-runtime'
import {
    applyCachedSessionSelection,
    hasCachedSessionSelection,
    type CachedHydratedThreadState
} from './session-hydration-cache'

type AssistantWarmSelectionInput = {
    snapshot: AssistantSnapshot
    sessionId: string
    threadId: string | null
    hydratedThreadCache: Map<string, CachedHydratedThreadState>
    historyByThreadId: AssistantStoreState['historyByThreadId']
}

export function hasAssistantWarmSelection(input: AssistantWarmSelectionInput): boolean {
    const session = input.snapshot.sessions.find((entry) => entry.id === input.sessionId) || null
    const threadId = input.threadId || session?.activeThreadId || null
    const thread = threadId
        ? session?.threads.find((entry) => entry.id === threadId) || null
        : null
    const retainedHistory = threadId ? input.historyByThreadId[threadId] : undefined
    // Revision freshness says the data is valid, not that this page reaches the
    // latest turn. Reopening a chat always asks for its newest page.
    if (retainedHistory?.pageInfo.hasNewer) return false
    return (isAssistantRetainedHistoryFresh(retainedHistory, thread) && hasRenderableAssistantRetainedHistory(retainedHistory, thread))
        || hasCachedSessionSelection(
            input.snapshot,
            input.sessionId,
            threadId,
            input.hydratedThreadCache
        )
}

export function prepareAssistantWarmSelection(input: AssistantWarmSelectionInput): {
    snapshot: AssistantSnapshot
    historyByThreadId: AssistantStoreState['historyByThreadId']
} {
    const targetSession = input.snapshot.sessions.find(entry => entry.id === input.sessionId)
    const targetThreadId = input.threadId || targetSession?.activeThreadId || null
    if (targetThreadId && input.historyByThreadId[targetThreadId]?.pageInfo.hasNewer) {
        return {
            snapshot: {
                ...input.snapshot,
                selectedSessionId: input.sessionId,
                sessions: input.snapshot.sessions.map(session => session.id !== input.sessionId ? session : {
                    ...session,
                    threads: session.threads.map(thread => thread.id !== targetThreadId ? thread : {
                        ...thread, messages: [], activities: [], proposedPlans: []
                    })
                })
            },
            historyByThreadId: input.historyByThreadId
        }
    }
    let snapshot = applyCachedSessionSelection(
        input.snapshot,
        input.sessionId,
        input.threadId,
        input.hydratedThreadCache
    )
    const session = snapshot.sessions.find((entry) => entry.id === input.sessionId) || null
    const threadId = input.threadId || session?.activeThreadId || null
    const thread = threadId
        ? session?.threads.find((entry) => entry.id === threadId) || null
        : null
    const retainedHistory = threadId ? input.historyByThreadId[threadId] : undefined
    if (
        !threadId
        || !isAssistantRetainedHistoryFresh(retainedHistory)
        || ((thread?.messageCount || 0) === 0 && (thread?.activityCount || 0) === 0 && !thread?.latestTurn)
        || !hasRenderableAssistantRetainedHistory(retainedHistory)
    ) return { snapshot, historyByThreadId: input.historyByThreadId }

    const warmHistory = { ...retainedHistory!, lastUsedAt: Date.now() }
    snapshot = replaceAssistantVisibleHistory(snapshot, threadId, warmHistory)
    return {
        snapshot,
        historyByThreadId: { ...input.historyByThreadId, [threadId]: warmHistory }
    }
}

export function applyAssistantWarmSelection(input: AssistantWarmSelectionInput): AssistantSnapshot {
    return prepareAssistantWarmSelection(input).snapshot
}
