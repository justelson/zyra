import type { ReactNode } from 'react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { AssistantComposerMenuSurface } from './AssistantComposerMenuSurface'
import { useComposerDrawerMotion } from './useComposerDrawerMotion'

/** The same attached drawer/seam as the guided-question tray. */
export function AssistantComposerAttentionShelf({ title, children }: { title: string; children: ReactNode }) {
    const motion = useComposerDrawerMotion(true)
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+var(--assistant-attention-shelf-offset,0px))] z-30 -mb-[17px] [&_[data-composer-drawer]]:pointer-events-none" data-assistant-attention-shelf="true" data-assistant-composer-hitbox="true">
            <AnimatedHeight isOpen={motion.open} duration={220} crispContent contentClassName={`transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${motion.open ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'}`}>
                <AssistantComposerMenuSurface title={title}><div className="pointer-events-auto">{children}</div></AssistantComposerMenuSurface>
            </AnimatedHeight>
        </div>
    )
}
