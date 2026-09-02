import type { ControlAction, ControlCapability, ControlGrant, ControlSideEffectClass, ControlTarget } from '../../shared/agent-control/contracts'
import {
    CONTROL_ACTION_CAPABILITY,
    CONTROL_SIDE_EFFECTS_REQUIRING_APPROVAL,
    TARGET_CAPABILITIES,
    normalizedOrigin
} from '../../shared/agent-control/policy'
import { AgentControlError } from './control-errors'

export function assertCapabilitiesSupportedByTarget(capabilities: ControlCapability[], target: ControlTarget): void {
    const supported = TARGET_CAPABILITIES[target.kind]
    for (const capability of capabilities) {
        if (!supported.has(capability)) throw new AgentControlError('CONTROL_CAPABILITY_DENIED', `${capability} is unavailable for ${target.kind}.`)
    }
}

export function assertGrantSupportsTarget(grant: ControlGrant, target: ControlTarget): void {
    assertCapabilitiesSupportedByTarget(grant.capabilities, target)
    assertTargetScope(grant, target)
}

export function controlActionRequiresApproval(action: ControlAction): action is ControlAction & { sideEffect: Exclude<ControlSideEffectClass, 'none'> } {
    if (!('sideEffect' in action)) return false
    const sideEffect = action.sideEffect
    return sideEffect !== undefined
        && sideEffect !== 'none'
        && CONTROL_SIDE_EFFECTS_REQUIRING_APPROVAL.has(sideEffect)
}

export function assertActionAllowed(
    grant: ControlGrant,
    target: ControlTarget,
    action: ControlAction,
    options: { approvedSideEffect?: ControlSideEffectClass } = {}
): void {
    const capability = CONTROL_ACTION_CAPABILITY[action.type]
    if (capability && !grant.capabilities.includes(capability)) {
        throw new AgentControlError('CONTROL_CAPABILITY_DENIED', `The grant does not allow ${capability}.`)
    }
    if (action.type === 'type' && action.x !== undefined && !grant.capabilities.includes('pointer.click')) {
        throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Coordinate typing also requires pointer.click.')
    }
    if (controlActionRequiresApproval(action) && options.approvedSideEffect !== action.sideEffect) {
        throw new AgentControlError(
            'CONTROL_SIDE_EFFECT_APPROVAL_REQUIRED',
            `The ${action.sideEffect} action requires approval in chat.`
        )
    }
    if ('text' in action && /(password|secret|token|credential)\s*[:=]/i.test(action.text)) {
        throw new AgentControlError('CONTROL_CAPABILITY_DENIED', 'Secrets cannot be supplied through a model control action.')
    }
    if (action.type === 'navigate') {
        const origin = normalizedOrigin(action.url)
        if (!origin || (grant.allowedOrigins?.length && !grant.allowedOrigins.includes(origin))) {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'Navigation is outside the grant origin scope.')
        }
    }
    assertTargetScope(grant, target)
}

export function assertTargetScope(grant: ControlGrant, target: ControlTarget): void {
    if (target.kind === 'windows-window') {
        if (grant.allowedExecutableIdentities?.length && !grant.allowedExecutableIdentities.includes(target.executableIdentity)) {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The selected application identity is outside the grant scope.')
        }
        return
    }
    if (target.origin && grant.allowedOrigins?.length && !grant.allowedOrigins.includes(target.origin)) {
        throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The target origin changed outside the grant scope.')
    }
}
