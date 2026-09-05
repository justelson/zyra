import type {
    ControlActionRequest,
    ControlCapability,
    ControlObservationMode,
    ControlPlanRequest,
    ControlPrincipal,
    ControlSemanticActionSequenceRequest,
    ControlSideEffectClass,
    DelegatedControlLeaseRequest
} from './contracts'
import type { BrowserSessionMode } from '../browser-view'

export const AGENT_CONTROL_IPC = {
    getState: 'zyra:agent-control:get-state',
    bindBrowserTab: 'zyra:agent-control:bind-browser-tab',
    requestGrant: 'zyra:agent-control:request-grant',
    approveGrant: 'zyra:agent-control:approve-grant',
    rejectGrant: 'zyra:agent-control:reject-grant',
    approveAction: 'zyra:agent-control:approve-action',
    rejectAction: 'zyra:agent-control:reject-action',
    revokeGrant: 'zyra:agent-control:revoke-grant',
    emergencyStop: 'zyra:agent-control:emergency-stop',
    clearAudit: 'zyra:agent-control:clear-audit',
    startChromePairing: 'zyra:agent-control:start-chrome-pairing',
    stopChromePairing: 'zyra:agent-control:stop-chrome-pairing',
    listWindows: 'zyra:agent-control:list-windows',
    selectWindow: 'zyra:agent-control:select-window',
    acknowledgeBrowserSurfaceRequest: 'zyra:agent-control:acknowledge-browser-surface-request',
    completeBrowserSurfaceRequest: 'zyra:agent-control:complete-browser-surface-request',
    claimBrowserSurfaceRequest: 'zyra:agent-control:claim-browser-surface-request',
    updateWorkspaceState: 'zyra:agent-control:update-workspace-state',
    browserSurfaceRequested: 'zyra:agent-control:browser-surface-requested',
    browserSurfaceCancelled: 'zyra:agent-control:browser-surface-cancelled',
    stateChanged: 'zyra:agent-control:state-changed',
    cursorChanged: 'zyra:agent-control:cursor-changed'
} as const

export type BrowserSurfaceOpenRequest = {
    version: 1
    requestId: string
    threadId: string
    mode?: 'open' | 'reveal' | 'layout' | 'resize' | 'close' | 'refresh' | 'navigate' | 'external'
    tabId: string
    sessionMode?: BrowserSessionMode
    targetId?: string
    secondaryTabId?: string
    secondaryTargetId?: string
    url?: string
    width?: number
    reveal: boolean
    requestedBy: ControlPrincipal
}

export type BrowserSurfaceOpenAcknowledgement = Pick<BrowserSurfaceOpenRequest, 'requestId' | 'threadId' | 'tabId'>
export type BrowserSurfaceClaim = BrowserSurfaceOpenAcknowledgement

export type BrowserSurfaceOpenCompletion = BrowserSurfaceOpenAcknowledgement & (
    | { success: true; targetId: string; width?: number }
    | { success: false; error: string }
)

export type RendererControlGrantInput = {
    targetId: string
    capabilities: ControlCapability[]
    durationMs: number
    maxActions: number
    allowedOrigins?: string[]
    allowedExecutableIdentities?: string[]
    pendingRequestId?: string
}

export type AgentControlBridgeOperation =
    | { operation: 'list_targets'; targetKind?: 'zyra-browser' | 'chrome-tab' }
    | { operation: 'open_tab'; reveal?: boolean; sessionMode?: BrowserSessionMode; url?: string }
    | { operation: 'reveal_tab'; targetId: string }
    | { operation: 'close_tab'; targetId: string; grantId: string }
    | { operation: 'refresh_tab'; targetId: string; grantId: string }
    | { operation: 'open_external'; targetId: string; grantId: string; url?: string }
    | { operation: 'set_tab_layout'; primaryTargetId: string; secondaryTargetId?: string }
    | { operation: 'resize_inspector'; targetId: string; width: number }
    | { operation: 'list_windows'; query?: string }
    | { operation: 'open_app'; application: string }
    | {
        operation: 'use_app'
        application: string
        capabilities: ControlCapability[]
        durationMs?: number
        maxActions?: number
        requestId?: string
        steps?: ControlSemanticActionSequenceRequest['steps']
    }
    | {
        operation: 'request_grant'
        targetId?: string
        windowToken?: string
        capabilities: ControlCapability[]
        durationMs?: number
        maxActions?: number
        allowedOrigins?: string[]
        allowedExecutableIdentities?: string[]
    }
    | { operation: 'observe'; grantId: string; targetId: string; includeScreenshot?: boolean; mode?: ControlObservationMode }
    | ({ operation: 'act' } & ControlActionRequest)
    | ({ operation: 'act_sequence' } & ControlSemanticActionSequenceRequest)
    | ({ operation: 'perform' } & ControlPlanRequest)
    | { operation: 'plan_status'; planId?: string }
    | { operation: 'resume_plan'; planId: string; disposition: 'continue-with-changes' | 'replan-from-here' }
    | { operation: 'cancel_plan'; planId: string; releaseGrant?: boolean }
    | ({ operation: 'delegate_lease' } & Omit<DelegatedControlLeaseRequest, 'parentPrincipal'>)
    | { operation: 'revoke_current_principal'; reason?: string }
    | { operation: 'release'; grantId: string }

export type AgentControlBridgeRequest = {
    type: 'control.request'
    requestId: string
    operation: AgentControlBridgeOperation
}

export type AgentControlBridgeResponse = {
    type: 'control.response'
    requestId: string
    ok: boolean
    result?: Record<string, unknown>
    error?: { code: string; message: string; retryable: boolean; freshRevision?: number }
}

export type AgentControlToolContext = {
    principal: ControlPrincipal
    sideEffect?: ControlSideEffectClass
}
