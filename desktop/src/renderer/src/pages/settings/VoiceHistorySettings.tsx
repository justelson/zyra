import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Pause, Play, Trash2 } from 'lucide-react'
import type { AssistantVoiceHistoryEntry } from '@shared/assistant/contracts'
import { SettingsButton, SettingsDialog, SettingsSection } from './settings-layout'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'

const entryDescription = (entry: AssistantVoiceHistoryEntry) => `${entry.engine === 'codex' ? 'ChatGPT' : 'Browser'} voice entry from ${new Date(entry.createdAt).toLocaleString()}`

function formatTime(seconds: number): string {
    if (seconds > 0 && seconds < 1) return `${seconds.toFixed(1)}s`
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function VoiceRecordingPlayer({ entry, src, loading, load, onError }: {
    entry: AssistantVoiceHistoryEntry
    src?: string
    loading: boolean
    load: () => Promise<string | null>
    onError: (message: string) => void
}) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)
    const [position, setPosition] = useState(0)
    const [mediaDuration, setMediaDuration] = useState(0)
    const duration = mediaDuration > 0 ? mediaDuration : entry.durationMs / 1000

    useEffect(() => {
        const audio = audioRef.current
        return () => { audio?.pause() }
    }, [])

    const toggle = async () => {
        const audio = audioRef.current
        if (!audio || loading) return
        if (!audio.paused) { audio.pause(); return }
        const recording = src || await load()
        if (!recording || audioRef.current !== audio) return
        if (audio.src !== recording) audio.src = recording
        try { await audio.play() } catch { if (audioRef.current === audio) onError('Could not play this recording.') }
    }

    return <div className="flex h-7 w-[160px] max-w-[50%] shrink-0 items-center gap-1.5 rounded-md bg-[var(--settings-control-hover)] px-1.5 sm:w-[190px]" role="group" aria-label={`Recording from ${new Date(entry.createdAt).toLocaleString()}`}>
        {/* Assign the source once in toggle; a React src update can interrupt the pending play request. */}
        <audio ref={audioRef} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(0) }} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setMediaDuration(event.currentTarget.duration) }} />
        <button type="button" onClick={() => void toggle()} disabled={loading} className="flex size-5 shrink-0 items-center justify-center rounded text-[var(--settings-text)] hover:bg-[var(--settings-control-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]" aria-label={loading ? 'Loading recording' : playing ? 'Pause recording' : 'Play recording'} title={playing ? 'Pause' : 'Play'}>
            {loading ? <LoaderCircle size={12} className="animate-spin" /> : playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        </button>
        <input type="range" min={0} max={Math.max(duration, 0.1)} step={0.1} value={Math.min(position, Math.max(duration, 0.1))} onChange={event => { const audio = audioRef.current; if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) }} disabled={!src || duration <= 0} aria-label="Recording position" className="min-w-0 flex-1 accent-[var(--accent-primary)]" />
        <span className="shrink-0 tabular-nums text-[10px] text-[var(--settings-text-muted)]">{formatTime(playing || position > 0 ? position : duration)}</span>
    </div>
}

