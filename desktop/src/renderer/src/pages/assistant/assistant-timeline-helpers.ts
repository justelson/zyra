import { buildRenderableFileChangePatch } from '@shared/assistant/contracts/file-change'
import { parseAgentSurfaceDescriptor } from '@shared/assistant/contracts'
import type { AssistantActivity, AssistantMessage, AssistantPendingUserInput, AssistantProposedPlan } from '@shared/assistant/contracts'
import {
    ASSISTANT_TIMELINE_KIND_RANK,
    compareAssistantTimelineStrings,
    normalizeAssistantTimelineSequence
} from '@shared/assistant/timeline-order'
import {
    getSerializedAttachmentDisplayName,
    isSerializedClipboardAttachment,
    parseSerializedAssistantMessage
} from '@shared/assistant/message-attachments'
import { estimateMarkdownContentHeight } from '@/lib/text-layout/markdown-blocks'
import { stripProposedPlanBlocks } from './assistant-proposed-plan'
import {
    estimateAttachmentGridHeight,
    getAssistantMessageWidth,
    getPlanCardContentWidth,
    getUserMessageBodyWidth,
    measureTimelinePlainTextHeight
} from './assistant-timeline-text-metrics'

export type TimelineEntry =
    | { id: string; createdAt: string; timelineSequence?: number; type: 'message'; message: AssistantMessage }
    | { id: string; createdAt: string; timelineSequence?: number; type: 'plan'; plan: AssistantProposedPlan; canImplement: boolean }
    | { id: string; createdAt: string; timelineSequence?: number; type: 'activity'; activity: AssistantActivity }
    | { id: string; createdAt: string; timelineSequence?: number; type: 'activity-group'; activities: AssistantActivity[] }
    | { id: string; createdAt: string; timelineSequence?: number; type: 'user-input'; input: AssistantPendingUserInput }

export type TimelineRenderRow =
    | { kind: 'message'; id: string; createdAt: string; message: AssistantMessage }
    | { kind: 'plan'; id: string; createdAt: string; plan: AssistantProposedPlan; canImplement: boolean }
    | { kind: 'activity'; id: string; createdAt: string; activity: AssistantActivity }
    | { kind: 'activity-group'; id: string; createdAt: string; activities: AssistantActivity[] }
    | { kind: 'thought-group'; id: string; createdAt: string; activities: AssistantActivity[] }
    | { kind: 'command-checkpoint-group'; id: string; createdAt: string; activities: AssistantActivity[] }
    | { kind: 'work-trace-group'; id: string; createdAt: string; activities: AssistantActivity[] }
    | { kind: 'user-input'; id: string; createdAt: string; input: AssistantPendingUserInput }
    | { kind: 'working'; id: string; createdAt: string | null }

export type TimelineTurnWorkSummaryRow = {
    kind: 'turn-work-summary'
    id: string
    createdAt: string
    turnId: string | null
    startedAt: string
    completedAt: string | null
    running: boolean
    terminalResponseVisible: boolean
    outcome: 'completed' | 'interrupted' | 'failed' | 'no-response' | null
    rows: TimelineRenderRow[]
    liveNarrationRow: TimelineRenderRow | null
}

export type TimelineDisplayRow = TimelineRenderRow | TimelineTurnWorkSummaryRow

export type ParsedUserAttachment = {
    id: string
    name: string
    displayName: string
    type: string
    path: string | null
    mime: string | null
    size: string | null
    preview: string | null
    note: string | null
    origin: string | null
    content: string | null
    isClipboard: boolean
}

export function shouldRenderActivity(activity: AssistantActivity): boolean {
    if (isInternalAssistantActivity(activity)) return false
    if (activity.kind === 'user-input.resolved') return false
    if (readActivityToolName(activity.payload || {}) === 'request_user_input') return false
    return activity.tone === 'tool'
        || activity.tone === 'warning'
        || activity.tone === 'error'
}

function normalizeAssistantWarningText(value: string): string {
    return value
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
}

export function isWarningOnlyAssistantMessage(message: AssistantMessage): boolean {
    if (message.role !== 'assistant') return false

    const text = normalizeAssistantWarningText(message.text || '')
    if (!text || text.includes('```') || text.length > 700) return false

    return /^warning occurred\b/i.test(text)
        || /^error occurred\b/i.test(text)
        || /\bthe shell wrapper timed out\b/i.test(text)
        || /\bshell wrapper timed out\b/i.test(text)
        || /\bcommand timed out after \d+(?:\.\d+)?\s*(?:milliseconds?|ms|seconds?|s)\b/i.test(text)
}

export function shouldRenderMessage(message: AssistantMessage): boolean {
    return !isWarningOnlyAssistantMessage(message)
}

export function isSubagentActivity(activity: AssistantActivity): boolean {
    return activity.kind.startsWith('subagent.') || readActivityString(activity.payload?.category) === 'subagent'
}

export function isVoiceStrongTaskActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'voice.strong-task'
        || readActivityString(activity.payload?.category) === 'voice-strong-task'
}

export function isContextCompactionActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'context.compaction'
        || readActivityString(activity.payload?.category) === 'context-compaction'
        || readActivityString(activity.payload?.itemType) === 'context compaction'
}

export function isInternalAssistantActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'assistant.internal'
        || readActivityString(activity.payload?.category) === 'assistant-internal'
}

export function isModelNoticeActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'model.notice'
        || readActivityString(activity.payload?.category) === 'model-notice'
}

function isToolLikeActivity(activity: AssistantActivity): boolean {
    if (isInternalAssistantActivity(activity)) return false
    const payload = activity.payload || {}
    const toolName = readActivityToolName(payload)
    return activity.tone === 'tool'
        || activity.kind === 'command'
        || activity.kind === 'tool'
        || activity.kind === 'file-read'
        || activity.kind === 'file-change'
        || activity.kind === 'search'
        || activity.kind === 'user-input.resolved'
        || activity.kind.startsWith('subagent.')
        || Boolean(toolName)
        || Boolean(readActivityCommandFromPayload(payload, activity.detail))
}

export function isAssistantConnectionRecoveryActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'connection.recovery'
        || activity.kind === 'provider.recovery'
        || readActivityString(activity.payload?.category) === 'connection-recovery'
}

export function isIssueActivity(activity: AssistantActivity): boolean {
    if (isModelNoticeActivity(activity) || isAssistantConnectionRecoveryActivity(activity)) return false
    if (activity.kind === 'process.stderr' || activity.kind === 'runtime.error') return true
    if (isToolLikeActivity(activity)) return false
    return activity.tone === 'warning' || activity.tone === 'error'
}

export function getActivityRenderGroupKind(activity: AssistantActivity): 'issue' | 'subagent' | 'tool' | null {
    if (isInternalAssistantActivity(activity)) return null
    if (isVoiceStrongTaskActivity(activity)) return null
    if (isModelNoticeActivity(activity)) return null
    if (isContextCompactionActivity(activity)) return null
    if (isCommandCheckpointActivity(activity)) return null
    if (isAssistantConnectionRecoveryActivity(activity)) return null
    if (isIssueActivity(activity)) return 'issue'
    if (isSubagentActivity(activity)) return 'subagent'
    if (isToolLikeActivity(activity)) return 'tool'
    return null
}

function readActivityString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function readActivityRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function getActivityAgentSurface(activity: AssistantActivity) {
    return parseAgentSurfaceDescriptor(activity.payload?.surface)
}

export type CommandCheckpointAction = 'status' | 'stop'

export function getTimelineActivityDomId(activityId: string): string {
    return `assistant-activity-${encodeURIComponent(activityId)}`
}

export function getTimelineMessageDomId(messageId: string): string {
    return `assistant-message-${encodeURIComponent(messageId)}`
}

export function getCommandCheckpointAction(activity: AssistantActivity): CommandCheckpointAction | null {
    const payload = activity.payload || {}
    const args = readActivityRecord(payload.args)
    const action = readActivityString(payload.commandAction) || readActivityString(args?.action)
    if (action === 'status' || action === 'stop') return action
    const hasManagedJobId = readActivityString(payload.jobId)
        || readActivityString(args?.jobId)
        || readActivityString(args?.job_id)
    const hasCommand = readActivityString(payload.command)
        || readActivityString(args?.command)
        || readActivityString(args?.cmd)
        || readActivityString(args?.script)
    return hasManagedJobId && !hasCommand ? 'status' : null
}

export function getCommandJobId(activity: AssistantActivity): string {
    const payload = activity.payload || {}
    const args = readActivityRecord(payload.args)
    const result = readActivityRecord(payload.result)
    const details = readActivityRecord(result?.details)
    const direct = readActivityString(payload.jobId)
        || readActivityString(args?.jobId)
        || readActivityString(args?.job_id)
        || readActivityString(result?.jobId)
        || readActivityString(result?.job_id)
        || readActivityString(details?.jobId)
        || readActivityString(details?.job_id)
    return direct
}

export function isCommandCheckpointActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'command.checkpoint'
        || readActivityString(activity.payload?.category) === 'command-checkpoint'
        || Boolean(getCommandCheckpointAction(activity) && getCommandJobId(activity))
}

export function findRelatedCommandActivityId(
    checkpoint: AssistantActivity,
    activities: AssistantActivity[]
): string | null {
    const direct = readActivityString(checkpoint.payload?.relatedCommandActivityId)
    if (direct) return direct

    const jobId = getCommandJobId(checkpoint)
    if (!jobId) return null
    let latestCandidate: AssistantActivity | null = null
    let latestSameTurnCandidate: AssistantActivity | null = null
    for (const activity of activities) {
        if (activity.id === checkpoint.id || isCommandCheckpointActivity(activity)) continue
        if (getCommandJobId(activity) !== jobId) continue
        if (activity.createdAt.localeCompare(checkpoint.createdAt) > 0) continue
        if (!latestCandidate || activity.createdAt.localeCompare(latestCandidate.createdAt) > 0) {
            latestCandidate = activity
        }
        if (
            checkpoint.turnId
            && activity.turnId === checkpoint.turnId
            && (!latestSameTurnCandidate || activity.createdAt.localeCompare(latestSameTurnCandidate.createdAt) > 0)
        ) {
            latestSameTurnCandidate = activity
        }
    }
    return latestSameTurnCandidate?.id || latestCandidate?.id || null
}

export function buildCommandCheckpointDisplayActivity(
    checkpoint: AssistantActivity,
    activities: AssistantActivity[]
): AssistantActivity {
    const relatedCommandActivityId = findRelatedCommandActivityId(checkpoint, activities)
    const relatedCommand = relatedCommandActivityId
        ? activities.find((activity) => activity.id === relatedCommandActivityId)
        : null
    const command = relatedCommand ? getActivityCommand(relatedCommand) : ''

    return {
        ...checkpoint,
        payload: {
            ...(checkpoint.payload || {}),
            command: command || checkpoint.summary || 'Command follow-up',
            relatedCommandActivityId: relatedCommandActivityId || undefined
        }
    }
}

function readActivityText(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (!value || typeof value !== 'object' || depth > 6) return ''
    if (seen.has(value)) return ''
    seen.add(value)

    if (Array.isArray(value)) {
        return value
            .map((entry) => readActivityText(entry, seen, depth + 1))
            .filter(Boolean)
            .join('\n')
            .trim()
    }

    const record = readActivityRecord(value)
    if (!record) return ''
    if (readActivityText(record.type, seen, depth + 1) === 'text') {
        const text = readActivityText(record.text, seen, depth + 1)
        if (text) return text
    }

    for (const key of ['text', 'value', 'message', 'output', 'stdout', 'stderr', 'error', 'content', 'parts', 'result', 'response', 'details']) {
        const text = readActivityText(record[key], seen, depth + 1)
        if (text) return text
    }

    return ''
}

