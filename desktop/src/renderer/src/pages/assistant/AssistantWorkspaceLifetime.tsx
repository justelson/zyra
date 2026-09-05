import { Outlet } from 'react-router-dom'
import { useAssistantStoreLifecycle } from '@/lib/assistant/store'
import { AssistantWorkspaceLayout } from './AssistantWorkspaceLayout'

// Route children may release their consumers without disconnecting Chat updates.
// Leaving this workspace still tears down the stream and reconciles on re-entry.
export function AssistantWorkspaceLifetime() {
    useAssistantStoreLifecycle()
    return <AssistantWorkspaceLayout><Outlet /></AssistantWorkspaceLayout>
}
