import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FileCode2, Loader2, X } from 'lucide-react'
import { useFilePreview } from '@/components/ui/file-preview/useFilePreview'
import { resolvePreviewType } from '@/components/ui/file-preview/utils'
import { parseQuickPreviewFilePath } from '@shared/file-preview-route'
import QuickPreviewTitleBar from './QuickPreviewTitleBar'

const FilePreviewModal = lazy(() => import('@/components/ui/FilePreviewModal'))

function splitFileNameAndExtension(filePath: string): { fileName: string; extension: string } {
    const normalized = filePath.replace(/\\/g, '/')
    const fileName = normalized.split('/').pop() || filePath
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
        return { fileName, extension: '' }
    }
    return { fileName, extension: fileName.slice(dotIndex + 1).toLowerCase() }
}

export default function QuickOpen() {
    const location = useLocation()
    const filePath = useMemo(() => parseQuickPreviewFilePath(location.search), [location.search])
    const [loadError, setLoadError] = useState<string | null>(null)
    const {
        previewFile,
        previewContent,
        loadingPreview,
        previewTruncated,
        previewSize,
        previewBytes,
        previewModifiedAt,
        openPreview,
        closePreview
    } = useFilePreview()

    useEffect(() => {
        if (!filePath) {
            setLoadError('No file path was provided.')
            return
        }

        const { fileName, extension } = splitFileNameAndExtension(filePath)
        if (!resolvePreviewType(fileName, extension)) {
            closePreview()
            setLoadError('This file type is not supported by the previewer.')
            return
        }
        setLoadError(null)
        void openPreview({ name: fileName, path: filePath }, extension).catch((error: any) => {
            setLoadError(error?.message || 'Failed to open file preview.')
        })
    }, [filePath])

    const closeWindow = () => {
        closePreview()
        window.devscope.window.close()
    }

    if (!filePath) {
        return (
            <div className="flex h-screen flex-col overflow-hidden bg-sparkle-bg text-sparkle-text">
                <QuickPreviewTitleBar />
                <div className="flex flex-1 items-center justify-center p-6">
                    <div className="max-w-xl w-full rounded-2xl border border-white/10 bg-black/20 p-6">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <FileCode2 size={16} className="text-[var(--accent-primary)]" />
                            Quick Preview
                        </div>
                        <p className="mt-3 text-sm text-white/70">No file path was provided to preview.</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-sparkle-bg text-sparkle-text">
            <QuickPreviewTitleBar />
            {loadingPreview && !previewFile && (
                <div className="flex flex-1 items-center justify-center">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 text-sm text-white/80">
                        <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                        Loading preview...
                    </div>
                </div>
            )}

            {!loadingPreview && !previewFile && (
                <div className="flex flex-1 items-center justify-center p-6">
                    <div className="max-w-xl w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-amber-200">Unable to preview this file</div>
                            <button
                                type="button"
                                onClick={closeWindow}
                                className="inline-flex items-center justify-center rounded-md border border-white/15 bg-black/20 p-1.5 text-white/80 hover:bg-black/35"
                                title="Close window"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <p className="mt-3 text-sm text-amber-100/90 break-all">{loadError || filePath}</p>
                    </div>
                </div>
            )}

            {previewFile && (
                <Suspense
                    fallback={
                        <div className="flex flex-1 items-center justify-center">
                            <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 text-sm text-white/80">
                                <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                                Loading preview...
                            </div>
                        </div>
                    }
                >
                    <FilePreviewModal
                        file={previewFile}
                        content={previewContent}
                        loading={loadingPreview}
                        truncated={previewTruncated}
                        size={previewSize}
                        previewBytes={previewBytes}
                        modifiedAt={previewModifiedAt}
                        projectPath={undefined}
                        shellMode="window"
                        chromeContext="quick-view"
                        onOpenLinkedPreview={openPreview}
                        onClose={closeWindow}
                    />
                </Suspense>
            )}
        </div>
    )
}
