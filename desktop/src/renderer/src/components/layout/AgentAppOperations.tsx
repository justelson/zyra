import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RendererAppBridge, RendererAppOperation } from '@shared/agent-app-operations'
import { isAssistantRuntimeMode, type AssistantReasoningEffort } from '@shared/assistant/contracts'
import { isAssistantReasoningEffort, getAssistantModelReasoningEfforts } from '@shared/assistant/reasoning-efforts'
import { useSettings } from '@/lib/settings'
import { assistantStore } from '@/lib/assistant/assistant-store-core'
import { buildAssistantChatRoute } from '@/pages/assistant/assistant-chat-route'
import { getAssistantChatNavigationSnapshot, performAssistantChatOrderOperation, performAssistantChatPinOperation } from '@/pages/assistant/assistant-chat-navigation'
import { readRememberedChoices, rememberComposerChoices, normalizeRememberedChoices } from '@/pages/assistant/assistant-remembered-choices'
import { inspectAppComposer, stageAppComposer, appOwnerRevision, inspectAppQueue, operateAppQueue, type ChatComposerPatch } from '@/pages/assistant/assistant-app-owner-state'
import { readInstructorVoicePreferences, writeInstructorVoicePreferences, normalizeInstructorVoicePreferences } from '@/pages/assistant/instructor-voice-preferences'

declare global { interface Window { zyraAppOperations?: RendererAppBridge } }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function validateConfiguration(patch: Record<string, unknown>, current: ChatComposerPatch) {
    if (Object.keys(patch).some(key => !['model', 'effort', 'runtimeMode', 'fastModeEnabled'].includes(key))) throw new Error('Unsupported composer choice.')
    if (patch.model !== undefined && typeof patch.model !== 'string') throw new Error('Model must be an exact catalog ID.')
    if (patch.effort !== undefined && !isAssistantReasoningEffort(patch.effort)) throw new Error('Unsupported reasoning effort.')
    if (patch.runtimeMode !== undefined && !isAssistantRuntimeMode(patch.runtimeMode)) throw new Error('Unsupported permission mode.')
    if (patch.fastModeEnabled !== undefined && typeof patch.fastModeEnabled !== 'boolean') throw new Error('Fast mode must be boolean.')
    const state = { ...current, ...patch } as ChatComposerPatch
    const models = assistantStore.getState().snapshot.knownModels
    const model = models.find(model => model.id === state.model)
    if (!model) throw new Error('The selected model is unavailable. Refresh models; no replacement was selected.')
    const supported = getAssistantModelReasoningEfforts(model)
    if (state.effort && !(supported.length ? supported : ['off']).includes(state.effort as AssistantReasoningEffort)) throw new Error('That effort is unsupported by the selected model. No value was coerced.')
    return state
}

