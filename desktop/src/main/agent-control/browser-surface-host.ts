import { randomUUID } from 'node:crypto'
import type {
    BrowserSurfaceOpenAcknowledgement,
    BrowserSurfaceOpenCompletion,
    BrowserSurfaceOpenRequest
} from '../../shared/agent-control/protocol'
import type { ControlPrincipal, ControlTarget } from '../../shared/agent-control/contracts'
import { CONTROL_BOUNDS } from '../../shared/agent-control/policy'
import { AgentControlError } from './control-errors'

const BROWSER_SURFACE_ACCEPT_TIMEOUT_MS = 8_000
const BROWSER_SURFACE_REGISTER_TIMEOUT_MS = 20_000
const MAX_PENDING_BROWSER_SURFACE_REQUESTS = 8
const MAX_SETTLED_BROWSER_SURFACE_REQUESTS = 64

type BrowserTarget = Extract<ControlTarget, { kind: 'zyra-browser' }>
type BrowserSurfaceResult = { target: BrowserTarget; width?: number }

type PendingSurfaceRequest = {
    request: BrowserSurfaceOpenRequest
    resolve: (result: BrowserSurfaceResult) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
    phase: 'sent' | 'accepted' | 'claimed'
    signal?: AbortSignal
    abort?: () => void
    expectedTarget?: BrowserTarget
}

export class BrowserSurfaceHost {
    private readonly pending = new Map<string, PendingSurfaceRequest>()
    private readonly settled = new Set<string>()
    private disposed = false

    constructor(private readonly options: {
        send: (request: BrowserSurfaceOpenRequest) => void
        cancel?: (requestId: string) => void
        resolveTarget: (targetId: string) => ControlTarget
        makeId?: () => string
        timeoutMs?: number
    }) {}

    openTab(
        principal: ControlPrincipal,
        reveal: boolean,
        sessionMode: 'normal' | 'incognito',
        signal?: AbortSignal
    ): Promise<BrowserTarget> {
        const id = this.options.makeId?.() || randomUUID()
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        return this.requestTarget({
            version: 1,
            requestId: `browser-open:${id}`,
            threadId,
            mode: 'open',
            tabId: `browser:agent:${id}`,
            sessionMode,
            reveal,
            requestedBy: principal
        }, signal)
    }

    revealTabs(
        principal: ControlPrincipal,
        primary: BrowserTarget,
        secondary: BrowserTarget | null,
        signal?: AbortSignal,
        explicitLayout = false
    ): Promise<BrowserTarget> {
        if (secondary?.tabId === primary.tabId) {
            return Promise.reject(new AgentControlError('CONTROL_VALIDATION_ERROR', 'A Browser split requires two different tabs.'))
        }
        const id = this.options.makeId?.() || randomUUID()
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        return this.requestTarget({
            version: 1,
            requestId: `browser-reveal:${id}`,
            threadId,
            mode: secondary || explicitLayout ? 'layout' : 'reveal',
            tabId: primary.tabId,
            targetId: primary.targetId,
            ...(secondary ? { secondaryTabId: secondary.tabId, secondaryTargetId: secondary.targetId } : {}),
            reveal: true,
            requestedBy: principal
        }, signal, primary)
    }

    resizeInspector(
        principal: ControlPrincipal,
        target: BrowserTarget,
        width: number,
        signal?: AbortSignal
    ): Promise<{ target: BrowserTarget; width: number }> {
        const id = this.options.makeId?.() || randomUUID()
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        return this.requestSurface({
            version: 1,
            requestId: `browser-resize:${id}`,
            threadId,
            mode: 'resize',
            tabId: target.tabId,
            targetId: target.targetId,
            width,
            reveal: true,
            requestedBy: principal
        }, signal, target).then((result) => {
            if (!Number.isFinite(result.width)) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The Inspector did not confirm its responsive width.')
            return { target: result.target, width: result.width! }
        })
    }

    closeTab(
        principal: ControlPrincipal,
        target: BrowserTarget,
        signal?: AbortSignal
    ): Promise<BrowserTarget> {
        const id = this.options.makeId?.() || randomUUID()
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        return this.requestTarget({
            version: 1,
            requestId: `browser-close:${id}`,
            threadId,
            mode: 'close',
            tabId: target.tabId,
            targetId: target.targetId,
            reveal: false,
            requestedBy: principal
        }, signal, target)
    }

