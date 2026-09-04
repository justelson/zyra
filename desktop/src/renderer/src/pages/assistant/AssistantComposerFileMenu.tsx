import { useRef } from 'react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { cn } from '@/lib/utils'
import { getAssistantComposerFileOptionId, type AssistantComposerFileSearchItem } from './assistant-composer-file-search'
import { useAssistantComposerMenuActiveScroll } from './assistant-composer-menu-scroll'
import { AssistantComposerMenuHighlight } from './AssistantComposerMenuHighlight'

export function AssistantComposerFileMenu({
    menuId,
    items,
    activeIndex,
    query,
    loading,
    error,
    iconTheme,
    scrollBehavior,
    onActiveIndexChange,
    onSelect
}: {
    menuId: string
    items: AssistantComposerFileSearchItem[]
    activeIndex: number
    query: string
    loading: boolean
    error: string | null
    iconTheme: 'light' | 'dark'
    scrollBehavior: ScrollBehavior
    onActiveIndexChange: (index: number) => void
    onSelect: (item: AssistantComposerFileSearchItem) => void
}) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const activeItemId = items[activeIndex]?.id || null
    useAssistantComposerMenuActiveScroll(listRef, activeIndex, activeItemId, scrollBehavior)

    return (
        <div className="pointer-events-auto mx-auto w-[calc(100%-1rem)] overflow-hidden rounded-t-[14px] rounded-b-[8px] border border-b-0 border-white/[0.075] bg-[color-mix(in_srgb,var(--color-card)_97%,transparent)] shadow-[0_-14px_34px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:w-[calc(100%-2.25rem)]">
            <div className="flex h-6 items-center border-b border-white/[0.055] px-3 text-[10px] leading-none text-sparkle-text-muted/65">
                <span>Include file</span>
                {query ? <span className="ml-2 min-w-0 truncate font-mono text-sparkle-text-secondary/75">{query}</span> : null}
            </div>
            <div
                id={menuId}
                ref={listRef}
                className="custom-scrollbar relative max-h-[min(12.5rem,32vh)] scroll-pb-10 overflow-y-auto px-1.5 pb-10 pt-1.5"
                role="listbox"
                aria-label="Project files"
            >
                <AssistantComposerMenuHighlight listRef={listRef} activeIndex={activeIndex} activeItemId={activeItemId} animate={scrollBehavior === 'smooth'} />
                {loading && items.length === 0 ? (
                    <div className="flex h-12 items-center px-3 text-[12px] text-sparkle-text-muted/70">Searching project files…</div>
                ) : error && items.length === 0 ? (
                    <div className="flex min-h-12 items-center px-3 text-[12px] text-rose-200/75">{error}</div>
                ) : items.length === 0 ? (
                    <div className="flex min-h-12 items-center px-3 text-[12px] text-sparkle-text-muted/70">No matching files</div>
                ) : items.map((item, index) => {
                    const active = index === activeIndex
                    return (
                        <button
                            id={getAssistantComposerFileOptionId(menuId, item.id)}
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-command-active={active ? 'true' : 'false'}
                            onPointerMove={(event) => {
                                if (event.movementX === 0 && event.movementY === 0) return
                                onActiveIndexChange(index)
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(item)}
                            className={cn(
                                'relative z-[1] flex h-7 w-full items-center gap-2.5 rounded-[7px] px-3 text-left transition-colors duration-100',
                                active ? 'text-sparkle-text' : 'text-sparkle-text-secondary hover:bg-white/[0.045]'
                            )}
                        >
                            <FileEntryIcon pathValue={item.path} kind="file" theme={iconTheme} size={16} />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-sparkle-text">{item.name}</span>
                            <span className="ml-auto flex min-w-0 max-w-[58%] items-center justify-end gap-2">
                                {item.showRootLabel ? (
                                    <span
                                        className="max-w-24 shrink-0 truncate rounded-[4px] bg-white/[0.045] px-1.5 py-0.5 text-[9px] text-white/42"
                                        title={item.rootPath}
                                    >
                                        {item.rootLabel}
                                    </span>
                                ) : null}
                                <span className="min-w-0 truncate text-right text-[10.5px] text-sparkle-text-muted/60" title={item.relativePath}>
                                    {item.displayPath}
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
