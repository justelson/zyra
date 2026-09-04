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
    answers: Record<string, AssistantUserInputAnswer>
}): Promise<string> {
    const canonicalThreadId = getAssistantCanonicalThreadId(input.thread)
    if (!input.runtime.hasSession(canonicalThreadId)) {
        await input.runtime.connect(input.thread, input.cwd, input.chatScope)
    }
    try {
        const result = await input.runtime.respondUserInput(canonicalThreadId, input.requestId, input.answers, input.questions)
        if (result?.continuationPrompt) return result.continuationPrompt
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/unknown user-input request/i.test(message)) throw error
    }
    return formatAssistantUserInputContinuationPrompt(input.questions, input.answers)
}
