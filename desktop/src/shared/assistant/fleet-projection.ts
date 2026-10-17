import type { FleetSnapshot } from './contracts'

type FleetRoot = Pick<FleetSnapshot, 'rootSessionId' | 'rootThreadId'>

/** Rewrite known local aliases without replacing canonical runtime identities. */
export function remapAssistantFleetRoot(snapshot: FleetSnapshot, from: Partial<FleetRoot>, to: FleetRoot): FleetSnapshot {
    return { ...snapshot,
        rootSessionId: snapshot.rootSessionId === from.rootSessionId ? to.rootSessionId : snapshot.rootSessionId,
        rootThreadId: snapshot.rootThreadId === from.rootThreadId ? to.rootThreadId : snapshot.rootThreadId }
}

function fleetRecordCount(snapshot: FleetSnapshot): number {
    return Object.keys(snapshot.agents).length + Object.keys(snapshot.workflows).length
}

export function shouldApplyAssistantFleetSnapshot(current: FleetSnapshot | null | undefined, incoming: FleetSnapshot): boolean {
    if (!current) return true
    if (current.rootThreadId !== incoming.rootThreadId || current.fleetId !== incoming.fleetId) {
        return incoming.updatedAt.localeCompare(current.updatedAt) >= 0
    }
    if (incoming.lastAppliedSequence !== current.lastAppliedSequence) {
        return incoming.lastAppliedSequence > current.lastAppliedSequence
    }
    return fleetRecordCount(incoming) >= fleetRecordCount(current)
}
