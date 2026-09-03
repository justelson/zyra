import { useEffect, type RefObject } from 'react'

export function resolveAssistantComposerMenuScrollTop(input: {
    scrollTop: number
    viewportHeight: number
    contentHeight: number
    itemTop: number
    itemHeight: number
    edgePadding?: number
}): number | null {
    const edgePadding = Math.max(0, input.edgePadding ?? 6)
    const visibleTop = input.scrollTop + edgePadding
    const visibleBottom = input.scrollTop + input.viewportHeight - edgePadding
    const itemBottom = input.itemTop + input.itemHeight
    if (input.itemTop >= visibleTop && itemBottom <= visibleBottom) return null

    const requestedTop = input.itemTop < visibleTop
        ? input.itemTop - edgePadding
        : itemBottom - input.viewportHeight + edgePadding
    return Math.max(0, Math.min(requestedTop, Math.max(0, input.contentHeight - input.viewportHeight)))
}

export function useAssistantComposerMenuActiveScroll(
    listRef: RefObject<HTMLDivElement | null>,
    activeIndex: number,
    activeItemId: string | null
): void {
    useEffect(() => {
        const list = listRef.current
        if (!list || activeIndex < 0) return
        const activeItem = list.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]
        if (!activeItem) return
        const listRect = list.getBoundingClientRect()
        const itemRect = activeItem.getBoundingClientRect()
        const nextTop = resolveAssistantComposerMenuScrollTop({
            scrollTop: list.scrollTop,
            viewportHeight: list.clientHeight,
            contentHeight: list.scrollHeight,
            itemTop: list.scrollTop + itemRect.top - listRect.top,
            itemHeight: itemRect.height
        })
        if (nextTop === null || Math.abs(nextTop - list.scrollTop) < 1) return
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        list.scrollTo({ top: nextTop, behavior: reduceMotion ? 'auto' : 'smooth' })
    }, [activeIndex, activeItemId, listRef])
}
