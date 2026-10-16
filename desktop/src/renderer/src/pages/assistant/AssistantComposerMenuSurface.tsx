import { createContext, useContext, type ReactNode } from 'react'
import { X } from 'lucide-react'

export const ComposerMenuContext = createContext<{ below: boolean; close?: () => void }>({ below: false })

/** Match T3's attached surface and one-pixel seam bleed, in either direction. */
export function AssistantComposerMenuSurface({ title, children }: {
    title: string
    detail?: string
    children: ReactNode
}) {
    const { below, close } = useContext(ComposerMenuContext)
    return (
        <div aria-label={title} data-composer-drawer="true" className={`relative isolate pointer-events-auto mx-auto w-[calc(100%-1rem)] overflow-hidden sm:w-[calc(100%-2rem)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:border before:border-[var(--surface-divider)] before:bg-[var(--surface-floating)] before:shadow-[0_14px_32px_-18px_rgb(0_0_0/45%)] ${below ? 'pt-[17px] before:rounded-b-[16px] before:[mask-image:linear-gradient(to_bottom,transparent_0_16px,black_16px)]' : 'pb-[17px] before:rounded-t-[16px] before:[mask-image:linear-gradient(to_top,transparent_0_16px,black_16px)]'}`}>
            {close && <button type="button" onClick={close} aria-label="Close composer menu" className={`absolute right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--surface-floating)] text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text ${below ? 'top-4' : 'top-1'}`}><X size={11} /></button>}
            {children}
        </div>
    )
}
