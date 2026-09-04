export const CONTROL_PROTOCOL_VERSION = 1 as const

export const CONTROL_CAPABILITIES = [
    'observe.structure',
    'observe.screenshot',
    'navigate',
    'pointer.click',
    'pointer.move',
    'pointer.drag',
    'keyboard.type',
    'keyboard.key',
    'scroll',
    'form.select',
    'window.focus',
    'tab.manage'
] as const

export type ControlCapability = typeof CONTROL_CAPABILITIES[number]

export type ControlPrincipal =
    | { type: 'root'; threadId: string; turnId: string }
    | { type: 'agent'; fleetId: string; agentRunId: string; parentThreadId: string }

export type ControlTarget =
    | {
        kind: 'zyra-browser'
        targetId: string
        tabId: string
        sessionMode: 'normal' | 'incognito'
        ownerThreadId: string
        guestIdentity: string
        origin: string | null
        url?: string | null
        title?: string | null
    }
    | {
        kind: 'chrome-tab'
        targetId: string
        pairId: string
        tabToken: string
        origin: string | null
    }
    | {
        kind: 'windows-window'
        targetId: string
        sidecarSessionId: string
        processId: number
        windowToken: string
        executableIdentity: string
        applicationName?: string
        title?: string
    }

export interface ControlGrant {
    version: 1
    grantId: string
    principal: ControlPrincipal
    targetId: string
    capabilities: ControlCapability[]
    allowedOrigins?: string[]
    allowedExecutableIdentities?: string[]
    issuedAt: string
    expiresAt: string
    maxActions: number
    actionCount: number
    state: 'active' | 'expired' | 'revoked' | 'consumed'
    issuedBy: 'user' | 'delegated-parent'
    parentGrantId?: string
}

export type ControlElement = {
    elementRef: string
    role: string
    name?: string
    text?: string
    value?: string
    description?: string
    bounds?: { x: number; y: number; width: number; height: number }
    states?: string[]
    actions?: string[]
    sensitive?: boolean
}

export interface ControlObservation {
    version: 1
    observationId: string
    revision: number
    targetId: string
    capturedAt: string
    targetState: 'ready' | 'navigating' | 'detached' | 'closed' | 'blocked'
    url?: string
    title?: string
    origin?: string
    viewport?: { width: number; height: number; scale: number }
    elements: ControlElement[]
    screenshotRef?: string
    focusedElementRef?: string
    truncation?: { totalElements: number; returnedElements: number }
    redactions: string[]
}

export type ControlWaitCondition =
    | { type: 'url-changed'; from?: string }
    | { type: 'element-present'; name?: string; role?: string }
    | { type: 'element-absent'; elementRef: string }
    | { type: 'target-ready' }
    | { type: 'delay'; durationMs: number }

export type ControlPointerButton = 'left' | 'middle' | 'right'

export type ControlAction =
    | { type: 'move'; x: number; y: number; durationMs?: number }
    | { type: 'click'; elementRef?: string; x?: number; y?: number; button?: ControlPointerButton; clickCount?: number; sideEffect?: ControlSideEffectClass }
    | { type: 'drag'; fromX: number; fromY: number; toX: number; toY: number; durationMs?: number; button?: ControlPointerButton; sideEffect?: ControlSideEffectClass }
    | { type: 'stroke'; points: Array<{ x: number; y: number }>; durationMs?: number; button?: ControlPointerButton }
    | { type: 'type'; elementRef?: string; x?: number; y?: number; text: string; replace?: boolean; sideEffect?: ControlSideEffectClass }
    | { type: 'key'; key: string; modifiers?: string[]; sideEffect?: ControlSideEffectClass }
    | { type: 'scroll'; elementRef?: string; x?: number; y?: number; deltaX: number; deltaY: number }
    | { type: 'select'; elementRef: string; values: string[]; sideEffect?: ControlSideEffectClass }
    | { type: 'navigate'; url: string }
    | { type: 'focus' }
    | { type: 'wait'; condition: ControlWaitCondition; timeoutMs: number }