function readActivityJsonEnvelopeText(value: unknown): string {
    if (typeof value !== 'string') return readActivityText(value)
    const text = value.trim()
    if (!/^[{[]/.test(text)) return text
    try {
        const parsed = JSON.parse(text) as unknown
        const unwrapped = readActivityText(parsed)
        return unwrapped && unwrapped !== text ? unwrapped : text
    } catch {
        return text
    }
}

function readActivityCommandValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map((entry) => typeof entry === 'string' ? entry.trim() : '')
            .filter(Boolean)
            .join(' ')
            .trim()
    }
    return readActivityJsonEnvelopeText(value)
}

function readActivityArguments(payload: Record<string, unknown>): Record<string, unknown> | null {
    return readActivityRecord(payload.args)
        || readActivityRecord(payload.arguments)
        || readActivityRecord(payload.input)
        || readActivityRecord(payload.params)
        || readActivityRecord(payload.action)
}

function extractActivityCommandFromText(value: string): string {
    const text = value.trim()
    if (!text) return ''
    const commandLine = text.match(/(?:^|\n)\s*Command:\s*([^\r\n]+)/i)
    if (commandLine?.[1]?.trim()) return commandLine[1].trim()
    const shellPrompt = text.match(/(?:^|\n)\s*\$\s+([^\r\n]+)/)
    if (shellPrompt?.[1]?.trim()) return shellPrompt[1].trim()
    return ''
}

function readActivityCommandFromPayload(payload: Record<string, unknown>, detail?: string): string {
    const args = readActivityArguments(payload)
    const action = readActivityRecord(payload.action)
    const candidates = [
        payload.command,
        payload.cmd,
        payload.script,
        args?.command,
        args?.cmd,
        args?.script,
        action?.command
    ]

    for (const candidate of candidates) {
        const command = readActivityCommandValue(candidate)
        if (command) return command
    }

    return extractActivityCommandFromText(readActivityOutputFromPayload(payload))
        || extractActivityCommandFromText(readActivityJsonEnvelopeText(payload.details))
        || extractActivityCommandFromText(detail || '')
}

function readActivityStringArray(value: unknown): string[] {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
    }
    if (!Array.isArray(value)) return []
    return value
        .flatMap((entry) => {
            if (typeof entry === 'string') return [entry.trim()]
            const record = readActivityRecord(entry)
            return [
                record?.path,
                record?.filePath,
                record?.file_path,
                record?.targetPath,
                record?.target_path,
                record?.name
            ].map(readActivityJsonEnvelopeText)
        })
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function stringifyActivityValue(value: unknown): string {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        try {
            return JSON.stringify(value, null, 2)
        } catch {
            return ''
        }
    }
    return ''
}

function readActivityOutputFromPayload(payload: Record<string, unknown>): string {
    const result = readActivityRecord(payload.result)
    const response = readActivityRecord(payload.response)
    const candidates = [
        payload.output,
        payload.stdout,
        payload.stderr,
        payload.aggregatedOutput,
        payload.aggregated_output,
        payload.formattedOutput,
        payload.formatted_output,
        payload.partialResult,
        payload.content,
        payload.details,
        result?.output,
        result?.stdout,
        result?.stderr,
        result?.content,
        result?.structuredContent,
        response?.output,
        response?.result,
        response?.content,
        response?.structuredContent
    ]
    for (const candidate of candidates) {
        const text = readActivityJsonEnvelopeText(candidate)
        if (text) return text
    }
    return readActivityJsonEnvelopeText(payload.result)
        || readActivityJsonEnvelopeText(payload.response)
        || stringifyActivityValue(payload.results)
        || stringifyActivityValue(payload.matches)
}

function readActivityToolName(payload: Record<string, unknown>): string {
    const server = readActivityJsonEnvelopeText(payload.server || payload.namespace)
    const rawTool = readActivityJsonEnvelopeText(payload.toolName || payload.tool || payload.name || payload.execution)
    if (server && rawTool && !rawTool.includes('.')) return `${server}.${rawTool}`
    return rawTool
}

function readActivityPathsFromPayload(payload: Record<string, unknown>, detail?: string): string[] {
    const args = readActivityArguments(payload)
    const result = readActivityRecord(payload.result)
    const normalizedChanges = Array.isArray(payload.changes) ? payload.changes : []
    const changePaths = normalizedChanges.flatMap((entry) => {
        const change = readActivityRecord(entry)
        return change ? readActivityStringArray(change.path || change.filePath || change.file_path) : []
    })
    const paths = [
        ...changePaths,
        ...readActivityStringArray(payload.paths),
        ...readActivityStringArray(payload.files),
        ...readActivityStringArray(args?.paths),
        ...readActivityStringArray(args?.files),
        ...readActivityStringArray(result?.paths),
        ...readActivityStringArray(result?.files),
        ...readActivityStringArray(payload.path),
        ...readActivityStringArray(payload.filePath),
        ...readActivityStringArray(payload.file_path),
        ...readActivityStringArray(args?.path),
        ...readActivityStringArray(args?.filePath),
        ...readActivityStringArray(args?.file_path),
        ...readActivityStringArray(result?.path),
        ...readActivityStringArray(result?.filePath),
        ...readActivityStringArray(result?.file_path)
    ]
    const uniquePaths = [...new Set(paths.map((entry) => entry.trim()).filter(Boolean))]
    if (uniquePaths.length > 0) return uniquePaths
    return readActivityString(detail)
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function readActivityNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}

