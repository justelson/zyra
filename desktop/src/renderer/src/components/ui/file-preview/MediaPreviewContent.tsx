import { addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Film, Image as ImageIcon, Music4 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PreviewFile, PreviewMediaItem } from './types'
import { getFileUrl } from './utils'
import ImagePreviewContent from './ImagePreviewContent'
import AudioPlayer from '../AudioPlayer'

interface MediaPreviewContentProps {
    file: PreviewFile
    mediaItems?: PreviewMediaItem[]
    onSelectMedia?: (item: PreviewMediaItem) => Promise<void> | void
    isExpanded?: boolean
}

const MEDIA_TRANSITION_MS = 300
const MEDIA_TRANSITION_SETTLE_BUFFER_MS = 80

function preloadAdjacentImages(items: Array<PreviewMediaItem | null>): HTMLImageElement[] {
    if (typeof Image === 'undefined') return []
    const paths = new Set(items
        .filter((item): item is PreviewMediaItem => item?.type === 'image')
        .map((item) => item.path))
    return [...paths].map((path) => {
        const image = new Image()
        image.decoding = 'async'
        image.src = getFileUrl(path)
        void image.decode?.().catch(() => undefined)
        return image
    })
}

function renderMediaIcon(type: PreviewMediaItem['type']) {
    if (type === 'image') return <ImageIcon size={20} className="text-purple-200" />
    if (type === 'video') return <Film size={20} className="text-rose-200" />
    return <Music4 size={20} className="text-sky-200" />
}