export type ControlSideEffectClass =
    | 'none'
    | 'send-or-publish'
    | 'purchase'
    | 'account-change'
    | 'security-change'
    | 'destructive-delete'
    | 'file-upload'
    | 'sensitive-data-submit'
    | 'software-install'
    | 'legal-acceptance'

export interface ControlActionRequest {
    version: 1
    requestId: string
    grantId: string
    targetId: string
    observationRevision: number
    action: ControlAction
}

export interface ControlActionResult {
    version: 1
    requestId: string
    targetId: string
    previousRevision: number
    observation: ControlObservation
    changed: boolean
    outcome: 'completed' | 'blocked' | 'cancelled'
}

export type ControlSemanticActionTarget = {
    role?: string
    name: string
}

export type ControlSemanticActionStep =
    | ({ type: 'click'; sideEffect: 'none' } & ControlSemanticActionTarget)
    | ({ type: 'type'; text: string; replace: boolean; sideEffect: 'none' } & ControlSemanticActionTarget)
    | { type: 'key'; key: string; modifiers?: string[]; sideEffect: 'none' }
    | { type: 'wait'; durationMs: number; sideEffect: 'none' }

export interface ControlSemanticActionSequenceRequest {
    version: 1
    requestId: string
    grantId: string
    targetId: string
    observationRevision: number
    steps: ControlSemanticActionStep[]
}

export interface ControlSemanticActionSequenceResult {
    version: 1
    requestId: string
    targetId: string
    previousRevision: number
    completedSteps: number
    totalSteps: number
    observation: ControlObservation
    changed: boolean
    outcome: 'completed'
}

export type ControlSemanticClickStep = Extract<ControlSemanticActionStep, { type: 'click' }>
export type ControlSemanticClickSequenceRequest = ControlSemanticActionSequenceRequest
export type ControlSemanticClickSequenceResult = ControlSemanticActionSequenceResult

export type ControlObservationMode = 'visual' | 'structure' | 'both'

export type ControlStageIntent = {
    summary: string
    expectedActivity: 'pointer' | 'keyboard' | 'scroll' | 'mixed'
    expectedRegion?: { x: number; y: number; width: number; height: number }
}

export interface ControlPlanRequest {
    version: 1
    requestId: string
    grantId: string
    targetId: string
    observationRevision: number
    stage: ControlStageIntent
    steps: ControlAction[]
    observationMode: ControlObservationMode
    includeScreenshot: boolean
}

export type ControlInteractionCategory = 'pointer-move' | 'pointer-action' | 'keyboard' | 'scroll' | 'gesture'

export type ControlInteractionEvent = {
    sequence: number
    actor: 'user'
    targetId: string
    category: ControlInteractionCategory
    inputType: string
    x?: number
    y?: number
    stageId?: string
    occurredAt: string
}

export interface ControlPlanResult {
    version: 1
    requestId: string
    planId: string
    targetId: string
    previousRevision: number
    completedSteps: number
    totalSteps: number
    observation: ControlObservation
    changed: boolean
    outcome: 'completed' | 'paused' | 'cancelled'
    pause?: {
        reason: string
        evidence: Array<Pick<ControlInteractionEvent, 'actor' | 'category' | 'targetId' | 'x' | 'y' | 'stageId' | 'occurredAt'>>
        choices: ['continue-with-changes', 'replan-from-here', 'user-takeover']
    }
}

export interface DelegatedControlLeaseRequest {
    parentGrantId: string
    parentPrincipal: ControlPrincipal
    childPrincipal: Extract<ControlPrincipal, { type: 'agent' }>
    targetId: string
    capabilities: ControlCapability[]
    expiresAt: string
    maxActions: number
    allowedOrigins?: string[]
    allowedExecutableIdentities?: string[]
}

export type ControlCursorState = {
    targetId: string
    x: number
    y: number
    visible: boolean
    phase: 'idle' | 'moving' | 'pressing' | 'dragging' | 'typing' | 'scrolling'
    actionType?: ControlAction['type']
    principal?: ControlPrincipal
    durationMs?: number
    coordinateSpace?: 'target' | 'screen'
    updatedAt: string
}

