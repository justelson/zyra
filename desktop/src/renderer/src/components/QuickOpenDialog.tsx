import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FileSearch, FolderOpen, Search, X } from 'lucide-react'
import { NativeOverlayPortal, getOverlayActiveElement } from './ui/native-overlay-portal'
import { useAssistantStoreSelector } from '@/lib/assistant/assistant-store-hooks'
import { getSelectedAssistantSession } from '@/lib/assistant/selectors'
import { useFilePreview, prefetchPreviewFile } from './ui/file-preview/useFilePreview'
import { openAssistantFileTarget } from '@/pages/assistant/assistant-file-navigation'
import { useQuickOpenSearch, rememberQuickOpenFile } from './use-quick-open-search'
import type { QuickOpenFile } from './quick-open-model'
import { useNavigate } from 'react-router-dom'
import { buildAssistantChatRoute } from '@/pages/assistant/assistant-chat-route'
import { FileEntryIcon } from './ui/FileEntryIcon'
import { useSettings } from '@/lib/settings'

const FilePreviewModal = lazy(() => import('./ui/FilePreviewModal'))

export default function QuickOpenDialog() {
    const { settings } = useSettings()
    const navigate = useNavigate()
    useEffect(() => {
        const show = (event: Event) => navigate(buildAssistantChatRoute(String((event as CustomEvent).detail)))
        window.addEventListener('zyra:show-code-context', show)
        return () => window.removeEventListener('zyra:show-code-context', show)
    }, [navigate])
    const workingRoot = useAssistantStoreSelector(state => {
        const session = getSelectedAssistantSession(state.snapshot)
        return session?.workingRoot || session?.chatScope?.workingRoot || session?.projectPath || ''
    })
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<'files' | 'contents'>('files')
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState('')
    const [folder, setFolder] = useState('')
    const [index, setIndex] = useState(0)
    const [opening, setOpening] = useState(false)
    const [openError, setOpenError] = useState('')
    const [previewRoot, setPreviewRoot] = useState('')
    const input = useRef<HTMLInputElement>(null)
    const previousFocus = useRef<HTMLElement | null>(null)
    const root = folder || workingRoot
    const results = useQuickOpenSearch(root, query, mode, filter, open)
    const preview = useFilePreview()
    const close = () => { setOpen(false); window.setTimeout(() => previousFocus.current?.isConnected && previousFocus.current.focus(), 0) }
    useEffect(() => {
        const show = (event: Event) => {
            previousFocus.current = getOverlayActiveElement()
            setMode((event as CustomEvent).detail === 'contents' ? 'contents' : 'files')
            setQuery(''); setFilter(''); setFolder(''); setIndex(0); setOpenError(''); setOpen(true)
        }
        window.addEventListener('zyra:quick-open', show)
        return () => window.removeEventListener('zyra:quick-open', show)
    }, [])
    useEffect(() => { setIndex(0); setOpenError('') }, [query, root, mode, filter])
    useEffect(() => { input.current?.ownerDocument.getElementById(`quick-open-${index}`)?.scrollIntoView({ block: 'nearest' }) }, [index])
    const activate = async (file: QuickOpenFile) => {
        if (opening || results.pending) return
        setOpening(true); setOpenError('')
        setPreviewRoot(root)
        try {
            const opened = await openAssistantFileTarget({ target: file.path, projectPath: root, openPreview: preview.openPreview, previewOptions: { focusLine: file.line } })
            if (!opened) throw new Error('This file no longer exists.')
            rememberQuickOpenFile(root, file.path)
            setOpen(false)
        } catch (error) { setOpenError(error instanceof Error ? error.message : 'Could not open file.') }
        finally { setOpening(false) }
    }
    return <>
        {open && <NativeOverlayPortal focusOnPresent onReady={() => input.current?.focus()}>
            <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/45 px-4 pt-[15vh]" onMouseDown={close}>
                <div role="dialog" aria-modal="true" aria-label={mode === 'files' ? 'Open a file' : 'Search project contents'} className="flex max-h-[calc(85vh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-sparkle-border bg-sparkle-card shadow-xl" onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); close() }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, Math.min(results.files.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))) }
                    if (event.key === 'Enter' && event.target === input.current && results.files[index]) { event.preventDefault(); void activate(results.files[index]) }
                }}>
                    <div className="flex shrink-0 items-center gap-3 border-b border-sparkle-border px-4 py-3">
                        <Search size={16} className="shrink-0 text-sparkle-text-muted" />
                        <input ref={input} role="combobox" aria-expanded="true" aria-controls="quick-open-results" aria-activedescendant={results.files[index] ? `quick-open-${index}` : undefined} aria-label={mode === 'files' ? 'Filename or filename:line' : 'Text in files'} value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'files' ? 'Filename or filename:line' : 'Search text in files'} className="min-w-0 flex-1 bg-transparent text-sm text-sparkle-text outline-none" />
                        <button title={mode === 'files' ? 'Search inside files' : 'Search filenames'} aria-label={mode === 'files' ? 'Search inside files' : 'Search filenames'} onClick={() => { setMode(value => value === 'files' ? 'contents' : 'files'); input.current?.focus() }}><FileSearch size={15} /></button>
                        <button aria-label="Close file search" onClick={close}><X size={15} /></button>
                    </div>
                    <div id="quick-open-results" role="listbox" aria-label="Files" className="min-h-0 max-h-[50vh] overflow-y-auto p-1 [scrollbar-gutter:stable]">
                        {results.files.map((file, row) => <button key={`${file.path}:${file.line || 0}`} id={`quick-open-${row}`} role="option" aria-selected={index === row} disabled={opening || results.pending} className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left ${index === row ? 'bg-[var(--surface-hover)]' : 'hover:bg-white/[0.025]'}`} onMouseEnter={() => { setIndex(row); const ext = file.path.split('.').pop() || ''; prefetchPreviewFile({ name: file.name.split('/').pop() || file.name, path: file.path }, ext) }} onClick={() => void activate(file)}>
                            <FileEntryIcon pathValue={file.path} kind="file" theme={settings.appearanceResolvedMode} size={16} className="shrink-0" />
                            <span className="min-w-0 flex-1"><span className="flex min-w-0 items-baseline gap-3"><span className="max-w-[45%] shrink-0 truncate text-xs font-medium text-sparkle-text">{file.path.replace(/\\/g, '/').split('/').pop()}{file.line ? `:${file.line}` : ''}</span><span className="min-w-0 truncate text-[11px] text-sparkle-text-muted/65">{file.path.replace(root, '').replace(/^[\\/]/, '').replace(/[\\/][^\\/]+$/, '')}</span></span>{file.text && <span className="mt-0.5 block truncate font-mono text-[10px] text-sparkle-text-muted">{file.text}</span>}</span>
                        </button>)}
                        {!results.pending && !results.files.length && root && <p className="px-3 py-5 text-sm text-sparkle-text-muted">{mode === 'contents' && !query ? 'Enter text to search.' : 'No files found.'}</p>}
                    </div>
                    {(openError || results.error || results.truncated) && <p role={openError || results.error ? 'alert' : 'status'} className="shrink-0 px-4 py-2 text-xs text-sparkle-text-muted">{openError || results.error || 'More matches exist. Narrow your search.'}</p>}
                    <div data-quick-open-footer className="flex shrink-0 items-center gap-2 border-t border-sparkle-border px-4 py-2 text-xs text-sparkle-text-muted">
                        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" title={root || 'Choose a folder'} onClick={() => void window.devscope.selectFolder().then(result => { if (result.success && result.folderPath) setFolder(result.folderPath) })}><FolderOpen size={13} /><span className="truncate">{root || 'Choose a folder'}</span></button>
                        {mode === 'contents' && <input data-quick-open-filter aria-label="File filter" placeholder="*.ts" value={filter} onChange={event => setFilter(event.target.value)} className="w-24 bg-transparent text-right outline-none" />}
                        {(results.pending || opening) && <span role="status">{opening ? 'Opening file...' : 'Searching...'}</span>}
                    </div>
                </div>
            </div>
        </NativeOverlayPortal>}
        {preview.previewFile && <Suspense fallback={null}><FilePreviewModal chromeContext="peek" file={preview.previewFile} content={preview.previewContent} loading={preview.loadingPreview} truncated={preview.previewTruncated} size={preview.previewSize} previewBytes={preview.previewBytes} modifiedAt={preview.previewModifiedAt} projectPath={previewRoot || undefined} onClose={() => { preview.closePreview(); close() }} onOpenLinkedPreview={preview.openPreview} /></Suspense>}
    </>
}