    commandTab(
        principal: ControlPrincipal,
        target: BrowserTarget,
        mode: 'refresh' | 'navigate' | 'external',
        url: string | null,
        signal?: AbortSignal
    ): Promise<BrowserTarget> {
        const id = this.options.makeId?.() || randomUUID()
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        return this.requestTarget({
            version: 1,
            requestId: `browser-${mode}:${id}`,
            threadId,
            mode,
            tabId: target.tabId,
            targetId: target.targetId,
            ...(url ? { url } : {}),
            reveal: mode !== 'external',
            requestedBy: principal
        }, signal, target)
    }

    private requestTarget(
        request: BrowserSurfaceOpenRequest,
        signal?: AbortSignal,
        expectedTarget?: BrowserTarget
    ): Promise<BrowserTarget> {
        return this.requestSurface(request, signal, expectedTarget).then((result) => result.target)
    }

    private requestSurface(
        request: BrowserSurfaceOpenRequest,
        signal?: AbortSignal,
        expectedTarget?: BrowserTarget
    ): Promise<BrowserSurfaceResult> {
        if (this.disposed) {
            return Promise.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The Browser surface host is unavailable.'))
        }
        if (this.pending.size >= MAX_PENDING_BROWSER_SURFACE_REQUESTS) {
            return Promise.reject(new AgentControlError('CONTROL_QUEUE_FULL', 'Too many Browser surface requests are waiting.'))
        }
        return new Promise((resolve, reject) => {
            const rejectPending = (error: Error) => {
                const pending = this.pending.get(request.requestId)
                if (!pending || pending.phase === 'claimed') return
                const taken = this.takePending(request.requestId)
                if (!taken) return
                this.options.cancel?.(request.requestId)
                reject(error)
            }
            const timer = this.makeTimeout(request.requestId, 'sent')
            const abort = () => rejectPending(new AgentControlError('CONTROL_CANCELLED', 'The Browser surface request was cancelled.'))
            this.pending.set(request.requestId, { request, resolve, reject, timer, phase: 'sent', signal, abort, expectedTarget })
            if (signal?.aborted) {
                abort()
                return
            }
            signal?.addEventListener('abort', abort, { once: true })
            try {
                this.options.send(request)
            } catch (error) {
                rejectPending(error instanceof Error ? error : new Error('Could not contact the Browser workspace.'))
            }
        })
    }

    acknowledge(value: BrowserSurfaceOpenAcknowledgement): boolean {
        const requestId = String(value?.requestId || '')
        const pending = this.pending.get(requestId)
        if (!pending) {
            if (this.settled.has(requestId)) return false
            throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The Browser open request is no longer active.')
        }
        this.assertMatchesRequest(pending, value)
        if (pending.phase === 'accepted' || pending.phase === 'claimed') return false
        pending.phase = 'accepted'
        clearTimeout(pending.timer)
        pending.timer = this.makeTimeout(requestId, 'accepted')
        return true
    }

    claim(value: BrowserSurfaceOpenAcknowledgement): boolean {
        const requestId = String(value?.requestId || '')
        const pending = this.pending.get(requestId)
        if (!pending) {
            if (this.settled.has(requestId)) return false
            throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The Browser surface request is no longer active.')
        }
        this.assertMatchesRequest(pending, value)
        if (pending.phase === 'claimed') return false
        pending.phase = 'claimed'
        clearTimeout(pending.timer)
        pending.timer = this.makeTimeout(requestId, 'claimed')
        return true
    }

    completeRegisteredTarget(target: ControlTarget): boolean {
        if (target.kind !== 'zyra-browser') return false
        const pending = [...this.pending.values()].find((entry) => (
            (entry.request.mode || 'open') === 'open'
            && entry.request.tabId === target.tabId
            && entry.request.threadId === target.ownerThreadId
            && (entry.request.sessionMode || 'incognito') === target.sessionMode
        ))
        if (!pending) return false
        const taken = this.takePending(pending.request.requestId)
        if (!taken) return false
        taken.resolve({ target })
        return true
    }

