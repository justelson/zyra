import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type {
    ControlAction,
    ControlActionRequest,
    ControlCapability,
    ControlCursorState,
    ControlGrant,
    ControlInteractionCategory,
    ControlObservation,
    ControlObservationMode,
    ControlPairingState,
    ControlPendingActionApproval,
    ControlPlanRequest,
    ControlPlanResult,
    ControlPrincipal,
    ControlSemanticActionSequenceResult,
    ControlSemanticActionStep,
    ControlSideEffectClass,
    ControlStateSnapshot,
    ControlTarget,
    ControlWindowCandidate,
    ControlWorkspaceSnapshot,
    DelegatedControlLeaseRequest
} from '../../shared/agent-control/contracts'
import type { AgentControlBridgeOperation, RendererControlGrantInput } from '../../shared/agent-control/protocol'
import { CONTROL_BOUNDS, normalizedOrigin } from '../../shared/agent-control/policy'
import {
    assertBridgeMessageSize,
    assertControlActionRequest,
    assertControlCapabilities,
    assertControlPlanRequest,
    assertControlSemanticActionSequenceRequest,
    assertControlIdentifier,
    assertControlPrincipal
} from '../../shared/agent-control/validation'
import { ActionQueue } from './action-queue'
import { AuditStore } from './audit-store'
import { assertActionAllowed, assertCapabilitiesSupportedByTarget, assertGrantSupportsTarget, controlActionRequiresApproval } from './capability-policy'
import { AgentControlError, toAgentControlError } from './control-errors'
import { GrantStore } from './grant-store'
import { ObservationStore } from './observation-store'
import { TargetInteractionArbiter } from './interaction-arbiter'
import { redactObservation } from './redaction'
import { TargetRegistry } from './target-registry'
import type { AgentControlDriver } from './drivers/driver'

export type BrowserSurfaceController = {
    openTab(principal: ControlPrincipal, reveal: boolean, sessionMode: 'normal' | 'incognito', signal?: AbortSignal): Promise<Extract<ControlTarget, { kind: 'zyra-browser' }>>
    revealTabs(
        principal: ControlPrincipal,
        primary: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        secondary: Extract<ControlTarget, { kind: 'zyra-browser' }> | null,
        signal?: AbortSignal,
        explicitLayout?: boolean
    ): Promise<Extract<ControlTarget, { kind: 'zyra-browser' }>>
    resizeInspector(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        width: number,
        signal?: AbortSignal
    ): Promise<{ target: Extract<ControlTarget, { kind: 'zyra-browser' }>; width: number }>
    closeTab(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        signal?: AbortSignal
    ): Promise<Extract<ControlTarget, { kind: 'zyra-browser' }>>
    commandTab(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        mode: 'refresh' | 'external',
        url: string | null,
        signal?: AbortSignal
    ): Promise<Extract<ControlTarget, { kind: 'zyra-browser' }>>
    cancelPending(reason?: string): void
}

export type PairingController = {
    start(): Promise<ControlPairingState>
    stop(reason?: string): Promise<void> | void
    state(): ControlPairingState
}

export class AgentControlBroker extends EventEmitter {
    readonly targets = new TargetRegistry()
    readonly grants = new GrantStore()
    readonly observations = new ObservationStore()
    readonly actions = new ActionQueue()
    readonly audit: AuditStore
    private sequence = 0
    private disposed = false
    private browserSurface: BrowserSurfaceController | null = null
    private workspace: ControlWorkspaceSnapshot | null = null
    private readonly workspacesByOwner = new Map<number, ControlWorkspaceSnapshot>()
    private readonly cursors = new Map<string, ControlCursorState>()
    private readonly interactionArbiter = new TargetInteractionArbiter()
    private readonly agentInputDepth = new Map<string, number>()
    private readonly activeStageByTarget = new Map<string, string>()
    private readonly pausedPlans = new Map<string, {
        planId: string
        request: ControlPlanRequest
        principal: ControlPrincipal
        completedSteps: number
        pausedAt: string
    }>()
    private readonly cursorPublishTimers = new Map<string, NodeJS.Timeout>()
    private readonly cursorPublishedAt = new Map<string, number>()
    private readonly userAuthorizedBrowserIntents = new Map<string, { threadId: string; tabId: string; targetId: string; expiresAt: number }>()
    private readonly pendingGrantWaiters = new Map<string, {
        resolve: (grant: ControlGrant) => void
        reject: (error: AgentControlError) => void
    }>()
    private readonly pendingActionApprovals = new Map<string, ControlPendingActionApproval>()
    private readonly pendingActionApprovalWaiters = new Map<string, {
        resolve: () => void
        reject: (error: AgentControlError) => void
    }>()
    private readonly grantExpiryTimer: NodeJS.Timeout

    constructor(
        private readonly options: {
            userDataPath?: string
            drivers?: AgentControlDriver[]
            pairing?: PairingController
        } = {}
    ) {
        super()
        this.audit = new AuditStore(options.userDataPath)
        this.grantExpiryTimer = setInterval(() => {
            try { this.expireControlAuthority(true) } catch {}
        }, 500)
        this.grantExpiryTimer.unref?.()
    }

    setBrowserSurfaceController(controller: BrowserSurfaceController | null): void {
        this.browserSurface = controller
    }

