export function resolveAssistantTimelineLatestAction(input: { hasNewer: boolean; distanceFromBottom: number; viewportHeight: number }) {
    const jump = input.hasNewer || input.distanceFromBottom > Math.max(1200, input.viewportHeight * 2)
    return { label: jump ? 'Jump to latest' : 'Scroll to bottom', animated: !jump }
}
