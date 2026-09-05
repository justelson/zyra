import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import log from 'electron-log'
import { ZYRA_RETRY_MAX_ATTEMPTS } from '../../../../src/network-recovery.mjs'
import type {
    AssistantApprovalDecision,
    AssistantChatScope,
    AssistantInteractionMode,
    AssistantModelInfo,
    AssistantPluginSkillSource,
    AssistantReasoningEffort,
    AssistantRuntimeEvent,
    AssistantRuntimeMode,
    AssistantSessionUsageTotals,
    AssistantThread,
    AssistantTurnOutcome,
    AssistantTurnUsage,
    AssistantUserInputAnswer,
    AssistantUserInputQuestion,
    FleetSnapshot
} from '../../shared/assistant/contracts'
import { isAssistantRuntimeMode, parseAgentSurfaceDescriptor, sanitizeFileChangeRawPayload } from '../../shared/assistant/contracts'
import { normalizeAssistantActionBatchIntent } from '../../shared/assistant/action-batch-intent'
import { getAssistantModelReasoningEfforts, isAssistantReasoningEffort } from '../../shared/assistant/reasoning-efforts'
import type { AssistantRuntimePolicy } from '../../shared/assistant/runtime-policy'
import { analyzeAssistantReadResult } from '../../shared/assistant/read-activity'
import { isAssistantTransportFailure } from '../../shared/assistant/transport-failure'
import { resolveZyraRoot } from '../zyra/zyra-root'
import type { PreparedAssistantPromptImage } from './prompt-images'
import { toUserInputQuestions } from './codex-runtime-session-utils'
import { getAssistantCanonicalThreadId } from './thread-identity'
import {
    emptyAssistantContentParts,
    extractAssistantEventContentParts,
    hasAssistantContentText,
    hasAssistantThinkingText
} from './assistant-message-content'
import { getAgentControlBroker } from '../agent-control'
import { revokePluginChatControl } from './assistant-plugin-control'
import { AgentControlError, toAgentControlError } from '../agent-control/control-errors'
import { assertControlPrincipal } from '../../shared/agent-control/validation'
import {
    DesktopAgentServerConnection,
    type CanonicalAgentChat,
    type CanonicalAgentChatHistory,
    type CanonicalAgentChatHistoryOptions,
    type PluginAuthorityUpdate,
    type ZyraWorkerEventMetadata,
    type ZyraWorkerLike
} from './zyra-agent-server-worker'

type ActiveCompactionLifecycle = {
    activityId: string
    startedAt: string
    reason: string
    turnId: string | null
}

type ActiveRetryLifecycle = {
    activityId: string
    turnId: string | null
    recoveryKind: 'network' | 'provider'
    attempt: number
    maxAttempts: number
}

type TerminalAssistantMessageOutcome = {
    turnId: string
    outcome: 'interrupted' | 'failed'
    errorMessage: string | null
}

export type PrivateVoiceTaskInput = {
    taskId: string
    localThreadId: string
    cwd: string
    filesystemScope?: AssistantChatScope | null
    prompt: string
    model?: string
    effort?: AssistantReasoningEffort
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    profile?: string
    serviceTier?: 'fast'
    signal: AbortSignal
}

export type PrivateVoiceTaskResult = {
    taskId: string
    text: string
    providerSessionId: string
}

export type PrivateVoiceTaskPreparationInput = {
    localThreadId: string
    cwd: string
    filesystemScope?: AssistantChatScope | null
    model?: string
    effort?: AssistantReasoningEffort
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    profile?: string
}

type ResolvedPrivateVoiceTaskConfiguration = {
    localThreadId: string
    cwd: string
    filesystemScope: AssistantChatScope | null
    model: string
    effort: AssistantReasoningEffort
    runtimeMode: AssistantRuntimeMode
    interactionMode: AssistantInteractionMode
    profile: string
}

type PreparedPrivateVoiceWorker = {
    key: string
    privateThreadId: string
    worker: ZyraPiWorker
    connectPromise: Promise<Record<string, unknown>>
    claimed: boolean
}

type ClaimedPrivateVoiceWorker = {
    prepared: PreparedPrivateVoiceWorker
    privateThreadId: string
    worker: ZyraPiWorker
    connected: Record<string, unknown>
}

type ZyraSessionContext = {
    localThreadId: string
    providerThreadId: string
    resumeProviderThreadId: string | null
    worker: ZyraWorkerLike
    unsubscribe?: () => void
    connected: boolean
    connectPromise: Promise<void> | null
    reconnectPromise: Promise<void> | null
    cwd: string
    filesystemScope?: AssistantChatScope | null
    pluginSkillSources: AssistantPluginSkillSource[]
    model: string
    thinking: AssistantReasoningEffort
    runtimeMode: AssistantRuntimeMode
    interactionMode: AssistantInteractionMode
    profile: string
    webSearch: boolean | null
    webFetch: boolean | null
    activeTurnId: string | null
    completedTurnIds: Set<string>
    terminalAssistantMessageOutcome: TerminalAssistantMessageOutcome | null
    assistantMessageSequence: number
    activeAssistantItemId: string | null
    usageAccountedAssistantMessageIds: Set<string>
    toolArgsByCallId: Map<string, Record<string, unknown>>
    toolStartedAtByCallId: Map<string, string>
    commandActivityIdByJobId: Map<string, string>
    runningManagedCommandJobIds: Set<string>
    assistantTextByItemId: Map<string, string>
    assistantCompletedItemIds: Set<string>
    internalTextByItemId: Map<string, string>
    internalCompletedItemIds: Set<string>
    activeCompaction: ActiveCompactionLifecycle | null
    activeRetry: ActiveRetryLifecycle | null
    lastAssistantItemId: string | null
    lastUsageTurnId: string | null
    lastUsage: AssistantTurnUsage | null
    sessionUsage: AssistantSessionUsageTotals | null
    fleetSnapshot: FleetSnapshot | null
}

type BridgeMessage = {
    type?: string
    id?: number
    requestId?: string
    operation?: unknown
    principal?: unknown
    ok?: boolean
    result?: Record<string, unknown>
    event?: unknown
    error?: string
    stack?: string
}

type PendingBridgeRequest = {
    resolve: (result: Record<string, unknown>) => void
    reject: (error: Error) => void
}

type NodeLaunch = {
    command: string
    env: NodeJS.ProcessEnv
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
}

function readUserInputAnswers(value: unknown): Record<string, AssistantUserInputAnswer> {
    const record = asRecord(value) || {}
    return Object.fromEntries(Object.entries(record).map(([questionId, answer]) => [
        questionId,
        Array.isArray(answer)
            ? answer.filter((entry): entry is string => typeof entry === 'string')
            : typeof answer === 'string' ? answer : ''
    ]))
}

function readTerminalAssistantMessageOutcome(message: Record<string, unknown> | null): Omit<TerminalAssistantMessageOutcome, 'turnId'> | null {
    const stopReason = String(message?.['stopReason'] || '').trim().toLowerCase()
    const errorMessage = asString(message?.['errorMessage'])
    if (
        stopReason === 'aborted'
        || stopReason === 'cancelled'
        || stopReason === 'canceled'
        || stopReason === 'interrupted'
        || stopReason === 'stopped'
    ) return { outcome: 'interrupted', errorMessage }
    if (stopReason === 'error' || errorMessage) return { outcome: 'failed', errorMessage }
    return null
}

function resolveZyraTerminalOutcome(
    type: string,
    event: Record<string, unknown>,
    messageOutcome: TerminalAssistantMessageOutcome | null
): AssistantTurnOutcome {
    if (messageOutcome) return messageOutcome.outcome
    if (type === 'agent_end') return 'completed'
    const outcome = String(event['outcome'] || '').trim().toLowerCase()
    if (outcome === 'interrupted' || outcome === 'cancelled' || outcome === 'canceled') return 'interrupted'
    if (outcome === 'failed') {
        const errorMessage = asString(event['errorMessage']) || ''
        return /\b(?:abort(?:ed)?|cancel(?:led|ed)?|interrupt(?:ed)?|stopp?ed)\b/i.test(errorMessage)
            ? 'interrupted'
            : 'failed'
    }
    return 'completed'
}

function nowIso(): string {
    return new Date().toISOString()
}

function markTurnCompleted(context: ZyraSessionContext, turnId: string): void {
    context.completedTurnIds.add(turnId)
    while (context.completedTurnIds.size > 256) {
        const oldest = context.completedTurnIds.values().next().value
        if (!oldest) break
        context.completedTurnIds.delete(oldest)
    }
}

function deltaFromMergedText(previousText: string, nextText: string): string {
    if (!nextText || nextText === previousText) return ''
    return nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText
}

function isExpectedBridgeDisposalError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '')
    return /Zyra bridge (?:disposed|stopped)\./i.test(message)
}

function isReasoningOnlyAssistantEvent(event: Record<string, unknown>): boolean {
    const message = asRecord(event['message'])
    const assistantMessageEvent = asRecord(event['assistantMessageEvent'])
    const candidates = [
        asString(event['channel']),
        asString(event['streamKind']),
        asString(event['kind']),
        asString(message?.['channel']),
        asString(message?.['type']),
        asString(assistantMessageEvent?.['channel']),
        asString(assistantMessageEvent?.['type']),
        asString(assistantMessageEvent?.['kind'])
    ]
    return candidates.some((entry) => {
        const normalized = String(entry || '').trim().toLowerCase().replace(/[.\-/:]+/g, '_')
        return /(?:^|_)(?:reasoning|analysis|thinking|thought)(?:_|$)/.test(normalized)
    })
}

function readAssistantEventSourceItemId(event: Record<string, unknown>): string | null {
    const message = asRecord(event['message'])
    const assistantMessageEvent = asRecord(event['assistantMessageEvent'])
    return asString(message?.['id'])
        || asString(assistantMessageEvent?.['id'])
        || asString(assistantMessageEvent?.['itemId'])
        || asString(assistantMessageEvent?.['messageId'])
}

function resolveAssistantEventItemId(
    context: ZyraSessionContext,
    event: Record<string, unknown>,
    turnId: string,
    eventType: string
): string {
    const sourceItemId = readAssistantEventSourceItemId(event)
    if (eventType === 'message_start') {
        context.assistantMessageSequence += 1
        const itemId = sourceItemId || `zyra-assistant-${turnId}-${context.assistantMessageSequence}`
        context.activeAssistantItemId = itemId
        return itemId
    }

    if (context.activeAssistantItemId) return context.activeAssistantItemId

    context.assistantMessageSequence += 1
    const itemId = sourceItemId || `zyra-assistant-${turnId}-${context.assistantMessageSequence}`
    context.activeAssistantItemId = itemId
    return itemId
}

function readUsage(value: unknown): AssistantTurnUsage | null {
    const usage = asRecord(value)
    if (!usage) return null
    const numberValue = (key: string): number | null => {
        const raw = usage[key]
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    }
    const cost = asRecord(usage['cost'])
    const costTotal = cost?.['total']
    return {
        inputTokens: numberValue('input'),
        outputTokens: numberValue('output'),
        cachedInputTokens: numberValue('cacheRead'),
        cacheWriteTokens: numberValue('cacheWrite'),
        reasoningOutputTokens: numberValue('reasoning') ?? numberValue('reasoningTokens'),
        totalTokens: numberValue('totalTokens') ?? numberValue('total'),
        modelContextWindow: numberValue('modelContextWindow'),
        costUsd: typeof costTotal === 'number' && Number.isFinite(costTotal) ? costTotal : null
    }
}

function sumAssistantUsageMetric(left: number | null | undefined, right: number | null | undefined): number | null {
    const hasLeft = typeof left === 'number' && Number.isFinite(left)
    const hasRight = typeof right === 'number' && Number.isFinite(right)
    if (!hasLeft && !hasRight) return null
    return (hasLeft ? left : 0) + (hasRight ? right : 0)
}

function getUsageAccountedAssistantMessageIds(context: ZyraSessionContext): Set<string> {
    if (!context.usageAccountedAssistantMessageIds) context.usageAccountedAssistantMessageIds = new Set()
    return context.usageAccountedAssistantMessageIds
}

export function resolveAssistantUsageMessageIdentity(
    messageValue: unknown,
    turnId: string,
    fallbackItemId: string
): string {
    const message = asRecord(messageValue)
    const stableId = asString(message?.['id'])
        || asString(message?.['messageId'])
        || asString(message?.['entryId'])
        || asString(message?.['uuid'])
    if (stableId) return stableId
    try {
        const signature = JSON.stringify({
            turnId,
            role: message?.['role'],
            timestamp: message?.['timestamp'],
            content: message?.['content'],
            usage: message?.['usage'],
            stopReason: message?.['stopReason'],
            errorMessage: message?.['errorMessage']
        })
        return `anonymous-assistant-usage:${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`
    } catch {
        return fallbackItemId
    }
}

export function shouldAccountAssistantMessageUsage(input: {
    replay: boolean
    turnId: string
    activeTurnId: string | null
    turnCompleted: boolean
    messageAlreadyAccounted: boolean
}): boolean {
    if (input.replay && (input.activeTurnId !== input.turnId || input.turnCompleted)) return false
    return !input.messageAlreadyAccounted
}

export function mergeAssistantTurnUsage(
    current: AssistantTurnUsage | null,
    next: AssistantTurnUsage
): AssistantTurnUsage {
    return {
        inputTokens: sumAssistantUsageMetric(current?.inputTokens, next.inputTokens),
        outputTokens: sumAssistantUsageMetric(current?.outputTokens, next.outputTokens),
        cachedInputTokens: sumAssistantUsageMetric(current?.cachedInputTokens, next.cachedInputTokens),
        cacheWriteTokens: sumAssistantUsageMetric(current?.cacheWriteTokens, next.cacheWriteTokens),
        reasoningOutputTokens: sumAssistantUsageMetric(current?.reasoningOutputTokens, next.reasoningOutputTokens),
        totalTokens: typeof next.totalTokens === 'number' && next.totalTokens > 0
            ? next.totalTokens
            : current?.totalTokens ?? next.totalTokens ?? null,
        modelContextWindow: typeof next.modelContextWindow === 'number' && next.modelContextWindow > 0
            ? next.modelContextWindow
            : current?.modelContextWindow ?? next.modelContextWindow ?? null,
        costUsd: sumAssistantUsageMetric(current?.costUsd, next.costUsd),
        sessionCostUsd: typeof next.sessionCostUsd === 'number' && Number.isFinite(next.sessionCostUsd)
            ? next.sessionCostUsd
            : current?.sessionCostUsd ?? null,
        sessionCostComplete: typeof next.sessionCostComplete === 'boolean'
            ? next.sessionCostComplete
            : current?.sessionCostComplete ?? null
    }
}

export function completeAssistantTurnUsage(
    turnUsage: AssistantTurnUsage | null,
    sessionCostUsd: number | null | undefined,
    sessionCostComplete: boolean | null | undefined
): AssistantTurnUsage | null {
    if (!turnUsage && !(typeof sessionCostUsd === 'number' && sessionCostUsd > 0)) return null
    return {
        ...(turnUsage || {}),
        sessionCostUsd: typeof sessionCostUsd === 'number' && Number.isFinite(sessionCostUsd)
            ? sessionCostUsd
            : turnUsage?.sessionCostUsd ?? null,
        sessionCostComplete: typeof sessionCostComplete === 'boolean'
            ? sessionCostComplete
            : turnUsage?.sessionCostComplete ?? null
    }
}

function buildCompletedTurnUsage(context: ZyraSessionContext): AssistantTurnUsage | null {
    return completeAssistantTurnUsage(
        buildLiveAssistantTurnUsage(context),
        context.sessionUsage?.costUsd,
        context.sessionUsage?.costComplete
    )
}

export function buildLiveAssistantTurnUsage(context: Pick<ZyraSessionContext, 'lastUsage' | 'sessionUsage'>): AssistantTurnUsage | null {
    const contextTokens = context.sessionUsage?.contextTokens
    const contextWindow = context.sessionUsage?.modelContextWindow
    if (!context.lastUsage && !(typeof contextTokens === 'number' && contextTokens > 0)) return null
    return {
        ...(context.lastUsage || {}),
        totalTokens: typeof contextTokens === 'number' && contextTokens > 0
            ? contextTokens
            : context.lastUsage?.totalTokens ?? null,
        modelContextWindow: typeof contextWindow === 'number' && contextWindow > 0
            ? contextWindow
            : context.lastUsage?.modelContextWindow ?? null,
        sessionCostUsd: context.sessionUsage?.costUsd ?? context.lastUsage?.sessionCostUsd ?? null,
        sessionCostComplete: context.sessionUsage?.costComplete ?? context.lastUsage?.sessionCostComplete ?? null
    }
}

