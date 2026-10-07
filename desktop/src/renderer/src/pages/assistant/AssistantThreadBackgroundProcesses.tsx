import { useEffect, useRef, useState } from 'react'
import type { AssistantBackgroundProcess } from '@shared/assistant/contracts'

/** The keyed owner discards all UI and request state when the selected chat changes. */
export function AssistantThreadBackgroundProcesses(props: { sessionId: string; threadId: string }) {
    return <BackgroundProcessOwner key={JSON.stringify([props.sessionId, props.threadId])} {...props} />
}

function BackgroundProcessOwner({ sessionId, threadId }: { sessionId: string; threadId: string }) {
    const [jobs, setJobs] = useState<AssistantBackgroundProcess[]>([])
    const [loading, setLoading] = useState(true)
    const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null)
    const [readError, setReadError] = useState<string | null>(null)
    const [stopError, setStopError] = useState<string | null>(null)
    const [stopping, setStopping] = useState<string | null>(null)
    const [confirmAll, setConfirmAll] = useState(false)
    const owner = useRef<{ disposed: boolean; revision: number; stopping: boolean } | null>(null)

    useEffect(() => {
        const current = { disposed: false, revision: 0, stopping: false }
        owner.current = current
        let timer: ReturnType<typeof setTimeout> | undefined
        const poll = async () => {
            const revision = current.revision
            try {
                if (!current.stopping) {
                    const result = await window.devscope.assistant.listBackgroundProcesses({ sessionId, threadId })
                    if (current.disposed || current.revision !== revision) return
                    if (!result.success) throw new Error(result.error || 'Could not load background processes.')
                    setJobs(result.jobs)
                    setRuntimeAvailable(result.runtimeAvailable)
                    setReadError(null)
                }
            } catch (failure) {
                if (!current.disposed && current.revision === revision) {
                    setReadError(failure instanceof Error ? failure.message : 'Could not load background processes.')
                }
            } finally {
                if (!current.disposed) {
                    setLoading(false)
                    // Schedule only after settlement: even a slow request cannot overlap the next read.
                    timer = setTimeout(() => void poll(), 3000)
                }
            }
        }
        void poll()
        return () => {
            current.disposed = true
            if (timer !== undefined) clearTimeout(timer)
        }
    }, [sessionId, threadId])

    const stop = async (jobId?: string) => {
        const current = owner.current
        if (!current || current.disposed || current.stopping) return
        current.stopping = true
        ++current.revision // An older in-flight list must never replace this mutation's result.
        setStopping(jobId || '*')
        setStopError(null)
        setConfirmAll(false)
        try {
            const result = await window.devscope.assistant.stopBackgroundProcesses({
                sessionId, threadId, ...(jobId ? { jobId } : { all: true })
            })
            if (current.disposed) return
            if (!result.success) throw new Error(result.error || 'Could not stop background processes.')
            setJobs(result.jobs)
            setRuntimeAvailable(result.runtimeAvailable)
            setReadError(null)
        } catch (failure) {
            if (!current.disposed) setStopError(failure instanceof Error ? failure.message : 'Could not stop background processes.')
        } finally {
            current.stopping = false
            if (!current.disposed) setStopping(null)
        }
    }

    const processes = jobs.filter(job => job.background && (job.status === 'running' || job.cleanupFailed))
    const runningCount = processes.filter(job => job.status === 'running').length
    const buttonClass = 'shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sparkle-text-secondary transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text disabled:cursor-not-allowed disabled:opacity-50'
    return <section className="space-y-2 border-t border-white/5 pt-3 text-xs" aria-label="Background processes" aria-busy={loading || Boolean(stopping)}>
        <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sparkle-text">Background processes</span>
            {runningCount > 0 && <span className="text-sparkle-text-muted">{runningCount} running</span>}
        </div>
        {loading && <p role="status" className="text-sparkle-text-muted">Loading processes…</p>}
        {!loading && runtimeAvailable === false && <p className="text-sparkle-text-muted">Process runtime unavailable.</p>}
        {!loading && runtimeAvailable === true && processes.length === 0 && <p className="text-sparkle-text-muted">No running background processes.</p>}
        {processes.length > 0 && <ul className="max-h-48 space-y-2 overflow-y-auto">
            {processes.map(job => <li key={job.jobId} className="space-y-1 rounded-md bg-white/[0.02] p-2">
                <div className="break-all font-mono text-sparkle-text" title={job.command}>{job.command}</div>
                {job.ownerAgentRunId && <div className="text-[11px] text-sparkle-text-muted">Agent process</div>}
                {job.cleanupFailed && <div role="alert" className="space-y-1 text-amber-300">
                    <div className="font-medium">Cleanup unconfirmed</div>
                    <p className="break-words">{job.errorMessage || 'Could not confirm that this process stopped.'}</p>
                </div>}
                <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-sparkle-text-muted" title={job.jobId}>{job.jobId}</span>
                    <button type="button" disabled={Boolean(stopping) || runtimeAvailable === false} onClick={() => void stop(job.jobId)} className={buttonClass} aria-label={`Stop process ${job.jobId}`}>
                        {stopping === job.jobId || stopping === '*' ? 'Stopping…' : 'Stop process'}
                    </button>
                </div>
            </li>)}
        </ul>}
        {processes.length > 0 && !confirmAll && <button type="button" disabled={Boolean(stopping) || runtimeAvailable === false} onClick={() => setConfirmAll(true)} className={buttonClass}>
            {stopping === '*' ? 'Stopping processes…' : 'Stop all processes'}
        </button>}
        {confirmAll && <div className="space-y-2 rounded-md border border-amber-400/20 bg-amber-500/[0.05] p-2">
            <p className="text-sparkle-text-secondary">Stop all background processes for this thread? Servers will stop.</p>
            <div className="flex gap-2">
                <button type="button" className={buttonClass} onClick={() => void stop()}>Confirm stop all</button>
                <button type="button" className={buttonClass} onClick={() => setConfirmAll(false)}>Cancel</button>
            </div>
        </div>}
        {readError && <p role="alert" className="break-words text-red-400">{readError}</p>}
        {stopError && <p role="alert" className="break-words text-red-400">{stopError}</p>}
    </section>
}