function compareTimelinePosition(
    leftCreatedAt: string,
    rightCreatedAt: string,
    leftSequence?: number,
    rightSequence?: number
): number {
    const timeOrder = leftCreatedAt.localeCompare(rightCreatedAt)
    if (timeOrder !== 0) return timeOrder
    if (typeof leftSequence === 'number' && typeof rightSequence === 'number') {
        return leftSequence - rightSequence
    }
    return 0
}

export function areMessagesEqual(left: AssistantMessage, right: AssistantMessage): boolean {
    return left.id === right.id
        && left.role === right.role
        && left.text === right.text
        && left.turnId === right.turnId
        && left.streaming === right.streaming
        && left.timelineSequence === right.timelineSequence
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
}

const activityCommandCache = new WeakMap<AssistantActivity, string>()

export function getActivityCommand(activity: AssistantActivity): string {
    const cached = activityCommandCache.get(activity)
    if (cached !== undefined) return cached

    const payload = activity.payload || {}
    const surface = getActivityAgentSurface(activity)
    const toolName = readActivityToolName(payload)
    const paths = readActivityPathsFromPayload(payload, activity.detail)
    const isReadTool = /\b(read|open|cat|view)\b/i.test(toolName) && !/\b(thread|message)\b/i.test(toolName)
    const command = readActivityCommandFromPayload(payload, activity.detail)
        || surface?.command
        || readActivityString(payload.query)
        || (isReadTool ? paths[0] : '')
        || toolName
        || paths[0]
        || readActivityString(activity.detail)
        || activity.summary
    activityCommandCache.set(activity, command)
    return command
}

function groupAdjacentTimelineActivities(entries: TimelineEntry[]): TimelineEntry[] {
    const groupedEntries: TimelineEntry[] = []
    let pendingKind: 'issue' | 'subagent' | 'tool' | null = null
    let pendingTurnId: string | null | undefined
    let pendingActivities: AssistantActivity[] = []

    const flush = () => {
        if (pendingActivities.length === 0) return
        if (pendingActivities.length === 1) {
            const activity = pendingActivities[0]
            groupedEntries.push({
                id: activity.id,
                createdAt: activity.createdAt,
                timelineSequence: activity.timelineSequence,
                type: 'activity',
                activity
            })
        } else {
            groupedEntries.push({
                id: `${pendingKind || 'activity'}-group-${pendingActivities[0].id}`,
                createdAt: pendingActivities[0].createdAt,
                timelineSequence: pendingActivities[0].timelineSequence,
                type: 'activity-group',
                activities: pendingActivities
            })
        }
        pendingKind = null
        pendingTurnId = undefined
        pendingActivities = []
    }

    for (const entry of entries) {
        if (entry.type !== 'activity') {
            flush()
            groupedEntries.push(entry)
            continue
        }

        const groupKind = getActivityRenderGroupKind(entry.activity)
        if (!groupKind) {
            flush()
            groupedEntries.push(entry)
            continue
        }

        if (pendingKind && (pendingKind !== groupKind || pendingTurnId !== entry.activity.turnId)) {
            flush()
        }
        pendingKind = groupKind
        pendingTurnId = entry.activity.turnId
        pendingActivities.push(entry.activity)
    }

    flush()
    return groupedEntries
}

export function getActivityOutput(activity: AssistantActivity): string {
    const payload = activity.payload || {}
    return readActivityOutputFromPayload(payload)
}

export function getActivityPatch(activity: AssistantActivity): string | null {
    const rawPatch = readActivityString(activity.payload?.patch)
        || readActivityString(activity.payload?.previewPatch)
    if (activity.kind !== 'file-change') return rawPatch || null
    return buildRenderableFileChangePatch(
        rawPatch,
        activity.payload?.changes,
        readActivityPathsFromPayload(activity.payload || {}, activity.detail)
    ) || rawPatch || null
}

export function areActivitiesEquivalent(left: AssistantActivity, right: AssistantActivity): boolean {
    return left.id === right.id
        && left.kind === right.kind
        && left.tone === right.tone
        && left.summary === right.summary
        && left.detail === right.detail
        && left.turnId === right.turnId
        && left.timelineSequence === right.timelineSequence
        && left.createdAt === right.createdAt
        && getActivityCommand(left) === getActivityCommand(right)
        && getActivityOutput(left) === getActivityOutput(right)
        && getActivityPatch(left) === getActivityPatch(right)
        && getActivityStatus(left) === getActivityStatus(right)
        && getActivityElapsed(left) === getActivityElapsed(right)
        && left.payload?.actionBatchIntent === right.payload?.actionBatchIntent
        && left.payload?.relatedCommandActivityId === right.payload?.relatedCommandActivityId
}

export function areActivityListsEqual(left: AssistantActivity[], right: AssistantActivity[]): boolean {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (!areActivitiesEquivalent(left[index], right[index])) return false
    }
    return true
}

export function parseUserMessageAttachments(text: string): { body: string; attachments: ParsedUserAttachment[] } {
    const parsed = parseSerializedAssistantMessage(text)
    return {
        body: parsed.body,
        attachments: parsed.attachments.map((attachment, index) => ({
            id: `${attachment.name}-${index}`,
            name: attachment.name,
            displayName: getSerializedAttachmentDisplayName(attachment),
            type: attachment.type,
            path: attachment.path,
            mime: attachment.mime,
            size: attachment.size,
            preview: attachment.preview,
            note: attachment.note,
            origin: attachment.origin,
            content: attachment.content,
            isClipboard: isSerializedClipboardAttachment(attachment)
        }))
    }
}

export function isClipboardAttachmentReference(path: string | null): boolean {
    return String(path || '').trim().toLowerCase().startsWith('clipboard://')
}

