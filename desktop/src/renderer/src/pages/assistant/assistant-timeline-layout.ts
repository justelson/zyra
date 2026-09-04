export type TimelineActivityStatus = 'success' | 'running' | 'failed'

export function getTerminalOutputHeightClass(
    status: TimelineActivityStatus,
    runningCommandCount: number
): string {
    if (status !== 'running') return 'max-h-32 sm:max-h-36'

    // Bottom anchoring scrolls the top padding away, so reserve the visible
    // lines plus the remaining 10px bottom padding: 1 line / 5 lines exactly.
    return runningCommandCount > 1 ? 'h-[1.875rem]' : 'h-[6.875rem]'
}
