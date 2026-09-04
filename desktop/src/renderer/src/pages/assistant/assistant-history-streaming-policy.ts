export const ASSISTANT_HISTORY_MIN_LOOKAHEAD_VIEWPORTS = 3
export const ASSISTANT_HISTORY_MAX_LOOKAHEAD_VIEWPORTS = 9
export const ASSISTANT_HISTORY_MAX_TURNS_PER_PAGE = 3
export const ASSISTANT_INITIAL_HISTORY_CONTEXT_PX = 96
export const ASSISTANT_INITIAL_HISTORY_BACKFILL_MAX_PAGES = 3

export type AssistantInitialHistoryBackfillInput = {
    initialLayoutReady: boolean
    selectionSettled: boolean
    isWorking: boolean
    hasOlder: boolean
    loadingOlder: boolean
    hasLoadError: boolean
    requestPending: boolean
    contentLength: number
    viewportSize: number
    pagesRequested: number
}

export function resolveAssistantInitialHistoryBackfill(
    input: AssistantInitialHistoryBackfillInput
): { shouldRequest: boolean; turnLimit: number } {
    const viewportSize = Math.max(0, Number.isFinite(input.viewportSize) ? input.viewportSize : 0)
    const contentLength = Math.max(0, Number.isFinite(input.contentLength) ? input.contentLength : 0)
    const pagesRequested = Math.max(0, Math.floor(input.pagesRequested || 0))
    const targetContentLength = viewportSize + ASSISTANT_INITIAL_HISTORY_CONTEXT_PX
    const shouldRequest = input.initialLayoutReady
        && input.selectionSettled
        && !input.isWorking
        && input.hasOlder
        && !input.loadingOlder
        && !input.hasLoadError
        && !input.requestPending
        && viewportSize > 0
        && contentLength < targetContentLength
        && pagesRequested < ASSISTANT_INITIAL_HISTORY_BACKFILL_MAX_PAGES
    const shortfall = Math.max(0, targetContentLength - contentLength)
    const turnLimit = shortfall > viewportSize * 0.75 ? 2 : 1
    return { shouldRequest, turnLimit }
}

export type AssistantHistoryStreamPlanInput = {
    startupSettled: boolean
    upwardIntent: boolean
    hasOlder: boolean
    loadingOlder: boolean
    hasLoadError: boolean
    distanceFromStart: number
    viewportSize: number
    velocityPxPerMs: number
}

export type AssistantHistoryStreamPlan = {
    shouldRequest: boolean
    turnLimit: number
    lookaheadViewports: number
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

export function normalizeAssistantHistoryWheelDelta(
    deltaY: number,
    deltaMode: number,
    viewportSize: number
): number {
    const magnitude = Math.abs(Number.isFinite(deltaY) ? deltaY : 0)
    if (deltaMode === 1) return magnitude * 16
    if (deltaMode === 2) return magnitude * Math.max(1, viewportSize)
    return magnitude
}

export function updateAssistantHistoryScrollVelocity(
    previousVelocityPxPerMs: number,
    distancePx: number,
    elapsedMs: number
): number {
    const elapsed = clamp(Number.isFinite(elapsedMs) ? elapsedMs : 16, 8, 120)
    const instantaneous = clamp(Math.abs(distancePx) / elapsed, 0, 12)
    const previous = clamp(Number.isFinite(previousVelocityPxPerMs) ? previousVelocityPxPerMs : 0, 0, 12)
    return previous * 0.58 + instantaneous * 0.42
}

export function resolveAssistantHistoryStreamPlan(
    input: AssistantHistoryStreamPlanInput
): AssistantHistoryStreamPlan {
    const velocity = clamp(input.velocityPxPerMs, 0, 12)
    const lookaheadViewports = clamp(
        ASSISTANT_HISTORY_MIN_LOOKAHEAD_VIEWPORTS + velocity * 1.25,
        ASSISTANT_HISTORY_MIN_LOOKAHEAD_VIEWPORTS,
        ASSISTANT_HISTORY_MAX_LOOKAHEAD_VIEWPORTS
    )
    const turnLimit = velocity >= 3.5
        ? ASSISTANT_HISTORY_MAX_TURNS_PER_PAGE
        : velocity >= 1.15
            ? 2
            : 1
    const threshold = Math.max(0, input.viewportSize) * lookaheadViewports
    const shouldRequest = input.startupSettled
        && input.upwardIntent
        && input.hasOlder
        && !input.loadingOlder
        && !input.hasLoadError
        && Math.max(0, input.distanceFromStart) <= threshold
    return { shouldRequest, turnLimit, lookaheadViewports }
}

export type AssistantHistoryDirection = 'older' | 'newer'

export function resolveAssistantScrollbarHistoryDemand(input: {
    dragActive: boolean
    dragDirection: AssistantHistoryDirection | null
    scrollDelta: number
}): { dragDirection: AssistantHistoryDirection | null; requestDirection: AssistantHistoryDirection | null } {
    if (!input.dragActive || !input.dragDirection || Math.abs(input.scrollDelta) <= 0.5) {
        return { dragDirection: input.dragActive ? input.dragDirection : null, requestDirection: null }
    }
    const movementDirection: AssistantHistoryDirection = input.scrollDelta < 0 ? 'older' : 'newer'
    return {
        dragDirection: input.dragDirection,
        requestDirection: movementDirection === input.dragDirection ? input.dragDirection : null
    }
}
