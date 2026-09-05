import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DndContext,
    DragOverlay,
    closestCenter,
    pointerWithin,
} from '@dnd-kit/core'
import { createPortal } from 'react-dom'
import { getParentFolderPath } from '@/lib/filesystem/fileSystemPaths'
import { getAppearanceCodeFontStack, useSettings } from '@/lib/settings'
import { isEditableFileType, PREVIEW_TERMINAL_MIN_HEIGHT } from './file-preview/modalShared'
import type { FilePreviewModalProps } from './file-preview/modalTypes'
import type { PreviewMediaItem } from './file-preview/types'
import { PreviewModalLayout } from './file-preview/PreviewModalLayout'
import { PreviewPythonOutputPanel } from './file-preview/PreviewPythonOutputPanel'
import { PreviewTerminalPanel } from './file-preview/PreviewTerminalPanel'
import { useFilePreviewModalAnalysis } from './file-preview/useFilePreviewModalAnalysis'
import { useFilePreviewModalInteractions } from './file-preview/useFilePreviewModalInteractions'
import { useFilePreviewNavigationHistory } from './file-preview/useFilePreviewNavigationHistory'
import { useFilePreview } from './file-preview/useFilePreview'
import { useFilePreviewChrome } from './file-preview/useFilePreviewChrome'
import { useFilePreviewEditSession } from './file-preview/useFilePreviewEditSession'
import { useFilePreviewPython } from './file-preview/useFilePreviewPython'
import { useFilePreviewTerminal } from './file-preview/useFilePreviewTerminal'
import { usePreviewSiblingMediaItems } from './file-preview/usePreviewSiblingMediaItems'
import { readFilePreviewPanelPreferences, writeFilePreviewPanelPreferences } from './file-preview/filePreviewPanelPreferences'
import { resolveFilePreviewChromePolicy } from './file-preview/filePreviewChromePolicy'
import {
    FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT,
    publishFilePreviewFocusState
} from './file-preview/filePreviewFocusMode'

// Navigation history tracks media-list identity; a fresh fallback would retrigger it after every state update.
const EMPTY_PREVIEW_MEDIA_ITEMS: PreviewMediaItem[] = []

