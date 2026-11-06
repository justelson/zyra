import type { AssistantActivity, AssistantMessage } from '@shared/assistant/contracts'
import type { TimelineRenderRow } from './assistant-timeline-helpers'
import { getAssistantUserTurnBoundaryIds } from './assistant-user-turn-boundaries'

export type AssistantPeerReply = {
    activityId: string
    text: string
    targetThreadId: string
    messageId: string | null
    createdAt: string
    fallback: boolean
}

export function areAssistantPeerRepliesEqual(left?: AssistantPeerReply, right?: AssistantPeerReply): boolean {
    return left === right || Boolean(left && right && left.activityId === right.activityId && left.text === right.text
        && left.targetThreadId === right.targetThreadId && left.messageId === right.messageId
        && left.createdAt === right.createdAt && left.fallback === right.fallback)
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** Read both the current projection and the persisted SDK tool-result shape. */
export function readAssistantPeerReply(activity: AssistantActivity): AssistantPeerReply | null {
    const payload = activity.payload || {}
    const args = record(payload.args)
    if (activity.kind !== 'thread-collaboration' || (payload.action || args.action) !== 'send') return null
    const result = record(payload.result)
    if (activity.tone === 'error' || ['failed', 'running', 'pending'].includes(String(payload.status)) || result.isError === true) return null
    let output = record(payload.delivery)
    try {
        const content = Array.isArray(result.content) ? result.content.map(block => record(block).text || '').join('\n') : ''
        output = { ...output, ...record(JSON.parse(String(payload.output || content || '{}'))) }
    } catch { /* Older records may contain plain tool output. */ }
    if (output.error || ['failed', 'rejected'].includes(String(output.status))) return null
    const text = String(args.prompt || payload.prompt || activity.detail || '').trim()
    if (!text) return null
    return {
        activityId: activity.id,
        text,
        targetThreadId: String(payload.targetThreadId || output.canonicalThreadId || output.recipientThreadId || output.threadId || args.threadId || ''),
        messageId: String(payload.sentMessageId || output.messageId || '') || null,
        createdAt: activity.createdAt,
        fallback: false
    }
}

function activities(row: TimelineRenderRow): AssistantActivity[] {
    return row.kind === 'activity' ? [row.activity] : 'activities' in row ? row.activities : []
}

/** A received peer message starts a task boundary in the display only. A sent
 * result can supply a missing ending without adding fabricated canonical chat. */
export function prepareAssistantPeerReplyEndings(source: TimelineRenderRow[], messages: AssistantMessage[], isWorking: boolean) {
    const boundaries = getAssistantUserTurnBoundaryIds(source)
    const rows: TimelineRenderRow[] = []
    const endings: AssistantMessage[] = []
    for (let start = 0; start < source.length; start++) {
        const boundary = source[start]
        rows.push(boundary)
        if (boundary.kind !== 'message' || !boundaries.has(boundary.id)) continue
        let end = start + 1
        while (end < source.length) {
            const next = source[end]
            if (boundaries.has(next.id)) break
            end++
        }
        const segment = source.slice(start + 1, end)
        const replies = segment.flatMap(row => activities(row).map(readAssistantPeerReply).filter((reply): reply is AssistantPeerReply => !!reply))
        const reply = replies.at(-1)
        const settled = end < source.length || !isWorking
        if (!reply || !settled) {
            rows.push(...segment)
        } else {
            // Narration followed by more actions is work, rather than a final answer.
            const meaningful = segment.filter(row => row.kind !== 'working' && !activities(row).some(activity => activity.turnTerminalOutcome || activity.kind === 'context-compaction'))
            const last = meaningful.at(-1)
            if (last?.kind === 'message' && last.message.role === 'assistant' && last.message.text.trim() && !last.message.streaming) {
                rows.push(...segment.map(row => row === last ? { ...last, peerReply: { ...reply, fallback: last.message.text.trim() === reply.text } } : row))
            } else {
                rows.push(...segment.filter(row => row.kind !== 'working'))
                const message: AssistantMessage = {
                    id: `peer-reply-ending:${reply.activityId}`, role: 'assistant', text: reply.text,
                    turnId: boundary.message.turnId, streaming: false,
                    createdAt: reply.createdAt, updatedAt: reply.createdAt
                }
                endings.push(message)
                rows.push({ kind: 'message', id: message.id, createdAt: message.createdAt, message, peerReply: { ...reply, fallback: true } })
            }
        }
        start = end - 1
    }
    return { rows, messages: [...messages, ...endings] }
}
