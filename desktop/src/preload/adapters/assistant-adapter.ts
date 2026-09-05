import { ipcRenderer, webUtils } from 'electron'
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
    AssistantEventStreamPayload,
    AssistantGetHistoryPageInput,
    AssistantGetHistoryAroundMessageInput,
    AssistantHydrateHistoryBodyInput,
    AssistantGetReviewIndexInput,
    AssistantGetTurnDetailInput,
    AssistantIngestRealtimeVoiceEventInput,
    AssistantCreatePluginChatInput,
    AssistantPluginDownloadInput,
    AssistantStartPluginDownloadInput,
    AssistantInspectLocalPluginInput,
    AssistantInstallInspectedPluginInput,
    AssistantPersistClipboardImageInput,
    AssistantRealtimeVoiceEvent,
    AssistantRedeemAccountResetInput,
    AssistantResolveClipboardAttachmentInput,
    AssistantRemoveProjectFolderInput,
    AssistantRefreshChatPluginScopeInput,
    AssistantRollbackPluginInput,
    AssistantSearchChatsInput,
    AssistantSearchTurnsInput,
    AssistantSendPromptOptions,
    AssistantSendRealtimeVoiceMessageInput,
    AssistantSelectThreadInput,
    AssistantSkillSourceSettings,
    AssistantStartRealtimeVoiceInput,
    AssistantSetPlaygroundRootInput,
    AssistantSetPluginSetInput,
    AssistantSetPluginStateInput,
    AssistantSetSessionProjectInput,
    AssistantTranscribeVoiceInput,
    AssistantUpdateProjectInput,
    AssistantUserInputResponseInput,
    FleetOperationInput
} from '../../shared/assistant/contracts'
import { ASSISTANT_IPC, assertAssistantIpcContract } from '../../shared/assistant/contracts'