export type ControlDriverHealth = {
    targetKind: ControlTarget['kind']
    state: 'ready' | 'degraded' | 'disconnected' | 'unavailable'
    lastDisconnectReason?: string
    updatedAt: string
}

export type ControlAuditEvent = {
    version: 1
    auditId: string
    occurredAt: string
    eventType: 'grant.requested' | 'grant.issued' | 'grant.revoked' | 'grant.expired' | 'action-approval.requested' | 'action-approval.resolved' | 'action' | 'plan' | 'interaction' | 'observation' | 'emergency-stop' | 'pairing' | 'target'
    principal?: ControlPrincipal
    parentPrincipal?: ControlPrincipal
    targetId?: string
    targetKind?: ControlTarget['kind']
    grantId?: string
    actionType?: ControlAction['type']
    actor?: 'agent' | 'user'
    interactionCategory?: ControlInteractionCategory
    stageId?: string
    coordinates?: { x: number; y: number }
    origin?: string
    executableIdentity?: string
    observationRevision?: number
    outcome: 'allowed' | 'denied' | 'completed' | 'failed' | 'cancelled'
    elapsedMs?: number
    message?: string
    redactions: string[]
}

export type ControlPendingGrant = {
    requestId: string
    principal: ControlPrincipal
    targetId: string
    capabilities: ControlCapability[]
    requestedAt: string
    expiresAt: string
    maxActions: number
    allowedOrigins?: string[]
    allowedExecutableIdentities?: string[]
    screenshots: boolean
}

export type ControlPendingActionApproval = {
    requestId: string
    principal: ControlPrincipal
    targetId: string
    grantId: string
    actionRequestId: string
    actionType: ControlAction['type']
    sideEffect: Exclude<ControlSideEffectClass, 'none'>
    observationRevision: number
    requestedAt: string
    expiresAt: string
}

export type ControlPairingState = {
    state: 'stopped' | 'waiting' | 'paired' | 'error'
    pairId?: string
    code?: string
    port?: number
    expiresAt?: string
    extensionId?: string
    error?: string
}

export type ControlInspectorWorkspaceKind =
    | 'new'
    | 'review'
    | 'explorer'
    | 'terminal'
    | 'browser'
    | 'control'
    | 'resources'
    | 'agents'
    | 'turn'

export type ControlBrowserWorkspaceTab = {
    tabId: string
    sessionMode: 'normal' | 'incognito'
    targetId: string | null
    trusted: boolean
    url: string | null
    title: string | null
    origin: string | null
    status: 'idle' | 'loading' | 'ready' | 'error'
    position: 'primary' | 'secondary' | null
    visible: boolean
    viewportRect: { x: number; y: number; width: number; height: number } | null
}

export type ControlWorkspaceSnapshot = {
    version: 1
    threadId: string | null
    inspector: {
        open: boolean
        width: number | null
        activeWorkspace: ControlInspectorWorkspaceKind | null
        openWorkspaces: ControlInspectorWorkspaceKind[]
    }
    browser: {
        open: boolean
        activeTabId: string | null
        splitTabId: string | null
        visibleTabIds: string[]
        tabs: ControlBrowserWorkspaceTab[]
    }
    updatedAt: string
}

export type ControlStateSnapshot = {
    version: 1
    targets: ControlTarget[]
    grants: ControlGrant[]
    pendingGrants: ControlPendingGrant[]
    pendingActionApprovals: ControlPendingActionApproval[]
    audit: ControlAuditEvent[]
    health: ControlDriverHealth[]
    cursors: ControlCursorState[]
    workspace: ControlWorkspaceSnapshot | null
    pairing: ControlPairingState
    active: boolean
    sequence: number
}

export type ControlWindowCandidate = {
    targetId?: string
    windowToken: string
    title: string
    applicationName: string
    executableIdentity: string
    processId: number
    blocked: boolean
    blockedReason?: string
}
