import { appendAssistantText } from '../../shared/assistant/stream-text-update'
import { randomUUID } from 'node:crypto'
import type { AssistantRuntimeEvent, NormalizedFileChange } from '../../shared/assistant/contracts'
import {
    buildPatchFromFileChanges,
    getFileChangePatchStats,
    normalizeFileChange
} from '../../shared/assistant/contracts'
import { isAssistantReasoningEffort } from '../../shared/assistant/reasoning-efforts'
import type {
    JsonRpcMessage,
    JsonRpcId,
    PendingApprovalRequest,
    SessionContext
} from './codex-runtime-protocol'
import {
    asRecord,
    asString,
    buildToolActivity,
    isAssistantItemType,
    normalizeItemType,
    readTextValue,
    readTurnUsage,
    toApprovalRequestType,
    toUserInputQuestions
} from './codex-runtime-protocol'

interface RuntimeEventHandlerDeps {
    emitRuntime: (event: AssistantRuntimeEvent) => void
    writeMessage: (context: SessionContext, message: Record<string, unknown>) => void
    registerThreadAlias: (sessionThreadId: string, aliasThreadId: string) => void
}

type ThreadStartedRuntimePayload = Extract<AssistantRuntimeEvent, { type: 'thread.started' }>['payload']
type ActivityRuntimePayload = Extract<AssistantRuntimeEvent, { type: 'activity' }>['payload']

function readPayloadThreadId(payload: Record<string, unknown>): string | undefined {
    return asString(asRecord(payload['thread'])?.['id'])
        || asString(payload['threadId'])
        || asString(asRecord(payload['turn'])?.['threadId'])
        || asString(asRecord(asRecord(payload['turn'])?.['thread'])?.['id'])
        || asString(asRecord(payload['item'])?.['threadId'])
        || asString(asRecord(asRecord(payload['item'])?.['thread'])?.['id'])
}

function resolveRuntimeThreadId(context: SessionContext, payload: Record<string, unknown>): string {
    return readPayloadThreadId(payload) || context.thread.id
}

function resolveRuntimeProviderThreadId(context: SessionContext, payload: Record<string, unknown>): string | undefined {
    return readPayloadThreadId(payload) || context.thread.providerThreadId || undefined
}

function readThreadStartedPayload(payload: Record<string, unknown>): ThreadStartedRuntimePayload & { providerThreadId: string } {
    const thread = asRecord(payload['thread']) || {}
    const source = asRecord(thread['source'])
    const subagent = asRecord(source?.['subagent'])
    const threadSpawn = asRecord(subagent?.['thread_spawn'])
    const providerThreadId = asString(thread['id']) || asString(payload['threadId']) || ''
    const sourceKind: 'root' | 'subagent' | 'other' = threadSpawn
        ? 'subagent'
        : source && Object.keys(source).length > 0
            ? 'other'
            : 'root'
    const stateValue = asString(thread['state'])
    const state = stateValue === 'idle'
        || stateValue === 'starting'
        || stateValue === 'ready'
        || stateValue === 'running'
        || stateValue === 'waiting'
        || stateValue === 'interrupted'
        || stateValue === 'error'
        || stateValue === 'stopped'
        ? stateValue
        : undefined

    return {
        providerThreadId,
        source: sourceKind,
        parentProviderThreadId: asString(threadSpawn?.['parent_thread_id']),
        agentNickname: asString(thread['agentNickname']) || asString(threadSpawn?.['agent_nickname']),
        agentRole: asString(thread['agentRole']) || asString(threadSpawn?.['agent_role']),
        subagentDepth: typeof threadSpawn?.['depth'] === 'number' ? threadSpawn['depth'] as number : undefined,
        threadName: asString(thread['name']),
        cwd: asString(thread['cwd']),
        state
    }
}