export function canRenderAttachmentImage(path: string | null): boolean {
    const normalized = String(path || '').trim()
    return Boolean(normalized) && !normalized.startsWith('clipboard://')
}

export async function copyTextToClipboard(value: string): Promise<void> {
    const normalized = String(value || '')
    if (!normalized.trim()) return

    const result = await window.devscope.copyToClipboard?.(normalized)
    if (result && result.success === false) {
        throw new Error(result.error || 'Failed to copy to clipboard')
    }
    if (result) return

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized)
        return
    }

    const textarea = document.createElement('textarea')
    textarea.value = normalized
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!success) {
        throw new Error('Failed to copy to clipboard')
    }
}

export function formatWorkingTimer(startIso: string, endIso: string): string | null {
    const startedAtMs = Date.parse(startIso)
    const endedAtMs = Date.parse(endIso)
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return null

    const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000))
    if (elapsedSeconds < 60) return `${elapsedSeconds}s`

    const hours = Math.floor(elapsedSeconds / 3600)
    const minutes = Math.floor((elapsedSeconds % 3600) / 60)
    const seconds = elapsedSeconds % 60

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }

    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function getTimelineEntryKindRank(entry: TimelineEntry): number {
    return entry.type === 'message'
        ? ASSISTANT_TIMELINE_KIND_RANK.message
        : entry.type === 'plan'
            ? ASSISTANT_TIMELINE_KIND_RANK.plan
            : entry.type === 'user-input'
                ? ASSISTANT_TIMELINE_KIND_RANK.plan + 1
                : ASSISTANT_TIMELINE_KIND_RANK.activity
}

export function getAssistantTimelineMessageEntryId(message: AssistantMessage): string {
    const providerItemId = String(message.providerItemId || '').trim()
    if (message.modality === 'voice' && providerItemId) {
        return `voice-message:${message.role}:${providerItemId}`
    }
    return message.id
}

function getTimelineEntryRecordId(entry: TimelineEntry): string {
    if (entry.type === 'message') return entry.message.id
    if (entry.type === 'plan') return entry.plan.id
    if (entry.type === 'activity') return entry.activity.id
    if (entry.type === 'user-input') return entry.input.id
    return entry.activities[0]?.id || entry.id
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
    return compareAssistantTimelineStrings(left.createdAt, right.createdAt)
        || normalizeAssistantTimelineSequence(left.timelineSequence) - normalizeAssistantTimelineSequence(right.timelineSequence)
        || getTimelineEntryKindRank(left) - getTimelineEntryKindRank(right)
        || compareAssistantTimelineStrings(getTimelineEntryRecordId(left), getTimelineEntryRecordId(right))
}

function mergeOrderedTimelineEntryStreams(streams: TimelineEntry[][]): TimelineEntry[] {
    const ordered = streams.every((stream) => {
        for (let index = 1; index < stream.length; index += 1) {
            if (compareTimelineEntries(stream[index - 1]!, stream[index]!) > 0) return false
        }
        return true
    })
    if (!ordered) return streams.flat().sort(compareTimelineEntries)

    const positions = new Uint32Array(streams.length)
    const merged: TimelineEntry[] = []
    while (true) {
        let selectedStream = -1
        let selectedEntry: TimelineEntry | null = null
        for (let streamIndex = 0; streamIndex < streams.length; streamIndex += 1) {
            const entry = streams[streamIndex]![positions[streamIndex]!]
            if (!entry) continue
            if (!selectedEntry || compareTimelineEntries(entry, selectedEntry) < 0) {
                selectedEntry = entry
                selectedStream = streamIndex
            }
        }
        if (!selectedEntry || selectedStream < 0) break
        merged.push(selectedEntry)
        positions[selectedStream] += 1
    }
    return merged
}

export function getTimelineEntries(
    messages: AssistantMessage[],
    activities: AssistantActivity[],
    proposedPlans: AssistantProposedPlan[] = [],
    userInputs: AssistantPendingUserInput[] = []
): TimelineEntry[] {
    const renderedMessages = messages.filter(shouldRenderMessage)
    const renderedActivities = activities.filter(shouldRenderActivity)
    const chronologicalActivities = [...renderedActivities].reverse()
    const visibleMessageIds = new Set(renderedMessages.map((message) => message.id))
    const visibleTurnIds = new Set([
        ...renderedMessages.map((message) => message.turnId),
        ...renderedActivities.map((activity) => activity.turnId),
        ...proposedPlans.map((plan) => plan.turnId)
    ].filter((turnId): turnId is string => Boolean(turnId)))
    const visibleUserInputs = userInputs.filter((input) => (
        input.status === 'pending'
        || Boolean(input.turnId && visibleTurnIds.has(input.turnId))
        || Boolean(input.responseMessageId && visibleMessageIds.has(input.responseMessageId))
    ))
    const latestMessagesByDistinctTurn: AssistantMessage[] = []
    const seenLatestTurnIds = new Set<string>()
    for (let index = renderedMessages.length - 1; index >= 0 && latestMessagesByDistinctTurn.length < 2; index -= 1) {
        const message = renderedMessages[index]!
        const key = message.turnId || `message:${message.id}`
        if (seenLatestTurnIds.has(key)) continue
        seenLatestTurnIds.add(key)
        latestMessagesByDistinctTurn.push(message)
    }
    const messageEntries: TimelineEntry[] = renderedMessages.map((message) => ({
        id: getAssistantTimelineMessageEntryId(message),
        createdAt: message.createdAt,
        timelineSequence: message.timelineSequence,
        type: 'message' as const,
        message
    }))
    const activityEntries: TimelineEntry[] = chronologicalActivities.map((activity) => ({
        id: activity.id,
        createdAt: activity.createdAt,
        timelineSequence: activity.timelineSequence,
        type: 'activity' as const,
        activity
    }))
    const userInputEntries: TimelineEntry[] = visibleUserInputs.map((input) => ({
        id: `user-input-${input.id}`,
        createdAt: input.createdAt,
        type: 'user-input' as const,
        input
    }))
    const planEntries: TimelineEntry[] = proposedPlans.map((plan, index) => {
        const latestOtherTurnMessage = latestMessagesByDistinctTurn.find((message) => (
            !message.turnId || !plan.turnId || message.turnId !== plan.turnId
        ))
        const hasLaterMessage = Boolean(
            latestOtherTurnMessage
            && compareTimelinePosition(
                plan.createdAt,
                latestOtherTurnMessage.createdAt,
                plan.timelineSequence,
                latestOtherTurnMessage.timelineSequence
            ) < 0
        )
        return {
            id: `plan-${plan.id}-${index}`,
            createdAt: plan.createdAt,
            timelineSequence: plan.timelineSequence,
            type: 'plan' as const,
            plan,
            canImplement: !hasLaterMessage
        }
    })
    return groupAdjacentTimelineActivities(mergeOrderedTimelineEntryStreams([
        messageEntries,
        activityEntries,
        planEntries,
        userInputEntries
    ]))
}