export function createAssistantAdapter() {
    assertAssistantIpcContract()

    return {
        assistant: {
            subscribe: () => ipcRenderer.invoke(ASSISTANT_IPC.subscribe),
            unsubscribe: () => ipcRenderer.invoke(ASSISTANT_IPC.unsubscribe),
            bootstrap: () => ipcRenderer.invoke(ASSISTANT_IPC.bootstrap),
            getSnapshot: () => ipcRenderer.invoke(ASSISTANT_IPC.getSnapshot),
            getFleetSnapshot: (threadId: string) => ipcRenderer.invoke(ASSISTANT_IPC.getFleetSnapshot, threadId),
            agentAction: (input: FleetOperationInput) => ipcRenderer.invoke(ASSISTANT_IPC.agentAction, input),
            workflowAction: (input: FleetOperationInput) => ipcRenderer.invoke(ASSISTANT_IPC.workflowAction, input),
            getStatus: () => ipcRenderer.invoke(ASSISTANT_IPC.getStatus),
            getAccountOverview: (forceRefresh = false) => ipcRenderer.invoke(ASSISTANT_IPC.getAccountOverview, forceRefresh),
            redeemAccountReset: (input: AssistantRedeemAccountResetInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.redeemAccountReset, input),
            getSessionTurnUsage: (input?: { sessionId?: string }) => ipcRenderer.invoke(ASSISTANT_IPC.getSessionTurnUsage, input),
            listModels: (forceRefresh = false) => ipcRenderer.invoke(ASSISTANT_IPC.listModels, forceRefresh),
            listProjects: () => ipcRenderer.invoke(ASSISTANT_IPC.listProjects),
            getPluginCatalog: () => ipcRenderer.invoke(ASSISTANT_IPC.getPluginCatalog),
            startPluginDownload: (input: AssistantStartPluginDownloadInput) => ipcRenderer.invoke(ASSISTANT_IPC.startPluginDownload, input),
            getPluginDownload: (input: AssistantPluginDownloadInput) => ipcRenderer.invoke(ASSISTANT_IPC.getPluginDownload, input),
            cancelPluginDownload: (input: AssistantPluginDownloadInput) => ipcRenderer.invoke(ASSISTANT_IPC.cancelPluginDownload, input),
            createPluginChat: (input: AssistantCreatePluginChatInput) => ipcRenderer.invoke(ASSISTANT_IPC.createPluginChat, input),
            inspectLocalPlugin: (input: AssistantInspectLocalPluginInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.inspectLocalPlugin, input),
            installInspectedPlugin: (input: AssistantInstallInspectedPluginInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.installInspectedPlugin, input),
            setPluginSet: (input: AssistantSetPluginSetInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.setPluginSet, input),
            refreshChatPluginScope: (input: AssistantRefreshChatPluginScopeInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.refreshChatPluginScope, input),
            setPluginState: (input: AssistantSetPluginStateInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.setPluginState, input),
            rollbackPlugin: (input: AssistantRollbackPluginInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.rollbackPlugin, input),
            createProject: (input: AssistantCreateProjectInput, candidateId?: string) =>
                ipcRenderer.invoke(ASSISTANT_IPC.createProject, input, candidateId),
            associateProjectFolder: (input: AssistantAssociateProjectFolderInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.associateProjectFolder, input),
            removeProjectFolder: (input: AssistantRemoveProjectFolderInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.removeProjectFolder, input),
            updateProject: (input: AssistantUpdateProjectInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.updateProject, input),
            dismissProjectCandidate: (input: AssistantDismissProjectCandidateInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.dismissProjectCandidate, input),
            listPromptResources: (projectPath?: string | null, forceRefresh = false) =>
                ipcRenderer.invoke(ASSISTANT_IPC.listPromptResources, projectPath, forceRefresh),
            getSkillSourceOverview: (projectPath?: string | null) =>
                ipcRenderer.invoke(ASSISTANT_IPC.getSkillSourceOverview, projectPath),
            updateSkillSourceSettings: (settings: AssistantSkillSourceSettings, projectPath?: string | null) =>
                ipcRenderer.invoke(ASSISTANT_IPC.updateSkillSourceSettings, settings, projectPath),
            connect: (options?: AssistantConnectOptions) => ipcRenderer.invoke(ASSISTANT_IPC.connect, options),
            disconnect: (sessionId?: string) => ipcRenderer.invoke(ASSISTANT_IPC.disconnect, sessionId),
            createSession: (input?: AssistantCreateSessionInput) => ipcRenderer.invoke(ASSISTANT_IPC.createSession, input),
            selectSession: (sessionId: string) => ipcRenderer.invoke(ASSISTANT_IPC.selectSession, sessionId),
            selectThread: (input: AssistantSelectThreadInput) => ipcRenderer.invoke(ASSISTANT_IPC.selectThread, input),
            getThreadDetailBootstrap: (threadId: string) => ipcRenderer.invoke(ASSISTANT_IPC.getThreadDetailBootstrap, threadId),
            getHistoryPage: (input: AssistantGetHistoryPageInput) => ipcRenderer.invoke(ASSISTANT_IPC.getHistoryPage, input),
            getHistoryAroundMessage: (input: AssistantGetHistoryAroundMessageInput) => ipcRenderer.invoke(ASSISTANT_IPC.getHistoryAroundMessage, input),
            hydrateHistoryBody: (input: AssistantHydrateHistoryBodyInput) => ipcRenderer.invoke(ASSISTANT_IPC.hydrateHistoryBody, input),
            getReviewIndex: (input: AssistantGetReviewIndexInput) => ipcRenderer.invoke(ASSISTANT_IPC.getReviewIndex, input),
            getTurnDetail: (input: AssistantGetTurnDetailInput) => ipcRenderer.invoke(ASSISTANT_IPC.getTurnDetail, input),
            searchChats: (input: AssistantSearchChatsInput) => ipcRenderer.invoke(ASSISTANT_IPC.searchChats, input),
            searchTurns: (input: AssistantSearchTurnsInput) => ipcRenderer.invoke(ASSISTANT_IPC.searchTurns, input),
            renameSession: (sessionId: string, title: string) => ipcRenderer.invoke(ASSISTANT_IPC.renameSession, sessionId, title),
            regenerateSessionTitle: (sessionId: string) => ipcRenderer.invoke(ASSISTANT_IPC.regenerateSessionTitle, sessionId),
            archiveSession: (sessionId: string, archived = true) => ipcRenderer.invoke(ASSISTANT_IPC.archiveSession, sessionId, archived),
            deleteSession: (sessionId: string) => ipcRenderer.invoke(ASSISTANT_IPC.deleteSession, sessionId),
            deleteMessage: (input: AssistantDeleteMessageInput) => ipcRenderer.invoke(ASSISTANT_IPC.deleteMessage, input),
            clearLogs: (input?: AssistantClearLogsInput) => ipcRenderer.invoke(ASSISTANT_IPC.clearLogs, input),
            setSessionProject: (sessionId: string, input: AssistantSetSessionProjectInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.setSessionProject, sessionId, input),
            setSessionProjectPath: (sessionId: string, projectPath: string | null) =>
                ipcRenderer.invoke(ASSISTANT_IPC.setSessionProjectPath, sessionId, projectPath),
            setPlaygroundRoot: (input: AssistantSetPlaygroundRootInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.setPlaygroundRoot, input),
            createPlaygroundLab: (input: AssistantCreatePlaygroundLabInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.createPlaygroundLab, input),
            deletePlaygroundLab: (input: AssistantDeletePlaygroundLabInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.deletePlaygroundLab, input),
            attachSessionToPlaygroundLab: (input: AssistantAttachSessionToPlaygroundLabInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.attachSessionToPlaygroundLab, input),
            approvePendingPlaygroundLabRequest: (input: AssistantApprovePendingPlaygroundLabRequestInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.approvePendingPlaygroundLabRequest, input),
            declinePendingPlaygroundLabRequest: (input: AssistantDeclinePendingPlaygroundLabRequestInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.declinePendingPlaygroundLabRequest, input),
            getPathForFile: (file: File) => webUtils.getPathForFile(file),
            persistClipboardImage: (input: AssistantPersistClipboardImageInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.persistClipboardImage, input),
            resolveClipboardAttachment: (input: AssistantResolveClipboardAttachmentInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.resolveClipboardAttachment, input),
            newThread: (sessionId?: string) => ipcRenderer.invoke(ASSISTANT_IPC.newThread, sessionId),
            sendPrompt: (prompt: string, options?: AssistantSendPromptOptions) => ipcRenderer.invoke(ASSISTANT_IPC.sendPrompt, prompt, options),
            interruptTurn: (turnId?: string, sessionId?: string) => ipcRenderer.invoke(ASSISTANT_IPC.interruptTurn, turnId, sessionId),
            respondApproval: (input: AssistantApprovalResponseInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.respondApproval, input),
            respondUserInput: (input: AssistantUserInputResponseInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.respondUserInput, input),
            startRealtimeVoice: (input: AssistantStartRealtimeVoiceInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.startRealtimeVoice, input),
            sendRealtimeVoiceMessage: (input: AssistantSendRealtimeVoiceMessageInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.sendRealtimeVoiceMessage, input),
            ingestRealtimeVoiceEvent: (input: AssistantIngestRealtimeVoiceEventInput) =>
                ipcRenderer.invoke(ASSISTANT_IPC.ingestRealtimeVoiceEvent, input),
            stopRealtimeVoice: () => ipcRenderer.invoke(ASSISTANT_IPC.stopRealtimeVoice),
            onRealtimeVoiceEvent: (callback: (event: AssistantRealtimeVoiceEvent) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, payload: AssistantRealtimeVoiceEvent) => callback(payload)
                ipcRenderer.on(ASSISTANT_IPC.realtimeVoiceEvent, listener)
                void ipcRenderer.invoke(ASSISTANT_IPC.subscribeRealtimeVoice).catch(() => undefined)
                return () => {
                    ipcRenderer.removeListener(ASSISTANT_IPC.realtimeVoiceEvent, listener)
                    void ipcRenderer.invoke(ASSISTANT_IPC.unsubscribeRealtimeVoice).catch(() => undefined)
                }
            },
            getVoiceTranscriptionState: () => ipcRenderer.invoke(ASSISTANT_IPC.getVoiceTranscriptionState),
            transcribeVoice: (input: AssistantTranscribeVoiceInput) => ipcRenderer.invoke(ASSISTANT_IPC.transcribeVoice, input),
            onEvent: (callback: (payload: AssistantEventStreamPayload) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, payload: AssistantEventStreamPayload) => {
                    callback(payload)
                }
                ipcRenderer.on(ASSISTANT_IPC.eventStream, listener)
                void ipcRenderer.invoke(ASSISTANT_IPC.subscribe).catch(() => undefined)
                return () => {
                    ipcRenderer.removeListener(ASSISTANT_IPC.eventStream, listener)
                    void ipcRenderer.invoke(ASSISTANT_IPC.unsubscribe).catch(() => undefined)
                }
            }
        }
    }
}
