import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { GitDiffSummary, GitLineMarker } from './gitDiff'
import type { PreviewFile, PreviewMediaItem, PreviewOpenOptions, PreviewTab } from './types'
import { VIEWPORT_PRESETS, type ViewportPreset } from './viewport'

export type PreviewModalLayoutProps = {
    file: PreviewFile
    shellMode?: 'modal' | 'window'
    loading?: boolean
    truncated?: boolean
    size?: number
    previewBytes?: number
    projectPath?: string
    mediaItems: PreviewMediaItem[]
    navigationSidebar?: ReactNode
    openMediaItem: (item: PreviewMediaItem) => Promise<void>
    onInternalLinkClick: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    mode: 'preview' | 'edit'
    canNavigateBack: boolean
    canNavigateForward: boolean
    onNavigateBack: () => void
    onNavigateForward: () => void
    isExpanded: boolean
    allowExpanded: boolean
    showHistoryNavigation: boolean
    showPreviewTabs: boolean
    showLeftPanelToggle: boolean
    windowedNavigatorEnabled: boolean
    canEdit: boolean
    isDirty: boolean
    isSaving: boolean
    leftPanelOpen: boolean
    rightPanelOpen: boolean
    leftPanelWidth: number
    rightPanelWidth: number
    isResizingPanels: boolean
    setFindRequestToken: Dispatch<SetStateAction<number>>
    setReplaceRequestToken: Dispatch<SetStateAction<number>>
    findRequestToken: number
    replaceRequestToken: number
    editorWordWrap: 'on' | 'off'
    setEditorWordWrap: Dispatch<SetStateAction<'on' | 'off'>>
    editorMinimapEnabled: boolean
    setEditorMinimapEnabled: Dispatch<SetStateAction<boolean>>
    editorFontSize: number
    setEditorFontSize: Dispatch<SetStateAction<number>>
    focusLine: number | null
    saveError: string | null
    sourceContent: string
    draftContent: string
    onDraftContentChange: (value: string) => void
    loadingEditableContent: boolean
    viewport: ViewportPreset
    setViewport: Dispatch<SetStateAction<ViewportPreset>>
    csvDistinctColorsEnabled: boolean
    setCsvDistinctColorsEnabled: Dispatch<SetStateAction<boolean>>
    pythonRunState: 'idle' | 'running' | 'success' | 'failed' | 'stopped'
    pythonRunMode: 'terminal' | 'output'
    pythonHasOutput: boolean
    setPythonRunMode: Dispatch<SetStateAction<'terminal' | 'output'>>
    canRunPython: boolean
    onRunPython: () => Promise<void>
    onStopPython: () => Promise<boolean>
    onClearPythonOutput: () => void
    onOpenInBrowser: () => Promise<void>
    gitDiffText: string
    gitDiffSummary: GitDiffSummary | null
    liveDiffPreview?: {
        additions: number
        deletions: number
    } | null
    totalFileLines: number
    handleModeChange: (nextMode: 'preview' | 'edit') => Promise<void>
    handleSave: () => Promise<boolean>
    handleRevert?: () => void
    handleCloseRequest: () => void
    setIsExpanded: Dispatch<SetStateAction<boolean>>
    setLeftPanelOpen: Dispatch<SetStateAction<boolean>>
    setRightPanelOpen: Dispatch<SetStateAction<boolean>>
    modalStyle: CSSProperties
    previewSurfaceRef: RefObject<HTMLDivElement | null>
    previewResetKey: string
    lineMarkersOverride: GitLineMarker[] | undefined
    presetConfig: (typeof VIEWPORT_PRESETS)[ViewportPreset]
    isCsv: boolean
    isHtml: boolean
    isCompactHtmlViewport: boolean
    centerHtmlRenderedPreview: boolean
    flushResponsiveHtmlPreview: boolean
    hasBottomPanel: boolean
    onOpenLinkedPreview?: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onOpenLinkedPreviewInNewTab?: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    folderTreeRefreshToken?: number
    navigatorRevealRequestId?: string | null
    onNavigatorRevealHandled?: (requestId: string) => void
    previewTabs: PreviewTab[]
    activePreviewTabId: string | null
    onSelectPreviewTab: (tabId: string) => void
    onClosePreviewTab: (tabId: string) => void
    canCreateSiblingFile?: boolean
    onCreateSiblingFile?: () => void
    longLineCount: number
    trailingWhitespaceCount: number
    jsonDiagnostic: { ok: boolean; message: string } | null
    isEditorToolsEnabled: boolean
    pythonPanel: ReactNode
    previewBody?: ReactNode
    previewBottomOverlay?: ReactNode
    previewBottomOverlayPadding?: number
    previewModeEnabled: boolean
    showUnsavedModal: boolean
    conflictModifiedAt: number | null
    dismissUnsaved: () => void
    discardUnsaved: () => void
    confirmUnsaved: () => Promise<void>
    dismissConflict: () => void
    reloadConflict: () => Promise<void>
    overwriteConflict: () => Promise<void>
}
