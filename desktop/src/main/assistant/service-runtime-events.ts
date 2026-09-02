import type {
    AssistantActivity,
    AssistantDomainEvent,
    AssistantLatestTurn,
    AssistantPendingApproval,
    AssistantPendingUserInput,
    AssistantRuntimeEvent,
    AssistantSession,
    AssistantThread,
    FileChangeProvider,
    FileChangeSource
} from '../../shared/assistant/contracts'
import {
    extractFileChangePathsFromPatch,
    mergeNormalizedFileChangePayload,
    normalizeFileChangePayload,
    normalizeFileChangePath,
    sanitizeFileChangeRawPayload
} from '../../shared/assistant/contracts'
import { getAssistantModelNoticePresentation } from './assistant-failure-presentation'
import { createAssistantUserMessage } from './service-records'
import { createAssistantId, extractProposedPlanMarkdown } from './utils'

interface AssistantRuntimeEventHandlerDeps {
    planBuffers: Map<string, string>
    assistantTextBuffers: Map<string, string>
    isAssistantTextSuppressed: (threadId: string, turnId?: string | null) => boolean
    findSessionByThreadId: (threadId: string) => AssistantSession | null
    requireThread: (threadId: string) => AssistantThread
    findThreadRecord: (threadId: string) => { session: AssistantSession; thread: AssistantThread } | null
    queueAssistantTextDelta: (entry: {
        sessionId: string
        threadId: string
        messageId: string
        delta: string
        turnId: string | null
        occurredAt: string
    }) => void
    flushAssistantTextDelta: (target?: { threadId: string; messageId?: string }) => void
    queueAssistantActivityDelta: (entry: {
        sessionId: string
        threadId: string
        activityId: string
        turnId: string | null
        itemId?: string
        streamKind: 'reasoning_text' | 'reasoning_summary_text' | 'command_output' | 'file_change_output'
        delta: string
        occurredAt: string
    }) => void
    flushAssistantActivityDelta: (target?: { threadId: string; activityId?: string }) => void
    appendEvent: (
        type: AssistantDomainEvent['type'],
        occurredAt: string,
        payload: Record<string, unknown>,
        sessionId?: string,
        threadId?: string
    ) => void
    updateLatestTurnAssistantMessage: (sessionId: string, threadId: string, assistantMessageId: string, occurredAt: string) => void
    projectFleet: (threadId: string, snapshot: Extract<AssistantRuntimeEvent, { type: 'fleet.snapshot.updated' }>['payload']['snapshot']) => boolean
}

type RuntimeActivityPayload = Extract<AssistantRuntimeEvent, { type: 'activity' }>['payload']

function isOlderMismatchedTurnEvent(
    latestTurn: AssistantLatestTurn | null,
    eventTurnId: string | undefined,
    eventCreatedAt: string
): boolean {
    if (!latestTurn || !eventTurnId || latestTurn.id === eventTurnId) return false
    const latestStartedAtMs = Date.parse(latestTurn.startedAt || latestTurn.requestedAt)
    const eventCreatedAtMs = Date.parse(eventCreatedAt)
    return Number.isFinite(latestStartedAtMs)
        && Number.isFinite(eventCreatedAtMs)
        && eventCreatedAtMs < latestStartedAtMs
}

function resolveRuntimeEventTurnId(
    thread: AssistantThread,
    eventTurnId: string | undefined,
    eventCreatedAt: string
): string | null {
    if (eventTurnId) return eventTurnId
    const latestTurn = thread.latestTurn
    if (!latestTurn) return null
    const latestStartedAtMs = Date.parse(latestTurn.startedAt || latestTurn.requestedAt)
    const eventCreatedAtMs = Date.parse(eventCreatedAt)
    if (
        Number.isFinite(latestStartedAtMs)
        && Number.isFinite(eventCreatedAtMs)
        && eventCreatedAtMs < latestStartedAtMs
    ) return null
    return latestTurn.id
}

function buildCodexItemActivityId(itemId?: string): string | null {
    return itemId ? `codex-item-${itemId}` : null
}

function readRuntimePayloadString(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function readRuntimePayloadRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readRuntimeText(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (!value || typeof value !== 'object' || depth > 6) return ''
    if (seen.has(value)) return ''
    seen.add(value)

    if (Array.isArray(value)) {
        return value
            .map((entry) => readRuntimeText(entry, seen, depth + 1))
            .filter(Boolean)
            .join('\n')
            .trim()
    }

    const record = readRuntimePayloadRecord(value)
    if (!record) return ''
    if (readRuntimeText(record['type']) === 'text') {
        const text = readRuntimeText(record['text'], seen, depth + 1)
        if (text) return text
    }

    for (const key of ['text', 'value', 'message', 'output', 'stdout', 'stderr', 'error', 'content', 'parts', 'result', 'response', 'details']) {
        const text = readRuntimeText(record[key], seen, depth + 1)
        if (text) return text
    }

    return ''
}

function readRuntimeJsonEnvelopeText(value: unknown): string {
    if (typeof value !== 'string') return readRuntimeText(value)
    const text = value.trim()
    if (!/^[{[]/.test(text)) return text
    try {
        const parsed = JSON.parse(text) as unknown
        const unwrapped = readRuntimeText(parsed)
        return unwrapped && unwrapped !== text ? unwrapped : text
    } catch {
        return text
    }
}

function readRuntimeCommandValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map((entry) => typeof entry === 'string' ? entry.trim() : '')
            .filter(Boolean)
            .join(' ')
            .trim()
    }
    return readRuntimeJsonEnvelopeText(value)
}

function readRuntimeToolArguments(payload: Record<string, unknown>): Record<string, unknown> | null {
    return readRuntimePayloadRecord(payload['args'])
        || readRuntimePayloadRecord(payload['arguments'])
        || readRuntimePayloadRecord(payload['input'])
        || readRuntimePayloadRecord(payload['params'])
        || readRuntimePayloadRecord(payload['action'])
}

function readRuntimeNestedRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
    return readRuntimePayloadRecord(payload[key])
}

function readRuntimeToolName(payload: Record<string, unknown>): string {
    const server = readRuntimeJsonEnvelopeText(payload['server'] || payload['namespace'])
    const rawTool = readRuntimeJsonEnvelopeText(payload['toolName'] || payload['tool'] || payload['name'] || payload['execution'])
    if (server && rawTool && !rawTool.includes('.')) return `${server}.${rawTool}`
    return rawTool
}

