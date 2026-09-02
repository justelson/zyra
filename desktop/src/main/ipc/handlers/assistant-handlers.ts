import log from 'electron-log'
import type {
    AssistantApprovalResponseInput,
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantAssociateProjectFolderInput,
    AssistantAttachSessionToPlaygroundLabInput,
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateProjectInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantDeletePlaygroundLabInput,
    AssistantDeleteMessageInput,
    AssistantDismissProjectCandidateInput,
    AssistantGetHistoryPageInput,
    AssistantGetHistoryAroundMessageInput,
    AssistantHydrateHistoryBodyInput,
    AssistantGetReviewIndexInput,
    AssistantGetSessionTurnUsageInput,
    AssistantGetTurnDetailInput,
    AssistantIngestRealtimeVoiceEventInput,
    AssistantPersistClipboardImageInput,
    AssistantRedeemAccountResetInput,
    AssistantResolveClipboardAttachmentInput,
    AssistantRemoveProjectFolderInput,
    AssistantSearchChatsInput,
    AssistantSearchTurnsInput,
    AssistantSendPromptOptions,
    AssistantSendRealtimeVoiceMessageInput,
    AssistantSelectThreadInput,
    AssistantSkillSourceSettings,
    AssistantStartRealtimeVoiceInput,
    AssistantSetPlaygroundRootInput,
    AssistantSetSessionProjectInput,
    AssistantTranscribeVoiceInput,
    AssistantUpdateProjectInput,
    AssistantUserInputResponseInput,
    FleetOperationInput
} from '../../../shared/assistant/contracts'
import { getAssistantService } from '../../assistant'
import { hasActiveBrowserAssistantClient } from '../../assistant/browser-client-lease'
import { persistAssistantClipboardImage, resolveAssistantClipboardAttachment } from '../../assistant/clipboard-attachments'
import {
    getCodexVoiceTranscriptionState,
    transcribeVoiceWithCodex
} from '../../assistant/codex-voice-transcription'

async function withAssistantResult<T>(work: () => Promise<T> | T): Promise<T | { success: false; error: string }> {
    try {
        return await work()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Assistant request failed.'
        log.error('Assistant IPC failed:', error)
        return { success: false as const, error: message }
    }
}

function withDesktopAssistantSelectionLease<T>(work: () => Promise<T> | T) {
    if (hasActiveBrowserAssistantClient()) {
        return Promise.resolve({
            success: false as const,
            error: 'The browser app is currently controlling Assistant chat selection.'
        })
    }
    return withAssistantResult(work)
}

export function handleAssistantSubscribe(event: Electron.IpcMainInvokeEvent) {
    log.info('IPC: assistant:subscribe', { senderId: event.sender.id })
    return withAssistantResult(() => getAssistantService().subscribe(event.sender.id))
}

export function handleAssistantUnsubscribe(event: Electron.IpcMainInvokeEvent) {
    log.info('IPC: assistant:unsubscribe', { senderId: event.sender.id })
    return withAssistantResult(() => getAssistantService().unsubscribe(event.sender.id))
}

export function handleAssistantSubscribeRealtimeVoice(event: Electron.IpcMainInvokeEvent) {
    return withAssistantResult(() => getAssistantService().subscribeRealtimeVoice(event.sender.id))
}

export function handleAssistantUnsubscribeRealtimeVoice(event: Electron.IpcMainInvokeEvent) {
    return withAssistantResult(() => getAssistantService().unsubscribeRealtimeVoice(event.sender.id))
}

export async function handleAssistantBootstrap() {
    return getAssistantService().getBootstrap()
}

export async function handleAssistantGetSnapshot() {
    return getAssistantService().getSnapshot()
}

export async function handleAssistantGetStatus() {
    return getAssistantService().getStatus()
}

export function handleAssistantGetFleetSnapshot(_event: Electron.IpcMainInvokeEvent, threadId: string) {
    return withAssistantResult(() => getAssistantService().getFleetSnapshot(threadId))
}

export function handleAssistantAgentAction(_event: Electron.IpcMainInvokeEvent, input: FleetOperationInput) {
    return withAssistantResult(() => getAssistantService().runFleetOperation('agents', input))
}

