import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, Image as ImageIcon, LayoutGrid, List, LoaderCircle } from 'lucide-react'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { usePreviewVirtualWindow } from '@/components/ui/file-preview/usePreviewVirtualWindow'
import { getFileUrl } from '@/components/ui/file-preview/utils'
import { MarkdownSiteIcon, resolveExternalMarkdownHost } from '@/components/ui/markdown/InlineTargets'
import { cn } from '@/lib/utils'
import AssistantAttachmentPreviewModal from './AssistantAttachmentPreviewModal'
import type { ComposerContextFile } from './assistant-composer-types'
import { getContentTypeTag, getContextFileMeta, toKbLabel } from './assistant-composer-utils'
import { openAssistantFileTarget } from './assistant-file-navigation'
import { buildAssistantResourceIndex, type AssistantResource } from './assistant-resource-index'
import { assistantResourceCaption, assistantResourceForPath } from './assistant-resource-labels'
import type { AssistantDiffTurn } from './assistant-diff-types'
import { isClipboardAttachmentReference } from './assistant-timeline-helpers'

const NARROW_RESOURCE_NAVIGATOR_WIDTH = 260
const RESOURCE_CARD_ROW_HEIGHT = 126
const RESOURCE_TABLE_ROW_HEIGHT = 48

export type ResourceNavigatorView = 'cards' | 'table'

export function resolvePreviewResourceNavigatorView(width: number, preferredView: ResourceNavigatorView): ResourceNavigatorView {
    return width > 0 && width < NARROW_RESOURCE_NAVIGATOR_WIDTH ? 'table' : preferredView
}

type AssistantPreviewResourceNavigatorProps = {
    turns: AssistantDiffTurn[]
    projectPath: string | null
    activeFilePath: string
    resources?: AssistantResource[]
    onOpenPreview: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onOpenUrl: (url: string) => void
}

function parseAttachmentSize(value: string | null | undefined): number | undefined {
    const size = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(size) && size >= 0 ? size : undefined
}

function inlineImageData(resource: AssistantResource): string | null {
    const candidates = [resource.attachment?.content, resource.attachment?.preview]
    return candidates.find((value) => String(value || '').toLowerCase().startsWith('data:image/')) || null
}

