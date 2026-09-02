import type { AssistantActivity } from '@shared/assistant/contracts'
import { isAssistantTransportFailure } from '@shared/assistant/transport-failure'

export const MAX_ASSISTANT_RECONNECT_ATTEMPTS = 10

export type AssistantRecoveryIssue = {
    key: string
    title: string
    brief: string
    recoverable: boolean
    raw: string
}

type AssistantRecoveryClassification = Omit<AssistantRecoveryIssue, 'raw'>

const ASSISTANT_RECOVERY_ACTIVITY_KINDS = new Set(['process.stderr', 'runtime.error'])

function stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, ' ')
}

function collapseWhitespace(value: string): string {
    return stripHtml(value)
        .replace(/\u001b\[[0-9;]*m/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function summarizeAssistantErrorText(value: string, maxLength = 120): string {
    const normalized = collapseWhitespace(value)
        .replace(/^error running remote compact task:\s*/i, '')
        .replace(/^unexpected status\s+/i, '')
        .replace(/^error:\s*/i, '')

    if (!normalized) return 'Connection failed.'

    const firstSentence = normalized.split(/(?<=[.!?])\s+(?=[A-Z])/)[0] || normalized
    if (firstSentence.length <= maxLength) return firstSentence
    return `${firstSentence.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function classifyAssistantRecoveryText(value: string): AssistantRecoveryClassification | null {
    const normalized = collapseWhitespace(value)
    if (!normalized) return null

    if (/assistant session not found|assistant session has no active thread/i.test(normalized)) {
        return {
            key: 'session-stale',
            title: 'Session lost',
            brief: 'Thread state went stale.',
            recoverable: true
        }
    }

    if (/502 bad gateway|unexpected status 502/i.test(normalized)) {
        return {
            key: 'upstream-502',
            title: 'ChatGPT upstream unavailable',
            brief: '502 Bad Gateway from the ChatGPT backend.',
            recoverable: true
        }
    }

    if (/503 service unavailable|unexpected status 503/i.test(normalized)) {
        return {
            key: 'upstream-503',
            title: 'ChatGPT upstream unavailable',
            brief: '503 Service Unavailable from the ChatGPT backend.',
            recoverable: true
        }
    }

    if (/504 gateway timeout|unexpected status 504/i.test(normalized)) {
        return {
            key: 'upstream-504',
            title: 'ChatGPT upstream unavailable',
            brief: '504 Gateway Timeout from the ChatGPT backend.',
            recoverable: true
        }
    }

    if (/error running remote compact task|chatgpt\.com\/backend-api\/codex|cloudflare/i.test(normalized)) {
        return {
            key: 'upstream-transient',
            title: 'ChatGPT upstream unavailable',
            brief: 'The ChatGPT backend returned an upstream failure.',
            recoverable: true
        }
    }

    if (isAssistantTransportFailure(normalized) || /timed out waiting for|session stopped before request completed|cannot write to .* stdin|pipe is being closed/i.test(normalized)) {
        return {
            key: 'connection-lost',
            title: 'Connection lost',
            brief: summarizeAssistantErrorText(normalized),
            recoverable: true
        }
    }

    if (/assistant runtime is unavailable|failed to load assistant/i.test(normalized)) {
        return {
            key: 'chatgpt-unavailable',
            title: 'ChatGPT unavailable',
            brief: summarizeAssistantErrorText(normalized),
            recoverable: false
        }
    }

    return {
        key: 'assistant-error',
        title: 'Assistant error',
        brief: summarizeAssistantErrorText(normalized),
        recoverable: false
    }
}

function collectCandidateTexts(
    threadLastError: string | null | undefined,
    commandError: string | null | undefined,
    activities: AssistantActivity[]
): string[] {
    const candidates: string[] = []
    const pushCandidate = (value: string | null | undefined) => {
        const normalized = collapseWhitespace(String(value || ''))
        if (!normalized) return
        if (!candidates.includes(normalized)) candidates.push(normalized)
    }

    pushCandidate(threadLastError)
    pushCandidate(commandError)

    for (const activity of activities) {
        if (
            activity.tone !== 'warning'
            && activity.tone !== 'error'
            && !ASSISTANT_RECOVERY_ACTIVITY_KINDS.has(activity.kind)
        ) {
            continue
        }
        pushCandidate(activity.detail || activity.summary)
        if (candidates.length >= 4) break
    }

    return candidates
}

export function getAssistantRecoveryIssue(input: {
    threadLastError?: string | null
    commandError?: string | null
    activities?: AssistantActivity[]
}): AssistantRecoveryIssue | null {
    const candidates = collectCandidateTexts(
        input.threadLastError,
        input.commandError,
        input.activities || []
    )

    for (const candidate of candidates) {
        const classification = classifyAssistantRecoveryText(candidate)
        if (!classification) continue
        return {
            ...classification,
            raw: candidate
        }
    }

    return null
}

export function isRecoverableAssistantReconnectError(error: string | null | undefined): boolean {
    if (!error || !String(error).trim()) return true
    return classifyAssistantRecoveryText(error)?.recoverable ?? false
}
