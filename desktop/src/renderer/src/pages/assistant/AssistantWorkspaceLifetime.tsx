import { getSelectedAssistantSession, getActiveAssistantThread } from '@/lib/assistant/selectors'
import { Outlet } from 'react-router-dom'
import { useAssistantStoreActions, useAssistantStoreLifecycle, useAssistantStoreSelector } from '@/lib/assistant/store'
import { useSettings } from '@/lib/settings'
import { AssistantWorkspaceLayout } from './AssistantWorkspaceLayout'
import { AssistantWorkspaceStartup } from './AssistantWorkspaceStartup'
import { AssistantRouteShell } from './AssistantRouteShell'
import { ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY, resolveStoredAssistantLeftSidebarWidth } from './assistant-pane-layout'

// Route children may release their consumers without disconnecting Chat updates.
// Leaving this workspace still tears down the stream and reconciles on re-entry.
export function AssistantWorkspaceLifetime() {
    useAssistantStoreLifecycle()
    const { settings } = useSettings()
    const actions = useAssistantStoreActions()
    const startup = useAssistantStoreSelector(state => ({
        ready: state.hydrated && Boolean(getActiveAssistantThread(getSelectedAssistantSession(state.snapshot))),
        error: state.error
    }), (left, right) => left.ready === right.ready && left.error === right.error)
    return <AssistantWorkspaceStartup
        ready={startup.ready}
        error={startup.error}
        onRetry={() => { void actions.refresh() }}
        loadingFallback={<AssistantRouteShell
            sidebarCollapsed={settings.sidebarCollapsed}
            sidebarWidth={resolveStoredAssistantLeftSidebarWidth(localStorage.getItem(ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY))}
            agentInboxEnabled={settings.assistantAgentInboxSidebarEnabled}
        />}
    ><AssistantWorkspaceLayout><Outlet /></AssistantWorkspaceLayout></AssistantWorkspaceStartup>
}