export function buildTimelineRows(entries: TimelineEntry[], isWorking: boolean, activeWorkStartedAt: string | null): TimelineRenderRow[] {
    const rows: TimelineRenderRow[] = []

    for (const entry of entries) {
        let row: TimelineRenderRow
        if (entry.type === 'message') {
            row = { kind: 'message', id: entry.id, createdAt: entry.createdAt, message: entry.message }
        } else if (entry.type === 'plan') {
            row = { kind: 'plan', id: entry.id, createdAt: entry.createdAt, plan: entry.plan, canImplement: entry.canImplement }
        } else if (entry.type === 'activity-group') {
            row = { kind: 'activity-group', id: entry.id, createdAt: entry.createdAt, activities: entry.activities }
        } else if (entry.type === 'user-input') {
            row = { kind: 'user-input', id: entry.id, createdAt: entry.createdAt, input: entry.input }
        } else {
            row = { kind: 'activity', id: entry.id, createdAt: entry.createdAt, activity: entry.activity }
        }

        if (row.kind === 'activity' && isInternalAssistantActivity(row.activity)) {
            const previous = rows[rows.length - 1]
            const matchesThought = (activity: AssistantActivity) => (
                isInternalAssistantActivity(activity)
                && (activity.turnId || null) === (row.activity.turnId || null)
            )

            if (previous?.kind === 'thought-group' && previous.activities.every(matchesThought)) {
                previous.activities.push(row.activity)
                continue
            }
            if (previous?.kind === 'activity' && matchesThought(previous.activity)) {
                rows[rows.length - 1] = {
                    kind: 'thought-group',
                    id: `thought-group-${previous.id}`,
                    createdAt: previous.createdAt,
                    activities: [previous.activity, row.activity]
                }
                continue
            }
        }

        if (
            row.kind === 'activity'
            && isCommandCheckpointActivity(row.activity)
        ) {
            const action = getCommandCheckpointAction(row.activity)
            const previous = rows[rows.length - 1]
            const matchesCheckpoint = (activity: AssistantActivity) => (
                isCommandCheckpointActivity(activity)
                && getCommandCheckpointAction(activity) === action
                && (activity.turnId || null) === (row.activity.turnId || null)
            )

            if (previous?.kind === 'command-checkpoint-group' && previous.activities.every(matchesCheckpoint)) {
                previous.activities.push(row.activity)
                continue
            }
            if (previous?.kind === 'activity' && matchesCheckpoint(previous.activity)) {
                rows[rows.length - 1] = {
                    kind: 'command-checkpoint-group',
                    id: `command-checkpoint-group-${previous.id}`,
                    createdAt: previous.createdAt,
                    activities: [previous.activity, row.activity]
                }
                continue
            }
        }

        rows.push(row)
    }

    const groupedRows: TimelineRenderRow[] = []
    let traceRun: TimelineRenderRow[] = []
    let traceRunActivities: AssistantActivity[] = []
    let traceRunTurnId: string | null = null

    const getTraceActivities = (row: TimelineRenderRow): AssistantActivity[] | null => {
        if (row.kind === 'thought-group' || row.kind === 'command-checkpoint-group') return row.activities
        if (
            row.kind === 'activity'
            && (isInternalAssistantActivity(row.activity) || isCommandCheckpointActivity(row.activity))
        ) return [row.activity]
        return null
    }

    const flushTraceRun = () => {
        if (traceRun.length === 0) return
        const hasThought = traceRunActivities.some(isInternalAssistantActivity)
        const hasCheckpoint = traceRunActivities.some(isCommandCheckpointActivity)
        if (hasThought && hasCheckpoint) {
            groupedRows.push({
                kind: 'work-trace-group',
                id: `work-trace-group-${traceRun[0]?.id || traceRunActivities[0]?.id || 'trace'}`,
                createdAt: traceRun[0]?.createdAt || traceRunActivities[0]?.createdAt || '',
                activities: traceRunActivities
            })
        } else {
            groupedRows.push(...traceRun)
        }
        traceRun = []
        traceRunActivities = []
        traceRunTurnId = null
    }

    for (const row of rows) {
        const activities = getTraceActivities(row)
        if (!activities) {
            flushTraceRun()
            groupedRows.push(row)
            continue
        }

        const rowTurnId = activities[0]?.turnId || null
        if (traceRun.length > 0 && rowTurnId !== traceRunTurnId) flushTraceRun()
        if (traceRun.length === 0) traceRunTurnId = rowTurnId
        traceRun.push(row)
        traceRunActivities.push(...activities)
    }
    flushTraceRun()

    if (isWorking && entries.length > 0) {
        let latestUserMessageId: string | undefined
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index]
            if (entry.type === 'message' && entry.message.role === 'user') {
                latestUserMessageId = entry.id
                break
            }
        }
        const latestUserRowIndex = latestUserMessageId
            ? groupedRows.findIndex((row) => row.kind === 'message' && row.id === latestUserMessageId)
            : -1
        groupedRows.splice(latestUserRowIndex >= 0 ? latestUserRowIndex + 1 : groupedRows.length, 0, {
            kind: 'working',
            id: 'working-indicator-row',
            createdAt: activeWorkStartedAt
        })
    }

    return groupedRows
}