export function handleAssistantWorkflowAction(_event: Electron.IpcMainInvokeEvent, input: FleetOperationInput) {
    return withAssistantResult(() => getAssistantService().runFleetOperation('workflows', input))
}

export function handleAssistantGetAccountOverview(_event: Electron.IpcMainInvokeEvent, forceRefresh?: boolean) {
    return withAssistantResult(() => getAssistantService().getAccountOverview(Boolean(forceRefresh)))
}

export function handleAssistantRedeemAccountReset(_event: Electron.IpcMainInvokeEvent, input: AssistantRedeemAccountResetInput) {
    return withAssistantResult(() => getAssistantService().redeemAccountReset(input))
}

export function handleAssistantGetSessionTurnUsage(_event: Electron.IpcMainInvokeEvent, input?: AssistantGetSessionTurnUsageInput) {
    log.info('IPC: assistant:getSessionTurnUsage', { sessionId: input?.sessionId })
    return withAssistantResult(() => getAssistantService().getSessionTurnUsage(input))
}

export function handleAssistantListModels(_event: Electron.IpcMainInvokeEvent, forceRefresh?: boolean) {
    log.info('IPC: assistant:listModels', { forceRefresh: Boolean(forceRefresh) })
    return withAssistantResult(() => getAssistantService().listModels(Boolean(forceRefresh)))
}

export function handleAssistantListProjects() {
    return withAssistantResult(() => getAssistantService().listProjects())
}

export function handleAssistantCreateProject(
    _event: Electron.IpcMainInvokeEvent,
    input: AssistantCreateProjectInput,
    candidateId?: string
) {
    return withAssistantResult(() => getAssistantService().createProject(input, candidateId))
}

export function handleAssistantAssociateProjectFolder(
    _event: Electron.IpcMainInvokeEvent,
    input: AssistantAssociateProjectFolderInput
) {
    return withAssistantResult(() => getAssistantService().associateProjectFolder(input))
}

export function handleAssistantRemoveProjectFolder(
    _event: Electron.IpcMainInvokeEvent,
    input: AssistantRemoveProjectFolderInput
) {
    return withAssistantResult(() => getAssistantService().removeProjectFolder(input))
}

export function handleAssistantUpdateProject(
    _event: Electron.IpcMainInvokeEvent,
    input: AssistantUpdateProjectInput
) {
    return withAssistantResult(() => getAssistantService().updateProject(input))
}

export function handleAssistantDismissProjectCandidate(
    _event: Electron.IpcMainInvokeEvent,
    input: AssistantDismissProjectCandidateInput
) {
    return withAssistantResult(() => getAssistantService().dismissProjectCandidate(input))
}

export function handleAssistantListPromptResources(
    _event: Electron.IpcMainInvokeEvent,
    projectPath?: string | null,
    forceRefresh = false
) {
    return withAssistantResult(() => getAssistantService().listPromptResources(projectPath, forceRefresh === true))
}

export function handleAssistantGetSkillSourceOverview(
    _event: Electron.IpcMainInvokeEvent,
    projectPath?: string | null
) {
    return withAssistantResult(() => getAssistantService().getSkillSourceOverview(projectPath))
}

export function handleAssistantUpdateSkillSourceSettings(
    _event: Electron.IpcMainInvokeEvent,
    settings: AssistantSkillSourceSettings,
    projectPath?: string | null
) {
    return withAssistantResult(() => getAssistantService().updateSkillSourceSettings(settings, projectPath))
}

export function handleAssistantConnect(_event: Electron.IpcMainInvokeEvent, options?: AssistantConnectOptions) {
    log.info('IPC: assistant:connect', { options })
    return withDesktopAssistantSelectionLease(() => getAssistantService().connect(options))
}

export function handleAssistantDisconnect(_event: Electron.IpcMainInvokeEvent, sessionId?: string) {
    log.info('IPC: assistant:disconnect', { sessionId })
    return withDesktopAssistantSelectionLease(() => getAssistantService().disconnect(sessionId))
}

export function handleAssistantCreateSession(_event: Electron.IpcMainInvokeEvent, input?: AssistantCreateSessionInput) {
    log.info('IPC: assistant:createSession', { input })
    return withDesktopAssistantSelectionLease(() => getAssistantService().createSession(input))
}