function readSessionUsage(
    value: unknown,
    contextValue: unknown,
    threadId: string,
    autoCompactionEnabled: unknown
): AssistantSessionUsageTotals | null {
    const usage = asRecord(value)
    const context = asRecord(contextValue)
    if (!usage && !context) return null
    const numberValue = (record: Record<string, unknown> | null, key: string): number | null => {
        const raw = record?.[key]
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    }
    return {
        threadId,
        inputTokens: numberValue(usage, 'input'),
        outputTokens: numberValue(usage, 'output'),
        cachedInputTokens: numberValue(usage, 'cacheRead'),
        cacheWriteTokens: numberValue(usage, 'cacheWrite'),
        reasoningOutputTokens: numberValue(usage, 'reasoning'),
        totalTokens: numberValue(usage, 'total'),
        contextTokens: numberValue(context, 'tokens'),
        cacheHitPercent: numberValue(usage, 'cacheHitPercent'),
        modelContextWindow: numberValue(context, 'contextWindow'),
        costUsd: numberValue(usage, 'cost'),
        costComplete: typeof usage?.['costComplete'] === 'boolean' ? usage.costComplete : null,
        autoCompactionEnabled: typeof autoCompactionEnabled === 'boolean' ? autoCompactionEnabled : null
    }
}

function summarizeValue(value: unknown): string | undefined {
    if (typeof value === 'string') return value.slice(0, 300)
    if (value === undefined || value === null) return undefined
    try {
        return JSON.stringify(value).slice(0, 300)
    } catch {
        return String(value).slice(0, 300)
    }
}

function normalizeToolName(value: unknown): string {
    return String(value || 'tool')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

function compactToolName(value: unknown): string {
    return normalizeToolName(value).replace(/\s+/g, '')
}

function firstToolString(source: Record<string, unknown> | null, keys: string[]): string | null {
    if (!source) return null
    for (const key of keys) {
        const value = source[key]
        if (typeof value === 'string' && value.trim()) return value
    }
    return null
}

function readManagedCommandJobId(
    args: Record<string, unknown> | null,
    result: Record<string, unknown> | null,
    partialResult: unknown
): string | null {
    const partialRecord = asRecord(partialResult)
    const resultDetails = asRecord(result?.['details'])
    const partialDetails = asRecord(partialRecord?.['details'])
    const direct = firstToolString(args, ['jobId', 'job_id'])
        || firstToolString(result, ['jobId', 'job_id'])
        || firstToolString(resultDetails, ['jobId', 'job_id'])
        || firstToolString(partialRecord, ['jobId', 'job_id'])
        || firstToolString(partialDetails, ['jobId', 'job_id'])
    return direct
}

type ManagedCommandLifecycleStatus = 'running' | 'completed' | 'failed' | 'stopped'

function normalizeManagedCommandLifecycleStatus(value: unknown): ManagedCommandLifecycleStatus | null {
    const normalized = String(value || '').trim().toLowerCase().replace(/[-_\s]/g, '')
    if (normalized === 'running' || normalized === 'inprogress' || normalized === 'pending' || normalized === 'started') return 'running'
    if (normalized === 'complete' || normalized === 'completed' || normalized === 'success' || normalized === 'succeeded') return 'completed'
    if (normalized === 'error' || normalized === 'failed') return 'failed'
    if (normalized === 'stopped' || normalized === 'aborted' || normalized === 'interrupted' || normalized === 'cancelled') return 'stopped'
    return null
}

function readManagedCommandLifecycleStatus(
    result: Record<string, unknown> | null,
    partialResult: unknown
): ManagedCommandLifecycleStatus | null {
    const partialRecord = asRecord(partialResult)
    const resultDetails = asRecord(result?.['details'])
    const partialDetails = asRecord(partialRecord?.['details'])
    for (const value of [
        resultDetails?.['status'],
        result?.['status'],
        partialDetails?.['status'],
        partialRecord?.['status']
    ]) {
        const status = normalizeManagedCommandLifecycleStatus(value)
        if (status) return status
    }
    return null
}

function isManagedCommandCheckpointCall(
    toolName: string,
    args: Record<string, unknown> | null,
    result: Record<string, unknown> | null,
    partialResult: unknown
): boolean {
    const jobId = readManagedCommandJobId(args, result, partialResult)
    const directCommand = firstToolString(args, ['command', 'cmd', 'script'])
    const action = firstToolString(args, ['action'])
        || (compactToolName(toolName) === 'bash' && jobId && !directCommand ? 'status' : null)
    return compactToolName(toolName) === 'bash' && Boolean(jobId) && /^(status|stop)$/i.test(action || '')
}

function managedCommandSummary(status: ManagedCommandLifecycleStatus): string {
    if (status === 'running') return 'Running command'
    if (status === 'failed') return 'Command failed'
    if (status === 'stopped') return 'Stopped command'
    return 'Ran command'
}

function readToolStringArray(value: unknown): string[] {
    if (typeof value === 'string' && value.trim()) return [value]
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function readPathsFromChanges(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
        const change = asRecord(entry)
        if (!change) return []
        const kind = asRecord(change['kind'])
        return [
            firstToolString(change, ['path', 'filePath', 'file_path']),
            firstToolString(change, ['previousPath', 'previous_path', 'movePath', 'move_path']),
            firstToolString(kind, ['movePath', 'move_path'])
        ].filter((path): path is string => Boolean(path))
    })
}

function readToolPaths(
    args: Record<string, unknown> | null,
    result: Record<string, unknown> | null,
    partialResult?: unknown
): string[] {
    const resultDetails = asRecord(result?.['details'])
    const partialRecord = asRecord(partialResult)
    const partialDetails = asRecord(partialRecord?.['details'])
    const candidates = [
        ...readToolStringArray(args?.['paths']),
        ...readToolStringArray(args?.['files']),
        ...readToolStringArray(result?.['paths']),
        ...readToolStringArray(result?.['files']),
        ...readToolStringArray(resultDetails?.['paths']),
        ...readToolStringArray(resultDetails?.['files']),
        ...readToolStringArray(partialDetails?.['paths']),
        ...readToolStringArray(partialDetails?.['files']),
        ...readPathsFromChanges(resultDetails?.['changes']),
        ...readPathsFromChanges(partialDetails?.['changes'])
    ]
    const records = [args, result, resultDetails, partialRecord, partialDetails]
    for (const record of records) {
        const path = firstToolString(record, ['path', 'filePath', 'file_path', 'targetPath', 'target_path'])
        if (path) candidates.unshift(path)
    }
    return [...new Set(candidates.map((entry) => entry.trim()).filter(Boolean))]
}

function readToolOutput(result: unknown, partialResult: unknown, preserveWhitespace = false): string | undefined {
    if (typeof result === 'string' && result.trim()) return result
    if (typeof partialResult === 'string' && partialResult.trim()) return partialResult
    const resultRecord = asRecord(result)
    const partialRecord = asRecord(partialResult)
    const content = Array.isArray(resultRecord?.['content'])
        ? resultRecord?.['content']
        : Array.isArray(partialRecord?.['content'])
            ? partialRecord?.['content']
            : []
    const contentText = content
        .map((entry) => asRecord(entry)?.['text'])
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .join('\n')
    if (contentText.trim()) return preserveWhitespace ? contentText : contentText.trim()
    return firstToolString(resultRecord, ['output', 'stdout', 'text', 'message'])
        || firstToolString(partialRecord, ['output', 'stdout', 'text', 'message'])
        || summarizeValue(partialResult)
        || summarizeValue(result)
}

function isFileMutationTool(toolName: string, args: Record<string, unknown> | null): boolean {
    const normalized = normalizeToolName(toolName)
    if (/\b(edit|write|patch|replace|append|create|delete|move|rename)\b/.test(normalized) && !/\bthread\b/.test(normalized)) return true
    return Boolean(firstToolString(args, [
        'oldString',
        'old_string',
        'newString',
        'new_string',
        'oldStr',
        'old_str',
        'newStr',
        'new_str',
        'content',
        'fileContent',
        'file_content',
        'patch',
        'diff'
    ]))
}

function getPatchStats(patch: string | null): { additions: number; deletions: number } | null {
    if (!patch) return null
    const lines = patch.split(/\r?\n/)
    const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    return additions || deletions ? { additions, deletions } : null
}

function patchPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function prefixPatchLines(value: string, prefix: '+' | '-'): string {
    return value.replace(/\r\n/g, '\n').split('\n').map((line) => `${prefix}${line}`).join('\n')
}

export function buildArgumentPreviewPatch(toolName: string, args: Record<string, unknown> | null): string | null {
    const path = firstToolString(args, ['path', 'filePath', 'file_path', 'targetPath', 'target_path'])
    if (!path) return null
    const normalizedPath = patchPath(path)
    const oldText = firstToolString(args, ['oldString', 'old_string', 'oldText', 'old_text', 'oldStr', 'old_str', 'from', 'before'])
    const newText = firstToolString(args, ['newString', 'new_string', 'newText', 'new_text', 'newStr', 'new_str', 'to', 'after'])
    if (oldText !== null && newText !== null) {
        const oldLines = oldText.replace(/\r\n/g, '\n').split('\n').length
        const newLines = newText.replace(/\r\n/g, '\n').split('\n').length
        return [
            `--- a/${normalizedPath}`,
            `+++ b/${normalizedPath}`,
            `@@ -1,${oldLines} +1,${newLines} @@`,
            prefixPatchLines(oldText, '-'),
            prefixPatchLines(newText, '+')
        ].join('\n')
    }
    const structuredEdits = Array.isArray(args?.['edits']) ? args.edits : []
    const structuredHunks: string[] = []
    let previewLine = 1
    for (const value of structuredEdits) {
        const edit = asRecord(value)
        const previous = typeof edit?.['oldText'] === 'string' ? edit.oldText : null
        const next = typeof edit?.['newText'] === 'string' ? edit.newText : null
        if (previous === null || next === null || previous === next) continue
        const previousLines = previous.replace(/\r\n/g, '\n').split('\n')
        const nextLines = next.replace(/\r\n/g, '\n').split('\n')
        structuredHunks.push([
            `@@ -${previewLine},${previousLines.length} +${previewLine},${nextLines.length} @@`,
            prefixPatchLines(previous, '-'),
            prefixPatchLines(next, '+')
        ].join('\n'))
        previewLine += Math.max(previousLines.length, nextLines.length) + 2
    }
    if (structuredHunks.length > 0) {
        return [
            `--- a/${normalizedPath}`,
            `+++ b/${normalizedPath}`,
            ...structuredHunks
        ].join('\n')
    }
    const content = firstToolString(args, ['content', 'fileContent', 'file_content', 'text', 'body'])
    if (content === null) return firstToolString(args, ['patch', 'diff'])
    const lines = content.replace(/\r\n/g, '\n').split('\n').length
    return [
        '--- /dev/null',
        `+++ b/${normalizedPath}`,
        `@@ -0,0 +1,${lines} @@`,
        prefixPatchLines(content, '+')
    ].join('\n')
}

export function readPiFileChangeData(input: {
    cwd: string
    toolName: string
    args: Record<string, unknown> | null
    result: Record<string, unknown> | null
    partialResult: unknown
    type: string
    state: 'running' | 'completed' | 'error'
}): Record<string, unknown> {
    const { cwd, toolName, args, result, partialResult, type, state } = input
    const resultDetails = asRecord(result?.['details'])
    const partialRecord = asRecord(partialResult)
    const partialDetails = asRecord(partialRecord?.['details'])
    const details = resultDetails || partialDetails
    const resultPatch = firstToolString(resultDetails, ['patch'])
        || firstToolString(partialDetails, ['patch'])
    const resultDiff = firstToolString(resultDetails, ['diff'])
        || firstToolString(partialDetails, ['diff'])
    const explicitPatch = firstToolString(args, ['patch', 'diff'])
    const previewPatch = buildArgumentPreviewPatch(toolName, args) || explicitPatch
    const paths = readToolPaths(args, result, partialResult)
    const path = paths[0]
    const normalizedTool = normalizeToolName(toolName)
    const detailsSource = firstToolString(details, ['source'])
    const syntheticSnapshot = detailsSource === 'synthetic-snapshot' && Boolean(resultPatch || resultDiff)
        || details?.['snapshotBacked'] === true && Boolean(resultPatch || resultDiff)
    const unavailableReason = firstToolString(details, ['diffUnavailableReason', 'diff_unavailable_reason'])
    const hasProviderResult = Boolean(resultPatch || resultDiff)
    const source = syntheticSnapshot
        ? 'synthetic-snapshot'
        : hasProviderResult && type === 'tool_execution_end'
            ? 'provider-result'
            : hasProviderResult
                ? 'provider-live'
                : 'args-preview'
    const canonicalPatch = source === 'provider-result' || source === 'synthetic-snapshot'
        ? resultPatch || resultDiff
        : source === 'provider-live'
            ? resultPatch || resultDiff
            : undefined
    const writeExisting = Boolean(path && /\bwrite\b/.test(normalizedTool) && existsSync(isAbsolute(path) ? path : resolve(cwd, path)))
    const effectivePatch = resultPatch || resultDiff || explicitPatch || previewPatch
    const patchCreatesFile = Boolean(effectivePatch && /^---\s+(?:\/dev\/null|null)\s*$/m.test(effectivePatch))
    const patchDeletesFile = Boolean(effectivePatch && /^\+\+\+\s+(?:\/dev\/null|null)\s*$/m.test(effectivePatch))
    const kind = /\b(delete|remove)\b/.test(normalizedTool) || patchDeletesFile
        ? 'delete'
        : /\b(move|rename)\b/.test(normalizedTool)
            ? 'move'
            : patchCreatesFile || /\b(write|create)\b/.test(normalizedTool) && !writeExisting
                ? 'add'
                : 'update'
    const changes = Array.isArray(details?.['changes'])
        ? details?.['changes']
        : path
            ? [{ path, kind, diff: canonicalPatch || previewPatch, isNew: kind === 'add' }]
            : []
    return {
        category: 'file-change',
        provider: 'pi',
        status: state === 'error' ? 'failed' : state,
        toolName,
        source,
        revision: type === 'tool_execution_start' ? 1 : type === 'tool_execution_update' ? 2 : 3,
        authoritative: state !== 'error' && (source === 'provider-result' || source === 'synthetic-snapshot'),
        changes,
        paths,
        createdPaths: kind === 'add' ? paths : [],
        fileCount: paths.length || undefined,
        patch: canonicalPatch || undefined,
        previewPatch: previewPatch || undefined,
        displayDiff: resultDiff || undefined,
        diffUnavailableReason: canonicalPatch
            ? undefined
            : unavailableReason || (previewPatch ? 'preview-only' : undefined),
        snapshotBacked: syntheticSnapshot || undefined,
        truncated: details?.['truncated'] === true || undefined
    }
}

function parseToolJsonOutput(value: string | undefined): Record<string, unknown> | null {
    if (!value?.trim().startsWith('{')) return null
    try {
        return asRecord(JSON.parse(value))
    } catch {
        return null
    }
}

function projectWebSearchResults(value: unknown): Array<{ title: string; url: string; snippet: string }> {
    if (!Array.isArray(value)) return []
    return value.slice(0, 16).flatMap((entry) => {
        const record = asRecord(entry)
        const title = asString(record?.['title'])
        const url = asString(record?.['url'])
        if (!title || !url) return []
        return [{ title, url, snippet: asString(record?.['snippet']) || '' }]
    })
}

