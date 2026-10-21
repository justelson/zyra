import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useAssistantQueuedComposer } from '../../src/renderer/src/pages/assistant/useAssistantQueuedComposer'

// Legacy target name retained for existing CI callers. Force is now true steering.
let actions: ReturnType<typeof useAssistantQueuedComposer>
let rerender: () => void
let completeDelivery: (success: boolean) => void
let interrupts = 0
let attempts = 0
let accepted = 0
const modes: string[] = []
function Harness() {
    const [, setRevision] = useState(0)
    rerender = () => setRevision(value => value + 1)
    actions = useAssistantQueuedComposer({
        selectedSessionId: 'session', isAssistantBusy: true, isThreadWorking: true,
        commandPending: false, activeTurnId: 'turn-1', busyMessageMode: 'steer',
        sessionStates: [{ sessionId: 'session', threadState: 'running', latestTurnState: 'running', pendingApprovalCount: 0, pendingUserInputCount: 0 }],
        dispatchPrompt: async (_id, _prompt, _files, options) => {
            attempts++
            modes.push(options.dispatchMode || 'immediate')
            const success = await new Promise<boolean>(resolve => { completeDelivery = resolve })
            if (success) accepted++
            return success
        },
        interruptTurn: async () => { interrupts++; throw new Error('Steering must never call abort') }
    })
    return <div>{actions.queuedComposerMessageItems.map(item => <div key={item.id}>{item.prompt}: {item.status}</div>)}</div>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Harness />)
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
async function until(predicate: () => boolean, label: string) {
    const deadline = performance.now() + 3000
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timed out: ${label}`)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}
Object.assign(window, { runForceSendSmoke: async () => {
    await until(() => Boolean(actions), 'hook ready')
    await actions.handleSendPrompt('Preserve my correction', [], { dispatchMode: 'force' } as any)
    await until(() => attempts === 1, 'first real steer')
    for (let i = 0; i < 5; i++) { rerender(); await new Promise(resolve => setTimeout(resolve, 15)) }
    check(attempts === 1 && interrupts === 0, 'unrelated rerenders cannot duplicate steering or abort work')
    check(actions.queuedComposerMessageCount === 1, 'pending acceptance retains the saved message')
    completeDelivery(false)
    await until(() => actions.queueHeld, 'failed delivery held')
    for (let i = 0; i < 10; i++) { rerender(); await new Promise(resolve => setTimeout(resolve, 10)) }
    check(attempts === 1 && accepted === 0, 'failure never retries automatically')
    check(actions.queuedComposerMessageItems[0]?.prompt === 'Preserve my correction', 'failure preserves the prompt')
    check(actions.handleResumeQueue(), 'explicit resume releases the held queue')
    await until(() => attempts === 2, 'explicit retry')
    completeDelivery(true)
    await until(() => accepted === 1 && actions.queuedComposerMessageCount === 0, 'accepted steer consumed once')
    check(interrupts === 0 && modes.every(mode => mode === 'steer'), 'legacy Force becomes steering, never interruption')
    root.unmount()
    return { realSteering: true, noAbort: true, savedUntilAccepted: true, failureHeld: true, explicitRetry: true, acceptedOnce: true }
} })