    complete(value: BrowserSurfaceOpenCompletion): boolean {
        const requestId = String(value?.requestId || '')
        const pending = this.pending.get(requestId)
        if (!pending) {
            if (this.settled.has(requestId)) return false
            throw new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The Browser open request is no longer active.')
        }
        this.assertMatchesRequest(pending, value)
        const mode = pending.request.mode || 'open'
        if (value.success && ['close', 'refresh', 'navigate', 'external'].includes(mode) && pending.phase !== 'claimed') {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_SCOPE_DENIED', 'The Browser command was not atomically claimed before completion.'))
            return Boolean(taken)
        }
        if (!value.success) {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', value.error || 'The Browser tab could not be opened.'))
            return Boolean(taken)
        }
        if (pending.request.targetId && value.targetId !== pending.request.targetId) {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_SCOPE_DENIED', 'The Browser response resolved to a different trusted target.'))
            return Boolean(taken)
        }
        let target: ControlTarget
        try {
            target = mode === 'close' && pending.expectedTarget?.targetId === value.targetId
                ? pending.expectedTarget
                : this.options.resolveTarget(value.targetId)
        } catch {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_TARGET_NOT_FOUND', 'The Browser tab did not resolve to its trusted control target.'))
            return Boolean(taken)
        }
        if (target.kind !== 'zyra-browser' || target.tabId !== pending.request.tabId) {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_SCOPE_DENIED', 'The Browser response resolved to a different control target.'))
            return Boolean(taken)
        }
        if (mode === 'resize' && (!Number.isFinite(value.width) || value.width! < CONTROL_BOUNDS.minInspectorWidth || value.width! > CONTROL_BOUNDS.maxInspectorWidth)) {
            const taken = this.takePending(requestId)
            taken?.reject(new AgentControlError('CONTROL_VALIDATION_ERROR', 'The Inspector response did not include its applied width.'))
            return Boolean(taken)
        }
        const taken = this.takePending(requestId)
        taken?.resolve({ target, ...(mode === 'resize' ? { width: Math.round(value.width!) } : {}) })
        return Boolean(taken)
    }

    cancelPending(reason = 'Browser surface requests were cancelled.'): void {
        for (const requestId of [...this.pending.keys()]) {
            const current = this.pending.get(requestId)
            if (current?.phase === 'claimed') continue
            const pending = this.takePending(requestId)
            if (!pending) continue
            this.options.cancel?.(requestId)
            pending.reject(new AgentControlError('CONTROL_CANCELLED', reason))
        }
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        this.cancelPending('The Browser surface host closed.')
    }

    private assertMatchesRequest(
        pending: PendingSurfaceRequest,
        value: { threadId: string; tabId: string }
    ): void {
        if (value.threadId !== pending.request.threadId || value.tabId !== pending.request.tabId) {
            throw new AgentControlError('CONTROL_SCOPE_DENIED', 'The Browser response does not match its requested thread and tab.')
        }
    }

    private makeTimeout(requestId: string, phase: PendingSurfaceRequest['phase']): NodeJS.Timeout {
        const configured = this.options.timeoutMs
        const defaultTimeout = phase === 'sent' ? BROWSER_SURFACE_ACCEPT_TIMEOUT_MS : BROWSER_SURFACE_REGISTER_TIMEOUT_MS
        const timeoutMs = Math.max(1_000, Math.min(25_000, configured || defaultTimeout))
        const timer = setTimeout(() => {
            const current = this.pending.get(requestId)
            if (!current) return
            const pending = this.takePending(requestId)
            if (!pending) return
            if (current.phase !== 'claimed') this.options.cancel?.(requestId)
            const mode = pending.request.mode || 'open'
            pending.reject(new AgentControlError(
                'CONTROL_TIMEOUT',
                phase === 'sent'
                    ? 'The selected thread did not acknowledge its Browser surface request in time.'
                    : mode === 'open'
                        ? 'The Browser tab was accepted but did not register as a trusted control target in time.'
                        : mode === 'close'
                            ? 'The Browser workspace accepted the request but did not close the selected tab in time.'
                            : ['refresh', 'navigate', 'external'].includes(mode)
                                ? 'The Browser workspace accepted the tab command but did not finish it in time.'
                                : 'The Browser workspace accepted the request but did not reveal the selected tab in time.'
            ))
        }, timeoutMs)
        timer.unref?.()
        return timer
    }

    private takePending(requestId: string): PendingSurfaceRequest | undefined {
        const pending = this.pending.get(requestId)
        if (!pending) return undefined
        clearTimeout(pending.timer)
        pending.signal?.removeEventListener('abort', pending.abort!)
        this.pending.delete(requestId)
        this.markSettled(requestId)
        return pending
    }

    private markSettled(requestId: string): void {
        this.settled.add(requestId)
        while (this.settled.size > MAX_SETTLED_BROWSER_SURFACE_REQUESTS) {
            const oldest = this.settled.values().next().value
            if (!oldest) break
            this.settled.delete(oldest)
        }
    }
}