    updateWorkspaceState(value: unknown, ownerWebContentsId = 0): ControlWorkspaceSnapshot | null {
        this.assertAlive()
        const previousWorkspace = this.workspacesByOwner.get(ownerWebContentsId) || null
        if (value === null) {
            if (this.workspacesByOwner.delete(ownerWebContentsId)) {
                this.workspace = [...this.workspacesByOwner.values()].at(-1) || null
                this.changed()
            }
            return null
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Browser workspace state is invalid.')
        }
        const input = value as Partial<ControlWorkspaceSnapshot>
        const threadId = input.threadId === null || input.threadId === undefined
            ? null
            : assertControlIdentifier(input.threadId, 'threadId')
        const inspectorInput = input.inspector && typeof input.inspector === 'object' ? input.inspector : null
        const browserInput = input.browser && typeof input.browser === 'object' ? input.browser : null
        if (!inspectorInput || !browserInput) {
            throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Browser workspace state is incomplete.')
        }
        const workspaceKinds = new Set<ControlWorkspaceSnapshot['inspector']['openWorkspaces'][number]>([
            'new', 'review', 'explorer', 'terminal', 'browser', 'control', 'resources', 'agents', 'turn'
        ])
        const openWorkspaces = [...new Set((Array.isArray(inspectorInput.openWorkspaces) ? inspectorInput.openWorkspaces : [])
            .filter((entry): entry is ControlWorkspaceSnapshot['inspector']['openWorkspaces'][number] => workspaceKinds.has(entry as never)))]
            .slice(0, 16)
        const inspectorOpen = inspectorInput.open === true
        const requestedInspectorWidth = Number(inspectorInput.width)
        const inspectorWidth = inspectorOpen && Number.isFinite(requestedInspectorWidth)
            ? Math.max(CONTROL_BOUNDS.minInspectorWidth, Math.min(CONTROL_BOUNDS.maxInspectorWidth, Math.round(requestedInspectorWidth)))
            : null
        const activeWorkspace = inspectorOpen && inspectorInput.activeWorkspace && workspaceKinds.has(inspectorInput.activeWorkspace)
            ? inspectorInput.activeWorkspace
            : null
        const seenTabs = new Set<string>()
        const tabs = (Array.isArray(browserInput.tabs) ? browserInput.tabs : []).flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return []
            const raw = entry as ControlWorkspaceSnapshot['browser']['tabs'][number]
            let tabId: string
            try {
                tabId = assertControlIdentifier(raw.tabId, 'tabId')
            } catch {
                return []
            }
            if (seenTabs.has(tabId)) return []
            seenTabs.add(tabId)
            const candidate = this.targets.list('zyra-browser')
                .map((registered) => registered.target)
                .find((target): target is Extract<ControlTarget, { kind: 'zyra-browser' }> => (
                    target.kind === 'zyra-browser'
                    && target.tabId === tabId
                    && target.ownerThreadId === threadId
                )) || null
            let target: Extract<ControlTarget, { kind: 'zyra-browser' }> | null = null
            if (candidate && (!raw.targetId || raw.targetId === candidate.targetId)) target = candidate
            const rendererUrl = typeof raw.url === 'string' && /^https?:\/\//.test(raw.url)
                ? raw.url.slice(0, CONTROL_BOUNDS.maxUrlLength)
                : null
            const url = target?.url || rendererUrl
            const status = ['idle', 'loading', 'ready', 'error'].includes(raw.status) ? raw.status : 'idle'
            const viewportInput = raw.viewportRect && typeof raw.viewportRect === 'object' ? raw.viewportRect : null
            const viewportNumbers = viewportInput
                ? [viewportInput.x, viewportInput.y, viewportInput.width, viewportInput.height].map(Number)
                : []
            const viewportRect = viewportNumbers.length === 4 && viewportNumbers.every(Number.isFinite)
                && viewportNumbers[0] >= 0 && viewportNumbers[1] >= 0
                && viewportNumbers[2] >= 1 && viewportNumbers[3] >= 1
                ? {
                    x: Math.round(viewportNumbers[0]),
                    y: Math.round(viewportNumbers[1]),
                    width: Math.round(viewportNumbers[2]),
                    height: Math.round(viewportNumbers[3])
                }
                : null
            return [{
                tabId,
                sessionMode: target?.sessionMode || (raw.sessionMode === 'incognito' ? 'incognito' : 'normal'),
                targetId: target?.targetId || null,
                trusted: Boolean(target),
                url,
                title: target?.title || (typeof raw.title === 'string' ? raw.title.slice(0, 512) || null : null),
                origin: target?.origin || null,
                status: status as ControlWorkspaceSnapshot['browser']['tabs'][number]['status'],
                position: null,
                visible: false,
                viewportRect
            }]
        }).slice(0, 8)
        const requestedActiveTabId = typeof browserInput.activeTabId === 'string' ? browserInput.activeTabId : null
        const activeTabId = tabs.some((tab) => tab.tabId === requestedActiveTabId) ? requestedActiveTabId : tabs[0]?.tabId || null
        const requestedSplitTabId = typeof browserInput.splitTabId === 'string' ? browserInput.splitTabId : null
        const splitTabId = requestedSplitTabId !== activeTabId && tabs.some((tab) => tab.tabId === requestedSplitTabId)
            ? requestedSplitTabId
            : null
        const browserOpen = browserInput.open === true
        const browserVisible = inspectorOpen && activeWorkspace === 'browser' && browserOpen
        const visibleTabIds = browserVisible ? [activeTabId, splitTabId].filter((entry): entry is string => Boolean(entry)) : []
        const visibleSet = new Set(visibleTabIds)
        const normalizedTabs = tabs.map((tab) => ({
            ...tab,
            position: tab.tabId === activeTabId && browserVisible
                ? 'primary' as const
                : tab.tabId === splitTabId && browserVisible
                    ? 'secondary' as const
                    : null,
            visible: visibleSet.has(tab.tabId)
        }))
        const next: ControlWorkspaceSnapshot = {
            version: 1,
            threadId,
            inspector: { open: inspectorOpen, width: inspectorWidth, activeWorkspace, openWorkspaces },
            browser: { open: browserOpen, activeTabId, splitTabId, visibleTabIds, tabs: normalizedTabs },
            updatedAt: new Date().toISOString()
        }
        const comparable = (snapshot: ControlWorkspaceSnapshot | null) => snapshot ? { ...snapshot, updatedAt: '' } : null
        if (JSON.stringify(comparable(previousWorkspace)) !== JSON.stringify(comparable(next))) {
            const previousTabs = new Map((previousWorkspace?.browser.tabs || []).map((tab) => [tab.targetId, tab]))
            for (const tab of next.browser.tabs) {
                if (!tab.targetId) continue
                const previous = previousTabs.get(tab.targetId)
                if (previous && viewportGeometryKey(previous.viewportRect) !== viewportGeometryKey(tab.viewportRect)) {
                    this.observations.invalidate(tab.targetId)
                }
            }
            this.workspacesByOwner.set(ownerWebContentsId, next)
            this.workspace = next
            this.changed()
        }
        return next
    }

    registerTarget(input: {
        target: ControlTarget
        driver: AgentControlDriver
        trustedIdentity: unknown
        ownerWebContentsId?: number
    }): ControlTarget {
        this.assertAlive()
        this.targets.register(input)
        this.audit.append({
            eventType: 'target', targetId: input.target.targetId, targetKind: input.target.kind,
            outcome: 'allowed', message: 'Target registered.', redactions: []
        })
        this.changed()
        return input.target
    }

    transferTargetOwner(targetId: string, previousOwnerWebContentsId: number, ownerWebContentsId: number): void {
        this.assertAlive()
        this.targets.transferOwner(targetId, previousOwnerWebContentsId, ownerWebContentsId)
        this.changed()
    }

    handleTargetNavigation(targetId: string, url: string): void {
        const registered = this.targets.get(targetId)
        const origin = normalizedOrigin(url)
        if (registered.target.kind === 'zyra-browser' || registered.target.kind === 'chrome-tab') {
            registered.target.origin = origin
        }
        if (registered.target.kind === 'zyra-browser') {
            registered.target.url = /^https?:\/\//.test(url) ? url.slice(0, CONTROL_BOUNDS.maxUrlLength) : null
        }
        this.observations.invalidate(targetId)
        registered.driver.releaseInputFocus?.(registered)
        for (const grant of this.grants.list()) {
            if (grant.targetId !== targetId || grant.state !== 'active' || !grant.allowedOrigins?.length) continue
            if (!origin || !grant.allowedOrigins.includes(origin)) this.grants.revoke(grant.grantId)
        }
        this.changed()
    }

    private workspaceForTarget(targetId: string): ControlWorkspaceSnapshot | null {
        const registered = this.targets.list().find((entry) => entry.target.targetId === targetId)
        if (registered?.ownerWebContentsId !== undefined) {
            const ownedWorkspace = this.workspacesByOwner.get(registered.ownerWebContentsId) || null
            return ownedWorkspace?.browser.tabs.some((tab) => tab.targetId === targetId) ? ownedWorkspace : null
        }
        return [...this.workspacesByOwner.values()].find((workspace) => workspace.browser.tabs.some((tab) => tab.targetId === targetId)) || null
    }

    private workspaceForThread(threadId: string): ControlWorkspaceSnapshot | null {
        const candidates = [...this.workspacesByOwner.values()].filter((workspace) => workspace.threadId === threadId)
        return candidates.find((workspace) => workspace.browser.tabs.some((tab) => tab.visible)) || candidates.at(-1) || null
    }

    recordUserInteraction(targetId: string, category: ControlInteractionCategory, inputType: string, windowPoint?: { x: number; y: number }): void {
        if ((this.agentInputDepth.get(targetId) || 0) > 0) return
        const registered = this.targets.list().find((entry) => entry.target.targetId === targetId)
        if (!registered) return
        const viewportRect = this.workspaceForTarget(targetId)?.browser.tabs.find((tab) => tab.targetId === targetId)?.viewportRect
        const point = windowPoint && viewportRect
            ? { x: windowPoint.x - viewportRect.x, y: windowPoint.y - viewportRect.y }
            : undefined
        const previousSequence = this.interactionArbiter.checkpoint(targetId)
        const interaction = this.interactionArbiter.record(targetId, category, inputType, this.activeStageByTarget.get(targetId), point)
        if (category !== 'pointer-move' && interaction.sequence > previousSequence) {
            this.audit.append({
                eventType: 'interaction', actor: 'user', targetId, targetKind: registered.target.kind,
                interactionCategory: category, stageId: interaction.stageId,
                coordinates: point,
                outcome: 'completed', message: `User ${category} activity occurred on this exact control target.`,
                redactions: ['typed-content']
            })
        }
    }

    handleTargetTitle(targetId: string, title: string): void {
        const registered = this.targets.get(targetId)
        if (registered.target.kind !== 'zyra-browser') return
        registered.target.title = String(title || '').slice(0, 512) || null
        this.changed()
    }

    removeTarget(targetId: string, reason = 'Target closed.'): void {
        const registered = this.targets.remove(targetId)
        if (!registered) return
        this.grants.revokeByTarget(targetId)
        for (const [threadId, intent] of this.userAuthorizedBrowserIntents) {
            if (intent.targetId === targetId) this.userAuthorizedBrowserIntents.delete(threadId)
        }
        this.observations.remove(targetId)
        this.cursors.delete(targetId)
        this.interactionArbiter.clear(targetId)
        this.activeStageByTarget.delete(targetId)
        this.agentInputDepth.delete(targetId)
        const cursorTimer = this.cursorPublishTimers.get(targetId)
        if (cursorTimer) clearTimeout(cursorTimer)
        this.cursorPublishTimers.delete(targetId)
        this.cursorPublishedAt.delete(targetId)
        for (const [planId, plan] of this.pausedPlans) {
            if (plan.request.targetId === targetId) this.pausedPlans.delete(planId)
        }
        for (const pending of [...this.pendingActionApprovals.values()]) {
            if (pending.targetId === targetId) this.cancelPendingActionApproval(pending.requestId, reason)
        }
        for (const [ownerId, workspace] of this.workspacesByOwner) {
            if (!workspace.browser.tabs.some((tab) => tab.targetId === targetId)) continue
            const next = {
                ...workspace,
                browser: {
                    ...workspace.browser,
                    tabs: workspace.browser.tabs.map((tab) => tab.targetId === targetId ? { ...tab, targetId: null } : tab)
                },
                updatedAt: new Date().toISOString()
            }
            this.workspacesByOwner.set(ownerId, next)
            if (this.workspace === workspace) this.workspace = next
        }
        void registered.driver.release?.(registered)
        this.audit.append({
            eventType: 'target', targetId, targetKind: registered.target.kind,
            outcome: 'cancelled', message: reason, redactions: []
        })
        this.changed()
    }

    armUserAuthorizedBrowserGrant(input: { threadId: string; tabId: string; turnId?: string | null }): ControlGrant | null {
        this.assertAlive()
        const target = this.targets.list('zyra-browser').map((entry) => entry.target).find((candidate) => (
            candidate.kind === 'zyra-browser' && candidate.ownerThreadId === input.threadId && candidate.tabId === input.tabId
        ))
        if (!target || target.kind !== 'zyra-browser') throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The background Browser tab is not ready for agent access.')
        if (input.turnId) return this.issueUserAuthorizedBrowserGrant({ type: 'root', threadId: input.threadId, turnId: input.turnId }, target)
        this.userAuthorizedBrowserIntents.set(input.threadId, {
            threadId: input.threadId,
            tabId: input.tabId,
            targetId: target.targetId,
            expiresAt: Date.now() + 2 * 60 * 1000
        })
        return null
    }

    cancelUserAuthorizedBrowserIntent(threadId: string, tabId: string): void {
        const intent = this.userAuthorizedBrowserIntents.get(threadId)
        if (intent?.tabId === tabId) this.userAuthorizedBrowserIntents.delete(threadId)
        const targetIds = this.targets.list('zyra-browser').map((entry) => entry.target).filter((target) => target.kind === 'zyra-browser' && target.ownerThreadId === threadId && target.tabId === tabId).map((target) => target.targetId)
        for (const grant of this.grants.list()) {
            if (targetIds.includes(grant.targetId) && grant.principal.type === 'root' && grant.principal.threadId === threadId) this.revokeGrant(grant.grantId)
        }
    }

    materializeUserAuthorizedBrowserGrant(threadId: string, turnId: string): ControlGrant | null {
        const intent = this.userAuthorizedBrowserIntents.get(threadId)
        if (!intent) return null
        this.userAuthorizedBrowserIntents.delete(threadId)
        if (intent.expiresAt <= Date.now()) return null
        let target: ControlTarget
        try { target = this.targets.get(intent.targetId).target }
        catch { return null }
        if (target.kind !== 'zyra-browser' || target.ownerThreadId !== threadId || target.tabId !== intent.tabId) return null
        return this.issueUserAuthorizedBrowserGrant({ type: 'root', threadId, turnId }, target)
    }

    private issueUserAuthorizedBrowserGrant(principal: Extract<ControlPrincipal, { type: 'root' }>, target: Extract<ControlTarget, { kind: 'zyra-browser' }>): ControlGrant {
        const origin = target.origin ? normalizedOrigin(target.origin) : null
        const capabilities: ControlCapability[] = [
            'observe.structure', 'observe.screenshot', 'pointer.click', 'pointer.move', 'pointer.drag',
            'keyboard.type', 'keyboard.key', 'scroll', 'form.select',
            ...(origin ? ['navigate' as const, 'tab.manage' as const] : [])
        ]
        const grant = this.grants.issue({
            principal,
            targetId: target.targetId,
            capabilities,
            expiresAt: new Date(Date.now() + Math.min(CONTROL_BOUNDS.maxGrantDurationMs, 10 * 60 * 1000)).toISOString(),
            maxActions: Math.min(CONTROL_BOUNDS.maxGrantActions, 128),
            allowedOrigins: origin ? [origin] : undefined,
            issuedBy: 'user'
        })
        assertGrantSupportsTarget(grant, target)
        this.audit.append({
            eventType: 'grant.issued', principal, targetId: target.targetId, targetKind: target.kind,
            grantId: grant.grantId, outcome: 'allowed', message: 'User-authorized TUI Browser command issued a bounded control grant.', redactions: []
        })
        this.changed()
        return grant
    }

    requestGrant(input: {
        principal: ControlPrincipal
        targetId: string
        capabilities: ControlCapability[]
        durationMs?: number
        maxActions?: number
        allowedOrigins?: string[]
        allowedExecutableIdentities?: string[]
    }, options: { silent?: boolean } = {}) {
        this.assertAlive()
        const principal = assertControlPrincipal(input.principal)
        const target = this.targets.get(assertControlIdentifier(input.targetId, 'targetId')).target
        const capabilities = assertControlCapabilities(input.capabilities)
        assertCapabilitiesSupportedByTarget(capabilities, target)
        const rawDurationMs = Number(input.durationMs ?? 10 * 60 * 1000)
        const rawMaxActions = Number(input.maxActions ?? 100)
        const durationMs = Math.max(1_000, Math.min(CONTROL_BOUNDS.maxGrantDurationMs, Number.isFinite(rawDurationMs) ? Math.floor(rawDurationMs) : 10 * 60 * 1000))
        const maxActions = Math.max(1, Math.min(CONTROL_BOUNDS.maxGrantActions, Number.isFinite(rawMaxActions) ? Math.floor(rawMaxActions) : 100))
        const expiresAt = new Date(Date.now() + durationMs).toISOString()
        const defaultScopes = defaultGrantScopes(target)
        const allowedOrigins = input.allowedOrigins?.length ? input.allowedOrigins.slice(0, 32) : defaultScopes.allowedOrigins
        const allowedExecutableIdentities = input.allowedExecutableIdentities?.length ? input.allowedExecutableIdentities.slice(0, 32) : defaultScopes.allowedExecutableIdentities
        if ((capabilities.includes('navigate') || capabilities.includes('tab.manage')) && target.kind !== 'windows-window' && !allowedOrigins?.length) {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Navigation and tab-management grants require an explicit HTTP(S) origin scope.')
        }
        const request = this.grants.addPending({
            principal,
            targetId: target.targetId,
            capabilities,
            expiresAt,
            maxActions,
            allowedOrigins,
            allowedExecutableIdentities,
            screenshots: capabilities.includes('observe.screenshot')
        })
        this.retainTarget(target.targetId)
        if (!options.silent) {
            this.audit.append({
                eventType: 'grant.requested', principal, targetId: target.targetId, targetKind: target.kind,
                outcome: 'allowed', message: 'Waiting for approval in chat.', redactions: []
            })
            this.changed()
        }
        return request
    }

    approvePendingGrant(input: RendererControlGrantInput, options: { auditMessage?: string } = {}): ControlGrant {
        this.assertAlive()
        const requestId = assertControlIdentifier(input.pendingRequestId, 'pendingRequestId')
        this.expireControlAuthority(false)
        const pending = this.grants.getPending(requestId)
        if (!pending) throw new AgentControlError('CONTROL_GRANT_NOT_FOUND', 'The pending grant request is no longer available.')
        if (pending.targetId !== input.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'A pending grant cannot be rebound to another target.')
        const capabilities = assertControlCapabilities(input.capabilities)
        if (!capabilities.every((capability) => pending.capabilities.includes(capability))) {
            throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'User approval cannot widen the requested capabilities.')
        }
        const durationMs = Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : 1_000
        const requestedActions = Number.isFinite(Number(input.maxActions)) ? Math.floor(Number(input.maxActions)) : 1
        const requestedExpiry = Math.min(Date.parse(pending.expiresAt), Date.now() + Math.max(1_000, Math.min(durationMs, CONTROL_BOUNDS.maxGrantDurationMs)))
        const maxActions = Math.min(pending.maxActions, Math.max(1, requestedActions))
        const allowedOrigins = narrowScope(input.allowedOrigins, pending.allowedOrigins)
        const allowedExecutableIdentities = narrowScope(input.allowedExecutableIdentities, pending.allowedExecutableIdentities)
        const target = this.targets.get(pending.targetId).target
        this.releaseInputFocus(pending.targetId)
        this.clearCursor(pending.targetId)
        const grant = this.grants.issue({
            principal: pending.principal,
            targetId: pending.targetId,
            capabilities,
            expiresAt: new Date(requestedExpiry).toISOString(),
            maxActions,
            allowedOrigins,
            allowedExecutableIdentities,
            issuedBy: 'user'
        })
        try {
            assertGrantSupportsTarget(grant, target)
        } catch (error) {
            this.grants.revoke(grant.grantId)
            this.grants.removePending(requestId)
            const controlError = toAgentControlError(error)
            this.audit.append({
                eventType: 'grant.revoked', principal: pending.principal, targetId: pending.targetId, targetKind: target.kind,
                grantId: grant.grantId, outcome: 'denied', message: controlError.message, redactions: []
            })
            this.changed()
            this.pendingGrantWaiters.get(requestId)?.reject(controlError)
            this.releaseTargetIfIdle(pending.targetId)
            throw controlError
        }
        this.grants.removePending(requestId)
        this.audit.append({
            eventType: 'grant.issued', principal: grant.principal, targetId: grant.targetId, targetKind: target.kind,
            grantId: grant.grantId, outcome: 'allowed', message: options.auditMessage || 'User approved a bounded control grant.', redactions: []
        })
        this.changed()
        this.pendingGrantWaiters.get(requestId)?.resolve(grant)
        return grant
    }

    rejectPendingGrant(requestId: string): void {
        const normalizedRequestId = assertControlIdentifier(requestId, 'requestId')
        const pending = this.grants.removePending(normalizedRequestId)
        if (!pending) return
        this.audit.append({
            eventType: 'grant.revoked', principal: pending.principal, targetId: pending.targetId,
            outcome: 'denied', message: 'User declined the grant request.', redactions: []
        })
        this.changed()
        this.pendingGrantWaiters.get(normalizedRequestId)?.reject(
            new AgentControlError('CONTROL_CANCELLED', 'The user declined the control request.')
        )
        this.releaseTargetIfIdle(pending.targetId)
    }

    approvePendingAction(requestId: string): void {
        const id = assertControlIdentifier(requestId, 'requestId')
        const pending = this.pendingActionApprovals.get(id)
        if (!pending) throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The pending action approval is no longer available.')
        this.pendingActionApprovals.delete(id)
        this.audit.append({
            eventType: 'action-approval.resolved', principal: pending.principal, targetId: pending.targetId,
            grantId: pending.grantId, actionType: pending.actionType, outcome: 'allowed',
            message: `User approved ${pending.sideEffect} in chat.`, redactions: []
        })
        this.changed()
        this.pendingActionApprovalWaiters.get(id)?.resolve()
    }

    rejectPendingAction(requestId: string): void {
        const id = assertControlIdentifier(requestId, 'requestId')
        this.cancelPendingActionApproval(id, 'The user declined this critical action in chat.')
    }

    delegate(request: DelegatedControlLeaseRequest): ControlGrant {
        this.releaseInputFocus(request.targetId)
        this.clearCursor(request.targetId)
        const grant = this.grants.delegate(request)
        const target = this.targets.get(grant.targetId).target
        try {
            assertGrantSupportsTarget(grant, target)
        } catch (error) {
            this.grants.revoke(grant.grantId)
            throw error
        }
        this.audit.append({
            eventType: 'grant.issued', principal: grant.principal, parentPrincipal: request.parentPrincipal,
            targetId: grant.targetId, targetKind: target.kind, grantId: grant.grantId,
            outcome: 'allowed', message: 'Strictly attenuated child lease issued.', redactions: []
        })
        this.changed()
        return grant
    }

    async observe(
        principal: ControlPrincipal,
        grantId: string,
        targetId: string,
        includeScreenshot = false,
        signal?: AbortSignal,
        mode: ControlObservationMode = 'both'
    ): Promise<ControlObservation> {
        this.assertAlive()
        const grant = this.grants.requireActive(grantId, principal)
        if (grant.targetId !== targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another target.')
        if (mode !== 'visual' && !grant.capabilities.includes('observe.structure')) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'The grant does not allow structure observation.')
        if ((includeScreenshot || mode === 'visual') && !grant.capabilities.includes('observe.screenshot')) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'The grant does not allow screenshots.')
        const registered = this.targets.get(targetId)
        assertGrantSupportsTarget(grant, registered.target)
        const startedAt = Date.now()
        try {
            const revision = this.observations.nextRevision(targetId)
            const observation = boundObservation(redactObservation(await registered.driver.observe(registered, { revision, includeScreenshot, mode, signal })))
            this.commitObservation(observation)
            const consumedGrant = this.grants.consume(grantId)
            if (consumedGrant.state === 'consumed') {
                registered.driver.releaseInputFocus?.(registered)
                this.clearCursorIfNoActiveGrant(targetId)
                this.releaseTargetIfIdle(targetId)
            }
            this.audit.append({
                eventType: 'observation', principal, targetId, targetKind: registered.target.kind, grantId,
                observationRevision: observation.revision, origin: observation.origin,
                outcome: 'completed', elapsedMs: Date.now() - startedAt, redactions: observation.redactions
            })
            this.changed()
            return observation
        } catch (error) {
            this.audit.append({
                eventType: 'observation', principal, targetId, targetKind: registered.target.kind, grantId,
                outcome: 'failed', elapsedMs: Date.now() - startedAt,
                message: error instanceof Error ? error.message : 'Observation failed.', redactions: []
            })
            throw toAgentControlError(error)
        }
    }

    async act(principal: ControlPrincipal, requestValue: unknown, signal?: AbortSignal) {
        this.assertAlive()
        const request = assertControlActionRequest(requestValue)
        const grant = this.grants.requireActive(request.grantId, principal)
        if (grant.targetId !== request.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another target.')
        const registered = this.targets.get(request.targetId)
        assertGrantSupportsTarget(grant, registered.target)
        const requiredSideEffect = controlActionRequiresApproval(request.action) ? request.action.sideEffect : undefined
        assertActionAllowed(grant, registered.target, request.action, { approvedSideEffect: requiredSideEffect })
        const requestedObservation = this.observations.requireRevision(request.targetId, request.observationRevision)
        assertSafeObservedElementAction(requestedObservation, request.action)
        assertVisualActionInsideObservation(requestedObservation, request.action)
        if (requiredSideEffect) {
            await this.waitForActionApproval(principal, grant, request, requiredSideEffect, signal)
        }
        return this.actions.enqueue(request.targetId, async () => {
            const currentGrant = this.grants.requireActive(request.grantId, principal)
            const previousObservation = this.observations.requireRevision(request.targetId, request.observationRevision)
            assertActionAllowed(currentGrant, registered.target, request.action, { approvedSideEffect: requiredSideEffect })
            assertSafeObservedElementAction(previousObservation, request.action)
            assertVisualActionInsideObservation(previousObservation, request.action)
            const startedAt = Date.now()
            try {
                const result = await registered.driver.act(registered, request.action, {
                    revision: request.observationRevision,
                    previousObservation,
                    signal,
                    updateCursor: (patch) => this.updateCursor(request.targetId, principal, request.action.type, patch),
                    runAgentInput: (operation) => this.runAgentInput(request.targetId, operation)
                })
                const revision = this.observations.nextRevision(request.targetId)
                const observation = boundObservation(redactObservation(await registered.driver.observe(registered, {
                    revision,
                    includeScreenshot: false,
                    mode: 'structure',
                    signal
                })))
                this.commitObservation(observation)
                const consumedGrant = this.grants.consume(request.grantId)
                if (consumedGrant.state === 'consumed') {
                    registered.driver.releaseInputFocus?.(registered)
                    this.clearCursorIfNoActiveGrant(request.targetId)
                    this.releaseTargetIfIdle(request.targetId)
                }
                this.audit.append({
                    eventType: 'action', principal, targetId: request.targetId, targetKind: registered.target.kind,
                    grantId: request.grantId, actionType: request.action.type, origin: observation.origin,
                    executableIdentity: registered.target.kind === 'windows-window' ? registered.target.executableIdentity : undefined,
                    observationRevision: observation.revision, outcome: 'completed', elapsedMs: Date.now() - startedAt,
                    redactions: ['typed-text']
                })
                this.changed()
                return {
                    version: 1 as const,
                    requestId: request.requestId,
                    targetId: request.targetId,
                    previousRevision: request.observationRevision,
                    observation,
                    changed: result.changed,
                    outcome: 'completed' as const
                }
            } catch (error) {
                this.audit.append({
                    eventType: 'action', principal, targetId: request.targetId, targetKind: registered.target.kind,
                    grantId: request.grantId, actionType: request.action.type,
                    outcome: signal?.aborted ? 'cancelled' : 'failed', elapsedMs: Date.now() - startedAt,
                    message: error instanceof Error ? error.message : 'Action failed.', redactions: ['typed-text']
                })
                throw toAgentControlError(error)
            }
        }, signal)
    }

    async semanticActionSequence(principal: ControlPrincipal, requestValue: unknown, signal?: AbortSignal): Promise<ControlSemanticActionSequenceResult> {
        this.assertAlive()
        const request = assertControlSemanticActionSequenceRequest(requestValue)
        const grant = this.grants.requireRemaining(request.grantId, principal, request.steps.length)
        if (grant.targetId !== request.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another target.')
        const registered = this.targets.get(request.targetId)
        if (registered.target.kind !== 'windows-window') {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Semantic action sequences support only explicitly granted Windows application windows.')
        }
        assertGrantSupportsTarget(grant, registered.target)

        let revision = request.observationRevision
        let observation = this.observations.requireRevision(request.targetId, revision)
        let changed = false
        let completedSteps = 0
        for (const [index, step] of request.steps.entries()) {
            let action: ControlAction
            try {
                action = resolveSemanticSequenceAction(step, observation, index)
            } catch (error) {
                const controlError = toAgentControlError(error)
                throw new AgentControlError(
                    controlError.code,
                    `Computer interaction sequence stopped before step ${index + 1} after ${completedSteps} completed steps: ${controlError.message}`,
                    { ...controlError.options, freshRevision: revision }
                )
            }
            try {
                const result = await this.act(principal, {
                    version: 1,
                    requestId: `${request.requestId}:step:${index + 1}`,
                    grantId: request.grantId,
                    targetId: request.targetId,
                    observationRevision: revision,
                    action
                }, signal)
                completedSteps += 1
                changed = changed || result.changed
                observation = result.observation
                revision = observation.revision
            } catch (error) {
                const controlError = toAgentControlError(error)
                throw new AgentControlError(
                    controlError.code,
                    `Computer interaction sequence stopped at step ${index + 1} after ${completedSteps} completed steps: ${controlError.message}`,
                    { ...controlError.options, freshRevision: revision }
                )
            }
        }
        return {
            version: 1,
            requestId: request.requestId,
            targetId: request.targetId,
            previousRevision: request.observationRevision,
            completedSteps,
            totalSteps: request.steps.length,
            observation,
            changed,
            outcome: 'completed'
        }
    }

    async perform(principal: ControlPrincipal, requestValue: unknown, signal?: AbortSignal): Promise<ControlPlanResult> {
        this.assertAlive()
        const request = assertControlPlanRequest(requestValue)
        const grant = this.grants.requireRemaining(request.grantId, principal, request.steps.length + 1)
        if (grant.targetId !== request.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another target.')
        if (request.observationMode !== 'visual' && !grant.capabilities.includes('observe.structure')) {
            throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'The stage checkpoint requires structure observation authority.')
        }
        if ((request.includeScreenshot || request.observationMode === 'visual') && !grant.capabilities.includes('observe.screenshot')) {
            throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'The stage checkpoint requires screenshot authority.')
        }
        if (request.observationMode === 'visual' && !request.includeScreenshot) {
            throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Visual stage checkpoints must include a screenshot.')
        }
        const registered = this.targets.get(request.targetId)
        if (registered.target.kind !== 'zyra-browser') {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Staged Browser execution currently supports only integrated Zyra Browser tabs.')
        }
        assertGrantSupportsTarget(grant, registered.target)
        const requestedObservation = this.observations.requireRevision(request.targetId, request.observationRevision)
        const requiredSideEffects = request.steps.map((action) => controlActionRequiresApproval(action) ? action.sideEffect : undefined)
        for (const [index, action] of request.steps.entries()) {
            assertActionAllowed(grant, registered.target, action, { approvedSideEffect: requiredSideEffects[index] })
            assertSafeObservedElementAction(requestedObservation, action)
            assertVisualActionInsideObservation(requestedObservation, action)
            assertActionInsideStageRegion(request.stage.expectedRegion, action)
        }
        for (const [index, action] of request.steps.entries()) {
            const requiredSideEffect = requiredSideEffects[index]
            if (!requiredSideEffect) continue
            await this.waitForActionApproval(principal, grant, {
                version: 1,
                requestId: `${request.requestId}:step:${index + 1}`,
                grantId: request.grantId,
                targetId: request.targetId,
                observationRevision: request.observationRevision,
                action
            }, requiredSideEffect, signal)
        }
        return this.actions.enqueue(request.targetId, async () => {
            const currentGrant = this.grants.requireRemaining(request.grantId, principal, request.steps.length + 1)
            const previousObservation = this.observations.requireRevision(request.targetId, request.observationRevision)
            const planId = `control-plan:${request.requestId}`
            const interactionCheckpoint = this.interactionArbiter.checkpoint(request.targetId)
            const bounded = boundedControlSignal(signal, 12_000)
            let completedSteps = 0
            let changed = false
            let pauseDecision: ReturnType<TargetInteractionArbiter['decide']> | null = null
            const startedAt = Date.now()
            this.activeStageByTarget.set(request.targetId, planId)
            try {
                for (const [index, action] of request.steps.entries()) {
                    this.grants.requireActive(currentGrant.grantId, principal)
                    assertActionAllowed(currentGrant, registered.target, action, { approvedSideEffect: requiredSideEffects[index] })
                    assertSafeObservedElementAction(previousObservation, action)
                    assertVisualActionInsideObservation(previousObservation, action)
                    const actionResult = await registered.driver.act(registered, action, {
                        revision: request.observationRevision,
                        previousObservation,
                        signal: bounded.signal,
                        updateCursor: (patch) => this.updateCursor(request.targetId, principal, action.type, patch),
                        runAgentInput: (operation) => this.runAgentInput(request.targetId, operation)
                    })
                    changed = changed || actionResult.changed
                    completedSteps += 1
                    const consumed = this.grants.consume(request.grantId)
                    if (consumed.state === 'consumed') {
                        registered.driver.releaseInputFocus?.(registered)
                        this.clearCursorIfNoActiveGrant(request.targetId)
                        this.releaseTargetIfIdle(request.targetId)
                    }
                    const decision = this.interactionArbiter.decide(request.targetId, interactionCheckpoint, request.stage)
                    if (decision.disposition === 'pause') {
                        pauseDecision = decision
                        break
                    }
                }
                bounded.dispose()
                const revision = this.observations.nextRevision(request.targetId)
                const observation = boundObservation(redactObservation(await registered.driver.observe(registered, {
                    revision,
                    includeScreenshot: request.includeScreenshot,
                    mode: request.observationMode,
                    signal
                })))
                this.commitObservation(observation)
                const consumed = this.grants.consume(request.grantId)
                if (consumed.state === 'consumed') {
                    registered.driver.releaseInputFocus?.(registered)
                    this.clearCursorIfNoActiveGrant(request.targetId)
                    this.releaseTargetIfIdle(request.targetId)
                }
                if (pauseDecision) {
                    this.pausedPlans.set(planId, { planId, request, principal, completedSteps, pausedAt: new Date().toISOString() })
                } else {
                    this.pausedPlans.delete(planId)
                }
                this.audit.append({
                    eventType: 'plan', actor: 'agent', principal, targetId: request.targetId, targetKind: registered.target.kind,
                    grantId: request.grantId, stageId: planId, origin: observation.origin,
                    observationRevision: observation.revision, outcome: pauseDecision ? 'cancelled' : 'completed',
                    elapsedMs: Date.now() - startedAt,
                    message: pauseDecision ? `Stage paused after ${completedSteps} of ${request.steps.length} steps at a clean action boundary.` : `Stage completed ${completedSteps} bounded steps.`,
                    redactions: ['typed-text']
                })
                this.changed()
                return {
                    version: 1,
                    requestId: request.requestId,
                    planId,
                    targetId: request.targetId,
                    previousRevision: request.observationRevision,
                    completedSteps,
                    totalSteps: request.steps.length,
                    observation,
                    changed,
                    outcome: pauseDecision ? 'paused' : 'completed',
                    ...(pauseDecision ? {
                        pause: {
                            reason: pauseDecision.reason || 'Purposeful target-local user activity diverged from the active stage.',
                            evidence: pauseDecision.evidence.map(({ actor, category, targetId, x, y, stageId, occurredAt }) => ({ actor, category, targetId, x, y, stageId, occurredAt })),
                            choices: ['continue-with-changes', 'replan-from-here', 'user-takeover'] as const
                        }
                    } : {})
                }
            } catch (error) {
                this.audit.append({
                    eventType: 'plan', actor: 'agent', principal, targetId: request.targetId, targetKind: registered.target.kind,
                    grantId: request.grantId, stageId: planId,
                    outcome: signal?.aborted || bounded.signal.aborted ? 'cancelled' : 'failed', elapsedMs: Date.now() - startedAt,
                    message: error instanceof Error ? error.message : 'Browser stage failed.', redactions: ['typed-text']
                })
                throw toAgentControlError(error)
            } finally {
                bounded.dispose()
                if (this.activeStageByTarget.get(request.targetId) === planId) this.activeStageByTarget.delete(request.targetId)
            }
        }, signal)
    }

    revokeGrant(grantId: string, principal?: ControlPrincipal): void {
        if (principal) this.grants.requireActive(grantId, principal)
        const grant = this.grants.revoke(grantId)
        if (!grant) return
        this.releaseInputFocus(grant.targetId)
        this.clearCursorIfNoActiveGrant(grant.targetId)
        for (const [planId, plan] of this.pausedPlans) {
            if (plan.request.grantId === grantId) this.pausedPlans.delete(planId)
        }
        for (const pending of [...this.pendingActionApprovals.values()]) {
            if (pending.grantId === grantId) this.cancelPendingActionApproval(pending.requestId, 'The control grant was revoked.')
        }
        this.audit.append({
            eventType: 'grant.revoked', principal: grant.principal, targetId: grant.targetId,
            grantId: grant.grantId, outcome: 'cancelled', message: 'Control grant revoked.', redactions: []
        })
        this.releaseTargetIfIdle(grant.targetId)
        this.changed()
    }

    revokePrincipal(principal: ControlPrincipal, reason = 'Principal control cancelled.'): void {
        const revoked = this.grants.revokeByPrincipal(principal)
        const pending = this.grants.removePendingByPrincipal(principal)
        for (const targetId of new Set(revoked.map((grant) => grant.targetId))) {
            this.releaseInputFocus(targetId)
            this.clearCursorIfNoActiveGrant(targetId)
        }
        for (const grant of revoked) {
            this.audit.append({
                eventType: 'grant.revoked', principal: grant.principal, targetId: grant.targetId,
                grantId: grant.grantId, outcome: 'cancelled', message: reason, redactions: []
            })
        }
        for (const request of pending) {
            this.audit.append({
                eventType: 'grant.revoked', principal: request.principal, targetId: request.targetId,
                outcome: 'cancelled', message: `${reason} Pending request removed.`, redactions: []
            })
            this.pendingGrantWaiters.get(request.requestId)?.reject(new AgentControlError('CONTROL_CANCELLED', reason))
        }
        for (const targetId of new Set([...revoked, ...pending].map((entry) => entry.targetId))) this.releaseTargetIfIdle(targetId)
        for (const driver of this.options.drivers || []) void driver.releaseIdle?.()
        const pendingActions = [...this.pendingActionApprovals.values()].filter((request) => sameControlPrincipal(request.principal, principal))
        for (const request of pendingActions) this.cancelPendingActionApproval(request.requestId, reason)
        if (revoked.length || pending.length || pendingActions.length) this.changed()
    }

    async emergencyStop(reason = 'Emergency stop requested by user.'): Promise<void> {
        this.actions.cancelAll(reason)
        this.browserSurface?.cancelPending(reason)
        this.grants.revokeAll()
        this.userAuthorizedBrowserIntents.clear()
        for (const pending of this.grants.listPending()) {
            this.grants.removePending(pending.requestId)
            this.pendingGrantWaiters.get(pending.requestId)?.reject(new AgentControlError('CONTROL_CANCELLED', reason))
        }
        for (const pending of [...this.pendingActionApprovals.values()]) {
            this.cancelPendingActionApproval(pending.requestId, reason)
        }
        this.observations.invalidateAll()
        this.cursors.clear()
        this.interactionArbiter.clear()
        this.activeStageByTarget.clear()
        this.agentInputDepth.clear()
        this.pausedPlans.clear()
        for (const timer of this.cursorPublishTimers.values()) clearTimeout(timer)
        this.cursorPublishTimers.clear()
        this.cursorPublishedAt.clear()
        await Promise.allSettled((this.options.drivers || []).map((driver) => Promise.resolve(driver.emergencyStop?.())))
        await this.options.pairing?.stop('emergency-stop')
        this.audit.append({ eventType: 'emergency-stop', outcome: 'cancelled', message: reason, redactions: [] })
        this.changed()
    }

    async startChromePairing(): Promise<ControlPairingState> {
        if (!this.options.pairing) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Chrome pairing is unavailable.')
        const state = await this.options.pairing.start()
        this.audit.append({ eventType: 'pairing', outcome: 'allowed', message: 'Chrome pairing started.', redactions: ['pairing-secrets'] })
        this.changed()
        return state
    }

    async stopChromePairing(): Promise<void> {
        await this.options.pairing?.stop('user-request')
        this.audit.append({ eventType: 'pairing', outcome: 'cancelled', message: 'Chrome pairing stopped.', redactions: ['pairing-secrets'] })
        this.changed()
    }

    async listWindows(queryValue?: string): Promise<ControlWindowCandidate[]> {
        const driver = this.options.drivers?.find((entry) => entry.kind === 'windows-window')
        if (!driver?.listWindows) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows computer use is unavailable.')
        const query = String(queryValue || '').trim().toLocaleLowerCase('en-US')
        if (query.length > 128) throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Windows application search is too long.')
        const selectedTargets = this.targets.list('windows-window')
        return (await driver.listWindows()).filter((candidate) => (
            !query
            || candidate.applicationName.toLocaleLowerCase('en-US').includes(query)
            || candidate.title.toLocaleLowerCase('en-US').includes(query)
        )).map((candidate) => {
            const selected = selectedTargets.find((entry) => (
                entry.driver === driver
                && entry.driver.isTargetCurrent?.(entry) !== false
                && entry.target.kind === 'windows-window'
                && entry.target.windowToken === candidate.windowToken
                && entry.target.processId === candidate.processId
                && entry.target.executableIdentity === candidate.executableIdentity
            ))
            return selected ? { ...candidate, targetId: selected.target.targetId } : candidate
        })
    }

    async openWindowsApp(principal: ControlPrincipal, applicationValue: string, signal?: AbortSignal): Promise<{ applicationName: string; windows: ControlWindowCandidate[]; launched: boolean }> {
        const driver = this.options.drivers?.find((entry) => entry.kind === 'windows-window')
        if (!driver?.openApp) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Opening registered Windows applications is unavailable.')
        const application = String(applicationValue || '').trim()
        if (!application || application.length > 128 || /[\u0000-\u001f\u007f]/u.test(application)) {
            throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'A registered application name between 1 and 128 characters is required.')
        }
        const existingWindows = (await this.listWindows(application)).filter((candidate) => (
            candidate.applicationName.localeCompare(application, 'en-US', { sensitivity: 'accent' }) === 0
            || candidate.title.localeCompare(application, 'en-US', { sensitivity: 'accent' }) === 0
        ))
        if (existingWindows.length > 0) {
            this.audit.append({
                eventType: 'target', principal,
                outcome: 'completed', message: 'A running query-matched Windows application was reused without opening a duplicate window.',
                redactions: ['application-name']
            })
            return { applicationName: application, windows: existingWindows, launched: false }
        }
        const opened = await driver.openApp(application, signal)
        const queries = [...new Set([opened.applicationName, application])]
        let windows: ControlWindowCandidate[] = []
        let previousCandidateSet = ''
        let stablePasses = 0
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (signal?.aborted) throw new AgentControlError('CONTROL_CANCELLED', 'Opening the Windows application was cancelled.')
            let current: ControlWindowCandidate[] = []
            for (const query of queries) {
                current = await this.listWindows(query)
                if (current.length > 0) break
            }
            const exactMatches = current.filter((candidate) => queries.some((query) => (
                candidate.applicationName.localeCompare(query, 'en-US', { sensitivity: 'accent' }) === 0
                || candidate.title.localeCompare(query, 'en-US', { sensitivity: 'accent' }) === 0
            )))
            if (exactMatches.length > 0) current = exactMatches
            const candidateSet = current.map((candidate) => candidate.windowToken).sort().join('\n')
            stablePasses = candidateSet.length > 0 && candidateSet === previousCandidateSet ? stablePasses + 1 : candidateSet.length > 0 ? 1 : 0
            previousCandidateSet = candidateSet
            windows = current
            if (stablePasses >= 3) break
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
        }
        this.audit.append({
            eventType: 'target', principal,
            outcome: 'completed', message: 'A query-resolved registered Windows application was opened and its candidate set stabilized.',
            redactions: ['application-name']
        })
        return { applicationName: opened.applicationName, windows, launched: true }
    }

    async selectWindow(windowToken: string): Promise<ControlTarget> {
        const driver = this.options.drivers?.find((entry) => entry.kind === 'windows-window')
        if (!driver?.selectWindow) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows computer use is unavailable.')
        const selected = await driver.selectWindow(assertControlIdentifier(windowToken, 'windowToken'))
        const existing = this.targets.list('windows-window').find((entry) => (
            entry.target.kind === 'windows-window'
            && entry.target.sidecarSessionId === selected.target.sidecarSessionId
            && entry.target.windowToken === selected.target.windowToken
            && entry.target.processId === selected.target.processId
            && entry.target.executableIdentity === selected.target.executableIdentity
        ))
        if (existing) return existing.target
        const target: ControlTarget = { ...selected.target, targetId: this.targets.createTargetId('windows-window') }
        return this.registerTarget({ target, driver, trustedIdentity: selected.trustedIdentity })
    }

    state(ownerWebContentsId?: number): ControlStateSnapshot {
        this.expireControlAuthority(false)
        const grants = this.grants.list()
        return {
            version: 1,
            targets: this.targets.list().map((entry) => entry.target),
            grants,
            pendingGrants: this.grants.listPending(),
            pendingActionApprovals: [...this.pendingActionApprovals.values()],
            audit: this.audit.list(),
            health: (this.options.drivers || []).map((driver) => ({
                targetKind: driver.kind,
                ...(driver.health?.() || { state: 'ready' as const }),
                updatedAt: new Date().toISOString()
            })),
            cursors: [...this.cursors.values()],
            workspace: ownerWebContentsId === undefined ? this.workspace : this.workspacesByOwner.get(ownerWebContentsId) || null,
            pairing: this.options.pairing?.state() || { state: 'stopped' },
            active: grants.some((grant) => grant.state === 'active'),
            sequence: this.sequence
        }
    }

    async handleToolOperation(
        principalValue: unknown,
        operationValue: unknown,
        signal?: AbortSignal,
        options: { permissionMode?: 'approval-required' | 'auto-review' | 'edits-only' | 'full-access' } = {}
    ): Promise<Record<string, unknown>> {
        this.assertAlive()
        assertBridgeMessageSize(operationValue)
        const principal = assertControlPrincipal(principalValue)
        if (!operationValue || typeof operationValue !== 'object' || Array.isArray(operationValue)) {
            throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Control operation is invalid.')
        }
        const operation = operationValue as AgentControlBridgeOperation
        switch (operation.operation) {
            case 'open_tab': {
                if (operation.reveal !== undefined && typeof operation.reveal !== 'boolean') {
                    throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Browser reveal must be a boolean.')
                }
                if (operation.sessionMode !== undefined && operation.sessionMode !== 'normal' && operation.sessionMode !== 'incognito') {
                    throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Browser session mode must be normal or incognito.')
                }
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                if (principal.type === 'agent' && operation.reveal) {
                    throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents may create background Browser tabs but cannot reveal or take over the user interface.')
                }
                const revealed = principal.type === 'root' && operation.reveal === true
                const sessionMode = operation.sessionMode || 'incognito'
                const target = await this.browserSurface.openTab(principal, revealed, sessionMode, signal)
                this.assertBrowserTargetOwnedByPrincipal(principal, target)
                return { target, revealed }
            }
            case 'list_targets': {
                const kind = operation.targetKind
                const ownerThreadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
                const activeGrants = this.grants.listForPrincipal(principal).filter((grant) => grant.state === 'active')
                const ownedTargets = this.targets.list(kind).filter((entry) => (
                    entry.target.kind !== 'zyra-browser' || entry.target.ownerThreadId === ownerThreadId
                ))
                const workspace = this.workspaceForThread(ownerThreadId)
                if (principal.type === 'root') {
                    return { targets: ownedTargets.map((entry) => entry.target), grants: activeGrants, workspace }
                }
                const grantedTargetIds = new Set(activeGrants.map((grant) => grant.targetId))
                const targets = ownedTargets.filter((entry) => (
                    entry.target.kind === 'zyra-browser' || grantedTargetIds.has(entry.target.targetId)
                )).map((entry) => entry.target)
                return { targets, grants: activeGrants, workspace }
            }
            case 'reveal_tab': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot reveal or take over the Browser workspace.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const target = this.requireBrowserTarget(operation.targetId, principal)
                await this.browserSurface.revealTabs(principal, target, null, signal)
                return { target, workspace: this.workspaceForTarget(target.targetId) }
            }
            case 'close_tab': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot close Browser tabs.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const target = this.requireBrowserTarget(operation.targetId, principal)
                const grant = this.grants.requireActive(assertControlIdentifier(operation.grantId, 'grantId'), principal)
                if (grant.targetId !== target.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another Browser tab.')
                if (!grant.capabilities.includes('tab.manage')) {
                    throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Closing a Browser tab requires an explicit tab.manage grant.')
                }
                assertGrantSupportsTarget(grant, target)
                await this.browserSurface.closeTab(principal, target, signal)
                this.grants.consume(grant.grantId)
                this.grants.revoke(grant.grantId)
                this.audit.append({
                    eventType: 'action', principal, targetId: target.targetId, targetKind: target.kind,
                    grantId: grant.grantId, outcome: 'completed', message: 'Browser tab closed through bounded tab management.', redactions: []
                })
                this.audit.append({
                    eventType: 'grant.revoked', principal, targetId: target.targetId, targetKind: target.kind,
                    grantId: grant.grantId, outcome: 'cancelled', message: 'Tab management authority ended when the Browser tab closed.', redactions: []
                })
                this.changed()
                return { closed: true, targetId: target.targetId, tabId: target.tabId }
            }
            case 'refresh_tab': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot refresh the visible Browser tab.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const target = this.requireBrowserTarget(operation.targetId, principal)
                const grant = this.requireBrowserGrant(principal, target, operation.grantId, 'navigate')
                await this.browserSurface.commandTab(principal, target, 'refresh', null, signal)
                this.completeBrowserTabCommand(principal, target, grant, 'Browser tab refresh completed.')
                return { completed: true, targetId: target.targetId, tabId: target.tabId }
            }
            case 'open_external': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot open the user\'s default browser.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const target = this.requireBrowserTarget(operation.targetId, principal)
                const grant = this.requireBrowserGrant(principal, target, operation.grantId, 'tab.manage')
                const url = String(operation.url || target.url || '')
                const origin = normalizedOrigin(url)
                if (!origin || url.length > CONTROL_BOUNDS.maxUrlLength) {
                    throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Opening the default browser requires a bounded HTTP(S) URL.')
                }
                if (!grant.allowedOrigins?.includes(origin)) {
                    throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The external URL is outside the grant origin scope.')
                }
                await this.browserSurface.commandTab(principal, target, 'external', url, signal)
                this.completeBrowserTabCommand(principal, target, grant, 'Approved URL opened in the default browser.')
                return { completed: true, targetId: target.targetId, tabId: target.tabId, url }
            }
            case 'set_tab_layout': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot change the visible Browser layout.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const primary = this.requireBrowserTarget(operation.primaryTargetId, principal)
                const secondary = operation.secondaryTargetId ? this.requireBrowserTarget(operation.secondaryTargetId, principal) : null
                if (secondary?.targetId === primary.targetId) throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'A Browser split requires two different targets.')
                await this.browserSurface.revealTabs(principal, primary, secondary, signal, true)
                return {
                    layout: secondary ? 'split' : 'single',
                    primaryTargetId: primary.targetId,
                    secondaryTargetId: secondary?.targetId,
                    workspace: this.workspaceForTarget(primary.targetId)
                }
            }
            case 'resize_inspector': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot resize the visible Inspector workspace.')
                if (!this.browserSurface) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The in-app Browser workspace is unavailable.')
                const target = this.requireBrowserTarget(operation.targetId, principal)
                const requestedWidth = Number(operation.width)
                if (!Number.isFinite(requestedWidth)) throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Inspector width must be a finite number.')
                const width = Math.max(CONTROL_BOUNDS.minInspectorWidth, Math.min(CONTROL_BOUNDS.maxInspectorWidth, Math.round(requestedWidth)))
                const resized = await this.browserSurface.resizeInspector(principal, target, width, signal)
                return { targetId: target.targetId, tabId: target.tabId, requestedWidth: width, width: resized.width }
            }
            case 'list_windows':
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot enumerate or select Windows targets.')
                if (!String(operation.query || '').trim()) {
                    throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Windows tool search requires the application requested by the user.')
                }
                return { windows: await this.listWindows(operation.query) }
            case 'open_app':
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot open Windows applications.')
                return await this.openWindowsApp(principal, operation.application, signal)
            case 'use_app': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot open or select Windows applications.')
                const capabilities = assertControlCapabilities(operation.capabilities)
                const requestedSequence = operation.steps?.length
                    ? assertControlSemanticActionSequenceRequest({
                        version: 1,
                        requestId: operation.requestId || `use-app:${randomUUID()}`,
                        grantId: 'control-grant:pending',
                        targetId: 'control-target:pending',
                        observationRevision: 1,
                        steps: operation.steps
                    })
                    : null
                const opened = await this.openWindowsApp(principal, operation.application, signal)
                const candidates = opened.windows.filter((candidate) => !candidate.blocked)
                if (candidates.length !== 1) {
                    throw new AgentControlError(
                        'CONTROL_TARGET_AMBIGUOUS',
                        candidates.length === 0
                            ? 'The requested registered app did not expose a controllable window.'
                            : `The requested app has ${candidates.length} matching windows. Select one exact window before requesting access.`
                    )
                }
                const result = await this.handleToolOperation(principal, {
                    operation: 'request_grant',
                    windowToken: candidates[0].windowToken,
                    capabilities,
                    durationMs: operation.durationMs,
                    maxActions: operation.maxActions
                }, signal, options)
                const grant = result.grant as ControlGrant | undefined
                if (!grant) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows app access did not return its bounded grant.')
                this.expireControlAuthority(false)
                for (const previous of this.grants.listForPrincipal(principal)) {
                    if (previous.grantId === grant.grantId || previous.state !== 'active') continue
                    let previousTarget: ControlTarget
                    try {
                        previousTarget = this.targets.get(previous.targetId).target
                    } catch {
                        this.revokeGrant(previous.grantId, principal)
                        continue
                    }
                    if (previousTarget.kind === 'windows-window') this.revokeGrant(previous.grantId, principal)
                }
                if (!requestedSequence) {
                    return { ...result, applicationName: opened.applicationName, launched: opened.launched }
                }
                const observation = result.observation as ControlObservation | undefined
                if (!observation) {
                    this.revokeGrant(grant.grantId)
                    throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows app access did not return the initial granted observation.')
                }
                let sequence: ControlSemanticActionSequenceResult
                try {
                    sequence = await this.semanticActionSequence(principal, {
                        version: 1,
                        requestId: requestedSequence.requestId,
                        grantId: grant.grantId,
                        targetId: grant.targetId,
                        observationRevision: observation.revision,
                        steps: requestedSequence.steps
                    }, signal)
                } catch (error) {
                    this.revokeGrant(grant.grantId)
                    throw error
                }
                return {
                    ...result,
                    grant: this.grants.listForPrincipal(principal).find((entry) => entry.grantId === grant.grantId) || grant,
                    observation: compactCompletedSequenceObservation(observation, sequence.observation),
                    sequence: {
                        previousRevision: sequence.previousRevision,
                        completedSteps: sequence.completedSteps,
                        totalSteps: sequence.totalSteps,
                        changed: sequence.changed,
                        outcome: sequence.outcome
                    },
                    applicationName: opened.applicationName,
                    launched: opened.launched
                }
            }
            case 'request_grant': {
                if (operation.targetId && operation.windowToken) {
                    throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'A control request must identify one existing target or one Windows candidate.')
                }
                let requestedTarget: ControlTarget
                if (operation.windowToken) {
                    if (principal.type !== 'root') {
                        throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents cannot select Windows targets.')
                    }
                    requestedTarget = await this.selectWindow(assertControlIdentifier(operation.windowToken, 'windowToken'))
                } else {
                    requestedTarget = this.targets.get(assertControlIdentifier(operation.targetId, 'targetId')).target
                }
                if (principal.type === 'agent' && requestedTarget.kind !== 'zyra-browser') {
                    throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Child agents may request only an integrated Zyra Browser tab. Chrome and Windows require root delegation.')
                }
                if (requestedTarget.kind === 'zyra-browser') this.assertBrowserTargetOwnedByPrincipal(principal, requestedTarget)
                if (principal.type === 'root' && requestedTarget.kind === 'zyra-browser' && this.browserSurface) {
                    await this.browserSurface.revealTabs(principal, requestedTarget, null, signal)
                }
                const automaticGrant = principal.type === 'root' && (
                    options.permissionMode === 'full-access'
                    || (options.permissionMode === 'auto-review' && requestedTarget.kind === 'zyra-browser')
                )
                const completeGrant = async (request: ReturnType<AgentControlBroker['requestGrant']>, grant: ControlGrant) => {
                    const observation = requestedTarget.kind === 'windows-window' && grant.capabilities.includes('observe.structure')
                        ? await this.observe(principal, grant.grantId, requestedTarget.targetId, false, signal, 'structure')
                        : undefined
                    return { pending: false, request, grant, ...(observation ? { observation } : {}) }
                }
                const request = this.requestGrant({
                    principal,
                    targetId: requestedTarget.targetId,
                    capabilities: operation.capabilities,
                    durationMs: operation.durationMs,
                    maxActions: operation.maxActions,
                    allowedOrigins: operation.allowedOrigins,
                    allowedExecutableIdentities: operation.allowedExecutableIdentities
                }, { silent: automaticGrant })
                if (automaticGrant) {
                    const grant = this.approvePendingGrant({
                        pendingRequestId: request.requestId,
                        targetId: request.targetId,
                        capabilities: request.capabilities,
                        durationMs: Math.max(1_000, Date.parse(request.expiresAt) - Date.now()),
                        maxActions: request.maxActions,
                        allowedOrigins: request.allowedOrigins,
                        allowedExecutableIdentities: request.allowedExecutableIdentities
                    }, {
                        auditMessage: options.permissionMode === 'auto-review'
                            ? 'Auto review issued a bounded in-app Browser grant.'
                            : 'Full access issued a bounded control grant.'
                    })
                    return await completeGrant(request, grant)
                }
                const grant = await this.waitForPendingGrant(request.requestId, signal)
                return await completeGrant(request, grant)
            }
            case 'delegate_lease': {
                if (principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Only the root agent may delegate a control lease.')
                const childPrincipal = assertControlPrincipal(operation.childPrincipal)
                if (childPrincipal.type !== 'agent' || childPrincipal.parentThreadId !== principal.threadId) {
                    throw new AgentControlError('CONTROL_PRINCIPAL_MISMATCH', 'The delegated child does not belong to the current root thread.')
                }
                const maxActions = Number(operation.maxActions)
                if (!Number.isSafeInteger(maxActions) || maxActions < 1) throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Delegated maxActions must be a positive integer.')
                const grant = this.delegate({
                    parentGrantId: assertControlIdentifier(operation.parentGrantId, 'parentGrantId'),
                    parentPrincipal: principal,
                    childPrincipal,
                    targetId: assertControlIdentifier(operation.targetId, 'targetId'),
                    capabilities: assertControlCapabilities(operation.capabilities),
                    expiresAt: String(operation.expiresAt),
                    maxActions,
                    allowedOrigins: operation.allowedOrigins,
                    allowedExecutableIdentities: operation.allowedExecutableIdentities
                })
                return { grant }
            }
            case 'revoke_current_principal':
                if (principal.type !== 'agent') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Only a delegated child runtime may revoke its principal lease through this operation.')
                this.revokePrincipal(principal, operation.reason || 'Child run ended or was cancelled.')
                return { revoked: true }
            case 'observe': {
                const includeScreenshot = Boolean(operation.includeScreenshot)
                const mode = operation.mode || 'both'
                const observation = await this.observe(principal, operation.grantId, operation.targetId, includeScreenshot, signal, mode)
                const registered = this.targets.get(operation.targetId)
                const screenshot = includeScreenshot && observation.screenshotRef
                    ? registered.driver.readScreenshot?.(observation.screenshotRef)
                    : undefined
                return { observation, ...(screenshot ? { screenshot } : {}) }
            }
            case 'act':
                return await this.act(principal, operation, signal) as unknown as Record<string, unknown>
            case 'act_sequence': {
                return await this.semanticActionSequence(principal, operation, signal) as unknown as Record<string, unknown>
            }
            case 'perform': {
                const plan = await this.perform(principal, operation, signal)
                const registered = this.targets.get(plan.targetId)
                const screenshot = plan.observation.screenshotRef
                    ? registered.driver.readScreenshot?.(plan.observation.screenshotRef)
                    : undefined
                return { ...plan, ...(screenshot ? { screenshot } : {}) } as unknown as Record<string, unknown>
            }
            case 'plan_status': {
                const plans = [...this.pausedPlans.values()].filter((plan) => sameControlPrincipal(plan.principal, principal))
                    .filter((plan) => !operation.planId || plan.planId === operation.planId)
                    .map((plan) => ({
                        planId: plan.planId,
                        targetId: plan.request.targetId,
                        grantId: plan.request.grantId,
                        stage: plan.request.stage,
                        completedSteps: plan.completedSteps,
                        totalSteps: plan.request.steps.length,
                        remainingSteps: plan.request.steps.length - plan.completedSteps,
                        pausedAt: plan.pausedAt
                    }))
                return { plans }
            }
            case 'resume_plan': {
                const plan = this.requirePausedPlan(operation.planId, principal)
                const observation = await this.observe(
                    principal,
                    plan.request.grantId,
                    plan.request.targetId,
                    plan.request.includeScreenshot,
                    signal,
                    plan.request.observationMode
                )
                this.pausedPlans.delete(plan.planId)
                const registered = this.targets.get(plan.request.targetId)
                const screenshot = observation.screenshotRef
                    ? registered.driver.readScreenshot?.(observation.screenshotRef)
                    : undefined
                return {
                    planId: plan.planId,
                    disposition: operation.disposition,
                    replanningRequired: true,
                    completedSteps: plan.completedSteps,
                    remainingSteps: plan.request.steps.length - plan.completedSteps,
                    observation,
                    ...(screenshot ? { screenshot } : {})
                }
            }
            case 'cancel_plan': {
                const plan = this.requirePausedPlan(operation.planId, principal)
                this.pausedPlans.delete(plan.planId)
                if (operation.releaseGrant) this.revokeGrant(plan.request.grantId, principal)
                this.changed()
                return { cancelled: true, planId: plan.planId, grantReleased: Boolean(operation.releaseGrant) }
            }
            case 'release':
                this.revokeGrant(operation.grantId, principal)
                return { released: true }
            default:
                throw new AgentControlError('CONTROL_UNKNOWN_OPERATION', 'Unknown control bridge operation.')
        }
    }

    clearAudit(): void {
        this.audit.clear()
        this.changed()
    }

    private commitObservation(observation: ControlObservation): void {
        this.observations.set(observation)
        const current = this.observations.get(observation.targetId)
        const currentRevision = this.observations.currentRevision(observation.targetId)
        if (currentRevision !== observation.revision || current?.observationId !== observation.observationId) {
            throw new AgentControlError(
                'CONTROL_STALE_OBSERVATION',
                'The Browser viewport or document changed while the observation was captured. Observe it again before acting.',
                { retryable: true, freshRevision: currentRevision || undefined }
            )
        }
    }

    private retainTarget(targetId: string): void {
        const registered = this.targets.list().find((entry) => entry.target.targetId === targetId)
        registered?.driver.retainTarget?.(registered)
    }

    private releaseTargetIfIdle(targetId: string): void {
        const hasGrant = this.grants.list().some((grant) => grant.targetId === targetId && grant.state === 'active')
        const hasPending = this.grants.listPending().some((request) => request.targetId === targetId)
        if (hasGrant || hasPending) return
        const registered = this.targets.list().find((entry) => entry.target.targetId === targetId)
        if (!registered) return
        try {
            void Promise.resolve(registered.driver.release?.(registered)).catch(() => undefined)
        } catch {}
    }

    private clearCursorIfNoActiveGrant(targetId: string): void {
        if (this.grants.list().some((grant) => grant.targetId === targetId && grant.state === 'active')) return
        this.clearCursor(targetId)
    }

    private clearCursor(targetId: string): void {
        this.cursors.delete(targetId)
        const timer = this.cursorPublishTimers.get(targetId)
        if (timer) clearTimeout(timer)
        this.cursorPublishTimers.delete(targetId)
        this.cursorPublishedAt.delete(targetId)
    }

    private releaseInputFocus(targetId: string): void {
        const registered = this.targets.list().find((entry) => entry.target.targetId === targetId)
        if (registered) registered.driver.releaseInputFocus?.(registered)
    }

    private requireBrowserTarget(
        targetIdValue: unknown,
        principal?: ControlPrincipal
    ): Extract<ControlTarget, { kind: 'zyra-browser' }> {
        const target = this.targets.get(assertControlIdentifier(targetIdValue, 'targetId')).target
        if (target.kind !== 'zyra-browser') {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The selected target is not an integrated Zyra Browser tab.')
        }
        if (principal) this.assertBrowserTargetOwnedByPrincipal(principal, target)
        return target
    }

    private assertBrowserTargetOwnedByPrincipal(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>
    ): void {
        const ownerThreadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        if (target.ownerThreadId !== ownerThreadId) {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The Browser tab belongs to another chat thread.')
        }
    }

    private requireBrowserGrant(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        grantIdValue: unknown,
        capability: ControlCapability
    ): ControlGrant {
        const grant = this.grants.requireActive(assertControlIdentifier(grantIdValue, 'grantId'), principal)
        if (grant.targetId !== target.targetId) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The grant is bound to another Browser tab.')
        if (!grant.capabilities.includes(capability)) {
            throw new AgentControlError('CONTROL_CAPABILITY_DENIED', `This Browser tab command requires an explicit ${capability} grant.`)
        }
        assertGrantSupportsTarget(grant, target)
        return grant
    }

    private completeBrowserTabCommand(
        principal: ControlPrincipal,
        target: Extract<ControlTarget, { kind: 'zyra-browser' }>,
        grant: ControlGrant,
        message: string
    ): void {
        const consumed = this.grants.consume(grant.grantId)
        if (consumed.state === 'consumed') {
            this.releaseInputFocus(target.targetId)
            this.clearCursorIfNoActiveGrant(target.targetId)
        }
        this.audit.append({
            eventType: 'action', principal, targetId: target.targetId, targetKind: target.kind,
            grantId: grant.grantId, outcome: 'completed', message, redactions: []
        })
        this.changed()
    }

    private waitForActionApproval(
        principal: ControlPrincipal,
        grant: ControlGrant,
        request: ControlActionRequest,
        sideEffect: Exclude<ControlSideEffectClass, 'none'>,
        signal?: AbortSignal
    ): Promise<void> {
        const requestId = `control-action-approval:${randomUUID()}`
        const now = Date.now()
        const expiresAtMs = Math.min(Date.parse(grant.expiresAt), now + 10 * 60 * 1_000)
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
            return Promise.reject(new AgentControlError('CONTROL_GRANT_EXPIRED', 'The control grant expired before approval could be requested.'))
        }
        const pending: ControlPendingActionApproval = {
            requestId,
            principal,
            targetId: request.targetId,
            grantId: request.grantId,
            actionRequestId: request.requestId,
            actionType: request.action.type,
            sideEffect,
            observationRevision: request.observationRevision,
            requestedAt: new Date(now).toISOString(),
            expiresAt: new Date(expiresAtMs).toISOString()
        }
        this.pendingActionApprovals.set(requestId, pending)
        this.audit.append({
            eventType: 'action-approval.requested', principal, targetId: request.targetId,
            grantId: request.grantId, actionType: request.action.type, outcome: 'allowed',
            message: `Waiting for ${sideEffect} approval in chat.`, redactions: []
        })
        this.changed()

        return new Promise((resolve, reject) => {
            let settled = false
            const finish = (callback: () => void) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
                this.pendingActionApprovalWaiters.delete(requestId)
                callback()
            }
            const abort = () => this.cancelPendingActionApproval(requestId, 'Critical action approval was cancelled.')
            const timer = setTimeout(() => {
                this.cancelPendingActionApproval(requestId, 'Critical action approval timed out.')
            }, Math.max(1, expiresAtMs - Date.now()))
            timer.unref?.()
            this.pendingActionApprovalWaiters.set(requestId, {
                resolve: () => finish(resolve),
                reject: (error) => finish(() => reject(error))
            })
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
        })
    }

    private cancelPendingActionApproval(requestId: string, reason: string): void {
        const pending = this.pendingActionApprovals.get(requestId)
        if (!pending) return
        this.pendingActionApprovals.delete(requestId)
        this.audit.append({
            eventType: 'action-approval.resolved', principal: pending.principal, targetId: pending.targetId,
            grantId: pending.grantId, actionType: pending.actionType, outcome: 'denied',
            message: reason, redactions: []
        })
        this.changed()
        this.pendingActionApprovalWaiters.get(requestId)?.reject(
            new AgentControlError('CONTROL_CANCELLED', reason)
        )
    }

    private waitForPendingGrant(requestId: string, signal?: AbortSignal): Promise<ControlGrant> {
        const pendingRequest = this.grants.getPending(requestId)
        if (!pendingRequest) {
            return Promise.reject(new AgentControlError('CONTROL_GRANT_NOT_FOUND', 'The pending grant request is no longer available.'))
        }
        return new Promise((resolve, reject) => {
            let settled = false
            const expiryTimer = setTimeout(() => {
                this.expireControlAuthority(true)
            }, Math.max(1, Date.parse(pendingRequest.expiresAt) - Date.now()))
            const finish = <T>(callback: (value: T) => void, value: T) => {
                if (settled) return
                settled = true
                clearTimeout(expiryTimer)
                signal?.removeEventListener('abort', abort)
                this.pendingGrantWaiters.delete(requestId)
                callback(value)
            }
            const abort = () => {
                const pending = this.grants.removePending(requestId)
                if (pending) {
                    this.audit.append({
                        eventType: 'grant.revoked', principal: pending.principal, targetId: pending.targetId,
                        outcome: 'cancelled', message: 'Control approval wait was cancelled.', redactions: []
                    })
                    this.releaseTargetIfIdle(pending.targetId)
                    this.changed()
                }
                finish(reject, new AgentControlError('CONTROL_CANCELLED', 'Control approval was cancelled.'))
            }
            this.pendingGrantWaiters.set(requestId, {
                resolve: (grant) => finish(resolve, grant),
                reject: (error) => finish(reject, error)
            })
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort, { once: true })
        })
    }

    async dispose(): Promise<void> {
        if (this.disposed) return
        clearInterval(this.grantExpiryTimer)
        this.expireControlAuthority(false)
        await this.emergencyStop('Application shutdown.')
        this.disposed = true
        await Promise.allSettled((this.options.drivers || []).map((driver) => Promise.resolve(driver.dispose?.())))
        this.removeAllListeners()
    }

    private expireControlAuthority(notify: boolean): void {
        const expired = this.grants.expire()
        const expiredPending = this.grants.expirePending()
        if (!expired.length && !expiredPending.length) return
        for (const grant of expired) {
            this.releaseInputFocus(grant.targetId)
            this.clearCursorIfNoActiveGrant(grant.targetId)
            for (const [planId, plan] of this.pausedPlans) {
                if (plan.request.grantId === grant.grantId) this.pausedPlans.delete(planId)
            }
            for (const pending of [...this.pendingActionApprovals.values()]) {
                if (pending.grantId === grant.grantId) this.cancelPendingActionApproval(pending.requestId, 'The control grant expired.')
            }
            let targetKind: ControlTarget['kind'] | undefined
            try { targetKind = this.targets.get(grant.targetId).target.kind } catch {}
            this.audit.append({
                eventType: 'grant.expired', principal: grant.principal, targetId: grant.targetId,
                targetKind, grantId: grant.grantId, outcome: 'cancelled', message: 'Control grant expired.', redactions: []
            })
            this.releaseTargetIfIdle(grant.targetId)
        }
        for (const pending of expiredPending) {
            let targetKind: ControlTarget['kind'] | undefined
            try { targetKind = this.targets.get(pending.targetId).target.kind } catch {}
            this.audit.append({
                eventType: 'grant.expired', principal: pending.principal, targetId: pending.targetId,
                targetKind, outcome: 'cancelled', message: 'Control grant request expired before approval.', redactions: []
            })
            this.releaseTargetIfIdle(pending.targetId)
            this.pendingGrantWaiters.get(pending.requestId)?.reject(
                new AgentControlError('CONTROL_GRANT_EXPIRED', 'The control grant request expired before approval.')
            )
        }
        if (notify) this.changed()
    }

    private async runAgentInput<T>(targetId: string, operation: () => Promise<T>): Promise<T> {
        this.agentInputDepth.set(targetId, (this.agentInputDepth.get(targetId) || 0) + 1)
        try {
            return await operation()
        } finally {
            const depth = Math.max(0, (this.agentInputDepth.get(targetId) || 0) - 1)
            if (depth) this.agentInputDepth.set(targetId, depth)
            else this.agentInputDepth.delete(targetId)
        }
    }

    private requirePausedPlan(planIdValue: unknown, principal: ControlPrincipal) {
        const planId = assertControlIdentifier(planIdValue, 'planId')
        const plan = this.pausedPlans.get(planId)
        if (!plan) throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The paused Browser stage is no longer available.')
        if (!sameControlPrincipal(plan.principal, principal)) {
            throw new AgentControlError('CONTROL_PRINCIPAL_MISMATCH', 'The paused Browser stage belongs to another principal.')
        }
        return plan
    }

    private updateCursor(
        targetId: string,
        principal: ControlPrincipal,
        actionType: ControlAction['type'],
        patch: Partial<Omit<ControlCursorState, 'targetId' | 'updatedAt'>>
    ): void {
        const current = this.cursors.get(targetId)
        const x = Number(patch.x ?? current?.x ?? 0)
        const y = Number(patch.y ?? current?.y ?? 0)
        const cursor: ControlCursorState = {
            targetId,
            x: Number.isFinite(x) ? Math.max(0, Math.min(100_000, x)) : 0,
            y: Number.isFinite(y) ? Math.max(0, Math.min(100_000, y)) : 0,
            visible: patch.visible ?? current?.visible ?? true,
            phase: patch.phase ?? current?.phase ?? 'idle',
            actionType,
            principal,
            durationMs: patch.durationMs ?? current?.durationMs,
            coordinateSpace: patch.coordinateSpace ?? current?.coordinateSpace,
            updatedAt: new Date().toISOString()
        }
        this.cursors.set(targetId, cursor)
        this.publishCursor(targetId, cursor.phase === 'idle' || cursor.phase === 'pressing' || cursor.phase === 'typing')
    }

    private publishCursor(targetId: string, immediate: boolean): void {
        const publish = () => {
            const cursor = this.cursors.get(targetId)
            if (!cursor) return
            this.cursorPublishedAt.set(targetId, Date.now())
            this.emit('cursor', cursor)
        }
        const currentTimer = this.cursorPublishTimers.get(targetId)
        if (immediate) {
            if (currentTimer) clearTimeout(currentTimer)
            this.cursorPublishTimers.delete(targetId)
            publish()
            return
        }
        if (currentTimer) return
        const elapsed = Date.now() - (this.cursorPublishedAt.get(targetId) || 0)
        const waitMs = Math.max(0, 33 - elapsed)
        const timer = setTimeout(() => {
            this.cursorPublishTimers.delete(targetId)
            publish()
        }, waitMs)
        timer.unref?.()
        this.cursorPublishTimers.set(targetId, timer)
    }

    private changed(): void {
        this.sequence += 1
        this.emit('changed', this.state())
    }

    private assertAlive(): void {
        if (this.disposed) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The control broker is disposed.')
    }
}

