import { createHash } from 'node:crypto'
import type { AssistantThread } from '../../../shared/assistant/contracts'

/** Revisions track actual context changes, including updates that do not append a message/activity. */
export class VoiceContextRevisions {
    private readonly versions = new Map<string, { digest: string; version: number }>()
    read(thread: AssistantThread, attachedTaskIds: string[], floor = 0): number {
        const digest = createHash('sha256').update(JSON.stringify({
            messageCount: thread.messageCount,
            messages: thread.messages.map(message => [message.id, message.role, message.text, message.updatedAt]),
            approvals: thread.pendingApprovals,
            inputs: thread.pendingUserInputs,
            tasks: thread.activities.filter(activity => activity.kind === 'voice.strong-task').map(activity => [activity.id, activity.summary, activity.detail, activity.payload]),
            attachedTaskIds
        })).digest('hex')
        const previous = this.versions.get(thread.id)
        const base = Math.max(1, floor, thread.canonicalPresence?.latestSequence || 0, thread.messageCount + thread.activityCount)
        const version = Math.max(base, previous ? previous.version + (previous.digest === digest ? 0 : 1) : base)
        this.versions.set(thread.id, { digest, version })
        return version
    }
}
