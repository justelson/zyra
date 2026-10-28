import { useEffect, useId, useRef, useState } from 'react'
import './assistant-model-inactivity.css'
import { AssistantComposerMenuSurface, ComposerMenuContext } from './AssistantComposerMenuSurface'

export interface AssistantModelInactivityProgress {
    requestId: string
    startedAt: number
    lastActivityAt: number
    phase: 'waiting' | 'streaming' | 'recovering'
    canPing: boolean
}

export interface AssistantModelInactivityPanelProps {
    progress: AssistantModelInactivityProgress | null
    turnId: string | null
    onPing: (requestId: string) => Promise<void>
    onStop: () => Promise<void>
    suppressed?: boolean
}

export const MODEL_INACTIVITY_DELAY_MS = 120_000

/** Only canonical model-request activity can start this clock, never turn age. */
export function getModelInactivityDeadline(progress: AssistantModelInactivityProgress, snoozedUntil = 0): number {
    return Math.max(Math.max(progress.startedAt, progress.lastActivityAt) + MODEL_INACTIVITY_DELAY_MS, snoozedUntil)
}

export function AssistantModelInactivityPanel(props: AssistantModelInactivityPanelProps) {
    const { progress, turnId } = props
    if (!progress || !turnId || !progress.requestId
        || !Number.isFinite(progress.startedAt) || !Number.isFinite(progress.lastActivityAt)
        || !['waiting', 'streaming', 'recovering'].includes(progress.phase)) return null

    // Remount local choices and pending work on navigation, a new request or activity.
    // Old Chat promises can then settle without changing the current Chat's panel.
    return <ModelInactivityRequestPanel {...props} progress={progress}
        key={JSON.stringify([turnId, progress.requestId, progress.startedAt, progress.lastActivityAt])} />
}

function ModelInactivityRequestPanel({ progress, onPing, onStop, suppressed }:  AssistantModelInactivityPanelProps & {
    progress: AssistantModelInactivityProgress
}) {
    const descriptionId = useId()
    const [now, setNow] = useState(Date.now)
    const [snoozedUntil, setSnoozedUntil] = useState(0)
    const [pingPending, setPingPending] = useState(false)
    const [stopPending, setStopPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const pingPendingRef = useRef(false)
    const stopPendingRef = useRef(false)
    const latestAttempt = useRef(0)
    const mounted = useRef(true)
    const deadline = getModelInactivityDeadline(progress, snoozedUntil)

    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])

    useEffect(() => {
        // A single deadline timer, not an interval for every working Chat.
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
            if (now < deadline) setNow(Date.now())
            return
        }
        const timer = setTimeout(() => setNow(Date.now()), remaining)
        return () => clearTimeout(timer)
    }, [deadline, now])

    async function act(action: 'ping' | 'stop') {
        if (stopPendingRef.current || (action === 'ping'
            && (pingPendingRef.current || !progress.canPing || progress.phase === 'recovering'))) return
        const attempt = ++latestAttempt.current
        const actionRef = action === 'ping' ? pingPendingRef : stopPendingRef
        const setActionPending = action === 'ping' ? setPingPending : setStopPending
        actionRef.current = true
        setActionPending(true)
        setError(null)
        try {
            if (action === 'ping') await onPing(progress.requestId)
            else await onStop()
        } catch (cause) {
            // Stop supersedes any held Ping: late Ping errors must not replace its result.
            if (mounted.current && latestAttempt.current === attempt) {
                const detail = cause instanceof Error ? cause.message : ''
                setError(detail || (action === 'ping' ? 'Could not ping the model. Try again.' : 'Could not stop. Try again.'))
            }
        } finally {
            actionRef.current = false
            // Independent slots keep a late Ping completion from unlocking a pending Stop.
            if (mounted.current) setActionPending(false)
        }
    }

    if (now < deadline || suppressed) return null
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 -mb-[17px]" data-model-inactivity-drawer="true">
        <ComposerMenuContext.Provider value={{ below: false }}>
        <AssistantComposerMenuSurface title="Model inactivity">
        <section className="assistant-model-inactivity" aria-label="Model inactivity"
            data-assistant-composer-hitbox="true" aria-busy={pingPending || stopPending}>
            <div className="assistant-model-inactivity__message">
                <p role="status">No model activity received for 2 minutes.</p>
                {progress.phase === 'recovering' ? <p role="status" className="assistant-model-inactivity__hint">Pinging the model…</p> : null}
                {!progress.canPing && progress.phase !== 'recovering' ? <p id={descriptionId} className="assistant-model-inactivity__hint">
                    Ping is available before the model starts an answer or tool call.
                </p> : null}
                {error ? <p role="alert" className="assistant-model-inactivity__error">{error}</p> : null}
            </div>
            <div className="assistant-model-inactivity__actions">
                <button type="button" disabled={stopPending} onClick={() => { void act('stop') }}>
                    {stopPending ? 'Stopping…' : 'Stop'}
                </button>
                <button type="button" disabled={!progress.canPing || progress.phase === 'recovering' || pingPending || stopPending}
                    aria-describedby={!progress.canPing && progress.phase !== 'recovering' ? descriptionId : undefined}
                    onClick={() => { void act('ping') }}>
                    {pingPending ? 'Pinging…' : 'Ping'}
                </button>
                <button type="button" onClick={() => {
                    const current = Date.now()
                    setSnoozedUntil(current + MODEL_INACTIVITY_DELAY_MS)
                    setNow(current)
                    setError(null)
                }}>Keep waiting</button>
            </div>
        </section>
        </AssistantComposerMenuSurface>
        </ComposerMenuContext.Provider>
        </div>
    )
}
