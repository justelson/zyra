import { Check, Copy, Expand, PanelLeftClose, PanelLeftOpen, Save, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { PreviewAppMenu, PreviewWindowControls } from './PreviewWindowChrome'
import { cn } from '@/lib/utils'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { useSettings } from '@/lib/settings'
import type { PreviewFile, PreviewTab } from './types'
import type { ViewportPreset } from './viewport'
import { PreviewExpandedHeaderBar } from './PreviewExpandedHeaderBar'
import { PreviewHeaderEditMenu } from './PreviewHeaderEditMenu'
import { PreviewHeaderStatusActions } from './PreviewHeaderStatusActions'
import { PreviewHeaderHtmlControls } from './PreviewHeaderHtmlControls'
import { PreviewHistoryNavigation } from './PreviewHistoryNavigation'
import { PreviewTabStrip } from './PreviewTabStrip'
import { usePreviewPathCopy } from './usePreviewPathCopy'

interface PreviewModalHeaderProps {
    file: PreviewFile
    showCloseButton?: boolean
    previewModeEnabled: boolean
    mode: 'preview' | 'edit'
    canNavigateBack: boolean
    canNavigateForward: boolean
    onNavigateBack: () => void
    onNavigateForward: () => void
    isEditable: boolean
    isDirty: boolean
    isSaving: boolean
    isExpanded: boolean
    allowExpanded: boolean
    showHistoryNavigation: boolean
    showPreviewTabs: boolean
    showLeftPanelToggle: boolean
    windowedNavigatorEnabled: boolean
    leftPanelOpen: boolean
    rightPanelOpen: boolean
    loadingEditableContent?: boolean
    onModeChange: (mode: 'preview' | 'edit') => void
    onSave: () => void
    onRevert: () => void
    onToggleExpanded: () => void
    onToggleLeftPanel: () => void
    onToggleRightPanel: () => void
    viewport: ViewportPreset
    onViewportChange: (viewport: ViewportPreset) => void
    csvDistinctColorsEnabled: boolean
    onCsvDistinctColorsEnabledChange: (enabled: boolean) => void
    onOpenInBrowser: () => void
    onClose: () => void
    previewTabs: PreviewTab[]
    activePreviewTabId: string | null
    onSelectPreviewTab: (tabId: string) => void
    onClosePreviewTab: (tabId: string) => void
    canCreateSiblingFile?: boolean
    onCreateSiblingFile?: () => void
    setFindRequestToken: Dispatch<SetStateAction<number>>
    setReplaceRequestToken: Dispatch<SetStateAction<number>>
    isEditorToolsEnabled: boolean
    editorWordWrap: 'on' | 'off'
    setEditorWordWrap: Dispatch<SetStateAction<'on' | 'off'>>
    editorMinimapEnabled: boolean
    setEditorMinimapEnabled: Dispatch<SetStateAction<boolean>>
    editorFontSize: number
    setEditorFontSize: Dispatch<SetStateAction<number>>
}

function formatPreviewFileName(name: string, maxLength: number): string {
    const raw = String(name || '').trim()
    if (!raw || raw.length <= maxLength) return raw

    const dotIndex = raw.lastIndexOf('.')
    const hasExtension = dotIndex > 0 && dotIndex < raw.length - 1
    const extension = hasExtension ? raw.slice(dotIndex) : ''
    const baseName = hasExtension ? raw.slice(0, dotIndex) : raw
    const budget = Math.max(8, maxLength - extension.length - 3)
    const startLength = Math.max(4, Math.ceil(budget * 0.6))
    const endLength = Math.max(3, budget - startLength)

    if (baseName.length <= startLength + endLength + 3) return raw
    return `${baseName.slice(0, startLength)}...${baseName.slice(-endLength)}${extension}`
}

export default function PreviewModalHeader(props: PreviewModalHeaderProps) {
    if (props.isExpanded) {
        return (
            <PreviewExpandedHeaderBar
                file={props.file}
                showCloseButton={props.showCloseButton}
                previewModeEnabled={props.previewModeEnabled}
                mode={props.mode}
                canNavigateBack={props.canNavigateBack}
                canNavigateForward={props.canNavigateForward}
                onNavigateBack={props.onNavigateBack}
                onNavigateForward={props.onNavigateForward}
                isEditable={props.isEditable}
                isDirty={props.isDirty}
                isSaving={props.isSaving}
                showHistoryNavigation={props.showHistoryNavigation}
                showPreviewTabs={props.showPreviewTabs}
                showLeftPanelToggle={props.showLeftPanelToggle}
                leftPanelOpen={props.leftPanelOpen}
                rightPanelOpen={props.rightPanelOpen}
                loadingEditableContent={props.loadingEditableContent}
                viewport={props.viewport}
                onViewportChange={props.onViewportChange}
                csvDistinctColorsEnabled={props.csvDistinctColorsEnabled}
                onCsvDistinctColorsEnabledChange={props.onCsvDistinctColorsEnabledChange}
                onOpenInBrowser={props.onOpenInBrowser}
                onClose={props.onClose}
                onModeChange={props.onModeChange}
                onSave={props.onSave}
                onRevert={props.onRevert}
                onToggleExpanded={props.onToggleExpanded}
                onToggleLeftPanel={props.onToggleLeftPanel}
                onToggleRightPanel={props.onToggleRightPanel}
                previewTabs={props.previewTabs}
                activePreviewTabId={props.activePreviewTabId}
                onSelectPreviewTab={props.onSelectPreviewTab}
                onClosePreviewTab={props.onClosePreviewTab}
                setFindRequestToken={props.setFindRequestToken}
                setReplaceRequestToken={props.setReplaceRequestToken}
                isEditorToolsEnabled={props.isEditorToolsEnabled}
                editorWordWrap={props.editorWordWrap}
                setEditorWordWrap={props.setEditorWordWrap}
                editorMinimapEnabled={props.editorMinimapEnabled}
                setEditorMinimapEnabled={props.setEditorMinimapEnabled}
                editorFontSize={props.editorFontSize}
                setEditorFontSize={props.setEditorFontSize}
            />
        )
    }

    return <PreviewWindowedHeader {...props} />
}

function PreviewWindowedHeader({
    file,
    showCloseButton = true,
    previewModeEnabled,
    mode,
    canNavigateBack,
    canNavigateForward,
    onNavigateBack,
    onNavigateForward,
    isEditable,
    isDirty,
    isSaving,
    allowExpanded,
    showHistoryNavigation,
    showPreviewTabs,
    windowedNavigatorEnabled,
    leftPanelOpen,
    onToggleLeftPanel,
    loadingEditableContent,
    onModeChange,
    onSave,
    onRevert,
    onToggleExpanded,
    viewport,
    onViewportChange,
    csvDistinctColorsEnabled,
    onCsvDistinctColorsEnabledChange,
    onOpenInBrowser,
    onClose,
    previewTabs,
    activePreviewTabId,
    onSelectPreviewTab,
    onClosePreviewTab
}: PreviewModalHeaderProps) {
    const { settings } = useSettings()
    const { runtime } = useWindowChrome()
    const isQuickPreviewWindow = !showCloseButton
    const iconTheme = settings.appearanceResolvedMode
    const isHtml = file.type === 'html'
    const isCsv = file.type === 'csv'
    const isEditMode = mode === 'edit'
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [headerWidth, setHeaderWidth] = useState(1280)
    const { copied, copyFailed, copyPath } = usePreviewPathCopy(file.path)

    useEffect(() => {
        const node = containerRef.current
        if (!node) return
        const updateWidth = () => setHeaderWidth(node.clientWidth || 1280)
        updateWidth()
        const observer = new ResizeObserver(updateWidth)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const isCompactHtmlHeader = isHtml && headerWidth < 1024
    const isVeryCompactHtmlHeader = isHtml && headerWidth < 820
    const isUltraCompactHtmlHeader = isHtml && headerWidth < 680
    const visibleFileName = formatPreviewFileName(file.displayName || file.name, headerWidth < 760 ? 26 : headerWidth < 980 ? 36 : 52)

    const controlGroupClass = 'flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.035] p-0.5 shrink-0'
    const showWindowedEditMenu = previewModeEnabled && isEditable
    const showFileTabs = showPreviewTabs && previewTabs.length > 1
    const isEditOnly = isEditable && !previewModeEnabled

    return (
        <div
            ref={containerRef}
            className={cn(
                'flex h-10 shrink-0 items-center gap-1.5 border-y border-[var(--surface-panel-divider)] bg-white/[0.02]',
                showCloseButton ? 'pl-2 pr-0' : 'pl-1 pr-0',
                isQuickPreviewWindow && '[&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] [&_select]:[-webkit-app-region:no-drag]'
            )}
            style={isQuickPreviewWindow ? { WebkitAppRegion: 'drag', ...(runtime.platform === 'darwin' ? { paddingLeft: '76px' } : {}) } as CSSProperties : undefined}
            data-standalone-preview-header={isQuickPreviewWindow || undefined}
        >
            {isQuickPreviewWindow ? <PreviewAppMenu filePath={file.path} isDirty={isDirty} onClose={onClose} /> : null}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {windowedNavigatorEnabled ? (
                    <button
                        type="button"
                        onClick={onToggleLeftPanel}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-white/[0.035] hover:text-sparkle-text focus:outline-none focus-visible:ring-1 focus-visible:ring-white/10"
                        title={leftPanelOpen ? 'Hide file navigator' : 'Show file navigator'}
                        aria-label={leftPanelOpen ? 'Hide file navigator' : 'Show file navigator'}
                        aria-pressed={leftPanelOpen}
                    >
                        {leftPanelOpen
                            ? <PanelLeftClose size={15} strokeWidth={1.7} />
                            : <PanelLeftOpen size={15} strokeWidth={1.7} />}
                    </button>
                ) : null}
                {showHistoryNavigation ? (
                    <PreviewHistoryNavigation
                        canGoBack={canNavigateBack}
                        canGoForward={canNavigateForward}
                        onBack={onNavigateBack}
                        onForward={onNavigateForward}
                    />
                ) : null}
                {windowedNavigatorEnabled || showHistoryNavigation ? (
                    <span className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.08]" aria-hidden="true" />
                ) : null}
                {showFileTabs ? (
                    <div className="flex min-w-0 flex-1 self-stretch overflow-hidden">
                        <PreviewTabStrip
                            tabs={previewTabs}
                            activeTabId={activePreviewTabId}
                            activeTabDirty={isDirty}
                            iconTheme={iconTheme}
                            canCreateSiblingFile={false}
                            onSelectTab={onSelectPreviewTab}
                            onCloseTab={onClosePreviewTab}
                        />
                    </div>
                ) : (
                    <div className="group/file flex min-w-0 items-center gap-2">
                        <FileEntryIcon
                            pathValue={file.path || file.name}
                            kind={file.type === 'directory' ? 'directory' : 'file'}
                            theme={iconTheme}
                            className="size-4 shrink-0"
                        />
                        <div className="flex min-w-0 items-center gap-1">
                            <h3 className="truncate text-[13px] font-semibold text-sparkle-text" title={file.displayName || file.name}>
                                {visibleFileName}
                            </h3>
                            <button
                                type="button"
                                onClick={() => void copyPath()}
                                className={cn(
                                    'shrink-0 rounded p-1 opacity-0 transition-[opacity,color,background-color] group-hover/file:opacity-100 focus-visible:opacity-100',
                                    copied ? 'bg-emerald-400/10 text-emerald-400 opacity-100' : 'text-white/35 hover:bg-white/[0.07] hover:text-white'
                                )}
                                title={copyFailed ? 'Could not copy path' : copied ? 'Copied!' : `Copy path: ${file.path}`}
                                aria-label={copyFailed ? 'Could not copy path' : copied ? 'Path copied' : 'Copy path'}
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>
                )}

                {allowExpanded ? (
                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        className="group/expand ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/48 outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-white focus-visible:text-white"
                        title="Expand workspace"
                        aria-label="Expand workspace"
                    >
                        <Expand size={16} className="transition-transform duration-200 group-hover/expand:scale-105 group-focus-visible/expand:scale-105" />
                    </button>
                ) : null}

                {isEditOnly && isDirty ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                        <button
                            type="button"
                            disabled={isSaving}
                            onClick={onSave}
                            className="inline-flex size-6 items-center justify-center rounded-[5px] text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:cursor-not-allowed disabled:opacity-35"
                            title={isSaving ? 'Saving…' : 'Save changes'}
                            aria-label={isSaving ? 'Saving changes' : 'Save changes'}
                        >
                            <Save size={13} />
                        </button>
                        <button
                            type="button"
                            disabled={isSaving}
                            onClick={onRevert}
                            className="inline-flex size-6 items-center justify-center rounded-[5px] text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:cursor-not-allowed disabled:opacity-35"
                            title="Discard changes"
                            aria-label="Discard changes"
                        >
                            <Undo2 size={13} />
                        </button>
                    </div>
                ) : null}

                {isHtml && !isEditMode ? (
                    <div className={cn('shrink-0', !allowExpanded && 'ml-auto')}>
                        <PreviewHeaderHtmlControls
                            isCompactHtmlHeader={isCompactHtmlHeader}
                            isVeryCompactHtmlHeader={isVeryCompactHtmlHeader}
                            isUltraCompactHtmlHeader={isUltraCompactHtmlHeader}
                            viewport={viewport}
                            onViewportChange={onViewportChange}
                        />
                    </div>
                ) : null}

                {showWindowedEditMenu ? (
                    <div className={cn('shrink-0', !allowExpanded && (!isHtml || isEditMode) && 'ml-auto')}>
                        <PreviewHeaderEditMenu
                            previewModeEnabled={previewModeEnabled}
                            isEditable={isEditable}
                            isEditMode={isEditMode}
                            isDirty={isDirty}
                            isSaving={isSaving}
                            loadingEditableContent={loadingEditableContent}
                            onModeChange={onModeChange}
                            onSave={onSave}
                            onRevert={onRevert}
                        />
                    </div>
                ) : !allowExpanded && (!isHtml || isEditMode) ? <span className="ml-auto" /> : null}

            </div>

            <PreviewHeaderStatusActions
                isEditMode={isEditMode}
                isHtml={isHtml}
                isCsv={isCsv}
                csvDistinctColorsEnabled={csvDistinctColorsEnabled}
                onCsvDistinctColorsEnabledChange={onCsvDistinctColorsEnabledChange}
                onOpenInBrowser={onOpenInBrowser}
                onClose={onClose}
                showCloseButton={showCloseButton}
                controlGroupClass={controlGroupClass}
            />
            {isQuickPreviewWindow ? <PreviewWindowControls onClose={onClose} /> : null}
        </div>
    )
}