export function classifyZyraToolActivity(input: {
    toolName: string
    args: Record<string, unknown> | null
    result: Record<string, unknown> | null
    partialResult: unknown
    state: 'running' | 'completed' | 'error'
    output?: string
}): {
    kind: string
    summary: string
    detail?: string
    data: Record<string, unknown>
} {
    const { toolName, args, result, partialResult, state, output } = input
    const normalized = normalizeToolName(toolName)
    const compact = compactToolName(toolName)
    const running = state === 'running'
    const failed = state === 'error'
    const paths = readToolPaths(args, result, partialResult)
    const directCommand = firstToolString(args, ['command', 'cmd', 'script'])
    const shellJobId = readManagedCommandJobId(args, result, partialResult)
    const shellAction = firstToolString(args, ['action'])
        || (compact === 'bash' && shellJobId && !directCommand ? 'status' : null)
    const isShellTool = /\b(bash|shell|powershell|terminal|exec|command)\b/.test(normalized)
    const isManagedCommandCheckpoint = compact === 'bash' && Boolean(shellJobId) && /^(status|stop)$/i.test(shellAction || '')
    const command = directCommand || (
        isShellTool && shellAction
            ? [toolName, shellAction, shellJobId].filter(Boolean).join(' ')
            : null
    )
    const query = firstToolString(args, ['query', 'q', 'pattern', 'search'])
    const prompt = firstToolString(args, ['prompt', 'message', 'input'])
    const patch = firstToolString(args, ['patch', 'diff'])
    const patchStats = getPatchStats(patch)
    const resultDetails = asRecord(result?.['details']) || asRecord(asRecord(partialResult)?.['details'])
    const parsedOutput = parseToolJsonOutput(output)
    const baseData: Record<string, unknown> = {
        status: state,
        toolName,
        args: args || undefined,
        result: result || partialResult || undefined,
        output
    }

    if (isManagedCommandCheckpoint) {
        const action = shellAction!.toLowerCase()
        return {
            kind: 'command.checkpoint',
            summary: action === 'stop'
                ? (running ? 'Stopping command' : failed ? 'Could not stop command' : 'Stopped command')
                : (running ? 'Checking command' : failed ? 'Could not check command' : 'Checked command'),
            detail: shellJobId || undefined,
            data: {
                ...baseData,
                category: 'command-checkpoint',
                commandAction: action,
                jobId: shellJobId
            }
        }
    }

    if (compact.includes('spawnagent') || compact.includes('sendinput') || compact.includes('resumeagent') || compact === 'wait' || compact.includes('waitagent') || compact.includes('closeagent')) {
        const kindMap: Array<[boolean, string, string, string | undefined]> = [
            [compact.includes('spawnagent'), 'subagent.spawn', running ? 'Spawning subagent' : failed ? 'Failed to spawn subagent' : 'Spawned subagent', prompt || undefined],
            [compact.includes('sendinput'), 'subagent.send-input', running ? 'Checking in with subagent' : failed ? 'Failed subagent check-in' : 'Checked in with subagent', prompt || undefined],
            [compact.includes('resumeagent'), 'subagent.resume', running ? 'Resuming subagent' : failed ? 'Failed to resume subagent' : 'Resumed subagent', prompt || undefined],
            [compact === 'wait' || compact.includes('waitagent'), 'subagent.wait', running ? 'Waiting on subagent' : failed ? 'Subagent wait failed' : 'Subagent wait completed', undefined],
            [compact.includes('closeagent'), 'subagent.close', running ? 'Closing subagent' : failed ? 'Failed to close subagent' : 'Closed subagent', undefined]
        ]
        const match = kindMap.find(([enabled]) => enabled)
        if (match) {
            return {
                kind: match[1],
                summary: match[2],
                detail: match[3] || output || undefined,
                data: {
                    ...baseData,
                    category: 'subagent',
                    tool: toolName,
                    prompt: prompt || undefined,
                    receiverThreadIds: readToolStringArray(result?.['receiverThreadIds'] || args?.['receiverThreadIds']),
                    model: firstToolString(args, ['model']),
                    reasoningEffort: firstToolString(args, ['reasoningEffort', 'reasoning_effort'])
                }
            }
        }
    }

    if (compact === 'websearch') {
        const webResults = projectWebSearchResults(resultDetails?.['results'])
        return {
            kind: 'web-search',
            summary: running ? 'Searching the web' : failed ? 'Web search failed' : 'Searched the web',
            detail: query || output || toolName,
            data: {
                ...baseData,
                category: 'web-search',
                query: query || asString(resultDetails?.['query']) || undefined,
                webResults
            }
        }
    }

    if (compact === 'webfetch') {
        const url = firstToolString(args, ['url', 'href']) || asString(resultDetails?.['url'])
        return {
            kind: 'web-fetch',
            summary: running ? 'Reading a web page' : failed ? 'Web fetch failed' : 'Read a web page',
            detail: url || output || toolName,
            data: {
                ...baseData,
                category: 'web-fetch',
                url: url || undefined,
                pageTitle: asString(resultDetails?.['title']) || undefined,
                contentType: asString(resultDetails?.['contentType']) || undefined,
                statusCode: typeof resultDetails?.['status'] === 'number' ? resultDetails.status : undefined,
                bytesRead: typeof resultDetails?.['bytesRead'] === 'number' ? resultDetails.bytesRead : undefined,
                truncated: resultDetails?.['truncated'] === true || undefined,
                pageText: asString(resultDetails?.['text']) || undefined
            }
        }
    }

    if (compact === 'agent' || compact === 'workflow') {
        const action = firstToolString(args, ['action', 'operation']) || 'status'
        const runId = firstToolString(parsedOutput, compact === 'agent' ? ['agentRunId'] : ['workflowRunId'])
            || firstToolString(args, compact === 'agent' ? ['agentRunId'] : ['workflowRunId'])
        return {
            kind: compact,
            summary: `${running ? 'Running' : failed ? 'Failed' : 'Completed'} ${compact} ${action}`,
            detail: firstToolString(args, ['label', 'name', 'prompt']) || runId || output || toolName,
            data: {
                ...baseData,
                category: compact,
                action,
                runId: runId || undefined,
                agentRunId: compact === 'agent' ? runId || undefined : undefined,
                workflowRunId: compact === 'workflow' ? runId || undefined : undefined,
                requestedAgent: firstToolString(args, ['agent']) || undefined,
                label: firstToolString(args, ['label', 'name']) || undefined,
                prompt: prompt || undefined,
                run: parsedOutput || undefined
            }
        }
    }

    if (/^browser(?:\s|$)/.test(normalized) || /^browser/.test(compact)) {
        const url = firstToolString(args, ['url', 'href']) || firstToolString(resultDetails, ['url'])
        return {
            kind: 'browser-control',
            summary: running ? 'Using the browser' : failed ? 'Browser action failed' : 'Browser action completed',
            detail: url || firstToolString(args, ['operation', 'action']) || output || toolName,
            data: {
                ...baseData,
                category: 'browser-control',
                operation: firstToolString(args, ['operation', 'action']) || undefined,
                url: url || undefined,
                pageTitle: firstToolString(resultDetails, ['title']) || undefined,
                faviconUrl: firstToolString(resultDetails, ['faviconUrl', 'favicon_url']) || undefined
            }
        }
    }

    if (/^computer(?:\s|$)/.test(normalized) || /^computer/.test(compact)) {
        const computerMetadata = { ...baseData }
        delete computerMetadata['result']
        delete computerMetadata['output']
        return {
            kind: 'computer-control',
            summary: running ? 'Using computer control' : failed ? 'Computer action failed' : 'Computer action completed',
            detail: firstToolString(args, ['operation', 'action', 'name', 'targetId']) || toolName,
            data: {
                ...computerMetadata,
                category: 'computer-control',
                operation: firstToolString(args, ['operation', 'action']) || undefined,
                targetId: firstToolString(args, ['targetId', 'target_id']) || undefined,
                executableIdentity: firstToolString(args, ['executableIdentity', 'executable_identity']) || undefined
            }
        }
    }

    if (command || isShellTool) {
        return {
            kind: 'command',
            summary: running ? 'Running command' : failed ? 'Command failed' : 'Ran command',
            detail: command || output || toolName,
            data: {
                ...baseData,
                command: command || toolName,
                jobId: shellJobId || undefined
            }
        }
    }

    if (isFileMutationTool(toolName, args)) {
        return {
            kind: 'file-change',
            summary: running ? 'Editing files' : failed ? 'File edit failed' : (paths.length > 1 ? 'Edited files' : 'Edited file'),
            detail: paths.length > 0 ? paths.join('\n') : firstToolString(args, ['path', 'filePath', 'file_path']) || output || toolName,
            data: {
                ...sanitizeFileChangeRawPayload(baseData),
                category: 'file-change',
                paths,
                createdPaths: paths.filter((entry) => /\b(create|write)\b/i.test(toolName)),
                fileCount: paths.length || undefined,
                patch: patch || undefined,
                additions: patchStats?.additions,
                deletions: patchStats?.deletions
            }
        }
    }

    if (paths.length > 0 || /\b(read|open|cat|view|inspect)\b/.test(normalized)) {
        const skillPath = paths.find((entry) => /(?:^|[\\/])skills[\\/][^\\/]+[\\/]skill\.md$/i.test(entry))
        return {
            kind: skillPath ? 'skill' : 'file-read',
            summary: skillPath
                ? running ? 'Loading skill' : failed ? 'Skill load failed' : 'Loaded skill'
                : running ? 'Reading file' : failed ? 'File read failed' : (paths.length > 1 ? 'Read files' : 'Read file'),
            detail: paths.length > 0 ? paths.join('\n') : output || toolName,
            data: {
                ...baseData,
                category: skillPath ? 'skill' : 'file-read',
                paths,
                skillPath: skillPath || undefined,
                skillName: skillPath ? skillPath.replace(/\\/g, '/').match(/\/skills\/([^/]+)\/SKILL\.md$/i)?.[1] : undefined,
                fileCount: paths.length || undefined
            }
        }
    }

    if (query || /\b(search|find|grep|rg|web)\b/.test(normalized)) {
        return {
            kind: 'search',
            summary: running ? 'Searching' : failed ? 'Search failed' : 'Searched',
            detail: query || output || toolName,
            data: {
                ...baseData,
                query: query || undefined
            }
        }
    }

    return {
        kind: 'tool',
        summary: `${running ? 'Using' : failed ? 'Failed' : 'Used'} ${toolName}`,
        detail: summarizeValue(args) || output,
        data: baseData
    }
}

function normalizeZyraModel(model: string | undefined): string | undefined {
    if (!model) return undefined
    if (model.includes('/')) return model
    if (model.startsWith('gpt-') || model.startsWith('o')) return `openai-codex/${model}`
    return model
}

function normalizeZyraProfile(profile: unknown): string {
    const normalized = typeof profile === 'string' ? profile.trim().toLowerCase() : ''
    return /^[a-z0-9_-]{1,64}$/.test(normalized) ? normalized : 'default'
}

function resolvePrivateVoiceTaskConfiguration(
    input: PrivateVoiceTaskPreparationInput
): ResolvedPrivateVoiceTaskConfiguration {
    return {
        localThreadId: input.localThreadId,
        cwd: resolve(input.cwd),
        filesystemScope: input.filesystemScope || null,
        model: normalizeZyraModel(input.model) || 'openai-codex/gpt-5.6-sol',
        effort: input.effort || 'high',
        runtimeMode: input.runtimeMode || 'approval-required',
        interactionMode: 'default',
        profile: normalizeZyraProfile(input.profile)
    }
}

function getPrivateVoiceWorkerKey(
    root: string,
    bridgePath: string,
    configuration: ResolvedPrivateVoiceTaskConfiguration
): string {
    return JSON.stringify([
        root,
        bridgePath,
        configuration.localThreadId,
        configuration.cwd,
        configuration.filesystemScope,
        configuration.model,
        configuration.effort,
        configuration.runtimeMode,
        configuration.interactionMode,
        configuration.profile
    ])
}

function getPrivateVoiceConnectPayload(
    configuration: ResolvedPrivateVoiceTaskConfiguration,
    privateThreadId: string
): Record<string, unknown> {
    return {
        cwd: configuration.cwd,
        filesystemScope: configuration.filesystemScope || undefined,
        localThreadId: privateThreadId,
        noSession: true,
        model: configuration.model,
        thinking: configuration.effort,
        profile: configuration.profile,
        runtimeMode: configuration.runtimeMode,
        interactionMode: configuration.interactionMode,
        reasoningSummary: 'auto',
        surface: 'memory-worker',
        purpose: 'voice-primary'
    }
}

function fallbackZyraModels(): AssistantModelInfo[] {
    return [
        { id: 'openai-codex/gpt-5.5', label: 'gpt-5.5', description: 'openai-codex' },
        { id: 'openai-codex/gpt-5.4', label: 'gpt-5.4', description: 'openai-codex' },
        { id: 'openai-codex/gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'openai-codex' },
        { id: 'openai-codex/gpt-5.3-codex', label: 'gpt-5.3-codex', description: 'openai-codex' },
        { id: 'openai-codex/gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', description: 'openai-codex' }
    ].map((model) => ({ ...model, supportedEfforts: getAssistantModelReasoningEfforts(model) }))
}

function normalizeModelInfo(value: unknown): AssistantModelInfo | null {
    const record = asRecord(value)
    const id = asString(record?.['id'])
    if (!id) return null
    const label = asString(record?.['label']) || id
    const description = asString(record?.['description']) || undefined
    const supportedEfforts = Array.isArray(record?.['supportedEfforts'])
        ? record.supportedEfforts.filter(isAssistantReasoningEffort)
        : getAssistantModelReasoningEfforts({ id, label })
    const contextWindow = typeof record?.['contextWindow'] === 'number' && Number.isFinite(record.contextWindow)
        ? record.contextWindow
        : null
    return { id, label, description, supportedEfforts, contextWindow }
}

function resolveBridgePath(root = resolveZyraRoot()): string {
    return join(root, 'src', 'zyra-ui-bridge.mjs')
}

function resolveNodeLaunch(): NodeLaunch {
    const explicitNode = [
        process.env.ZYRA_NODE_BINARY,
        process.env.ZYRA_AGENT_NODE,
        process.env.npm_node_execpath,
        process.env.NODE_BINARY
    ].find((candidate): candidate is string => Boolean(candidate?.trim()))
    if (explicitNode) {
        return { command: explicitNode, env: {} }
    }

    if (process.versions.electron) {
        return {
            command: process.execPath,
            env: { ELECTRON_RUN_AS_NODE: '1' }
        }
    }

    return { command: process.execPath || (process.platform === 'win32' ? 'node.exe' : 'node'), env: {} }
}

class ZyraPiWorker {
    private child: ChildProcessWithoutNullStreams | null = null
    private lines: ReadlineInterface | null = null
    private nextId = 1
    private readonly pending = new Map<number, PendingBridgeRequest>()
    private readonly eventListeners = new Set<(event: unknown, metadata?: ZyraWorkerEventMetadata) => void>()
    private readonly controlAbortControllers = new Map<string, AbortController>()
    private controlRequestHandler: ((operation: unknown, signal: AbortSignal, principal?: unknown) => Promise<Record<string, unknown>>) | null = null
    private disposed = false

    constructor(
        private readonly root: string,
        private readonly bridgePath: string,
        private readonly cwd: string
    ) {}

    onEvent(listener: (event: unknown, metadata?: ZyraWorkerEventMetadata) => void): () => void {
        this.eventListeners.add(listener)
        return () => this.eventListeners.delete(listener)
    }

    setControlRequestHandler(handler: (operation: unknown, signal: AbortSignal, principal?: unknown) => Promise<Record<string, unknown>>): void {
        this.controlRequestHandler = handler
    }

    flushReplay(): void {}

    isAlive(): boolean {
        return Boolean(
            !this.disposed
            && this.child
            && this.child.exitCode === null
            && !this.child.killed
            && this.child.stdin.writable
        )
    }

    request(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        this.ensureStarted()
        if (!this.child?.stdin.writable) {
            return Promise.reject(new Error('Zyra bridge stdin is closed.'))
        }
        const id = this.nextId++
        return new Promise((resolveRequest, rejectRequest) => {
            this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
            this.child!.stdin.write(`${JSON.stringify({ id, type, payload })}\n`, (error) => {
                if (!error) return
                this.pending.delete(id)
                rejectRequest(error)
            })
        })
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        if (this.child?.stdin.writable) {
            this.child.stdin.write(`${JSON.stringify({ id: this.nextId++, type: 'dispose', payload: {} })}\n`)
        }
        this.lines?.close()
        this.child?.kill()
        this.child = null
        for (const controller of this.controlAbortControllers.values()) controller.abort()
        this.controlAbortControllers.clear()
        this.rejectPending(new Error('Zyra bridge disposed.'))
    }

    private ensureStarted(): void {
        if (this.child) return
        const nodeLaunch = resolveNodeLaunch()
        this.child = spawn(nodeLaunch.command, [this.bridgePath], {
            cwd: this.root,
            env: {
                ...process.env,
                ...nodeLaunch.env,
                ZYRA_ROOT: this.root,
                ZYRA_CALLER_CWD: this.cwd
            },
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        })
        this.child.stdout.setEncoding('utf8')
        this.child.stderr.setEncoding('utf8')
        this.lines = createInterface({ input: this.child.stdout })
        this.lines.on('line', (line) => this.handleLine(line))
        this.child.stderr.on('data', (chunk) => {
            const text = String(chunk).trim()
            if (text) log.warn('[ZyraPiRuntime] bridge stderr', text)
        })
        this.child.on('error', (error) => {
            this.rejectPending(error)
        })
        this.child.on('exit', (code, signal) => {
            const message = this.disposed
                ? 'Zyra bridge stopped.'
                : `Zyra bridge exited${code === null ? '' : ` with code ${code}`}${signal ? ` signal ${signal}` : ''}.`
            this.child = null
            this.rejectPending(new Error(message))
        })
    }

    private handleLine(line: string): void {
        let message: BridgeMessage
        try {
            message = JSON.parse(line) as BridgeMessage
        } catch {
            log.warn('[ZyraPiRuntime] bridge stdout', line)
            return
        }
        if (message.type === 'event') {
            for (const listener of this.eventListeners) listener(message.event)
            return
        }
        if (message.type === 'control.cancel' && message.requestId) {
            this.controlAbortControllers.get(message.requestId)?.abort()
            return
        }
        if (message.type === 'control.request' && message.requestId) {
            void this.handleControlRequest(message.requestId, message.operation, message.principal)
            return
        }
        if (message.type === 'protocol_error') {
            log.error('[ZyraPiRuntime] bridge protocol error', message.error)
            return
        }
        if (message.type !== 'response' || typeof message.id !== 'number') return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.ok) {
            pending.resolve(message.result || {})
            return
        }
        const error = new Error(message.error || 'Zyra bridge request failed.')
        if (message.stack) error.stack = message.stack
        pending.reject(error)
    }

    private async handleControlRequest(requestId: string, operation: unknown, principal?: unknown): Promise<void> {
        if (!this.child?.stdin.writable) return
        const controller = new AbortController()
        this.controlAbortControllers.set(requestId, controller)
        try {
            if (!this.controlRequestHandler) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Desktop control authority is not bound to this worker.')
            const result = await this.controlRequestHandler(operation, controller.signal, principal)
            this.child?.stdin.write(`${JSON.stringify({ type: 'control.response', requestId, ok: true, result })}\n`)
        } catch (error) {
            const controlError = toAgentControlError(error)
            this.child?.stdin.write(`${JSON.stringify({ type: 'control.response', requestId, ok: false, error: controlError.toWire() })}\n`)
        } finally {
            this.controlAbortControllers.delete(requestId)
        }
    }

    private rejectPending(error: Error): void {
        for (const controller of this.controlAbortControllers.values()) controller.abort()
        this.controlAbortControllers.clear()
        for (const pending of this.pending.values()) {
            pending.reject(error)
        }
        this.pending.clear()
    }
}

