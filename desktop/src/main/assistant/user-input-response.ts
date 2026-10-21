import type { AssistantChatScope, AssistantThread, AssistantUserInputAnswer, AssistantUserInputQuestion } from '../../shared/assistant/contracts'
import { formatAssistantUserInputContinuationPrompt } from '../../shared/assistant/user-input-continuation'
import type { AssistantRuntimeBridge } from './service-action-deps'
import { getAssistantCanonicalThreadId } from './thread-identity'

export async function respondToAssistantUserInputWithRuntime(input: {
    runtime: Pick<AssistantRuntimeBridge, 'hasSession' | 'connect' | 'respondUserInput'>
    thread: AssistantThread
    cwd: string
    chatScope?: AssistantChatScope | null
    requestId: string
    questions: AssistantUserInputQuestion[]
    mode?: 'blocking' | 'async'
    answers: Record<string, AssistantUserInputAnswer>
}): Promise<string> {
    const canonicalThreadId = getAssistantCanonicalThreadId(input.thread)
    if (!input.runtime.hasSession(canonicalThreadId)) {
        await input.runtime.connect(input.thread, input.cwd, input.chatScope)
    }
    try {
        const result = await input.runtime.respondUserInput(canonicalThreadId, input.requestId, input.answers, input.questions, { mode: input.mode })
        if (result?.continuationPrompt) return result.continuationPrompt
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null
        // A restarted server may have lost its in-memory handoff. The caller
        // already verified the saved pending question; continue from that exact
        // record, never from arbitrary renderer-supplied questions. Conflicts,
        // transport failures and uncertain responses must still reject.
        if (code !== 'AGENT_SERVER_USER_INPUT_UNKNOWN' && !(!code && /unknown user-input request/i.test(message))) throw error
    }
    return formatAssistantUserInputContinuationPrompt(input.questions, input.answers)
}
