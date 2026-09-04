import { randomUUID } from 'crypto'
import type {
    ControlCapability,
    ControlGrant,
    ControlPendingGrant,
    ControlPrincipal,
    DelegatedControlLeaseRequest
} from '../../shared/agent-control/contracts'
import { CONTROL_BOUNDS } from '../../shared/agent-control/policy'
import { AgentControlError } from './control-errors'

export type IssueGrantInput = {
    principal: ControlPrincipal
    targetId: string
    capabilities: ControlCapability[]
    expiresAt: string
    maxActions: number
    allowedOrigins?: string[]
    allowedExecutableIdentities?: string[]
    issuedBy: ControlGrant['issuedBy']
    parentGrantId?: string
}

function principalKey(principal: ControlPrincipal): string {
    return principal.type === 'root'
        ? `root:${principal.threadId}:${principal.turnId}`
        : `agent:${principal.fleetId}:${principal.agentRunId}:${principal.parentThreadId}`
}

function subset<T>(requested: T[] | undefined, allowed: T[] | undefined): boolean {
    if (!requested?.length) return true
    if (!allowed?.length) return false
    const allowedSet = new Set(allowed)
    return requested.every((entry) => allowedSet.has(entry))
}

export class GrantStore {
    private readonly grants = new Map<string, ControlGrant>()
    private readonly pending = new Map<string, ControlPendingGrant>()
    private readonly pendingExpiredGrantIds = new Set<string>()

    addPending(input: Omit<ControlPendingGrant, 'requestId' | 'requestedAt'>): ControlPendingGrant {
        const request: ControlPendingGrant = {
            ...input,
            requestId: `control-request:${randomUUID()}`,
            requestedAt: new Date().toISOString()
        }
        this.pending.set(request.requestId, request)
        return request
    }

    getPending(requestId: string): ControlPendingGrant | undefined {
        return this.pending.get(requestId)
    }

    removePending(requestId: string): ControlPendingGrant | undefined {
        const request = this.pending.get(requestId)
        this.pending.delete(requestId)
        return request
    }

    listPending(): ControlPendingGrant[] {
        return [...this.pending.values()]
    }

    removePendingByPrincipal(principal: ControlPrincipal): ControlPendingGrant[] {
        const key = principalKey(principal)
        const removed: ControlPendingGrant[] = []
        for (const [requestId, request] of this.pending) {
            if (principalKey(request.principal) !== key) continue
            this.pending.delete(requestId)
            removed.push(request)
        }
        return removed
    }

    expirePending(): ControlPendingGrant[] {
        const expired: ControlPendingGrant[] = []
        for (const [requestId, request] of this.pending) {
            if (Date.parse(request.expiresAt) > Date.now()) continue
            this.pending.delete(requestId)
            expired.push(request)
        }
        return expired
    }

    issue(input: IssueGrantInput): ControlGrant {
        const maxActions = Math.max(1, Math.min(CONTROL_BOUNDS.maxGrantActions, Math.floor(input.maxActions)))
        const grant: ControlGrant = {
            version: 1,
            grantId: `control-grant:${randomUUID()}`,
            principal: input.principal,
            targetId: input.targetId,
            capabilities: [...new Set(input.capabilities)],
            allowedOrigins: input.allowedOrigins?.length ? [...new Set(input.allowedOrigins)] : undefined,
            allowedExecutableIdentities: input.allowedExecutableIdentities?.length ? [...new Set(input.allowedExecutableIdentities)] : undefined,
            issuedAt: new Date().toISOString(),
            expiresAt: input.expiresAt,
            maxActions,
            actionCount: 0,
            state: 'active',
            issuedBy: input.issuedBy,
            parentGrantId: input.parentGrantId
        }
        this.grants.set(grant.grantId, grant)
        return grant
    }