export function handleAssistantSelectSession(_event: Electron.IpcMainInvokeEvent, sessionId: string) {
    log.info('IPC: assistant:selectSession', { sessionId })
    return withDesktopAssistantSelectionLease(() => getAssistantService().selectSession(sessionId))
}

export function handleAssistantSelectThread(_event: Electron.IpcMainInvokeEvent, input: AssistantSelectThreadInput) {
    log.info('IPC: assistant:selectThread', { sessionId: input?.sessionId, threadId: input?.threadId })
    return withDesktopAssistantSelectionLease(() => getAssistantService().selectThread(input.sessionId, input.threadId))
}

export function handleAssistantGetThreadDetailBootstrap(_event: Electron.IpcMainInvokeEvent, threadId: string) {
    log.info('IPC: assistant:getThreadDetailBootstrap', { threadId })
    return withAssistantResult(() => getAssistantService().getThreadDetailBootstrap(threadId))
}

export function handleAssistantGetHistoryPage(_event: Electron.IpcMainInvokeEvent, input: AssistantGetHistoryPageInput) {
    log.info('IPC: assistant:getHistoryPage', { threadId: input?.threadId, hasCursor: Boolean(input?.before) })
    return withAssistantResult(() => getAssistantService().getHistoryPage(input))
}

export function handleAssistantGetHistoryAroundMessage(_event: Electron.IpcMainInvokeEvent, input: AssistantGetHistoryAroundMessageInput) {
    log.info('IPC: assistant:getHistoryAroundMessage', { threadId: input?.threadId, messageId: input?.messageId })
    return withAssistantResult(() => getAssistantService().getHistoryAroundMessage(input.threadId, input.messageId, input.turnLimit))
}

export function handleAssistantHydrateHistoryBody(_event: Electron.IpcMainInvokeEvent, input: AssistantHydrateHistoryBodyInput) {
    log.info('IPC: assistant:hydrateHistoryBody', { activityId: input?.activityId })
    return withAssistantResult(() => getAssistantService().hydrateHistoryBody(input))
}

export function handleAssistantGetReviewIndex(_event: Electron.IpcMainInvokeEvent, input: AssistantGetReviewIndexInput) {
    log.info('IPC: assistant:getReviewIndex', { threadId: input?.threadId })
    return withAssistantResult(() => getAssistantService().getReviewIndex(input.threadId))
}

export function handleAssistantGetTurnDetail(_event: Electron.IpcMainInvokeEvent, input: AssistantGetTurnDetailInput) {
    log.info('IPC: assistant:getTurnDetail', { threadId: input?.threadId, turnId: input?.turnId })
    return withAssistantResult(() => getAssistantService().getTurnDetail(input.threadId, input.turnId))
}

export function handleAssistantSearchChats(_event: Electron.IpcMainInvokeEvent, input: AssistantSearchChatsInput) {
    log.info('IPC: assistant:searchChats', { queryLength: input?.query?.length || 0, scope: input?.scope })
    return withAssistantResult(() => getAssistantService().searchChats(input))
}

export function handleAssistantSearchTurns(_event: Electron.IpcMainInvokeEvent, input: AssistantSearchTurnsInput) {
    log.info('IPC: assistant:searchTurns', { threadId: input?.threadId, queryLength: input?.query?.length || 0 })
    return withAssistantResult(() => getAssistantService().searchTurns(input.threadId, input.query, input.limit))
}

export function handleAssistantRenameSession(_event: Electron.IpcMainInvokeEvent, sessionId: string, title: string) {
    log.info('IPC: assistant:renameSession', { sessionId })
    return withAssistantResult(() => getAssistantService().renameSession(sessionId, title))
}

export function handleAssistantRegenerateSessionTitle(_event: Electron.IpcMainInvokeEvent, sessionId: string) {
    log.info('IPC: assistant:regenerateSessionTitle', { sessionId })
    return withAssistantResult(() => getAssistantService().regenerateSessionTitle(sessionId))
}

export function handleAssistantArchiveSession(_event: Electron.IpcMainInvokeEvent, sessionId: string, archived?: boolean) {
    log.info('IPC: assistant:archiveSession', { sessionId, archived: archived !== false })
    return withAssistantResult(() => getAssistantService().archiveSession(sessionId, archived))
}

