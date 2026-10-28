import { randomUUID } from 'node:crypto'
import type { AgentUpdateConfirmation, AgentUpdatePlan } from '../../shared/agent-update'
import type { RuntimeActivity } from '../../shared/runtime-activation'

export type InstallRuntimeObservation = {
    instance: { instanceId: string; namespaceId: string }
    activity: RuntimeActivity
    methods: string[]
    retired?: boolean
}
const keys = ['activeTurns', 'backgroundChats', 'attention', 'requests', 'workspaceRequests', 'externalTools'] as const
export function createInstallPreflight(deps: {
    version: () => string | null
    inspect: () => Promise<InstallRuntimeObservation>
    prepare: (input: { expectedInstanceId: string; expectedNamespaceId: string; targetVersion: string; stopBlockers: boolean; operationId: string; repair?: boolean }) => Promise<void>
    release: () => Promise<void>
    install: () => void | Promise<void>
    now?: () => number
}) {
    const now = deps.now || Date.now
    let plan: AgentUpdatePlan | null = null
    let inFlight = false
    let generation = 0
    return {
        async inspect(): Promise<AgentUpdatePlan> {
            if (inFlight) throw new Error('Update preparation is already running.')
            const version = deps.version()
            if (!version) throw new Error('Download the update first.')
            if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('The update version is invalid.')
            const current = ++generation
            const next: AgentUpdatePlan = { id: randomUUID(), version, agentServerUpdate: true, state: 'unknown', expiresAt: new Date(now() + 60_000).toISOString() }
            try {
                const observation = await deps.inspect()
                if (!observation.instance?.instanceId || !observation.instance.namespaceId || keys.some(key => !Number.isSafeInteger(observation.activity?.[key]) || observation.activity[key] < 0)) throw new Error('Unknown agent state')
                Object.assign(next, observation.instance, { activity: observation.activity, repair: observation.retired === true })
                if (!observation.methods.includes('server.prepareUpdate')) next.message = 'This agent needs the supported update handoff.'
                else next.state = keys.some(key => observation.activity[key] > 0) ? 'blocked' : 'ready'
            } catch { next.message = 'Agent status could not be confirmed.' }
            if (current !== generation || version !== deps.version()) throw new Error('The update changed. Review it again.')
            plan = next
            return structuredClone(next)
        },
        async defer(): Promise<void> {
            if (inFlight) throw new Error('Preparation is already running.')
            generation++; plan = null
            // Inspection alone never starts maintenance or cancels work.
        },
        async confirm(input: AgentUpdateConfirmation): Promise<void> {
            if (inFlight) throw new Error('Update preparation is already running.')
            const selected = plan
            if (!selected || selected.id !== input?.planId || selected.version !== deps.version() || Date.parse(selected.expiresAt) <= now()) throw new Error('The update check expired. Review it again.')
            if (selected.state === 'unknown' || !selected.instanceId || !selected.namespaceId) throw new Error('Confirm the agent status before installing.')
            if (selected.state === 'blocked' && input.stopBlockers !== true) throw new Error('Stop the blocking work or choose Later.')
            plan = null; inFlight = true
            try {
                await deps.prepare({ expectedInstanceId: selected.instanceId, expectedNamespaceId: selected.namespaceId, targetVersion: selected.version, operationId: selected.id, repair: selected.repair === true, stopBlockers: input.stopBlockers === true })
                if (selected.version !== deps.version()) throw new Error('The downloaded update changed. Review it again.')
                await deps.install()
            } catch (error) {
                await deps.release()
                throw error
            } finally { inFlight = false }
        }
    }
}
