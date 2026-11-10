import type { ControlPrincipal, ControlTarget } from '../../shared/agent-control/contracts'
import type { AgentControlBridgeOperation } from '../../shared/agent-control/protocol'
import { AgentControlError } from './control-errors'

export function isRootOnlyWindowsOperation(operation: AgentControlBridgeOperation, target?: ControlTarget): boolean {
    return operation.operation === 'use_app' || operation.operation === 'open_app' || operation.operation === 'list_windows'
        || (operation.operation === 'request_grant' && (Boolean(operation.windowToken) || target?.kind === 'windows-window'))
}

export function isWindowsControlOperation(operation: AgentControlBridgeOperation, target?: ControlTarget): boolean {
    return isRootOnlyWindowsOperation(operation, target) || target?.kind === 'windows-window'
}

export function backgroundBrowserOperation(
    principal: ControlPrincipal,
    operation: AgentControlBridgeOperation,
    target?: ControlTarget,
    userRequestedWindows = false
): AgentControlBridgeOperation {
    if (userRequestedWindows && principal.type === 'root' && isWindowsControlOperation(operation, target)) return operation
    // Paired Chrome is target-scoped browser control, independent of which
    // Zyra chat is selected. The ordinary grant and origin checks still apply.
    if (principal.type === 'root' && (operation.operation === 'list_targets' && operation.targetKind === 'chrome-tab'
        || operation.operation === 'open_tab' && operation.targetKind === 'chrome-tab'
        || target?.kind === 'chrome-tab')) return operation
    if (operation.operation === 'list_targets' && (!operation.targetKind || operation.targetKind === 'zyra-browser')) {
        return { ...operation, targetKind: 'zyra-browser' }
    }
    if (operation.operation === 'open_tab' && operation.reveal !== true) return { ...operation, reveal: false }
    if (operation.operation === 'plan_status' || operation.operation === 'revoke_current_principal') return operation
    const allowed = new Set(['observe', 'act', 'act_sequence', 'perform', 'request_grant', 'release', 'delegate_lease', 'close_tab', 'refresh_tab', 'resume_plan', 'cancel_plan'])
    const threadId = principal.type === 'root' ? principal.threadId : principal.parentThreadId
    if (allowed.has(operation.operation) && target?.kind === 'zyra-browser' && target.ownerThreadId === threadId) return operation
    throw new AgentControlError('CONTROL_FOREGROUND_REQUIRED', 'This operation changes the visible Desktop workspace. Browser tools can continue in the chat’s own tabs and granted paired Chrome targets.')
}
