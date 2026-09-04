export type AssistantInspectorNavigationRequest =
    | { workspace: 'agents'; agentRunId: string }
    | { workspace: 'agents'; workflowRunId: string }

let currentRequest: AssistantInspectorNavigationRequest | null = null
const listeners = new Set<(request: AssistantInspectorNavigationRequest) => void>()

export function requestAssistantInspectorNavigation(request: AssistantInspectorNavigationRequest): void {
    currentRequest = request
    for (const listener of listeners) listener(request)
}

export function acknowledgeAssistantInspectorNavigation(request: AssistantInspectorNavigationRequest): void {
    if (currentRequest === request) currentRequest = null
}

export function subscribeAssistantInspectorNavigation(
    listener: (request: AssistantInspectorNavigationRequest) => void
): () => void {
    listeners.add(listener)
    if (currentRequest) listener(currentRequest)
    return () => listeners.delete(listener)
}