function readRuntimeOutputText(payload: Record<string, unknown>): string {
    const result = readRuntimeNestedRecord(payload, 'result')
    const response = readRuntimeNestedRecord(payload, 'response')
    const candidates = [
        payload['output'],
        payload['stdout'],
        payload['stderr'],
        payload['aggregatedOutput'],
        payload['aggregated_output'],
        payload['formattedOutput'],
        payload['formatted_output'],
        payload['partialResult'],
        payload['content'],
        payload['details'],
        result?.['output'],
        result?.['stdout'],
        result?.['stderr'],
        result?.['content'],
        result?.['structuredContent'],
        response?.['output'],
        response?.['result'],
        response?.['content'],
        response?.['structuredContent'],
        payload['result'],
        payload['response']
    ]

    for (const candidate of candidates) {
        const text = readRuntimeJsonEnvelopeText(candidate)
        if (text) return text
    }
    return ''
}

function readRuntimeErrorText(payload: Record<string, unknown>): string {
    const error = readRuntimePayloadRecord(payload['error'])
    return readRuntimeJsonEnvelopeText(payload['error'])
        || readRuntimeJsonEnvelopeText(error?.['message'])
        || readRuntimeJsonEnvelopeText(error?.['error'])
        || readRuntimeJsonEnvelopeText(payload['errorMessage'])
        || readRuntimeJsonEnvelopeText(payload['error_message'])
}

function extractCommandFromText(value: string): string {
    const text = value.trim()
    if (!text) return ''
    const commandLine = text.match(/(?:^|\n)\s*Command:\s*([^\r\n]+)/i)
    if (commandLine?.[1]?.trim()) return commandLine[1].trim()
    const shellPrompt = text.match(/(?:^|\n)\s*\$\s+([^\r\n]+)/)
    if (shellPrompt?.[1]?.trim()) return shellPrompt[1].trim()
    return ''
}

function readRuntimeCommandText(payload: Record<string, unknown>): string {
    const args = readRuntimeToolArguments(payload)
    const action = readRuntimePayloadRecord(payload['action'])
    const candidates = [
        payload['command'],
        payload['cmd'],
        payload['script'],
        args?.['command'],
        args?.['cmd'],
        args?.['script'],
        action?.['command']
    ]
    for (const candidate of candidates) {
        const command = readRuntimeCommandValue(candidate)
        if (command) return command
    }

    return extractCommandFromText(readRuntimeOutputText(payload))
        || extractCommandFromText(readRuntimeJsonEnvelopeText(payload['detail']))
        || extractCommandFromText(readRuntimeJsonEnvelopeText(payload['details']))
}

function readRuntimeStringArray(value: unknown): string[] {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
    }
    if (!Array.isArray(value)) return []
    return value
        .flatMap((entry) => {
            if (typeof entry === 'string') return [entry.trim()]
            const record = readRuntimePayloadRecord(entry)
            return [
                record?.['path'],
                record?.['filePath'],
                record?.['file_path'],
                record?.['targetPath'],
                record?.['target_path'],
                record?.['name']
            ].map(readRuntimeJsonEnvelopeText)
        })
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function readRuntimeToolPaths(payload: Record<string, unknown>): string[] {
    const args = readRuntimeToolArguments(payload)
    const result = readRuntimeNestedRecord(payload, 'result')
    const candidates = [
        ...readRuntimeStringArray(payload['paths']),
        ...readRuntimeStringArray(payload['files']),
        ...readRuntimeStringArray(args?.['paths']),
        ...readRuntimeStringArray(args?.['files']),
        ...readRuntimeStringArray(result?.['paths']),
        ...readRuntimeStringArray(result?.['files'])
    ]
    for (const key of ['path', 'filePath', 'file_path', 'targetPath', 'target_path', 'sourcePath', 'source_path']) {
        candidates.push(...readRuntimeStringArray(payload[key]))
        candidates.push(...readRuntimeStringArray(args?.[key]))
        candidates.push(...readRuntimeStringArray(result?.[key]))
    }
    return [...new Set(candidates.map((entry) => entry.trim()).filter(Boolean))]
}

function normalizeRuntimeStatus(value: unknown, tone?: AssistantActivity['tone']): string {
    if (tone === 'error') return 'failed'
    const raw = readRuntimeJsonEnvelopeText(value).toLowerCase().replace(/[-_\s]/g, '')
    if (raw === 'running' || raw === 'inprogress' || raw === 'pending' || raw === 'started') return 'running'
    if (raw === 'error' || raw === 'failed' || raw === 'cancelled' || raw === 'declined') return 'failed'
    if (raw === 'complete' || raw === 'completed' || raw === 'success' || raw === 'succeeded') return 'completed'
    return readRuntimeJsonEnvelopeText(value)
}

function normalizeRuntimeCompactionStatus(value: unknown, tone?: AssistantActivity['tone']): string {
    const raw = readRuntimeJsonEnvelopeText(value).toLowerCase().replace(/[-_\s]/g, '')
    if (raw === 'cancelled' || raw === 'canceled' || raw === 'aborted' || raw === 'stopped') return 'cancelled'
    return normalizeRuntimeStatus(value, tone)
}

function isRuntimeShellToolName(value: string): boolean {
    return /\b(bash|shell|powershell|terminal|exec|command|cmd)\b/i.test(value)
}

function isRuntimeReadToolName(value: string): boolean {
    return /\b(read|open|cat|view)\b/i.test(value) && !/\b(thread|message)\b/i.test(value)
}

function chooseMergedOutput(previousOutput: unknown, incomingOutput: unknown): string | undefined {
    const previous = readRuntimePayloadString(previousOutput)
    const incoming = readRuntimePayloadString(incomingOutput)
    if (!previous && !incoming) return undefined
    if (!previous) return incoming
    if (!incoming) return previous
    if (previous === incoming) return incoming
    if (incoming.includes(previous)) return incoming
    if (previous.includes(incoming)) return previous
    if (incoming.length > previous.length * 1.5) return incoming
    return `${previous.replace(/\s+$/, '')}\n${incoming.replace(/^\s+/, '')}`.trim()
}

