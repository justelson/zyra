export type ControlErrorCode =
    | 'CONTROL_VALIDATION_ERROR'
    | 'CONTROL_TARGET_NOT_FOUND'
    | 'CONTROL_TARGET_AMBIGUOUS'
    | 'CONTROL_GRANT_NOT_FOUND'
    | 'CONTROL_GRANT_INACTIVE'
    | 'CONTROL_GRANT_EXPIRED'
    | 'CONTROL_CAPABILITY_DENIED'
    | 'CONTROL_SCOPE_DENIED'
    | 'CONTROL_STALE_OBSERVATION'
    | 'CONTROL_SIDE_EFFECT_APPROVAL_REQUIRED'
    | 'CONTROL_QUEUE_FULL'
    | 'CONTROL_DRIVER_UNAVAILABLE'
    | 'CONTROL_TARGET_BLOCKED'
    | 'CONTROL_CANCELLED'
    | 'CONTROL_TIMEOUT'
    | 'CONTROL_UNKNOWN_OPERATION'
    | 'CONTROL_PRINCIPAL_MISMATCH'

export class AgentControlError extends Error {
    constructor(
        readonly code: ControlErrorCode,
        message: string,
        readonly options: { retryable?: boolean; freshRevision?: number } = {}
    ) {
        super(message)
        this.name = 'AgentControlError'
    }

    toWire() {
        return {
            code: this.code,
            message: this.message,
            retryable: Boolean(this.options.retryable),
            freshRevision: this.options.freshRevision
        }
    }
}

export function toAgentControlError(error: unknown): AgentControlError {
    if (error instanceof AgentControlError) return error
    return new AgentControlError(
        'CONTROL_DRIVER_UNAVAILABLE',
        error instanceof Error ? error.message : 'Control driver failed.',
        { retryable: true }
    )
}