function buildCollabAgentActivity(item: Record<string, unknown>):
    | {
        activityId: string
        kind: string
        summary: string
        detail?: string
        tone: 'tool'
        data: Record<string, unknown>
    }
    | null {
    const activityId = asString(item['id'])
    const tool = asString(item['tool'])
    const status = asString(item['status'])
    if (!activityId || !tool) return null

    const toolKindMap: Record<string, string> = {
        spawnAgent: 'subagent.spawn',
        sendInput: 'subagent.send-input',
        resumeAgent: 'subagent.resume',
        wait: 'subagent.wait',
        closeAgent: 'subagent.close'
    }
    const summaryMap: Record<string, string> = {
        spawnAgent: status === 'inProgress' ? 'Spawning subagent' : 'Spawned subagent',
        sendInput: status === 'inProgress' ? 'Checking in with subagent' : 'Checked in with subagent',
        resumeAgent: status === 'inProgress' ? 'Resuming subagent' : 'Resumed subagent',
        wait: status === 'inProgress' ? 'Waiting on subagent' : 'Subagent wait completed',
        closeAgent: status === 'inProgress' ? 'Closing subagent' : 'Closed subagent'
    }
    const prompt = readTextValue(item['prompt'])
    const receiverThreadIds = Array.isArray(item['receiverThreadIds'])
        ? item['receiverThreadIds'].filter((entry): entry is string => typeof entry === 'string')
        : []
    const agentsStates = Array.isArray(item['agentsStates'])
        ? item['agentsStates'].filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
        : []
    const detail = prompt || (receiverThreadIds.length > 0 ? receiverThreadIds.join('\n') : undefined)

    return {
        activityId,
        kind: toolKindMap[tool] || 'subagent.tool',
        summary: summaryMap[tool] || 'Subagent activity',
        detail,
        tone: 'tool',
        data: {
            category: 'subagent',
            itemType: normalizeItemType(item['type'] || item['kind']),
            tool,
            status,
            senderThreadId: asString(item['senderThreadId']),
            receiverThreadIds,
            prompt,
            model: asString(item['model']),
            reasoningEffort: asString(item['reasoningEffort']) || asString(item['reasoning_effort']),
            agentsStates
        }
    }
}

function isContextCompactionItemType(itemType: string): boolean {
    return itemType === 'context compaction' || itemType.includes('context compaction')
}

function buildContextCompactionActivity(input: {
    item: Record<string, unknown>
    itemType: string
    status: 'running' | 'completed'
    threadId: string
    providerThreadId?: string
    turnId?: string
    itemId?: string
    sourceMethod: string
}): ActivityRuntimePayload {
    const rawItemId = input.turnId || asString(input.item['id']) || input.itemId || input.threadId
    const status = input.status
    const summary = status === 'running' ? 'AUTO-COMPACTING' : 'AUTO-COMPACTED'

    return {
        activityId: `context-compaction-${rawItemId}`,
        kind: 'context.compaction',
        summary,
        detail: status === 'running'
            ? 'Conversation context is being compacted.'
            : 'Conversation context was compacted.',
        tone: 'tool',
        data: {
            category: 'context-compaction',
            itemType: input.itemType,
            status,
            sourceMethod: input.sourceMethod,
            itemId: rawItemId,
            turnId: input.turnId,
            threadId: input.threadId,
            providerThreadId: input.providerThreadId,
            providerStatus: asString(input.item['status']) || asString(input.item['state'])
        }
    }
}

function buildCodexItemActivityId(itemId?: string): string | undefined {
    return itemId ? `codex-item-${itemId}` : undefined
}

function readToolActivityItemId(item: Record<string, unknown>, fallbackItemId?: string): string | undefined {
    return asString(item['id'])
        || asString(item['itemId'])
        || asString(item['call_id'])
        || asString(item['callId'])
        || fallbackItemId
}

function buildCodexTurnDiffActivityId(turnId?: string): string | undefined {
    return turnId ? `codex-turn-diff-${turnId}` : undefined
}

function nextCodexFileChangeRevision(context: SessionContext, itemId: string): number {
    const current = context.fileChangeRevisionByItemId.get(itemId) || 0
    const next = current + 1
    context.fileChangeRevisionByItemId.set(itemId, next)
    return next
}

function readCodexStructuredChanges(value: unknown): NormalizedFileChange[] {
    if (!Array.isArray(value)) return []
    return value.map(normalizeFileChange).filter((change): change is NormalizedFileChange => Boolean(change))
}

