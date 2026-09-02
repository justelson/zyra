import { useLayoutEffect, useRef } from 'react'
import { BookOpenText, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssistantComposerCommandItem } from './assistant-composer-command-menu'
import {
    formatAssistantPromptResourceScope,
    getAssistantComposerCommandOptionId
} from './assistant-composer-command-menu'

export function AssistantComposerCommandMenu({
    menuId,
    items,
    activeIndex,
    loading,
    error,
    onActiveIndexChange,
    onSelect
}: {
    menuId: string
    items: AssistantComposerCommandItem[]
    activeIndex: number
    loading: boolean
    error: string | null
    onActiveIndexChange: (index: number) => void
    onSelect: (item: AssistantComposerCommandItem) => void
}) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const activeItemId = items[activeIndex]?.id || null

    useLayoutEffect(() => {
        const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') || [])
        const activeItem = options[activeIndex]
        const lookaheadItem = options[Math.min(activeIndex + 1, options.length - 1)]
        activeItem?.scrollIntoView({ block: 'nearest' })
        if (lookaheadItem && lookaheadItem !== activeItem) {
            lookaheadItem.scrollIntoView({ block: 'nearest' })
        }
    }, [activeIndex, activeItemId])

    return (
        <div className="pointer-events-auto mx-auto w-[calc(100%-1rem)] overflow-hidden rounded-t-[14px] rounded-b-[8px] border border-b-0 border-white/[0.075] bg-[color-mix(in_srgb,var(--color-card)_97%,transparent)] shadow-[0_-14px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:w-[calc(100%-2.25rem)]">
            <div
                id={menuId}
                ref={listRef}
                className="custom-scrollbar max-h-[min(12.5rem,32vh)] scroll-pb-10 overflow-y-auto px-1.5 pb-10 pt-1.5"
                role="listbox"
                aria-label="Commands and skills"
            >
                {loading && items.length === 0 ? (
                    <div className="flex h-12 items-center px-3 text-[12px] text-sparkle-text-muted/70">
                        Loading commands and skills…
                    </div>
                ) : error && items.length === 0 ? (
                    <div className="flex min-h-12 items-center px-3 text-[12px] text-rose-200/75">{error}</div>
                ) : items.length === 0 ? (
                    <div className="flex min-h-12 items-center px-3 text-[12px] text-sparkle-text-muted/70">
                        No matching commands or skills
                    </div>
                ) : items.map((item, index) => {
                    const active = index === activeIndex
                    const ResourceIcon = item.kind === 'skill' ? BookOpenText : SquareTerminal
                    return (
                        <button
                            id={getAssistantComposerCommandOptionId(menuId, item.id)}
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-command-active={active ? 'true' : 'false'}
                            onMouseMove={() => onActiveIndexChange(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(item)}
                            className={cn(
                                'flex w-full items-center gap-2.5 rounded-[9px] px-3 py-1.5 text-left transition-[background-color,color] duration-150',
                                active ? 'bg-white/[0.075] text-sparkle-text' : 'text-sparkle-text-secondary hover:bg-white/[0.045]'
                            )}
                        >
                            <ResourceIcon
                                size={14}
                                strokeWidth={1.8}
                                className={cn('shrink-0', item.kind === 'skill' ? 'text-[var(--accent-primary)]' : 'text-white/38')}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    <span className="shrink-0 font-mono text-[12px] font-medium text-sparkle-text">{item.label}</span>
                                    <span className="min-w-0 truncate text-[11.5px] text-sparkle-text-muted/75">{item.description}</span>
                                </div>
                            </div>
                            <span className="shrink-0 rounded-md bg-white/[0.045] px-1.5 py-0.5 text-[9px] font-medium text-white/38">
                                {formatAssistantPromptResourceScope(item.scope)}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