export function getActivityDetails(activity: AssistantActivity): string[] {
    const payload = activity.payload || {}
    const toolName = readActivityToolName(payload)
    return [...new Set([
        readActivityString(activity.detail),
        ...readActivityStringArray(payload.paths),
        readActivityString(payload.query),
        toolName
    ].filter(Boolean))]
}

export function getActivityPaths(activity: AssistantActivity): string[] {
    const payload = activity.payload || {}
    const paths = readActivityPathsFromPayload(payload, activity.detail)
    if (paths.length > 0) return paths
    return getActivityAgentSurface(activity)?.paths || []
}

export function getCreatedFilePaths(activity: AssistantActivity): string[] {
    const changes = Array.isArray(activity.payload?.changes) ? activity.payload?.changes : []
    return [...new Set([
        ...readActivityStringArray(activity.payload?.createdPaths),
        ...changes.flatMap((entry) => {
            const change = readActivityRecord(entry)
            if (!change || (change.kind !== 'add' && change.isNew !== true)) return []
            return readActivityStringArray(change.path)
        })
    ])]
}

export function isCommandActivity(activity: AssistantActivity): boolean {
    const payload = activity.payload || {}
    const toolName = readActivityToolName(payload)
    return activity.kind === 'command'
        || Boolean(readActivityCommandFromPayload(payload, activity.detail))
        || /\b(bash|shell|powershell|terminal|exec|command|cmd)\b/i.test(toolName)
}

export function countRunningCommandActivities(activities: AssistantActivity[]): number {
    return activities.filter((activity) => (
        !isCommandCheckpointActivity(activity)
        && isCommandActivity(activity)
        && getActivityStatus(activity) === 'running'
    )).length
}

export function getActivityDiffStats(activity: AssistantActivity): { additions: number; deletions: number; fileCount: number | null } | null {
    if (activity.kind !== 'file-change') return null

    const payload = activity.payload || {}
    const additions = readActivityNumber(payload.additions)
    const deletions = readActivityNumber(payload.deletions)
    const fileCount = readActivityNumber(payload.fileCount)

    if (additions === null && deletions === null) return null

    return {
        additions: Math.max(0, additions || 0),
        deletions: Math.max(0, deletions || 0),
        fileCount: fileCount !== null ? Math.max(0, fileCount) : null
    }
}

export function getActivityFileCount(activity: AssistantActivity): number | null {
    const payloadCount = readActivityNumber(activity.payload?.fileCount)
    if (payloadCount !== null) return Math.max(0, payloadCount)
    if (activity.kind !== 'file-change') return null
    const pathCount = getActivityPaths(activity).length
    return pathCount > 0 ? pathCount : null
}

export function getActivityTitle(activity: AssistantActivity): string {
    const toolName = readActivityToolName(activity.payload || {})
    if (activity.kind === 'subagent.spawn') return 'Subagent spawn'
    if (activity.kind === 'subagent.send-input') return 'Subagent check-in'
    if (activity.kind === 'subagent.wait') return 'Waiting on subagent'
    if (activity.kind === 'subagent.resume') return 'Resume subagent'
    if (activity.kind === 'subagent.close') return 'Close subagent'
    if (isSubagentActivity(activity)) return 'Subagent activity'
    if (activity.kind === 'user-input.resolved') return 'Consulted user'
    if (activity.kind === 'search') return 'Search'
    if (activity.kind === 'file-read' || (/\b(read|open|cat|view)\b/i.test(toolName) && getActivityPaths(activity).length > 0)) return 'Read file'
    if (activity.kind === 'file-change') return (getActivityFileCount(activity) || 0) > 1 ? 'Edited files' : 'Edited file'
    if (isCommandActivity(activity)) return 'Command'
    return activity.summary || 'Tool'
}

export function getActivityStatus(activity: AssistantActivity): 'success' | 'running' | 'failed' {
    const payload = activity.payload || {}
    const surface = getActivityAgentSurface(activity)
    const rawStatus = readActivityString(payload.status)
        || readActivityString(payload.state)
        || readActivityString(payload.phase)
        || surface?.lifecycle
        || ''
    const normalizedStatus = rawStatus.toLowerCase().replace(/[-_\s]/g, '')
    if (activity.tone === 'error') return 'failed'
    if (normalizedStatus === 'running' || normalizedStatus === 'inprogress' || normalizedStatus === 'pending' || normalizedStatus === 'started') return 'running'
    if (normalizedStatus === 'error' || normalizedStatus === 'failed' || normalizedStatus === 'cancelled' || normalizedStatus === 'declined') return 'failed'
    return 'success'
}

export function getContextCompactionStatus(activity: AssistantActivity): 'running' | 'completed' | 'cancelled' | 'failed' {
    const payload = activity.payload || {}
    const rawStatus = readActivityString(payload.status)
        || readActivityString(payload.state)
        || readActivityString(payload.phase)
        || readActivityString(activity.summary)
    const normalized = rawStatus.toLowerCase().replace(/[-_\s]/g, '')
    if (
        normalized === 'running'
        || normalized === 'inprogress'
        || normalized === 'pending'
        || normalized === 'started'
        || normalized === 'autocompacting'
        || normalized === 'compacting'
    ) {
        return 'running'
    }
    if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'aborted' || normalized === 'autocompactioncancelled') {
        return 'cancelled'
    }
    if (activity.tone === 'error' || normalized === 'failed' || normalized === 'error' || normalized === 'autocompactionfailed') {
        return 'failed'
    }
    return 'completed'
}