function withCodexItemActivityId(
    activity: ActivityRuntimePayload,
    itemId?: string,
    lifecycle?: {
        source: 'args-preview' | 'provider-live' | 'provider-result'
        revision: number
        authoritative: boolean
        changes?: NormalizedFileChange[]
    }
): ActivityRuntimePayload {
    const activityId = buildCodexItemActivityId(itemId)
    if (!activityId) return activity
    if (activity.kind !== 'file-change') {
        return {
            ...activity,
            activityId,
            data: {
                ...(activity.data || {}),
                itemId
            }
        }
    }
    const changes = lifecycle?.changes || readCodexStructuredChanges(activity.data?.['changes'])
    const patch = buildPatchFromFileChanges(changes) || asString(activity.data?.['patch'])
    const paths = changes.length > 0
        ? changes.map((change) => change.path)
        : Array.isArray(activity.data?.['paths'])
            ? activity.data?.['paths']
            : []
    const createdPaths = changes.filter((change) => change.kind === 'add' || change.isNew).map((change) => change.path)
    const stats = getFileChangePatchStats(patch)
    return {
        ...activity,
        activityId,
        data: {
            ...(activity.data || {}),
            category: 'file-change',
            provider: 'codex',
            itemId,
            source: lifecycle?.source || 'args-preview',
            revision: lifecycle?.revision || 0,
            authoritative: lifecycle?.authoritative || false,
            changes,
            paths,
            createdPaths: createdPaths.length > 0 ? createdPaths : activity.data?.['createdPaths'],
            fileCount: paths.length || activity.data?.['fileCount'],
            patch: patch || activity.data?.['patch'],
            additions: stats.additions,
            deletions: stats.deletions
        }
    }
}

function isLiveToolItemType(itemType: string): boolean {
    return itemType.includes('command')
        || itemType.includes('file change')
        || itemType.includes('edit')
        || itemType.includes('mcp tool call')
        || itemType.includes('dynamic tool call')
        || itemType.includes('web search')
        || itemType.includes('tool search')
        || itemType.includes('function call')
}

function readFuzzySearchFiles(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
}

function formatFuzzySearchFile(file: Record<string, unknown>): string {
    const path = asString(file['path']) || asString(file['fileName']) || asString(file['file_name']) || 'unknown'
    const root = asString(file['root'])
    const matchType = asString(file['matchType']) || asString(file['match_type'])
    const score = typeof file['score'] === 'number' && Number.isFinite(file['score'])
        ? `score=${file['score'].toFixed(3)}`
        : undefined
    const suffix = [matchType, score].filter(Boolean).join(', ')
    const displayPath = root && !path.startsWith(root) ? `${root}\\${path}` : path
    return suffix ? `${displayPath}  (${suffix})` : displayPath
}

function buildFuzzySearchOutput(query: string | undefined, files: Record<string, unknown>[]): string {
    const args = query ? ` ${JSON.stringify({ query })}` : ''
    const body = files.length > 0
        ? files.map(formatFuzzySearchFile).join('\n')
        : 'no matches yet'

    return [`$ file.search${args}`, '', body].join('\n')
}

function buildFuzzySearchActivity(input: {
    sessionId?: string
    query?: string
    files?: Record<string, unknown>[]
    completed: boolean
}): ActivityRuntimePayload {
    const data: Record<string, unknown> = {
        category: 'fuzzy-file-search',
        itemType: 'fuzzy file search',
        status: input.completed ? 'completed' : 'inProgress'
    }
    if (input.sessionId) data['sessionId'] = input.sessionId
    if (input.query) data['query'] = input.query
    if (input.files) {
        data['files'] = input.files
        data['output'] = buildFuzzySearchOutput(input.query, input.files)
    }

    return {
        activityId: input.sessionId ? `fuzzy-file-search-${input.sessionId}` : undefined,
        kind: 'search',
        summary: input.completed ? 'Searched files' : 'Searching files',
        detail: input.query || 'File search',
        tone: 'tool',
        data
    }
}

function readResolvedUserInputAnswers(value: unknown): Record<string, string | string[]> {
    const rawAnswers = asRecord(value) || {}
    return Object.fromEntries(
        Object.entries(rawAnswers).map(([questionId, answerValue]) => {
            if (typeof answerValue === 'string') return [questionId, answerValue]
            if (Array.isArray(answerValue)) {
                return [questionId, answerValue.filter((entry): entry is string => typeof entry === 'string')]
            }
            const answerRecord = asRecord(answerValue)
            const nestedAnswers = Array.isArray(answerRecord?.['answers'])
                ? answerRecord['answers'].filter((entry): entry is string => typeof entry === 'string')
                : []
            return [questionId, nestedAnswers.length <= 1 ? (nestedAnswers[0] || '') : nestedAnswers]
        })
    )
}

