import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'

type PreviewExpandedPreviewAreaProps = {
    previewSurfaceRef: RefObject<HTMLDivElement | null>
    centerHtmlRenderedPreview: boolean
    isCompactHtmlViewport: boolean
    overflowLocked: boolean
    surfaceBackgroundClass: string
    shouldStretchPreviewBody: boolean
    previewContent: ReactNode
    scrollContainerRef?: RefObject<HTMLDivElement | null>
}

export function PreviewExpandedPreviewArea({
    previewSurfaceRef,
    centerHtmlRenderedPreview,
    isCompactHtmlViewport,
    overflowLocked,
    surfaceBackgroundClass,
    shouldStretchPreviewBody,
    previewContent,
    scrollContainerRef
}: PreviewExpandedPreviewAreaProps) {
    return (
        <div
            ref={previewSurfaceRef}
            className={cn(
                'relative h-full w-full',
                surfaceBackgroundClass
            )}
        >
            <div
                ref={overflowLocked ? undefined : scrollContainerRef}
                className={cn(
                    'h-full w-full custom-scrollbar flex',
                surfaceBackgroundClass,
                    centerHtmlRenderedPreview ? 'items-center justify-center' : 'items-stretch justify-start',
                    isCompactHtmlViewport ? 'p-2 sm:p-3' : 'p-0',
                    overflowLocked ? 'overflow-hidden' : 'overflow-auto'
                )}
                style={{ overscrollBehavior: 'contain' }}
            >
                <div
                    className={cn('w-full flex flex-col', shouldStretchPreviewBody ? 'h-full min-h-0' : 'min-h-full')}
                >
                    <div
                        className={cn(
                            shouldStretchPreviewBody && 'min-h-0',
                            shouldStretchPreviewBody ? 'h-full' : '',
                            centerHtmlRenderedPreview ? 'flex items-center justify-center' : ''
                        )}
                    >
                        {previewContent}
                    </div>
                </div>
            </div>
        </div>
    )
}
