export const AGENT_APP_IPC = { request: 'zyra:agent-app:request', response: 'zyra:agent-app:response' } as const
export type RendererAppOperation = { domain: string; operation: string; operationId: string; params: Record<string, unknown>;
    actor: { canonicalChatId: string; parentChatId: string; approved: boolean; namespaceId: string; child: boolean; permissionMode: string } }
export type RendererAppMessage = { requestId: string; request: RendererAppOperation }
export type RendererAppResponse = { requestId: string; result?: Record<string, unknown>; error?: string }
export type RendererAppBridge = { onRequest: (listener: (message: RendererAppMessage) => void) => () => void; respond: (response: RendererAppResponse) => void }
