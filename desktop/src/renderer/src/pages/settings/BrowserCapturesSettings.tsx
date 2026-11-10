import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, FolderOpen, Image, MessageSquarePlus, RefreshCw, Trash2, Video } from 'lucide-react'
import type { DevScopeBrowserCaptureArtifact, DevScopeResult } from '@shared/contracts/devscope-api'
import { SettingsButton, SettingsNotice, SettingsPageContainer, SettingsSection, SettingsSegmented } from './settings-layout'

const PAGE_SIZE = 12
type Filter = 'all' | 'screenshot' | 'recording'
const date = (capture: DevScopeBrowserCaptureArtifact) => new Date(capture.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const size = (bytes: number) => bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`

export default function BrowserCapturesSettings() {
    const [filter, setFilter] = useState<Filter>('all')
    const [offset, setOffset] = useState(0)
    const [captures, setCaptures] = useState<DevScopeBrowserCaptureArtifact[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
    const [deleting, setDeleting] = useState<string | null>(null)
    const request = useRef(0)
    const load = useCallback(async () => {
        const current = ++request.current
        setLoading(true)
        try {
            if (!window.devscope.listBrowserCaptures) throw new Error('Capture library is available in the updated Desktop app.')
            const result = await window.devscope.listBrowserCaptures({ offset, limit: PAGE_SIZE, kind: filter === 'all' ? undefined : filter })
            if (request.current !== current) return
            if (!result.success) throw new Error(result.error || 'Could not load captures.')
            if (offset > 0 && offset >= result.total) { setOffset(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1) * PAGE_SIZE); return }
            setCaptures(result.captures); setTotal(result.total)
        } catch (error) {
            if (request.current === current) { setCaptures([]); setNotice({ error: true, text: error instanceof Error ? error.message : 'Could not load captures.' }) }
        } finally { if (request.current === current) setLoading(false) }
    }, [filter, offset])
    useEffect(() => { setNotice(null); setDeleting(null); void load(); return () => { request.current++ } }, [load])
    const action = async (operation: () => Promise<DevScopeResult>, message: string, refresh = false) => {
        if (busy) return
        setBusy(true); setNotice(null)
        try {
            const result = await operation()
            if (!result.success) throw new Error(result.error || 'Capture action failed.')
            setNotice({ error: false, text: message })
            setDeleting(null)
            if (refresh) await load()
        } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : 'Capture action failed.' }) }
        finally { setBusy(false) }
    }
    return <SettingsPageContainer title="Captures" showSettingsBack backTo="/settings/workspace/browser" backLabel="Browser" navigation={<></>}>
        <SettingsSection title="Saved captures" headerAction={<SettingsButton variant="ghost" aria-label="Refresh captures" title="Refresh" disabled={loading || busy} onClick={() => { setNotice(null); void load() }}><RefreshCw size={13} /></SettingsButton>}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--settings-border)] px-4 py-3">
                <SettingsSegmented<Filter> label="Capture type" value={filter} options={[{ value: 'all', label: 'All' }, { value: 'screenshot', label: 'Screenshots' }, { value: 'recording', label: 'Recordings' }]} onChange={value => { setFilter(value); setOffset(0) }} />
                <span className="text-xs text-[var(--settings-text-muted)]">{total} saved</span>
            </div>
            {notice ? <div role={notice.error ? 'alert' : 'status'}><SettingsNotice tone={notice.error ? 'error' : 'success'}>{notice.text}</SettingsNotice></div> : null}
            {loading ? <div role="status" className="px-4 py-10 text-center text-xs text-[var(--settings-text-secondary)]">Loading captures…</div> : captures.length === 0 ? <div className="px-4 py-12 text-center text-xs text-[var(--settings-text-secondary)]">{notice?.error ? 'Captures could not be loaded.' : filter === 'all' ? 'Screenshots and recordings you save in Browser appear here.' : `No ${filter === 'screenshot' ? 'screenshots' : 'recordings'} saved.`}</div> : <ul className="divide-y divide-[var(--settings-border)]">
                {captures.map(capture => {
                    const label = capture.kind === 'screenshot' ? 'Screenshot' : 'Recording'
                    const Icon = capture.kind === 'screenshot' ? Image : Video
                    return <li key={capture.artifactId} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                            <button type="button" aria-label={`Open ${label.toLowerCase()} from ${date(capture)}`} disabled={busy} onClick={() => void action(() => window.devscope.openBrowserPreviewArtifact(capture.artifactId), 'Opened capture.')} className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--settings-border)] bg-[var(--surface-floating)] text-[var(--settings-text-muted)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]">
                                {capture.thumbnailDataUrl ? <img src={capture.thumbnailDataUrl} alt="" className="h-full w-full object-cover" /> : <Icon size={19} />}
                            </button>
                            <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{label}</p><p className="mt-1 text-[11px] text-[var(--settings-text-secondary)]">{date(capture)} · {size(capture.sizeBytes)}</p></div>
                            <div className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
                                <SettingsButton variant="ghost" title="Open" aria-label={`Open ${label.toLowerCase()}`} disabled={busy} onClick={() => void action(() => window.devscope.openBrowserPreviewArtifact(capture.artifactId), 'Opened capture.')}><ExternalLink size={14} /></SettingsButton>
                                <SettingsButton variant="ghost" title={capture.kind === 'screenshot' ? 'Copy image' : 'Copy video path'} aria-label={capture.kind === 'screenshot' ? 'Copy image' : 'Copy video path'} disabled={busy} onClick={() => void action(() => window.devscope.copyBrowserPreviewArtifact({ artifactId: capture.artifactId, mode: capture.kind === 'screenshot' ? 'image' : 'path' }), 'Copied.')}><Copy size={14} /></SettingsButton>
                                <SettingsButton variant="ghost" title="Show in folder" aria-label="Show in folder" disabled={busy} onClick={() => void action(() => window.devscope.revealBrowserPreviewArtifact(capture.artifactId), 'Shown in folder.')}><FolderOpen size={14} /></SettingsButton>
                                <SettingsButton variant="ghost" title="Attach to new chat" aria-label="Attach to new chat" disabled={busy} onClick={() => void action(() => window.devscope.attachBrowserCaptureToChat({ artifactId: capture.artifactId }), 'Opening chat draft…')}><MessageSquarePlus size={14} /></SettingsButton>
                                <SettingsButton variant="ghost" title="Delete capture" aria-label="Delete capture" disabled={busy} onClick={() => setDeleting(capture.artifactId)}><Trash2 size={14} /></SettingsButton>
                            </div>
                        </div>
                        {deleting === capture.artifactId ? <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs"><span className="mr-auto text-[var(--settings-text-secondary)]">Delete this saved {label.toLowerCase()}?</span><SettingsButton variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>Cancel</SettingsButton><SettingsButton variant="danger" disabled={busy} onClick={() => void action(() => window.devscope.deleteBrowserCapture(capture.artifactId), 'Capture deleted.', true)}>Delete</SettingsButton></div> : null}
                    </li>
                })}
            </ul>}
            {total > PAGE_SIZE ? <div className="flex items-center justify-between border-t border-[var(--settings-border)] px-4 py-3 text-xs text-[var(--settings-text-secondary)]"><span>{offset + 1}–{Math.min(total, offset + PAGE_SIZE)} of {total}</span><div className="flex gap-2"><SettingsButton variant="ghost" disabled={loading || busy || offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>Previous</SettingsButton><SettingsButton variant="ghost" disabled={loading || busy || offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</SettingsButton></div></div> : null}
        </SettingsSection>
    </SettingsPageContainer>
}
