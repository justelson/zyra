import { isBrowserExtension } from '@/lib/browser-extension'
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAssistantStoreSelector } from '@/lib/assistant/store'
import { ConnectedAssistantSessionsRail } from './AssistantConnectedSessionsRail'
import { AssistantTransientToast, useAssistantTransientToast } from './AssistantPageHelpers'
import { resolveAssistantPaneLayout } from './assistant-pane-layout'
import { useAssistantPageSidebarState } from './useAssistantPageSidebarState'

import { AssistantWorkspaceContext } from './assistant-workspace-context'

// Own the actual sidebar, its subscriptions and local list state above route children.
// Only the content pane suspends or unmounts when moving between Chat and Plugins.
export function AssistantWorkspaceLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation()
    const chatActive = pathname === '/assistant' || pathname.startsWith('/assistant/')
    const selectedSessionId = useAssistantStoreSelector((state) => state.snapshot.selectedSessionId)
    const sidebar = useAssistantPageSidebarState(selectedSessionId)
    const { leftSidebarCollapsed, setLeftSidebarCollapsed, leftSidebarWidth, rightPanelMode, rightSidebarWidth } = sidebar
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
    const [extensionDrawerOpen, setExtensionDrawerOpen] = useState(false)
    const autoCollapsedLeftSidebarRef = useRef(false)
    const { toast, showToast, dismissToast } = useAssistantTransientToast()
    const paneLayout = resolveAssistantPaneLayout({
        viewportWidth,
        leftSidebarCollapsed: isBrowserExtension || leftSidebarCollapsed || (!chatActive && viewportWidth < 760),
        leftSidebarWidth,
        inspectorOpen: chatActive && rightPanelMode === 'review',
        inspectorWidth: rightSidebarWidth
    })

    useEffect(() => {
        const resize = () => setViewportWidth(window.innerWidth)
        window.addEventListener('resize', resize)
        return () => window.removeEventListener('resize', resize)
    }, [])
    useEffect(() => {
        if (paneLayout.autoCollapseLeftSidebar && !leftSidebarCollapsed) {
            autoCollapsedLeftSidebarRef.current = true
            setLeftSidebarCollapsed(true)
            return
        }
        if (!paneLayout.autoCollapseLeftSidebar && autoCollapsedLeftSidebarRef.current) {
            autoCollapsedLeftSidebarRef.current = false
            setLeftSidebarCollapsed(false)
        }
    }, [leftSidebarCollapsed, paneLayout.autoCollapseLeftSidebar, setLeftSidebarCollapsed])
    useEffect(() => {
        const toggle = () => isBrowserExtension ? setExtensionDrawerOpen(current => !current) : setLeftSidebarCollapsed((current) => !current)
        window.addEventListener('zyra:toggle-assistant-sidebar', toggle)
        return () => window.removeEventListener('zyra:toggle-assistant-sidebar', toggle)
    }, [setLeftSidebarCollapsed])
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('zyra:assistant-sidebar-state', {
            detail: { collapsed: paneLayout.leftSidebarCollapsed, width: paneLayout.leftSidebarWidth || leftSidebarWidth }
        }))
    }, [leftSidebarWidth, paneLayout.leftSidebarCollapsed, paneLayout.leftSidebarWidth])

    useEffect(() => { setExtensionDrawerOpen(false) }, [selectedSessionId, pathname])

    return <AssistantWorkspaceContext.Provider value={{ ...sidebar, paneLayout }}>
        <div className="flex h-full min-h-0 overflow-hidden [--accent-primary:var(--color-primary)] [--accent-secondary:var(--color-secondary)]" data-assistant-workspace="true">
            {isBrowserExtension && extensionDrawerOpen && <button className="absolute inset-0 z-40 bg-black/25" aria-label="Close chats" onClick={() => setExtensionDrawerOpen(false)} />}
            <div className={isBrowserExtension && extensionDrawerOpen ? 'extension-chat-drawer h-full' : 'contents'}>
            <ConnectedAssistantSessionsRail
                collapsed={isBrowserExtension ? !extensionDrawerOpen : paneLayout.leftSidebarCollapsed}
                width={isBrowserExtension ? Math.min(320, viewportWidth - 32) : leftSidebarWidth}
                maxWidth={paneLayout.maxLeftSidebarWidth}
                previewPinned={sidebar.bubblePreviewPinned}
                railMode={sidebar.railMode}
                railGroupMode={sidebar.railGroupMode}
                railSortMode={sidebar.railSortMode}
                railFilterMode={sidebar.railFilterMode}
                onRailModeChange={sidebar.setRailMode}
                onRailGroupModeChange={sidebar.setRailGroupMode}
                onRailSortModeChange={sidebar.setRailSortMode}
                onRailFilterModeChange={sidebar.setRailFilterMode}
                onWidthChange={sidebar.setLeftSidebarWidth}
                onPreviewPinnedChange={sidebar.setBubblePreviewPinned}
                onShowToast={showToast}
            />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]" role="status">Loading…</div>}>
                    {children}
                </Suspense>
            </div>
            <AssistantTransientToast toast={toast} onDismiss={dismissToast} />
        </div>
    </AssistantWorkspaceContext.Provider>
}
