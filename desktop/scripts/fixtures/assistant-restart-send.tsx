import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { recoverPersistedSnapshot } from '../../src/main/assistant/projector'
import { mergeCanonicalPresenceLatestTurn, resolveCanonicalPresenceThreadState } from '../../src/main/assistant/service-canonical-presence'
import { isAssistantQueuedComposerSessionBusy, useAssistantQueuedComposer } from '../../src/renderer/src/pages/assistant/useAssistantQueuedComposer'
import type { AssistantSnapshot } from '../../src/shared/assistant/contracts'

const at = '2026-10-01T10:00:00.000Z'
const turn = { id: 'surviving-turn', state: 'running', requestedAt: at, startedAt: at, completedAt: null, assistantMessageId: null } as const
const presence = { state: 'running', activeTurnId: turn.id, latestTurn: turn, clients: [], backgroundWorkActive: false } as const
let actions: ReturnType<typeof useAssistantQueuedComposer>
let finishTurn: () => void
let interrupts = 0
const sent: string[] = []
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
async function until(predicate: () => boolean, label: string) {
    const deadline = performance.now() + 3000
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timed out: ${label}`)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}
function Harness({ legacy }: { legacy: boolean }) {
    const restored = recoverPersistedSnapshot({ sessions: [{ id: 'chat', title: 'Restart send fixture', threadIds: ['thread'], activeThreadId: 'thread', threads: [{
        id: 'thread', providerThreadId: 'canonical-chat', state: legacy ? 'interrupted' : 'running',
        latestTurn: legacy ? { ...turn, state: 'interrupted', completedAt: at } : turn, canonicalPresence: presence,
        messages: [], pendingApprovals: [], pendingUserInputs: []
    }] }] } as unknown as AssistantSnapshot).sessions[0]!.threads[0]!
    const [thread, setThread] = useState(() => ({ ...restored,
        latestTurn: mergeCanonicalPresenceLatestTurn(restored.latestTurn, presence as any),
        state: resolveCanonicalPresenceThreadState({ currentState: restored.state, localThread: restored, presence: presence as any })
    }))
    finishTurn = () => setThread(current => ({ ...current, state: 'ready', latestTurn: { ...current.latestTurn!, state: 'completed', completedAt: at } }))
    const sessionState = { sessionId: 'chat', threadState: thread.state, latestTurnState: thread.latestTurn?.state || null, pendingApprovalCount: 0, pendingUserInputCount: 0 }
    const busy = isAssistantQueuedComposerSessionBusy(sessionState)
    actions = useAssistantQueuedComposer({ selectedSessionId: 'chat', sessionStates: [sessionState], isAssistantBusy: busy,
        isThreadWorking: busy, commandPending: false, activeTurnId: thread.latestTurn?.id || null, busyMessageMode: 'queue',
        dispatchPrompt: async (_id, prompt) => { check(!busy, 'cannot dispatch against a surviving active turn'); sent.push(prompt); return true },
        interruptTurn: async () => { interrupts++; finishTurn() }
    })
    return <div>{thread.state}</div>
}
Object.assign(window, { runRestartSendSmoke: async () => {
    for (const legacy of [false, true]) {
        const container = document.createElement('div'); document.body.append(container)
        const root = createRoot(container)
        actions = undefined as any
        root.render(<Harness legacy={legacy} />)
        await until(() => Boolean(actions), 'restored chat mounted')
        const before = sent.length
        check(await actions.handleSendPrompt('Keep this follow-up', [], { dispatchMode: 'immediate' }), 'send must be accepted rather than restore the composer draft')
        await until(() => actions.queuedComposerMessageCount === 1, 'follow-up queued')
        check(sent.length === before, 'running work must not receive a duplicate immediate prompt')
        check(interrupts === 0, 'queue mode cannot interrupt surviving work')
        finishTurn()
        await until(() => sent.length === before + 1 && actions.queuedComposerMessageCount === 0, 'follow-up dispatched after completion')
        check(sent.at(-1) === 'Keep this follow-up', 'original prompt preserved')
        root.unmount(); container.remove()
    }
    return { restoredRunningSendQueued: true, legacyInterruptionRepaired: true, dispatchedOnceAfterCompletion: true, runningWorkPreserved: true }
} })
