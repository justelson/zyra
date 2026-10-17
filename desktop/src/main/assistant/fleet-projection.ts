import type { FleetSnapshot } from '../../shared/assistant/contracts'

import { shouldApplyAssistantFleetSnapshot } from '../../shared/assistant/fleet-projection'
export { shouldApplyAssistantFleetSnapshot } from '../../shared/assistant/fleet-projection'

export class FleetProjection {
    private readonly byThreadId = new Map<string, FleetSnapshot>()

    apply(threadId: string, snapshot: FleetSnapshot): FleetSnapshot {
        const current = this.byThreadId.get(threadId) || null
        if (!shouldApplyAssistantFleetSnapshot(current, snapshot)) return current!
        const bounded = JSON.parse(JSON.stringify(snapshot)) as FleetSnapshot
        this.byThreadId.set(threadId, bounded)
        return bounded
    }

    get(threadId: string): FleetSnapshot | null {
        return this.byThreadId.get(threadId) ?? null
    }

    remove(threadId: string): void {
        this.byThreadId.delete(threadId)
    }

    clear(): void {
        this.byThreadId.clear()
    }
}