export function VoiceHistorySettings() {
    const [entries, setEntries] = useState<AssistantVoiceHistoryEntry[]>([])
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalCount, setTotalCount] = useState(0)
    const [totalPages, setTotalPages] = useState(1)
    const pageRequest = useRef(0)
    const currentPage = useRef(1)

    const refreshPage = useCallback(async (requestedPage = currentPage.current) => {
        const request = ++pageRequest.current
        setLoading(true)
        setError(null)
        try {
            const result = await window.devscope.assistant.listVoiceHistory({ page: requestedPage })
            if (request !== pageRequest.current) return
            if (!result.success) throw new Error(result.error || 'Could not load voice history.')
            setEntries(result.entries)
            // Older isolated bridges may only supply entries; production supplies all metadata.
            const resolvedPage = result.page ?? 1
            currentPage.current = resolvedPage
            setPage(resolvedPage)
            setTotalCount(result.totalCount ?? result.entries.length)
            setTotalPages(result.totalPages ?? 1)
        } catch (cause) {
            if (request === pageRequest.current) setError(cause instanceof Error ? cause.message : 'Could not load voice history.')
        } finally {
            if (request === pageRequest.current) setLoading(false)
        }
    }, [])
    const [recordings, setRecordings] = useState<Record<string, string>>({})
    const recordingUrls = useRef(new Map<string, string>())
    const recordingGeneration = useRef(0)
    const deletedRecordingIds = useRef(new Set<string>())
    const [loadingRecording, setLoadingRecording] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [deleteCandidate, setDeleteCandidate] = useState<AssistantVoiceHistoryEntry | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)

    useEffect(() => {
        recordingGeneration.current++
        // Fast Refresh can preserve state after cleanup revokes its URLs.
        setRecordings({})
        setLoadingRecording(null)
        void refreshPage()
        return () => {
            pageRequest.current++
            recordingGeneration.current++
            for (const url of recordingUrls.current.values()) URL.revokeObjectURL(url)
            recordingUrls.current.clear()
        }
    }, [refreshPage])

    const loadRecording = async (id: string): Promise<string | null> => {
        const cached = recordingUrls.current.get(id)
        if (cached) return cached
        const generation = recordingGeneration.current
        setLoadingRecording(id)
        setError(null)
        try {
            const result = await window.devscope.assistant.getFailedVoiceRecording(id)
            if (generation !== recordingGeneration.current || deletedRecordingIds.current.has(id)) return null
            if (!result.success || !result.audioBase64) throw new Error(result.success ? 'Recording is unavailable.' : result.error)
            // The renderer permits blob media; data audio is blocked by its CSP.
            const bytes = Uint8Array.from(atob(result.audioBase64), character => character.charCodeAt(0))
            const src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
            const previousUrl = recordingUrls.current.get(id)
            if (previousUrl) URL.revokeObjectURL(previousUrl)
            recordingUrls.current.set(id, src)
            setRecordings(previous => ({ ...previous, [id]: src }))
            return src
        } catch (cause) {
            if (generation === recordingGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not load recording.')
            return null
        } finally {
            if (generation === recordingGeneration.current) setLoadingRecording(current => current === id ? null : current)
        }
    }

    const copyTranscript = async (entry: AssistantVoiceHistoryEntry) => {
        if (!entry.transcript) return
        setError(null)
        try {
            const result = await window.devscope.copyToClipboard?.(entry.transcript)
            if (result && !result.success) throw new Error(result.error || 'Could not copy transcript.')
            if (!result) {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
                await navigator.clipboard.writeText(entry.transcript)
            }
            setCopiedId(entry.id)
            window.setTimeout(() => setCopiedId(current => current === entry.id ? null : current), 1500)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not copy transcript.')
        }
    }

    const deleteEntry = async () => {
        if (!deleteCandidate || deleting) return
        const id = deleteCandidate.id
        setDeleting(true)
        setDeleteError(null)
        try {
            const result = await window.devscope.assistant.deleteVoiceHistory(id)
            if (!result.success) throw new Error(result.error || 'Could not delete voice entry.')
            deletedRecordingIds.current.add(id)
            const recordingUrl = recordingUrls.current.get(id)
            if (recordingUrl) URL.revokeObjectURL(recordingUrl)
            recordingUrls.current.delete(id)
            setEntries(current => current.filter(entry => entry.id !== id))
            setRecordings(current => {
                const next = { ...current }
                delete next[id]
                return next
            })
            setDeleteCandidate(null)
            // The source clamps an emptied final page and refills any gaps on this page.
            await refreshPage()
        } catch (cause) {
            setDeleteError(cause instanceof Error ? cause.message : 'Could not delete voice entry.')
        } finally {
            setDeleting(false)
        }
    }

    const actionClassName = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] disabled:opacity-45'

    return <>
        <SettingsSection title="Voice history" titleAction={<SettingsInfoTooltip label="About voice history">Successful dictation is saved as text. Failed recordings are kept for playback while storage is below 64 MiB and 20 recordings. Existing recordings are never removed automatically. If storage is full, new failures save the error without audio. Delete old recordings to free space; deletion is permanent.</SettingsInfoTooltip>}>
            {loading ? <p className="px-4 py-4 text-[12px] text-[var(--settings-text-muted)]">Loading voice history…</p> : null}
            {error ? <p role="alert" className="px-4 py-3 text-[12px] text-[var(--status-danger)]">{error}</p> : null}
            {!loading && entries.length === 0 && !error ? <p className="px-4 py-4 text-[12px] text-[var(--settings-text-muted)]">No voice input yet.</p> : null}
            <nav aria-label="Voice history pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--settings-border)] px-4 py-2 text-[12px] text-[var(--settings-text-muted)]">
                <span aria-live="polite">{totalCount} {totalCount === 1 ? 'entry' : 'entries'} · Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                    <SettingsButton variant="ghost" onClick={() => void refreshPage()} disabled={loading || deleting}>Refresh</SettingsButton>
                    <SettingsButton variant="ghost" onClick={() => void refreshPage(page - 1)} disabled={loading || deleting || page <= 1}>Previous</SettingsButton>
                    <SettingsButton variant="ghost" onClick={() => void refreshPage(page + 1)} disabled={loading || deleting || page >= totalPages}>Next</SettingsButton>
                </div>
            </nav>
            {entries.map(entry => <article key={entry.id} className="flex h-[76px] min-w-0 flex-col justify-center gap-1.5 border-t border-[var(--settings-border)] px-4 first:border-t-0">
                <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] text-[var(--settings-text-muted)]">
                    <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()} className="min-w-0 truncate">{new Date(entry.createdAt).toLocaleString()}</time>
                    <span className="shrink-0">{entry.engine === 'codex' ? 'ChatGPT' : 'Browser'} · {entry.status === 'success' ? 'Transcribed' : 'Failed'}</span>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                        {entry.transcript ? <p title={entry.transcript} className="truncate text-[13px] leading-5 text-[var(--settings-text)]">{entry.transcript}</p> : null}
                        {entry.error ? <p title={entry.error} className="truncate text-[12px] leading-5 text-[var(--settings-text-secondary)]">{entry.error}</p> : null}
                    </div>
                    {entry.hasRecording ? <VoiceRecordingPlayer entry={entry} src={recordings[entry.id]} loading={loadingRecording === entry.id} load={() => loadRecording(entry.id)} onError={setError} /> : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1" role="group" aria-label={`Actions for ${entryDescription(entry)}`}>
                        {entry.transcript ? <button type="button" className={actionClassName} title={copiedId === entry.id ? 'Copied' : 'Copy transcript'} aria-label={`Copy transcript from ${entryDescription(entry)}`} onClick={() => void copyTranscript(entry)}>{copiedId === entry.id ? <Check size={13} /> : <Copy size={13} />}</button> : null}
                        <button type="button" className={actionClassName} title="Delete entry" aria-label={`Delete ${entryDescription(entry)}`} onClick={() => { setDeleteError(null); setDeleteCandidate(entry) }}><Trash2 size={13} /></button>
                    </div>
                </div>
            </article>)}
        </SettingsSection>
        <SettingsDialog open={Boolean(deleteCandidate)} title="Delete voice entry?" description="This permanently removes the transcript or saved recording from voice history." onClose={() => { if (!deleting) setDeleteCandidate(null) }} footer={<>
            <SettingsButton variant="ghost" onClick={() => setDeleteCandidate(null)} disabled={deleting}>Cancel</SettingsButton>
            <SettingsButton variant="danger" onClick={() => void deleteEntry()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete entry'}</SettingsButton>
        </>}>
            {deleteError ? <p role="alert" className="text-[12px] text-[var(--status-danger)]">{deleteError}</p> : null}
            <p className="text-[12px] text-[var(--settings-text-secondary)]">{deleteCandidate ? entryDescription(deleteCandidate) : ''}</p>
        </SettingsDialog>
    </>
}
