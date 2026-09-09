import type { AssistantPendingApproval } from '../../shared/assistant/contracts'

type ApprovalScope = Pick<AssistantPendingApproval, 'paths' | 'toolCallId' | 'grantLabel'>

// Extend the existing JSON field without changing the database schema. Older
// rows contain only a paths array and remain readable.
export function encodeApprovalScope(approval: ApprovalScope): unknown {
    return approval.toolCallId || approval.grantLabel
        ? { paths: approval.paths, toolCallId: approval.toolCallId, grantLabel: approval.grantLabel }
        : approval.paths
}

export function decodeApprovalScope(value: unknown): ApprovalScope {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const paths = Array.isArray(value) ? value : data.paths
    return {
        paths: Array.isArray(paths) ? paths.filter((entry): entry is string => typeof entry === 'string') : undefined,
        toolCallId: typeof data.toolCallId === 'string' ? data.toolCallId : undefined,
        grantLabel: typeof data.grantLabel === 'string' ? data.grantLabel : undefined
    }
}
