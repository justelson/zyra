import { ipcRenderer } from 'electron'
import { ASSISTANT_IPC } from '../shared/assistant/contracts'
import {
    RENDERER_DIAGNOSTIC_SIGNAL_CHANNEL,
    type RendererDiagnosticInteraction,
    type RendererDiagnosticIpcContext,
    type RendererDiagnosticRoute,
    type RendererDiagnosticSignal,
    type RendererDiagnosticSurface
} from '../shared/renderer-diagnostics'

const HEARTBEAT_INTERVAL_MS = 2_000
const EVENT_LOOP_SAMPLE_MS = 1_000
const EVENT_LOOP_STALL_THRESHOLD_MS = 250
const EVENT_LOOP_SUSPEND_LIMIT_MS = 30_000
const LONG_TASK_THRESHOLD_MS = 100
const INTERACTION_THROTTLE_MS = 250
const SAFE_IDENTIFIER_MAX_LENGTH = 160

let installed = false

function sendSignal(signal: RendererDiagnosticSignal): void {
    try {
        ipcRenderer.send(RENDERER_DIAGNOSTIC_SIGNAL_CHANNEL, signal)
    } catch {
        // Renderer teardown can close IPC before pagehide cleanup runs.
    }
}

function safeIdentifier(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim()
    if (!normalized || normalized.length > SAFE_IDENTIFIER_MAX_LENGTH) return undefined
    return normalized
}

