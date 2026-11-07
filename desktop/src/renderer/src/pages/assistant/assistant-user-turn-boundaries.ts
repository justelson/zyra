import type { TimelineRenderRow } from './assistant-timeline-helpers'
import type { AssistantMessage } from '@shared/assistant/contracts'

export function isVoiceConversationMessage(message: AssistantMessage): boolean {
    return message.modality === 'voice' || message.id.startsWith('voice_') || message.id.startsWith('voice-live-')
}

/** Steering keeps the current task's canonical turn ID. A user bubble alone
 * must not end that task. Unknown/peer/voice inputs retain their boundaries. */
export function getAssistantUserTurnBoundaryIds(rows: TimelineRenderRow[]): Set<string> {
    const boundaries = new Set<string>()
    let hasTask = false
    const taskTurnIds = new Set<string>()
    for (const row of rows) {
        if (row.kind === 'message' && row.message.role === 'user') {
            const message = row.message
            const voice = isVoiceConversationMessage(message)
            const steering = hasTask && !row.threadMessage && !voice && message.turnId && taskTurnIds.has(message.turnId)
            if (!steering) {
                boundaries.add(row.id)
                taskTurnIds.clear()
                if (message.turnId) taskTurnIds.add(message.turnId)
                hasTask = !voice
            }
            continue
        }
        const activities = row.kind === 'activity' ? [row.activity] : 'activities' in row ? row.activities : []
        if (activities.some(activity => activity.turnTerminalOutcome)) {
            hasTask = false
            taskTurnIds.clear()
        } else if (hasTask) {
            // Live/provider IDs can coexist with a saved display ID inside one
            // task. Only aliases observed before the correction can join it.
            if (row.kind === 'message' && row.message.turnId) taskTurnIds.add(row.message.turnId)
            for (const activity of activities) if (activity.turnId) taskTurnIds.add(activity.turnId)
        }
    }
    return boundaries
}