function boundObservation(observation: ControlObservation): ControlObservation {
    if (Buffer.byteLength(JSON.stringify(observation), 'utf8') <= CONTROL_BOUNDS.maxObservationBytes) return observation
    const totalElements = observation.truncation?.totalElements || observation.elements.length
    const elements = observation.elements.slice()
    while (elements.length > 0 && Buffer.byteLength(JSON.stringify({ ...observation, elements }), 'utf8') > CONTROL_BOUNDS.maxObservationBytes) {
        elements.splice(Math.max(0, elements.length - 50), 50)
    }
    return {
        ...observation,
        elements,
        truncation: { totalElements, returnedElements: elements.length },
        redactions: [...new Set([...observation.redactions, 'observation-size-limit'])]
    }
}

function assertSafeObservedElementAction(observation: ControlObservation, action: ControlAction): void {
    if (!('elementRef' in action) || !action.elementRef) return
    const element = observation.elements.find((entry) => entry.elementRef === action.elementRef)
    if (!element) throw new AgentControlError('CONTROL_STALE_OBSERVATION', 'The element reference is absent from the current bounded observation.', { retryable: true, freshRevision: observation.revision })
    if (action.type === 'type' && element.sensitive) {
        throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Model control cannot type into a password or sensitive field. Pause control and enter it manually.')
    }
    const semantics = `${element.role} ${element.name || ''} ${element.text || ''}`
    if ((action.type === 'click' || action.type === 'type' || action.type === 'select')
        && /buy|purchase|pay|send|publish|post|delete|remove account|install|accept terms|agree|upload/i.test(semantics)) {
        throw new AgentControlError('CONTROL_SIDE_EFFECT_APPROVAL_REQUIRED', 'This observed control may cause an external side effect and requires explicit per-action approval.')
    }
}

