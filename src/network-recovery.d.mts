export const ZYRA_RETRY_MAX_ATTEMPTS: number
export const ZYRA_RETRY_BASE_DELAY_MS: number

export type ZyraRecoveryKind = 'network' | 'provider'
export type ZyraRecoveryStatus = 'retrying' | 'recovered' | 'paused'

export function isNetworkRecoveryError(value: unknown): boolean
export function classifyRecoveryError(value: unknown): ZyraRecoveryKind
export function buildRecoveryPresentation(input?: {
    errorMessage?: unknown
    finalError?: unknown
    error?: unknown
    recoveryKind?: unknown
    attempt?: unknown
    maxAttempts?: unknown
    status?: unknown
    success?: unknown
}): {
    recoveryKind: ZyraRecoveryKind
    status: ZyraRecoveryStatus
    label: string
    attempt: number
    maxAttempts: number
}
