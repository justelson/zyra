import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type AssistantAttachmentImageCardProps = {
    name: string
    src: string
    widthClassName: string
    heightClassName: string
    onClick?: () => void
    onRemove?: () => void
    removable?: boolean
    removing?: boolean
    presentation?: 'compact' | 'card'
}

export function AssistantAttachmentImageCard({
    name,
    src,
    widthClassName,
    heightClassName,
    onClick,
    onRemove,
    removable = false,
    removing = false,
    presentation = 'compact'
}: AssistantAttachmentImageCardProps) {
    const image = (
        <>
            <div className={presentation === 'card' ? 'p-2 pb-0' : 'p-[3px]'}>
                <div className={presentation === 'card' ? undefined : 'overflow-hidden rounded-[10px] border border-white/[0.08] bg-black/20 p-0.5'}>
                    <img
                        src={src}
                        alt={name}
                        className={cn('w-full', presentation === 'card' ? 'rounded-md bg-black/20 object-contain' : 'rounded-[8px] object-cover', heightClassName)}
                        loading="lazy"
                    />
                </div>
            </div>
            {presentation === 'card' ? <div className="truncate px-3 py-2 text-xs text-sparkle-text-secondary" title={name}>{name}</div> : null}
        </>
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
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    className="relative block w-full cursor-pointer text-left"
                    title="Open file preview"
                    aria-label={`Open preview for ${name}`}
                >
                    {image}
                </button>
            ) : (
                <div className="relative block w-full text-left">
                    {image}
                </div>
            )}
            {removable ? (
                <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation()
                        onRemove?.()
                    }}
                    className={cn(
                        'absolute right-0 top-0 z-20 inline-flex size-8 shrink-0 items-center justify-center rounded-bl-xl text-sparkle-text-muted transition-[color,opacity] hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/45 disabled:pointer-events-none',
                        presentation === 'card' && 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100'
                    )}
                    disabled={removing}
                    title={`Remove ${name}`}
                    aria-label={`Remove ${name}`}
                >
                    <span className="inline-flex size-5 items-center justify-center rounded-md border border-white/10 bg-black/55 shadow-sm backdrop-blur-sm transition-colors group-hover:border-white/15 group-hover:bg-black/65">
                        <X size={12} strokeWidth={2.2} />
                    </span>
                </button>
            ) : null}
        </article>
    )
}
