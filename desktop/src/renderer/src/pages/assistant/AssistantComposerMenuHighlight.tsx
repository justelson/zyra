import { useLayoutEffect, useState, type RefObject } from 'react'
import { cn } from '@/lib/utils'

export function AssistantComposerMenuHighlight({
    listRef,
    activeIndex,
    activeItemId,
    animate
}: {
    listRef: RefObject<HTMLDivElement | null>
    activeIndex: number
    activeItemId: string | null
    animate: boolean
}) {
    const [bounds, setBounds] = useState<{ top: number; height: number } | null>(null)

    useLayoutEffect(() => {
        const list = listRef.current
        const item = list?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]
        if (!list || !item) {
            setBounds(null)
            return
        }
        const listRect = list.getBoundingClientRect()
        const itemRect = item.getBoundingClientRect()
        setBounds({
            top: list.scrollTop + itemRect.top - listRect.top,
            height: itemRect.height
        })
    }, [activeIndex, activeItemId, listRef])

    return (
        <div
            aria-hidden="true"
            className={cn(
                'pointer-events-none absolute inset-x-1.5 top-0 z-0 rounded-[7px] bg-white/[0.075]',
                animate && 'transition-[transform,height,opacity] duration-100 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
            )}
            style={{
                height: bounds?.height || 0,
                opacity: bounds ? 1 : 0,
                transform: `translateY(${bounds?.top || 0}px)`
            }}
        />
    )
}
