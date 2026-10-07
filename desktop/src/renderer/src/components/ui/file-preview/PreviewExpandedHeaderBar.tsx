import { Check, Copy, Edit3, Globe2, Minimize2, Palette, PanelLeftClose, PanelLeftOpen, PanelRight, Save, Undo2, X } from 'lucide-react'
import { type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings'
import type { PreviewFile, PreviewTab } from './types'
import type { ViewportPreset } from './viewport'
import { PreviewEditorSettingsMenu } from './PreviewEditorSettingsMenu'
import type { PreviewHeaderEditMenuAction } from './PreviewHeaderEditMenu'
import { PreviewHeaderHtmlControls } from './PreviewHeaderHtmlControls'
import { PreviewHistoryNavigation } from './PreviewHistoryNavigation'
import { PreviewTabStrip } from './PreviewTabStrip'
import { usePreviewPathCopy } from './usePreviewPathCopy'

type PreviewExpandedHeaderBarProps = {
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
    showHistoryNavigation: boolean
    showPreviewTabs: boolean
    showLeftPanelToggle: boolean
    leftPanelOpen: boolean
    rightPanelOpen: boolean
    loadingEditableContent?: boolean
    viewport: ViewportPreset
    onViewportChange: (viewport: ViewportPreset) => void
    csvDistinctColorsEnabled: boolean
    onCsvDistinctColorsEnabledChange: (enabled: boolean) => void
    onOpenInBrowser: () => void
    onClose: () => void
    onModeChange: (mode: 'preview' | 'edit') => void
    onSave: () => void
    onRevert: () => void
    onToggleExpanded: () => void
    onToggleLeftPanel: () => void
    onToggleRightPanel: () => void
    previewTabs: PreviewTab[]
    activePreviewTabId: string | null
    onSelectPreviewTab: (tabId: string) => void
    onClosePreviewTab: (tabId: string) => void
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

type HeaderIconButtonProps = {
    active?: boolean
    disabled?: boolean
    title: string
    onClick?: () => void
    children: ReactNode
    activeClassName?: string
}

function HeaderIconButton({ active = false, disabled = false, title, onClick, children, activeClassName }: HeaderIconButtonProps) {
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            className={cn(
                'no-drag inline-flex size-6 items-center justify-center rounded-[5px] border border-transparent text-sparkle-text-muted transition-[opacity,color,background-color,border-color] duration-150 hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                active && (activeClassName || 'border-[var(--surface-divider)] bg-[var(--surface-active)] text-sparkle-text'),
                disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent hover:text-sparkle-text-muted'
            )}
        >
            {children}
        </button>
    )
}

export function PreviewExpandedHeaderBar({
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
    showHistoryNavigation,
    showPreviewTabs,
    showLeftPanelToggle,
    leftPanelOpen,
    rightPanelOpen,
    loadingEditableContent,
    viewport,
    onViewportChange,
    csvDistinctColorsEnabled,
    onCsvDistinctColorsEnabledChange,
    onOpenInBrowser,
    onClose,
    onModeChange,
    onSave,
    onRevert,
    onToggleExpanded,
    onToggleLeftPanel,
    onToggleRightPanel,
    previewTabs,
    activePreviewTabId,
    onSelectPreviewTab,
    onClosePreviewTab,
    setFindRequestToken,
    setReplaceRequestToken,
    isEditorToolsEnabled,
    editorWordWrap,
    setEditorWordWrap,
    editorMinimapEnabled,
    setEditorMinimapEnabled,
    editorFontSize,
    setEditorFontSize
}: PreviewExpandedHeaderBarProps) {
    const { settings } = useSettings()
    const iconTheme = settings.appearanceResolvedMode
    const isHtml = file.type === 'html'
    const isCsv = file.type === 'csv'
    const isEditMode = mode === 'edit'
    const showFileTabs = showPreviewTabs && previewTabs.length > 1
    const { copied: copiedPath, copyFailed, copyPath } = usePreviewPathCopy(file.path)

    const contextualActions: PreviewHeaderEditMenuAction[] = [
        ...(isHtml ? [{
            id: 'open-browser',
            label: 'Open in browser',
            icon: <Globe2 size={12} />,
            onSelect: onOpenInBrowser
        }] : []),
        ...(isCsv ? [{
            id: 'csv-colors',
            label: 'Distinct column colours',
            icon: <Palette size={12} />,
            checked: csvDistinctColorsEnabled,
            onSelect: () => onCsvDistinctColorsEnabledChange(!csvDistinctColorsEnabled)
        }] : []),
    ]

    const toolbar = (
        <div
            className="pointer-events-auto flex h-[34px] w-full items-stretch border-y border-[var(--surface-panel-divider)] bg-[var(--surface-topbar)] text-sparkle-text shadow-[0_1px_0_rgba(255,255,255,0.015)]"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            data-file-preview-focus-toolbar="true"
        >
            <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
                {showLeftPanelToggle ? (
                    <button
                        type="button"
                        onClick={onToggleLeftPanel}
                        className="no-drag inline-flex h-full w-8 shrink-0 items-center justify-center text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus:outline-none focus-visible:text-sparkle-text"
                        title={leftPanelOpen ? 'Hide file navigator' : 'Show file navigator'}
                        aria-label={leftPanelOpen ? 'Hide file navigator' : 'Show file navigator'}
                        aria-pressed={leftPanelOpen}
                        data-file-preview-local-navigator-toggle="true"
                    >
                        {leftPanelOpen ? <PanelLeftClose size={15} strokeWidth={1.7} /> : <PanelLeftOpen size={15} strokeWidth={1.7} />}
                    </button>
                ) : null}
                {showHistoryNavigation ? (
                    <div className="no-drag flex h-full shrink-0 items-center">
                        <PreviewHistoryNavigation
                            canGoBack={canNavigateBack}
                            canGoForward={canNavigateForward}
                            onBack={onNavigateBack}
                            onForward={onNavigateForward}
                            expanded
                        />
                    </div>
                ) : null}
                {showFileTabs ? (
                    <div className="no-drag flex min-w-0 flex-1 items-stretch overflow-hidden">
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
                    <div className="group/file flex min-w-0 flex-1 items-center gap-2 px-2" title={file.path}>
                        <FileEntryIcon
                            pathValue={file.path || file.name}
                            kind={file.type === 'directory' ? 'directory' : 'file'}
                            theme={iconTheme}
                            className="size-3.5 shrink-0"
                        />
                        <span className="truncate text-[11px] font-semibold text-sparkle-text/92">{file.displayName || file.name}</span>
                        {isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-amber-300/85" aria-label="Unsaved changes" /> : null}
                        <button
                            type="button"
                            onClick={() => void copyPath()}
                            className={cn(
                                'no-drag inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-[opacity,color,background-color] group-hover/file:opacity-100 focus-visible:opacity-100',
                                copiedPath
                                    ? 'bg-emerald-400/10 text-emerald-400 opacity-100'
                                    : 'text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text'
                            )}
                            title={copyFailed ? 'Could not copy path' : copiedPath ? 'Copied!' : `Copy path: ${file.path}`}
                            aria-label={copyFailed ? 'Could not copy path' : copiedPath ? 'Path copied' : `Copy path: ${file.path}`}
                        >
                            {copiedPath ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                    </div>
                )}

            </div>

            <div className="no-drag flex shrink-0 items-center gap-0.5 px-1">
                {isEditMode ? (
                    <PreviewEditorSettingsMenu
                        enabled={isEditorToolsEnabled}
                        setFindRequestToken={setFindRequestToken}
                        setReplaceRequestToken={setReplaceRequestToken}
                        editorWordWrap={editorWordWrap}
                        setEditorWordWrap={setEditorWordWrap}
                        editorMinimapEnabled={editorMinimapEnabled}
                        setEditorMinimapEnabled={setEditorMinimapEnabled}
                        editorFontSize={editorFontSize}
                        setEditorFontSize={setEditorFontSize}
                        isDirty={previewModeEnabled ? false : isDirty}
                        isSaving={isSaving}
                        onSave={previewModeEnabled ? undefined : onSave}
                        onRevert={previewModeEnabled ? undefined : onRevert}
                    />
                ) : null}
                <HeaderIconButton
                    active={rightPanelOpen}
                    title={rightPanelOpen ? 'Hide file side panel' : 'Show file side panel'}
                    onClick={onToggleRightPanel}
                >
                    <PanelRight size={14} />
                </HeaderIconButton>
                <HeaderIconButton title="Exit file focus mode" onClick={onToggleExpanded}>
                    <Minimize2 size={15} />
                </HeaderIconButton>
                {isHtml && !isEditMode ? (
                    <PreviewHeaderHtmlControls
                        isCompactHtmlHeader={false}
                        isVeryCompactHtmlHeader={false}
                        isUltraCompactHtmlHeader={false}
                        isIdeChrome
                        viewport={viewport}
                        onViewportChange={onViewportChange}
                    />
                ) : null}
                {previewModeEnabled ? (
                    <>
                        {contextualActions.map((action) => <HeaderIconButton key={action.id} active={action.checked} disabled={action.disabled} title={action.label} onClick={action.onSelect}>{action.icon}</HeaderIconButton>)}
                        {isDirty ? <>
                            <HeaderIconButton disabled={isSaving} title="Save changes" onClick={onSave}><Save size={13} /></HeaderIconButton>
                            <HeaderIconButton disabled={isSaving} title="Discard changes" onClick={onRevert}><Undo2 size={13} /></HeaderIconButton>
                        </> : null}
                        <button
                            type="button"
                            onClick={() => onModeChange(isEditMode ? 'preview' : 'edit')}
                            disabled={!isEditMode && (!isEditable || loadingEditableContent)}
                            aria-pressed={isEditMode}
                            title={isEditMode ? 'Switch to preview mode' : 'Switch to edit mode'}
                            className={cn(
                                'no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-2.5 text-[11px] text-sparkle-text transition-colors hover:bg-[var(--surface-hover)]',
                                isEditMode && 'bg-[var(--surface-active)]',
                                !isEditMode && (!isEditable || loadingEditableContent) && 'cursor-not-allowed opacity-45'
                            )}
                        ><Edit3 size={12} /><span>Edit</span></button>
                    </>
                ) : null}
                {showCloseButton ? (
                    <HeaderIconButton title="Close preview" onClick={onClose}>
                        <X size={14} />
                    </HeaderIconButton>
                ) : null}
            </div>
        </div>
    )

    return toolbar
}