    delegate(request: DelegatedControlLeaseRequest): ControlGrant {
        const parent = this.requireActive(request.parentGrantId, request.parentPrincipal)
        if (request.childPrincipal.type !== 'agent') throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'A delegated lease requires an agent principal.')
        if (parent.principal.type !== 'root') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Control leases cannot be delegated more than one level.')
        if (request.targetId !== parent.targetId) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'A delegated lease cannot change targets.')
        if (!subset(request.capabilities, parent.capabilities)) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Delegated capabilities must be a strict subset of the parent grant.')
        if (!subset(request.allowedOrigins, parent.allowedOrigins)) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Delegated origin scope is wider than the parent grant.')
        if (!subset(request.allowedExecutableIdentities, parent.allowedExecutableIdentities)) throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Delegated application scope is wider than the parent grant.')
        if (Date.parse(request.expiresAt) > Date.parse(parent.expiresAt)) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Delegated expiry is later than the parent grant.')
        const remainingActions = parent.maxActions - parent.actionCount - this.reservedActions(parent.grantId)
        if (request.maxActions < 1 || request.maxActions > remainingActions) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Delegated action count exceeds the parent grant\'s unreserved actions.')
        const sameCapabilities = request.capabilities.length === parent.capabilities.length
        const sameExpiry = Date.parse(request.expiresAt) === Date.parse(parent.expiresAt)
        const sameActions = request.maxActions === remainingActions
        const sameOrigins = JSON.stringify(request.allowedOrigins || []) === JSON.stringify(parent.allowedOrigins || [])
        const sameApps = JSON.stringify(request.allowedExecutableIdentities || []) === JSON.stringify(parent.allowedExecutableIdentities || [])
        if (sameCapabilities && sameExpiry && sameActions && sameOrigins && sameApps) {
            throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Delegated leases must attenuate at least one parent limit.')
        }
        return this.issue({
            principal: request.childPrincipal,
            targetId: request.targetId,
            capabilities: request.capabilities,
            expiresAt: request.expiresAt,
            maxActions: request.maxActions,
            allowedOrigins: request.allowedOrigins,
            allowedExecutableIdentities: request.allowedExecutableIdentities,
            issuedBy: 'delegated-parent',
            parentGrantId: parent.grantId
        })
    }

    requireActive(grantId: string, principal?: ControlPrincipal): ControlGrant {
        const grant = this.grants.get(grantId)
        if (!grant) throw new AgentControlError('CONTROL_GRANT_NOT_FOUND', 'The control grant does not exist.')
        if (principal && principalKey(grant.principal) !== principalKey(principal)) {
            throw new AgentControlError('CONTROL_PRINCIPAL_MISMATCH', 'The control grant belongs to another principal.')
        }
        if (grant.parentGrantId) {
            const parent = this.grants.get(grant.parentGrantId)
            if (!parent) {
                grant.state = 'revoked'
                throw new AgentControlError('CONTROL_GRANT_INACTIVE', 'The delegated lease lost its parent grant.')
            }
            this.assertLifecycleActive(parent)
        }
        this.assertLifecycleActive(grant)
        const reservedActions = grant.parentGrantId ? 0 : this.reservedActions(grant.grantId)
        if (grant.actionCount + reservedActions >= grant.maxActions) {
            if (reservedActions > 0) throw new AgentControlError('CONTROL_GRANT_INACTIVE', 'The control grant has no unreserved actions while child leases are active.')
            grant.state = 'consumed'
            this.revokeDescendants(grant.grantId, 'revoked')
            throw new AgentControlError('CONTROL_GRANT_INACTIVE', 'The control grant has no remaining actions.')
        }
        return grant
    }

    requireRemaining(grantId: string, principal: ControlPrincipal, count: number): ControlGrant {
        const grant = this.requireActive(grantId, principal)
        if (!Number.isSafeInteger(count) || count < 1) throw new AgentControlError('CONTROL_VALIDATION_ERROR', 'Reserved action count is invalid.')
        const delegatedReservation = grant.parentGrantId ? 0 : this.reservedActions(grant.grantId)
        const remaining = grant.maxActions - grant.actionCount - delegatedReservation
        if (count > remaining) {
            throw new AgentControlError('CONTROL_GRANT_INACTIVE', `The control grant has ${Math.max(0, remaining)} actions remaining; this stage requires ${count}.`)
        }
        return grant
    }

    consume(grantId: string): ControlGrant {
        const grant = this.requireActive(grantId)
        grant.actionCount += 1
        if (grant.parentGrantId) this.consumeAncestor(grant.parentGrantId)
        if (grant.actionCount >= grant.maxActions) grant.state = 'consumed'
        return grant
    }

    revoke(grantId: string): ControlGrant | undefined {
        const grant = this.grants.get(grantId)
        if (!grant) return undefined
        if (grant.state === 'active') grant.state = 'revoked'
        this.revokeDescendants(grantId, 'revoked')
        return grant
    }

    revokeByTarget(targetId: string): ControlGrant[] {
        return this.list().filter((grant) => grant.targetId === targetId && grant.state === 'active').map((grant) => this.revoke(grant.grantId)!)
    }

    listForPrincipal(principal: ControlPrincipal): ControlGrant[] {
        const key = principalKey(principal)
        return this.list().filter((grant) => principalKey(grant.principal) === key)
    }

    revokeByPrincipal(principal: ControlPrincipal): ControlGrant[] {
        return this.listForPrincipal(principal).filter((grant) => grant.state === 'active').map((grant) => this.revoke(grant.grantId)!)
    }

    revokeAll(): ControlGrant[] {
        return this.list().filter((grant) => grant.state === 'active').map((grant) => this.revoke(grant.grantId)!)
    }

    expire(): ControlGrant[] {
        for (const grant of this.grants.values()) {
            if (grant.state === 'active' && Date.parse(grant.expiresAt) <= Date.now()) this.markExpired(grant)
        }
        const expired = [...this.pendingExpiredGrantIds]
            .map((grantId) => this.grants.get(grantId))
            .filter((grant): grant is ControlGrant => grant?.state === 'expired')
        this.pendingExpiredGrantIds.clear()
        return expired
    }

    list(): ControlGrant[] {
        return [...this.grants.values()]
    }

    private assertLifecycleActive(grant: ControlGrant): void {
        if (grant.state !== 'active') throw new AgentControlError('CONTROL_GRANT_INACTIVE', `The control grant is ${grant.state}.`)
        if (Date.parse(grant.expiresAt) <= Date.now()) {
            this.markExpired(grant)
            throw new AgentControlError('CONTROL_GRANT_EXPIRED', 'The control grant expired.')
        }
    }

    private reservedActions(parentGrantId: string): number {
        return [...this.grants.values()]
            .filter((grant) => grant.parentGrantId === parentGrantId && grant.state === 'active')
            .reduce((total, grant) => total + Math.max(0, grant.maxActions - grant.actionCount), 0)
    }

    private consumeAncestor(grantId: string): void {
        const grant = this.grants.get(grantId)
        if (!grant || grant.state !== 'active') return
        grant.actionCount += 1
        if (grant.parentGrantId) this.consumeAncestor(grant.parentGrantId)
        if (grant.actionCount >= grant.maxActions) {
            grant.state = 'consumed'
            this.revokeDescendants(grant.grantId, 'revoked')
        }
    }

    private markExpired(grant: ControlGrant): void {
        if (grant.state !== 'active') return
        grant.state = 'expired'
        this.pendingExpiredGrantIds.add(grant.grantId)
        this.revokeDescendants(grant.grantId, 'expired')
    }

    private revokeDescendants(parentGrantId: string, state: 'expired' | 'revoked'): void {
        for (const grant of this.grants.values()) {
            if (grant.parentGrantId !== parentGrantId || grant.state !== 'active') continue
            if (state === 'expired') this.markExpired(grant)
            else {
                grant.state = state
                this.revokeDescendants(grant.grantId, state)
            }
        }
    }
}