function buildInlineImagePreview(resource: AssistantResource): ComposerContextFile | null {
    const attachment = resource.attachment
    const dataUrl = inlineImageData(resource)
    if (!attachment || !dataUrl) return null
    return {
        id: `${resource.id}:preview`,
        path: dataUrl,
        name: resource.title,
        mimeType: attachment.mime || dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/*',
        kind: 'image',
        previewDataUrl: dataUrl,
        sizeBytes: parseAttachmentSize(attachment.size),
        source: attachment.isClipboard ? 'paste' : 'manual'
    }
}

function directImageSource(resource: AssistantResource): string | null {
    if (resource.url) return resource.url
    const inlineData = inlineImageData(resource)
    if (inlineData) return inlineData
    const path = String(resource.path || resource.attachment?.path || '').trim()
    if (!path || isClipboardAttachmentReference(path)) return null
    return getFileUrl(path)
}

function normalizedPath(value: string | null | undefined): string {
    const path = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path
}

function resourceLocation(resource: AssistantResource): string {
    return resource.url || resource.path || resource.attachment?.path || resource.subtitle
}

function ResourceImage({ resource }: { resource: AssistantResource }) {
    const immediateSource = directImageSource(resource)
    const [resolvedSource, setResolvedSource] = useState<string | null>(immediateSource)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        setResolvedSource(immediateSource)
        setFailed(false)
        if (immediateSource) return
        const reference = String(resource.attachment?.path || '').trim()
        if (!isClipboardAttachmentReference(reference)) return
        let cancelled = false
        void window.devscope.assistant.resolveClipboardAttachment({ reference }).then((result) => {
            if (!cancelled && result.success && result.path) setResolvedSource(getFileUrl(result.path))
        }).catch(() => {
            if (!cancelled) setFailed(true)
        })
        return () => { cancelled = true }
    }, [immediateSource, resource.attachment?.path])

    if (!resolvedSource || failed) {
        return <span className="flex h-full w-full items-center justify-center bg-black/15"><ImageIcon size={18} className="text-sparkle-text-muted/45" /></span>
    }

    return <img src={resolvedSource} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(true)} />
}

function ResourceVisual({ resource }: { resource: AssistantResource }) {
    if (resource.kind === 'image') return <ResourceImage resource={resource} />
    const host = resource.url ? resolveExternalMarkdownHost(resource.url) : null
    return (
        <span className="flex h-full w-full items-center justify-center bg-black/15">
            {host ? <MarkdownSiteIcon host={host} className="inline-flex size-6" /> : <Globe2 size={20} className="text-sky-200/65" />}
        </span>
    )
}

export function AssistantPreviewResourceNavigator({
    turns,
    projectPath,
    activeFilePath,
    resources: suppliedResources,
    onOpenPreview,
    onOpenUrl
}: AssistantPreviewResourceNavigatorProps) {
    const rootRef = useRef<HTMLElement | null>(null)
    const [width, setWidth] = useState(0)
    const [preferredView, setPreferredView] = useState<ResourceNavigatorView>('cards')
    const [openingResourceId, setOpeningResourceId] = useState<string | null>(null)
    const [explicitSelection, setExplicitSelection] = useState<{ id: string; activeFilePath: string } | null>(null)
    const [inlinePreview, setInlinePreview] = useState<ComposerContextFile | null>(null)
    const [error, setError] = useState<string | null>(null)
    const resources = useMemo(() => suppliedResources ?? buildAssistantResourceIndex({ turns, projectPath }).resources, [projectPath, turns, suppliedResources])
    const normalizedActiveFilePath = normalizedPath(activeFilePath)
    const activeFileResource = assistantResourceForPath(resources, activeFilePath)
    const explicitSelectionIsCurrent = Boolean(
        explicitSelection
        && explicitSelection.activeFilePath === normalizedActiveFilePath
        && resources.some((resource) => resource.id === explicitSelection.id)
    )
    const currentResourceId = explicitSelectionIsCurrent ? explicitSelection?.id ?? null : activeFileResource?.id ?? null
    const narrow = width > 0 && width < NARROW_RESOURCE_NAVIGATOR_WIDTH
    const view = resolvePreviewResourceNavigatorView(width, preferredView)
    const columnCount = view === 'cards' ? 2 : 1
    const rowHeight = view === 'cards' ? RESOURCE_CARD_ROW_HEIGHT : RESOURCE_TABLE_ROW_HEIGHT
    const rowCount = Math.ceil(resources.length / columnCount)
    const { range, scrollElementRef: scrollRef } = usePreviewVirtualWindow({
        rowCount,
        rowHeight,
        restoreKey: `assistant-preview-resources:${view}`,
        overscanRows: 3,
        guardRows: 1
    })
    const previewMeta = useMemo(() => inlinePreview ? getContextFileMeta(inlinePreview) : null, [inlinePreview])

    useEffect(() => {
        setExplicitSelection((current) => {
            if (!current) return current
            if (current.activeFilePath !== normalizedActiveFilePath) return null
            return resources.some((resource) => resource.id === current.id) ? current : null
        })
    }, [normalizedActiveFilePath, resources])

    useEffect(() => {
        const root = rootRef.current
        if (!root || typeof ResizeObserver === 'undefined') return
        const updateWidth = () => setWidth(root.clientWidth)
        updateWidth()
        const observer = new ResizeObserver(updateWidth)
        observer.observe(root)
        return () => observer.disconnect()
    }, [])

    const openResource = useCallback(async (resource: AssistantResource) => {
        const previewOptions = { displayName: resource.title, openNavigator: true, revealNavigatorTarget: false }
        setOpeningResourceId(resource.id)
        setExplicitSelection({ id: resource.id, activeFilePath: normalizedActiveFilePath })
        setError(null)
        try {
            if (resource.url) {
                onOpenUrl(resource.url)
                return
            }
            if (resource.path && await openAssistantFileTarget({ target: resource.path, projectPath, openPreview: onOpenPreview, previewOptions })) return

            const attachmentPath = String(resource.attachment?.path || '').trim()
            if (isClipboardAttachmentReference(attachmentPath)) {
                const result = await window.devscope.assistant.resolveClipboardAttachment({ reference: attachmentPath })
                if (result.success && result.path && await openAssistantFileTarget({ target: result.path, projectPath, openPreview: onOpenPreview, previewOptions })) {
                    setExplicitSelection({ id: resource.id, activeFilePath: normalizedPath(result.path) })
                    return
                }
            } else if (attachmentPath && await openAssistantFileTarget({ target: attachmentPath, projectPath, openPreview: onOpenPreview, previewOptions })) {
                return
            }

            const preview = buildInlineImagePreview(resource)
            if (preview) {
                setInlinePreview(preview)
                return
            }
            setError('This resource is no longer available.')
        } catch (openError: unknown) {
            setExplicitSelection((current) => current?.id === resource.id ? null : current)
            setError(openError instanceof Error ? openError.message : 'Could not open this resource.')
        } finally {
            setOpeningResourceId(null)
        }
    }, [normalizedActiveFilePath, onOpenPreview, onOpenUrl, projectPath])

    const firstResourceIndex = range.start * columnCount
    const renderedResources = resources.slice(firstResourceIndex, Math.min(resources.length, range.end * columnCount))

    return (
        <section ref={rootRef} className="flex h-full min-h-0 flex-col bg-sparkle-card" aria-label="Chat resources">
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--surface-panel-divider)] px-2.5">
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-sparkle-text-secondary">Chat resources</span>
                <span className="font-mono text-[8px] text-sparkle-text-muted/50">{resources.length}</span>
                <span className="flex items-center border border-white/[0.07] bg-black/10">
                    <button type="button" aria-label="Show resource cards" aria-pressed={view === 'cards'} disabled={narrow} onClick={() => setPreferredView('cards')} className={cn('inline-flex size-6 items-center justify-center transition-colors', view === 'cards' ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-muted/55 hover:text-sparkle-text-secondary', narrow && 'cursor-not-allowed opacity-35')} title={narrow ? 'Cards need a wider sidebar' : 'Card view'}><LayoutGrid size={11} /></button>
                    <button type="button" aria-label="Show resources as a table" aria-pressed={view === 'table'} onClick={() => setPreferredView('table')} className={cn('inline-flex size-6 items-center justify-center transition-colors', view === 'table' ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-muted/55 hover:text-sparkle-text-secondary')} title="Table view"><List size={12} /></button>
                </span>
            </header>

            {error ? <button type="button" onClick={() => setError(null)} className="shrink-0 border-b border-red-500/15 bg-red-500/[0.06] px-2.5 py-1.5 text-left text-[9px] text-red-300" title="Dismiss">{error}</button> : null}

            <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-auto" style={{ overscrollBehavior: 'contain' }}>
                {resources.length === 0 ? (
                    <div className="flex h-full min-h-48 items-center justify-center px-5 text-center">
                        <div><ImageIcon size={18} className="mx-auto text-sparkle-text-muted/40" /><p className="mt-2 text-[10px] font-medium text-sparkle-text-secondary">No chat resources</p><p className="mt-1 text-[8px] leading-4 text-sparkle-text-muted/55">Images and links shared in this chat appear here.</p></div>
                    </div>
                ) : view === 'cards' ? (
                    <div className="relative p-1.5" style={{ height: rowCount * rowHeight }} role="list" aria-label="Resource cards">
                        <div className="absolute inset-x-1.5 grid grid-cols-2 gap-1.5" style={{ transform: `translateY(${range.start * rowHeight}px)` }}>
                            {renderedResources.map((resource) => {
                                const active = resource.id === currentResourceId
                                return (
                                    <button key={resource.id} type="button" role="listitem" aria-current={active ? 'true' : undefined} onClick={() => { void openResource(resource) }} className={cn('group/resource-card relative flex h-[118px] min-w-0 flex-col overflow-hidden border text-left transition-colors', active ? 'border-[var(--accent-primary)]/55 bg-[color-mix(in_srgb,var(--accent-primary)_8%,var(--color-bg))]' : 'border-white/[0.07] bg-black/10 hover:border-white/[0.14] hover:bg-white/[0.025]')} title={`${resource.title}\n${resourceLocation(resource)}`}>
                                        <span className="relative h-[78px] shrink-0 overflow-hidden border-b border-white/[0.055]"><ResourceVisual resource={resource} />{openingResourceId === resource.id ? <span className="absolute inset-0 flex items-center justify-center bg-black/55"><LoaderCircle size={13} className="animate-spin text-white/85" /></span> : null}</span>
                                        <span className="min-w-0 flex-1 px-1.5 py-1"><span className="block truncate text-[9px] font-medium text-sparkle-text-secondary">{resource.title}</span><span className="mt-0.5 block truncate font-mono text-[7px] text-sparkle-text-muted/50">{resource.kind} · turn {resource.latestTurnNumber}</span></span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ) : (
                    <div role="table" aria-label="Chat resources table" aria-colcount={3} aria-rowcount={resources.length + 1}>
                        <div className="sticky top-0 z-10 grid h-7 grid-cols-[32px_minmax(0,1fr)_38px] items-center gap-2 border-b border-white/[0.07] bg-sparkle-card px-2 text-[7px] font-semibold uppercase tracking-[0.06em] text-sparkle-text-muted/50" role="row" aria-rowindex={1}>
                            <span role="columnheader" />
                            <span role="columnheader">Resource</span>
                            <span className="text-right" role="columnheader">Type</span>
                        </div>
                        <div className="relative" style={{ height: rowCount * rowHeight }} role="rowgroup">
                            <div className="absolute inset-x-0" style={{ transform: `translateY(${range.start * rowHeight}px)` }}>
                                {renderedResources.map((resource, index) => {
                                    const host = resource.url ? resolveExternalMarkdownHost(resource.url) : null
                                    const active = resource.id === currentResourceId
                                    return (
                                        <button key={resource.id} type="button" role="row" aria-rowindex={firstResourceIndex + index + 2} aria-current={active ? 'true' : undefined} onClick={() => { void openResource(resource) }} className={cn('grid h-12 w-full grid-cols-[32px_minmax(0,1fr)_38px] items-center gap-2 border-b px-2 text-left transition-colors', active ? 'border-[var(--accent-primary)]/20 bg-[color-mix(in_srgb,var(--accent-primary)_8%,var(--color-bg))]' : 'border-white/[0.055] hover:bg-white/[0.025]')} title={resourceLocation(resource)}>
                                            <span className="relative flex size-7 items-center justify-center overflow-hidden border border-white/[0.07] bg-black/15" role="cell">{resource.kind === 'image' ? <ResourceImage resource={resource} /> : host ? <MarkdownSiteIcon host={host} className="inline-flex size-4" /> : <Globe2 size={14} className="text-sky-200/65" />}{openingResourceId === resource.id ? <span className="absolute inset-0 flex items-center justify-center bg-black/55"><LoaderCircle size={10} className="animate-spin text-white/85" /></span> : null}</span>
                                            <span className="min-w-0" role="cell"><span className="block truncate text-[9px] font-medium text-sparkle-text-secondary">{resource.title}</span><span className="mt-0.5 block truncate text-[7px] text-sparkle-text-muted/45">{assistantResourceCaption(resource)}</span></span>
                                            <span className="text-right text-[7px] font-medium uppercase text-sparkle-text-muted/50" role="cell">{resource.kind}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <AssistantAttachmentPreviewModal file={inlinePreview} meta={previewMeta} contentType={inlinePreview ? getContentTypeTag(inlinePreview) : ''} sizeLabel={inlinePreview ? toKbLabel(inlinePreview.sizeBytes) : ''} showFormattingWarning={false} readOnly onClose={() => { setInlinePreview(null); setExplicitSelection(null) }} />
        </section>
    )
}
