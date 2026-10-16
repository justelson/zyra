import { ComposerSourceBadge } from './ComposerSourceBadge'
import { useRef } from 'react'
import { BookOpenText, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssistantComposerCommandItem } from './assistant-composer-command-menu'
import {
    formatAssistantPromptResourceScope,
    getAssistantComposerCommandOptionId
} from './assistant-composer-command-menu'
import { useAssistantComposerMenuActiveScroll } from './assistant-composer-menu-scroll'
import { AssistantComposerMenuHighlight } from './AssistantComposerMenuHighlight'
import { AssistantComposerMenuSurface } from './AssistantComposerMenuSurface'
import { PluginSkillIcon, shortSkillDescription } from '../plugins/plugin-presentation'

export function AssistantComposerCommandMenu({
    menuId,
    items,
    activeIndex,
    loading,
    error,
    scrollBehavior,
    onActiveIndexChange,
    onSelect
}: {
    menuId: string
    items: AssistantComposerCommandItem[]
    activeIndex: number
    loading: boolean
    error: string | null
    scrollBehavior: ScrollBehavior
    onActiveIndexChange: (index: number) => void
    onSelect: (item: AssistantComposerCommandItem) => void
}) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const activeItemId = items[activeIndex]?.id || null

    useAssistantComposerMenuActiveScroll(listRef, activeIndex, activeItemId, scrollBehavior)

    return (
        <AssistantComposerMenuSurface title="Commands & skills" detail={loading ? 'Loading…' : undefined}>
            <div
                id={menuId}
                ref={listRef}
                className="custom-scrollbar relative max-h-[min(18rem,36vh)] scroll-py-2 overflow-y-auto p-2 [scrollbar-gutter:stable]"
                role="listbox"
                aria-label="Commands and skills"
            >
                <AssistantComposerMenuHighlight listRef={listRef} activeIndex={activeIndex} activeItemId={activeItemId} animate={scrollBehavior === 'smooth'} />
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
                    const displayLabel = item.kind === 'skill' ? item.label.replace(/^\/(?:skill:)?/, '') : item.label
                    const ResourceIcon = item.kind === 'skill' ? BookOpenText : SquareTerminal
                    return (
                        <button
                            id={getAssistantComposerCommandOptionId(menuId, item.id)}
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            aria-label={`${item.kind === 'skill' ? 'Skill' : 'Command'}: ${displayLabel} · ${item.sourceLabel || formatAssistantPromptResourceScope(item.scope)}`}
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
                            {item.kind === 'skill' && item.pluginName ? <PluginSkillIcon pluginName={item.pluginName} /> : <ResourceIcon
                                size={14}
                                strokeWidth={1.8}
                                className={cn('shrink-0', item.kind === 'skill' ? 'text-[var(--accent-primary)]' : 'text-white/38')}
                            />}
                            <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-baseline gap-2">
                                    <span className="min-w-0 max-w-[45%] shrink-0 truncate text-[12px] font-medium text-sparkle-text" title={displayLabel}>{displayLabel}</span>
                                    <span className="min-w-0 truncate text-[11.5px] text-sparkle-text-muted/75" title={item.description}>{item.kind === 'skill' ? shortSkillDescription(item.description) : item.description}</span>
                                </div>
                            </div>
                            {item.kind === 'skill' && <span data-composer-resource-kind="skill" className="inline-flex h-5 shrink-0 items-center rounded-full border border-[var(--surface-divider)] bg-[var(--surface-active)] px-2 text-[10px] font-medium leading-none text-sparkle-text-secondary">Skill</span>}
                            <ComposerSourceBadge item={item} />
                        </button>
                    )
                })}
            </div>
        </AssistantComposerMenuSurface>
    )
}