export function normalizeRuntimeActivityPayload(incoming: RuntimeActivityPayload): RuntimeActivityPayload {
    const data = { ...(incoming.data || {}) }
    const toolName = readRuntimeToolName(data)
    const command = readRuntimeCommandText(data)
    const output = readRuntimeOutputText(data)
    const errorText = readRuntimeErrorText(data)
    const paths = readRuntimeToolPaths(data)
    const status = incoming.kind === 'context.compaction'
        ? normalizeRuntimeCompactionStatus(data['status'] || data['state'] || data['phase'], incoming.tone)
        : normalizeRuntimeStatus(data['status'] || data['state'] || data['phase'], incoming.tone)
    const normalizedData: Record<string, unknown> = { ...data }

    if (toolName && !normalizedData['toolName']) normalizedData['toolName'] = toolName
    if (status) normalizedData['status'] = status
    if (command) normalizedData['command'] = command
    if (output) normalizedData['output'] = output
    if (errorText) normalizedData['errorMessage'] = errorText
    if (paths.length > 0) normalizedData['paths'] = paths

    const failed = incoming.tone === 'error' || status === 'failed' || Boolean(errorText)
    const args = readRuntimeToolArguments(data)
    const commandAction = readRuntimePayloadString(data['commandAction']) || readRuntimePayloadString(args?.['action'])
    const isCommandCheckpoint = incoming.kind === 'command.checkpoint'
        || readRuntimePayloadString(data['category']) === 'command-checkpoint'
        || /^(status|stop)$/i.test(commandAction)
    if (isCommandCheckpoint) {
        return {
            ...incoming,
            kind: 'command.checkpoint',
            tone: failed ? 'error' : incoming.tone,
            detail: readRuntimePayloadString(data['jobId'])
                || readRuntimePayloadString(args?.['jobId'])
                || readRuntimeJsonEnvelopeText(incoming.detail)
                || incoming.detail,
            data: {
                ...normalizedData,
                category: 'command-checkpoint',
                commandAction: commandAction.toLowerCase()
            }
        }
    }

    const isCommand = incoming.kind === 'command' || Boolean(command) || isRuntimeShellToolName(toolName)
    const isFileRead = incoming.kind === 'file-read' || (paths.length > 0 && isRuntimeReadToolName(toolName))

    if (isCommand) {
        return {
            ...incoming,
            kind: 'command',
            tone: failed ? 'error' : incoming.tone,
            summary: status === 'running' ? 'Running command' : failed ? 'Command failed' : incoming.summary || 'Ran command',
            detail: command || readRuntimeJsonEnvelopeText(incoming.detail) || toolName || incoming.detail,
            data: {
                ...normalizedData,
                command: command || toolName || 'command'
            }
        }
    }

    if (isFileRead) {
        return {
            ...incoming,
            kind: 'file-read',
            tone: failed ? 'error' : incoming.tone,
            summary: paths.length > 1 ? 'Read files' : incoming.summary || 'Read file',
            detail: paths.join('\n') || readRuntimeJsonEnvelopeText(incoming.detail) || toolName || incoming.detail,
            data: normalizedData
        }
    }

    return {
        ...incoming,
        tone: failed ? 'error' : incoming.tone,
        detail: readRuntimeJsonEnvelopeText(incoming.detail) || incoming.detail,
        data: normalizedData
    }
}

function hasOwnPayloadKey(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key)
}

function hasPayloadValue(payload: Record<string, unknown>, key: string): boolean {
    return hasOwnPayloadKey(payload, key) && payload[key] !== undefined && payload[key] !== null
}

function mergeActivityPayloads(
    previousPayload: Record<string, unknown>,
    incomingPayload: Record<string, unknown>
): Record<string, unknown> {
    const payload = { ...previousPayload }
    for (const [key, value] of Object.entries(incomingPayload)) {
        if (value === undefined) continue
        payload[key] = value
    }
    return payload
}

function outputSuffixPrefixOverlap(left: string, right: string): number {
    const max = Math.min(left.length, right.length)
    for (let size = max; size > 0; size -= 1) {
        if (left.slice(-size) === right.slice(0, size)) return size
    }
    return 0
}

function appendOrReplaceOutput(previousOutput: unknown, delta: string): string {
    const previous = typeof previousOutput === 'string' ? previousOutput : ''
    const incoming = String(delta || '')
    if (!previous) return incoming
    if (!incoming) return previous
    if (incoming === previous || previous.endsWith(incoming)) return previous
    if (incoming.startsWith(previous)) return incoming
    if (previous.includes(incoming) && (incoming.length >= 8 || /\r|\n/.test(incoming))) return previous
    const overlap = outputSuffixPrefixOverlap(previous, incoming)
    if (overlap > 0) return `${previous}${incoming.slice(overlap)}`
    return `${previous}${incoming}`
}

function mergeRuntimeActivity(
    existing: AssistantActivity | null,
    incoming: RuntimeActivityPayload,
    turnId: string | null,
    occurredAt: string
): AssistantActivity {
    const normalizedIncoming = normalizeRuntimeActivityPayload(incoming)
    const incomingPayload = { ...(normalizedIncoming.data || {}) }
    const previousPayload = { ...(existing?.payload || {}) }
    const payload = mergeActivityPayloads(previousPayload, incomingPayload)
    const replaceOutput = incomingPayload['replaceOutput'] === true
    if (replaceOutput && hasOwnPayloadKey(incomingPayload, 'output')) {
        payload['output'] = incomingPayload['output']
    } else {
        const mergedOutput = chooseMergedOutput(previousPayload['output'], incomingPayload['output'])
        if (mergedOutput) payload['output'] = mergedOutput
    }

    if (!hasPayloadValue(incomingPayload, 'output') && hasOwnPayloadKey(previousPayload, 'output')) {
        payload['output'] = previousPayload['output']
    }
    if (!hasPayloadValue(incomingPayload, 'patch') && hasOwnPayloadKey(previousPayload, 'patch')) {
        payload['patch'] = previousPayload['patch']
    }

    return {
        id: normalizedIncoming.activityId || existing?.id || createAssistantId('assistant-activity'),
        kind: normalizedIncoming.kind || existing?.kind || 'tool',
        tone: normalizedIncoming.tone || existing?.tone || 'tool',
        summary: normalizedIncoming.summary || existing?.summary || 'Tool activity',
        detail: normalizedIncoming.detail ?? existing?.detail,
        turnId: turnId || existing?.turnId || null,
        createdAt: existing?.createdAt || occurredAt,
        payload
    }
}

function inferFileChangeProvider(
    existing: AssistantActivity | null,
    incoming: RuntimeActivityPayload
): FileChangeProvider {
    const incomingData = incoming.data || {}
    const explicit = readRuntimePayloadString(incomingData['provider'])
    if (explicit === 'codex' || explicit === 'pi') return explicit
    const existingProvider = readRuntimePayloadString(existing?.payload?.['provider'])
    if (existingProvider === 'codex' || existingProvider === 'pi') return existingProvider
    const itemId = readRuntimePayloadString(incomingData['itemId'])
    const activityId = incoming.activityId || existing?.id || ''
    return itemId || activityId.startsWith('codex-item-') || activityId.startsWith('codex-turn-diff-') ? 'codex' : 'pi'
}

