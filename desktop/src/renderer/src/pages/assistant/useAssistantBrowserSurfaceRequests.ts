import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserSurfaceOpenRequest } from '@shared/agent-control/protocol'
import type { ControlTarget } from '@shared/agent-control/contracts'

async function completeSurfaceFailure(request: BrowserSurfaceOpenRequest, error: string): Promise<void> {
    await window.devscope.agentControl.completeBrowserSurfaceRequest({
        requestId: request.requestId,
        threadId: request.threadId,
        tabId: request.tabId,
        success: false,
        error
    }).catch(() => { /* The owner may have closed or reloaded. */ })
}

function targetMatchesRequest(request: BrowserSurfaceOpenRequest, targets: ControlTarget[]): boolean {
    return Boolean(request.targetId && Array.isArray(targets) && targets.some((target) => (
        target.kind === 'zyra-browser'
        && target.targetId === request.targetId
        && target.tabId === request.tabId
        && target.ownerThreadId === request.threadId
    )))
}

async function waitForAppliedInspectorWidth(request: BrowserSurfaceOpenRequest, previousWidth: number | null): Promise<number | null> {
    const startedAt = Date.now()
    let latestWidth: number | null = null
    while (Date.now() - startedAt < 1_500) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 40))
        const state = await window.devscope.agentControl.getState()
        if (!state.success || !targetMatchesRequest(request, state.state.targets)) continue
        const workspace = state.state.workspace
        const width = Number(workspace?.inspector.width)
        if (workspace?.threadId !== request.threadId || !workspace.inspector.open || !Number.isFinite(width)) continue
        latestWidth = width
        if (width !== previousWidth || Date.now() - startedAt >= 240) return width
    }
    return latestWidth
}

export function useAssistantBrowserSurfaceRequests({
    threadId,
    revealInspector,
    resizeInspector
}: {
    threadId: string | null
    revealInspector: () => void
    resizeInspector: (width: number) => void
}) {
    const [requests, setRequests] = useState<BrowserSurfaceOpenRequest[]>([])
    const threadRef = useRef(threadId)
    threadRef.current = threadId
    const callbacks = useRef({ revealInspector, resizeInspector })
    callbacks.current = { revealInspector, resizeInspector }
    const pending = useRef(new Map<string, BrowserSurfaceOpenRequest>())

    useEffect(() => {
        const fail = (request: BrowserSurfaceOpenRequest, error: string) => {
            pending.current.delete(request.requestId)
            return completeSurfaceFailure(request, error)
        }
        const unsubscribe = window.devscope.agentControl.onBrowserSurfaceRequest((request) => {
            if (!threadRef.current || request.threadId !== threadRef.current) {
                void fail(request, 'Select the requesting chat before opening its Browser tab.')
                return
            }
            pending.current.set(request.requestId, request)
            void (async () => {
                const acknowledgement = await window.devscope.agentControl.acknowledgeBrowserSurfaceRequest({
                    requestId: request.requestId,
                    threadId: request.threadId,
                    tabId: request.tabId
                })
                if (!acknowledgement.success || !acknowledgement.accepted || !pending.current.has(request.requestId)) {
                    pending.current.delete(request.requestId)
                    return
                }
                if (threadRef.current !== request.threadId || !pending.current.has(request.requestId)) {
                    await fail(request, 'The requesting chat changed before its Browser command started.')
                    return
                }
                if (request.mode === 'resize') {
                    const requestedWidth = Number(request.width)
                    const state = await window.devscope.agentControl.getState()
                    if (!state.success
                        || !targetMatchesRequest(request, state.state.targets)
                        || threadRef.current !== request.threadId
                        || !Number.isFinite(requestedWidth)) {
                        await fail(request, 'Inspector resize no longer matches the selected trusted Browser tab.')
                        return
                    }
                    const previousWidth = state.state.workspace?.threadId === request.threadId
                        ? state.state.workspace.inspector.width
                        : null
                    callbacks.current.revealInspector()
                    callbacks.current.resizeInspector(requestedWidth)
                    const appliedWidth = await waitForAppliedInspectorWidth(request, previousWidth)
                    if (threadRef.current !== request.threadId || !pending.current.has(request.requestId) || appliedWidth === null) {
                        await fail(request, 'Inspector resize was not confirmed by the selected chat workspace.')
                        return
                    }
                    await window.devscope.agentControl.completeBrowserSurfaceRequest({
                        requestId: request.requestId,
                        threadId: request.threadId,
                        tabId: request.tabId,
                        success: true,
                        targetId: request.targetId!,
                        width: appliedWidth
                    })
                    pending.current.delete(request.requestId)
                    return
                }
                if (request.reveal) callbacks.current.revealInspector()
                if (threadRef.current !== request.threadId || !pending.current.has(request.requestId)) {
                    await fail(request, 'The requesting chat changed before its Browser workspace opened.')
                    return
                }
                setRequests((current) => current.some((entry) => entry.requestId === request.requestId)
                    ? current
                    : [...current, request])
            })().catch((error) => {
                void fail(request, error instanceof Error ? error.message : 'The Browser workspace could not open.')
                pending.current.delete(request.requestId)
            })
        })
        return () => {
            unsubscribe()
            for (const request of pending.current.values()) {
                void fail(request, 'The chat workspace closed before its Browser request finished. Open the requesting chat and retry.')
            }
            pending.current.clear()
        }
    }, [])

    useEffect(() => window.devscope.agentControl.onBrowserSurfaceCancel((requestId) => {
        pending.current.delete(requestId)
        setRequests((current) => current.filter((request) => request.requestId !== requestId))
    }), [])

    useEffect(() => {
        const stale = requests.filter((request) => request.threadId !== threadId)
        if (stale.length === 0) return
        setRequests((current) => current.filter((request) => request.threadId === threadId))
        for (const request of stale) {
            pending.current.delete(request.requestId)
            void completeSurfaceFailure(request, 'The requesting chat changed before its Browser workspace opened.')
        }
    }, [requests, threadId])

    const handleRequest = useCallback((requestId: string) => {
        pending.current.delete(requestId)
        setRequests((current) => current.filter((request) => request.requestId !== requestId))
    }, [])

    return { request: requests[0] || null, handleRequest }
}