export function handleStdoutLine(context: SessionContext, line: string, deps: RuntimeEventHandlerDeps): void {
    let parsed: JsonRpcMessage
    try {
        parsed = JSON.parse(line) as JsonRpcMessage
    } catch {
        return
    }

    if (parsed['id'] !== undefined && parsed['method'] !== undefined) {
        handleServerRequest(context, parsed, deps)
        return
    }
    if (parsed['id'] !== undefined) {
        handleResponse(context, parsed)
        return
    }
    if (typeof parsed['method'] === 'string') {
        handleNotification(context, String(parsed['method']), asRecord(parsed['params']) || {}, deps)
    }
}

export function handleResponse(context: SessionContext, message: JsonRpcMessage): void {
    const key = String(message['id'])
    const pending = context.pending.get(key)
    if (!pending) return

    clearTimeout(pending.timer)
    context.pending.delete(key)

    const error = asRecord(message['error'])
    if (error?.['message']) {
        pending.reject(new Error(String(error['message'])))
        return
    }

    pending.resolve(message['result'])
}

function handleServerRequest(context: SessionContext, message: JsonRpcMessage, deps: RuntimeEventHandlerDeps): void {
    const method = String(message['method'] || '')
    const requestType = toApprovalRequestType(method)
    const payload = asRecord(message['params']) || {}
    const runtimeThreadId = resolveRuntimeThreadId(context, payload)
    const runtimeProviderThreadId = resolveRuntimeProviderThreadId(context, payload)
    const requestId = randomUUID()
    const turnId = asString(payload['turnId']) || asString(asRecord(payload['turn'])?.['id'])
    const itemId = asString(payload['itemId']) || asString(asRecord(payload['item'])?.['id'])

    if (requestType) {
        const pending: PendingApprovalRequest = {
            requestId,
            jsonRpcId: message['id'] as JsonRpcId,
            requestType,
            threadId: runtimeThreadId,
            turnId,
            itemId
        }
        context.pendingApprovals.set(requestId, pending)
        deps.emitRuntime({
            eventId: randomUUID(),
            type: 'approval.requested',
            createdAt: new Date().toISOString(),
            threadId: runtimeThreadId,
            turnId,
            itemId,
            requestId,
            providerThreadId: runtimeProviderThreadId,
            payload: {
                requestType,
                title: asString(payload['title']),
                detail: asString(payload['reason']) || asString(payload['detail']) || asString(payload['command']),
                command: asString(payload['command']),
                paths: Array.isArray(payload['paths']) ? payload['paths'].filter((entry): entry is string => typeof entry === 'string') : undefined
            }
        })
        return
    }

    if (method === 'item/tool/requestUserInput') {
        const questions = toUserInputQuestions(payload['questions'])
        context.pendingUserInputs.set(requestId, {
            requestId,
            jsonRpcId: message['id'] as JsonRpcId,
            threadId: runtimeThreadId,
            turnId,
            itemId
        })
        deps.emitRuntime({
            eventId: randomUUID(),
            type: 'user-input.requested',
            createdAt: new Date().toISOString(),
            threadId: runtimeThreadId,
            turnId,
            itemId,
            requestId,
            providerThreadId: runtimeProviderThreadId,
            payload: { questions }
        })
        return
    }

    deps.writeMessage(context, {
        id: message['id'],
        error: {
            code: -32601,
            message: `Unsupported server request: ${method}`
        }
    })
}

