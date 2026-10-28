import type { ReactNode } from 'react'
import { FileText, Film, X } from 'lucide-react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { useThemeRevision } from '@/lib/use-theme-revision'
import { cn } from '@/lib/utils'

export function AssistantAttachmentPill({
    name,
    previewDataUrl,
    category,
    removing,
    onOpen,
    onRemove
}: {
    name: string
    previewDataUrl?: string
    category?: 'image' | 'video' | 'code' | 'doc'
    removing: boolean
    onOpen: () => void
    onRemove: () => void
}) {
    useThemeRevision()
    const theme = typeof document !== 'undefined' && document.body.classList.contains('light') ? 'light' : 'dark'
    return (
        <article
            data-composer-attachment-item="true"
            data-composer-attachment-pill="true"
            className={cn('group flex h-7 max-w-56 items-center overflow-hidden rounded-md border border-[var(--surface-divider)] bg-sparkle-card transition-[opacity,transform] duration-200 motion-reduce:transition-none', removing && 'scale-95 opacity-0')}
        >
            <button type="button" disabled={removing} onClick={onOpen} title={name} aria-label={`Open preview for ${name}`} className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1 text-left hover:bg-[var(--surface-hover)] disabled:pointer-events-none">
                {category === 'video' ? <Film size={14} className="shrink-0 text-sparkle-text-secondary" /> : previewDataUrl ? <img src={previewDataUrl} alt="" className="size-4 shrink-0 rounded-sm object-cover" /> : <FileEntryIcon pathValue={name} kind="file" theme={theme} size={14} className="shrink-0" />}
                <span className="truncate text-[11px] text-sparkle-text-secondary">{name}</span>
            </button>
            <button type="button" disabled={removing} onClick={onRemove} title={`Remove ${name}`} aria-label={`Remove ${name}`} className="inline-flex h-full w-6 shrink-0 items-center justify-center text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:pointer-events-none">
                <X size={11} />
            </button>
        </article>
    )
}

type AssistantAttachmentCardBaseProps = {
    widthClassName: string
    onClick?: () => void
    onRemove?: () => void
    removable?: boolean
    removing?: boolean
    title?: string
    children: ReactNode
}

function AttachmentCardBase({
    widthClassName,
    onClick,
    onRemove,
    removable = false,
    removing = false,
    title,
    children
}: AssistantAttachmentCardBaseProps) {
    const content = onClick ? (
        <button
            type="button"
            onClick={onClick}
            className="relative block h-full w-full text-left"
            disabled={removing}
            title={title}
        >
            {children}
        </button>
    ) : (
        <div className="relative block h-full w-full text-left">
            {children}
        </div>
    )

    return (
        <article
            data-composer-attachment-item="true"
            className={cn(
                'group relative overflow-hidden rounded-lg border border-white/10 bg-sparkle-card/95 shadow-lg shadow-black/20 backdrop-blur-xl transition-colors hover:border-white/20 hover:bg-white/[0.05]',
                widthClassName
            )}
            style={{
                transition: 'transform 190ms ease, opacity 190ms ease, filter 190ms ease',
                transform: removing ? 'translateY(6px) scale(0.82)' : 'translateY(0) scale(1)',
                opacity: removing ? 0 : 1,
                filter: removing ? 'blur(1px)' : 'blur(0)'
            }}
        >
            {content}
            {removable ? (
                <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation()
                        onRemove?.()
                    }}
                    className="absolute right-0 top-0 z-20 inline-flex size-8 shrink-0 items-center justify-center rounded-bl-xl text-sparkle-text-muted transition-colors hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/45 disabled:pointer-events-none"
                    disabled={removing}
                    title="Remove attachment"
                    aria-label="Remove attachment"
                >
                    <span className="inline-flex size-5 items-center justify-center rounded-md border border-white/10 bg-black/55 shadow-sm backdrop-blur-sm transition-colors group-hover:border-white/15 group-hover:bg-black/65">
                        <X size={12} strokeWidth={2.2} />
                    </span>
                </button>
            ) : null}
        </article>
    )
}

