import { useMemo } from 'react'
import { AssistantPermissionQuestion } from './AssistantPermissionQuestion'
import type { AssistantPendingUserInput } from '@shared/assistant/contracts'
import {
    PLAYGROUND_TERMINAL_ACCESS_APPROVE_OPTION,
    PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID,
    PLAYGROUND_TERMINAL_ACCESS_DECLINE_OPTION
} from '@shared/assistant/playground-terminal-access'

function findTerminalAccessQuestion(request: AssistantPendingUserInput) {
    return request.questions.find((question) => question.id === PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID) || request.questions[0] || null
}

export function getPendingTerminalAccessRequest(pendingUserInputs: AssistantPendingUserInput[]): AssistantPendingUserInput | null {
    return pendingUserInputs.find((request) => (
        request.status === 'pending'
        && request.questions.some((question) => question.id === PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID)
    )) || null
}

export function AssistantPendingTerminalAccessPanel(props: {
    request: AssistantPendingUserInput
    responding: boolean
    onRespond: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
    onSetTerminalAccess: (enabled: boolean) => void
    onSetRequestMuted: (muted: boolean) => void
}) {
    const {
        request,
        responding,
        onRespond,
        onSetTerminalAccess,
        onSetRequestMuted
    } = props
    const question = useMemo(() => findTerminalAccessQuestion(request), [request])

    if (!question) return null

    const respond = async (enabled: boolean, mute: boolean) => {
        if (responding) return
        onSetTerminalAccess(enabled)
        if (enabled) onSetRequestMuted(false)
        else if (mute) onSetRequestMuted(true)
        await onRespond(request.requestId, {
            [PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID]: enabled
                ? PLAYGROUND_TERMINAL_ACCESS_APPROVE_OPTION
                : PLAYGROUND_TERMINAL_ACCESS_DECLINE_OPTION
        })
    }

    return <AssistantPermissionQuestion key={request.requestId} title={question.question || 'Allow terminal access in the Playground folder?'} busy={responding}
        choices={[{ label: 'Continue without', description: 'Keep terminal access off.' },
            { label: 'Keep terminal off for this chat', description: 'Also mute future terminal requests here.' },
            { label: 'Allow terminal', description: 'Let the assistant run commands in the Playground folder.' }]}
        onAnswer={label => respond(label === 'Allow terminal', label === 'Keep terminal off for this chat')} />
}