export function handleAssistantDeleteSession(_event: Electron.IpcMainInvokeEvent, sessionId: string) {
    log.info('IPC: assistant:deleteSession', { sessionId })
    return withAssistantResult(() => getAssistantService().deleteSession(sessionId))
}

export function handleAssistantDeleteMessage(_event: Electron.IpcMainInvokeEvent, input: AssistantDeleteMessageInput) {
    log.info('IPC: assistant:deleteMessage', { sessionId: input?.sessionId, messageId: input?.messageId })
    return withAssistantResult(() => getAssistantService().deleteMessage(input))
}

export function handleAssistantClearLogs(_event: Electron.IpcMainInvokeEvent, input?: AssistantClearLogsInput) {
    log.info('IPC: assistant:clearLogs', { sessionId: input?.sessionId })
    return withAssistantResult(() => getAssistantService().clearLogs(input))
}

export function handleAssistantSetSessionProject(
    _event: Electron.IpcMainInvokeEvent,
    sessionId: string,
    input: AssistantSetSessionProjectInput
) {
    log.info('IPC: assistant:setSessionProject', { sessionId, projectId: input?.projectId || null })
    return withAssistantResult(() => getAssistantService().setSessionProject(sessionId, input))
}

export function handleAssistantSetSessionProjectPath(_event: Electron.IpcMainInvokeEvent, sessionId: string, projectPath: string | null) {
    log.info('IPC: assistant:setSessionProjectPath', { sessionId, hasProjectPath: Boolean(projectPath) })
    return withAssistantResult(() => getAssistantService().setSessionProjectPath(sessionId, projectPath))
}

export function handleAssistantSetPlaygroundRoot(_event: Electron.IpcMainInvokeEvent, input: AssistantSetPlaygroundRootInput) {
    log.info('IPC: assistant:setPlaygroundRoot', { hasRootPath: Boolean(input?.rootPath) })
    return withAssistantResult(() => getAssistantService().setPlaygroundRoot(input))
}

export function handleAssistantCreatePlaygroundLab(_event: Electron.IpcMainInvokeEvent, input: AssistantCreatePlaygroundLabInput) {
    log.info('IPC: assistant:createPlaygroundLab', { source: input?.source, openSession: input?.openSession === true })
    return withAssistantResult(() => getAssistantService().createPlaygroundLab(input))
}

export function handleAssistantDeletePlaygroundLab(_event: Electron.IpcMainInvokeEvent, input: AssistantDeletePlaygroundLabInput) {
    log.info('IPC: assistant:deletePlaygroundLab', { labId: input?.labId })
    return withAssistantResult(() => getAssistantService().deletePlaygroundLab(input))
}

export function handleAssistantAttachSessionToPlaygroundLab(_event: Electron.IpcMainInvokeEvent, input: AssistantAttachSessionToPlaygroundLabInput) {
    log.info('IPC: assistant:attachSessionToPlaygroundLab', { sessionId: input?.sessionId, labId: input?.labId })
    return withAssistantResult(() => getAssistantService().attachSessionToPlaygroundLab(input))
}

export function handleAssistantApprovePendingPlaygroundLabRequest(_event: Electron.IpcMainInvokeEvent, input: AssistantApprovePendingPlaygroundLabRequestInput) {
    log.info('IPC: assistant:approvePendingPlaygroundLabRequest', { sessionId: input?.sessionId, source: input?.source })
    return withAssistantResult(() => getAssistantService().approvePendingPlaygroundLabRequest(input))
}

export function handleAssistantDeclinePendingPlaygroundLabRequest(_event: Electron.IpcMainInvokeEvent, input: AssistantDeclinePendingPlaygroundLabRequestInput) {
    log.info('IPC: assistant:declinePendingPlaygroundLabRequest', { sessionId: input?.sessionId })
    return withAssistantResult(() => getAssistantService().declinePendingPlaygroundLabRequest(input))
}

export function handleAssistantPersistClipboardImage(_event: Electron.IpcMainInvokeEvent, input: AssistantPersistClipboardImageInput) {
    return withAssistantResult(async () => ({
        success: true as const,
        path: await persistAssistantClipboardImage(input)
    }))
}

