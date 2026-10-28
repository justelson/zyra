import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { Focus, Maximize2, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getFileUrl } from './utils'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const IMAGE_DIMENSION_CACHE_LIMIT = 96
interface ImagePreviewContentProps {
    filePath: string
    fileName: string
    isExpanded?: boolean
    controlsHost?: HTMLElement | null
    showControls?: boolean
}

type ImageDimensions = {
    width: number
    height: number
}

const imagePreviewDimensions = new Map<string, ImageDimensions>()
const imagePreviewViewportSizes = new Map<'expanded' | 'windowed', ImageDimensions>()

function imageDimensionKey(filePath: string): string {
    const normalized = filePath.trim().replace(/\\/g, '/')
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
        ? normalized.toLowerCase()
        : normalized
}

function readImageDimensions(filePath: string): ImageDimensions {
    if (filePath.startsWith('data:')) return { width: 0, height: 0 }
    return imagePreviewDimensions.get(imageDimensionKey(filePath)) || { width: 0, height: 0 }
}

function rememberImageDimensions(filePath: string, dimensions: ImageDimensions): void {
    // Captured media can be multi-megabyte data URLs; never retain their bytes as cache keys.
    if (filePath.startsWith('data:') || !dimensions.width || !dimensions.height) return
    const key = imageDimensionKey(filePath)
    imagePreviewDimensions.delete(key)
    imagePreviewDimensions.set(key, dimensions)
    while (imagePreviewDimensions.size > IMAGE_DIMENSION_CACHE_LIMIT) {
        const oldestKey = imagePreviewDimensions.keys().next().value
        if (typeof oldestKey !== 'string') break
        imagePreviewDimensions.delete(oldestKey)
    }
}