function assertVisualActionInsideObservation(observation: ControlObservation, action: ControlAction): void {
    const viewport = observation.viewport
    if (!viewport) return
    const points = action.type === 'move'
        ? [{ x: action.x, y: action.y }]
        : action.type === 'drag'
            ? [{ x: action.fromX, y: action.fromY }, { x: action.toX, y: action.toY }]
            : action.type === 'stroke'
                ? action.points
                : (action.type === 'click' || action.type === 'type') && action.x !== undefined && action.y !== undefined
                ? [{ x: action.x, y: action.y }]
                : action.type === 'scroll' && action.x !== undefined && action.y !== undefined
                    ? [{ x: action.x, y: action.y }]
                    : []
    if (points.some((point) => point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height)) {
        throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Pointer coordinates are outside the latest observed viewport.')
    }
}

function viewportGeometryKey(rect: ControlWorkspaceSnapshot['browser']['tabs'][number]['viewportRect']): string {
    return rect ? `${rect.x}:${rect.y}:${rect.width}:${rect.height}` : 'none'
}

function assertActionInsideStageRegion(region: ControlPlanRequest['stage']['expectedRegion'], action: ControlAction): void {
    if (!region) return
    const points = action.type === 'move'
        ? [{ x: action.x, y: action.y }]
        : action.type === 'drag'
            ? [{ x: action.fromX, y: action.fromY }, { x: action.toX, y: action.toY }]
            : action.type === 'stroke'
                ? action.points
                : (action.type === 'click' || action.type === 'type') && action.x !== undefined && action.y !== undefined
                    ? [{ x: action.x, y: action.y }]
                    : action.type === 'scroll' && action.x !== undefined && action.y !== undefined
                        ? [{ x: action.x, y: action.y }]
                        : []
    if (points.some((point) => (
        point.x < region.x || point.y < region.y
        || point.x > region.x + region.width || point.y > region.y + region.height
    ))) {
        throw new AgentControlError('CONTROL_SCOPE_DENIED', 'A pointer step is outside the stage intent region.')
    }
}