export function FilePreviewModal({
    file,
    previewTabs,
    activePreviewTabId,
    content,
    loading,
    truncated,
    size,
    previewBytes,
    modifiedAt,
    projectPath,
    readOnly = false,
    shellMode = 'modal',
    active = true,
    chromeContext,
    publishNavigatorToAppTitleBar = false,
    initialPresentation,
    onViewStateChange,
    onOpenLinkedPreview,
    onOpenLinkedPreviewInNewTab,
    onSelectPreviewTab,
    onClosePreviewTab,
    onReorderPreviewTabs,
    previewBody,
    mediaItems = EMPTY_PREVIEW_MEDIA_ITEMS,
    navigationSidebar,
    onSaved,
    onShowToast,
    onClose
}: FilePreviewModalProps) {
    const { settings, updateSettings } = useSettings()
    const chromePolicy = resolveFilePreviewChromePolicy(chromeContext)
    const isDirectory = file.type === 'directory'
    const isCsv = file.type === 'csv'
    const isHtml = file.type === 'html'
    const previewModeEnabled = file.type === 'md' || file.type === 'csv' || file.type === 'html'
    const canEdit = !readOnly && isEditableFileType(file.type)
    const defaultMode: 'preview' | 'edit' = !previewModeEnabled && canEdit
        ? 'edit'
        : canEdit ? settings.filePreviewDefaultMode : 'preview'
    const requestedInitialMode = initialPresentation?.mode
    const initialMode: 'preview' | 'edit' = requestedInitialMode === 'edit' && canEdit
        ? 'edit'
        : requestedInitialMode === 'preview' && previewModeEnabled
            ? 'preview'
            : (file.startInEditMode && canEdit) || (!previewModeEnabled && canEdit) ? 'edit' : defaultMode
    const defaultStartExpanded = chromePolicy.allowFullscreen
        ? initialPresentation?.expanded ?? settings.filePreviewOpenInFullscreen
        : false
    const navigatorRequested = file.openNavigator === true || isDirectory
    const hasNavigationSidebarOverride = navigationSidebar != null
    const navigatorInitiallyAvailable = hasNavigationSidebarOverride
        || chromePolicy.navigator === 'always'
        || (chromePolicy.navigator === 'requested' && navigatorRequested)
    const [windowedNavigatorEnabled, setWindowedNavigatorEnabled] = useState(navigatorInitiallyAvailable)
    const [handledNavigatorRevealRequests, setHandledNavigatorRevealRequests] = useState<ReadonlySet<string>>(() => new Set())
    const navigatorRevealRequestId = file.navigatorRevealRequestId
        && !handledNavigatorRevealRequests.has(file.navigatorRevealRequestId)
        ? file.navigatorRevealRequestId
        : null
    const handleNavigatorRevealHandled = useCallback((requestId: string) => {
        setHandledNavigatorRevealRequests((currentRequests) => {
            if (currentRequests.has(requestId)) return currentRequests
            const nextRequests = new Set(currentRequests)
            nextRequests.add(requestId)
            if (nextRequests.size > 64) {
                const oldestRequest = nextRequests.values().next().value
                if (typeof oldestRequest === 'string') nextRequests.delete(oldestRequest)
            }
            return nextRequests
        })
    }, [])
    const defaultLeftPanelOpen = navigatorInitiallyAvailable
        && (hasNavigationSidebarOverride || navigatorRequested || settings.filePreviewFullscreenShowLeftPanel)
    const defaultRightPanelOpen = initialMode === 'edit' && settings.filePreviewFullscreenShowRightPanel
    const canRunPython = !readOnly && file.type === 'code'
        && (file.language === 'python' || /\.py$/i.test(file.name) || /\.py$/i.test(file.path))
    const canUsePreviewTerminal = !readOnly && Boolean(projectPath || file.path)
    const resolvedPreviewTabs = useMemo(
        () => (previewTabs && previewTabs.length > 0 ? previewTabs : [{ id: file.path || file.name, file }]),
        [file, previewTabs]
    )
    const resolvedActivePreviewTabId = activePreviewTabId ?? resolvedPreviewTabs[0]?.id ?? null
    const createDestinationDirectory = useMemo(
        () => (isDirectory ? file.path : getParentFolderPath(file.path)) || projectPath || '',
        [file.path, isDirectory, projectPath]
    )
    const canCreateSiblingFile = Boolean(createDestinationDirectory && onOpenLinkedPreview)
    const effectiveMediaItems = usePreviewSiblingMediaItems({
        file,
        projectPath,
        mediaItems
    })
    const panelPreferences = useMemo(readFilePreviewPanelPreferences, [])
    const handlePanelWidthCommit = useCallback((side: 'left' | 'right', width: number) => {
        writeFilePreviewPanelPreferences(side === 'left' ? { leftWidth: width } : { rightWidth: width })
    }, [])
    const terminalInitialHeight = Math.max(
        PREVIEW_TERMINAL_MIN_HEIGHT,
        Math.min(720, Math.round(settings.filePreviewTerminalPanelHeight || 220))
    )

    const {
        mode,
        setMode,
        gitDiffText,
        gitDiffSummary,
        sourceContent,
        draftContent,
        setDraftContent,
        loadingEditableContent,
        isSaving,
        saveError,
        setSaveError,
        showUnsavedModal,
        conflictModifiedAt,
        setConflictModifiedAt,
        isDirty,
        dismissUnsavedChanges,
        discardUnsavedChanges,
        confirmUnsavedChanges,
        handleSave,
        ensureEditableContentLoaded,
        reloadFromDisk,
        overwriteOnConflict,
        requestIntent,
        requestExternalIntent,
        handleCloseRequest
    } = useFilePreviewEditSession({
        file,
        content,
        truncated,
        modifiedAt: modifiedAt ?? undefined,
        projectPath,
        canEdit,
        initialMode,
        onSaved,
        onClose
    })

    const {
        viewport,
        setViewport,
        isExpanded,
        setIsExpanded,
        leftPanelOpen,
        setLeftPanelOpen,
        rightPanelOpen,
        setRightPanelOpen,
        leftPanelWidth,
        rightPanelWidth,
        isResizingPanels,
        csvDistinctColorsEnabled,
        setCsvDistinctColorsEnabled,
        editorWordWrap,
        setEditorWordWrap,
        editorMinimapEnabled,
        setEditorMinimapEnabled,
        editorFontSize,
        setEditorFontSize,
        findRequestToken,
        setFindRequestToken,
        replaceRequestToken,
        setReplaceRequestToken,
        focusLine,
        setFocusLine,
        previewSurfaceRef,
        modalStyle,
        presetConfig
    } = useFilePreviewChrome({
        defaultStartExpanded,
        defaultLeftPanelOpen,
        defaultRightPanelOpen,
        defaultCsvDistinctColorsEnabled: settings.fileCsvDistinctColorsEnabled,
        defaultEditorWordWrap: settings.fileEditorWordWrap,
        defaultEditorMinimapEnabled: settings.fileEditorMinimapEnabled,
        defaultEditorFontSize: settings.fileEditorFontSize,
        initialLeftPanelWidth: panelPreferences.leftWidth,
        initialRightPanelWidth: panelPreferences.rightWidth,
        onPanelWidthCommit: handlePanelWidthCommit,
        initialFocusLine: file.focusLine ?? null,
        initialFocusLineRequestId: file.focusLineRequestId ?? null,
        active
    })
    const effectiveIsExpanded = chromePolicy.allowFullscreen ? isExpanded : false
    const ownsAppTitleBarNavigator = publishNavigatorToAppTitleBar && active && effectiveIsExpanded

    useEffect(() => {
        if (!ownsAppTitleBarNavigator) return
        const handleToggleNavigator = () => setLeftPanelOpen((current) => !current)
        window.addEventListener(FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT, handleToggleNavigator)
        return () => {
            window.removeEventListener(FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT, handleToggleNavigator)
            publishFilePreviewFocusState({ active: false, leftPanelOpen: false })
        }
    }, [ownsAppTitleBarNavigator, setLeftPanelOpen])

    useEffect(() => {
        if (!ownsAppTitleBarNavigator) return
        publishFilePreviewFocusState({ active: true, leftPanelOpen })
    }, [leftPanelOpen, ownsAppTitleBarNavigator])

    useEffect(() => {
        if (hasNavigationSidebarOverride) {
            setWindowedNavigatorEnabled(true)
            setLeftPanelOpen(true)
            return
        }
        if (chromePolicy.navigator === 'none') {
            setWindowedNavigatorEnabled(false)
            return
        }
        if (chromePolicy.navigator !== 'always' && !navigatorRequested) return
        setWindowedNavigatorEnabled(true)
        if (navigatorRequested) setLeftPanelOpen(true)
    }, [chromePolicy.navigator, hasNavigationSidebarOverride, navigatorRequested, setLeftPanelOpen])

    useEffect(() => {
        if (chromePolicy.allowFullscreen || !isExpanded) return
        setIsExpanded(false)
    }, [chromePolicy.allowFullscreen, isExpanded, setIsExpanded])

    const {
        setTerminalVisible,
        terminalSessions,
        terminalState,
        terminalPanelPhase,
        terminalGroupKey,
        terminalHeight,
        terminalError,
        terminalShellLabel,
        terminalNewShell,
        setTerminalNewShell,
        currentTerminalSession,
        terminalTheme,
        terminalHostRef,
        shouldShowTerminalPanel,
        renderTerminalPanel,
        queueTerminalCommand,
        clearTerminalOutput,
        focusTerminal,
        createPreviewTerminalSession,
        stopPreviewTerminalSession,
        selectPreviewTerminalSession,
        startTerminalResize
    } = useFilePreviewTerminal({
        canUsePreviewTerminal,
        file,
        projectPath,
        defaultShell: settings.defaultShell,
        accentColorPrimary: settings.accentColor.primary,
        themeKey: settings.theme,
        initialHeight: terminalInitialHeight,
        fontSize: settings.terminalFontSize,
        fontFamily: getAppearanceCodeFontStack(settings.appearanceCodeFont),
        cursorBlink: settings.terminalCursorBlink,
        scrollback: settings.terminalScrollback,
        persistHeight: (height) => {
            if (settings.filePreviewTerminalPanelHeight === height) return
            updateSettings({ filePreviewTerminalPanelHeight: height })
        }
    })

    const {
        pythonRunState,
        pythonRunMode,
        setPythonRunMode,
        pythonOutputEntries,
        pythonInterpreter,
        pythonCommand,
        pythonOutputVisible,
        pythonOutputHeight,
        pythonShowTimestamps,
        setPythonShowTimestamps,
        pythonOutputScrollRef,
        handleRunPython,
        stopPythonRun,
        clearPythonOutput,
        startPythonOutputResize
    } = useFilePreviewPython({
        canRunPython,
        file,
        projectPath,
        mode,
        isDirty,
        defaultRunMode: settings.filePreviewPythonRunMode,
        handleSave,
        queueTerminalCommand,
        defaultShell: settings.defaultShell
    })

    const {
        folderTreeRefreshToken,
        dndSensors,
        openMediaItem,
        handleInternalMarkdownLink,
        handleSelectPreviewTab,
        handleClosePreviewTab,
        handleOpenLinkedPreview,
        handleOpenLinkedPreviewInNewTab,
        handleOpenInBrowser,
        handleOpenCreateSiblingFileModal,
        handlePreviewDragStart,
        handlePreviewDragCancel,
        handlePreviewDragEnd,
        dragOverlay,
        createFileModal
    } = useFilePreviewModalInteractions({
        file,
        mediaItems: effectiveMediaItems,
        settingsTheme: settings.appearanceResolvedMode,
        resolvedActivePreviewTabId,
        createDestinationDirectory,
        canCreateSiblingFile,
        onOpenLinkedPreview,
        onOpenLinkedPreviewInNewTab,
        onSelectPreviewTab,
        onClosePreviewTab,
        onReorderPreviewTabs,
        requestExternalIntent
    })

    const {
        canNavigateBack,
        canNavigateForward,
        navigateBack,
        navigateForward
    } = useFilePreviewNavigationHistory({
        file,
        mediaItems: effectiveMediaItems,
        onNavigate: onOpenLinkedPreview,
        requestExternalIntent
    })

    useEffect(() => {
        if (!active || shellMode !== 'modal') return
        const originalOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = originalOverflow
        }
    }, [active, shellMode])

    useEffect(() => {
        const fileName = String(file.name || '')
        const dotIndex = fileName.lastIndexOf('.')
        onViewStateChange?.({
            name: fileName,
            path: file.path,
            extension: dotIndex > 0 && dotIndex < fileName.length - 1 ? fileName.slice(dotIndex + 1).toLowerCase() : '',
            mode,
            expanded: effectiveIsExpanded
        })
    }, [effectiveIsExpanded, file.name, file.path, mode, onViewStateChange])

    useEffect(() => {
        if (settings.filePreviewPythonRunMode === pythonRunMode) return
        updateSettings({ filePreviewPythonRunMode: pythonRunMode })
    }, [pythonRunMode, settings.filePreviewPythonRunMode, updateSettings])

    const handleModeChange = useCallback(async (nextMode: 'preview' | 'edit') => {
        if (nextMode === mode) return
        if (!previewModeEnabled && nextMode === 'preview') return
        if (nextMode === 'preview') {
            requestIntent('preview')
            return
        }
        if (!canEdit) return
        const loaded = await ensureEditableContentLoaded()
        if (!loaded) return
        setMode('edit')
    }, [canEdit, ensureEditableContentLoaded, mode, previewModeEnabled, requestIntent, setMode])

    useEffect(() => {
        if (!active) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e' && canEdit && previewModeEnabled) {
                event.preventDefault()
                void handleModeChange(mode === 'edit' ? 'preview' : 'edit')
                return
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && mode === 'edit') {
                event.preventDefault()
                void handleSave()
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                handleCloseRequest()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [active, canEdit, handleCloseRequest, handleModeChange, handleSave, mode, previewModeEnabled])


    const {
        totalFileLines,
        isCompactHtmlViewport,
        isHtmlRenderedPreview,
        previewResetKey,
        localDiffPreview,
        longLineCount,
        trailingWhitespaceCount,
        jsonDiagnostic,
        isEditorToolsEnabled
    } = useFilePreviewModalAnalysis({
        file,
        mode,
        isExpanded: effectiveIsExpanded,
        rightPanelOpen,
        viewport,
        presetWidth: presetConfig.width,
        sourceContent,
        draftContent,
        isDirty
    })
    const showPythonOutputPanel = canRunPython && (pythonOutputVisible || pythonRunState !== 'idle')
    const hasBottomPanel = showPythonOutputPanel
    const centerHtmlRenderedPreview = isHtmlRenderedPreview && !hasBottomPanel
    const flushResponsiveHtmlPreview = isHtmlRenderedPreview && viewport === 'responsive' && !effectiveIsExpanded

    const pythonOutputPanel = showPythonOutputPanel ? (
        <PreviewPythonOutputPanel fileName={file.name} visible={showPythonOutputPanel} runState={pythonRunState} interpreter={pythonInterpreter} command={pythonCommand} entries={pythonOutputEntries} height={pythonOutputHeight} showTimestamps={pythonShowTimestamps} scrollRef={pythonOutputScrollRef} onResizeStart={startPythonOutputResize} onToggleTimestamps={() => setPythonShowTimestamps((current) => !current)} onClear={clearPythonOutput} />
    ) : null

    const terminalPanel = renderTerminalPanel ? (
        <PreviewTerminalPanel
            render={renderTerminalPanel}
            phase={terminalPanelPhase}
            height={terminalHeight}
            state={terminalState}
            shellLabel={terminalShellLabel}
            sessions={terminalSessions}
            groupKey={terminalGroupKey}
            currentSession={currentTerminalSession}
            themeBackground={terminalTheme.background}
            hostRef={terminalHostRef}
            onHostInteract={focusTerminal}
            error={terminalError}
            onResizeStart={startTerminalResize}
            newShell={terminalNewShell}
            onNewShellChange={setTerminalNewShell}
            onNew={(shell) => { void createPreviewTerminalSession(shell) }}
            onClear={clearTerminalOutput}
            onStop={(sessionId) => { void stopPreviewTerminalSession(sessionId) }}
            onMinimize={() => setTerminalVisible(false)}
            onSelect={selectPreviewTerminalSession}
        />
    ) : null
    const previewBottomOverlayPadding = 0

    const modalContent = (
        <PreviewModalLayout
            file={file}
            shellMode={shellMode}
            loading={loading}
            truncated={truncated}
            size={size ?? undefined}
            previewBytes={previewBytes ?? undefined}
            projectPath={projectPath}
            mediaItems={effectiveMediaItems}
            navigationSidebar={navigationSidebar}
            openMediaItem={openMediaItem}
            onInternalLinkClick={handleInternalMarkdownLink}
            onLinkNotice={onShowToast}
            mode={mode}
            canNavigateBack={canNavigateBack}
            canNavigateForward={canNavigateForward}
            onNavigateBack={navigateBack}
            onNavigateForward={navigateForward}
            isExpanded={effectiveIsExpanded}
            allowExpanded={chromePolicy.allowFullscreen}
            showHistoryNavigation={chromePolicy.history === 'always' || (chromePolicy.history === 'available' && (canNavigateBack || canNavigateForward))}
            showPreviewTabs={chromePolicy.showTabs}
            showLeftPanelToggle={!ownsAppTitleBarNavigator}
            windowedNavigatorEnabled={windowedNavigatorEnabled}
            canEdit={canEdit}
            isDirty={isDirty}
            isSaving={isSaving}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            leftPanelWidth={leftPanelWidth}
            rightPanelWidth={rightPanelWidth}
            isResizingPanels={isResizingPanels}
            setFindRequestToken={setFindRequestToken}
            setReplaceRequestToken={setReplaceRequestToken}
            findRequestToken={findRequestToken}
            replaceRequestToken={replaceRequestToken}
            editorWordWrap={editorWordWrap}
            setEditorWordWrap={setEditorWordWrap}
            editorMinimapEnabled={editorMinimapEnabled}
            setEditorMinimapEnabled={setEditorMinimapEnabled}
            editorFontSize={editorFontSize}
            setEditorFontSize={setEditorFontSize}
            focusLine={focusLine}
            saveError={saveError}
            sourceContent={sourceContent}
            draftContent={draftContent}
            onDraftContentChange={(nextValue) => {
                setDraftContent(nextValue)
                if (saveError) setSaveError(null)
            }}
            loadingEditableContent={loadingEditableContent}
            viewport={viewport}
            setViewport={setViewport}
            csvDistinctColorsEnabled={csvDistinctColorsEnabled}
            setCsvDistinctColorsEnabled={setCsvDistinctColorsEnabled}
            pythonRunState={pythonRunState}
            pythonRunMode={pythonRunMode}
            pythonHasOutput={pythonOutputEntries.length > 0}
            setPythonRunMode={setPythonRunMode}
            canRunPython={canRunPython}
            onRunPython={handleRunPython}
            onStopPython={stopPythonRun}
            onClearPythonOutput={clearPythonOutput}
            onOpenInBrowser={handleOpenInBrowser}
            gitDiffText={gitDiffText}
            gitDiffSummary={gitDiffSummary}
            liveDiffPreview={localDiffPreview}
            totalFileLines={totalFileLines}
            handleModeChange={handleModeChange}
            handleSave={handleSave}
            handleRevert={() => { setDraftContent(sourceContent); setSaveError(null) }}
            handleCloseRequest={handleCloseRequest}
            setIsExpanded={setIsExpanded}
            setLeftPanelOpen={setLeftPanelOpen}
            setRightPanelOpen={setRightPanelOpen}
            modalStyle={modalStyle}
            previewSurfaceRef={previewSurfaceRef}
            previewResetKey={previewResetKey}
            lineMarkersOverride={localDiffPreview?.markers}
            presetConfig={presetConfig}
            isCsv={isCsv}
            isHtml={isHtml}
            isCompactHtmlViewport={isCompactHtmlViewport}
            centerHtmlRenderedPreview={centerHtmlRenderedPreview}
            flushResponsiveHtmlPreview={flushResponsiveHtmlPreview}
            hasBottomPanel={hasBottomPanel}
            onOpenLinkedPreview={handleOpenLinkedPreview}
            onOpenLinkedPreviewInNewTab={handleOpenLinkedPreviewInNewTab}
            folderTreeRefreshToken={folderTreeRefreshToken}
            navigatorRevealRequestId={navigatorRevealRequestId}
            onNavigatorRevealHandled={handleNavigatorRevealHandled}
            previewTabs={resolvedPreviewTabs}
            activePreviewTabId={resolvedActivePreviewTabId}
            onSelectPreviewTab={handleSelectPreviewTab}
            onClosePreviewTab={handleClosePreviewTab}
            canCreateSiblingFile={canCreateSiblingFile}
            onCreateSiblingFile={handleOpenCreateSiblingFileModal}
            longLineCount={longLineCount}
            trailingWhitespaceCount={trailingWhitespaceCount}
            jsonDiagnostic={jsonDiagnostic}
            isEditorToolsEnabled={isEditorToolsEnabled}
            pythonPanel={pythonOutputPanel}
            previewBody={previewBody}
            previewBottomOverlay={terminalPanel}
            previewBottomOverlayPadding={previewBottomOverlayPadding}
            showUnsavedModal={showUnsavedModal}
            conflictModifiedAt={conflictModifiedAt}
            previewModeEnabled={previewModeEnabled}
            dismissUnsaved={dismissUnsavedChanges}
            discardUnsaved={discardUnsavedChanges}
            confirmUnsaved={confirmUnsavedChanges}
            dismissConflict={() => setConflictModifiedAt(null)}
            reloadConflict={async () => { if (await reloadFromDisk()) setConflictModifiedAt(null) }}
            overwriteConflict={async () => { if (await overwriteOnConflict()) setConflictModifiedAt(null) }}
        />
    )

    const modalWithDnd = (
        <DndContext
            sensors={dndSensors}
            collisionDetection={(args) => {
                const pointerCollisions = pointerWithin(args)
                if (pointerCollisions.length > 0) return pointerCollisions
                return closestCenter(args)
            }}
            onDragStart={handlePreviewDragStart}
            onDragCancel={handlePreviewDragCancel}
            onDragEnd={handlePreviewDragEnd}
        >
            {modalContent}
            <DragOverlay zIndex={240}>
                {dragOverlay}
            </DragOverlay>
        </DndContext>
    )

    if (!active) return null

    if (shellMode === 'window' || typeof document === 'undefined') {
        return (
            <>
                {modalWithDnd}
                {createFileModal}
            </>
        )
    }

    return createPortal(
        <>
            {modalWithDnd}
            {createFileModal}
        </>,
        document.body
    )
}

export { useFilePreview }

export default FilePreviewModal