export class ZyraPiRuntime extends EventEmitter {
    private readonly sessions = new Map<string, ZyraSessionContext>()
    private readonly aliases = new Map<string, string>()
    private warmWorker: ZyraPiWorker | null = null
    private warmPromise: Promise<AssistantModelInfo[]> | null = null
    private warmWorkerKey: string | null = null
    private preparedPrivateVoiceWorker: PreparedPrivateVoiceWorker | null = null
    private modelCache: AssistantModelInfo[] = []
    private availabilityCache: { root: string; checkedAt: number; result: { available: boolean; reason: string | null } } | null = null
    private agentServerConnection: DesktopAgentServerConnection | null = null
    private unsubscribeCatalogChanged: (() => void) | null = null
    private desktopWorkspaceHandler: ((request: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null
    private desktopWorkspaceCancelHandler: ((requestId: string) => void) | null = null
    private desktopWorkspaceTurnHandler: ((canonicalChatId: string, turnId: string) => void) | null = null
    private detachedControlHandler: ((input: { canonicalChatId: string; turnId: string | null; operation: unknown; principal?: unknown; signal: AbortSignal }) => Promise<Record<string, unknown>>) | null = null
    private desktopWorkspaceTurnEndHandler: ((canonicalChatId: string, turnId: string) => void) | null = null
    private readonly privateVoiceThreadTargets = new Map<string, string>()
    private readonly privateVoiceWorkers = new Map<string, ZyraPiWorker>()
    private readonly privateApprovalWorkers = new Map<string, ZyraPiWorker>()

    setDesktopWorkspaceHandler(handler: ((request: Record<string, unknown>) => Promise<Record<string, unknown>>) | null, cancelHandler: ((requestId: string) => void) | null = null, turnHandler: ((canonicalChatId: string, turnId: string) => void) | null = null, detachedControlHandler: ((input: { canonicalChatId: string; turnId: string | null; operation: unknown; principal?: unknown; signal: AbortSignal }) => Promise<Record<string, unknown>>) | null = null, turnEndHandler: ((canonicalChatId: string, turnId: string) => void) | null = null): void {
        this.desktopWorkspaceCancelHandler = cancelHandler
        this.desktopWorkspaceTurnHandler = turnHandler
        this.detachedControlHandler = detachedControlHandler
        this.desktopWorkspaceTurnEndHandler = turnEndHandler
        this.desktopWorkspaceHandler = handler
        this.agentServerConnection?.setDesktopWorkspaceHandler(async (request) => {
            if (!this.desktopWorkspaceHandler) throw Object.assign(new Error('Desktop workspace routing is unavailable.'), { code: 'DESKTOP_WORKSPACE_UNAVAILABLE' })
            return this.desktopWorkspaceHandler(request)
        })
        this.agentServerConnection?.setDesktopWorkspaceCancelHandler((requestId) => this.desktopWorkspaceCancelHandler?.(requestId))
        this.agentServerConnection?.setDesktopWorkspaceTurnHandler((canonicalChatId, turnId) => this.desktopWorkspaceTurnHandler?.(canonicalChatId, turnId))
        this.agentServerConnection?.setDesktopWorkspaceTurnEndHandler((canonicalChatId, turnId) => this.desktopWorkspaceTurnEndHandler?.(canonicalChatId, turnId))
        this.agentServerConnection?.setDetachedControlHandler(async (input) => {
            if (!this.detachedControlHandler) throw Object.assign(new Error('Detached Browser control is unavailable.'), { code: 'CONTROL_DRIVER_UNAVAILABLE' })
            return this.detachedControlHandler(input)
        })
    }

    async checkAvailability(forceRefresh = false): Promise<{ available: boolean; reason: string | null }> {
        const root = resolveZyraRoot()
        if (
            !forceRefresh
            && this.availabilityCache?.root === root
            && (
                this.availabilityCache.result.available
                || Date.now() - this.availabilityCache.checkedAt < 30_000
            )
        ) return this.availabilityCache.result

        const remember = (result: { available: boolean; reason: string | null }) => {
            this.availabilityCache = { root, checkedAt: Date.now(), result }
            return result
        }
        const sdkPath = join(root, 'src', 'zyra-sdk.mjs')
        if (!existsSync(sdkPath)) {
            return remember({ available: false, reason: `Zyra SDK not found at ${sdkPath}` })
        }
        const bridgePath = resolveBridgePath(root)
        if (!existsSync(bridgePath)) {
            return remember({ available: false, reason: `Zyra UI bridge not found at ${bridgePath}` })
        }
        const agentServerClientPath = join(root, 'src', 'agent-server', 'client.mjs')
        if (!existsSync(agentServerClientPath)) {
            return remember({ available: false, reason: `Zyra agent-server client not found at ${agentServerClientPath}` })
        }
        // Electron is itself the Node host for the bridge. Do not synchronously
        // launch a second process here just to probe `--version`: Windows can
        // hold process creation behind security scanning, which would block the
        // Electron main loop and every renderer IPC call. The real bridge/server
        // launch remains authoritative and reports its own actionable error.
        return remember({ available: true, reason: null })
    }

    async listCanonicalChats(): Promise<CanonicalAgentChat[]> {
        return this.getAgentServerConnection(resolveZyraRoot()).listCanonicalChats()
    }

    async getCanonicalChat(session: string, project?: string): Promise<CanonicalAgentChat | null> {
        return this.getAgentServerConnection(resolveZyraRoot()).getCanonicalChat(session, project)
    }

    async readCanonicalChatHistory(
        session: string,
        project?: string,
        options: CanonicalAgentChatHistoryOptions = {}
    ): Promise<CanonicalAgentChatHistory | null> {
        return this.getAgentServerConnection(resolveZyraRoot()).readCanonicalChatHistory(session, project, options)
    }

    async readCanonicalHistoryEntryBody(
        session: string,
        project: string | undefined,
        ref: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> {
        return this.getAgentServerConnection(resolveZyraRoot()).readCanonicalHistoryEntryBody(session, project, ref)
    }

    async searchCanonicalToolOutputs(
        session: string,
        project: string | undefined,
        query: string,
        limit?: number
    ): Promise<Array<Record<string, unknown>>> {
        return this.getAgentServerConnection(resolveZyraRoot()).searchCanonicalToolOutputs(session, project, query, limit)
    }

    async appendCanonicalMessage(
        conversationId: string,
        message: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const normalizedConversationId = String(conversationId || '').trim()
        if (!normalizedConversationId) throw new Error('Canonical conversation id is required.')
        return this.getAgentServerConnection(resolveZyraRoot()).appendCanonicalMessage(normalizedConversationId, message)
    }

    async findCanonicalMessageReceipt(
        conversationId: string,
        operationId: string
    ): Promise<Record<string, unknown> | null> {
        const normalizedConversationId = String(conversationId || '').trim()
        const normalizedOperationId = String(operationId || '').trim()
        if (!normalizedConversationId || !normalizedOperationId) return null
        return this.getAgentServerConnection(resolveZyraRoot()).findCanonicalMessageReceipt(
            normalizedConversationId,
            normalizedOperationId
        )
    }

    async updateCanonicalChat(
        threadId: string,
        patch: { title?: string; project?: string; cwd?: string; archived?: boolean; deleted?: boolean }
    ): Promise<void> {
        const normalizedThreadId = String(threadId || '').trim()
        if (!normalizedThreadId) return
        await this.getAgentServerConnection(resolveZyraRoot()).updateCanonicalChat(normalizedThreadId, patch)
    }

    async listModelsWithProvenance(forceRefresh = false): Promise<{ models: AssistantModelInfo[]; authoritative: boolean }> {
        try {
            const availability = await this.checkAvailability(forceRefresh)
            if (!availability.available) return { models: fallbackZyraModels(), authoritative: false }
            const values = await this.getAgentServerConnection(resolveZyraRoot()).listModels(forceRefresh)
            const normalized = values.map(normalizeModelInfo).filter((model): model is AssistantModelInfo => Boolean(model))
            if (normalized.length > 0) {
                this.modelCache = normalized
                return { models: normalized, authoritative: true }
            }
            return {
                models: this.modelCache.length > 0 ? this.modelCache : fallbackZyraModels(),
                authoritative: false
            }
        } catch (error) {
            log.warn('[ZyraPiRuntime] failed to list Pi models', error)
            return { models: fallbackZyraModels(), authoritative: false }
        }
    }

    async listModels(forceRefresh = false): Promise<AssistantModelInfo[]> {
        return (await this.listModelsWithProvenance(forceRefresh)).models
    }

    async prewarm(forceRefresh = false): Promise<AssistantModelInfo[]> {
        return this.listModels(forceRefresh)
    }

    async generateText(
        prompt: string,
        options: { cwd: string; model?: string; effort?: AssistantReasoningEffort; timeoutMs?: number }
    ): Promise<{ success: boolean; text?: string; model?: string; error?: string }> {
        const normalizedPrompt = String(prompt || '').trim()
        if (!normalizedPrompt) return { success: false, error: 'Prompt is required.' }

        const availability = await this.checkAvailability()
        if (!availability.available) {
            return { success: false, error: availability.reason || 'Zyra Pi runtime is unavailable.' }
        }

        try {
            const timeoutMs = Math.max(1_000, Math.min(120_000, Number(options.timeoutMs) || 60_000))
            const result = await this.getAgentServerConnection(resolveZyraRoot()).generateText({
                prompt: normalizedPrompt,
                cwd: options.cwd,
                model: normalizeZyraModel(options.model),
                thinking: options.effort || 'low',
                timeoutMs
            }, timeoutMs)
            const text = asString(result['text'])
            if (!text) return { success: false, error: 'Zyra returned an empty utility response.' }
            return {
                success: true,
                text,
                model: asString(result['model']) || normalizeZyraModel(options.model)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Zyra utility text generation failed.'
            log.warn('[ZyraPiRuntime] utility text generation failed', message)
            return { success: false, error: message }
        }
    }

    async testChatGptUtilityConnection(model?: string): Promise<{ success: boolean; model?: string; error?: string }> {
        const availability = await this.checkAvailability()
        if (!availability.available) return { success: false, error: availability.reason || 'Zyra Pi runtime is unavailable.' }

        try {
            const root = resolveZyraRoot()
            const accountModuleUrl = pathToFileURL(join(root, 'src', 'chatgpt-account.mjs')).href
            const accountModule = await import(/* @vite-ignore */ accountModuleUrl) as {
                getChatGptAccountAuthStatus(): Promise<{ configured?: boolean }>
            }
            const authStatus = await accountModule.getChatGptAccountAuthStatus()
            if (authStatus.configured !== true) {
                return { success: false, error: 'Connect your ChatGPT account through Zyra before using this provider.' }
            }

            // This path reads Pi's authenticated model registry but deliberately
            // skips live model pings, so Test connection does not spend quota.
            const values = await this.getAgentServerConnection(root).listModels(false, true)
            const models = values
                .map(normalizeModelInfo)
                .filter((entry): entry is AssistantModelInfo => Boolean(entry))
                .filter((entry) => entry.id.startsWith('openai-codex/'))
            const requestedModel = normalizeZyraModel(String(model || '').trim())
            if (requestedModel && !models.some((entry) => entry.id === requestedModel)) {
                return { success: false, error: `ChatGPT model ${requestedModel} is not available through Pi.` }
            }
            if (models.length === 0) return { success: false, error: 'Pi did not report any authenticated ChatGPT models.' }
            return { success: true, model: requestedModel || models[0]?.id }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Could not verify ChatGPT through Pi.'
            }
        }
    }

    async connect(
        thread: AssistantThread,
        cwd: string,
        filesystemScope?: AssistantChatScope | null,
        pluginSkillSources: AssistantPluginSkillSource[] = []
    ): Promise<void> {
        const existingContext = this.getSessionContext(thread.id)
            || (thread.providerThreadId ? this.getSessionContext(thread.providerThreadId) : null)
        if (existingContext) {
            try {
                await this.ensureConnected(existingContext)
                return
            } catch (error) {
                this.releaseSessionContext(existingContext)
                throw error
            }
        }

        const availability = await this.checkAvailability()
        if (!availability.available) {
            throw new Error(availability.reason || 'Zyra Pi runtime is unavailable.')
        }

        const root = resolveZyraRoot()
        const worker = this.getAgentServerConnection(root).createWorker(
            cwd,
            thread.canonicalPresence?.latestSequence || 0
        )
        const providerThreadId = getAssistantCanonicalThreadId(thread)
        const model = normalizeZyraModel(thread.model) || 'openai-codex/gpt-5.5'
        const context: ZyraSessionContext = {
            localThreadId: thread.id,
            providerThreadId,
            resumeProviderThreadId: thread.providerThreadId || null,
            worker,
            connected: false,
            connectPromise: null,
            reconnectPromise: null,
            cwd,
            filesystemScope: filesystemScope || null,
            pluginSkillSources: structuredClone(pluginSkillSources),
            model,
            thinking: isAssistantReasoningEffort(thread.thinking)
                ? thread.thinking
                : (isAssistantReasoningEffort(thread.latestTurn?.effort) ? thread.latestTurn.effort : 'medium'),
            runtimeMode: thread.runtimeMode,
            interactionMode: 'default',
            profile: normalizeZyraProfile(thread.profile),
            webSearch: typeof thread.webSearch === 'boolean' ? thread.webSearch : null,
            webFetch: typeof thread.webFetch === 'boolean' ? thread.webFetch : null,
            activeTurnId: null,
            completedTurnIds: new Set(),
            terminalAssistantMessageOutcome: null,
            assistantMessageSequence: 0,
            activeAssistantItemId: null,
            usageAccountedAssistantMessageIds: new Set(),
            toolArgsByCallId: new Map(),
            toolStartedAtByCallId: new Map(),
            commandActivityIdByJobId: new Map(),
            runningManagedCommandJobIds: new Set(),
            assistantTextByItemId: new Map(),
            assistantCompletedItemIds: new Set(),
            internalTextByItemId: new Map(),
            internalCompletedItemIds: new Set(),
            activeCompaction: null,
            activeRetry: null,
            lastAssistantItemId: null,
            lastUsageTurnId: null,
            lastUsage: null,
            sessionUsage: null,
            fleetSnapshot: null
        }
        worker.setControlRequestHandler(async (operation, signal, principalValue) => {
            if (principalValue !== undefined) {
                const principal = assertControlPrincipal(principalValue)
                if (principal.type !== 'agent' || principal.parentThreadId !== context.localThreadId) {
                    throw new AgentControlError('CONTROL_PRINCIPAL_MISMATCH', 'The delegated control principal does not belong to this root thread.')
                }
                return getAgentControlBroker().handleToolOperation(principal, operation, signal)
            }
            const turnId = context.activeTurnId
            if (!turnId) throw new AgentControlError('CONTROL_PRINCIPAL_MISMATCH', 'Root control tools require an active root turn.')
            return getAgentControlBroker().handleToolOperation({
                type: 'root',
                threadId: context.localThreadId,
                turnId
            }, operation, signal, { permissionMode: context.runtimeMode })
        })
        context.unsubscribe = worker.onEvent((event, metadata) => this.handleZyraEvent(context, event, metadata))
        this.sessions.set(thread.id, context)
        this.sessions.set(providerThreadId, context)
        this.aliases.set(providerThreadId, thread.id)
        this.aliases.set(thread.id, thread.id)

        this.emitRuntime({
            eventId: randomUUID(),
            type: 'session.started',
            createdAt: nowIso(),
            threadId: thread.id,
            payload: {
                cwd,
                model,
                runtimeMode: thread.runtimeMode,
                interactionMode: 'default',
                profile: context.profile,
                webSearch: context.webSearch ?? undefined,
                webFetch: context.webFetch ?? undefined
            }
        })
        const attachmentState = thread.providerThreadId ? thread.state : 'starting'
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'thread.started',
            createdAt: nowIso(),
            threadId: thread.id,
            providerThreadId,
            payload: { providerThreadId, cwd, state: attachmentState }
        })
        if (!thread.providerThreadId) {
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'session.state.changed',
                createdAt: nowIso(),
                threadId: thread.id,
                providerThreadId,
                payload: { state: 'starting' }
            })
        }
        try {
            await this.ensureConnected(context)
        } catch (error) {
            if (this.getSessionContext(context.localThreadId) !== context) return
            const message = error instanceof Error ? error.message : 'Zyra session connection failed.'
            this.releaseSessionContext(context)
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'session.state.changed',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                payload: { state: 'error', error: message, message }
            })
            throw error
        }
    }

    hasSession(threadId: string): boolean {
        const context = this.getSessionContext(threadId)
        return Boolean(context?.connected && context.worker.isAlive())
    }

    getSessionUsage(threadId: string): AssistantSessionUsageTotals | null {
        return this.getSessionContext(threadId)?.sessionUsage || null
    }

    getFleetSnapshot(threadId: string): FleetSnapshot | null {
        return this.getSessionContext(threadId)?.fleetSnapshot || null
    }

    async configureSession(
        threadId: string,
        configuration: {
            model: string
            effort: AssistantReasoningEffort
            runtimeMode: AssistantRuntimeMode
            interactionMode: AssistantInteractionMode
            profile: string
        }
    ): Promise<void> {
        const context = this.requireSession(threadId)
        const model = normalizeZyraModel(configuration.model)
        if (!model) throw new Error('Assistant configuration requires a model.')
        const profile = normalizeZyraProfile(configuration.profile)
        const result = await context.worker.request('configure', {
            model,
            thinking: configuration.effort,
            runtimeMode: configuration.runtimeMode,
            interactionMode: 'default',
            profile
        })
        const config = asRecord(result['config']) || result
        context.model = normalizeZyraModel(asString(config['model']) || undefined) || model
        context.thinking = isAssistantReasoningEffort(config['thinking']) ? config['thinking'] : configuration.effort
        context.runtimeMode = isAssistantRuntimeMode(config['runtimeMode'])
            ? config['runtimeMode']
            : configuration.runtimeMode
        context.interactionMode = 'default'
        context.profile = normalizeZyraProfile(config['profile'] || profile)
    }

    async sendPrompt(
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
    ): Promise<{ turnId: string; providerThreadId: string | null }> {
        const context = this.requireSession(threadId)
        if (context.activeTurnId) {
            throw new Error('Zyra is already working in this thread.')
        }

        const turnId = randomUUID()
        context.activeTurnId = turnId
        context.completedTurnIds.delete(turnId)
        context.terminalAssistantMessageOutcome = null
        context.activeRetry = null
        context.assistantMessageSequence = 0
        context.activeAssistantItemId = null
        getUsageAccountedAssistantMessageIds(context).clear()
        context.toolArgsByCallId.clear()
        context.toolStartedAtByCallId.clear()
        context.assistantTextByItemId.clear()
        context.assistantCompletedItemIds.clear()
        context.internalTextByItemId.clear()
        context.internalCompletedItemIds.clear()
        context.lastAssistantItemId = null
        context.lastUsageTurnId = turnId
        context.lastUsage = null
        context.model = normalizeZyraModel(options?.model) || context.model
        context.thinking = options?.effort || context.thinking
        context.runtimeMode = options?.runtimeMode || context.runtimeMode
        context.interactionMode = 'default'
        context.profile = normalizeZyraProfile(options?.profile || context.profile)
        try { getAgentControlBroker().materializeUserAuthorizedBrowserGrant(threadId, turnId) }
        catch { /* A stale optional TUI Browser intent must never block the canonical turn. */ }

        this.emitRuntime({
            eventId: randomUUID(),
            type: 'turn.started',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId,
            payload: {
                model: context.model,
                interactionMode: context.interactionMode,
                profile: context.profile,
                effort: options?.effort,
                serviceTier: options?.serviceTier
            }
        })

        void this.runPromptTurn(context, turnId, prompt, options)
        return { turnId, providerThreadId: context.providerThreadId }
    }

    async preparePrivateVoiceTask(input: PrivateVoiceTaskPreparationInput): Promise<void> {
        const startedAt = Date.now()
        const root = resolveZyraRoot()
        const bridgePath = resolveBridgePath(root)
        const configuration = resolvePrivateVoiceTaskConfiguration(input)
        const key = getPrivateVoiceWorkerKey(root, bridgePath, configuration)
        const current = this.preparedPrivateVoiceWorker
        if (current?.key === key) {
            if (!current.claimed) {
                try {
                    await current.connectPromise
                } catch (error) {
                    if (this.preparedPrivateVoiceWorker !== current) return
                    throw error
                }
            }
            log.info('[AssistantVoiceTiming] Primary worker ready', {
                threadId: configuration.localThreadId,
                reused: true,
                claimed: current.claimed,
                durationMs: Date.now() - startedAt
            })
            return
        }
        if (current?.claimed) return
        this.disposePreparedPrivateVoiceTask()

        const worker = new ZyraPiWorker(root, bridgePath, configuration.cwd)
        const privateThreadId = `voice-private:prepared:${randomUUID()}`
        const prepared: PreparedPrivateVoiceWorker = {
            key,
            privateThreadId,
            worker,
            connectPromise: worker.request('connect', getPrivateVoiceConnectPayload(configuration, privateThreadId)),
            claimed: false
        }
        this.preparedPrivateVoiceWorker = prepared
        try {
            await prepared.connectPromise
            log.info('[AssistantVoiceTiming] Primary worker ready', {
                threadId: configuration.localThreadId,
                reused: false,
                claimed: false,
                durationMs: Date.now() - startedAt
            })
        } catch (error) {
            const cancelled = this.preparedPrivateVoiceWorker !== prepared
            if (!cancelled) this.preparedPrivateVoiceWorker = null
            worker.dispose()
            if (cancelled) return
            throw error
        }
    }

    disposePreparedPrivateVoiceTask(): void {
        const prepared = this.preparedPrivateVoiceWorker
        if (!prepared) return
        this.preparedPrivateVoiceWorker = null
        prepared.worker.dispose()
    }

    private async claimPreparedPrivateVoiceWorker(
        root: string,
        bridgePath: string,
        configuration: ResolvedPrivateVoiceTaskConfiguration,
        signal: AbortSignal
    ): Promise<ClaimedPrivateVoiceWorker | null> {
        const prepared = this.preparedPrivateVoiceWorker
        if (!prepared) return null
        const key = getPrivateVoiceWorkerKey(root, bridgePath, configuration)
        if (prepared.key !== key) {
            if (!prepared.claimed) this.disposePreparedPrivateVoiceTask()
            return null
        }
        if (prepared.claimed) return null

        prepared.claimed = true
        const abort = () => {
            if (this.preparedPrivateVoiceWorker === prepared) this.preparedPrivateVoiceWorker = null
            prepared.worker.dispose()
        }
        signal.addEventListener('abort', abort, { once: true })
        try {
            const connected = await prepared.connectPromise
            if (signal.aborted) throw signal.reason || new Error('Private Voice task cancelled.')
            if (this.preparedPrivateVoiceWorker !== prepared) return null
            return {
                prepared,
                privateThreadId: prepared.privateThreadId,
                worker: prepared.worker,
                connected
            }
        } catch (error) {
            if (this.preparedPrivateVoiceWorker === prepared) this.preparedPrivateVoiceWorker = null
            prepared.worker.dispose()
            if (signal.aborted) throw signal.reason || error
            log.warn('[ZyraPiRuntime] prepared Voice worker failed; falling back to a fresh worker', error)
            return null
        } finally {
            signal.removeEventListener('abort', abort)
        }
    }

    async runPrivateVoiceTask(input: PrivateVoiceTaskInput): Promise<PrivateVoiceTaskResult> {
        if (input.signal.aborted) throw input.signal.reason || new Error('Private Voice task cancelled.')
        if (this.privateVoiceWorkers.has(input.taskId)) throw new Error(`Private Voice task ${input.taskId} is already running.`)
        const taskStartedAt = Date.now()
        const root = resolveZyraRoot()
        const bridgePath = resolveBridgePath(root)
        const configuration = resolvePrivateVoiceTaskConfiguration(input)
        const prepared = await this.claimPreparedPrivateVoiceWorker(root, bridgePath, configuration, input.signal)
        if (input.signal.aborted) throw input.signal.reason || new Error('Private Voice task cancelled.')
        const worker = prepared?.worker || new ZyraPiWorker(root, bridgePath, configuration.cwd)
        const privateThreadId = prepared?.privateThreadId || `voice-private:${input.taskId}`
        const { model, effort, runtimeMode, interactionMode, profile } = configuration
        const context: ZyraSessionContext = {
            localThreadId: privateThreadId,
            providerThreadId: privateThreadId,
            resumeProviderThreadId: null,
            worker: worker as unknown as ZyraWorkerLike,
            connected: true,
            connectPromise: null,
            reconnectPromise: null,
            cwd: configuration.cwd,
            pluginSkillSources: [],
            model,
            thinking: effort,
            runtimeMode,
            interactionMode,
            profile,
            webSearch: null,
            webFetch: null,
            activeTurnId: input.taskId,
            completedTurnIds: new Set(),
            terminalAssistantMessageOutcome: null,
            assistantMessageSequence: 0,
            activeAssistantItemId: null,
            usageAccountedAssistantMessageIds: new Set(),
            toolArgsByCallId: new Map(),
            toolStartedAtByCallId: new Map(),
            commandActivityIdByJobId: new Map(),
            runningManagedCommandJobIds: new Set(),
            assistantTextByItemId: new Map(),
            assistantCompletedItemIds: new Set(),
            internalTextByItemId: new Map(),
            internalCompletedItemIds: new Set(),
            activeCompaction: null,
            activeRetry: null,
            lastAssistantItemId: null,
            lastUsageTurnId: input.taskId,
            lastUsage: null,
            sessionUsage: null,
            fleetSnapshot: null
        }
        this.privateVoiceThreadTargets.set(privateThreadId, input.localThreadId)
        this.privateVoiceWorkers.set(input.taskId, worker)
        const unsubscribe = worker.onEvent((eventValue) => {
            const event = asRecord(eventValue)
            const type = asString(event?.['type'])
            const requestId = asString(event?.['requestId'])
            if (type === 'approval_requested' && requestId) this.privateApprovalWorkers.set(requestId, worker)
            if (type === 'approval_resolved' && requestId) this.privateApprovalWorkers.delete(requestId)
            this.handleZyraEvent(context, eventValue)
        })
        const abort = () => {
            void worker.request('abort').catch(() => undefined)
        }
        input.signal.addEventListener('abort', abort, { once: true })
        let promptStartedAt: number | null = null
        let completedSuccessfully = false
        try {
            const connected = prepared?.connected
                || await worker.request('connect', getPrivateVoiceConnectPayload(configuration, privateThreadId))
            context.providerThreadId = String(connected['threadId'] || connected['providerThreadId'] || privateThreadId)
            promptStartedAt = Date.now()
            await worker.request('prompt', {
                prompt: input.prompt,
                turnId: input.taskId,
                model,
                thinking: effort,
                profile,
                runtimeMode,
                interactionMode,
                serviceTier: input.serviceTier,
                reasoningSummary: 'auto',
                skipTitleGeneration: true
            })
            if (input.signal.aborted) throw input.signal.reason || new Error('Private Voice task cancelled.')
            if (context.runningManagedCommandJobIds.size > 0) {
                const occurredAt = nowIso()
                for (const jobId of context.runningManagedCommandJobIds) {
                    this.emitRuntime({
                        eventId: randomUUID(),
                        type: 'activity',
                        createdAt: occurredAt,
                        threadId: context.localThreadId,
                        providerThreadId: context.providerThreadId,
                        turnId: input.taskId,
                        payload: {
                            activityId: context.commandActivityIdByJobId.get(jobId),
                            kind: 'command',
                            summary: 'Command stopped',
                            tone: 'warning',
                            data: { status: 'stopped', jobId, completedAt: occurredAt }
                        }
                    })
                }
                throw new Error('The agent returned before its command finished, so the unfinished command was stopped.')
            }
            const text = (
                (context.lastAssistantItemId ? context.assistantTextByItemId.get(context.lastAssistantItemId) : null)
                || [...context.assistantTextByItemId.values()].filter((value) => value.trim()).at(-1)
                || ''
            ).trim()
            if (!text) throw new Error('The strong agent completed without a Voice-ready result.')
            completedSuccessfully = true
            return {
                taskId: input.taskId,
                text,
                providerSessionId: context.providerThreadId
            }
        } finally {
            const finishedAt = Date.now()
            const canReusePreparedWorker = Boolean(
                completedSuccessfully
                && prepared
                && this.preparedPrivateVoiceWorker === prepared.prepared
                && worker.isAlive()
                && !input.signal.aborted
            )
            if (canReusePreparedWorker && prepared) {
                prepared.prepared.claimed = false
            } else {
                if (prepared && this.preparedPrivateVoiceWorker === prepared.prepared) {
                    this.preparedPrivateVoiceWorker = null
                }
                worker.dispose()
            }
            log.info('[AssistantVoiceTiming] Primary task finished', {
                threadId: input.localThreadId,
                taskId: input.taskId,
                workerCache: prepared ? 'hit' : 'miss',
                workerReadyMs: promptStartedAt === null ? null : promptStartedAt - taskStartedAt,
                modelAndToolsMs: promptStartedAt === null ? null : finishedAt - promptStartedAt,
                totalMs: finishedAt - taskStartedAt,
                reusable: canReusePreparedWorker,
                outcome: completedSuccessfully ? 'completed' : input.signal.aborted ? 'cancelled' : 'failed'
            })
            input.signal.removeEventListener('abort', abort)
            unsubscribe()
            this.privateVoiceWorkers.delete(input.taskId)
            this.privateVoiceThreadTargets.delete(privateThreadId)
            for (const [requestId, requestWorker] of this.privateApprovalWorkers) {
                if (requestWorker === worker) this.privateApprovalWorkers.delete(requestId)
            }
        }
    }

    resolvePrivateVoiceTargetThread(threadId: string): string | null {
        return this.privateVoiceThreadTargets.get(threadId) || null
    }

    async requestFleetOperation(threadId: string, namespace: 'agents' | 'workflows', action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const context = this.requireSession(threadId)
        await this.ensureConnected(context)
        return context.worker.request(`${namespace}.${action}`, payload)
    }

    async interruptTurn(threadId: string): Promise<void> {
        const context = this.requireSession(threadId)
        if (context.activeTurnId) {
            getAgentControlBroker().revokePrincipal({ type: 'root', threadId: context.localThreadId, turnId: context.activeTurnId })
        }
        await context.worker.request('abort').catch((error) => {
            log.warn('[ZyraPiRuntime] bridge abort failed', error)
        })
        if (!context.activeTurnId) return
        const interruptedTurnId = context.activeTurnId
        markTurnCompleted(context, interruptedTurnId)
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'turn.completed',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId: interruptedTurnId,
            payload: { outcome: 'interrupted' }
        })
        context.activeTurnId = null
    }

    async rollbackThread(): Promise<void> {
        return
    }

    async respondApproval(threadId: string, requestId: string, decision: AssistantApprovalDecision): Promise<void> {
        const privateWorker = this.privateApprovalWorkers.get(requestId)
        if (privateWorker) {
            await privateWorker.request('approval.respond', { requestId, decision })
            return
        }
        const context = this.requireSession(threadId)
        await this.ensureConnected(context)
        await context.worker.request('approval.respond', { requestId, decision })
    }

    async respondUserInput(
        threadId: string,
        requestId: string,
        answers: Record<string, string | string[]>,
        questions: AssistantUserInputQuestion[] = []
    ): Promise<{ continuationPrompt: string | null }> {
        const context = this.requireSession(threadId)
        await this.ensureConnected(context)
        const result = await context.worker.request('user_input.respond', { requestId, questions, answers, cancelled: false })
        const deadline = Date.now() + 5_000
        while (context.activeTurnId && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        if (context.activeTurnId) {
            throw new Error('The question handoff is still finishing. Try submitting the answers again.')
        }
        return { continuationPrompt: asString(result['continuationPrompt']) || null }
    }

    private releaseSessionContext(context: ZyraSessionContext): void {
        for (const threadId of new Set([context.localThreadId, context.providerThreadId])) {
            if (this.sessions.get(threadId) !== context) continue
            this.sessions.delete(threadId)
            this.aliases.delete(threadId)
        }
        if (typeof context.unsubscribe === 'function') context.unsubscribe()
        context.worker.dispose()
    }

    async updatePluginAuthority(input: PluginAuthorityUpdate, affectedThreadIds: string[] = []): Promise<void> {
        const chatIds = new Set(input.chats.map((chat) => chat.sessionKey))
        const affected = [...new Set(this.sessions.values())].filter((context) =>
            chatIds.has(context.localThreadId) || chatIds.has(context.providerThreadId)
            || input.state === 'disabled' && context.pluginSkillSources.some((source) => source.pluginId === input.pluginId))
        try {
            await this.getAgentServerConnection(resolveZyraRoot()).updatePluginAuthority(input)
        } finally {
            // Do not reuse a context whose Skill instructions predate this mutation,
            // even when cleanup failed and the server has left authority blocked.
            const controlThreadIds = new Set([...affectedThreadIds, ...chatIds, ...affected.map((context) => context.localThreadId)])
            if (controlThreadIds.size) revokePluginChatControl(getAgentControlBroker(), controlThreadIds)
            for (const context of affected) this.disconnect(context.localThreadId)
        }
    }

    disconnect(threadId: string): void {
        const context = this.getSessionContext(threadId)
        if (!context) return
        if (context.activeTurnId) {
            getAgentControlBroker().revokePrincipal(
                { type: 'root', threadId: context.localThreadId, turnId: context.activeTurnId },
                'Root Browser control ended when its session disconnected.'
            )
        }
        this.releaseSessionContext(context)
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'session.state.changed',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            payload: { state: 'stopped', message: 'Zyra session disconnected.' }
        })
    }

    dispose(): void {
        this.disposePreparedPrivateVoiceTask()
        for (const worker of this.privateVoiceWorkers.values()) worker.dispose()
        this.privateVoiceWorkers.clear()
        this.privateVoiceThreadTargets.clear()
        this.privateApprovalWorkers.clear()
        for (const threadId of [...this.sessions.keys()]) {
            this.disconnect(threadId)
        }
        this.disposeWarmWorker()
        this.unsubscribeCatalogChanged?.()
        this.unsubscribeCatalogChanged = null
        this.agentServerConnection?.close()
        this.agentServerConnection = null
    }

    private getAgentServerConnection(root: string): DesktopAgentServerConnection {
        if (!this.agentServerConnection) {
            this.agentServerConnection = new DesktopAgentServerConnection(root, {
                openDesktopWorkspace: async (request) => {
                    if (!this.desktopWorkspaceHandler) throw Object.assign(new Error('Desktop workspace routing is unavailable.'), { code: 'DESKTOP_WORKSPACE_UNAVAILABLE' })
                    return this.desktopWorkspaceHandler(request)
                },
                cancelDesktopWorkspace: (requestId) => this.desktopWorkspaceCancelHandler?.(requestId),
                handleDesktopWorkspaceTurn: (canonicalChatId, turnId) => this.desktopWorkspaceTurnHandler?.(canonicalChatId, turnId),
                handleDesktopWorkspaceTurnEnded: (canonicalChatId, turnId) => this.desktopWorkspaceTurnEndHandler?.(canonicalChatId, turnId),
                handleDetachedControl: async (input) => {
                    if (!this.detachedControlHandler) throw Object.assign(new Error('Detached Browser control is unavailable.'), { code: 'CONTROL_DRIVER_UNAVAILABLE' })
                    return this.detachedControlHandler(input)
                }
            })
            this.unsubscribeCatalogChanged = this.agentServerConnection.onCatalogChanged((change) => this.emit('catalog.changed', change))
        }
        return this.agentServerConnection
    }

    private async ensureWarmWorker(root: string, forceRefresh = false): Promise<AssistantModelInfo[]> {
        const bridgePath = resolveBridgePath(root)
        const key = `${root}|${bridgePath}`
        if (!this.warmWorker || this.warmWorkerKey !== key) {
            this.disposeWarmWorker()
            this.warmWorker = new ZyraPiWorker(root, bridgePath, root)
            this.warmWorkerKey = key
        }
        if (this.warmPromise && !forceRefresh) return this.warmPromise

        const worker = this.warmWorker
        this.warmPromise = worker.request('warmup', { forceRefresh })
            .then((result) => {
                const models = Array.isArray(result['models'])
                    ? result['models'].map(normalizeModelInfo).filter((model): model is AssistantModelInfo => Boolean(model))
                    : []
                if (models.length > 0) this.modelCache = models
                return models.length > 0 ? models : this.modelCache
            })
            .catch((error) => {
                if (this.warmWorker === worker) this.disposeWarmWorker()
                throw error
            })
        return this.warmPromise
    }

    private async claimWarmWorker(
        root: string,
        bridgePath: string,
        _cwd: string
    ): Promise<ZyraPiWorker | null> {
        const key = `${root}|${bridgePath}`
        if (!this.warmWorker || this.warmWorkerKey !== key) return null
        const worker = this.warmWorker
        try {
            await this.warmPromise
        } catch {
            return null
        }
        if (this.warmWorker !== worker) return null
        this.warmWorker = null
        this.warmPromise = null
        this.warmWorkerKey = null
        void this.ensureWarmWorker(root, false).catch((error) => {
            log.warn('[ZyraPiRuntime] replacement worker prewarm failed', error)
        })
        return worker
    }

    private disposeWarmWorker(): void {
        this.warmWorker?.dispose()
        this.warmWorker = null
        this.warmPromise = null
        this.warmWorkerKey = null
    }

    private async runPromptTurn(
        context: ZyraSessionContext,
        turnId: string,
        prompt: string,
        options?: {
            effort?: AssistantReasoningEffort
            serviceTier?: 'fast'
            images?: PreparedAssistantPromptImage[]
            reasoningSummary?: AssistantRuntimePolicy['reasoningSummary']
            contextCompactionThresholdTokens?: number
        }
    ): Promise<void> {
        let preserveServerOwnedTurn = false
        try {
            await this.ensureConnected(context)
            await context.worker.request('prompt', {
                prompt,
                turnId,
                model: context.model,
                thinking: context.thinking,
                profile: context.profile,
                runtimeMode: context.runtimeMode,
                webSearch: context.webSearch ?? undefined,
                webFetch: context.webFetch ?? undefined,
                images: options?.images,
                reasoningSummary: options?.reasoningSummary,
                contextCompactionThresholdTokens: options?.contextCompactionThresholdTokens,
                skipTitleGeneration: true
            })
            if (context.activeTurnId !== turnId) return
            if (context.worker.serverOwnedLifecycle) return
            this.completeAssistantText(context, turnId)
            markTurnCompleted(context, turnId)
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'turn.completed',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId,
                payload: {
                    outcome: 'completed',
                    effort: options?.effort,
                    serviceTier: options?.serviceTier,
                    usage: buildCompletedTurnUsage(context)
                }
            })
        } catch (error) {
            if (context.activeTurnId !== turnId) return
            const message = error instanceof Error ? error.message : 'Zyra prompt failed.'
            const transportFailed = isAssistantTransportFailure(error)
            if (transportFailed) context.connected = false
            if (transportFailed && context.worker.serverOwnedLifecycle) {
                preserveServerOwnedTurn = true
                log.warn('[ZyraPiRuntime] Desktop transport detached while the canonical turn remains server-owned', {
                    threadId: context.localThreadId,
                    turnId,
                    error: message
                })
                this.reconnectDetachedSession(context)
                return
            }
            if (isExpectedBridgeDisposalError(error)) {
                if (context.activeTurnId === turnId) context.activeTurnId = null
                markTurnCompleted(context, turnId)
                log.info('[ZyraPiRuntime] prompt interrupted by bridge disposal')
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'turn.completed',
                    createdAt: nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId: context.providerThreadId,
                    turnId,
                    payload: { outcome: 'interrupted' }
                })
                return
            }
            log.error('[ZyraPiRuntime] prompt failed', error)
            markTurnCompleted(context, turnId)
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'turn.completed',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId,
                payload: {
                    outcome: 'failed',
                    errorMessage: message
                }
            })
            const sessionState = context.connected && context.worker.isAlive() ? 'ready' : 'error'
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'session.state.changed',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId,
                payload: { state: sessionState, error: message, message }
            })
        } finally {
            if (!preserveServerOwnedTurn && context.activeTurnId === turnId) {
                getAgentControlBroker().revokePrincipal(
                    { type: 'root', threadId: context.localThreadId, turnId },
                    'Root Browser control ended with its turn.'
                )
                context.activeTurnId = null
            }
        }
    }

    private async ensureConnected(context: ZyraSessionContext): Promise<void> {
        if (context.connected && context.worker.isAlive()) return
        if (context.connectPromise) return context.connectPromise

        context.connected = false
        const pending = (async () => {
            const shouldResumeProviderSession = Boolean(context.resumeProviderThreadId)
            const requestedThreadId = shouldResumeProviderSession ? context.resumeProviderThreadId || undefined : undefined
            let result: Record<string, unknown>
            try {
                result = await context.worker.request('connect', {
                    cwd: context.cwd,
                    filesystemScope: context.filesystemScope || undefined,
                    pluginSkillSources: context.pluginSkillSources,
                    localThreadId: context.localThreadId,
                    threadId: requestedThreadId,
                    providerThreadId: requestedThreadId,
                    noSession: false,
                    model: context.model,
                    thinking: context.thinking,
                    profile: context.profile,
                    runtimeMode: context.runtimeMode,
                    webSearch: context.webSearch ?? undefined,
                    webFetch: context.webFetch ?? undefined
                })
            } catch (error) {
                if (this.getSessionContext(context.localThreadId) !== context) return
                throw error
            }
            if (this.getSessionContext(context.localThreadId) !== context) return
            const previousProviderThreadId = context.providerThreadId
            const providerThreadId = String(result['threadId'] || result['providerThreadId'] || context.resumeProviderThreadId || context.providerThreadId || randomUUID())
            const model = String(result['model'] || context.model)
            const thinking = isAssistantReasoningEffort(result['thinking']) ? result['thinking'] : context.thinking
            const profile = normalizeZyraProfile(result['profile'] || context.profile)
            const runtimeMode: AssistantRuntimeMode = isAssistantRuntimeMode(result['runtimeMode'])
                ? result['runtimeMode']
                : context.runtimeMode
            const webSearch = typeof result['webSearch'] === 'boolean' ? result['webSearch'] : context.webSearch
            const webFetch = typeof result['webFetch'] === 'boolean' ? result['webFetch'] : context.webFetch
            const agentServerActiveTurnId = asString(result['agentServerActiveTurnId'])
            const agentServerLatestTurnId = asString(result['agentServerLatestTurnId'])
            const agentServerOrphanedTurnId = asString(result['agentServerOrphanedTurnId'])
            context.providerThreadId = providerThreadId
            context.resumeProviderThreadId = providerThreadId
            context.model = model
            context.thinking = thinking
            context.profile = profile
            context.runtimeMode = runtimeMode
            context.webSearch = webSearch
            context.webFetch = webFetch
            context.sessionUsage = readSessionUsage(
                result['usage'],
                result['contextUsage'],
                context.localThreadId,
                result['autoCompactionEnabled']
            )
            context.connected = true
            if (agentServerActiveTurnId && !context.activeTurnId) context.activeTurnId = agentServerActiveTurnId
            const connectedFleet = asRecord(result['fleet']) as unknown as FleetSnapshot | null
            if (connectedFleet) {
                context.fleetSnapshot = connectedFleet
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'fleet.snapshot.updated',
                    createdAt: nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId,
                    payload: { eventType: 'fleet_snapshot', event: { type: 'fleet_snapshot' }, snapshot: connectedFleet }
                })
            }
            this.sessions.set(context.localThreadId, context)
            this.sessions.set(providerThreadId, context)
            this.aliases.set(providerThreadId, context.localThreadId)
            this.aliases.set(context.localThreadId, context.localThreadId)
            if (
                previousProviderThreadId
                && previousProviderThreadId !== providerThreadId
                && previousProviderThreadId !== context.localThreadId
            ) {
                this.sessions.delete(previousProviderThreadId)
                this.aliases.delete(previousProviderThreadId)
            }
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'session.config.updated',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId,
                payload: {
                    model,
                    thinking,
                    profile,
                    runtimeMode,
                    webSearch: webSearch ?? undefined,
                    webFetch: webFetch ?? undefined
                }
            })
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'thread.started',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId,
                payload: { providerThreadId, cwd: context.cwd, state: agentServerActiveTurnId ? 'running' : 'ready' }
            })
            if (agentServerOrphanedTurnId && !context.completedTurnIds.has(agentServerOrphanedTurnId)) {
                markTurnCompleted(context, agentServerOrphanedTurnId)
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'turn.completed',
                    createdAt: nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId,
                    turnId: agentServerOrphanedTurnId,
                    payload: { outcome: 'interrupted', usage: buildCompletedTurnUsage(context) }
                })
                if (context.activeTurnId === agentServerOrphanedTurnId) context.activeTurnId = null
            }
            context.worker.flushReplay()
            const attachedUsage = buildLiveAssistantTurnUsage(context)
            if (attachedUsage && agentServerLatestTurnId) {
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'thread.token-usage.updated',
                    createdAt: nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId,
                    turnId: agentServerLatestTurnId,
                    payload: { usage: attachedUsage }
                })
            }
        })()
        context.connectPromise = pending

        try {
            await pending
        } finally {
            if (context.connectPromise === pending) context.connectPromise = null
        }
    }

    private reconnectDetachedSession(context: ZyraSessionContext): void {
        if (context.reconnectPromise) return
        const retryTurnId = context.activeTurnId
        const pending = (async () => {
            let lastError = 'Network connection unavailable.'
            for (let attempt = 1; attempt <= ZYRA_RETRY_MAX_ATTEMPTS; attempt += 1) {
                if (this.getSessionContext(context.localThreadId) !== context) return
                if (retryTurnId) {
                    this.handleZyraEvent(context, {
                        type: 'auto_retry_start',
                        attempt,
                        maxAttempts: ZYRA_RETRY_MAX_ATTEMPTS,
                        delayMs: Math.min(5_000, 250 * attempt),
                        errorMessage: lastError,
                        recoveryKind: 'network'
                    }, { turnId: retryTurnId })
                }
                try {
                    await this.ensureConnected(context)
                    if (retryTurnId) {
                        this.handleZyraEvent(context, {
                            type: 'auto_retry_end',
                            success: true,
                            attempt,
                            recoveryKind: 'network'
                        }, { turnId: retryTurnId })
                    }
                    return
                } catch (error) {
                    lastError = error instanceof Error ? error.message : String(error || lastError)
                    if (attempt === 1 || attempt === ZYRA_RETRY_MAX_ATTEMPTS) {
                        log.warn('[ZyraPiRuntime] Retrying canonical agent-server attachment', {
                            threadId: context.localThreadId,
                            turnId: retryTurnId,
                            attempt,
                            maxAttempts: ZYRA_RETRY_MAX_ATTEMPTS,
                            error
                        })
                    }
                    if (attempt < ZYRA_RETRY_MAX_ATTEMPTS) {
                        await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 250 * attempt)))
                    }
                }
            }
            if (retryTurnId) {
                this.handleZyraEvent(context, {
                    type: 'auto_retry_end',
                    success: false,
                    attempt: ZYRA_RETRY_MAX_ATTEMPTS,
                    finalError: lastError,
                    recoveryKind: 'network'
                }, { turnId: retryTurnId })
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'session.state.changed',
                    createdAt: nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId: context.providerThreadId,
                    turnId: retryTurnId,
                    payload: { state: 'error', error: 'Network issue', message: 'Network issue' }
                })
            }
        })()
        context.reconnectPromise = pending
        void pending.finally(() => {
            if (context.reconnectPromise === pending) context.reconnectPromise = null
        })
    }

    private handleZyraEvent(context: ZyraSessionContext, eventValue: unknown, metadata?: ZyraWorkerEventMetadata): void {
        const event = asRecord(eventValue)
        if (!event) return
        const type = asString(event['type'])
        if (!type) return
        if (type === 'server.transport.detached') {
            context.connected = false
            context.connectPromise = null
            this.reconnectDetachedSession(context)
            return
        }
        const sessionUsage = readSessionUsage(
            event['sessionUsage'],
            event['contextUsage'],
            context.localThreadId,
            event['autoCompactionEnabled']
        )
        if (sessionUsage && metadata?.replay !== true) context.sessionUsage = sessionUsage
        if (type === 'session_config') {
            const model = asString(event['model']) || context.model
            const thinking = isAssistantReasoningEffort(event['thinking']) ? event['thinking'] : context.thinking
            const profile = normalizeZyraProfile(event['profile'] || context.profile)
            const runtimeMode: AssistantRuntimeMode = isAssistantRuntimeMode(event['runtimeMode'])
                ? event['runtimeMode']
                : context.runtimeMode
            const webSearch = typeof event['webSearch'] === 'boolean' ? event['webSearch'] : context.webSearch
            const webFetch = typeof event['webFetch'] === 'boolean' ? event['webFetch'] : context.webFetch
            context.model = model
            context.thinking = thinking
            context.profile = profile
            context.runtimeMode = runtimeMode
            context.webSearch = webSearch
            context.webFetch = webFetch
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'session.config.updated',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                payload: {
                    model,
                    thinking,
                    profile,
                    runtimeMode,
                    webSearch: webSearch ?? undefined,
                    webFetch: webFetch ?? undefined
                }
            })
            return
        }
        const observedTurnId = metadata?.turnId
        if (
            observedTurnId
            && metadata?.replay !== true
            && context.activeTurnId !== observedTurnId
            && !context.completedTurnIds.has(observedTurnId)
        ) {
            context.activeTurnId = observedTurnId
            context.terminalAssistantMessageOutcome = null
            context.activeRetry = null
            context.assistantMessageSequence = 0
            context.activeAssistantItemId = null
            getUsageAccountedAssistantMessageIds(context).clear()
            context.toolArgsByCallId.clear()
            context.toolStartedAtByCallId.clear()
            context.assistantTextByItemId.clear()
            context.assistantCompletedItemIds.clear()
            context.internalTextByItemId.clear()
            context.internalCompletedItemIds.clear()
            context.lastAssistantItemId = null
            context.lastUsageTurnId = observedTurnId
            context.lastUsage = null
            try { getAgentControlBroker().materializeUserAuthorizedBrowserGrant(context.localThreadId, observedTurnId) } catch {}
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'turn.started',
                createdAt: asString(event['timestamp']) || nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: observedTurnId,
                payload: {
                    model: context.model,
                    interactionMode: context.interactionMode,
                    profile: context.profile
                }
            })
        }
        const turnId = observedTurnId || context.activeTurnId

        if ((type === 'zyra_server_turn_completed' || (type === 'agent_end' && event['willRetry'] !== true)) && turnId) {
            if (context.completedTurnIds.has(turnId)) return
            const terminalMessageOutcome = context.terminalAssistantMessageOutcome?.turnId === turnId
                ? context.terminalAssistantMessageOutcome
                : null
            const exhaustedNetworkRetry = type === 'agent_end'
                && context.activeRetry?.turnId === turnId
                && context.activeRetry.recoveryKind === 'network'
                && context.activeRetry.attempt >= context.activeRetry.maxAttempts
            const outcome = exhaustedNetworkRetry
                ? 'interrupted'
                : resolveZyraTerminalOutcome(type, event, terminalMessageOutcome)
            markTurnCompleted(context, turnId)
            this.completeAssistantText(context, turnId)
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'turn.completed',
                createdAt: asString(event['timestamp']) || nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId,
                sourceSequence: metadata?.sequence,
                payload: {
                    outcome,
                    ...(outcome === 'failed' ? {
                        errorMessage: terminalMessageOutcome?.errorMessage || asString(event['errorMessage']) || 'Zyra prompt failed.'
                    } : {}),
                    usage: buildCompletedTurnUsage(context)
                }
            })
            if (terminalMessageOutcome) context.terminalAssistantMessageOutcome = null
            if (context.activeTurnId === turnId) {
                getAgentControlBroker().revokePrincipal(
                    { type: 'root', threadId: context.localThreadId, turnId },
                    'Root Browser control ended with its turn.'
                )
                context.activeTurnId = null
            }
            return
        }

        if (type === 'fleet_snapshot' || type.startsWith('agent.') || type.startsWith('workflow.')) {
            const fleet = asRecord(event['fleet'] || event['fleetSnapshot']) as unknown as FleetSnapshot | null
            if (!fleet) return
            context.fleetSnapshot = fleet
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'fleet.snapshot.updated',
                createdAt: asString(event['timestamp']) || nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                payload: {
                    eventType: type,
                    event,
                    snapshot: fleet
                }
            })
            return
        }

        if (type === 'managed_bash_job_update') {
            this.emitManagedBashJobUpdate(context, event, turnId)
            return
        }

        if (type === 'approval_requested') {
            const requestId = asString(event['requestId'])
            if (!requestId) return
            const requestTypeValue = asString(event['requestType'])
            const requestType = requestTypeValue === 'file-read' || requestTypeValue === 'file-change' ? requestTypeValue : 'command'
            const paths = Array.isArray(event['paths'])
                ? event['paths'].map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
                : undefined
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'approval.requested',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                requestId,
                payload: {
                    requestType,
                    title: asString(event['title']) || undefined,
                    detail: asString(event['detail']) || undefined,
                    command: asString(event['command']) || undefined,
                    paths
                }
            })
            return
        }

        if (type === 'approval_resolved') {
            const requestId = asString(event['requestId'])
            if (!requestId) return
            const rawDecision = asString(event['decision'])
            const decision: AssistantApprovalDecision = rawDecision === 'acceptOnce' || rawDecision === 'acceptForSession' ? rawDecision : 'decline'
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'approval.resolved',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                requestId,
                payload: { decision }
            })
            return
        }

        if (type === 'user_input_requested') {
            const requestId = asString(event['requestId'])
            if (!requestId) return
            const questions = toUserInputQuestions(
                event['questions'],
                (value) => asRecord(value) || undefined,
                (value) => asString(value) || undefined
            )
            if (questions.length === 0) return
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'user-input.requested',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                requestId,
                payload: { questions }
            })
            return
        }

        if (type === 'user_input_resolved') {
            const requestId = asString(event['requestId'])
            if (!requestId) return
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'user-input.resolved',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                requestId,
                payload: { answers: readUserInputAnswers(event['answers']) }
            })
            return
        }

        if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
            const message = asRecord(event['message'])
            const role = asString(message?.['role'])
            if (role === 'user') {
                const originatedOutsideThisDesktopThread = Boolean(
                    metadata?.localThreadId
                    && metadata.localThreadId !== context.localThreadId
                )
                if (type !== 'message_start' || !turnId || !originatedOutsideThisDesktopThread) return
                const content = extractAssistantEventContentParts(event, emptyAssistantContentParts(), type)
                if (!content.text.trim()) return
                const sourceMessageId = asString(message?.['id'])
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'user.message.received',
                    createdAt: asString(event['timestamp']) || nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId: context.providerThreadId,
                    turnId,
                    itemId: sourceMessageId || undefined,
                    payload: {
                        messageId: `assistant-message-user-${sourceMessageId || turnId}`,
                        text: content.text
                    }
                })
                return
            }
            if (role !== 'assistant' || !turnId) return
            const itemId = resolveAssistantEventItemId(context, event, turnId, type)
            const currentContent = {
                thinking: context.internalTextByItemId.get(itemId) || '',
                text: context.assistantTextByItemId.get(itemId) || '',
                hasThinkingBlock: context.internalTextByItemId.has(itemId)
            }
            const content = extractAssistantEventContentParts(event, currentContent, type)
            const messageUsage = type === 'message_end' ? readUsage(message?.['usage']) : null
            const usageMessageId = resolveAssistantUsageMessageIdentity(message, turnId, itemId)
            const usageAccountedMessageIds = getUsageAccountedAssistantMessageIds(context)
            if (messageUsage && shouldAccountAssistantMessageUsage({
                replay: metadata?.replay === true,
                turnId,
                activeTurnId: context.activeTurnId,
                turnCompleted: context.completedTurnIds.has(turnId),
                messageAlreadyAccounted: context.lastUsageTurnId === turnId
                    && usageAccountedMessageIds.has(usageMessageId)
            })) {
                if (context.lastUsageTurnId !== turnId) {
                    context.lastUsageTurnId = turnId
                    context.lastUsage = null
                    usageAccountedMessageIds.clear()
                }
                usageAccountedMessageIds.add(usageMessageId)
                context.lastUsage = mergeAssistantTurnUsage(context.lastUsage, messageUsage)
            }
            const liveTurnUsage = metadata?.replay === true || (!sessionUsage && !messageUsage)
                ? null
                : buildLiveAssistantTurnUsage(context)
            if (liveTurnUsage) {
                this.emitRuntime({
                    eventId: randomUUID(),
                    type: 'thread.token-usage.updated',
                    createdAt: asString(event['timestamp']) || nowIso(),
                    threadId: context.localThreadId,
                    providerThreadId: context.providerThreadId,
                    turnId,
                    sourceSequence: metadata?.sequence,
                    payload: { usage: liveTurnUsage }
                })
            }
            if (hasAssistantThinkingText(content) || isReasoningOnlyAssistantEvent(event)) {
                this.streamInternalText(context, turnId, content.thinking || content.text, itemId)
            }
            if (hasAssistantContentText(content) && !isReasoningOnlyAssistantEvent(event)) {
                this.streamAssistantText(context, turnId, content.text, itemId)
            }
            if (type === 'message_end') {
                if (hasAssistantThinkingText(content) || isReasoningOnlyAssistantEvent(event)) {
                    this.completeInternalText(context, turnId, content.thinking || content.text, itemId)
                }
                if (hasAssistantContentText(content) && !isReasoningOnlyAssistantEvent(event)) {
                    this.completeAssistantText(context, turnId, content.text, itemId)
                }
                const terminalOutcome = readTerminalAssistantMessageOutcome(message)
                if (terminalOutcome) {
                    context.terminalAssistantMessageOutcome = { turnId, ...terminalOutcome }
                } else if (context.terminalAssistantMessageOutcome?.turnId === turnId) {
                    // Pi can emit a failed assistant message and then recover within the
                    // same agent turn. A later successful message is authoritative for
                    // the eventual agent_end boundary and must clear the stale failure.
                    context.terminalAssistantMessageOutcome = null
                }
                if (context.activeAssistantItemId === itemId) {
                    context.activeAssistantItemId = null
                }
            }
            return
        }

        if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
            this.emitToolActivity(context, event, type, turnId)
            return
        }

        if (type === 'auto_retry_start') {
            const errorMessage = asString(event['errorMessage']) || ''
            const recoveryKind = event['recoveryKind'] === 'network' || isAssistantTransportFailure(errorMessage)
                ? 'network'
                : 'provider'
            const attempt = Math.max(1, Math.floor(Number(event['attempt']) || 1))
            const maxAttempts = Math.max(attempt, Math.floor(Number(event['maxAttempts']) || ZYRA_RETRY_MAX_ATTEMPTS))
            const retryTurnId = turnId || context.activeRetry?.turnId || null
            const activityId = context.activeRetry?.turnId === retryTurnId
                ? context.activeRetry.activityId
                : `zyra-connection-recovery-${retryTurnId || context.providerThreadId}`
            context.activeRetry = { activityId, turnId: retryTurnId, recoveryKind, attempt, maxAttempts }
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'activity',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: retryTurnId || undefined,
                payload: {
                    activityId,
                    kind: recoveryKind === 'network' ? 'connection.recovery' : 'provider.recovery',
                    summary: `${recoveryKind === 'network' ? 'Reconnecting' : 'Retrying'} ${attempt} of ${maxAttempts}`,
                    tone: 'warning',
                    data: {
                        category: 'connection-recovery',
                        status: 'retrying',
                        recoveryKind,
                        attempt,
                        maxAttempts,
                        delayMs: Number(event['delayMs']) || 0,
                        errorMessage
                    }
                }
            })
            return
        }

        if (type === 'auto_retry_end') {
            const lifecycle = context.activeRetry
            const finalError = asString(event['finalError']) || ''
            const recoveryKind = lifecycle?.recoveryKind
                || (event['recoveryKind'] === 'network' || isAssistantTransportFailure(finalError) ? 'network' : 'provider')
            const success = event['success'] === true
            const retryTurnId = lifecycle?.turnId || turnId || null
            const attempt = Math.max(1, Math.floor(Number(event['attempt']) || lifecycle?.attempt || 1))
            const maxAttempts = Math.max(attempt, lifecycle?.maxAttempts || attempt)
            const activityId = lifecycle?.activityId || `zyra-connection-recovery-${retryTurnId || context.providerThreadId}`
            const summary = success
                ? (recoveryKind === 'network' ? 'Reconnected' : 'Provider available')
                : (recoveryKind === 'network' ? 'Paused · Network issue' : 'Paused · Provider unavailable')
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'activity',
                createdAt: nowIso(),
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: retryTurnId || undefined,
                payload: {
                    activityId,
                    kind: recoveryKind === 'network' ? 'connection.recovery' : 'provider.recovery',
                    summary,
                    tone: success ? 'tool' : 'warning',
                    data: {
                        category: 'connection-recovery',
                        status: success ? 'recovered' : 'paused',
                        recoveryKind,
                        attempt,
                        maxAttempts,
                        errorMessage: finalError
                    }
                }
            })
            context.activeRetry = null
            return
        }

        if (type === 'compaction_start') {
            const startedAt = nowIso()
            const reason = asString(event['reason']) || 'threshold'
            const lifecycle: ActiveCompactionLifecycle = {
                activityId: `zyra-context-compaction-${randomUUID()}`,
                startedAt,
                reason,
                turnId
            }
            context.activeCompaction = lifecycle
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'activity',
                createdAt: startedAt,
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                payload: {
                    activityId: lifecycle.activityId,
                    kind: 'context.compaction',
                    summary: 'AUTO-COMPACTING',
                    detail: 'Conversation context is being compacted.',
                    tone: 'tool',
                    data: {
                        category: 'context-compaction',
                        sourceMethod: 'pi-sdk',
                        status: 'running',
                        reason,
                        startedAt
                    }
                }
            })
            return
        }

        if (type === 'compaction_end') {
            const completedAt = nowIso()
            const reason = asString(event['reason']) || context.activeCompaction?.reason || 'threshold'
            const lifecycle = context.activeCompaction || {
                activityId: `zyra-context-compaction-${randomUUID()}`,
                startedAt: completedAt,
                reason,
                turnId
            }
            const result = asRecord(event['result'])
            const aborted = event['aborted'] === true
            const errorMessage = asString(event['errorMessage'])
            const status = aborted ? 'cancelled' : result ? 'completed' : 'failed'
            const tone = status === 'failed' ? 'error' : status === 'cancelled' ? 'warning' : 'tool'
            const summary = status === 'completed'
                ? 'AUTO-COMPACTED'
                : status === 'cancelled'
                    ? 'AUTO-COMPACTION CANCELLED'
                    : 'AUTO-COMPACTION FAILED'
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'activity',
                createdAt: completedAt,
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: lifecycle.turnId || undefined,
                payload: {
                    activityId: lifecycle.activityId,
                    kind: 'context.compaction',
                    summary,
                    detail: errorMessage
                        || (status === 'completed'
                            ? 'Conversation context was compacted.'
                            : status === 'cancelled'
                                ? 'Conversation context compaction was cancelled.'
                                : 'Conversation context could not be compacted.'),
                    tone,
                    data: {
                        category: 'context-compaction',
                        sourceMethod: 'pi-sdk',
                        status,
                        reason,
                        startedAt: lifecycle.startedAt,
                        completedAt,
                        aborted,
                        willRetry: event['willRetry'] === true,
                        firstKeptEntryId: asString(result?.['firstKeptEntryId']) || undefined,
                        tokensBefore: typeof result?.['tokensBefore'] === 'number' ? result['tokensBefore'] : undefined,
                        estimatedTokensAfter: typeof result?.['estimatedTokensAfter'] === 'number' ? result['estimatedTokensAfter'] : undefined,
                        errorMessage: errorMessage || undefined
                    }
                }
            })
            const estimatedTokensAfter = typeof result?.['estimatedTokensAfter'] === 'number'
                ? result.estimatedTokensAfter
                : null
            const activeCompactionTurnId = lifecycle.turnId || turnId
            if (status === 'completed' && estimatedTokensAfter != null && estimatedTokensAfter >= 0 && activeCompactionTurnId) {
                context.sessionUsage = {
                    ...(context.sessionUsage || { threadId: context.localThreadId }),
                    threadId: context.localThreadId,
                    contextTokens: estimatedTokensAfter
                }
                const compactedUsage = buildLiveAssistantTurnUsage(context)
                if (compactedUsage) {
                    this.emitRuntime({
                        eventId: randomUUID(),
                        type: 'thread.token-usage.updated',
                        createdAt: completedAt,
                        threadId: context.localThreadId,
                        providerThreadId: context.providerThreadId,
                        turnId: activeCompactionTurnId,
                        sourceSequence: metadata?.sequence,
                        payload: { usage: compactedUsage }
                    })
                }
            }
            context.activeCompaction = null
            return
        }
    }

    private streamAssistantText(context: ZyraSessionContext, turnId: string, text: string, itemId = `zyra-assistant-${turnId}`): void {
        const previousText = context.assistantTextByItemId.get(itemId) || ''
        const nextText = text
        const delta = deltaFromMergedText(previousText, nextText)
        context.lastAssistantItemId = itemId
        context.assistantTextByItemId.set(itemId, nextText)
        if (!delta || (previousText && !nextText.startsWith(previousText))) return
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'content.delta',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId,
            itemId,
            payload: {
                streamKind: 'assistant_text',
                delta
            }
        })
    }

    private completeAssistantText(context: ZyraSessionContext, turnId: string, finalText?: string, itemId = context.lastAssistantItemId || `zyra-assistant-${turnId}`): void {
        const text = finalText ?? context.assistantTextByItemId.get(itemId) ?? ''
        if (context.assistantCompletedItemIds.has(itemId)) return
        context.lastAssistantItemId = itemId
        context.assistantCompletedItemIds.add(itemId)
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'content.completed',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId,
            itemId,
            payload: {
                streamKind: 'assistant_text',
                text
            }
        })
    }

    private streamInternalText(context: ZyraSessionContext, turnId: string, text: string, itemId = `zyra-internal-${turnId}`): void {
        const previousText = context.internalTextByItemId.get(itemId) || ''
        const nextText = text
        const delta = deltaFromMergedText(previousText, nextText)
        context.internalTextByItemId.set(itemId, nextText)
        if (!delta || (previousText && !nextText.startsWith(previousText))) return
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'content.delta',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId,
            itemId,
            payload: {
                streamKind: 'reasoning_summary_text',
                delta
            }
        })
    }

    private completeInternalText(context: ZyraSessionContext, turnId: string, finalText?: string, itemId = `zyra-internal-${turnId}`): void {
        const text = finalText ?? context.internalTextByItemId.get(itemId) ?? ''
        if (!text || context.internalCompletedItemIds.has(itemId)) return
        context.internalCompletedItemIds.add(itemId)
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'content.completed',
            createdAt: nowIso(),
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId,
            itemId,
            payload: {
                streamKind: 'reasoning_summary_text',
                text
            }
        })
    }

    private emitManagedBashJobUpdate(context: ZyraSessionContext, event: Record<string, unknown>, turnId: string | null): void {
        const status = normalizeManagedCommandLifecycleStatus(event['status'])
        const jobId = asString(event['jobId'])
        if (!status || !jobId) return
        if (status === 'running') context.runningManagedCommandJobIds.add(jobId)
        else context.runningManagedCommandJobIds.delete(jobId)
        const toolCallId = asString(event['toolCallId'])
        const activityId = toolCallId
            ? `zyra-tool-${toolCallId}`
            : context.commandActivityIdByJobId.get(jobId)
        if (!activityId) return
        context.commandActivityIdByJobId.set(jobId, activityId)

        const occurredAt = status === 'running'
            ? nowIso()
            : asString(event['completedAt']) || nowIso()
        const startedAt = asString(event['startedAt'])
        const completedAt = status === 'running' ? null : asString(event['completedAt']) || occurredAt
        const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN
        const completedAtMs = completedAt ? Date.parse(completedAt) : Number.NaN
        const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
            ? Math.max(0, completedAtMs - startedAtMs)
            : status === 'running' ? null : undefined
        const output = typeof event['output'] === 'string' ? event['output'] : undefined

        this.emitRuntime({
            eventId: randomUUID(),
            type: 'activity',
            createdAt: occurredAt,
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId: turnId || undefined,
            itemId: toolCallId || undefined,
            payload: {
                activityId,
                kind: 'command',
                summary: managedCommandSummary(status),
                detail: asString(event['command']) || undefined,
                tone: status === 'failed' ? 'error' : status === 'stopped' ? 'warning' : 'tool',
                data: {
                    status,
                    toolName: 'bash',
                    jobId,
                    command: asString(event['command']) || undefined,
                    output,
                    replaceOutput: true,
                    startedAt: startedAt || undefined,
                    lastOutputAt: asString(event['lastOutputAt']) || undefined,
                    completedAt,
                    durationMs,
                    exitCode: event['exitCode'],
                    errorMessage: asString(event['errorMessage']) || undefined
                }
            }
        })
    }

    private emitToolActivity(context: ZyraSessionContext, event: Record<string, unknown>, type: string, turnId: string | null): void {
        const agentSurface = parseAgentSurfaceDescriptor(event['surface'])
        const toolName = agentSurface?.toolName || asString(event['toolName']) || asString(event['name']) || 'tool'
        const toolCallId = asString(event['toolCallId']) || asString(event['id']) || `${toolName}-${turnId || 'turn'}`
        const isError = Boolean(event['isError'])
        const occurredAt = nowIso()
        const incomingArgs = asRecord(event['args']) || asRecord(event['arguments']) || asRecord(event['input'])
        if (incomingArgs) context.toolArgsByCallId.set(toolCallId, incomingArgs)
        const argsRecord = incomingArgs || context.toolArgsByCallId.get(toolCallId) || null
        const startedAt = context.toolStartedAtByCallId.get(toolCallId) || occurredAt
        if (!context.toolStartedAtByCallId.has(toolCallId)) context.toolStartedAtByCallId.set(toolCallId, startedAt)
        const resultRecord = asRecord(event['result'])
        const partialResult = event['partialResult'] ?? event['output']
        const managedCommandJobId = readManagedCommandJobId(argsRecord, resultRecord, partialResult)
        const isManagedBashCall = compactToolName(toolName) === 'bash' && Boolean(managedCommandJobId)
        const managedCommandStatus = isManagedBashCall
            ? readManagedCommandLifecycleStatus(resultRecord, partialResult)
            : null
        const lifecycleStatus = isError ? 'failed' : managedCommandStatus
        const isCommandCheckpointCall = isManagedCommandCheckpointCall(toolName, argsRecord, resultRecord, partialResult)
        let state: 'running' | 'completed' | 'error' = 'running'
        if (type === 'tool_execution_end') {
            state = isError ? 'error' : 'completed'
            if (!isError && !isCommandCheckpointCall && lifecycleStatus === 'running') state = 'running'
            if (!isError && !isCommandCheckpointCall && lifecycleStatus === 'failed') state = 'error'
        }
        const completedAt = type === 'tool_execution_end' && state !== 'running' ? occurredAt : null
        const durationMs = completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null
        const preserveOutputWhitespace = agentSurface?.kind === 'file-read'
            || agentSurface?.kind === 'skill'
            || /\bread\b/.test(normalizeToolName(toolName))
        const output = readToolOutput(event['output'] ?? event['result'], partialResult, preserveOutputWhitespace)
        const classified = classifyZyraToolActivity({
            toolName,
            args: argsRecord,
            result: resultRecord,
            partialResult,
            state,
            output
        })
        const keepsSpecializedDesktopKind = classified.kind === 'command.checkpoint' || classified.kind.startsWith('subagent.')
        if (agentSurface && !keepsSpecializedDesktopKind) {
            classified.kind = agentSurface.kind
            classified.summary = agentSurface.summary
            classified.detail ||= agentSurface.primaryText
        }
        if (classified.kind === 'file-change') {
            Object.assign(classified.data, readPiFileChangeData({
                cwd: context.cwd,
                toolName,
                args: argsRecord,
                result: resultRecord,
                partialResult,
                type,
                state
            }), {
                toolCallId
            })
        }
        if (classified.kind === 'file-read' || classified.kind === 'skill') {
            Object.assign(classified.data, analyzeAssistantReadResult({
                args: argsRecord,
                result: resultRecord,
                partialResult,
                output,
                status: state === 'error' ? 'failed' : state
            }))
        }
        const actionBatchIntent = normalizeAssistantActionBatchIntent(event['actionBatchIntent'])
        if (actionBatchIntent) classified.data['actionBatchIntent'] = actionBatchIntent
        classified.data['toolLifecyclePhase'] = agentSurface?.phase
            || (type === 'tool_execution_start' ? 'start' : type === 'tool_execution_update' ? 'update' : 'end')
        if (type === 'tool_execution_end' && lifecycleStatus && !isCommandCheckpointCall) {
            classified.data['status'] = lifecycleStatus
            classified.summary = managedCommandSummary(lifecycleStatus)
        }
        if (agentSurface) {
            const effectiveLifecycle = lifecycleStatus
                || (state === 'error' ? 'failed' : state)
            classified.data['surface'] = {
                ...agentSurface,
                kind: keepsSpecializedDesktopKind ? agentSurface.kind : classified.kind,
                lifecycle: effectiveLifecycle,
                summary: classified.summary
            }
        }
        const activityId = `zyra-tool-${toolCallId}`
        const commandJobId = asString(classified.data['jobId'])
        const isCommandCheckpoint = classified.kind === 'command.checkpoint'
        const activityFailed = isCommandCheckpoint ? isError : lifecycleStatus === 'failed'
        const activityTone = activityFailed
            ? 'error'
            : !isCommandCheckpoint && lifecycleStatus === 'stopped'
                ? 'warning'
                : 'tool'
        const relatedCommandActivityId = isCommandCheckpoint && commandJobId
            ? context.commandActivityIdByJobId.get(commandJobId)
            : undefined
        if (!isCommandCheckpoint && commandJobId) {
            context.commandActivityIdByJobId.set(commandJobId, activityId)
        }
        if (commandJobId && lifecycleStatus === 'running') context.runningManagedCommandJobIds.add(commandJobId)
        else if (commandJobId && lifecycleStatus) context.runningManagedCommandJobIds.delete(commandJobId)
        this.emitRuntime({
            eventId: randomUUID(),
            type: 'activity',
            createdAt: occurredAt,
            threadId: context.localThreadId,
            providerThreadId: context.providerThreadId,
            turnId: turnId || undefined,
            itemId: toolCallId,
            payload: {
                activityId,
                kind: classified.kind,
                summary: classified.summary,
                detail: classified.detail,
                tone: activityTone,
                data: {
                    ...classified.data,
                    relatedCommandActivityId,
                    startedAt,
                    completedAt: completedAt || undefined,
                    durationMs: durationMs ?? undefined
                }
            }
        })
        if (type === 'tool_execution_end' && isCommandCheckpoint && relatedCommandActivityId && commandJobId && lifecycleStatus) {
            const lifecycleCompletedAt = lifecycleStatus === 'running' ? null : occurredAt
            this.emitRuntime({
                eventId: randomUUID(),
                type: 'activity',
                createdAt: occurredAt,
                threadId: context.localThreadId,
                providerThreadId: context.providerThreadId,
                turnId: turnId || undefined,
                payload: {
                    activityId: relatedCommandActivityId,
                    kind: 'command',
                    summary: managedCommandSummary(lifecycleStatus),
                    tone: lifecycleStatus === 'failed' ? 'error' : lifecycleStatus === 'stopped' ? 'warning' : 'tool',
                    data: {
                        status: lifecycleStatus,
                        jobId: commandJobId,
                        result: resultRecord || partialResult || undefined,
                        output,
                        completedAt: lifecycleCompletedAt,
                        durationMs: lifecycleStatus === 'running' ? null : undefined
                    }
                }
            })
        }
        if (type === 'tool_execution_end') {
            context.toolArgsByCallId.delete(toolCallId)
            context.toolStartedAtByCallId.delete(toolCallId)
        }
    }

    private requireSession(threadId: string): ZyraSessionContext {
        const session = this.getSessionContext(threadId)
        if (!session) throw new Error(`Unknown Zyra runtime session for thread ${threadId}.`)
        return session
    }

    private getSessionContext(threadId: string): ZyraSessionContext | undefined {
        const direct = this.sessions.get(threadId)
        if (direct) return direct
        const mapped = this.aliases.get(threadId)
        return mapped ? this.sessions.get(mapped) : undefined
    }

    private emitRuntime(event: AssistantRuntimeEvent): void {
        this.emit('runtime', event)
    }
}
