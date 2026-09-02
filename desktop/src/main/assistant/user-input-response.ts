import type { AssistantChatScope, AssistantThread, AssistantUserInputAnswer } from '../../shared/assistant/contracts'
import type { AssistantRuntimeBridge } from './service-action-deps'
import { getAssistantCanonicalThreadId } from './thread-identity'

export async function respondToAssistantUserInputWithRuntime(input: {
    runtime: Pick<AssistantRuntimeBridge, 'hasSession' | 'connect' | 'respondUserInput'>
    thread: AssistantThread
    cwd: string
    chatScope?: AssistantChatScope | null
    requestId: string
    answers: Record<string, AssistantUserInputAnswer>
}): Promise<void> {
    const canonicalThreadId = getAssistantCanonicalThreadId(input.thread)
    if (!input.runtime.hasSession(canonicalThreadId)) {
        await input.runtime.connect(input.thread, input.cwd, input.chatScope)
    }
    await input.runtime.respondUserInput(canonicalThreadId, input.requestId, input.answers)
}