function MediaNavButton({
    side,
    item,
    onSelect
}: {
    side: 'left' | 'right'
    item: PreviewMediaItem | null
    onSelect?: (item: PreviewMediaItem) => Promise<void> | void
}) {
    if (!item) return null

    const zonePositionClassName = side === 'left' ? 'left-0 items-start pl-3' : 'right-0 items-end pr-3'

    return (
        <div className={cn('absolute inset-y-0 z-20 flex w-20 items-center', zonePositionClassName)}>
            <button
                type="button"
                onClick={() => { void onSelect?.(item) }}
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-media-white/10 bg-media-black/55 text-media-white/80 shadow-xl backdrop-blur-md transition-colors duration-200 hover:border-media-white/20 hover:bg-media-black/70 hover:text-media-white"
                title={`${side === 'left' ? 'Previous' : 'Next'} media`}
            >
                {side === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>
        </div>
    )
}

function renderMediaStage(
    targetFile: PreviewFile,
    activeMediaItem: PreviewMediaItem | undefined,
    isExpanded: boolean,
    imageControlsHost: HTMLElement | null,
    showImageControls: boolean
) {
    if (targetFile.type === 'image') {
        return (
            <ImagePreviewContent
                filePath={targetFile.path}
                fileName={targetFile.name}
                isExpanded
                controlsHost={imageControlsHost}
                showControls={showImageControls}
            />
        )
    }

    if (targetFile.type === 'video') {
        return (
            <div className="flex h-full w-full items-center justify-center p-4">
                <video
                    src={getFileUrl(targetFile.path)}
                    controls
                    playsInline
                    className={cn(
                        'max-w-full bg-media-black/20 object-contain',
                        isExpanded ? 'h-full max-h-full w-full rounded-none shadow-none' : 'max-h-full rounded-xl shadow-2xl'
                    )}
                />
            </div>
        )
    }

    return (
        <div className="flex h-full w-full items-center justify-center p-6">
            <div className="flex w-full max-w-xl items-center gap-4">
                {activeMediaItem?.thumbnailPath ? <img
                    src={getFileUrl(activeMediaItem.thumbnailPath)}
                    alt={`${targetFile.name} cover`}
                    className="h-14 w-14 shrink-0 rounded-md object-cover"
                /> : null}
                <AudioPlayer src={getFileUrl(targetFile.path)} label={targetFile.name} />
            </div>
        </div>
    )
}

export default function MediaPreviewContent({
    file,
    mediaItems = [],
    onSelectMedia,
    isExpanded = false
}: MediaPreviewContentProps) {
    const [imageControlsHost, setImageControlsHost] = useState<HTMLDivElement | null>(null)
    const [transitionState, setTransitionState] = useState<{
        from: PreviewFile
        to: PreviewFile
        direction: 'left' | 'right'
        stage: 'preparing' | 'running'
    } | null>(null)
    const previousFileRef = useRef(file)
    const currentIndex = useMemo(
        () => mediaItems.findIndex((item) => item.path.toLowerCase() === file.path.toLowerCase()),
        [file.path, mediaItems]
    )
    const previousItem = currentIndex > 0 ? mediaItems[currentIndex - 1] : null
    const nextItem = currentIndex >= 0 && currentIndex < mediaItems.length - 1 ? mediaItems[currentIndex + 1] : null
    const mediaItemByPath = useMemo(
        () => new Map(mediaItems.map((item) => [item.path.toLowerCase(), item])),
        [mediaItems]
    )
    const activeMediaItem = mediaItemByPath.get(file.path.toLowerCase())

    useEffect(() => {
        const images = preloadAdjacentImages([previousItem, nextItem])
        return () => {
            for (const image of images) {
                image.onload = null
                image.onerror = null
            }
        }
    }, [nextItem, previousItem])

    useEffect(() => {
        if (!previousItem && !nextItem) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || (event.target as Element | null)?.closest?.('[data-audio-player]')) return
            if (event.key === 'ArrowLeft' && previousItem) {
                event.preventDefault()
                void onSelectMedia?.(previousItem)
            }
            if (event.key === 'ArrowRight' && nextItem) {
                event.preventDefault()
                void onSelectMedia?.(nextItem)
            }
        }

        return addOverlayEventListener('keydown', handleKeyDown)
    }, [nextItem, onSelectMedia, previousItem])

    useLayoutEffect(() => {
        const previousFile = previousFileRef.current
        if (previousFile.path === file.path) return

        previousFileRef.current = file
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        if (reduceMotion) {
            setTransitionState(null)
            return
        }

        const previousIndex = mediaItems.findIndex((item) => item.path.toLowerCase() === previousFile.path.toLowerCase())
        const nextIndexValue = mediaItems.findIndex((item) => item.path.toLowerCase() === file.path.toLowerCase())
        const direction: 'left' | 'right' = (
            previousIndex >= 0 && nextIndexValue >= 0 && nextIndexValue > previousIndex
        ) ? 'right' : 'left'

        setTransitionState({
            from: previousFile,
            to: file,
            direction,
            stage: 'preparing'
        })

        let runningFrameId = 0
        const preparationFrameId = window.requestAnimationFrame(() => {
            runningFrameId = window.requestAnimationFrame(() => {
                setTransitionState((current) => current?.to.path === file.path
                    ? { ...current, stage: 'running' }
                    : current)
            })
        })
        const timeoutId = window.setTimeout(() => {
            setTransitionState((current) => current?.to.path === file.path ? null : current)
        }, MEDIA_TRANSITION_MS + MEDIA_TRANSITION_SETTLE_BUFFER_MS)

        return () => {
            window.cancelAnimationFrame(preparationFrameId)
            if (runningFrameId) window.cancelAnimationFrame(runningFrameId)
            window.clearTimeout(timeoutId)
        }
    }, [file, mediaItems])

    return (
        <div className="relative h-full w-full min-h-0 overflow-hidden">
            {transitionState ? (
                <div className="relative h-full w-full overflow-hidden">
                    <div
                        className={cn(
                            'absolute inset-0 transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none',
                            transitionState.stage === 'running'
                                ? (transitionState.direction === 'right' ? '-translate-x-full' : 'translate-x-full')
                                : 'translate-x-0'
                        )}
                    >
                        {renderMediaStage(
                            transitionState.from,
                            mediaItemByPath.get(transitionState.from.path.toLowerCase()),
                            isExpanded,
                            imageControlsHost,
                            false
                        )}
                    </div>
                    <div
                        className={cn(
                            'absolute inset-0 transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none',
                            transitionState.stage === 'running'
                                ? 'translate-x-0'
                                : (transitionState.direction === 'right' ? 'translate-x-full' : '-translate-x-full')
                        )}
                    >
                        {renderMediaStage(
                            transitionState.to,
                            activeMediaItem,
                            isExpanded,
                            imageControlsHost,
                            true
                        )}
                    </div>
                </div>
            ) : (
                renderMediaStage(file, activeMediaItem, isExpanded, imageControlsHost, true)
            )}

            <div ref={setImageControlsHost} className="pointer-events-none absolute inset-0 z-30" />
            <MediaNavButton side="left" item={previousItem} onSelect={onSelectMedia} />
            <MediaNavButton side="right" item={nextItem} onSelect={onSelectMedia} />
        </div>
    )
}
