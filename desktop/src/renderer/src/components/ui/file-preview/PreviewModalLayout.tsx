import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { cn } from '@/lib/utils'
import PreviewBody from './PreviewBody'
import PreviewErrorBoundary from './PreviewErrorBoundary'
import PreviewModalHeader from './PreviewModalHeader'
import { PreviewModalDialogs } from './PreviewModalDialogs'
import { PreviewExpandedWorkspace } from './PreviewExpandedWorkspace'
import { PreviewExpandedPreviewArea } from './PreviewExpandedPreviewArea'
import type { PreviewModalLayoutProps } from './previewModalLayout.types'
import { PreviewTreeSkeleton } from './PreviewLoadingSkeleton'
import { resolveMarkdownSourceLineAtViewport } from './markdownPreviewModeLocation'

const PreviewNavigationSidebar = lazy(async () => ({
    default: (await import('./PreviewNavigationSidebar')).PreviewNavigationSidebar
}))
const PreviewContextSidebar = lazy(async () => ({
    default: (await import('./PreviewContextSidebar')).PreviewContextSidebar
}))

function PreviewSidebarFallback({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-sparkle-bg" aria-label={label}>
            <PreviewTreeSkeleton compact />
        </div>
    )
}

export function PreviewModalLayout(props: PreviewModalLayoutProps) {
    const markdownScrollContainerRef = useRef<HTMLDivElement | null>(null)
    const pendingMarkdownModeLocationRef = useRef<{ filePath: string; targetMode: 'preview' | 'edit'; sourceLine: number } | null>(null)
    const activeFilePathRef = useRef(props.file.path)
    const [previewEditor, setPreviewEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const handlePreviewEditorMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor | null) => {
        setPreviewEditor(editor)
        if (!editor) return
        const pendingLocation = pendingMarkdownModeLocationRef.current
        if (pendingLocation?.filePath !== props.file.path || pendingLocation.targetMode !== 'edit') return
        pendingMarkdownModeLocationRef.current = null
        const lineNumber = Math.min(Math.max(1, pendingLocation.sourceLine), editor.getModel()?.getLineCount() || pendingLocation.sourceLine)
        editor.revealLineNearTop(lineNumber)
        editor.setPosition({ lineNumber, column: 1 })
    }, [props.file.path])
    const {
        file,
        shellMode = 'modal',
        loading,
        truncated,
        size,
        previewBytes,
        projectPath,
        mediaItems,
        navigationSidebar: navigationSidebarOverride,
        openMediaItem,
        onInternalLinkClick,
        onLinkNotice,
        mode,
        canNavigateBack,
        canNavigateForward,
        onNavigateBack,
        onNavigateForward,
        isExpanded,
        allowExpanded,
        showHistoryNavigation,
        showPreviewTabs,
        showLeftPanelToggle,
        windowedNavigatorEnabled,
        canEdit,
        isDirty,
        isSaving,
        leftPanelOpen,
        rightPanelOpen,
        leftPanelWidth,
        rightPanelWidth,
        isResizingPanels,
        setFindRequestToken,
        setReplaceRequestToken,
        findRequestToken,
        replaceRequestToken,
        editorWordWrap,
        setEditorWordWrap,
        editorMinimapEnabled,
        setEditorMinimapEnabled,
        editorFontSize,
        setEditorFontSize,
        focusLine,
        saveError,
        sourceContent,
        draftContent,
        onDraftContentChange,
        loadingEditableContent,
        viewport,
        setViewport,
        csvDistinctColorsEnabled,
        setCsvDistinctColorsEnabled,
        pythonRunState,
        pythonRunMode,
        pythonHasOutput,
        setPythonRunMode,
        canRunPython,
        onRunPython,
        onStopPython,
        onClearPythonOutput,
        onOpenInBrowser,
        gitDiffText,
        gitDiffSummary,
        handleModeChange: commitModeChange,
        handleSave,
        handleRevert,
        handleCloseRequest,
        setIsExpanded,
        setLeftPanelOpen,
        setRightPanelOpen,
        modalStyle,
        previewSurfaceRef,
        previewResetKey,
        lineMarkersOverride,
        presetConfig,
        isCsv,
        isHtml,
        isCompactHtmlViewport,
        centerHtmlRenderedPreview,
        flushResponsiveHtmlPreview,
        hasBottomPanel,
        onOpenLinkedPreview,
        onOpenLinkedPreviewInNewTab,
        folderTreeRefreshToken = 0,
        navigatorRevealRequestId = null,
        onNavigatorRevealHandled,
        previewTabs,
        activePreviewTabId,
        onSelectPreviewTab,
        onClosePreviewTab,
        canCreateSiblingFile = false,
        onCreateSiblingFile,
        longLineCount,
        trailingWhitespaceCount,
        jsonDiagnostic,
        isEditorToolsEnabled,
        pythonPanel,
        previewBody,
        previewBottomOverlay,
        previewBottomOverlayPadding = 0,
        previewModeEnabled,
        showUnsavedModal,
        conflictModifiedAt,
        dismissUnsaved,
        discardUnsaved,
        confirmUnsaved,
        dismissConflict,
        reloadConflict,
        overwriteConflict
    } = props

    useLayoutEffect(() => {
        if (activeFilePathRef.current === file.path) return
        activeFilePathRef.current = file.path
        pendingMarkdownModeLocationRef.current = null
        setPreviewEditor(null)
    }, [file.path])

    const handleModeChange = useCallback(async (nextMode: 'preview' | 'edit') => {
        if (nextMode !== mode && file.type === 'md') {
            if (mode === 'preview' && nextMode === 'edit') {
                const scrollContainer = markdownScrollContainerRef.current
                const markdownRoot = scrollContainer?.querySelector<HTMLElement>('[data-zyra-diagnostic-surface="markdown-preview"]')
                if (scrollContainer && markdownRoot) {
                    const viewportTop = scrollContainer.getBoundingClientRect().top
                    const sourceLine = resolveMarkdownSourceLineAtViewport({
                        content: sourceContent,
                        viewportTop,
                        documentTop: markdownRoot.getBoundingClientRect().top,
                        documentBottom: markdownRoot.getBoundingClientRect().bottom,
                        headingPositions: Array.from(markdownRoot.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')).map((heading) => ({
                            id: heading.id,
                            top: heading.getBoundingClientRect().top
                        }))
                    })
                    pendingMarkdownModeLocationRef.current = { filePath: file.path, targetMode: 'edit', sourceLine }
                }
            } else if (mode === 'edit' && nextMode === 'preview') {
                const sourceLine = previewEditor?.getVisibleRanges()[0]?.startLineNumber
                    || previewEditor?.getPosition()?.lineNumber
                    || 1
                pendingMarkdownModeLocationRef.current = { filePath: file.path, targetMode: 'preview', sourceLine }
            }
        }
        await commitModeChange(nextMode)
    }, [commitModeChange, file.path, file.type, mode, previewEditor, sourceContent])

    const markdownInitialSourceLine = pendingMarkdownModeLocationRef.current?.filePath === file.path
        && pendingMarkdownModeLocationRef.current.targetMode === 'preview'
        ? pendingMarkdownModeLocationRef.current.sourceLine
        : null

    const handleToggleExpanded = useCallback(() => {
        if (!allowExpanded) return
        setIsExpanded((current) => !current)
    }, [allowExpanded, setIsExpanded])

    const isDirectory = file.type === 'directory'
    const isOfficeFile = file.type === 'docx' || file.type === 'xlsx' || file.type === 'pptx'
    const isMediaFile = file.type === 'image' || file.type === 'video' || file.type === 'audio' || file.type === 'pdf' || isOfficeFile
    const previewSurfaceBackgroundClass = file.type === 'md' && mode === 'preview'
        ? 'bg-sparkle-card'
        : 'bg-sparkle-bg'
    const lockPreviewBodyHeight = Boolean(previewBody)
        || mode === 'edit'
        || isCsv
        || isHtml
        || hasBottomPanel
    const shouldStretchPreviewBody = lockPreviewBodyHeight || isMediaFile || isDirectory

    const isWindowShell = shellMode === 'window'

    function renderPreviewBody(fillEditorHeight: boolean) {
        if (previewBody) {
            return (
                <div className="h-full min-h-0" data-file-preview-custom-body="true">
                    {previewBody}
                </div>
            )
        }
        return (
            <PreviewErrorBoundary resetKey={previewResetKey}>
                <PreviewBody
                    file={file}
                    content={sourceContent}
                    loading={loading}
                    meta={{ truncated, size, previewBytes }}
                    projectPath={projectPath}
                    onInternalLinkClick={onInternalLinkClick}
                    onLinkNotice={onLinkNotice}
                    gitDiffText={gitDiffText}
                    viewport={viewport}
                    presetConfig={presetConfig}
                    csvDistinctColorsEnabled={csvDistinctColorsEnabled}
                    mode={mode}
                    editableContent={draftContent}
                    onEditableContentChange={onDraftContentChange}
                    isEditable={canEdit}
                    loadingEditableContent={loadingEditableContent}
                    editorWordWrap={editorWordWrap}
                    editorMinimapEnabled={editorMinimapEnabled}
                    editorFontSize={editorFontSize}
                    findRequestToken={findRequestToken}
                    replaceRequestToken={replaceRequestToken}
                    focusLine={focusLine}
                    onEditorMount={handlePreviewEditorMount}
                    fillEditorHeight={fillEditorHeight}
                    lineMarkersOverride={lineMarkersOverride}
                    previewFocusLine={focusLine}
                    isExpanded={isExpanded}
                    mediaItems={mediaItems}
                    onSelectMedia={openMediaItem}
                    scrollContainerRef={markdownScrollContainerRef}
                    markdownInitialSourceLine={markdownInitialSourceLine}
                />
            </PreviewErrorBoundary>
        )
    }

    const previewHeaderNode = (
        <PreviewModalHeader
            file={file}
            showCloseButton={!isWindowShell}
            previewModeEnabled={previewModeEnabled}
            mode={mode}
            canNavigateBack={canNavigateBack}
            canNavigateForward={canNavigateForward}
            onNavigateBack={onNavigateBack}
            onNavigateForward={onNavigateForward}
            isEditable={canEdit}
            isDirty={isDirty}
            isSaving={isSaving}
            isExpanded={isExpanded}
            allowExpanded={allowExpanded}
            showHistoryNavigation={showHistoryNavigation}
            showPreviewTabs={showPreviewTabs}
            showLeftPanelToggle={showLeftPanelToggle}
            windowedNavigatorEnabled={windowedNavigatorEnabled}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            loadingEditableContent={loadingEditableContent}
            viewport={viewport}
            csvDistinctColorsEnabled={csvDistinctColorsEnabled}
            pythonRunState={pythonRunState}
            pythonHasOutput={pythonHasOutput}
            pythonRunMode={pythonRunMode}
            onClose={handleCloseRequest}
            onToggleExpanded={handleToggleExpanded}
            onToggleLeftPanel={() => setLeftPanelOpen((current) => !current)}
            onToggleRightPanel={() => setRightPanelOpen((current) => !current)}
            onModeChange={handleModeChange}
            onSave={handleSave}
            onRevert={handleRevert ?? (() => undefined)}
            onViewportChange={setViewport}
            onCsvDistinctColorsEnabledChange={setCsvDistinctColorsEnabled}
            canRunPython={canRunPython}
            onPythonRunModeChange={setPythonRunMode}
            onRunPython={onRunPython}
            onStopPython={onStopPython}
            onClearPythonOutput={onClearPythonOutput}
            onOpenInBrowser={onOpenInBrowser}
            previewTabs={previewTabs}
            activePreviewTabId={activePreviewTabId}
            onSelectPreviewTab={onSelectPreviewTab}
            onClosePreviewTab={onClosePreviewTab}
            canCreateSiblingFile={canCreateSiblingFile}
            onCreateSiblingFile={onCreateSiblingFile}
            setFindRequestToken={setFindRequestToken}
            setReplaceRequestToken={setReplaceRequestToken}
            isEditorToolsEnabled={isEditorToolsEnabled}
            editorWordWrap={editorWordWrap}
            setEditorWordWrap={setEditorWordWrap}
            editorMinimapEnabled={editorMinimapEnabled}
            setEditorMinimapEnabled={setEditorMinimapEnabled}
            editorFontSize={editorFontSize}
            setEditorFontSize={setEditorFontSize}
        />
    )

    const expandedPreviewArea = (
        <PreviewExpandedPreviewArea
            previewSurfaceRef={previewSurfaceRef}
            centerHtmlRenderedPreview={centerHtmlRenderedPreview}
            isCompactHtmlViewport={isCompactHtmlViewport}
            overflowLocked={Boolean(previewBody) || mode === 'edit' || isCsv || isHtml || hasBottomPanel}
            surfaceBackgroundClass={previewSurfaceBackgroundClass}
            shouldStretchPreviewBody={shouldStretchPreviewBody}
            hasBottomPanel={hasBottomPanel}
            mode={mode}
            previewContent={renderPreviewBody(true)}
            bottomOverlay={previewBottomOverlay}
            bottomOverlayPadding={previewBottomOverlayPadding}
            scrollContainerRef={markdownScrollContainerRef}
        />
    )

    const expandedRightInspector = rightPanelOpen ? (
        <Suspense fallback={<PreviewSidebarFallback label="Loading inspector…" />}>
            <PreviewContextSidebar
                filePath={file.path}
                fileType={file.type}
                language={file.language}
                content={mode === 'edit' ? draftContent : sourceContent}
                gitDiffSummary={gitDiffSummary}
                mode={mode}
                isDirty={isDirty}
                trailingWhitespaceCount={trailingWhitespaceCount}
                longLineCount={longLineCount}
                jsonDiagnostic={jsonDiagnostic}
                editor={previewEditor}
            />
        </Suspense>
    ) : null

    const fileNavigationSidebar = (
        <Suspense fallback={<PreviewSidebarFallback label="Loading navigator…" />}>
            <PreviewNavigationSidebar
                file={file}
                projectPath={projectPath}
                onOpenLinkedPreview={onOpenLinkedPreview}
                onOpenLinkedPreviewInNewTab={onOpenLinkedPreviewInNewTab}
                refreshToken={folderTreeRefreshToken}
                revealTargetRequestId={navigatorRevealRequestId}
                onRevealTargetHandled={onNavigatorRevealHandled}
                variant="sidebar"
            />
        </Suspense>
    )
    const navigationSidebar = navigationSidebarOverride ?? fileNavigationSidebar

    const modalContent = (
        <div
            className={cn(
                'flex transition-[background-color,padding,backdrop-filter] duration-320 ease-[cubic-bezier(0.16,1,0.3,1)]',
                isWindowShell
                    ? 'min-h-0 flex-1 items-stretch justify-stretch bg-sparkle-bg'
                    : isExpanded
                        ? 'fixed left-0 right-0 bottom-0 top-[34px] z-[45] items-stretch justify-stretch bg-sparkle-bg'
                        : 'fixed inset-0 z-[80] items-center justify-center bg-black/70 backdrop-blur-md'
            )}
            data-preview-expanded={isExpanded ? 'true' : 'false'}
            data-zyra-native-view-occluder={isWindowShell ? undefined : 'true'}
            onClick={!isWindowShell && !isExpanded ? handleCloseRequest : undefined}
            style={!isWindowShell && !isExpanded ? { animation: 'fadeIn 0.18s ease-out' } : undefined}
            onWheel={(event) => event.stopPropagation()}
        >
            <div
                className={cn(
                    'flex flex-col overflow-hidden',
                    isWindowShell
                        ? 'min-h-0 w-full flex-1 bg-sparkle-card'
                        : 'will-change-[opacity,width,height,max-width,max-height,border-radius,margin,box-shadow,border-color] transition-[width,max-width,height,max-height,border-radius,margin,box-shadow,border-color,opacity] duration-320 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    !isWindowShell && (
                        isExpanded
                            ? 'bg-sparkle-card h-full w-full max-h-none max-w-none opacity-100 m-0 rounded-none border-0 shadow-none'
                            : isMediaFile
                                ? 'bg-sparkle-card m-4 h-[min(86vh,860px)] w-[min(90vw,1220px)] rounded-2xl border border-white/10 opacity-100 shadow-2xl'
                                : 'bg-sparkle-card m-4 w-full max-h-[90vh] max-w-[95vw] rounded-2xl border border-white/10 opacity-100 shadow-2xl'
                    )
                )}
                onClick={!isWindowShell && !isExpanded ? (event => event.stopPropagation()) : undefined}
                style={isWindowShell ? undefined : modalStyle}
            >
                {!isExpanded ? previewHeaderNode : null}
                {!isExpanded && saveError ? <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">{saveError}</div> : null}

                {isExpanded ? (
                    <PreviewExpandedWorkspace
                        header={previewHeaderNode}
                        saveError={saveError}
                        leftPanelOpen={leftPanelOpen}
                        leftPanelWidth={leftPanelWidth}
                        rightPanelOpen={rightPanelOpen}
                        rightPanelWidth={rightPanelWidth}
                        isResizingPanels={isResizingPanels}
                        leftSidebar={navigationSidebar}
                        previewArea={expandedPreviewArea}
                        rightInspector={expandedRightInspector}
                    />
                ) : (
                    <div className="flex min-h-0 min-w-0 flex-1">
                        {windowedNavigatorEnabled ? (
                            <aside
                                className={cn(
                                    'relative flex shrink-0 flex-col overflow-hidden border-r transition-[width,opacity,transform,border-color] ease-out',
                                    isResizingPanels ? 'duration-0' : 'duration-200',
                                    leftPanelOpen
                                        ? 'translate-x-0 border-white/[0.06] bg-sparkle-card opacity-100'
                                        : 'pointer-events-none -translate-x-2 border-transparent opacity-0'
                                )}
                                style={{ width: leftPanelOpen ? `${leftPanelWidth}px` : '0px' }}
                            >
                                {navigationSidebar}
                                <div
                                    data-preview-resize-side="left"
                                    role="separator"
                                    aria-orientation="vertical"
                                    aria-label="Resize file navigator"
                                    tabIndex={0}
                                    className={cn(
                                        'group absolute -right-1 top-0 z-30 h-full w-3 cursor-col-resize bg-transparent transition-colors',
                                        leftPanelOpen ? 'hover:bg-white/[0.03]' : 'pointer-events-none'
                                    )}
                                    title="Resize file navigator"
                                >
                                    <div
                                        data-preview-resize-side="left"
                                        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-[var(--accent-primary)]/45"
                                    />
                                </div>
                            </aside>
                        ) : null}
                        <div ref={previewSurfaceRef} className="group/preview relative min-h-0 min-w-0 flex-1">
                            <div
                                ref={hasBottomPanel && mode !== 'edit' ? undefined : markdownScrollContainerRef}
                                className={cn(
                                    'h-full w-full custom-scrollbar flex items-stretch justify-center',
                                    previewSurfaceBackgroundClass,
                                    isMediaFile || isDirectory || mode === 'edit'
                                        ? 'p-0'
                                        : flushResponsiveHtmlPreview
                                            ? 'p-0'
                                            : (isCompactHtmlViewport ? 'p-2 sm:p-3' : 'p-4'),
                                    mode === 'edit' || isCsv || isHtml || hasBottomPanel || isMediaFile || isDirectory
                                        ? 'overflow-hidden'
                                        : 'overflow-auto'
                                )}
                                style={{ overscrollBehavior: 'contain' }}
                            >
                                <div
                                    className={cn('w-full flex flex-col', shouldStretchPreviewBody ? 'h-full min-h-0' : 'min-h-full')}
                                    style={{ paddingBottom: previewBottomOverlay && previewBottomOverlayPadding > 0 ? `${previewBottomOverlayPadding}px` : undefined }}
                                >
                                    <div ref={hasBottomPanel && mode !== 'edit' ? markdownScrollContainerRef : undefined} className={cn(shouldStretchPreviewBody && 'min-h-0', hasBottomPanel ? 'flex-1' : (shouldStretchPreviewBody ? 'h-full' : ''), hasBottomPanel && mode !== 'edit' ? 'overflow-auto custom-scrollbar' : '', centerHtmlRenderedPreview ? 'flex items-center justify-center' : '')}>
                                        {renderPreviewBody(false)}
                                    </div>
                                </div>
                            </div>
                            {previewBottomOverlay ? (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 m-0 flex items-end p-0">
                                    <div className="pointer-events-auto m-0 w-full p-0">
                                        {previewBottomOverlay}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
                {pythonPanel}
            </div>
            <PreviewModalDialogs
                fileName={file.name}
                showUnsavedModal={showUnsavedModal}
                conflictModifiedAt={conflictModifiedAt}
                onCloseUnsaved={dismissUnsaved}
                onDiscardUnsaved={discardUnsaved}
                onSaveUnsaved={confirmUnsaved}
                onCloseConflict={dismissConflict}
                onReloadConflict={reloadConflict}
                onOverwriteConflict={overwriteConflict}
            />
        </div>
    )

    return modalContent
}