function inferFileChangeSource(data: Record<string, unknown>): FileChangeSource {
    const explicit = readRuntimePayloadString(data['source'])
    if (explicit === 'args-preview'
        || explicit === 'provider-live'
        || explicit === 'provider-result'
        || explicit === 'turn-final'
        || explicit === 'synthetic-snapshot') return explicit
    if (readRuntimePayloadString(data['category']) === 'turn-diff') return 'turn-final'
    return 'args-preview'
}

function mergeRuntimeFileChangeActivity(
    existing: AssistantActivity | null,
    incoming: RuntimeActivityPayload,
    turnId: string | null,
    occurredAt: string
): AssistantActivity {
    const normalizedIncoming = normalizeRuntimeActivityPayload(incoming)
    const isFileChange = normalizedIncoming.kind === 'file-change' || existing?.kind === 'file-change'
    if (!isFileChange) return mergeRuntimeActivity(existing, incoming, turnId, occurredAt)

    const provider = inferFileChangeProvider(existing, normalizedIncoming)
    const incomingData = sanitizeFileChangeRawPayload({ ...(normalizedIncoming.data || {}) })
    const existingData = sanitizeFileChangeRawPayload({ ...(existing?.payload || {}) })
    const startedAt = readRuntimePayloadString(existingData['startedAt']) || existing?.createdAt || occurredAt
    const incomingNormalized = normalizeFileChangePayload(incomingData, {
        provider,
        source: inferFileChangeSource(incomingData),
        startedAt
    })
    const mergedNormalized = existing
        ? mergeNormalizedFileChangePayload(
            normalizeFileChangePayload(existingData, {
                provider,
                source: inferFileChangeSource(existingData),
                startedAt
            }),
            incomingNormalized
        )
        : incomingNormalized
    const rawPayload = mergeActivityPayloads(existingData, incomingData)
    const output = incomingNormalized.output || readRuntimePayloadString(existingData['output'])
    const status = mergedNormalized.status

    return {
        id: normalizedIncoming.activityId || existing?.id || createAssistantId('assistant-activity'),
        kind: 'file-change',
        tone: status === 'failed' ? 'error' : normalizedIncoming.tone || existing?.tone || 'tool',
        summary: existing?.summary || normalizedIncoming.summary || (status === 'running' ? 'Editing files' : status === 'failed' ? 'File edit failed' : 'Edited files'),
        detail: existing?.detail || normalizedIncoming.detail || mergedNormalized.paths.join('\n') || undefined,
        turnId: turnId || existing?.turnId || null,
        createdAt: existing?.createdAt || occurredAt,
        payload: {
            ...rawPayload,
            ...mergedNormalized,
            output: output || undefined,
            replaceOutput: undefined
        }
    }
}

export function buildStreamingToolActivity(input: {
    existing: AssistantActivity | null
    activityId: string
    kind: 'command' | 'file-change'
    delta: string
    turnId: string | null
    itemId?: string
    occurredAt: string
}): AssistantActivity {
    const previousPayload = input.existing?.payload || {}
    const output = appendOrReplaceOutput(previousPayload['output'], input.delta)

    return {
        id: input.activityId,
        kind: input.existing?.kind || input.kind,
        tone: input.existing?.tone || 'tool',
        summary: input.existing?.summary || (input.kind === 'command' ? 'Running command' : 'Applying file changes'),
        detail: input.existing?.detail,
        turnId: input.turnId || input.existing?.turnId || null,
        createdAt: input.existing?.createdAt || input.occurredAt,
        payload: {
            ...previousPayload,
            itemId: input.itemId || readRuntimePayloadString(previousPayload['itemId']) || undefined,
            status: readRuntimePayloadString(previousPayload['status']) || 'inProgress',
            output
        }
    }
}

export function buildInternalTextActivity(input: {
    existing: AssistantActivity | null
    activityId: string
    text: string
    turnId: string | null
    itemId?: string
    occurredAt: string
    status: 'streaming' | 'completed'
    streamKind: 'reasoning_text' | 'reasoning_summary_text'
}): AssistantActivity {
    const previousPayload = input.existing?.payload || {}
    const existingOutput = readRuntimePayloadString(previousPayload['output'])
    const output = input.status === 'streaming'
        ? appendOrReplaceOutput(existingOutput, input.text)
        : input.text || existingOutput

    return {
        id: input.activityId,
        kind: 'assistant.internal',
        tone: 'tool',
        summary: 'Internal message',
        detail: output,
        turnId: input.turnId || input.existing?.turnId || null,
        createdAt: input.existing?.createdAt || input.occurredAt,
        payload: {
            ...previousPayload,
            category: 'assistant-internal',
            itemId: input.itemId || readRuntimePayloadString(previousPayload['itemId']) || undefined,
            streamKind: input.streamKind,
            status: input.status,
            output
        }
    }
}

function assistantTextBufferKey(threadId: string, messageId: string): string {
    return `${threadId}:${messageId}`
}

export function findFileChangeReconciliationTarget(
    activities: AssistantActivity[],
    turnId: string | null,
    incomingPayload: Record<string, unknown>
): AssistantActivity | null {
    const candidates = activities.filter((activity) => (
        activity.kind === 'file-change'
        && (!turnId || activity.turnId === turnId)
        && readRuntimePayloadString(activity.payload?.['category']) !== 'turn-diff'
    ))
    if (candidates.length === 0) return null

    const incomingPaths = [
        ...readRuntimeToolPaths(incomingPayload),
        ...extractFileChangePathsFromPatch(incomingPayload['patch'])
    ].map((path) => normalizeFileChangePath(path).toLowerCase())
    if (incomingPaths.length > 0) {
        const incomingSet = new Set(incomingPaths)
        const overlaps = candidates.filter((activity) => readRuntimeToolPaths(activity.payload || {})
            .map((path) => normalizeFileChangePath(path).toLowerCase())
            .some((path) => incomingSet.has(path)))
        return overlaps.length === 1 ? overlaps[0] : null
    }

    const incomplete = candidates.filter((activity) => {
        const status = readRuntimePayloadString(activity.payload?.['status']).toLowerCase().replace(/[-_\s]/g, '')
        return status === 'running'
            || status === 'inprogress'
            || activity.payload?.['authoritative'] !== true
    })
    return incomplete.length === 1 ? incomplete[0] : null
}

