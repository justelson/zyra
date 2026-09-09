import type { AssistantActivity } from '@shared/assistant/contracts'
import { readAssistantActionBatchIntent } from '@shared/assistant/action-batch-intent'
import { getAssistantActionFamily } from './assistant-action-presentation'

/** Keep observations and input together, without merging separate purposes or turns. */
export function groupAssistantControlActionRuns(activities: AssistantActivity[]): AssistantActivity[][] {
    const runs: AssistantActivity[][] = []
    for (const activity of activities) {
        const previous = runs.at(-1)
        const last = previous?.at(-1)
        if (last && getAssistantActionFamily(last) === 'computer'
            && getAssistantActionFamily(activity) === 'computer'
            && (last.turnId || null) === (activity.turnId || null)
            && readAssistantActionBatchIntent(last) === readAssistantActionBatchIntent(activity)) {
            previous!.push(activity)
        } else {
            runs.push([activity])
        }
    }
    return runs
}