function clampScale(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export default function ImagePreviewContent({
    filePath,
    fileName,
    isExpanded = false,
    controlsHost = null,
    showControls = true
}: ImagePreviewContentProps) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const viewportMode = isExpanded ? 'expanded' : 'windowed'
    const [naturalSize, setNaturalSize] = useState<ImageDimensions>(() => readImageDimensions(filePath))
    const [viewportSize, setViewportSize] = useState<ImageDimensions>(() => (
        imagePreviewViewportSizes.get(viewportMode) || { width: 0, height: 0 }
    ))
    const [customScale, setCustomScale] = useState(1)
    const [fitToViewport, setFitToViewport] = useState(true)
    const [fillViewport, setFillViewport] = useState(false)

    useEffect(() => {
        const node = viewportRef.current
        if (!node || typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            const dimensions = {
                width: entry.contentRect.width,
                height: entry.contentRect.height
            }
            imagePreviewViewportSizes.set(viewportMode, dimensions)
            setViewportSize(dimensions)
        })

        observer.observe(node)
        return () => observer.disconnect()
    }, [viewportMode])

    useEffect(() => {
        setNaturalSize(readImageDimensions(filePath))
        setCustomScale(1)
        setFitToViewport(true)
        setFillViewport(false)
        viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }, [filePath])

    const fitScale = useMemo(() => {
        if (!naturalSize.width || !naturalSize.height || !viewportSize.width || !viewportSize.height) {
            return 1
        }

        const widthScale = viewportSize.width / naturalSize.width
        const heightScale = viewportSize.height / naturalSize.height
        return fillViewport ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale)
    }, [fillViewport, naturalSize.height, naturalSize.width, viewportSize.height, viewportSize.width])

    const activeScale = fitToViewport ? fitScale : customScale
    const zoomPercent = Math.max(10, Math.round(activeScale * 100))
    const scaledWidth = naturalSize.width > 0 ? naturalSize.width * activeScale : undefined
    const scaledHeight = naturalSize.height > 0 ? naturalSize.height * activeScale : undefined

    const applyScale = (nextScale: number) => {
        setFitToViewport(false)
        setFillViewport(false)
        setCustomScale(clampScale(nextScale))
    }

    const resetToFit = () => {
        setFitToViewport(true)
        setFillViewport(false)
        viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    }

    const fillView = () => {
        setFitToViewport(true)
        setFillViewport(true)
        viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    }

    const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        const nextScale = event.deltaY < 0
            ? activeScale * 1.08
            : activeScale / 1.08
        applyScale(nextScale)
    }

    const controls = (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10">
            <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-media-white/10 bg-media-black/65 p-1.5 text-media-white/85 shadow-lg backdrop-blur-md">
                <button
                    type="button"
                    onClick={() => applyScale(activeScale / 1.15)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-media-white/[0.08] hover:text-media-white"
                    title="Zoom out"
                >
                    <Minus size={14} />
                </button>
                <button
                    type="button"
                    onClick={resetToFit}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        fitToViewport && !fillViewport ? 'bg-media-white/[0.08] text-media-white' : 'hover:bg-media-white/[0.08] hover:text-media-white'
                    )}
                    title="Fit image to view"
                >
                    <Focus size={13} />
                    Fit
                </button>
                <button
                    type="button"
                    onClick={fillView}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        fitToViewport && fillViewport ? 'bg-media-white/[0.08] text-media-white' : 'hover:bg-media-white/[0.08] hover:text-media-white'
                    )}
                    title="Fill the preview"
                >
                    <Maximize2 size={13} />
                    Fill
                </button>
                <button
                    type="button"
                    onClick={() => applyScale(1)}
                    className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        !fitToViewport && Math.abs(activeScale - 1) < 0.01
                            ? 'bg-media-white/[0.08] text-media-white'
                            : 'hover:bg-media-white/[0.08] hover:text-media-white'
                    )}
                    title="Actual size"
                >
                    1:1
                </button>
                <button
                    type="button"
                    onClick={() => applyScale(activeScale * 1.15)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-media-white/[0.08] hover:text-media-white"
                    title="Zoom in"
                >
                    <Plus size={14} />
                </button>
                <div className="min-w-[54px] pr-2 text-right text-[11px] font-semibold tracking-[0.08em] text-media-white/70">
                    {zoomPercent}%
                </div>
            </div>
        </div>
    )

    return (
        <div
            className={cn(
                'relative h-full w-full overflow-hidden',
                isExpanded ? 'bg-media-black/35' : 'bg-media-black/20'
            )}
        >
            <img src={getFileUrl(filePath)} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-105 select-none object-cover opacity-[0.18] blur-2xl" draggable={false} />
            <div
                ref={viewportRef}
                className={cn('relative z-[1] h-full w-full', fitToViewport ? 'overflow-hidden' : 'overflow-auto')}
                onWheel={handleViewportWheel}
            >
                <div className={cn(
                    'flex items-center justify-center',
                    fitToViewport ? 'h-full w-full' : 'min-h-full min-w-full'
                )}>
                    <img
                        src={getFileUrl(filePath)}
                        alt={fileName}
                        onLoad={(event) => {
                            const target = event.currentTarget
                            const dimensions = {
                                width: target.naturalWidth || 0,
                                height: target.naturalHeight || 0
                            }
                            rememberImageDimensions(filePath, dimensions)
                            setNaturalSize(dimensions)
                        }}
                        className={cn(
                            'select-none object-contain transition-[width,height] duration-150 ease-out',
                            isExpanded ? 'rounded-none shadow-none' : 'rounded-lg shadow-2xl'
                        )}
                        style={{
                            width: scaledWidth ? `${scaledWidth}px` : undefined,
                            height: scaledHeight ? `${scaledHeight}px` : undefined,
                            maxWidth: 'none',
                            maxHeight: 'none'
                        }}
                        draggable={false}
                    />
                </div>
            </div>

            {showControls && (controlsHost ? createPortal(controls, controlsHost) : controls)}
        </div>
    )
}