function handleNotification(
    context: SessionContext,
    method: string,
    payload: Record<string, unknown>,
    deps: RuntimeEventHandlerDeps
): void {
    const turnId = asString(payload['turnId']) || asString(asRecord(payload['turn'])?.['id'])
    const itemId = asString(payload['itemId']) || asString(asRecord(payload['item'])?.['id'])
    const runtimeThreadId = resolveRuntimeThreadId(context, payload)
    const runtimeProviderThreadId = resolveRuntimeProviderThreadId(context, payload)
    const eventBase = {
        eventId: randomUUID(),
        createdAt: new Date().toISOString(),
        threadId: runtimeThreadId,
        turnId,
        itemId,
        providerThreadId: runtimeProviderThreadId,
        rawMethod: method,
        rawPayload: payload
    }

    if (method === 'thread/started') {
        const threadStartedPayload = readThreadStartedPayload(payload)
        if (threadStartedPayload.providerThreadId) {
            deps.registerThreadAlias(context.thread.id, threadStartedPayload.providerThreadId)
            if (threadStartedPayload.source !== 'subagent') {
                context.thread.providerThreadId = threadStartedPayload.providerThreadId
            }
            deps.emitRuntime({
                ...eventBase,
                threadId: threadStartedPayload.providerThreadId,
                providerThreadId: threadStartedPayload.providerThreadId,
                type: 'thread.started',
                payload: threadStartedPayload
            })
        }
        return
    }

    if (method === 'turn/started') {
        const turn = asRecord(payload['turn'])
        const effortValue = turn?.['reasoningEffort']
        const effort = isAssistantReasoningEffort(effortValue) ? effortValue : undefined
        const serviceTierValue = asString(turn?.['serviceTier'])
        const serviceTier = serviceTierValue === 'fast' || serviceTierValue === 'flex'
            ? serviceTierValue as 'fast' | 'flex'
            : undefined

        deps.emitRuntime({
            ...eventBase,
            type: 'turn.started',
            payload: {
                model: asString(turn?.['model']),
                interactionMode: context.thread.interactionMode,
                ...(effort ? { effort } : {}),
                ...(serviceTier ? { serviceTier } : {})
            }
        })
        deps.emitRuntime({ ...eventBase, type: 'session.state.changed', payload: { state: 'running' } })
        return
    }

    if (method === 'turn/completed') {
        const turn = asRecord(payload['turn'])
        const status = asString(turn?.['status'])
        const errorMessage = asString(asRecord(turn?.['error'])?.['message'])
        const effortValue = asString(turn?.['reasoningEffort']) || asString(turn?.['reasoning_effort'])
        const effort = isAssistantReasoningEffort(effortValue) ? effortValue : undefined
        const serviceTierValue = asString(turn?.['serviceTier']) || asString(turn?.['service_tier']) || asString(payload['serviceTier'])
        const serviceTier = serviceTierValue === 'fast' || serviceTierValue === 'flex' ? serviceTierValue : undefined
        const usage = readTurnUsage(turn, payload)
        const outcome = status === 'failed' ? 'failed' : status === 'interrupted' ? 'interrupted' : status === 'cancelled' ? 'cancelled' : 'completed'

        deps.emitRuntime({ ...eventBase, type: 'turn.completed', payload: { outcome, errorMessage, effort, serviceTier, usage } })
        deps.emitRuntime({
            ...eventBase,
            type: 'session.state.changed',
            payload: { state: outcome === 'failed' ? 'error' : 'ready', error: errorMessage }
        })
        return
    }

    if (method === 'thread/tokenUsage/updated') {
        const tokenUsage = asRecord(payload['tokenUsage'])
        const lastUsage = asRecord(tokenUsage?.['last'])
        const usage = readTurnUsage(undefined, { tokenUsage: { ...lastUsage, modelContextWindow: tokenUsage?.['modelContextWindow'] } })
        if (usage) {
            deps.emitRuntime({ ...eventBase, type: 'thread.token-usage.updated', payload: { usage } })
        }
        return
    }

    if (method === 'turn/plan/updated') {
        const rawSteps = Array.isArray(payload['plan']) ? payload['plan'] : []
        deps.emitRuntime({
            ...eventBase,
            type: 'plan.updated',
            payload: {
                explanation: asString(payload['explanation']),
                plan: rawSteps.map((entry) => {
                    const step = asRecord(entry)
                    return {
                        step: asString(step?.['step']) || 'step',
                        description: asString(step?.['description']) || undefined,
                        status: step?.['status'] === 'completed' || step?.['status'] === 'inProgress'
                            ? step['status'] as 'completed' | 'inProgress'
                            : 'pending'
                    }
                })
            }
        })
        return
    }

    if (method === 'turn/diff/updated') {
        const diff = asString(payload['diff'])
        if (!diff) return

        const activity = buildToolActivity({
            type: 'fileChange',
            status: 'inProgress',
            diff
        }, 'file change')
        if (!activity) return

        deps.emitRuntime({
            ...eventBase,
            type: 'activity',
            payload: {
                ...activity,
                activityId: buildCodexTurnDiffActivityId(turnId),
                summary: 'Updated diff',
                data: {
                    ...(activity.data || {}),
                    category: 'turn-diff',
                    provider: 'codex',
                    status: 'completed',
                    source: 'turn-final',
                    revision: 0,
                    authoritative: true
                }
            }
        })
        return
    }

    if (method === 'thread/compacted') {
        deps.emitRuntime({
            ...eventBase,
            type: 'activity',
            payload: buildContextCompactionActivity({
                item: payload,
                itemType: 'context compaction',
                status: 'completed',
                threadId: runtimeThreadId,
                providerThreadId: runtimeProviderThreadId,
                turnId,
                itemId,
                sourceMethod: method
            })
        })
        return
    }

    if (method === 'item/fileChange/patchUpdated') {
        if (!itemId) return
        const changes = readCodexStructuredChanges(payload['changes'])
        if (changes.length === 0) return
        const patch = buildPatchFromFileChanges(changes)
        const stats = getFileChangePatchStats(patch)
        const paths = changes.map((change) => change.path)
        deps.emitRuntime({
            ...eventBase,
            type: 'activity',
            payload: {
                activityId: buildCodexItemActivityId(itemId),
                kind: 'file-change',
                summary: paths.length > 1 ? 'Editing files' : 'Editing file',
                detail: paths.join('\n'),
                tone: 'tool',
                data: {
                    category: 'file-change',
                    provider: 'codex',
                    itemId,
                    status: 'running',
                    source: 'provider-live',
                    revision: nextCodexFileChangeRevision(context, itemId),
                    authoritative: false,
                    changes,
                    paths,
                    createdPaths: changes.filter((change) => change.kind === 'add' || change.isNew).map((change) => change.path),
                    fileCount: paths.length,
                    patch,
                    additions: stats.additions,
                    deletions: stats.deletions
                }
            }
        })
        return
    }

    if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
        const delta = asString(payload['delta']) || asString(payload['text']) || asString(asRecord(payload['content'])?.['text'])
        if (!delta) return

        deps.emitRuntime({
            ...eventBase,
            type: 'content.delta',
            payload: {
                streamKind: method === 'item/commandExecution/outputDelta' ? 'command_output' : 'file_change_output',
                ...appendAssistantText(delta)
            }
        })
        return
    }

    if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta' || method === 'item/plan/delta') {
        const delta = asString(payload['delta']) || asString(payload['text']) || asString(asRecord(payload['content'])?.['text'])
        if (!delta) return

        const streamKind = method === 'item/agentMessage/delta'
            ? 'assistant_text'
            : method === 'item/reasoning/textDelta'
                ? 'reasoning_text'
                : method === 'item/reasoning/summaryTextDelta'
                    ? 'reasoning_summary_text'
                    : 'plan_text'

        deps.emitRuntime({ ...eventBase, type: 'content.delta', payload: { streamKind, ...appendAssistantText(delta) } })
        return
    }

    if (method === 'fuzzyFileSearch/sessionUpdated' || method === 'fuzzyFileSearch/sessionCompleted') {
        const sessionId = asString(payload['sessionId'])
        const files = method === 'fuzzyFileSearch/sessionUpdated'
            ? readFuzzySearchFiles(payload['files'])
            : undefined
        deps.emitRuntime({
            ...eventBase,
            type: 'activity',
            payload: buildFuzzySearchActivity({
                sessionId,
                query: asString(payload['query']),
                files,
                completed: method === 'fuzzyFileSearch/sessionCompleted'
            })
        })
        return
    }

    if (method === 'item/mcpToolCall/progress') {
        const progressItemId = asString(payload['itemId']) || itemId
        const message = asString(payload['message'])
        if (!progressItemId || !message) return

        deps.emitRuntime({
            ...eventBase,
            itemId: progressItemId,
            type: 'activity',
            payload: {
                activityId: buildCodexItemActivityId(progressItemId),
                kind: 'tool',
                summary: 'MCP tool progress',
                detail: message,
                tone: 'tool',
                data: {
                    category: 'mcp-tool',
                    itemType: 'mcp tool call',
                    itemId: progressItemId,
                    status: 'inProgress',
                    progress: message
                }
            }
        })
        return
    }

    if (method === 'rawResponseItem/completed') {
        const item = asRecord(payload['item'])
        if (!item) return
        const itemType = normalizeItemType(item['type'] || item['kind'])
        const activity = buildToolActivity(item, itemType)
        if (!activity) return

        const activityItemId = readToolActivityItemId(item, itemId)
        deps.emitRuntime({
            ...eventBase,
            itemId: activityItemId,
            type: 'activity',
            payload: withCodexItemActivityId(activity, activityItemId, activity.kind === 'file-change' && activityItemId ? {
                source: 'provider-result',
                revision: nextCodexFileChangeRevision(context, activityItemId),
                authoritative: true,
                changes: readCodexStructuredChanges(item['changes'])
            } : undefined)
        })
        return
    }

    if (method === 'item/started' || method === 'item/completed') {
        const rawItem = asRecord(payload['item']) || payload
        const item: Record<string, unknown> = {
            ...rawItem,
            status: asString(rawItem['status']) || asString(rawItem['state']) || asString(rawItem['phase']) || (method === 'item/started' ? 'inProgress' : 'completed')
        }
        const itemType = normalizeItemType(item['type'] || item['kind'])
        if (isContextCompactionItemType(itemType)) {
            deps.emitRuntime({
                ...eventBase,
                type: 'activity',
                payload: buildContextCompactionActivity({
                    item,
                    itemType,
                    status: method === 'item/started' ? 'running' : 'completed',
                    threadId: runtimeThreadId,
                    providerThreadId: runtimeProviderThreadId,
                    turnId,
                    itemId,
                    sourceMethod: method
                })
            })
            return
        }
        const collabActivity = itemType === 'collab agent tool call' ? buildCollabAgentActivity(item) : null
        if (collabActivity) {
            deps.emitRuntime({
                ...eventBase,
                type: 'activity',
                payload: collabActivity
            })
            return
        }
        const startedActivity = method === 'item/started' && isLiveToolItemType(itemType)
            ? buildToolActivity(item, itemType)
            : null
        if (startedActivity) {
            const activityItemId = readToolActivityItemId(item, itemId)
            deps.emitRuntime({
                ...eventBase,
                type: 'activity',
                payload: withCodexItemActivityId(startedActivity, activityItemId, startedActivity.kind === 'file-change' && activityItemId ? {
                    source: 'args-preview',
                    revision: nextCodexFileChangeRevision(context, activityItemId),
                    authoritative: false,
                    changes: readCodexStructuredChanges(item['changes'])
                } : undefined)
            })
            return
        }
        if (method === 'item/started') {
            return
        }
        const text = readTextValue(item['text']) || readTextValue(item['detail']) || readTextValue(item['summary'])

        if (isAssistantItemType(itemType)) {
            deps.emitRuntime({ ...eventBase, type: 'content.completed', payload: { streamKind: 'assistant_text', text } })
            return
        }
        if (itemType.includes('plan')) {
            deps.emitRuntime({ ...eventBase, type: 'content.completed', payload: { streamKind: 'plan_text', text } })
            return
        }

        const activity = buildToolActivity(item, itemType)
        if (activity) {
            const activityItemId = readToolActivityItemId(item, itemId)
            deps.emitRuntime({
                ...eventBase,
                type: 'activity',
                payload: withCodexItemActivityId(activity, activityItemId, activity.kind === 'file-change' && activityItemId ? {
                    source: 'provider-result',
                    revision: nextCodexFileChangeRevision(context, activityItemId),
                    authoritative: true,
                    changes: readCodexStructuredChanges(item['changes'])
                } : undefined)
            })
        }
        return
    }

    if (method === 'item/tool/requestUserInput/answered') {
        const answers = readResolvedUserInputAnswers(payload['answers'])
        deps.emitRuntime({
            ...eventBase,
            type: 'user-input.resolved',
            requestId: asString(payload['requestId']) || eventBase.itemId,
            payload: { answers }
        })
        return
    }

    if (method === 'codex/event/task_started' || method === 'codex/event/agent_reasoning' || method === 'codex/event/task_complete' || method === 'error') {
        deps.emitRuntime({
            ...eventBase,
            type: 'activity',
            payload: {
                kind: method,
                summary: method === 'codex/event/agent_reasoning' ? 'Reasoning update' : method.replace(/^codex\/event\//, '').replace(/\//g, ' '),
                detail: asString(asRecord(payload['msg'])?.['text'])
                    || asString(asRecord(payload['msg'])?.['last_agent_message'])
                    || asString(asRecord(payload['error'])?.['message'])
                    || asString(payload['message']),
                tone: method === 'error' ? 'error' : 'info',
                data: payload
            }
        })
    }
}
