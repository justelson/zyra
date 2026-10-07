import { useCallback, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { PreviewFile, PreviewMediaItem, PreviewMediaSource, PreviewOpenOptions, PreviewTab } from './types'
import { readPreviewContentCache, writePreviewContentCache, type PreviewContentSnapshot } from './preview-content-cache'
import { isMediaPreviewType, resolvePreviewType } from './utils'
import { captureProductEvent } from '@/lib/product-analytics'

export interface UseFilePreviewReturn {
    previewTabs: PreviewTab[]
    activePreviewTabId: string | null
    previewFile: PreviewFile | null
    previewMediaItems: PreviewMediaItem[]
    previewContent: string
    loadingPreview: boolean
    previewTruncated: boolean
    previewSize: number | null
    previewBytes: number | null
    previewModifiedAt: number | null
    openPreview: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void>
    openPreviewInNewTab: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void>
    setActivePreviewTab: (tabId: string) => void
    closePreviewTab: (tabId: string) => void
    reorderPreviewTabs: (activeTabId: string, overTabId: string | null) => void
    closePreview: () => void
    openFile: (filePath: string) => Promise<void>
}

type PreviewTabState = PreviewTab & {
    mediaItems: PreviewMediaItem[]
    content: string
    loading: boolean
    truncated: boolean
    size: number | null
    previewBytes: number | null
    modifiedAt: number | null
    requestId: number
}

const sharedPreviewContentCache = new Map<string, PreviewContentSnapshot>()
const previewContentRequests = new Map<string, Promise<PreviewContentSnapshot>>()
let previewNavigatorRevealSequence = 0

function normalizePreviewRequestKey(filePath: string): string {
    const normalized = String(filePath || '').trim().replace(/\\/g, '/')
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
        ? normalized.toLowerCase()
        : normalized
}

function createPreviewTabId(): string {
    return `preview-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createPreviewNavigatorRevealRequestId(): string {
    previewNavigatorRevealSequence += 1
    return `preview-navigator-reveal-${Date.now()}-${previewNavigatorRevealSequence}`
}

function normalizePreviewContent(content: unknown): string {
    if (typeof content === 'string') return content
    if (content == null) return ''
    if (typeof content === 'number' || typeof content === 'boolean' || typeof content === 'bigint') {
        return String(content)
    }
    try {
        return JSON.stringify(content, null, 2)
    } catch {
        return String(content)
    }
}

export function preloadPreviewRenderer(type: PreviewFile['type']): void {
    void preparePreviewRenderer(type).catch(() => undefined)
}

async function preparePreviewRenderer(type: PreviewFile['type']): Promise<void> {
    if (type === 'md') (await import('./FileMarkdownPreview')).warmFileMarkdownPreview()
    else if (type === 'csv') await import('./CsvPreviewTable')
    else if (type === 'code' || type === 'text' || type === 'json') await import('./MonacoPreviewEditor')
}

async function loadPreviewContentSnapshot(filePath: string): Promise<PreviewContentSnapshot> {
    const requestKey = normalizePreviewRequestKey(filePath)
    const existingRequest = previewContentRequests.get(requestKey)
    if (existingRequest) return existingRequest

    const request = (async () => {
        const cached = readPreviewContentCache(sharedPreviewContentCache, filePath)
        const response = await window.devscope.readFileContent(filePath, cached ? {
            knownSize: cached.size,
            knownModifiedAt: cached.modifiedAt
        } : undefined)
        if (!response.success) throw new Error(response.error || 'Failed to load file.')
        if (response.notModified && cached) return cached

        const snapshot: PreviewContentSnapshot = {
            content: normalizePreviewContent(response.content),
            truncated: Boolean(response.truncated),
            size: typeof response.size === 'number' ? response.size : null,
            previewBytes: typeof response.previewBytes === 'number' ? response.previewBytes : null,
            modifiedAt: typeof response.modifiedAt === 'number' ? response.modifiedAt : null
        }
        writePreviewContentCache(sharedPreviewContentCache, filePath, snapshot)
        return snapshot
    })().finally(() => {
        if (previewContentRequests.get(requestKey) === request) previewContentRequests.delete(requestKey)
    })
    previewContentRequests.set(requestKey, request)
    return request
}

export function prefetchPreviewFile(file: { name: string; path: string }, ext: string): void {
    const previewTarget = resolvePreviewType(file.name, ext)
    if (!previewTarget) return
    preloadPreviewRenderer(previewTarget.type)
    if (!previewTarget.needsContent || typeof window === 'undefined' || !window.devscope) return
    if (readPreviewContentCache(sharedPreviewContentCache, file.path)) return
    void loadPreviewContentSnapshot(file.path).catch(() => undefined)
}

function normalizeMediaItems(items?: PreviewMediaSource[]): PreviewMediaItem[] {
    if (!items?.length) return []

    const deduped = new Map<string, PreviewMediaItem>()
    for (const item of items) {
        const name = String(item?.name || '').trim()
        const path = String(item?.path || '').trim()
        const extension = String(item?.extension || '').trim().toLowerCase()
        if (!name || !path) continue

        const previewTarget = resolvePreviewType(name, extension)
        if (!previewTarget || !isMediaPreviewType(previewTarget.type)) continue

        const dedupeKey = path.toLowerCase()
        if (deduped.has(dedupeKey)) continue

        deduped.set(dedupeKey, {
            name,
            path,
            extension,
            thumbnailPath: item.thumbnailPath ?? null,
            type: previewTarget.type
        })
    }

    return Array.from(deduped.values())
}

export function useFilePreview(): UseFilePreviewReturn {
    const [previewTabsState, commitPreviewTabsState] = useState<PreviewTabState[]>([])
    const previewTabsRef = useRef<PreviewTabState[]>([])
    const setPreviewTabsState = useCallback((update: SetStateAction<PreviewTabState[]>) => {
        const next = typeof update === 'function' ? update(previewTabsRef.current) : update
        previewTabsRef.current = next
        commitPreviewTabsState(next)
    }, [])
    const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null)
    const [openingRequestId, setOpeningRequestId] = useState<number | null>(null)
    const activePreviewRequestIdRef = useRef(0)
    const previewRequestByTabRef = useRef(new Map<string, number>())
    const focusLineRequestIdRef = useRef(0)
    const pendingOpenIdRef = useRef(0)
    const previewCloseGenerationRef = useRef(0)
    const activePreviewTab = useMemo(
        () => previewTabsState.find((tab) => tab.id === activePreviewTabId) || null,
        [activePreviewTabId, previewTabsState]
    )
    const previewTabs = useMemo(
        () => previewTabsState.map(({ id, file }) => ({ id, file })),
        [previewTabsState]
    )

    const openFile = async (filePath: string) => {
        try {
            const res = await window.devscope.openFile(filePath)
            if (!res.success) {
                console.error('Failed to open file:', res.error)
            }
        } catch (err) {
            console.error('Failed to open file:', err)
        }
    }

    const updatePreviewTab = (tabId: string, updater: (tab: PreviewTabState) => PreviewTabState) => {
        setPreviewTabsState((currentTabs) => currentTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
    }

    const loadPreviewTabContent = async (tabId: string, file: { name: string; path: string }, ext: string) => {
        const previewTarget = resolvePreviewType(file.name, ext)
        if (!previewTarget || !previewTarget.needsContent) return
        const startedAt = performance.now()

        const requestId = activePreviewRequestIdRef.current + 1
        activePreviewRequestIdRef.current = requestId
        previewRequestByTabRef.current.set(tabId, requestId)
        const cached = readPreviewContentCache(sharedPreviewContentCache, file.path)

        updatePreviewTab(tabId, (tab) => ({
            ...tab,
            loading: !cached,
            content: cached?.content || '',
            truncated: cached?.truncated || false,
            size: cached?.size ?? null,
            previewBytes: cached?.previewBytes ?? null,
            modifiedAt: cached?.modifiedAt ?? null,
            requestId
        }))

        try {
            const snapshot = await loadPreviewContentSnapshot(file.path)
            if (previewRequestByTabRef.current.get(tabId) !== requestId) return
            previewRequestByTabRef.current.delete(tabId)
            setPreviewTabsState((currentTabs) => currentTabs.map((tab) => (
                tab.id === tabId && tab.requestId === requestId
                    ? { ...tab, ...snapshot, loading: false }
                    : tab
            )))
            captureProductEvent({
                event: 'zyra_v1_files',
                properties: {
                    action: 'preview',
                    outcome: 'completed',
                    preview_kind: analyticsPreviewKind(previewTarget.type),
                    size_bucket: analyticsSizeBucket(snapshot.size),
                    duration_ms: performance.now() - startedAt
                }
            })
        } catch (err) {
            if (previewRequestByTabRef.current.get(tabId) !== requestId) return
            previewRequestByTabRef.current.delete(tabId)
            captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'preview', outcome: 'failed', preview_kind: analyticsPreviewKind(previewTarget.type), duration_ms: performance.now() - startedAt, error_code: 'unknown' } })
            console.error('Failed to load file:', err)
            setPreviewTabsState((currentTabs) => currentTabs.map((tab) => (
                tab.id === tabId && tab.requestId === requestId
                    ? { ...tab, loading: false }
                    : tab
            )))
        }
    }

    const openPreviewWithMode = async (
        file: { name: string; path: string },
        ext: string,
        options: PreviewOpenOptions | undefined,
        mode: 'replace' | 'new-tab'
    ) => {
        const previewTarget = options?.targetKind === 'directory'
            ? { type: 'directory' as const, needsContent: false }
            : resolvePreviewType(file.name, ext)

        if (!previewTarget) {
            void openFile(file.path)
            return
        }
        preloadPreviewRenderer(previewTarget.type)
        const startedAt = performance.now()
        const openingId = ++pendingOpenIdRef.current
        const closeGeneration = previewCloseGenerationRef.current
        const cached = previewTarget.needsContent ? readPreviewContentCache(sharedPreviewContentCache, file.path) : null
        let openingSnapshot = cached
        let readError: string | undefined
        if (previewTarget.needsContent && !cached) {
            setOpeningRequestId(openingId)
            // Read and prepare the renderer together, then publish a complete tab.
            // Keep the current file visible until the replacement is ready.
            try {
                const [snapshot] = await Promise.all([loadPreviewContentSnapshot(file.path), preparePreviewRenderer(previewTarget.type)])
                openingSnapshot = snapshot
            } catch (error) {
                readError = error instanceof Error ? error.message : 'Could not open this file.'
            }
            setOpeningRequestId(current => current === openingId ? null : current)
            if (previewCloseGenerationRef.current !== closeGeneration || (mode === 'replace' && pendingOpenIdRef.current !== openingId)) return
            captureProductEvent({ event: 'zyra_v1_files', properties: {
                action: 'preview', outcome: readError ? 'failed' : 'completed',
                preview_kind: analyticsPreviewKind(previewTarget.type),
                size_bucket: analyticsSizeBucket(openingSnapshot?.size ?? null),
                duration_ms: performance.now() - startedAt,
                ...(readError ? { error_code: 'unknown' as const } : {})
            } })
        }
        const captureContentlessPreview = () => {
            if (!previewTarget.needsContent) {
                captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'preview', outcome: 'completed', preview_kind: analyticsPreviewKind(previewTarget.type), size_bucket: 'unknown' } })
            }
        }

        const requestedFocusLine = typeof options?.focusLine === 'number' && options.focusLine > 0
            ? Math.floor(options.focusLine)
            : null
        const focusLineRequestId = requestedFocusLine
            ? focusLineRequestIdRef.current + 1
            : null
        if (focusLineRequestId) {
            focusLineRequestIdRef.current = focusLineRequestId
        }

        const nextFile: PreviewFile = {
            name: file.name,
            displayName: options?.displayName,
            path: file.path,
            type: previewTarget.type,
            language: 'language' in previewTarget ? previewTarget.language : undefined,
            readError,
            startInEditMode: options?.startInEditMode === true,
            focusLine: requestedFocusLine,
            focusLineRequestId,
            htmlLocation: previewTarget.type === 'html' && options?.htmlLocation ? { ...options.htmlLocation } : undefined,
            openNavigator: options?.openNavigator === true || previewTarget.type === 'directory',
            navigatorRevealRequestId: options?.revealNavigatorTarget === true
                ? createPreviewNavigatorRevealRequestId()
                : null
        }
        const nextMediaItems = normalizeMediaItems(options?.mediaItems)
        const normalizeTabPath = (path: string) => /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') ? path.replace(/\\/g, '/').toLowerCase() : path
        const existingTab = previewTabsRef.current.find((tab) => normalizeTabPath(tab.file.path) === normalizeTabPath(file.path)) || null

        if (existingTab) {
            updatePreviewTab(existingTab.id, (tab) => ({
                ...tab,
                ...(!cached && openingSnapshot ? openingSnapshot : {}),
                file: nextFile,
                mediaItems: nextMediaItems
            }))
            if (pendingOpenIdRef.current === openingId) setActivePreviewTabId(existingTab.id)
            if (previewTarget.needsContent && cached && !existingTab.loading && !readError) {
                await loadPreviewTabContent(existingTab.id, file, ext)
            }
            captureContentlessPreview()
            return
        }

        let targetTabId: string
        const shouldLoad = previewTarget.needsContent && Boolean(cached)

        if (mode === 'replace' && activePreviewTabId) {
            targetTabId = activePreviewTabId
            previewRequestByTabRef.current.delete(targetTabId)
            setPreviewTabsState((currentTabs) => currentTabs.map((tab) => (
                tab.id === activePreviewTabId
                    ? {
                        ...tab,
                        file: nextFile,
                        mediaItems: nextMediaItems,
                        content: openingSnapshot?.content ?? '',
                        loading: false,
                        truncated: openingSnapshot?.truncated ?? false,
                        size: openingSnapshot?.size ?? null,
                        previewBytes: openingSnapshot?.previewBytes ?? null,
                        modifiedAt: openingSnapshot?.modifiedAt ?? null,
                        requestId: 0
                    }
                    : tab
            )))
        } else {
            targetTabId = createPreviewTabId()
            const nextTab: PreviewTabState = {
                id: targetTabId,
                file: nextFile,
                mediaItems: nextMediaItems,
                content: openingSnapshot?.content ?? '',
                loading: false,
                truncated: openingSnapshot?.truncated ?? false,
                size: openingSnapshot?.size ?? null,
                previewBytes: openingSnapshot?.previewBytes ?? null,
                modifiedAt: openingSnapshot?.modifiedAt ?? null,
                requestId: 0
            }
            setPreviewTabsState((currentTabs) => {
                if (mode === 'new-tab' && activePreviewTabId) {
                    const activeIndex = currentTabs.findIndex((tab) => tab.id === activePreviewTabId)
                    if (activeIndex >= 0) {
                        const nextTabs = [...currentTabs]
                        nextTabs.splice(activeIndex + 1, 0, nextTab)
                        return nextTabs
                    }
                }
                return [...currentTabs, nextTab]
            })
        }

        if (pendingOpenIdRef.current === openingId) setActivePreviewTabId(targetTabId)
        captureContentlessPreview()

        if (shouldLoad) {
            await loadPreviewTabContent(targetTabId, file, ext)
        }
    }

    const openPreview = async (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => openPreviewWithMode(file, ext, options, 'replace')

    const openPreviewInNewTab = async (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => openPreviewWithMode(file, ext, options, 'new-tab')

    const setActivePreviewTab = useCallback((tabId: string) => {
        pendingOpenIdRef.current += 1
        setActivePreviewTabId((currentActiveTabId) => {
            if (!previewTabsState.some((tab) => tab.id === tabId)) return currentActiveTabId
            return tabId
        })
    }, [previewTabsState])

    const closePreviewTab = useCallback((tabId: string) => {
        previewCloseGenerationRef.current += 1
        previewRequestByTabRef.current.delete(tabId)
        setPreviewTabsState((currentTabs) => {
            const targetIndex = currentTabs.findIndex((tab) => tab.id === tabId)
            if (targetIndex < 0) return currentTabs
            const nextTabs = currentTabs.filter((tab) => tab.id !== tabId)
            setActivePreviewTabId((currentActiveTabId) => {
                if (currentActiveTabId !== tabId) return currentActiveTabId
                const nextActiveTab = nextTabs[targetIndex] || nextTabs[targetIndex - 1] || null
                return nextActiveTab?.id || null
            })
            return nextTabs
        })
    }, [])

    const reorderPreviewTabs = useCallback((dragTabId: string, overTabId: string | null) => {
        if (!overTabId || dragTabId === overTabId) return
        setPreviewTabsState((currentTabs) => {
            const activeIndex = currentTabs.findIndex((tab) => tab.id === dragTabId)
            const overIndex = currentTabs.findIndex((tab) => tab.id === overTabId)
            if (activeIndex < 0 || overIndex < 0) return currentTabs
            const nextTabs = [...currentTabs]
            const [movedTab] = nextTabs.splice(activeIndex, 1)
            nextTabs.splice(overIndex, 0, movedTab)
            return nextTabs
        })
    }, [])

    const closePreview = () => {
        previewCloseGenerationRef.current += 1
        pendingOpenIdRef.current += 1
        setOpeningRequestId(null)
        activePreviewRequestIdRef.current += 1
        previewRequestByTabRef.current.clear()
        setPreviewTabsState([])
        setActivePreviewTabId(null)
    }

    return {
        previewTabs,
        activePreviewTabId,
        previewFile: activePreviewTab?.file || null,
        previewMediaItems: activePreviewTab?.mediaItems || [],
        previewContent: activePreviewTab?.content || '',
        loadingPreview: activePreviewTab?.loading || (!activePreviewTab && openingRequestId !== null),
        previewTruncated: activePreviewTab?.truncated || false,
        previewSize: activePreviewTab?.size ?? null,
        previewBytes: activePreviewTab?.previewBytes ?? null,
        previewModifiedAt: activePreviewTab?.modifiedAt ?? null,
        openPreview,
        openPreviewInNewTab,
        setActivePreviewTab,
        closePreviewTab,
        reorderPreviewTabs,
        closePreview,
        openFile
    }
}

function analyticsPreviewKind(value: PreviewFile['type']): 'text' | 'code' | 'markdown' | 'image' | 'pdf' | 'office' | 'table' | 'audio' | 'video' | 'binary' | 'unknown' {
    if (value === 'text' || value === 'html') return 'text'
    if (value === 'code' || value === 'json') return 'code'
    if (value === 'md') return 'markdown'
    if (value === 'image') return 'image'
    if (value === 'pdf') return 'pdf'
    if (value === 'docx' || value === 'xlsx' || value === 'pptx') return 'office'
    if (value === 'csv') return 'table'
    if (value === 'audio') return 'audio'
    if (value === 'video') return 'video'
    return value === 'directory' ? 'unknown' : 'binary'
}

function analyticsSizeBucket(value: number | null): 'tiny' | 'small' | 'medium' | 'large' | 'very_large' | 'unknown' {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unknown'
    if (value < 16 * 1024) return 'tiny'
    if (value < 256 * 1024) return 'small'
    if (value < 2 * 1024 * 1024) return 'medium'
    if (value < 20 * 1024 * 1024) return 'large'
    return 'very_large'
}
