import { useRef } from 'react'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { cn } from '@/lib/utils'
import { getAssistantComposerFileOptionId, type AssistantComposerFileSearchItem } from './assistant-composer-file-search'
import { useAssistantComposerMenuActiveScroll } from './assistant-composer-menu-scroll'
import { AssistantComposerMenuHighlight } from './AssistantComposerMenuHighlight'
import { AssistantComposerMenuSurface } from './AssistantComposerMenuSurface'

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
        <AssistantComposerMenuSurface title="Files" detail={loading ? 'Searching…' : query || undefined}>
            <div
                id={menuId}
                ref={listRef}
                className="custom-scrollbar relative max-h-[min(18rem,36vh)] scroll-py-2 overflow-y-auto p-2 [scrollbar-gutter:stable]"
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
                            disabled={loading || !!error}
                            data-command-active={active ? 'true' : 'false'}
                            onPointerMove={(event) => {
                                if (event.movementX === 0 && event.movementY === 0) return
                                onActiveIndexChange(index)
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(item)}
                            className={cn(
                                'relative z-[1] flex h-8 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors duration-100',
                                active ? 'text-sparkle-text' : 'text-sparkle-text-secondary hover:bg-white/[0.045]'
                            )}
                        >
                            <FileEntryIcon pathValue={item.path} kind="file" theme={iconTheme} size={16} />
                            <span className="min-w-0 max-w-[45%] shrink-0 truncate text-[12px] font-medium text-sparkle-text" title={item.name}>{item.name}</span>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs text-sparkle-text-muted/70" title={item.relativePath}>
                                    {item.displayPath}
                                </span>
                                {item.showRootLabel ? (
                                    <span
                                        className="max-w-24 shrink-0 truncate rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-400"
                                        title={item.rootPath}
                                    >
                                        {item.rootLabel}
                                    </span>
                                ) : null}
                            </span>
                        </button>
                    )
                })}
            </div>
        </AssistantComposerMenuSurface>
    )
}
