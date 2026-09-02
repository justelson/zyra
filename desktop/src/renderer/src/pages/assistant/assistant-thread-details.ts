import type {
    AssistantModelInfo,
    AssistantSessionTurnUsageEntry,
    AssistantSessionUsageTotals,
    AssistantTurnUsage
} from '@shared/assistant/contracts'
import { resolveAssistantContextCompactionLimitTokens } from '@shared/assistant/runtime-policy'
import type {
    ControlAuditEvent,
    ControlGrant,
    ControlPendingActionApproval,
    ControlPendingGrant,
    ControlPrincipal,
    ControlStateSnapshot,
    ControlTarget
} from '@shared/agent-control/contracts'

export type AssistantThreadUsageSummary = {
    turnCount: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cacheHitPercent: number | null
    contextTokens: number | null
    contextWindow: number | null
    contextLimit: number | null
    contextPercent: number | null
    costUsd: number | null
    costSource: 'recorded' | 'estimated' | 'unavailable'
    autoCompactionEnabled: boolean | null
}

export type AssistantThreadDetailsNowState = {
    label: string
    detail: string
    tone: 'muted' | 'warning' | 'active' | 'error' | 'ready'
}

function formatThreadDetailsLastCompleted(value: string | null): string {
    if (!value) return 'No work is running in this thread.'
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return 'No work is running in this thread.'
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
    return `Last turn finished at ${time}.`
}

export function resolveAssistantThreadDetailsNowState(input: {
    threadState: string
    latestTurnState: string | null
    latestTurnCompletedAt: string | null
    latestActivitySummary: string | null
    lastError: string | null
    pendingApprovals: number
    pendingInputs: number
    activeAgents: number
}): AssistantThreadDetailsNowState {
    if (input.pendingInputs > 0) {
        return { label: 'Waiting for you', detail: 'A response is needed before work can continue.', tone: 'warning' }
    }
    if (input.pendingApprovals > 0) {
        return { label: 'Approval needed', detail: input.latestActivitySummary || 'Review the pending request to continue.', tone: 'warning' }
    }
    if (input.latestTurnState === 'running' || input.threadState === 'running') {
        return {
            label: 'Working now',
            detail: input.latestActivitySummary || (input.activeAgents > 0
                ? `${input.activeAgents} child agent${input.activeAgents === 1 ? '' : 's'} working`
                : 'Working on the current request'),
            tone: 'active'
        }
    }
    if (input.threadState === 'waiting' || input.threadState === 'background') {
        return {
            label: 'Background work',
            detail: input.latestActivitySummary || (input.activeAgents > 0
                ? `${input.activeAgents} child agent${input.activeAgents === 1 ? '' : 's'} still working`
                : 'Delegated work is still active for this thread.'),
            tone: 'active'
        }
    }
    if (input.threadState === 'starting') {
        return { label: 'Connecting', detail: 'Restoring this thread’s local connection.', tone: 'active' }
    }
    if (input.lastError) return { label: 'Needs attention', detail: input.lastError, tone: 'error' }
    return { label: 'Ready', detail: formatThreadDetailsLastCompleted(input.latestTurnCompletedAt), tone: 'ready' }
}

export type AssistantThreadControlSummary = {
    targets: ControlTarget[]
    grants: ControlGrant[]
    activeGrants: ControlGrant[]
    pendingGrants: ControlPendingGrant[]
    pendingActionApprovals: ControlPendingActionApproval[]
    latestEvent: ControlAuditEvent | null
}

