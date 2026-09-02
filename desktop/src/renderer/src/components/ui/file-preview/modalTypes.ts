import type { ReactNode } from 'react'
import type { PreviewFile, PreviewMediaItem, PreviewMeta, PreviewOpenOptions, PreviewTab } from './types'
import type { FilePreviewChromeContext } from './filePreviewChromePolicy'

export type FilePreviewPresentationState = {
    name: string
    path: string
    extension: string
    mode: 'preview' | 'edit'
    expanded: boolean
}

export interface FilePreviewModalProps extends PreviewMeta {
    file: PreviewFile
    previewTabs?: PreviewTab[]
    activePreviewTabId?: string | null
    content: string
    loading?: boolean
    projectPath?: string
    readOnly?: boolean
    shellMode?: 'modal' | 'window'
    active?: boolean
    chromeContext: FilePreviewChromeContext
    publishNavigatorToAppTitleBar?: boolean
    initialPresentation?: Pick<FilePreviewPresentationState, 'mode' | 'expanded'>
    onViewStateChange?: (state: FilePreviewPresentationState) => void
    onOpenLinkedPreview?: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onOpenLinkedPreviewInNewTab?: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onSelectPreviewTab?: (tabId: string) => void
    onClosePreviewTab?: (tabId: string) => void
    onReorderPreviewTabs?: (activeTabId: string, overTabId: string | null) => void
    mediaItems?: PreviewMediaItem[]
    navigationSidebar?: ReactNode
    onSaved?: (filePath: string) => Promise<void> | void
    onShowToast?: (message: string, tone?: 'success' | 'error' | 'info') => void
    onClose: () => void
}
