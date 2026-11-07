export type AssistantInspectorNavigationRequest =
    | { workspace: 'explorer' | 'terminal' | 'review' | 'control' | 'resources'; toggle?: boolean }
    | { workspace: 'browser'; toggle?: boolean; url?: string; sessionId?: string; threadId?: string }
    | { workspace: 'tabs'; action: 'next' | 'previous' | 'close' }
    | { workspace: 'agents'; agentRunId: string }
    | { workspace: 'agents'; workflowRunId: string }
    | { workspace: 'agents' }

let currentRequest: AssistantInspectorNavigationRequest | null = null
const listeners = new Set<(request: AssistantInspectorNavigationRequest) => void>()

export function isAssistantInspectorNavigationForChat(request: AssistantInspectorNavigationRequest, sessionId: string | null, threadId: string | null): boolean {
    return request.workspace !== 'browser' || ((!request.sessionId || request.sessionId === sessionId) && (!request.threadId || request.threadId === threadId))
}

export function requestAssistantInspectorNavigation(request: AssistantInspectorNavigationRequest): void {
    currentRequest = request
    for (const listener of listeners) listener(request)
}

export function acknowledgeAssistantInspectorNavigation(request: AssistantInspectorNavigationRequest): void {
    if (currentRequest === request) currentRequest = null
}

export function subscribeAssistantInspectorNavigation(
    listener: (request: AssistantInspectorNavigationRequest) => void,
    ready = true
): () => void {
    // Opening and restoring the panel happen before its target is consumed.
    // Keep the latest click pending while the destination is mounting.
    if (!ready) return () => undefined
    listeners.add(listener)
    if (currentRequest) listener(currentRequest)
    return () => listeners.delete(listener)
}
