type Turn = { id: string; state: string } | null

/** An abort acknowledgement must not dismiss Stopping while the same turn is
 * still running in the canonical store. This observer is used only on Stop. */
export function waitForAssistantStopConfirmation(input: {
    turnId: string
    readTurn: () => Turn
    subscribe: (listener: () => void) => () => void
    timeoutMs?: number
}): Promise<void> {
    return new Promise((resolve, reject) => {
        let finished = false
        let unsubscribe = () => {}
        const finish = (error?: Error) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            unsubscribe()
            if (error) reject(error)
            else resolve()
        }
        const check = () => {
            const turn = input.readTurn()
            if (turn && (turn.id !== input.turnId || turn.state !== 'running')) finish()
        }
        const timer = setTimeout(() => finish(new Error('Stop was requested but is not confirmed yet. Your queue is held; try Stop again.')), input.timeoutMs ?? 15_000)
        unsubscribe = input.subscribe(check)
        if (finished) unsubscribe()
        else check()
    })
}