export function AgentAppOperations() {
    const { updateSettings } = useSettings()
    const navigate = useNavigate()
    useEffect(() => {
        const bridge = window.zyraAppOperations
        if (!bridge) return
        return bridge.onRequest(message => {
            void (async () => {
                try { bridge.respond({ requestId: message.requestId, result: await perform(message.request) }) }
                catch (error) { bridge.respond({ requestId: message.requestId, error: error instanceof Error ? error.message : 'Desktop app operation failed.' }) }
            })()
        })
        async function perform(request: RendererAppOperation): Promise<Record<string, unknown>> {
            const { domain, operation, params, actor } = request
            if (!actor?.canonicalChatId || !actor.namespaceId) throw new Error('Authenticated app principal is missing.')
            const input = record(params.input), patch = record(params.patch), area = String(params.area || ''), sessionId = String(params.target || '')
            if (params.surface === 'browser') throw new Error('This operation belongs to the Desktop profile, not a browser profile.')
            if (domain === 'app' && area === 'destination' && operation === 'open') {
                const route = String(input.route || '')
                if (!/^\/(?:settings(?:\/|$)|assistant\/chat\/|plugins(?:\/|$))/.test(route)) throw new Error('Unregistered in-app destination.')
                navigate(route)
                return { opened: true, route, reloaded: false }
            }
            if (domain === 'settings' && area === 'remembered') {
                const before = readRememberedChoices(undefined, { strict: true }), revision = appOwnerRevision('remembered', before)
                if (operation === 'get' || operation === 'list') return { owner: 'Desktop-profile remembered choices', revision, choices: before, effect: 'new-chats-only', existingChatsUnchanged: true }
                if (!['preview', 'apply'].includes(operation)) throw new Error('Remembered choices support get, preview and apply.')
                if (Object.keys(patch).some(key => !['model', 'effort', 'runtimeMode'].includes(key))) throw new Error('Unsupported remembered choice.')
                const choices = normalizeRememberedChoices({ ...before, ...patch })
                if (!choices) throw new Error('Invalid remembered choices.')
                validateConfiguration(patch, before)
                if (operation === 'preview') return { owner: 'Desktop-profile remembered choices', revision, before, after: choices, effect: 'new-chats-only', existingChatsUnchanged: true }
                if (actor.child || input.remember !== true || params.expectedRevision !== revision) throw new Error('Explicit remember intent and the current profile revision are required.')
                rememberComposerChoices(choices, { strict: true })
                let mirrorUpdated = true
                try { await updateSettings({ assistantDefaultModel: choices.model, assistantDefaultEffort: choices.effort, assistantDefaultRuntimeMode: choices.runtimeMode }) }
                catch { mirrorUpdated = false }
                return { applied: true, owner: 'Desktop-profile remembered choices', revision: appOwnerRevision('remembered', choices), before, choices, mirrorUpdated,
                    warning: mirrorUpdated ? null : 'Profile choices saved, but the main-process compatibility mirror did not acknowledge. Existing Chats were not changed.', effect: 'new-chats-only' }
            }
            if (domain === 'settings' && area === 'chat') {
                if (!sessionId) throw new Error('Choose an exact local Chat.')
                const before = inspectAppComposer(sessionId, record(input.base))
                if (operation === 'get' || operation === 'list') return { ...before, currentTurn: input.currentTurn || null }
                const next = validateConfiguration(patch, before.nextTurn)
                if (operation === 'preview') return { ...before, after: next }
                if (operation !== 'apply' || !actor.approved || actor.child) throw new Error('This next-turn change requires actual user approval.')
                return stageAppComposer(sessionId, patch as ChatComposerPatch, Number(params.expectedRevision), record(input.base))
            }
            if (domain === 'settings' && area === 'voice') {
                const before = readInstructorVoicePreferences(), revision = appOwnerRevision('voice', before)
                if (operation === 'get' || operation === 'list') return { owner: 'Desktop Voice Lab', revision, preferences: before, effect: 'next-voice-session' }
                if (Object.keys(patch).some(key => !['voice', 'outputModality', 'instructions'].includes(key))) throw new Error('Unsupported Voice Lab preference.')
                const next = normalizeInstructorVoicePreferences({ ...before, ...patch })
                if (JSON.stringify(next) !== JSON.stringify({ ...before, ...patch })) throw new Error('Voice preference is invalid; no fallback was silently applied.')
                if (operation === 'preview') return { revision, before, after: next, effect: 'next-voice-session' }
                if (operation !== 'apply' || params.expectedRevision !== revision || actor.child) throw new Error('Read the latest voice revision before applying.')
                writeInstructorVoicePreferences(next)
                if (JSON.stringify(readInstructorVoicePreferences()) !== JSON.stringify(next)) throw new Error('Voice preferences could not be saved.')
                return { applied: true, revision: appOwnerRevision('voice', next), preferences: next, effect: 'next-voice-session' }
            }
            const allowedIds = Array.isArray(input.allowedIds) ? input.allowedIds.filter((id): id is string => typeof id === 'string') : []
            if (area === 'order' || area === 'chats') {
                const snapshot = getAssistantChatNavigationSnapshot(allowedIds)
                if (operation === 'inspect' || operation === 'list') return { ...snapshot, persistence: 'Desktop-profile-local' }
                if (!['move', 'reorder', 'pin', 'unpin', 'undo', 'preview'].includes(operation)) throw new Error('Unsupported sidebar operation; reads never perform moves.')
                if (!allowedIds.includes(sessionId)) throw new Error('Chat is outside the authorized caller scope.')
                if (!snapshot.owner || input.owner !== snapshot.owner) throw new Error('Inspect the current exact sidebar owner first.')
                if (operation !== 'preview' && (actor.child || actor.permissionMode === 'read-only')) throw new Error('This caller cannot reorder or pin Chats.')
                if (operation === 'pin' || operation === 'unpin') return performAssistantChatPinOperation({ owner: snapshot.owner, expectedRevision: Number(params.expectedRevision), sessionId, pinned: operation === 'pin', allowedSessionIds: allowedIds })
                const group = input.group === 'pinned' ? 'pinned' : input.group === 'chats' ? 'chats' : null
                if (!group) throw new Error('Choose the explicit pinned or chats group.')
                if (operation === 'preview') return { snapshot, proposed: { sessionId, group, before: input.before || null, after: input.after || null }, applied: false }
                const result = operation === 'undo' ? performAssistantChatOrderOperation({ action: 'undo', owner: snapshot.owner, expectedRevision: Number(params.expectedRevision), undoToken: String(input.undoToken || ''), allowedSessionIds: allowedIds })
                    : performAssistantChatOrderOperation({ action: 'move', owner: snapshot.owner, expectedRevision: Number(params.expectedRevision), group, sessionId,
                        beforeSessionId: typeof input.before === 'string' ? input.before : undefined, afterSessionId: typeof input.after === 'string' ? input.after : undefined, allowedSessionIds: allowedIds })
                if (!result.success) throw new Error(result.error)
                return { ...result, persistence: 'Desktop-profile-local' }
            }
            if (area === 'queues') {
                if (!sessionId || !allowedIds.includes(sessionId)) throw new Error('Choose an authorized exact queue owner.')
                if (operation === 'inspect' || operation === 'list') return inspectAppQueue(sessionId)
                if (!['read', 'update', 'move', 'remove', 'hold', 'resume', 'stop'].includes(operation)) throw new Error('Unsupported queue operation.')
                if (operation !== 'read' && (actor.child || actor.permissionMode === 'read-only')) throw new Error('This caller cannot mutate queues.')
                if ((operation === 'stop' || operation === 'resume') && !actor.approved) throw new Error('Stop and Resume require actual user approval.')
                return operateAppQueue(sessionId, operation, input, typeof params.expectedRevision === 'number' ? params.expectedRevision : undefined)
            }
            if (area === 'navigation' && operation === 'open') {
                if (actor.child || actor.permissionMode === 'read-only') throw new Error('This caller cannot change navigation.')
                if (!allowedIds.includes(sessionId)) throw new Error('Chat is outside the authorized caller scope.')
                const chat = assistantStore.getState().snapshot.sessions.find(chat => chat.id === sessionId)
                if (!chat) throw new Error('Chat is unavailable.')
                navigate(buildAssistantChatRoute(chat.id, chat.activeThreadId))
                return { opened: true, sessionId: chat.id }
            }
            throw new Error('The requested Desktop profile operation is unavailable.')
        }
    }, [navigate, updateSettings])
    return null
}
