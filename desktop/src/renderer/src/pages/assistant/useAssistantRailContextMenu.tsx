import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { FileActionsMenuSecondaryAction } from '@/components/ui/FileActionsMenuSecondaryAction'
import { cn } from '@/lib/utils'

export function useAssistantRailContextMenu() {
    const [contextMenu, setContextMenu] = useState<{
        x: number
        y: number
        title: string
        items: FileActionsMenuItem[]
    } | null>(null)

    const openContextMenu = (event: ReactMouseEvent<HTMLElement>, title: string, items: FileActionsMenuItem[]) => {
        if (items.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            title,
            items
        })
    }

    useEffect(() => {
        if (!contextMenu) return

        const handlePointerDown = () => setContextMenu(null)
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setContextMenu(null)
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleEscape)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [contextMenu])

    const contextMenuPosition = useMemo(() => {
        if (!contextMenu || typeof window === 'undefined') return null

        const menuWidth = 220
        const estimatedHeight = 10 + (contextMenu.items.length * 34)
        const margin = 8

        return {
            left: Math.max(margin, Math.min(contextMenu.x, window.innerWidth - menuWidth - margin)),
            top: Math.max(margin, Math.min(contextMenu.y, window.innerHeight - estimatedHeight - margin))
        }
    }, [contextMenu])

    const contextMenuPortal = contextMenu && contextMenuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
                className="fixed inset-0 z-[170]"
                onClick={() => setContextMenu(null)}
                onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu(null)
                }}
            >
                <div
                    className="fixed z-[171] min-w-[220px] max-w-[260px] rounded-xl border border-white/10 bg-sparkle-card p-1 shadow-2xl shadow-black/60"
                    style={{ top: `${contextMenuPosition.top}px`, left: `${contextMenuPosition.left}px` }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    role="menu"
                    aria-label={contextMenu.title}
                >
                    {contextMenu.items.map((item) => (
                        <div key={item.id} className="flex w-full items-stretch">
                            <button
                                type="button"
                                disabled={item.disabled}
                                onClick={() => {
                                    setContextMenu(null)
                                    void item.onSelect()
                                }}
                                className={cn(
                                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                                    item.secondaryAction && 'rounded-r-none',
                                    item.disabled
                                        ? 'cursor-not-allowed text-white/20'
                                        : item.danger
                                            ? 'text-red-200 hover:bg-red-500/15 hover:text-red-100'
                                            : 'text-white/75 hover:bg-white/10 hover:text-white'
                                )}
                                role="menuitem"
                            >
                                {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                                <span>{item.label}</span>
                            </button>
                            {item.secondaryAction ? <FileActionsMenuSecondaryAction action={item.secondaryAction} onClose={() => setContextMenu(null)} /> : null}
                            </div>
                    ))}
                </div>
            </div>,
            document.body
        )
        : null

    return {
        openContextMenu,
        contextMenuPortal
    }
}
