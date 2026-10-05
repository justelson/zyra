import type { AssistantBackgroundProcessesInput, AssistantStopBackgroundProcessesInput } from '../../shared/assistant/contracts'
import type { AssistantServiceActionDeps } from './service-action-deps'
import { requireSession } from './service-state'
import { getAssistantCanonicalThreadId, matchesAssistantThreadId } from './thread-identity'

export async function requestAssistantBackgroundProcesses(
    deps: AssistantServiceActionDeps,
    action: 'list' | 'stop',
    input: AssistantBackgroundProcessesInput | AssistantStopBackgroundProcessesInput
) {
    if (!input || typeof input.sessionId !== 'string' || !input.sessionId.trim()
        || typeof input.threadId !== 'string' || !input.threadId.trim()) throw new Error('A session and thread are required for process controls.')
    const stop = input as AssistantStopBackgroundProcessesInput
    if (action === 'stop' && ((typeof stop.jobId === 'string' && Boolean(stop.jobId.trim())) === (stop.all === true)
        || stop.jobId !== undefined && (typeof stop.jobId !== 'string' || !stop.jobId.trim()))) {
        throw new Error('Choose one process or explicitly stop all background processes.')
    }
    await deps.ensureReady()
    const session = requireSession(deps.getSnapshot(), input.sessionId)
    const thread = session.threads.find(entry => matchesAssistantThreadId(entry, input.threadId))
    if (!thread) throw new Error('The thread does not belong to this session.')
    const operation = deps.runtime.requestBackgroundProcessOperation
    if (!operation) throw new Error('This runtime does not support background process controls.')
    const runtimeThreadId = getAssistantCanonicalThreadId(thread)
    if (!deps.runtime.hasSession(runtimeThreadId)) {
        if (deps.connectSessionRuntime) await deps.connectSessionRuntime(session, thread)
        else await deps.runtime.connect(thread, deps.getSessionRuntimeCwd(session, thread), session.chatScope,
            deps.getSessionPluginSkillSources ? await deps.getSessionPluginSkillSources(session) : [])
    }
    const jobs = await operation.call(deps.runtime, runtimeThreadId, action, action === 'stop' ? { jobId: stop.jobId, all: stop.all } : {})
    return { success: true as const, runtimeAvailable: true, jobs }
}