function compactCompletedSequenceObservation(initial: ControlObservation, final: ControlObservation): ControlObservation {
    const semanticIdentity = (element: ControlObservation['elements'][number]): string => {
        const bounds = element.bounds
        return bounds
            ? `${element.role}\u0000${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
            : `${element.role}\u0000${element.name || ''}`
    }
    const initialElements = new Map(initial.elements.map((element) => [semanticIdentity(element), element]))
    const selected = final.elements.filter((element) => {
        const before = initialElements.get(semanticIdentity(element))
        const actions = new Set(element.actions || [])
        const readableOutput = !actions.has('click')
            && !actions.has('type')
            && !actions.has('select')
            && Boolean(element.name || element.text || element.value || element.description)
        const focused = element.elementRef === final.focusedElementRef
        if (!before) return true
        const changed = element.role !== before.role
            || element.name !== before.name
            || element.text !== before.text
            || element.value !== before.value
            || element.description !== before.description
            || JSON.stringify(element.states || []) !== JSON.stringify(before.states || [])
            || JSON.stringify(element.actions || []) !== JSON.stringify(before.actions || [])
        return changed || readableOutput || focused
    }).slice(0, 64)
    return {
        ...final,
        elements: selected,
        truncation: selected.length < (final.truncation?.totalElements ?? final.elements.length)
            ? { totalElements: final.truncation?.totalElements ?? final.elements.length, returnedElements: selected.length }
            : undefined
    }
}

function resolveSemanticSequenceAction(
    step: ControlSemanticActionStep,
    observation: ControlObservation,
    index: number
): ControlAction {
    if (step.type === 'wait') {
        return {
            type: 'wait',
            condition: { type: 'delay', durationMs: step.durationMs },
            timeoutMs: step.durationMs
        }
    }
    if (step.type === 'key') {
        return { type: 'key', key: step.key, modifiers: step.modifiers, sideEffect: step.sideEffect }
    }
    if (semanticActionMayHaveCriticalSideEffect(step.name)) {
        throw new AgentControlError(
            'CONTROL_SIDE_EFFECT_APPROVAL_REQUIRED',
            `${JSON.stringify(step.name)} must use an individual action with its canonical side-effect review.`,
            { freshRevision: observation.revision }
        )
    }
    const requiredAction = step.type === 'click' ? 'click' : 'type'
    const role = step.role?.trim().toLocaleLowerCase('en-US')
    const name = step.name.trim().toLocaleLowerCase('en-US')
    const matches = observation.elements.filter((element) => (
        !element.sensitive
        && (element.actions || []).includes(requiredAction)
        && (!role || element.role.trim().toLocaleLowerCase('en-US') === role)
        && String(element.name || '').trim().toLocaleLowerCase('en-US') === name
    ))
    if (matches.length !== 1) {
        const targetDescription = role
            ? `${JSON.stringify(step.role)} named ${JSON.stringify(step.name)}`
            : `actionable control named ${JSON.stringify(step.name)}`
        throw new AgentControlError(
            'CONTROL_TARGET_BLOCKED',
            `Expected one exact ${targetDescription} for step ${index + 1}, found ${matches.length}.`,
            { freshRevision: observation.revision }
        )
    }
    return step.type === 'click'
        ? { type: 'click', elementRef: matches[0].elementRef, sideEffect: step.sideEffect }
        : { type: 'type', elementRef: matches[0].elementRef, text: step.text, replace: step.replace, sideEffect: step.sideEffect }
}

function semanticActionMayHaveCriticalSideEffect(nameValue: string): boolean {
    return /\b(?:accept terms|agree|buy|checkout|create account|delete|erase|install|log[ -]?in|pay|place order|post|publish|purchase|remove account|send|sign[ -]?in|submit|uninstall|upload)\b/i.test(nameValue)
}

function sameControlPrincipal(left: ControlPrincipal, right: ControlPrincipal): boolean {
    if (left.type !== right.type) return false
    return left.type === 'root' && right.type === 'root'
        ? left.threadId === right.threadId && left.turnId === right.turnId
        : left.type === 'agent' && right.type === 'agent'
            && left.fleetId === right.fleetId
            && left.agentRunId === right.agentRunId
            && left.parentThreadId === right.parentThreadId
}

function boundedControlSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timer = setTimeout(abort, timeoutMs)
    timer.unref?.()
    if (parent?.aborted) abort()
    else parent?.addEventListener('abort', abort, { once: true })
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer)
            parent?.removeEventListener('abort', abort)
        }
    }
}

function narrowScope(requested: string[] | undefined, pending: string[] | undefined): string[] | undefined {
    if (!pending?.length) return requested?.length ? requested.slice(0, 32) : undefined
    if (!requested?.length) return pending
    if (!requested.every((entry) => pending.includes(entry))) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'User approval cannot widen the requested scope.')
    return [...new Set(requested)]
}

export function defaultGrantScopes(target: ControlTarget): { allowedOrigins?: string[]; allowedExecutableIdentities?: string[] } {
    if (target.kind === 'windows-window') return { allowedExecutableIdentities: [target.executableIdentity] }
    const origin = target.origin || undefined
    return { allowedOrigins: origin ? [normalizedOrigin(origin) || origin] : undefined }
}
