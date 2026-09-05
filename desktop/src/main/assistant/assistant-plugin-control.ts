import type { AgentControlBroker } from '../agent-control/agent-control-broker'
import type { ControlPrincipal } from '../../shared/agent-control/contracts'

// Detached Chats may have no local runtime context but still own root/child
// grants. Revoke those host records as well as cancelling active control calls.
export function revokePluginChatControl(
    broker: Pick<AgentControlBroker, 'grants' | 'revokePrincipal'>,
    threadIds: Iterable<string>
): void {
    const ids = new Set(threadIds)
    const principals = new Map<string, ControlPrincipal>()
    for (const { principal } of [...broker.grants.list(), ...broker.grants.listPending()]) {
        const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
        if (ids.has(threadId)) principals.set(JSON.stringify(principal), principal)
    }
    for (const principal of principals.values()) broker.revokePrincipal(principal, 'Chat Plugin authority revoked.')
}
