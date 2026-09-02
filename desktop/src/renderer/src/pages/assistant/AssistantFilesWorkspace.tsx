import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { AssistantChatScopeRoot } from '@shared/assistant/contracts'
import type { AssistantUtilityExplorerStateCapsule } from '@shared/assistant/utility-window'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import { useFilePreview, type UseFilePreviewReturn } from '@/components/ui/file-preview/useFilePreview'
import type { PreviewNavigationWorkspaceState } from '@/components/ui/file-preview/PreviewNavigationSidebar'
import type { FilePreviewPresentationState } from '@/components/ui/file-preview/modalTypes'
import { AssistantExplorerWorkspace } from './AssistantExplorerWorkspace'
import { captureAssistantUtilityScrollAnchor, restoreAssistantUtilityScrollAnchor } from './assistant-utility-state-capsules'
import { captureProductEvent } from '@/lib/product-analytics'

export const AssistantFilesWorkspace = memo(function AssistantFilesWorkspace({
    projectPath,
    projectRoots = [],
    active = true,
    stateCapsule,
    onStateCapsuleChange,
    publishNavigatorToAppTitleBar = false
}: {
    projectPath: string | null
    projectRoots?: AssistantChatScopeRoot[]
    active?: boolean
    stateCapsule?: AssistantUtilityExplorerStateCapsule
    onStateCapsuleChange?: (capsule: AssistantUtilityExplorerStateCapsule) => void
    publishNavigatorToAppTitleBar?: boolean
}) {
    const preview = useFilePreview()
    const roots = useMemo(() => {
        const scoped = projectRoots.filter((root, index, entries) => (
            root.path && entries.findIndex((candidate) => candidate.path === root.path) === index
        ))
        if (!projectPath || scoped.some((root) => root.path === projectPath)) return scoped
        return [{
            id: `compatibility:${projectPath}`,
            kind: 'associated-folder' as const,
            path: projectPath,
            label: projectPath.split(/[\\/]/).filter(Boolean).pop() || 'Working root',
            access: 'read-write' as const
        }, ...scoped]
    }, [projectPath, projectRoots])
    const [selectedRootPath, setSelectedRootPath] = useState(() => {
        const hydrated = String(stateCapsule?.rootPath || '').trim()
        return hydrated || projectPath || roots[0]?.path || ''
    })
    const activeProjectPath = roots.some((root) => root.path === selectedRootPath)
        ? selectedRootPath
        : projectPath || roots[0]?.path || null
    const activeRoot = roots.find((root) => root.path === activeProjectPath) || null
    const capsuleMatchesActiveRoot = !stateCapsule?.rootPath || stateCapsule.rootPath === activeProjectPath
    const modeOpenCapturedRef = useRef(false)
    const rootRef = useRef<HTMLElement | null>(null)
    const initialNavigationState = useMemo<PreviewNavigationWorkspaceState>(() => capsuleMatchesActiveRoot ? ({
        currentFolderPath: stateCapsule?.currentFolderPath,
        expandedPathKeys: stateCapsule?.expandedPaths,
        selectedPath: stateCapsule?.selectedPath
    }) : ({}), [capsuleMatchesActiveRoot, stateCapsule])
    const [navigationState, setNavigationState] = useState<PreviewNavigationWorkspaceState>(initialNavigationState)
    const [scrollAnchor, setScrollAnchor] = useState(stateCapsule?.scrollAnchor)
    const [previewPresentation, setPreviewPresentation] = useState<FilePreviewPresentationState | null>(() => (
        capsuleMatchesActiveRoot && stateCapsule?.activePreview ? {
            ...stateCapsule.activePreview,
            mode: stateCapsule.activePreview.mode || 'preview',
            expanded: stateCapsule.activePreview.expanded === true
        } : null
    ))
    const hydrationKey = useMemo(() => capsuleMatchesActiveRoot && stateCapsule ? JSON.stringify({
        root: stateCapsule.rootPath,
        folder: stateCapsule.currentFolderPath,
        expanded: stateCapsule.expandedPaths,
        selected: stateCapsule.selectedPath
    }) : 'default', [capsuleMatchesActiveRoot, stateCapsule])
    const hydratedPreviewPathRef = useRef<string | null>(null)
    const pendingHydrationRef = useRef(capsuleMatchesActiveRoot ? stateCapsule : undefined)
    const openPreviewRef = useRef(preview.openPreview)
    const openPreviewInNewTabRef = useRef(preview.openPreviewInNewTab)
    openPreviewRef.current = preview.openPreview
    openPreviewInNewTabRef.current = preview.openPreviewInNewTab

    useEffect(() => {
        if (!active) {
            modeOpenCapturedRef.current = false
            return
        }
        if (modeOpenCapturedRef.current) return
        modeOpenCapturedRef.current = true
        captureProductEvent({ event: 'zyra_v1_files', properties: { action: 'mode_open', outcome: 'completed' } })
    }, [active])

    const handleOpenPreview = useCallback<UseFilePreviewReturn['openPreview']>(
        (file, ext, options) => openPreviewRef.current(file, ext, options),
        []
    )
    const handleOpenPreviewInNewTab = useCallback<UseFilePreviewReturn['openPreviewInNewTab']>(
        (file, ext, options) => openPreviewInNewTabRef.current(file, ext, options),
        []
    )

    useEffect(() => {
        pendingHydrationRef.current = capsuleMatchesActiveRoot ? stateCapsule : undefined
        const requested = capsuleMatchesActiveRoot ? stateCapsule?.activePreview : undefined
        if (!requested || hydratedPreviewPathRef.current === requested.path || preview.previewFile?.path === requested.path) return
        hydratedPreviewPathRef.current = requested.path
        void preview.openPreview({ name: requested.name, path: requested.path }, requested.extension)
    }, [capsuleMatchesActiveRoot, preview.openPreview, preview.previewFile?.path, stateCapsule])

    useEffect(() => {
        restoreAssistantUtilityScrollAnchor(rootRef.current, capsuleMatchesActiveRoot ? stateCapsule?.scrollAnchor : undefined)
    }, [capsuleMatchesActiveRoot, stateCapsule])

    useEffect(() => {
        const pendingHydration = pendingHydrationRef.current
        if (pendingHydration) {
            const expandedPaths = navigationState.expandedPathKeys || []
            const requestedExpandedPaths = pendingHydration.expandedPaths || []
            const navigationReady = (!pendingHydration.currentFolderPath || navigationState.currentFolderPath === pendingHydration.currentFolderPath)
                && (!pendingHydration.selectedPath || navigationState.selectedPath === pendingHydration.selectedPath || preview.previewFile?.path === pendingHydration.selectedPath)
                && requestedExpandedPaths.every((path) => expandedPaths.includes(path))
            const previewReady = !pendingHydration.activePreview || preview.previewFile?.path === pendingHydration.activePreview.path
            if (!navigationReady || !previewReady) return
            pendingHydrationRef.current = undefined
        }
        const activePreview = preview.previewFile ? {
            name: preview.previewFile.name,
            path: preview.previewFile.path,
            extension: preview.previewFile.name.includes('.') ? preview.previewFile.name.split('.').pop()?.toLowerCase() || '' : '',
            ...(previewPresentation?.path === preview.previewFile.path ? {
                mode: previewPresentation.mode,
                expanded: previewPresentation.expanded
            } : {})
        } : undefined
        onStateCapsuleChange?.({
            version: 1,
            workspace: 'explorer',
            rootPath: activeProjectPath || undefined,
            currentFolderPath: navigationState.currentFolderPath,
            expandedPaths: navigationState.expandedPathKeys,
            selectedPath: activePreview?.path || navigationState.selectedPath,
            activePreview,
            scrollAnchor
        })
    }, [activeProjectPath, navigationState, onStateCapsuleChange, preview.previewFile, previewPresentation, scrollAnchor])

    useEffect(() => {
        if (!preview.previewFile) setPreviewPresentation(null)
    }, [preview.previewFile])

    return (
        <section
            ref={rootRef}
            onScrollCapture={(event) => {
                const anchor = captureAssistantUtilityScrollAnchor(event)
                if (anchor) setScrollAnchor(anchor)
            }}
            className="assistant-files-workspace relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--color-bg)_96%,black)]"
            aria-label="Files workspace"
        >
            {roots.length > 1 ? (
                <header className="flex h-9 shrink-0 items-center border-b border-white/[0.06] px-2">
                    <select
                        value={activeProjectPath || ''}
                        onChange={(event) => {
                            pendingHydrationRef.current = undefined
                            hydratedPreviewPathRef.current = null
                            setSelectedRootPath(event.target.value)
                            setNavigationState({})
                            setScrollAnchor(undefined)
                            setPreviewPresentation(null)
                            preview.closePreview()
                        }}
                        className="h-7 min-w-0 max-w-full rounded-md border border-[var(--surface-divider)] bg-[var(--surface-panel)] px-2 text-[10px] text-sparkle-text-secondary outline-none focus:border-[var(--accent-primary)]/45"
                        aria-label="Files root"
                    >
                        {roots.map((root) => (
                            <option key={root.id} value={root.path}>
                                {root.label}{root.access === 'read-only' ? ' · Read only' : ''}
                            </option>
                        ))}
                    </select>
                </header>
            ) : null}
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <AssistantExplorerWorkspace
                key={`${activeProjectPath || 'detached'}:${hydrationKey}`}
                projectPath={activeProjectPath}
                onOpenPreview={handleOpenPreview}
                onOpenPreviewInNewTab={handleOpenPreviewInNewTab}
                initialWorkspaceState={initialNavigationState}
                onWorkspaceStateChange={setNavigationState}
            />

            {preview.previewFile ? (
                <FilesPreviewBoundary resetKey={preview.previewFile.path} onClose={preview.closePreview}>
                    <FilePreviewModal
                        file={preview.previewFile}
                        previewTabs={preview.previewTabs}
                        activePreviewTabId={preview.activePreviewTabId}
                        content={preview.previewContent}
                        loading={preview.loadingPreview}
                        truncated={preview.previewTruncated}
                        size={preview.previewSize}
                        previewBytes={preview.previewBytes}
                        modifiedAt={preview.previewModifiedAt}
                        projectPath={activeProjectPath || undefined}
                        readOnly={activeRoot?.access === 'read-only'}
                        active={active}
                        chromeContext="workspace"
                        publishNavigatorToAppTitleBar={publishNavigatorToAppTitleBar}
                        initialPresentation={stateCapsule?.activePreview ? {
                            mode: stateCapsule.activePreview.mode || 'preview',
                            expanded: stateCapsule.activePreview.expanded === true
                        } : undefined}
                        onViewStateChange={setPreviewPresentation}
                        mediaItems={preview.previewMediaItems}
                        onOpenLinkedPreview={preview.openPreview}
                        onOpenLinkedPreviewInNewTab={preview.openPreviewInNewTab}
                        onSelectPreviewTab={preview.setActivePreviewTab}
                        onClosePreviewTab={preview.closePreviewTab}
                        onReorderPreviewTabs={preview.reorderPreviewTabs}
                        onClose={preview.closePreview}
                    />
                </FilesPreviewBoundary>
            ) : null}
            </div>
        </section>
    )
})

class FilesPreviewBoundary extends Component<{
    children: ReactNode
    resetKey: string
    onClose: () => void
}, {
    failed: boolean
}> {
    state = { failed: false }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    componentDidCatch(error: unknown) {
        console.error('Files preview failed:', error)
    }

    componentDidUpdate(previousProps: Readonly<{ children: ReactNode; resetKey: string; onClose: () => void }>) {
        if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
            this.setState({ failed: false })
        }
    }

    render() {
        if (!this.state.failed) return this.props.children
        return (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-8 text-center backdrop-blur-md">
                <div className="w-full max-w-72 rounded-xl border border-white/10 bg-sparkle-card p-6 shadow-2xl">
                    <TriangleAlert size={20} className="mx-auto text-amber-300/75" />
                    <p className="mt-3 text-[12px] font-medium text-sparkle-text-secondary">Could not open this preview</p>
                    <button
                        type="button"
                        onClick={this.props.onClose}
                        className="mt-3 h-7 rounded-md border border-[var(--surface-divider)] px-3 text-[10px] font-medium text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    >
                        Back to files
                    </button>
                </div>
            </div>
        )
    }
}