type SubagentThreadLabel = {
    threadId: string | null
    providerThreadId: string | null
    label: string
    role: string | null
    nickname: string | null
    state: string | null
}

function isSubagentThreadLabel(value: unknown): value is SubagentThreadLabel {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.label === 'string'
}

export function getSubagentActivityThreadLabels(activity: AssistantActivity): SubagentThreadLabel[] {
    const value = activity.payload?.receiverThreadLabels
    if (!Array.isArray(value)) return []
    return value.filter(isSubagentThreadLabel)
}

export function getSubagentActivityTargets(activity: AssistantActivity): string[] {
    const labels = getSubagentActivityThreadLabels(activity)
    if (labels.length > 0) {
        return labels
            .map((entry) => readActivityString(entry.label) || readActivityString(entry.nickname) || readActivityString(entry.role))
            .filter(Boolean)
    }
    return readActivityStringArray(activity.payload?.receiverLocalThreadIds)
}

export function getSubagentActivityPrompt(activity: AssistantActivity): string {
    return readActivityString(activity.payload?.prompt)
}

export function getSubagentActivityModel(activity: AssistantActivity): string {
    return readActivityString(activity.payload?.model)
}

export function getSubagentActivityReasoning(activity: AssistantActivity): string {
    return readActivityString(activity.payload?.reasoningEffort)
}

export function getActivityStartedAt(activity: AssistantActivity): string {
    return readActivityString(activity.payload?.startedAt) || activity.createdAt
}

export function getActivityElapsed(activity: AssistantActivity, runningEndIso?: string | null): string | null {
    const payload = activity.payload || {}
    const durationCandidate = payload.durationMs
    const durationMs = typeof durationCandidate === 'number' ? durationCandidate : typeof durationCandidate === 'string' ? Number(durationCandidate) : Number.NaN
    if (Number.isFinite(durationMs) && durationMs >= 0) {
        if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
        if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
        return formatWorkingTimer(new Date(0).toISOString(), new Date(durationMs).toISOString())
    }
    const startedAt = getActivityStartedAt(activity)
    const completedAt = readActivityString(payload.completedAt)
    const endedAt = runningEndIso || completedAt
    return startedAt && endedAt ? formatWorkingTimer(startedAt, endedAt) : null
}

export function estimateTimelineRowHeight(
    row: TimelineRenderRow,
    options: { containerWidth?: number | null } = {}
): number {
    if (row.kind === 'working') return 48
    if (row.kind === 'user-input') return row.input.status === 'pending' ? Math.max(220, 96 + row.input.questions.length * 156) : 40
    if (row.kind === 'activity') {
        if (isVoiceStrongTaskActivity(row.activity)) return 36
        if (isCommandCheckpointActivity(row.activity)) return 34
        if (isInternalAssistantActivity(row.activity)) return 42
        if (isContextCompactionActivity(row.activity)) return 72
        if (isIssueActivity(row.activity)) return 124
        return isSubagentActivity(row.activity) ? 212 : 168
    }
    if (row.kind === 'activity-group') {
        const containsIssueActivity = row.activities.some((activity) => isIssueActivity(activity))
        const containsSubagentActivity = row.activities.some((activity) => isSubagentActivity(activity))
        if (containsIssueActivity) {
            return 112 + Math.min(row.activities.length, 6) * 86
        }
        return containsSubagentActivity
            ? 132 + Math.min(row.activities.length, 6) * 124
            : 120 + Math.min(row.activities.length, 6) * 96
    }
    if (row.kind === 'command-checkpoint-group') {
        return 44 + Math.min(row.activities.length, 6) * 28
    }
    if (row.kind === 'work-trace-group') {
        return 48 + Math.min(row.activities.length, 8) * 32
    }
    if (row.kind === 'thought-group') {
        return 48 + Math.min(row.activities.length, 6) * 34
    }
    if (row.kind === 'plan') {
        const displayedPlan = stripProposedPlanBlocks(row.plan.planMarkdown || '')
        const planHeight = estimateMarkdownContentHeight(
            displayedPlan,
            getPlanCardContentWidth(options.containerWidth),
            'assistant'
        )
        return Math.min(3200, 136 + planHeight)
    }

    const parsedUserMessage = row.message.role === 'user'
        ? parseUserMessageAttachments(row.message.text || '')
        : null
    const attachmentCount = parsedUserMessage?.attachments.length || 0
    const rawBody = row.message.role === 'user'
        ? (parsedUserMessage?.body || '')
        : stripProposedPlanBlocks(row.message.text || '')

    if (row.message.role === 'assistant') {
        const assistantWidth = getAssistantMessageWidth(options.containerWidth)
        const contentHeight = row.message.streaming
            ? measureTimelinePlainTextHeight(rawBody || ' ', assistantWidth, 'pre-wrap').height
            : estimateMarkdownContentHeight(rawBody || ' ', assistantWidth, 'assistant')
        const footerHeight = row.message.streaming ? 48 : 36
        return Math.min(5600, 44 + contentHeight + footerHeight)
    }

    const userBodyWidth = getUserMessageBodyWidth(options.containerWidth)
    const textHeight = rawBody
        ? measureTimelinePlainTextHeight(rawBody, userBodyWidth, 'pre-wrap').height
        : 0
    const attachmentHeight = estimateAttachmentGridHeight(attachmentCount, userBodyWidth)
    const footerHeight = 38
    const bubbleChromeHeight = 28

    return Math.min(3200, bubbleChromeHeight + attachmentHeight + textHeight + footerHeight)
}
