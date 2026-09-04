import type { CachedHydratedThreadState } from './session-hydration-cache'
import {
    deriveAssistantRuntimeStatus,
    type AssistantStoreState
} from './assistant-store-runtime'
import { mergeAssistantShellSnapshot } from './assistant-history-state'
import { hasAssistantWarmSelection, prepareAssistantWarmSelection } from './assistant-warm-selection'

type SetAssistantStoreState = (
    nextState:
        | Partial<AssistantStoreState>
        | ((current: AssistantStoreState) => Partial<AssistantStoreState>)
) => void

type AssistantStoreSessionSelectionContext = {
    state: AssistantStoreState
    hydratedThreadCache: Map<string, CachedHydratedThreadState>
    getState: () => AssistantStoreState
    setState: SetAssistantStoreState
    requestSessionHydration: (sessionId: string, threadId: string | null, options?: { force?: boolean; resetLoadedRange?: boolean }) => Promise<void>
}

export async function selectAssistantStoreSession(
    context: AssistantStoreSessionSelectionContext,
    sessionId: string,
    options?: { force?: boolean }
) {
    const force = options?.force === true
    if (!force && context.state.snapshot.selectedSessionId === sessionId && !context.state.selectionRequestSessionId) {
        return { success: true as const, snapshot: context.state.snapshot }
    }

    const selectedSession = context.state.snapshot.sessions.find((session) => session.id === sessionId) || null
    if (!selectedSession) return { success: false as const, error: 'Assistant session not found.' }

    const previousSessionId = context.state.snapshot.selectedSessionId
    const targetThreadId = selectedSession.activeThreadId || null
    const targetThread = selectedSession.threads.find((thread) => thread.id === targetThreadId) || null
    const transitionKey = `${sessionId}:${targetThreadId || ''}`
    let selectionRequestId = 0

    context.setState((current) => {
        selectionRequestId = current.selectionRequestId + 1
        const warmSelection = prepareAssistantWarmSelection({
            snapshot: current.snapshot,
            sessionId,
            threadId: targetThreadId,
            hydratedThreadCache: context.hydratedThreadCache,
            historyByThreadId: current.historyByThreadId
        })
        const snapshot = warmSelection.snapshot
        return {
            error: null,
            commandPending: true,
            selectionRequestId,
            selectionRequestSessionId: sessionId,
            selectionTransitionKey: transitionKey,
            snapshot,
            historyByThreadId: warmSelection.historyByThreadId,
            status: deriveAssistantRuntimeStatus(snapshot, current.status)
        }
    })

    await Promise.resolve()
    if (context.getState().selectionRequestId !== selectionRequestId) {
        return { success: true as const, snapshot: context.getState().snapshot }
    }

    const restorePreviousSelection = (message: string) => {
        context.setState((current) => {
            if (current.selectionRequestId !== selectionRequestId) return {}
            const canRestore = Boolean(
                previousSessionId
                && current.snapshot.sessions.some((session) => session.id === previousSessionId)
            )
            const snapshot = canRestore && current.snapshot.selectedSessionId === sessionId
                ? { ...current.snapshot, selectedSessionId: previousSessionId }
                : current.snapshot
            return {
                error: message,
                commandPending: false,
                selectionTransitionKey: null,
                selectionRequestSessionId: null,
                snapshot,
                status: deriveAssistantRuntimeStatus(snapshot, current.status)
            }
        })
    }

    try {
        const result = await window.devscope.assistant.selectSession(sessionId)
        if (context.getState().selectionRequestId !== selectionRequestId) return result
        if (!result.success) {
            restorePreviousSelection(result.error)
            return result
        }
        const shellSnapshot = result.snapshot
        if (shellSnapshot) {
            context.setState((current) => {
                if (current.selectionRequestId !== selectionRequestId) return {}
                const warmSelection = prepareAssistantWarmSelection({
                    snapshot: mergeAssistantShellSnapshot(current.snapshot, shellSnapshot),
                    sessionId,
                    threadId: targetThreadId,
                    hydratedThreadCache: context.hydratedThreadCache,
                    historyByThreadId: current.historyByThreadId
                })
                const snapshot = warmSelection.snapshot
                return {
                    snapshot,
                    historyByThreadId: warmSelection.historyByThreadId,
                    status: result.status || deriveAssistantRuntimeStatus(snapshot, current.status)
                }
            })
        }
        if (context.getState().selectionRequestId === selectionRequestId) {
            const current = context.getState()
            const warmSelectionMatchesLatestShell = hasAssistantWarmSelection({
                snapshot: current.snapshot,
                sessionId,
                threadId: targetThreadId,
                hydratedThreadCache: context.hydratedThreadCache,
                historyByThreadId: current.historyByThreadId
            })
            await context.requestSessionHydration(sessionId, targetThreadId, {
                force: !warmSelectionMatchesLatestShell,
                resetLoadedRange: !warmSelectionMatchesLatestShell
            })
        }

        return result
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Assistant command failed.'
        restorePreviousSelection(message)
        return { success: false as const, error: message }
    } finally {
        context.setState((current) => (
            current.selectionRequestId === selectionRequestId
                ? {
                    commandPending: false,
                    selectionTransitionKey: null,
                    selectionRequestSessionId: null
                }
                : {}
        ))
    }
}
