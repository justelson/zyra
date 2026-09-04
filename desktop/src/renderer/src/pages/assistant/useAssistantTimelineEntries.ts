import { useMemo, useRef } from 'react'
import type { AssistantActivity, AssistantMessage, AssistantPendingUserInput, AssistantProposedPlan } from '@shared/assistant/contracts'
import {
    getAssistantTimelineMessageEntryId,
    getTimelineEntries,
    shouldRenderActivity,
    shouldRenderMessage,
    type TimelineEntry
} from './assistant-timeline-helpers'

type TimelineEntriesCache = {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    proposedPlans: AssistantProposedPlan[]
    userInputs: AssistantPendingUserInput[]
    entries: TimelineEntry[]
}

function findLastMessageEntryIndex(entries: TimelineEntry[]): number {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?.type === 'message') {
            return index
        }
    }
    return -1
}

function haveStableMessagePrefix(previous: AssistantMessage[], next: AssistantMessage[], prefixLength: number): boolean {
    for (let index = 0; index < prefixLength; index += 1) {
        if (previous[index] !== next[index]) {
            return false
        }
    }
    return true
}

function findSingleChangedActivityIndex(previous: AssistantActivity[], next: AssistantActivity[]): number {
    if (previous.length !== next.length) return -2
    let changedIndex = -1
    for (let index = 0; index < previous.length; index += 1) {
        if (previous[index]?.id !== next[index]?.id) return -2
        if (previous[index] === next[index]) continue
        if (changedIndex >= 0) return -2
        changedIndex = index
    }
    return changedIndex
}

function canReplaceTimelineActivityInPlace(previous: AssistantActivity, next: AssistantActivity): boolean {
    return previous.id === next.id
        && previous.kind === next.kind
        && previous.turnId === next.turnId
        && previous.createdAt === next.createdAt
        && previous.timelineSequence === next.timelineSequence
        && shouldRenderActivity(next)
}

export function replaceAssistantTimelineActivityEntry(
    entries: TimelineEntry[],
    previous: AssistantActivity,
    next: AssistantActivity
): TimelineEntry[] | null {
    if (!canReplaceTimelineActivityInPlace(previous, next)) return null

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const entry = entries[entryIndex]!
        if (entry.type === 'activity' && entry.id === previous.id) {
            const nextEntries = [...entries]
            nextEntries[entryIndex] = {
                id: next.id,
                createdAt: next.createdAt,
                timelineSequence: next.timelineSequence,
                type: 'activity',
                activity: next
            }
            return nextEntries
        }
        if (entry.type !== 'activity-group') continue

        const activityIndex = entry.activities.findIndex((activity) => activity.id === previous.id)
        if (activityIndex < 0) continue
        const activities = [...entry.activities]
        activities[activityIndex] = next
        const nextEntries = [...entries]
        nextEntries[entryIndex] = { ...entry, activities }
        return nextEntries
    }

    return null
}

export function useAssistantTimelineEntries(
    messages: AssistantMessage[],
    activities: AssistantActivity[],
    proposedPlans: AssistantProposedPlan[] = [],
    userInputs: AssistantPendingUserInput[] = []
): TimelineEntry[] {
    const cacheRef = useRef<TimelineEntriesCache | null>(null)

    return useMemo(() => {
        const cached = cacheRef.current
        if (cached) {
            if (cached.messages === messages && cached.activities === activities && cached.proposedPlans === proposedPlans && cached.userInputs === userInputs) {
                return cached.entries
            }

            if (cached.messages === messages && cached.proposedPlans === proposedPlans && cached.userInputs === userInputs) {
                const changedActivityIndex = findSingleChangedActivityIndex(cached.activities, activities)
                if (changedActivityIndex === -1) {
                    cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: cached.entries }
                    return cached.entries
                }
                if (changedActivityIndex >= 0) {
                    const previousActivity = cached.activities[changedActivityIndex]!
                    const nextActivity = activities[changedActivityIndex]!
                    const nextEntries = replaceAssistantTimelineActivityEntry(
                        cached.entries,
                        previousActivity,
                        nextActivity
                    )
                    if (nextEntries) {
                        cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: nextEntries }
                        return nextEntries
                    }
                    if (!shouldRenderActivity(nextActivity)) {
                        const previousStillRendered = cached.entries.some((entry) => (
                            (entry.type === 'activity' && entry.id === previousActivity.id)
                            || (entry.type === 'activity-group' && entry.activities.some((activity) => activity.id === previousActivity.id))
                        ))
                        if (!previousStillRendered) {
                            cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: cached.entries }
                            return cached.entries
                        }
                    }
                }
            }

            if (cached.activities === activities && cached.proposedPlans === proposedPlans && cached.userInputs === userInputs && cached.messages.length > 0) {
                const previousLastMessage = cached.messages[cached.messages.length - 1]
                const nextLastMessage = messages[messages.length - 1]

                if (
                    messages.length === cached.messages.length
                    && nextLastMessage
                    && previousLastMessage
                    && haveStableMessagePrefix(cached.messages, messages, Math.max(0, messages.length - 1))
                    && previousLastMessage.id === nextLastMessage.id
                ) {
                    const messageEntryIndex = findLastMessageEntryIndex(cached.entries)
                    if (
                        messageEntryIndex >= 0
                        && cached.entries[messageEntryIndex]?.id === getAssistantTimelineMessageEntryId(nextLastMessage)
                        && shouldRenderMessage(nextLastMessage)
                    ) {
                        const nextEntries = [...cached.entries]
                        nextEntries[messageEntryIndex] = {
                            id: getAssistantTimelineMessageEntryId(nextLastMessage),
                            createdAt: nextLastMessage.createdAt,
                            timelineSequence: nextLastMessage.timelineSequence,
                            type: 'message',
                            message: nextLastMessage
                        }
                        cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: nextEntries }
                        return nextEntries
                    }
                }

                if (
                    messages.length === cached.messages.length + 1
                    && haveStableMessagePrefix(cached.messages, messages, cached.messages.length)
                ) {
                    const appendedMessage = messages[messages.length - 1]
                    if (
                        appendedMessage.role === 'assistant'
                        && appendedMessage.turnId
                    ) {
                        const entries = getTimelineEntries(messages, activities, proposedPlans, userInputs)
                        cacheRef.current = { messages, activities, proposedPlans, userInputs, entries }
                        return entries
                    }
                    if (!shouldRenderMessage(appendedMessage)) {
                        cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: cached.entries }
                        return cached.entries
                    }
                    const nextEntries = [
                        ...cached.entries,
                        {
                            id: getAssistantTimelineMessageEntryId(appendedMessage),
                            createdAt: appendedMessage.createdAt,
                            timelineSequence: appendedMessage.timelineSequence,
                            type: 'message' as const,
                            message: appendedMessage
                        }
                    ]
                    cacheRef.current = { messages, activities, proposedPlans, userInputs, entries: nextEntries }
                    return nextEntries
                }
            }
        }

        const entries = getTimelineEntries(messages, activities, proposedPlans, userInputs)
        cacheRef.current = { messages, activities, proposedPlans, userInputs, entries }
        return entries
    }, [activities, messages, proposedPlans, userInputs])
}
