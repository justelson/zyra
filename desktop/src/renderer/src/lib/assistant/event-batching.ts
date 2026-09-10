import type { AssistantDomainEvent } from '@shared/assistant/contracts'
import { isAssistantToolLifecycleStartEvent } from '@shared/assistant/tool-lifecycle'

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

/**
 * Collapse repeated streaming updates before authoritative projection. Text
 * deltas are concatenated; activities already carry their complete current
 * output, so only the newest activity record is needed. Superseded events are
 * removed and replacements stay at their newest sequence position.
 */
export function collapseAssistantDeltaEvents(events: AssistantDomainEvent[]): AssistantDomainEvent[] {
    if (events.length < 2) return events

    const collapsed: Array<AssistantDomainEvent | null> = []
    const messageIndexByKey = new Map<string, number>()
    const activityIndexByKey = new Map<string, number>()

    for (const event of events) {
        if (event.type === 'thread.message.assistant.delta') {
            const messageId = readMessageId(event)
            const key = messageId ? `${event.threadId || ''}:${messageId}` : ''
            // A replacement is an ordered boundary, never part of an append batch.
            if (typeof event.payload['replaceText'] === 'string') {
                if (key) messageIndexByKey.delete(key)
                collapsed.push(event)
                continue
            }
            const previousIndex = key ? messageIndexByKey.get(key) : undefined
            let combinedDelta = readDelta(event)
            if (previousIndex !== undefined) {
                const previous = collapsed[previousIndex]
                if (previous) combinedDelta = `${readDelta(previous)}${combinedDelta}`
                collapsed[previousIndex] = null
            }
            const combinedEvent = combinedDelta === readDelta(event)
                ? event
                : {
                    ...event,
                    payload: { ...event.payload, delta: combinedDelta }
                }
            if (key) messageIndexByKey.set(key, collapsed.length)
            collapsed.push(combinedEvent)
            continue
        }

        if (event.type === 'thread.activity.appended') {
            const activityId = readActivityId(event)
            const key = activityId ? `${event.threadId || ''}:${activityId}` : ''
            if (isAssistantToolLifecycleStartEvent(event)) {
                if (key) activityIndexByKey.delete(key)
                collapsed.push(event)
                continue
            }
            const previousIndex = key ? activityIndexByKey.get(key) : undefined
            if (previousIndex !== undefined) collapsed[previousIndex] = null
            if (key) activityIndexByKey.set(key, collapsed.length)
            collapsed.push(event)
            continue
        }

        collapsed.push(event)
    }

    return collapsed.filter((event): event is AssistantDomainEvent => event !== null)
}
