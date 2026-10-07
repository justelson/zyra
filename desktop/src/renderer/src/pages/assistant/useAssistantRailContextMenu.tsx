import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { dismissTransientMenus } from '@/lib/transient-menu'

export function useAssistantRailContextMenu() {
    const [contextMenu, setContextMenu] = useState<{
        x: number; y: number; title: string; items: FileActionsMenuItem[]; key: number
    } | null>(null)
    const openContextMenu = (event: ReactMouseEvent<HTMLElement>, title: string, items: FileActionsMenuItem[]) => {
        if (!items.length) return
        event.preventDefault()
        event.stopPropagation()
        dismissTransientMenus()
        setContextMenu({ x: event.clientX, y: event.clientY, title, items, key: performance.now() })
    }
    const contextMenuPortal = contextMenu ? (
        <FileActionsMenu key={contextMenu.key} items={contextMenu.items} title={contextMenu.title}
            contextAnchor={{ x: contextMenu.x, y: contextMenu.y }} onDismiss={() => setContextMenu(null)}
            density="compact" presentation="portal" containEscape revealSecondaryOnHover />
    ) : null
    return { openContextMenu, contextMenuPortal }
}
