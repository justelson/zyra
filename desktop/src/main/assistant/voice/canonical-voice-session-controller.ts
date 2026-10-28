import type {
    ForegroundRoute,
    ForegroundRouteClaim,
    RealtimeConnectInput,
    RealtimeContinuitySource,
    RealtimeDomainEvent,
    RealtimeForegroundAdapter,
    RealtimeSessionHandle
} from '../../../shared/assistant/contracts'
import { evaluateRealtimeAudioCapabilities, foregroundRouteClaim } from '../../../shared/assistant/contracts'
import type { ForegroundClock } from '../foreground/foreground-route-controller'
import {
    ForegroundRouteController,
    routeExpectation,
    systemForegroundClock
} from '../foreground/foreground-route-controller'
import { equalRealtimeWatermarks } from '../../../shared/assistant/contracts'

const MAX_STARTUP_DELTAS = 16

export interface StartCanonicalVoiceInput {
    conversationId: string
    projectCwd: string
    offerSdp: string
    instructions: string
    voice: string
    output: 'audio' | 'text'
    contextVersion: number
    attachedTaskIds: string[]
    signal?: AbortSignal
}

export interface CanonicalVoiceActivation {
    route: ForegroundRoute
    handle: RealtimeSessionHandle
}

export class CanonicalVoiceSessionController {
    private readonly listeners = new Set<(event: RealtimeDomainEvent) => void>()
    private readonly activeHandles = new Map<string, RealtimeSessionHandle>()
    private readonly unsubscribeAdapter: () => void

    constructor(
        private readonly routes: ForegroundRouteController,
        private readonly continuity: RealtimeContinuitySource,
        private readonly adapter: RealtimeForegroundAdapter,
        private readonly clock: ForegroundClock = systemForegroundClock
    ) {
        this.unsubscribeAdapter = adapter.subscribe((event) => {
            if (!this.isCurrentEvent(event)) return
            for (const listener of this.listeners) listener(event)
            if (event.type === 'realtime.session.error' || event.type === 'realtime.session.closed') {
                this.failCurrentVoiceRoute(event)
            }
        })
    }

    async startVoice(input: StartCanonicalVoiceInput): Promise<CanonicalVoiceActivation> {
        const current = this.routes.activeRoute(input.conversationId)
        const currentClaim = foregroundRouteClaim(current)
        const expected = routeExpectation(currentClaim)
        const previousHandle = this.activeHandles.get(input.conversationId) || null
        let candidate: RealtimeSessionHandle | null = null
        try {
            const report = await this.adapter.capabilities()
            const gate = evaluateRealtimeAudioCapabilities(report, new Date(this.clock.now()))
            if (!gate.ok) throw new Error(gate.reason || 'Realtime Voice is unavailable.')

            const hydrationSeed = await this.continuity.materialize(input.conversationId, currentClaim)
            if (hydrationSeed.activeRouteClaim.foregroundRouteId !== current.foreground_route_id
                || hydrationSeed.activeRouteClaim.routeEpoch !== current.route_epoch
                || hydrationSeed.activeRouteClaim.ownerClaimId !== current.owner_claim_id) {
                throw new Error('Continuity materialized a stale foreground route claim.')
            }
            const signal = input.signal || new AbortController().signal
            const connectInput: RealtimeConnectInput = {
                conversationId: input.conversationId,
                projectCwd: input.projectCwd,
                offerSdp: input.offerSdp,
                instructions: input.instructions,
                voice: input.voice,
                output: input.output,
                requestedSessionGeneration: this.routes.nextRealtimeSessionGeneration(input.conversationId),
                hydrationSeed,
                signal
            }
            candidate = await this.adapter.connect(connectInput)
            assertCandidateHandle(candidate, connectInput)

            let hydratedThrough = structuredClone(candidate.hydratedThrough)
            let hydrationComplete = false
            for (let index = 0; index < MAX_STARTUP_DELTAS; index += 1) {
                const delta = await this.continuity.deltaAfter(hydrationSeed, hydratedThrough)
                if (!delta) {
                    hydrationComplete = true
                    break
                }
                const receipt = await this.adapter.appendContext(candidate.adapterSessionId, delta)
                if (receipt.sessionId !== candidate.adapterSessionId
                    || receipt.deltaId !== delta.deltaId
                    || !equalRealtimeWatermarks(receipt.appliedThrough, delta.toWatermarks)) {
                    throw new Error('Realtime adapter returned a mismatched hydration receipt.')
                }
                hydratedThrough = structuredClone(receipt.appliedThrough)
            }
            if (!hydrationComplete) throw new Error('Realtime startup context did not reach a stable hydration barrier.')

            const route = this.routes.activatePreparedVoice({
                conversationId: input.conversationId,
                expected,
                contextVersion: Math.max(input.contextVersion, hydratedThrough.context),
                attachedTaskIds: input.attachedTaskIds,
                prepared: {
                    realtimeProviderThreadId: candidate.realtimeProviderThreadId,
                    realtimeSessionId: candidate.realtimeSessionId,
                    realtimeSessionGeneration: candidate.realtimeSessionGeneration
                }
            })
            this.activeHandles.set(input.conversationId, candidate)
            if (previousHandle && previousHandle.adapterSessionId !== candidate.adapterSessionId) {
                await this.adapter.close(previousHandle.adapterSessionId, 'replaced').catch(() => undefined)
            }
            return { route, handle: candidate }
        } catch (error) {
            if (candidate) await this.adapter.close(candidate.adapterSessionId, 'voice_preparation_failed').catch(() => undefined)
            const rekeyedToChat = this.rekeyFailedPreparationIfStillCurrent(
                input.conversationId,
                currentClaim,
                input.contextVersion,
                input.attachedTaskIds
            )
            if (rekeyedToChat && previousHandle) {
                await this.adapter.close(previousHandle.adapterSessionId, 'voice_replacement_failed').catch(() => undefined)
            }
            throw error
        }
    }

