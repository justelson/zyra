import type { AssistantLatestTurn, AssistantThread, AssistantThreadState } from '../../shared/assistant/contracts'
import { normalizeAssistantMessageReferenceId } from '../../shared/assistant/message-identity'
import type { CanonicalAgentChatPresence } from './zyra-agent-server-worker'

const ACTIVE_CANONICAL_PRESENCE_STATES = new Set<CanonicalAgentChatPresence['state']>(['running', 'background'])
const ACTIVE_ASSISTANT_THREAD_STATES = new Set<AssistantThreadState>(['starting', 'running', 'waiting'])

/** Preserve a freshly read local terminal turn while an older catalog response is in flight. */
export function mergeCanonicalCompletionReceipt(local: string | null | undefined, canonical: string | null | undefined, latestTurnId: string | undefined): string | null {
    if (local && local === latestTurnId && canonical !== latestTurnId) return local
    return canonical || local || null
}

type DesktopCanonicalPresence = CanonicalAgentChatPresence & { observedSequence?: number }

export function isCanonicalPresenceActive(presence?: CanonicalAgentChatPresence | null): boolean {
    return presence?.state === 'running' || presence?.state === 'background'
}

export function hasCanonicalUserInputAttention(presence?: CanonicalAgentChatPresence | null): boolean {
    return presence?.attention === 'input' || presence?.attention === 'user-input'
}

export function mergeCanonicalPresenceObservation(
    previous: DesktopCanonicalPresence | null | undefined,
    observed: CanonicalAgentChatPresence
): DesktopCanonicalPresence {
    const appliedSequence = Math.max(0, Number(previous?.latestSequence) || 0)
    const observedSequence = Math.max(
        appliedSequence,
        Number(previous?.observedSequence) || 0,
        Number(observed.latestSequence) || 0
    )
    return {
        ...observed,
        latestSequence: appliedSequence,
        observedSequence
    }
}

/**
 * Reconcile the persisted Desktop shell with the server-owned canonical worker.
 * Detached chats keep their persisted terminal state so an absent worker does not
 * rewrite ordinary history. Live canonical presence wins for active transitions.
 */
export function resolveCanonicalPresenceThreadState(input: {
    currentState: AssistantThreadState
    localThread?: AssistantThread
    previousPresence?: CanonicalAgentChatPresence | null
    presence?: CanonicalAgentChatPresence | null
}): AssistantThreadState {
    const { currentState, previousPresence, presence, localThread } = input
    if (!presence) return currentState
    if (presence.state === 'running' && localThread?.latestTurn && localThread.latestTurn.state !== 'running'
        && presence.activeTurnId === localThread.latestTurn.id) {
        return localThread.latestTurn.state === 'interrupted' ? 'interrupted' : localThread.latestTurn.state === 'error' ? 'error' : 'ready'
    }
    if (presence.state === 'running') return 'running'
    if (presence.state === 'background') return 'waiting'
    if (presence.state === 'ready' && localThread) {
        const localTurn = localThread.latestTurn
        if (localTurn?.state === 'running'
            && (presence.latestTurn?.id !== localTurn.id || presence.latestTurn.state === 'running')) return currentState
        if (currentState === 'starting' && hasLocallyUnstartedPrompt(localThread)) return currentState
    }
    if (
        presence.state === 'ready'
        && (
            ACTIVE_ASSISTANT_THREAD_STATES.has(currentState)
            || (previousPresence ? ACTIVE_CANONICAL_PRESENCE_STATES.has(previousPresence.state) : false)
        )
    ) {
        return 'ready'
    }
    return currentState
}

function hasLocallyUnstartedPrompt(thread: AssistantThread): boolean {
    const lastUser = [...(thread.messages || [])].reverse().find((message) => message.role === 'user')
    if (!lastUser) return false
    if (!thread.latestTurn) return true
    const completedAt = thread.latestTurn.completedAt
    if (!completedAt) return false
    return Date.parse(lastUser.createdAt) > Date.parse(completedAt)
}

export function resolveCanonicalPresenceAttention(input: {
    currentHasPendingApprovals: boolean
    currentHasPendingUserInputs: boolean
    hasLocalPendingApproval: boolean
    hasLocalPendingInput: boolean
    presence?: CanonicalAgentChatPresence | null
}): { hasPendingApprovals: boolean; hasPendingUserInputs: boolean } {
    const canonicalAttentionReported = Boolean(
        input.presence
        && Object.prototype.hasOwnProperty.call(input.presence, 'attention')
    )
    if (!canonicalAttentionReported) {
        return {
            hasPendingApprovals: input.currentHasPendingApprovals || input.hasLocalPendingApproval,
            hasPendingUserInputs: input.currentHasPendingUserInputs || input.hasLocalPendingInput
        }
    }
    return {
        hasPendingApprovals: input.hasLocalPendingApproval || input.presence?.attention === 'approval',
        hasPendingUserInputs: input.hasLocalPendingInput || hasCanonicalUserInputAttention(input.presence)
    }
}

export function mergeCanonicalPresenceLatestTurn(
    current: AssistantLatestTurn | null,
    presence?: CanonicalAgentChatPresence | null
): AssistantLatestTurn | null {
    const canonical = presence?.latestTurn
    if (!canonical) return current
    const canonicalAssistantMessageId = normalizeAssistantMessageReferenceId(canonical.assistantMessageId)
    if (!current || current.id !== canonical.id) {
        return {
            ...canonical,
            assistantMessageId: canonicalAssistantMessageId,
            usage: null
        }
    }
    return {
        ...current,
        ...canonical,
        // A terminal ledger entry is immutable for this turn identity. A new
        // turn can start normally, but attachment/replay cannot resurrect it.
        state: current.state !== 'running' && (canonical.state === 'running' || current.state === 'interrupted' && canonical.state === 'error') ? current.state : canonical.state,
        requestedAt: current.requestedAt || canonical.requestedAt,
        startedAt: current.startedAt || canonical.startedAt,
        completedAt: current.state !== 'running' ? current.completedAt || canonical.completedAt : canonical.completedAt,
        assistantMessageId: canonicalAssistantMessageId || current.assistantMessageId,
        effort: current.effort,
        serviceTier: current.serviceTier,
        usage: current.usage || null
    }
}