export function AssistantPastedTextCard({
    widthClassName = 'w-[92px]',
    onClick,
    onRemove,
    removable = false,
    removing = false,
    label = 'Pasted Text',
    previewText = null
}: {
    widthClassName?: string
    onClick?: () => void
    onRemove?: () => void
    removable?: boolean
    removing?: boolean
    label?: string
    previewText?: string | null
}) {
    const normalizedPreview = String(previewText || '')
        .replace(/\r/g, '')
        .trim()
    const previewLines = normalizedPreview
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 5)

    return (
        <AttachmentCardBase
            widthClassName={widthClassName}
            onClick={onClick}
            onRemove={onRemove}
            removable={removable}
            removing={removing}
            title="Open pasted text"
        >
            <div className="relative flex h-[96px] w-full flex-col items-center justify-start gap-1.5 p-[6px] text-left">
                <div className="relative flex h-[64px] w-full items-start justify-start overflow-hidden rounded-[10px] border border-white/10 bg-sparkle-card/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    {previewLines.length > 0 ? (
                        <>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.09),transparent_54%)]" />
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-white/[0.04] to-transparent" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-sparkle-card via-sparkle-card/88 to-transparent" />
                            <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-sparkle-card/72 to-transparent" />
                            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-sparkle-card via-sparkle-card/84 to-transparent" />
                            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,transparent_46%,rgba(0,0,0,0.05)_100%)]" />
                            <div className="relative z-10 h-full w-full px-2 pb-2 pt-1.5">
                                <div className="space-y-[2px] overflow-hidden">
                                    {previewLines.map((line, index) => (
                                        <p key={`${index}-${line}`} className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[7px] leading-[1.08] text-sparkle-text-secondary/78">
                                            {line}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white/8 to-transparent" />
                            <FileText size={28} className="relative z-10 m-auto text-sparkle-text-secondary" />
                        </>
                    )}
                </div>
                <span className="block w-full text-center text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-sparkle-text-secondary">
                    {label}
                </span>
            </div>
        </AttachmentCardBase>
    )
}

export function AssistantFileAttachmentCard({
    name,
    contentType,
    category,
    widthClassName = 'w-[116px]',
    pathLabel,
    onClick,
    onRemove,
    removable = false,
    removing = false,
    previewText
}: {
    name: string
    contentType: string
    category: 'image' | 'video' | 'code' | 'doc'
    widthClassName?: string
    pathLabel?: string | null
    onClick?: () => void
    onRemove?: () => void
    removable?: boolean
    removing?: boolean
    previewText?: string | null
}) {
    useThemeRevision()
    const iconTheme = typeof document !== 'undefined' && document.body.classList.contains('light') ? 'light' : 'dark'
    return (
        <AttachmentCardBase
            widthClassName={widthClassName}
            onClick={onClick}
            onRemove={onRemove}
            removable={removable}
            removing={removing}
            title={onClick ? 'Open preview' : undefined}
        >
            <div className="flex items-start gap-2 p-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--surface-divider)] bg-sparkle-bg">
                    {category === 'video' ? <Film size={15} className="text-sparkle-text-secondary" /> : <FileEntryIcon pathValue={name} kind="file" theme={iconTheme} size={15} />}
                </div>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[9px] font-medium text-sparkle-text">{name}</span>
                    <span className="block truncate font-mono text-[7px] uppercase tracking-[0.1em] text-sparkle-text-muted">{contentType}</span>
                </span>
            </div>
            {previewText ? (
                <div className="px-2 pb-1 pt-0">
                    <p className="line-clamp-2 text-[8px] leading-3 text-sparkle-text-muted">{previewText}</p>
                </div>
            ) : pathLabel ? (
                <div className="px-2 pb-1.5 pt-0">
                    <div className="truncate font-mono text-[8px] text-sparkle-text-muted/80">{pathLabel}</div>
                </div>
            ) : null}
        </AttachmentCardBase>
    )
}