    async stopVoice(input: {
        conversationId: string
        contextVersion: number
        attachedTaskIds: string[]
    }): Promise<ForegroundRoute> {
        const current = this.routes.activeRoute(input.conversationId)
        const currentClaim = foregroundRouteClaim(current)
        const handle = this.activeHandles.get(input.conversationId) || null
        const route = this.routes.exitVoice({
            conversationId: input.conversationId,
            expected: routeExpectation(currentClaim),
            contextVersion: input.contextVersion,
            attachedTaskIds: input.attachedTaskIds
        })
        this.activeHandles.delete(input.conversationId)
        if (handle) await this.adapter.close(handle.adapterSessionId, 'user_exit').catch(() => undefined)
        return route
    }

    subscribe(listener: (event: RealtimeDomainEvent) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    currentHandle(conversationId: string): RealtimeSessionHandle | null {
        const handle = this.activeHandles.get(conversationId)
        return handle ? structuredClone(handle) : null
    }

    dispose(): void {
        this.unsubscribeAdapter()
        this.listeners.clear()
        for (const handle of this.activeHandles.values()) {
            void this.adapter.close(handle.adapterSessionId, 'controller_disposed')
        }
        this.activeHandles.clear()
    }

    private isCurrentEvent(event: RealtimeDomainEvent): boolean {
        let route: ForegroundRoute
        try {
            route = this.routes.activeRoute(event.conversationId)
        } catch {
            return false
        }
        if (route.surface_mode !== 'voice'
            || route.realtime_session_id !== event.realtimeSessionId
            || route.realtime_session_generation !== event.realtimeSessionGeneration) {
            return false
        }
        const binding = this.routes.scopeBinding(route.foreground_route_id)
        const handle = this.activeHandles.get(event.conversationId)
        return Boolean(binding
            && handle
            && binding.conversationId === event.conversationId
            && binding.realtimeProviderThreadId === event.realtimeProviderThreadId
            && binding.realtimeSessionId === event.realtimeSessionId
            && binding.realtimeSessionGeneration === event.realtimeSessionGeneration
            && handle.adapterSessionId === event.adapterSessionId)
    }

    private failCurrentVoiceRoute(
        event: Extract<RealtimeDomainEvent, { type: 'realtime.session.error' | 'realtime.session.closed' }>
    ): void {
        const current = this.routes.activeRoute(event.conversationId)
        if (current.surface_mode !== 'voice'
            || current.realtime_session_id !== event.realtimeSessionId
            || current.realtime_session_generation !== event.realtimeSessionGeneration) return
        const handle = this.activeHandles.get(event.conversationId) || null
        try {
            this.routes.voicePreparationFailed({
                conversationId: event.conversationId,
                expected: routeExpectation(foregroundRouteClaim(current)),
                contextVersion: current.context_version,
                attachedTaskIds: current.attached_task_ids
            })
            this.activeHandles.delete(event.conversationId)
            if (handle && event.type === 'realtime.session.error') {
                void this.adapter.close(handle.adapterSessionId, 'session_error').catch(() => undefined)
            }
        } catch {
            // A canonical commit may still be quiescing. The route remains visibly
            // failed/degraded until the integration owner retries recovery.
        }
    }

    private rekeyFailedPreparationIfStillCurrent(
        conversationId: string,
        expectedClaim: ForegroundRouteClaim,
        contextVersion: number,
        attachedTaskIds: string[]
    ): boolean {
        const active = this.routes.activeRoute(conversationId)
        if (active.foreground_route_id !== expectedClaim.foregroundRouteId
            || active.route_epoch !== expectedClaim.routeEpoch
            || active.owner_claim_id !== expectedClaim.ownerClaimId) {
            return false
        }
        try {
            this.routes.voicePreparationFailed({
                conversationId,
                expected: routeExpectation(expectedClaim),
                contextVersion,
                attachedTaskIds
            })
            this.activeHandles.delete(conversationId)
            return true
        } catch {
            return false
        }
    }
}

function assertCandidateHandle(handle: RealtimeSessionHandle, input: RealtimeConnectInput): void {
    if (handle.realtimeSessionGeneration !== input.requestedSessionGeneration
        || handle.hydratedPacketId !== input.hydrationSeed.packetId
        || !equalRealtimeWatermarks(handle.hydratedThrough, input.hydrationSeed.sourceWatermarks)
        || !handle.adapterSessionId
        || !handle.realtimeProviderThreadId
        || !handle.realtimeSessionId
        || !handle.answerSdp) {
        throw new Error('Realtime adapter returned an invalid prepared-session handle.')
    }
}