export function handleAssistantRuntimeEvent(event: AssistantRuntimeEvent, deps: AssistantRuntimeEventHandlerDeps): void {
    if (event.type === 'fleet.snapshot.updated') {
        const eventThreadRecord = deps.findThreadRecord(event.threadId)
        const eventSession = eventThreadRecord?.session || deps.findSessionByThreadId(event.threadId)
        const eventThreadId = eventThreadRecord?.thread.id || event.threadId
        if (!deps.projectFleet(eventThreadId, event.payload.snapshot)) return
        deps.appendEvent('fleet.snapshot.updated', event.createdAt, {
            threadId: eventThreadId,
            eventType: event.payload.eventType,
            event: event.payload.event,
            snapshot: event.payload.snapshot
        }, eventSession?.id, eventThreadId)
        return
    }

    let eventThreadRecord = deps.findThreadRecord(event.threadId)
    let eventSession = eventThreadRecord?.session || deps.findSessionByThreadId(event.threadId)
    let eventThreadId = eventThreadRecord?.thread.id || event.threadId
    const terminalSessionState = event.type === 'session.state.changed'
        && !['starting', 'running', 'waiting'].includes(event.payload.state)
    const shouldFlushActivityOutput = event.type === 'activity'
        || event.type === 'content.completed'
        || event.type === 'turn.completed'
        || terminalSessionState
    if (event.type === 'turn.completed' || terminalSessionState) {
        deps.flushAssistantTextDelta({ threadId: eventThreadId })
    }
    if (shouldFlushActivityOutput) {
        deps.flushAssistantActivityDelta({ threadId: eventThreadId })
        eventThreadRecord = deps.findThreadRecord(event.threadId)
        eventSession = eventThreadRecord?.session || deps.findSessionByThreadId(event.threadId)
        eventThreadId = eventThreadRecord?.thread.id || event.threadId
    }

    if (event.type === 'session.state.changed') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        const modelNotice = getAssistantModelNoticePresentation(
            event.payload.error || event.payload.message,
            existingThread.model
        )
        deps.appendEvent('thread.updated', event.createdAt, {
            threadId: eventThreadId,
            patch: {
                state: event.payload.state,
                lastError: modelNotice ? null : event.payload.error || null,
                updatedAt: event.createdAt
            }
        }, eventSession.id, eventThreadId)
        const hasConnectionRecoveryActivity = Boolean(event.turnId && existingThread.activities.some((activity) => (
            activity.turnId === event.turnId
            && activity.payload?.['category'] === 'connection-recovery'
        )))
        if (event.turnId && event.payload.message && !modelNotice && !hasConnectionRecoveryActivity) {
            deps.appendEvent('thread.activity.appended', event.createdAt, {
                threadId: eventThreadId,
                activity: {
                    id: createAssistantId('assistant-activity'),
                    kind: 'session.state',
                    tone: event.payload.error || event.payload.state === 'error' ? 'error' : 'info',
                    summary: event.payload.message,
                    turnId: event.turnId || null,
                    createdAt: event.createdAt
                }
            }, eventSession.id, eventThreadId)
        }
        return
    }

    if (event.type === 'session.config.updated') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        deps.appendEvent('thread.updated', event.createdAt, {
            threadId: eventThreadId,
            patch: {
                model: event.payload.model || existingThread.model,
                thinking: event.payload.thinking,
                profile: event.payload.profile,
                runtimeMode: event.payload.runtimeMode,
                webSearch: typeof event.payload.webSearch === 'boolean' ? event.payload.webSearch : existingThread.webSearch,
                webFetch: typeof event.payload.webFetch === 'boolean' ? event.payload.webFetch : existingThread.webFetch,
                updatedAt: event.createdAt
            }
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'thread.started') {
        const existing = deps.findThreadRecord(event.threadId)
        if (!existing && event.payload.source === 'subagent') {
            const parentProviderThreadId = event.payload.parentProviderThreadId || null
            const parentRecord = parentProviderThreadId ? deps.findThreadRecord(parentProviderThreadId) : null
            const parentThread = parentRecord?.thread || null
            const parentSession = parentRecord?.session || eventSession
            if (!parentSession) return

            const thread: AssistantThread = {
                id: createAssistantId('assistant-thread'),
                providerThreadId: event.payload.providerThreadId,
                source: 'subagent',
                parentThreadId: parentThread?.id || null,
                providerParentThreadId: parentProviderThreadId,
                subagentDepth: event.payload.subagentDepth ?? null,
                agentNickname: event.payload.agentNickname || null,
                agentRole: event.payload.agentRole || null,
                model: parentThread?.model || '',
                cwd: event.payload.cwd || parentThread?.cwd || null,
                messageCount: 0,
                activityCount: 0,
                proposedPlanCount: 0,
                lastSeenCompletedTurnId: null,
                runtimeMode: parentThread?.runtimeMode || 'approval-required',
                interactionMode: 'default',
                webSearch: parentThread?.webSearch ?? null,
                webFetch: parentThread?.webFetch ?? null,
                state: event.payload.state || 'ready',
                lastError: null,
                createdAt: event.createdAt,
                updatedAt: event.createdAt,
                latestTurn: null,
                hasPendingApprovals: false,
                hasPendingUserInputs: false,
                hasActivePlan: false,
                activePlan: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                pendingApprovals: [],
                pendingUserInputs: []
            }
            deps.appendEvent('thread.created', event.createdAt, {
                sessionId: parentSession.id,
                thread,
                makeActive: false
            }, parentSession.id, thread.id)
            return
        }

        if (!eventSession && !existing) return

        const targetThreadId = existing?.thread.id || event.threadId
        deps.appendEvent('thread.updated', event.createdAt, {
            threadId: targetThreadId,
            patch: {
                providerThreadId: event.payload.providerThreadId,
                source: event.payload.source || existing?.thread.source || 'root',
                providerParentThreadId: event.payload.parentProviderThreadId ?? existing?.thread.providerParentThreadId ?? null,
                parentThreadId: existing?.thread.parentThreadId || null,
                subagentDepth: event.payload.subagentDepth ?? existing?.thread.subagentDepth ?? null,
                agentNickname: event.payload.agentNickname ?? existing?.thread.agentNickname ?? null,
                agentRole: event.payload.agentRole ?? existing?.thread.agentRole ?? null,
                cwd: event.payload.cwd ?? existing?.thread.cwd ?? null,
                state: event.payload.state || 'ready',
                updatedAt: event.createdAt
            }
        }, existing?.session.id || eventSession!.id, targetThreadId)
        return
    }

    if (event.type === 'user.message.received') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        if (existingThread.messages.some((message) => message.id === event.payload.messageId)) return
        deps.appendEvent('thread.message.user', event.createdAt, {
            threadId: eventThreadId,
            message: {
                ...createAssistantUserMessage(event.payload.text, event.createdAt, event.payload.messageId),
                turnId: event.turnId || null
            }
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'turn.started') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        if (isOlderMismatchedTurnEvent(existingThread.latestTurn, event.turnId, event.createdAt)) return
        deps.appendEvent('thread.updated', event.createdAt, {
            threadId: eventThreadId,
            patch: {
                state: 'running',
                model: event.payload.model || existingThread.model,
                thinking: event.payload.effort || existingThread.thinking || null,
                profile: event.payload.profile || existingThread.profile || null,
                interactionMode: 'default',
                lastError: null,
                activePlan: null,
                updatedAt: event.createdAt
            }
        }, eventSession.id, eventThreadId)
        const turnId = event.turnId
            || (existingThread.latestTurn?.state === 'running' ? existingThread.latestTurn.id : createAssistantId('assistant-turn'))
        const continuesExistingTurn = existingThread.latestTurn?.id === turnId
            && existingThread.latestTurn.state === 'running'
        const latestTurn: AssistantLatestTurn = continuesExistingTurn
            ? {
                ...existingThread.latestTurn!,
                state: 'running',
                completedAt: null,
                effort: event.payload.effort || existingThread.latestTurn!.effort || null,
                serviceTier: event.payload.serviceTier || existingThread.latestTurn!.serviceTier || null
            }
            : {
                id: turnId,
                state: 'running',
                requestedAt: event.createdAt,
                startedAt: event.createdAt,
                completedAt: null,
                assistantMessageId: null,
                effort: event.payload.effort || null,
                serviceTier: event.payload.serviceTier || null,
                usage: null
            }
        deps.appendEvent('thread.latest-turn.updated', event.createdAt, {
            threadId: eventThreadId,
            latestTurn
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'turn.completed') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        if (isOlderMismatchedTurnEvent(existingThread.latestTurn, event.turnId, event.createdAt)) return
        const modelNotice = getAssistantModelNoticePresentation(event.payload.errorMessage, existingThread.model)
        const completedTurnState = modelNotice
            ? 'interrupted'
            : event.payload.outcome === 'completed'
                ? 'completed'
                : event.payload.outcome === 'interrupted' || event.payload.outcome === 'cancelled'
                    ? 'interrupted'
                    : 'error'
        const completionMatchesLatestTurn = Boolean(
            existingThread.latestTurn
            && (!event.turnId || existingThread.latestTurn.id === event.turnId)
        )
        const latestTurn: AssistantLatestTurn = completionMatchesLatestTurn
            ? {
                ...existingThread.latestTurn!,
                state: completedTurnState,
                completedAt: event.createdAt,
                effort: event.payload.effort || existingThread.latestTurn!.effort || null,
                serviceTier: event.payload.serviceTier || existingThread.latestTurn!.serviceTier || null,
                usage: event.payload.usage || existingThread.latestTurn!.usage || null
            }
            : {
                id: event.turnId || createAssistantId('assistant-turn'),
                state: completedTurnState,
                requestedAt: event.createdAt,
                startedAt: event.createdAt,
                completedAt: event.createdAt,
                assistantMessageId: null,
                effort: event.payload.effort || null,
                serviceTier: event.payload.serviceTier || null,
                usage: event.payload.usage || null
            }
        deps.appendEvent('thread.latest-turn.updated', event.createdAt, { threadId: eventThreadId, latestTurn }, eventSession.id, eventThreadId)
        deps.appendEvent('thread.updated', event.createdAt, {
            threadId: eventThreadId,
            patch: {
                state: modelNotice || event.payload.outcome === 'completed'
                    ? 'ready'
                    : event.payload.outcome === 'failed'
                        ? 'error'
                        : 'interrupted',
                canonicalPresence: event.sourceSequence
                    ? {
                        ...(existingThread.canonicalPresence || {
                            state: 'ready',
                            activeTurnId: null,
                            clients: [],
                            backgroundWorkActive: false
                        }),
                        state: 'ready',
                        activeTurnId: null,
                        latestSequence: event.sourceSequence
                    }
                    : existingThread.canonicalPresence,
                lastError: modelNotice ? null : event.payload.errorMessage || null,
                updatedAt: event.createdAt
            }
        }, eventSession.id, eventThreadId)
        if (modelNotice) {
            deps.appendEvent('thread.activity.appended', event.createdAt, {
                threadId: eventThreadId,
                activity: {
                    id: createAssistantId('assistant-model-notice'),
                    kind: 'model.notice',
                    tone: 'warning',
                    summary: modelNotice.title,
                    detail: modelNotice.message,
                    turnId: event.turnId || null,
                    createdAt: event.createdAt,
                    payload: {
                        category: 'model-notice',
                        noticeKind: modelNotice.kind,
                        model: modelNotice.model,
                        rawMessage: modelNotice.rawMessage
                    }
                }
            }, eventSession.id, eventThreadId)
        }
        return
    }

    if (event.type === 'thread.token-usage.updated') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        if (isOlderMismatchedTurnEvent(existingThread.latestTurn, event.turnId, event.createdAt)) return
        const usageMatchesLatestTurn = Boolean(
            existingThread.latestTurn
            && (!event.turnId || existingThread.latestTurn.id === event.turnId)
        )
        const latestTurn: AssistantLatestTurn = usageMatchesLatestTurn
            ? {
                ...existingThread.latestTurn!,
                usage: {
                    ...(existingThread.latestTurn!.usage || {}),
                    ...event.payload.usage
                }
            }
            : {
                id: event.turnId || createAssistantId('assistant-turn'),
                state: 'running',
                requestedAt: event.createdAt,
                startedAt: event.createdAt,
                completedAt: null,
                assistantMessageId: null,
                effort: null,
                serviceTier: null,
                usage: event.payload.usage
            }
        deps.appendEvent('thread.latest-turn.updated', event.createdAt, { threadId: eventThreadId, latestTurn }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'content.delta' && event.payload.streamKind === 'assistant_text') {
        if (!eventSession) return
        const resolvedTurnId = resolveRuntimeEventTurnId(
            eventThreadRecord?.thread || deps.requireThread(eventThreadId),
            event.turnId,
            event.createdAt
        )
        if (deps.isAssistantTextSuppressed(eventThreadId, resolvedTurnId)) return
        const messageId = `assistant-message-${event.itemId || event.turnId || event.eventId}`
        const key = assistantTextBufferKey(eventThreadId, messageId)
        deps.assistantTextBuffers.set(key, `${deps.assistantTextBuffers.get(key) || ''}${event.payload.delta}`)
        deps.queueAssistantTextDelta({
            sessionId: eventSession.id,
            threadId: eventThreadId,
            messageId,
            delta: event.payload.delta,
            turnId: resolvedTurnId,
            occurredAt: event.createdAt
        })
        deps.updateLatestTurnAssistantMessage(eventSession.id, eventThreadId, messageId, event.createdAt)
        return
    }

    if (event.type === 'content.completed' && event.payload.streamKind === 'assistant_text') {
        if (!eventSession) return
        const messageId = `assistant-message-${event.itemId || event.turnId || event.eventId}`
        const thread = eventThreadRecord?.thread || deps.requireThread(eventThreadId)
        const existing = thread.messages.find((message) => message.id === messageId)
        const resolvedTurnId = existing?.turnId || resolveRuntimeEventTurnId(thread, event.turnId, event.createdAt)
        if (deps.isAssistantTextSuppressed(eventThreadId, resolvedTurnId)) return
        deps.flushAssistantTextDelta({ threadId: eventThreadId, messageId })
        const key = assistantTextBufferKey(eventThreadId, messageId)
        const bufferedText = deps.assistantTextBuffers.get(key) || ''
        deps.assistantTextBuffers.delete(key)
        const completedText = String(event.payload.text || bufferedText || '')
        const hasAssistantText = Boolean(completedText)
        if (!existing && completedText) {
            deps.appendEvent('thread.message.assistant.delta', event.createdAt, {
                threadId: eventThreadId,
                messageId,
                delta: completedText,
                turnId: resolvedTurnId
            }, eventSession.id, eventThreadId)
        }
        if (!existing && !hasAssistantText) return
        deps.appendEvent('thread.message.assistant.completed', event.createdAt, {
            threadId: eventThreadId,
            messageId,
            text: completedText,
            turnId: resolvedTurnId
        }, eventSession.id, eventThreadId)
        deps.updateLatestTurnAssistantMessage(eventSession.id, eventThreadId, messageId, event.createdAt)

        const planMarkdown = extractProposedPlanMarkdown(completedText)
        if (planMarkdown) {
            deps.appendEvent('thread.proposed-plan.upserted', event.createdAt, {
                threadId: eventThreadId,
                plan: {
                    id: `assistant-plan-${event.turnId || event.itemId || event.eventId}`,
                    turnId: resolvedTurnId,
                    planMarkdown,
                    createdAt: event.createdAt,
                    updatedAt: event.createdAt
                }
            }, eventSession.id, eventThreadId)
        }
        return
    }

    if (event.type === 'content.delta' && (event.payload.streamKind === 'reasoning_text' || event.payload.streamKind === 'reasoning_summary_text')) {
        if (!eventSession) return
        const activityId = `assistant-internal-${event.itemId || event.turnId || event.eventId}`
        deps.queueAssistantActivityDelta({
            sessionId: eventSession.id,
            threadId: eventThreadId,
            activityId,
            turnId: event.turnId || null,
            itemId: event.itemId,
            streamKind: event.payload.streamKind,
            delta: event.payload.delta,
            occurredAt: event.createdAt
        })
        return
    }

    if (event.type === 'content.completed' && (event.payload.streamKind === 'reasoning_text' || event.payload.streamKind === 'reasoning_summary_text')) {
        if (!eventSession) return
        const activityId = `assistant-internal-${event.itemId || event.turnId || event.eventId}`
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        const existingActivity = existingThread.activities.find((activity) => activity.id === activityId) || null
        const text = String(event.payload.text || '')
        if (!existingActivity && !text.trim()) return
        const activity = buildInternalTextActivity({
            existing: existingActivity,
            activityId,
            text,
            turnId: event.turnId || null,
            itemId: event.itemId,
            occurredAt: event.createdAt,
            status: 'completed',
            streamKind: event.payload.streamKind
        })
        deps.appendEvent('thread.activity.appended', event.createdAt, { threadId: eventThreadId, activity }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'content.completed' && (event.payload.streamKind === 'command_output' || event.payload.streamKind === 'file_change_output')) {
        if (!eventSession) return
        const activityId = buildCodexItemActivityId(event.itemId)
            || `assistant-stream-${event.payload.streamKind}-${event.turnId || eventThreadId}`
        const existingThread = eventThreadRecord?.thread || deps.requireThread(eventThreadId)
        const existingActivity = existingThread.activities.find((activity) => activity.id === activityId) || null
        const completedText = String(event.payload.text || '')
        if (!existingActivity && !completedText) return
        const activity = buildStreamingToolActivity({
            existing: existingActivity,
            activityId,
            kind: event.payload.streamKind === 'command_output' ? 'command' : 'file-change',
            delta: completedText,
            turnId: event.turnId || null,
            itemId: event.itemId,
            occurredAt: event.createdAt
        })
        activity.payload = {
            ...(activity.payload || {}),
            status: 'completed'
        }
        deps.appendEvent('thread.activity.appended', event.createdAt, {
            threadId: eventThreadId,
            activity
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'content.delta' && event.payload.streamKind === 'plan_text') {
        const key = `${eventThreadId}:${event.turnId || event.itemId || 'active'}`
        deps.planBuffers.set(key, `${deps.planBuffers.get(key) || ''}${event.payload.delta}`)
        return
    }

    if (event.type === 'content.completed' && event.payload.streamKind === 'plan_text') {
        if (!eventSession) return
        const key = `${eventThreadId}:${event.turnId || event.itemId || 'active'}`
        const buffered = deps.planBuffers.get(key) || ''
        const planMarkdown = String(event.payload.text || buffered || '').trim()
        deps.planBuffers.delete(key)
        if (planMarkdown) {
            deps.appendEvent('thread.proposed-plan.upserted', event.createdAt, {
                threadId: eventThreadId,
                plan: {
                    id: `assistant-plan-${event.turnId || event.itemId || event.eventId}`,
                    turnId: event.turnId || null,
                    planMarkdown,
                    createdAt: event.createdAt,
                    updatedAt: event.createdAt
                }
            }, eventSession.id, eventThreadId)
        }
        return
    }

    if (event.type === 'content.delta' && (event.payload.streamKind === 'command_output' || event.payload.streamKind === 'file_change_output')) {
        if (!eventSession) return
        const activityId = buildCodexItemActivityId(event.itemId)
            || `assistant-stream-${event.payload.streamKind}-${event.turnId || eventThreadId}`
        deps.queueAssistantActivityDelta({
            sessionId: eventSession.id,
            threadId: eventThreadId,
            activityId,
            turnId: event.turnId || null,
            itemId: event.itemId,
            streamKind: event.payload.streamKind,
            delta: event.payload.delta,
            occurredAt: event.createdAt
        })
        return
    }

    if (event.type === 'plan.updated') {
        if (!eventSession) return
        deps.appendEvent('thread.plan.updated', event.createdAt, {
            threadId: eventThreadId,
            activePlan: {
                explanation: event.payload.explanation,
                plan: event.payload.plan,
                turnId: event.turnId || null,
                updatedAt: event.createdAt
            }
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'approval.requested' || event.type === 'approval.resolved') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        const current = existingThread.pendingApprovals.find((entry) => entry.requestId === event.requestId)
        const approval: AssistantPendingApproval = current
            ? {
                ...current,
                status: event.type === 'approval.requested' ? 'pending' : 'resolved',
                decision: event.type === 'approval.resolved' ? event.payload.decision : current.decision,
                resolvedAt: event.type === 'approval.resolved' ? event.createdAt : current.resolvedAt
            }
            : {
                id: createAssistantId('assistant-approval'),
                requestId: event.requestId || createAssistantId('assistant-request'),
                requestType: event.type === 'approval.requested' ? event.payload.requestType : 'command',
                title: event.type === 'approval.requested' ? event.payload.title : undefined,
                detail: event.type === 'approval.requested' ? event.payload.detail : undefined,
                command: event.type === 'approval.requested' ? event.payload.command : undefined,
                paths: event.type === 'approval.requested' ? event.payload.paths : undefined,
                status: event.type === 'approval.requested' ? 'pending' : 'resolved',
                decision: event.type === 'approval.resolved' ? event.payload.decision : null,
                turnId: event.turnId || null,
                createdAt: event.createdAt,
                resolvedAt: event.type === 'approval.resolved' ? event.createdAt : null
            }
        deps.appendEvent('thread.approval.updated', event.createdAt, { threadId: eventThreadId, approval }, eventSession.id, eventThreadId)
        deps.appendEvent('thread.activity.appended', event.createdAt, {
            threadId: eventThreadId,
            activity: {
                id: createAssistantId('assistant-activity'),
                kind: event.type === 'approval.requested' ? 'approval.requested' : 'approval.resolved',
                tone: 'info',
                summary: event.type === 'approval.requested' ? 'Approval requested' : 'Approval resolved',
                detail: approval.detail,
                turnId: event.turnId || null,
                createdAt: event.createdAt,
                payload: {
                    requestId: approval.requestId,
                    requestType: approval.requestType,
                    decision: approval.decision,
                    command: approval.command,
                    paths: approval.paths,
                    detail: approval.detail,
                    title: approval.title
                }
            }
        }, eventSession.id, eventThreadId)
        return
    }

    if (event.type === 'user-input.requested' || event.type === 'user-input.resolved') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        const current = existingThread.pendingUserInputs.find((entry) => entry.requestId === event.requestId)
        const wasAlreadyResolved = current?.status === 'resolved'
        const userInput: AssistantPendingUserInput = current
            ? {
                ...current,
                status: event.type === 'user-input.requested' ? 'pending' : 'resolved',
                answers: event.type === 'user-input.resolved' ? event.payload.answers : current.answers,
                resolvedAt: event.type === 'user-input.resolved' ? event.createdAt : current.resolvedAt
            }
            : {
                id: createAssistantId('assistant-user-input'),
                requestId: event.requestId || createAssistantId('assistant-request'),
                questions: event.type === 'user-input.requested' ? event.payload.questions : [],
                status: event.type === 'user-input.requested' ? 'pending' : 'resolved',
                answers: event.type === 'user-input.resolved' ? event.payload.answers : null,
                turnId: event.turnId || null,
                createdAt: event.createdAt,
                resolvedAt: event.type === 'user-input.resolved' ? event.createdAt : null
            }
        deps.appendEvent('thread.user-input.updated', event.createdAt, { threadId: eventThreadId, userInput }, eventSession.id, eventThreadId)
        if (event.type === 'user-input.resolved' && !wasAlreadyResolved) {
            const answers = event.payload.answers || {}
            const answeredCount = Object.values(answers).filter((value) => {
                if (Array.isArray(value)) return value.length > 0
                return String(value || '').trim().length > 0
            }).length
            deps.appendEvent('thread.activity.appended', event.createdAt, {
                threadId: eventThreadId,
                activity: {
                    id: createAssistantId('assistant-activity'),
                    kind: 'user-input.resolved',
                    tone: 'tool',
                    summary: 'Consulted user',
                    detail: `${answeredCount}/${userInput.questions.length} answers captured`,
                    turnId: event.turnId || null,
                    createdAt: event.createdAt,
                    payload: {
                        requestId: userInput.requestId,
                        questions: userInput.questions,
                        answers,
                        answeredCount,
                        questionCount: userInput.questions.length
                    }
                }
            }, eventSession.id, eventThreadId)
        }
        return
    }

    if (event.type === 'activity') {
        if (!eventSession) return
        const existingThread = eventThreadRecord?.thread || deps.requireThread(event.threadId)
        const payload = { ...(event.payload.data || {}) }
        const senderRecord = typeof payload['senderThreadId'] === 'string' ? deps.findThreadRecord(String(payload['senderThreadId'])) : null
        const receiverProviderThreadIds = Array.isArray(payload['receiverThreadIds'])
            ? payload['receiverThreadIds'].filter((entry): entry is string => typeof entry === 'string')
            : []
        const receiverRecords = receiverProviderThreadIds
            .map((threadId) => deps.findThreadRecord(threadId))
            .filter(Boolean) as Array<{ session: AssistantSession; thread: AssistantThread }>
        if (senderRecord) {
            payload['senderLocalThreadId'] = senderRecord.thread.id
        }
        if (receiverRecords.length > 0) {
            payload['receiverLocalThreadIds'] = receiverRecords.map((entry) => entry.thread.id)
            payload['receiverThreadLabels'] = receiverRecords.map((entry) => ({
                threadId: entry.thread.id,
                providerThreadId: entry.thread.providerThreadId,
                label: entry.thread.agentNickname || entry.thread.agentRole || 'Subagent',
                role: entry.thread.agentRole || null,
                nickname: entry.thread.agentNickname || null,
                state: entry.thread.state
            }))
        }
        const turnId = event.turnId || null
        const turnDiffTargetActivity = readRuntimePayloadString(payload['category']) === 'turn-diff'
            ? findFileChangeReconciliationTarget(existingThread.activities, turnId, payload)
            : null
        if (turnDiffTargetActivity) {
            payload['category'] = readRuntimePayloadString(turnDiffTargetActivity.payload?.['category']) || 'file-change'
        }
        const targetActivityId = turnDiffTargetActivity?.id || event.payload.activityId
        const existingActivity = targetActivityId
            ? existingThread.activities.find((activity) => activity.id === targetActivityId) || null
            : null
        const activity = mergeRuntimeFileChangeActivity(
            existingActivity,
            {
                ...event.payload,
                activityId: targetActivityId,
                data: payload
            },
            turnId,
            event.createdAt
        )
        deps.appendEvent('thread.activity.appended', event.createdAt, {
            threadId: eventThreadId,
            activity
        }, eventSession.id, eventThreadId)
    }
}
