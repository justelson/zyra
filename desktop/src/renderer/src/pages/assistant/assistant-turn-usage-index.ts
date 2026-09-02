import type { AssistantLatestTurn, AssistantMessage, AssistantSessionTurnUsageEntry } from '@shared/assistant/contracts'
import { reconcileAssistantUserTurnIds } from '@shared/assistant/turn-reconciliation'

type AssistantLiveTurnIndexInput = {
    sessionId: string
    threadId: string
    model: string
    latestTurn: AssistantLatestTurn
}

export function buildAssistantTurnUsageIndex(
    messages: readonly AssistantMessage[],
    turns: readonly AssistantSessionTurnUsageEntry[],
    live: AssistantLiveTurnIndexInput | null = null
): Map<string, AssistantSessionTurnUsageEntry> {
    const usageById = new Map(turns.map((turn) => [turn.id, turn]))
    if (live) {
        const persisted = usageById.get(live.latestTurn.id)
        usageById.set(live.latestTurn.id, {
            id: live.latestTurn.id,
            sessionId: live.sessionId,
            threadId: live.threadId,
            model: live.model,
            state: live.latestTurn.state,
            requestedAt: live.latestTurn.requestedAt,
            startedAt: live.latestTurn.startedAt,
            completedAt: live.latestTurn.completedAt,
            assistantMessageId: live.latestTurn.assistantMessageId || persisted?.assistantMessageId || null,
            effort: live.latestTurn.effort ?? persisted?.effort,
            serviceTier: live.latestTurn.serviceTier ?? persisted?.serviceTier,
            usage: live.latestTurn.usage || persisted?.usage || null,
            updatedAt: live.latestTurn.completedAt || live.latestTurn.startedAt || live.latestTurn.requestedAt
        })
    }
    if (messages.length === 0 || usageById.size === 0) return usageById

    const users = messages.filter((message) => message.role === 'user')
    const reconciliation = reconcileAssistantUserTurnIds(users, [...usageById.values()])
    for (const user of users) {
        const resolvedTurnId = reconciliation.resolvedTurnIdByMessageId.get(user.id)
        const usage = resolvedTurnId ? usageById.get(resolvedTurnId) : null
        if (!usage) continue
        if (user.turnId) usageById.set(user.turnId, usage)
    }
    for (const [alias, resolvedTurnId] of reconciliation.turnIdAliases) {
        const usage = usageById.get(resolvedTurnId)
        if (usage) usageById.set(alias, usage)
    }
    return usageById
}
