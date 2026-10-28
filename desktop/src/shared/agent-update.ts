import type { RuntimeActivity } from './runtime-activation'

/** Set before installer handoff. Desktop bundles always include the agent. */
export type AgentUpdatePlan = {
    id: string
    version: string
    agentServerUpdate: true
    state: 'ready' | 'blocked' | 'unknown'
    instanceId?: string
    namespaceId?: string
    activity?: RuntimeActivity
    message?: string
    repair?: boolean
    expiresAt: string
}
export type RuntimeInstallInput = { expectedInstanceId: string; expectedNamespaceId: string; targetVersion: string; stopBlockers: boolean; operationId?: string; repair?: boolean }
export type AgentUpdateConfirmation = { planId: string; stopBlockers: boolean }
export const UPDATE_PREFLIGHT_CHANNEL = 'devscope:updates:preflight'
export const UPDATE_DEFER_CHANNEL = 'devscope:updates:defer'