function usageNumber(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeModelId(value: string): string {
    return String(value || '').trim().toLowerCase().split('/').at(-1)?.split(/[:@]/)[0] || ''
}

function resolveContextWindow(
    latestUsage: AssistantTurnUsage | null,
    latestModel: string,
    knownModels: readonly AssistantModelInfo[]
): number | null {
    const reported = usageNumber(latestUsage?.modelContextWindow)
    if (reported > 0) return reported
    const model = knownModels.find((entry) => entry.id === latestModel)
        || knownModels.find((entry) => normalizeModelId(entry.id) === normalizeModelId(latestModel))
    const catalogWindow = usageNumber(model?.contextWindow)
    if (catalogWindow > 0) return catalogWindow
    const normalizedSelector = latestModel.trim().toLowerCase()
    if (normalizeModelId(normalizedSelector).startsWith('gpt-5.6-')) {
        return normalizedSelector.startsWith('openai-codex/') ? 372_000 : 272_000
    }
    return null
}

export function summarizeAssistantThreadUsage(
    turns: readonly AssistantSessionTurnUsageEntry[],
    threadId: string | null,
    knownModels: readonly AssistantModelInfo[] = [],
    reportedTotals: AssistantSessionUsageTotals | null = null,
    configuredContextLimitTokens?: number | null
): AssistantThreadUsageSummary {
    const threadTurns = turns.filter((turn) => !threadId || turn.threadId === threadId)
    const turnsWithUsage = threadTurns.filter((turn) => Boolean(turn.usage))
    const latest = turnsWithUsage.at(-1) || threadTurns.at(-1) || null
    const latestUsage = latest?.usage || null
    const exactTotals = reportedTotals?.threadId === threadId ? reportedTotals : null
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0

    for (const turn of turnsWithUsage) {
        const usage = turn.usage!
        inputTokens += usageNumber(usage.inputTokens)
        outputTokens += usageNumber(usage.outputTokens)
        reasoningTokens += usageNumber(usage.reasoningOutputTokens)
        cacheReadTokens += usageNumber(usage.cachedInputTokens)
        cacheWriteTokens += usageNumber(usage.cacheWriteTokens)
    }

    if (exactTotals) {
        const reportedInputTokens = usageNumber(exactTotals.inputTokens)
        const reportedOutputTokens = usageNumber(exactTotals.outputTokens)
        const reportedReasoningTokens = usageNumber(exactTotals.reasoningOutputTokens)
        const reportedCacheReadTokens = usageNumber(exactTotals.cachedInputTokens)
        const reportedCacheWriteTokens = usageNumber(exactTotals.cacheWriteTokens)
        if (reportedInputTokens > 0 || inputTokens === 0) inputTokens = reportedInputTokens
        if (reportedOutputTokens > 0 || outputTokens === 0) outputTokens = reportedOutputTokens
        if (reportedReasoningTokens > 0 || reasoningTokens === 0) reasoningTokens = reportedReasoningTokens
        if (reportedCacheReadTokens > 0 || cacheReadTokens === 0) cacheReadTokens = reportedCacheReadTokens
        if (reportedCacheWriteTokens > 0 || cacheWriteTokens === 0) cacheWriteTokens = reportedCacheWriteTokens
    }

    const latestInput = usageNumber(latestUsage?.inputTokens)
    const latestCacheRead = usageNumber(latestUsage?.cachedInputTokens)
    const latestCacheWrite = usageNumber(latestUsage?.cacheWriteTokens)
    const latestPromptTokens = latestInput + latestCacheRead + latestCacheWrite
    const reportedCacheHit = exactTotals?.cacheHitPercent
    const cacheHitPercent = typeof reportedCacheHit === 'number' && Number.isFinite(reportedCacheHit)
        ? reportedCacheHit
        : latestPromptTokens > 0 && (latestCacheRead > 0 || latestCacheWrite > 0)
            ? (latestCacheRead / latestPromptTokens) * 100
            : null
    const contextTokensValue = usageNumber(exactTotals?.contextTokens ?? latestUsage?.totalTokens)
    const contextTokens = contextTokensValue > 0 ? contextTokensValue : null
    const contextWindow = resolveContextWindow(exactTotals || latestUsage, latest?.model || '', knownModels)
    const autoCompactionEnabled = typeof exactTotals?.autoCompactionEnabled === 'boolean'
        ? exactTotals.autoCompactionEnabled
        : null
    const contextLimit = autoCompactionEnabled === false
        ? contextWindow
        : resolveAssistantContextCompactionLimitTokens(contextWindow, configuredContextLimitTokens)
    const contextPercent = contextTokens != null && contextLimit != null && contextLimit > 0
        ? (contextTokens / contextLimit) * 100
        : null
    const reportedCost = exactTotals?.costComplete === true
        ? usageNumber(exactTotals.costUsd)
        : 0
    const persistedSessionCost = latestUsage?.sessionCostComplete === true
        ? usageNumber(latestUsage.sessionCostUsd)
        : 0
    const costUsd = reportedCost > 0 ? reportedCost : persistedSessionCost > 0 ? persistedSessionCost : null
    const costSource = costUsd != null ? 'recorded' as const : 'unavailable' as const

    return {
        turnCount: threadTurns.length,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheHitPercent,
        contextTokens,
        contextWindow,
        contextLimit,
        contextPercent,
        costUsd,
        costSource,
        autoCompactionEnabled
    }
}

export function formatPiTokenCount(value: number | null | undefined): string {
    const count = usageNumber(value)
    if (count < 1_000) return String(Math.round(count))
    if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`
    if (count < 1_000_000) return `${Math.round(count / 1_000)}k`
    if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`
    return `${Math.round(count / 1_000_000)}M`
}

export function isControlPrincipalForThread(principal: ControlPrincipal | undefined, threadId: string | null): boolean {
    if (!principal || !threadId) return false
    return principal.type === 'root'
        ? principal.threadId === threadId
        : principal.parentThreadId === threadId
}

export function countAssistantThreadPendingControl(
    state: ControlStateSnapshot | null,
    threadId: string | null
): number {
    if (!state || !threadId) return 0
    return state.pendingGrants.filter((grant) => isControlPrincipalForThread(grant.principal, threadId)).length
        + (state.pendingActionApprovals || []).filter((approval) => isControlPrincipalForThread(approval.principal, threadId)).length
}

export function selectAssistantThreadControl(
    state: ControlStateSnapshot | null,
    threadId: string | null
): AssistantThreadControlSummary {
    if (!state || !threadId) return { targets: [], grants: [], activeGrants: [], pendingGrants: [], pendingActionApprovals: [], latestEvent: null }
    const grants = state.grants.filter((grant) => isControlPrincipalForThread(grant.principal, threadId))
    const pendingGrants = state.pendingGrants.filter((grant) => isControlPrincipalForThread(grant.principal, threadId))
    const pendingActionApprovals = (state.pendingActionApprovals || []).filter((approval) => isControlPrincipalForThread(approval.principal, threadId))
    const targetIds = new Set([
        ...grants.map((grant) => grant.targetId),
        ...pendingGrants.map((grant) => grant.targetId),
        ...pendingActionApprovals.map((approval) => approval.targetId),
        ...state.targets.flatMap((target) => target.kind === 'zyra-browser' && target.ownerThreadId === threadId ? [target.targetId] : [])
    ])
    const targets = state.targets.filter((target) => targetIds.has(target.targetId))
    const relatedEvents = state.audit.filter((event) => (
        isControlPrincipalForThread(event.principal, threadId)
        || isControlPrincipalForThread(event.parentPrincipal, threadId)
        || Boolean(event.targetId && targetIds.has(event.targetId))
    ))
    const latestEvent = [...relatedEvents].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] || null
    return {
        targets,
        grants,
        activeGrants: grants.filter((grant) => grant.state === 'active'),
        pendingGrants,
        pendingActionApprovals,
        latestEvent
    }
}
