import type { AssistantDomainEvent, AssistantMessage, AssistantSnapshot, AssistantThread, AssistantSession } from '@shared/assistant/contracts'
import { isAssistantToolLifecycleStartEvent } from '@shared/assistant/tool-lifecycle'
import { isCanonicalProjectedMessage } from '@shared/assistant/message-reconciliation'

function readDelta(event: AssistantDomainEvent): string {
    return String(event.payload['delta'] || '')
}

function readMessageId(event: AssistantDomainEvent): string {
    return String(event.payload['messageId'] || '')
}

function readActivityRecord(event: AssistantDomainEvent): Record<string, unknown> | null {
    const activity = event.payload['activity']
    return activity && typeof activity === 'object'
        ? activity as Record<string, unknown>
        : null
}

function readActivityId(event: AssistantDomainEvent): string {
    return String(readActivityRecord(event)?.['id'] || '')
}

function normalizeStreamingStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[-_\s]/g, '')
}

export function isAssistantStreamingPresentationEvent(event: AssistantDomainEvent): boolean {
    if (event.type === 'thread.message.assistant.delta') return true
    if (event.type !== 'thread.activity.appended') return false
    const activity = readActivityRecord(event)
    const payload = activity?.['payload']
    const status = payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['status']
        : null
    return ['streaming', 'running', 'inprogress', 'pending', 'started']
        .includes(normalizeStreamingStatus(status))
}

function canShareStreamingRun(left: AssistantDomainEvent, right: AssistantDomainEvent): boolean {
    if (left.type !== right.type) return false
    const threadId = String(left.payload['threadId'] || left.threadId || '')
    if (!threadId || threadId !== String(right.payload['threadId'] || right.threadId || '')) return false
    if (left.type === 'thread.message.assistant.delta') {
        return Boolean(readMessageId(left)) && readMessageId(left) === readMessageId(right)
            && typeof left.payload['replaceText'] !== 'string' && typeof right.payload['replaceText'] !== 'string'
            && left.payload['turnId'] === right.payload['turnId']
            && left.payload['phase'] === right.payload['phase']
    }
    if (left.type === 'thread.activity.appended') {
        return Boolean(readActivityId(left)) && readActivityId(left) === readActivityId(right)
            && (left.payload['updateOnly'] === true) === (right.payload['updateOnly'] === true)
            && !isAssistantToolLifecycleStartEvent(left) && !isAssistantToolLifecycleStartEvent(right)
    }
    return false
}

function hasReplaySensitiveMessages(events: AssistantDomainEvent[], snapshot?: AssistantSnapshot): boolean {
    const identities = new Map<string, number>()
    const add = (threadId: string, messages: readonly Pick<AssistantMessage, 'id' | 'role'>[]) => {
        if (!threadId) return
        let identity = identities.get(threadId) || 0
        for (const message of messages) {
            if (message.role === 'assistant') identity |= isCanonicalProjectedMessage(message) ? 1 : 2
        }
        identities.set(threadId, identity)
    }
    const threadIds = new Set(events.map(event => String(event.payload['threadId'] || event.threadId || '')).filter(Boolean))
    for (const session of snapshot?.sessions || []) for (const thread of session.threads) {
        if (threadIds.has(thread.id)) add(thread.id, thread.messages)
    }
    for (const event of events) {
        const threadId = String(event.payload['threadId'] || event.threadId || '')
        if (event.type === 'thread.message.assistant.delta' || event.type === 'thread.message.assistant.completed') {
            add(threadId, [{ id: readMessageId(event), role: 'assistant' }])
        }
        const patch = event.payload['patch'] as Partial<AssistantThread & AssistantSession> | undefined
        if (Array.isArray(patch?.messages)) add(threadId, patch.messages)
        const thread = event.payload['thread'] as AssistantThread | undefined
        if (thread?.id) add(thread.id, thread.messages)
        const session = event.payload['session'] as AssistantSession | undefined
        for (const thread of session?.threads || patch?.threads || []) add(thread.id, thread.messages)
    }
    // Replay cleanup can run at an intermediate exact text match. Preserve each
    // event while canonical and legacy assistant identities can reconcile.
    return [...identities.values()].some(identity => identity === 3)
}

/** Keep each compatible run's first event at its original position: it may
 * create the row, establish its order/turn, or be required by updateOnly.
 * Only adjacent tail updates collapse; replacements and other events break runs.
 */
export function collapseAssistantDeltaEvents(events: AssistantDomainEvent[], snapshot?: AssistantSnapshot): AssistantDomainEvent[] {
    if (events.length < 2 || hasReplaySensitiveMessages(events, snapshot)) return events
    const collapsed: AssistantDomainEvent[] = []
    let runStart: AssistantDomainEvent | null = null
    let tailIndex: number | null = null
    let highestSequence = snapshot?.snapshotSequence ?? Number.NEGATIVE_INFINITY
    for (const event of events) {
        if (event.sequence <= highestSequence) {
            runStart = null
            tailIndex = null
            collapsed.push(event)
            continue
        }
        highestSequence = event.sequence
        if (!runStart || !canShareStreamingRun(runStart, event)) {
            runStart = event
            tailIndex = null
            collapsed.push(event)
            continue
        }
        if (tailIndex === null) {
            tailIndex = collapsed.length
            collapsed.push(event)
            continue
        }
        collapsed[tailIndex] = event.type === 'thread.message.assistant.delta'
            ? { ...event, payload: { ...event.payload, delta: `${readDelta(collapsed[tailIndex]!)}${readDelta(event)}` } }
            : event
    }
    return collapsed
}