function routeFamily(value: string): string {
    const firstSegment = value.split(/[?&#/]/).find(Boolean)
    return firstSegment ? `/${firstSegment.slice(0, 64)}` : '/'
}

function currentRoute(): RendererDiagnosticRoute {
    const pathname = routeFamily(String(window.location.pathname || '/'))
    const rawHash = String(window.location.hash || '')
    const hashPath = rawHash.startsWith('#/') ? routeFamily(rawHash.slice(1)) : null
    return { pathname, hashPath }
}

function readDiagnosticSurface(): RendererDiagnosticSurface | null {
    const candidates = [...document.querySelectorAll<HTMLElement>('[data-zyra-diagnostic-surface]')]
    const target = candidates.reverse().find((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
    })
    if (!target) return null
    const sourceCharacters = Number(target.dataset.zyraDiagnosticSourceCharacters)
    const itemCount = Number(target.dataset.zyraDiagnosticItemCount)
    return {
        name: String(target.dataset.zyraDiagnosticSurface || 'unknown').slice(0, 64),
        sourceCharacters: Number.isFinite(sourceCharacters) ? Math.max(0, sourceCharacters) : null,
        itemCount: Number.isFinite(itemCount) ? Math.max(0, itemCount) : null,
        animation: target.dataset.zyraDiagnosticAnimation?.slice(0, 32) || null
    }
}

function readHeapUsage(): { heapUsedBytes: number | null; heapLimitBytes: number | null } {
    const memory = (performance as Performance & {
        memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number }
    }).memory
    return {
        heapUsedBytes: Number.isFinite(memory?.usedJSHeapSize) ? Number(memory?.usedJSHeapSize) : null,
        heapLimitBytes: Number.isFinite(memory?.jsHeapSizeLimit) ? Number(memory?.jsHeapSizeLimit) : null
    }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function safeIpcContext(channel: string, args: unknown[]): RendererDiagnosticIpcContext | null {
    const first = recordFrom(args[0])
    const context: RendererDiagnosticIpcContext = {}

    if (channel === ASSISTANT_IPC.getHistoryPage && first) {
        context.threadId = safeIdentifier(first.threadId)
        context.direction = first.before ? 'older' : first.after ? 'newer' : 'latest'
        if (typeof first.turnLimit === 'number' && Number.isFinite(first.turnLimit)) {
            context.turnLimit = Math.max(1, Math.min(3, Math.floor(first.turnLimit)))
        }
    } else if (
        channel === ASSISTANT_IPC.selectThread
        || channel === ASSISTANT_IPC.getHistoryAroundMessage
        || channel === ASSISTANT_IPC.hydrateHistoryBody
        || channel === ASSISTANT_IPC.getReviewIndex
        || channel === ASSISTANT_IPC.getTurnDetail
        || channel === ASSISTANT_IPC.searchTurns
    ) {
        context.threadId = safeIdentifier(first?.threadId)
        context.sessionId = safeIdentifier(first?.sessionId)
        context.turnId = safeIdentifier(first?.turnId)
    } else if (
        channel === ASSISTANT_IPC.getThreadDetailBootstrap
        || channel === ASSISTANT_IPC.getFleetSnapshot
    ) {
        context.threadId = safeIdentifier(args[0])
    } else if (
        channel === ASSISTANT_IPC.selectSession
        || channel === ASSISTANT_IPC.regenerateSessionTitle
        || channel === ASSISTANT_IPC.archiveSession
        || channel === ASSISTANT_IPC.deleteSession
    ) {
        context.sessionId = safeIdentifier(args[0])
    } else if (channel === ASSISTANT_IPC.interruptTurn) {
        context.turnId = safeIdentifier(args[0])
        context.sessionId = safeIdentifier(args[1])
    } else if (channel === 'devscope:browserView:command' && first) {
        context.tabId = safeIdentifier(first.tabId)
        context.operation = safeIdentifier(first.type)
    } else if (channel === 'devscope:browserView:ensure' && first) {
        context.tabId = safeIdentifier(first.tabId)
        context.threadId = safeIdentifier(first.threadId)
        context.operation = 'ensure'
    }

    return Object.keys(context).length > 0 ? context : null
}

function installIpcTiming(): void {
    const renderer = ipcRenderer as typeof ipcRenderer & {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
    const originalInvoke = renderer.invoke.bind(renderer)
    let requestSequence = 0
    renderer.invoke = (channel: string, ...args: unknown[]) => {
        const startedAt = performance.now()
        const requestId = `${Math.round(performance.timeOrigin)}:${++requestSequence}`
        sendSignal({
            kind: 'ipc-start',
            sentAt: Date.now(),
            requestId,
            channel: String(channel).slice(0, 180),
            context: safeIpcContext(channel, args)
        })
        let request: Promise<unknown>
        try {
            request = originalInvoke(channel, ...args)
        } catch (error) {
            sendSignal({
                kind: 'ipc-end',
                sentAt: Date.now(),
                requestId,
                channel: String(channel).slice(0, 180),
                durationMs: performance.now() - startedAt,
                outcome: 'error'
            })
            throw error
        }
        return request.then((result) => {
            sendSignal({
                kind: 'ipc-end',
                sentAt: Date.now(),
                requestId,
                channel: String(channel).slice(0, 180),
                durationMs: performance.now() - startedAt,
                outcome: 'success'
            })
            return result
        }, (error) => {
            sendSignal({
                kind: 'ipc-end',
                sentAt: Date.now(),
                requestId,
                channel: String(channel).slice(0, 180),
                durationMs: performance.now() - startedAt,
                outcome: 'error'
            })
            throw error
        })
    }
}

export function installRendererDiagnostics(): void {
    if (installed || typeof window === 'undefined') return
    installed = true
    installIpcTiming()

    let lastInteraction: RendererDiagnosticInteraction | null = null
    let lastInteractionSignalAt = 0
    let lastEventLoopSampleAt = performance.now()
    let visibleSince = document.visibilityState === 'visible' ? lastEventLoopSampleAt : Number.POSITIVE_INFINITY

    const reportLifecycle = (state: 'ready' | 'visible' | 'hidden' | 'pagehide') => {
        sendSignal({ kind: 'lifecycle', sentAt: Date.now(), state, route: currentRoute() })
    }
    const reportHeartbeat = () => {
        const heap = readHeapUsage()
        sendSignal({
            kind: 'heartbeat',
            sentAt: Date.now(),
            route: currentRoute(),
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            ...heap,
            surface: readDiagnosticSurface(),
            lastInteraction
        })
    }
    const reportInteraction = (kind: RendererDiagnosticInteraction['kind'], target: EventTarget | null) => {
        const element = target instanceof Element ? target : null
        const interaction: RendererDiagnosticInteraction = {
            kind,
            targetTag: element?.tagName?.toLowerCase().slice(0, 32) || null,
            targetRole: element?.getAttribute('role')?.slice(0, 48) || null,
            at: Date.now()
        }
        lastInteraction = interaction
        const now = performance.now()
        if (now - lastInteractionSignalAt < INTERACTION_THROTTLE_MS) return
        lastInteractionSignalAt = now
        sendSignal({ kind: 'interaction', sentAt: Date.now(), interaction, route: currentRoute() })
    }

    const heartbeatTimer = window.setInterval(reportHeartbeat, HEARTBEAT_INTERVAL_MS)
    const eventLoopTimer = window.setInterval(() => {
        const now = performance.now()
        const durationMs = now - lastEventLoopSampleAt - EVENT_LOOP_SAMPLE_MS
        lastEventLoopSampleAt = now
        if (
            document.visibilityState === 'visible'
            && durationMs >= EVENT_LOOP_STALL_THRESHOLD_MS
            && durationMs < EVENT_LOOP_SUSPEND_LIMIT_MS
        ) {
            sendSignal({ kind: 'event-loop-stall', sentAt: Date.now(), durationMs, route: currentRoute() })
        }
    }, EVENT_LOOP_SAMPLE_MS)

    let longTaskObserver: PerformanceObserver | null = null
    if (typeof PerformanceObserver !== 'undefined') {
        try {
            longTaskObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (
                        document.visibilityState !== 'visible'
                        || entry.startTime < visibleSince
                        || entry.duration < LONG_TASK_THRESHOLD_MS
                    ) continue
                    sendSignal({
                        kind: 'long-task',
                        sentAt: Date.now(),
                        durationMs: entry.duration,
                        startTimeMs: entry.startTime,
                        route: currentRoute()
                    })
                }
            })
            longTaskObserver.observe({ entryTypes: ['longtask'] })
        } catch {
            longTaskObserver = null
        }
    }

    document.addEventListener('pointerdown', (event) => reportInteraction('pointer', event.target), { capture: true, passive: true })
    document.addEventListener('wheel', (event) => reportInteraction('wheel', event.target), { capture: true, passive: true })
    document.addEventListener('keydown', (event) => reportInteraction('keyboard', event.target), { capture: true, passive: true })
    document.addEventListener('touchstart', (event) => reportInteraction('touch', event.target), { capture: true, passive: true })
    document.addEventListener('visibilitychange', () => {
        const now = performance.now()
        lastEventLoopSampleAt = now
        visibleSince = document.visibilityState === 'visible' ? now : Number.POSITIVE_INFINITY
        reportLifecycle(document.visibilityState === 'visible' ? 'visible' : 'hidden')
        reportHeartbeat()
    }, { passive: true })
    window.addEventListener('pagehide', () => {
        reportLifecycle('pagehide')
        window.clearInterval(heartbeatTimer)
        window.clearInterval(eventLoopTimer)
        longTaskObserver?.disconnect()
    }, { once: true, passive: true })

    reportLifecycle('ready')
    reportHeartbeat()
}
