import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAssistantStoreSelector } from '@/lib/assistant/store'
import { ConnectedAssistantSessionsRail } from './AssistantConnectedSessionsRail'
import { AssistantTransientToast, useAssistantTransientToast } from './AssistantPageHelpers'
import { resolveAssistantPaneLayout, type AssistantPaneLayout } from './assistant-pane-layout'
import { useAssistantPageSidebarState } from './useAssistantPageSidebarState'

type WorkspaceLayout = ReturnType<typeof useAssistantPageSidebarState> & { paneLayout: AssistantPaneLayout }
const WorkspaceLayoutContext = createContext<WorkspaceLayout | null>(null)

export function useAssistantWorkspaceLayout() {
    const layout = useContext(WorkspaceLayoutContext)
    if (!layout) throw new Error('Assistant pages require the shared workspace layout.')
    return layout
}

// Own the actual sidebar, its subscriptions and local list state above route children.
// Only the content pane suspends or unmounts when moving between Chat and Plugins.
export function AssistantWorkspaceLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation()
    const chatActive = pathname === '/assistant' || pathname.startsWith('/assistant/')
    const selectedSessionId = useAssistantStoreSelector((state) => state.snapshot.selectedSessionId)
    const sidebar = useAssistantPageSidebarState(selectedSessionId)
    const { leftSidebarCollapsed, setLeftSidebarCollapsed, leftSidebarWidth, rightPanelMode, setRightPanelMode, rightSidebarWidth } = sidebar
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
    const autoCollapsedLeftSidebarRef = useRef(false)
    const { toast, showToast } = useAssistantTransientToast()
    const paneLayout = resolveAssistantPaneLayout({
        viewportWidth,
        leftSidebarCollapsed: leftSidebarCollapsed || (!chatActive && viewportWidth < 760),
        leftSidebarWidth,
        inspectorOpen: chatActive && rightPanelMode === 'review',
        inspectorWidth: rightSidebarWidth
    })

    useEffect(() => {
        const resize = () => setViewportWidth(window.innerWidth)
        window.addEventListener('resize', resize)
        return () => window.removeEventListener('resize', resize)
    }, [])
    useLayoutEffect(() => {
        // The Inspector still closes when its Chat page unmounts.
        if (!chatActive) setRightPanelMode('none')
    }, [chatActive, setRightPanelMode])
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
        const toggle = () => setLeftSidebarCollapsed((current) => !current)
        window.addEventListener('zyra:toggle-assistant-sidebar', toggle)
        return () => window.removeEventListener('zyra:toggle-assistant-sidebar', toggle)
    }, [setLeftSidebarCollapsed])
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('zyra:assistant-sidebar-state', {
            detail: { collapsed: paneLayout.leftSidebarCollapsed, width: paneLayout.leftSidebarWidth || leftSidebarWidth }
        }))
    }, [leftSidebarWidth, paneLayout.leftSidebarCollapsed, paneLayout.leftSidebarWidth])

    return <WorkspaceLayoutContext.Provider value={{ ...sidebar, paneLayout }}>
        <div className="flex h-full min-h-0 overflow-hidden [--accent-primary:var(--color-primary)] [--accent-secondary:var(--color-secondary)]" data-assistant-workspace="true">
            <ConnectedAssistantSessionsRail
                collapsed={paneLayout.leftSidebarCollapsed}
                width={leftSidebarWidth}
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
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]" role="status">Loading…</div>}>
                    {children}
                </Suspense>
            </div>
            <AssistantTransientToast toast={toast} />
        </div>
    </WorkspaceLayoutContext.Provider>
}