export function handleAssistantResolveClipboardAttachment(_event: Electron.IpcMainInvokeEvent, input: AssistantResolveClipboardAttachmentInput) {
    return withAssistantResult(async () => ({
        success: true as const,
        path: await resolveAssistantClipboardAttachment(input.reference)
    }))
}

export function handleAssistantNewThread(_event: Electron.IpcMainInvokeEvent, sessionId?: string) {
    log.info('IPC: assistant:newThread', { sessionId })
    return withDesktopAssistantSelectionLease(() => getAssistantService().newThread(sessionId))
}

export function handleAssistantSendPrompt(_event: Electron.IpcMainInvokeEvent, prompt: string, options?: AssistantSendPromptOptions) {
    log.info('IPC: assistant:sendPrompt', { sessionId: options?.sessionId, model: options?.model })
    return withAssistantResult(() => getAssistantService().sendPrompt(prompt, options))
}

export function handleAssistantInterruptTurn(_event: Electron.IpcMainInvokeEvent, turnId?: string, sessionId?: string) {
    log.info('IPC: assistant:interruptTurn', { turnId, sessionId })
    return withAssistantResult(() => getAssistantService().interruptTurn(turnId, sessionId))
}

export function handleAssistantRespondApproval(_event: Electron.IpcMainInvokeEvent, input: AssistantApprovalResponseInput) {
    log.info('IPC: assistant:respondApproval', { requestId: input?.requestId, decision: input?.decision })
    return withAssistantResult(() => getAssistantService().respondApproval(input))
}

export function handleAssistantRespondUserInput(_event: Electron.IpcMainInvokeEvent, input: AssistantUserInputResponseInput) {
    log.info('IPC: assistant:respondUserInput', { requestId: input?.requestId })
    return withAssistantResult(() => getAssistantService().respondUserInput(input))
}

export function handleAssistantStartRealtimeVoice(event: Electron.IpcMainInvokeEvent, input: AssistantStartRealtimeVoiceInput) {
    log.info('IPC: assistant:realtimeVoice:start', {
        sdpLength: input?.sdp?.length || 0,
        instructionsLength: input?.instructions?.length || 0,
        voice: input?.voice,
        outputModality: input?.outputModality,
        selectedModel: input?.executionConfiguration?.model,
        selectedRuntimeMode: input?.executionConfiguration?.runtimeMode
    })
    return withAssistantResult(() => getAssistantService().startRealtimeVoice(input, event.sender.id))
}

export function handleAssistantSendRealtimeVoiceMessage(
    event: Electron.IpcMainInvokeEvent,
    input: AssistantSendRealtimeVoiceMessageInput
) {
    log.info('IPC: assistant:realtimeVoice:sendMessage', {
        textLength: input?.text?.length || 0,
        imageCount: input?.images?.length || 0
    })
    return withAssistantResult(() => getAssistantService().sendRealtimeVoiceMessage(input, event.sender.id))
}

export function handleAssistantIngestRealtimeVoiceEvent(
    event: Electron.IpcMainInvokeEvent,
    input: AssistantIngestRealtimeVoiceEventInput
) {
    return withAssistantResult(() => getAssistantService().ingestRealtimeVoiceEvent(input, event.sender.id))
}

export function handleAssistantStopRealtimeVoice(event: Electron.IpcMainInvokeEvent) {
    log.info('IPC: assistant:realtimeVoice:stop')
    return withAssistantResult(() => getAssistantService().stopRealtimeVoice(event.sender.id))
}

export function handleAssistantGetVoiceTranscriptionState() {
    return withAssistantResult(async () => ({
        success: true as const,
        state: await getCodexVoiceTranscriptionState()
    }))
}

export function handleAssistantTranscribeVoice(_event: Electron.IpcMainInvokeEvent, input: AssistantTranscribeVoiceInput) {
    log.info('IPC: assistant:transcribeVoice', {
        durationMs: Number(input?.durationMs) || 0,
        encodedLength: typeof input?.audioBase64 === 'string' ? input.audioBase64.length : 0
    })
    return withAssistantResult(async () => ({
        success: true as const,
        text: await transcribeVoiceWithCodex(input)
    }))
}
