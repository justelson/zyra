import type { TimelineDisplayRow } from './assistant-timeline-helpers'

/** Keep measured user-bubble and reply heights in separate LegendList averages.
 * Content length changes while streaming must not change a row's pool type. */
export function getAssistantTimelineItemType(row: TimelineDisplayRow): string {
    return row.kind === 'message' ? `message:${row.message.role}` : row.kind
}
