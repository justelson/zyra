/**
 * Zyra - IPC Handler Registry
 */

import { app, BrowserWindow, webContents } from 'electron'
import log from 'electron-log'
import { BROWSER_DOWNLOADS_ACTION_CHANNEL, BROWSER_DOWNLOADS_FOLDER_ACTION_CHANNEL, BROWSER_DOWNLOADS_FOLDER_LIST_CHANNEL, BROWSER_DOWNLOADS_LIST_CHANNEL, BROWSER_DOWNLOADS_PREVIEW_CHANNEL } from '../../shared/browser-downloads'
import { BROWSER_PAGE_ICON_CHANNEL } from '../../shared/browser-favicon'
import { getTerminalCommandStatus, installTerminalCommand, removeTerminalCommand } from '../terminal-command-service'
import {
    handleGetFileSystemRoots,
} from './handlers/system-handlers'
import {
    configureHostedAiSecretResolver,
    handleClearAiDebugLogs,
    handleGenerateCommitMessage,
    handleGetAiDebugLogs,
    handleGetStartupSettings,
    handleListInstalledPackageRuntimes,
    handleSetStartupSettings,
    handleTestCodexConnection,
    handleTestGeminiConnection,
    handleTestGroqConnection
} from './handlers/settings-ai-handlers'
import { handleMemoryGetOverview } from './handlers/memory-handlers'
import {
    handleAssistantApprovePendingPlaygroundLabRequest,
    handleAssistantArchiveSession,
    handleAssistantAssociateProjectFolder,
    handleAssistantAttachSessionToPlaygroundLab,
    handleAssistantAgentAction,
    handleAssistantBootstrap,
    handleAssistantClearLogs,
    handleAssistantConnect,
    handleAssistantCreatePlaygroundLab,
    handleAssistantCreateProject,
    handleAssistantCreateSession,
    handleAssistantDeletePlaygroundLab,
    handleAssistantDeleteMessage,
    handleAssistantDismissProjectCandidate,
    handleAssistantDeleteSession,
    handleAssistantDeclinePendingPlaygroundLabRequest,
    handleAssistantDisconnect,
    handleAssistantGetAccountOverview,
    handleAssistantGetFleetSnapshot,
    handleAssistantGetHistoryPage,
    handleAssistantGetHistoryAroundMessage,
    handleAssistantGetSkillSourceOverview,
    handleAssistantHydrateHistoryBody,
    handleAssistantGetReviewIndex,
    handleAssistantGetSessionTurnUsage,
    handleAssistantGetThreadDetailBootstrap,
    handleAssistantGetVoiceTranscriptionState,
    handleAssistantGetTurnDetail,
    handleAssistantGetSnapshot,
    handleAssistantGetStatus,
    handleAssistantInterruptTurn,
    handleAssistantIngestRealtimeVoiceEvent,
    handleAssistantListModels,
    handleAssistantListProjects,
    handleAssistantListPromptResources,
    handleAssistantNewThread,
    handleAssistantPersistClipboardImage,
    handleAssistantRedeemAccountReset,
    handleAssistantRemoveProjectFolder,
    handleAssistantResolveClipboardAttachment,
    handleAssistantRegenerateSessionTitle,
    handleAssistantRenameSession,
    handleAssistantRespondApproval,
    handleAssistantRespondUserInput,
    handleAssistantSendRealtimeVoiceMessage,
    handleAssistantStartRealtimeVoice,
    handleAssistantStopRealtimeVoice,
    handleAssistantSubscribeRealtimeVoice,
    handleAssistantTranscribeVoice,
    handleAssistantUnsubscribeRealtimeVoice,
    handleAssistantUpdateProject,
    handleAssistantUpdateSkillSourceSettings,
    handleAssistantWorkflowAction,
    handleAssistantSearchChats,
    handleAssistantSearchTurns,
    handleAssistantSelectSession,
    handleAssistantSelectThread,
    handleAssistantSendPrompt,
    handleAssistantSetPlaygroundRoot,
    handleAssistantSetSessionProject,
    handleAssistantSetSessionProjectPath,
    handleAssistantSubscribe,
    handleAssistantUnsubscribe
} from './handlers/assistant-handlers'
import { ASSISTANT_IPC } from '../../shared/assistant/contracts'
import { resolveZyraWindowChromePolicy, type ZyraDesktopPlatform } from '../../shared/platform-window-chrome'
import { peekAssistantService } from '../assistant'
import {
    handleCopyToClipboard,
    handleGetUserHomePath,
    handleIndexAllFolders,
    handleOpenFile,
    handleOpenInExplorer,
    handleOpenProjectInIde,
    handleOpenWith,
    handleListInstalledIdes,
    handleScanProjects,
    handleSearchIndexedPaths,
    handleSelectFolder,
    handleSelectMarkdownFile,
    handleSelectProjectIconFile
} from './handlers/project-discovery-handlers'
import {
    handleGetProjectDetails,
    handleRecordProjectOpen,
    handleInstallProjectDependencies,
    handleGetProjectProcesses,
    handleGetRunningLocalServers,
    handleGetProjectSessions
} from './handlers/project-details-handlers'
import {
    handleCreateFileSystemItem,
    handleDeleteFileSystemItem,
    handleGetFileTree,
    handleGetPathInfo,
    handlePasteFileSystemItem,
    handleMoveFileSystemItem,
    handleReadBinaryFile,
    handleReadFileContent,
    handleReadTextFileFull,
    handleRenameFileSystemItem,
    handleWriteTextFile
} from './handlers/file-tree-handlers'
import { handleOpenInTerminal } from './handlers/terminal-handlers'
import {
    handleClearPreviewTerminal,
    handleClosePreviewTerminal,
    handleCreatePreviewTerminal,
    handleListPreviewTerminalSessions,
    handleRegisterPreviewTerminalWorkspace,
    handleReleasePreviewTerminalWorkspace,
    handleResizePreviewTerminal,
    handleSetPreviewTerminalTitle,
    handleWritePreviewTerminal
} from './handlers/preview-terminal-handlers'
import { handleRunPythonPreview, handleStopPythonPreview } from './handlers/python-preview-handlers'
import {
    handleBrowserDownloadAction,
    handleBrowserDownloadsFolderAction,
    handleCheckBrowserThreatNavigation,
    handleClearBrowserHistory,
    handleClearBrowserPreviewData,
    handleGetBrowserAdBlockStatus,
    handleGetBrowserDownloadPreviewTarget,
    handleGetBrowserPageIcon,
    handleListBrowserDownloads,
    handleListBrowserDownloadsFolder,
    handleGetBrowserBackgroundProviderStatus,
    handleGetBrowserHistory,
    handleGetBrowserRemoteBackgrounds,
    handleGetBrowserLinkPreview,
    handleGetBrowserPreviewConfig,
    handleGetBrowserSearchSuggestions,
    handleImportExternalBrowserHistory,
    handleOpenBrowserPreviewExternal,
    handleProceedBrowserThreatWarning,
    handleRecordBrowserHistory,
    handleScanExternalBrowserHistoryProfiles,
    handleSetBrowserAdBlockEnabled,
    handleDismissBrowserThreatWarning,
    handleTrackBrowserRemoteBackground,
    handleValidateBrowserUnsplashAccessKey
} from './handlers/browser-preview-handlers'
import {
    handleCancelBrowserPreviewAnnotation,
    handleCaptureBrowserPreviewScreenshot,
    handleClearBrowserPreviewCache,
    handleClearBrowserPreviewCookies,
    handleCopyBrowserPreviewArtifact,
    handleHardReloadBrowserPreview,
    handleOpenBrowserPreviewArtifact,
    handleOpenBrowserPreviewDevTools,
    handleRevealBrowserPreviewArtifact,
    handleSaveBrowserPreviewRecording,
    handleSetBrowserPreviewColorScheme,
    handleSetBrowserPreviewZoom,
    handleStageBrowserPreviewArtifactForAssistant,
    handleStartBrowserPreviewAnnotation,
    handleStartBrowserPreviewRecording,
    handleStopBrowserPreviewRecording
} from './handlers/browser-preview-developer-handlers'
import {
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleGetUpdateState,
    handleInstallUpdate
} from './handlers/update-handlers'
import {
    handleDownloadGoogleFont,
    handleImportFontFile,
    handleListManagedFonts,
    handleListSystemFonts,
    handleReadManagedFont,
    handleRemoveManagedFont
} from './handlers/font-handlers'
import {
    handleCheckIsGitRepo,
    handleGenerateCustomGitignoreContent,
    handleGenerateGitignoreContent,
    handleGetCommitDiff,
    handleGetGitCommitStats,
    handleGetGitHistory,
    handleGetGitHistoryCount,
    handleGetGitStatusEntryStats,
    handleGetGitSyncStatus,
    handleGetGitStatus,
    handleGetGitStatusDetailed,
    handleGetGitHubPublishContext,
    handleGetCurrentBranchPullRequest,
    handleGetGlobalGitUser,
    handleGetGitUser,
    handleGetGitignorePatterns,
    handleGetGitignoreTemplates,
    handleGetIncomingCommits,
    handleGetProjectsGitOverview,
    handleGetRepoOwner,
    handleGetUnpushedCommits,
    handleGetWorkingChangesForAI,
    handleGetWorkingDiff,
    handleHasRemoteOrigin
} from './handlers/git-read-handlers'
import {
    handleAddRemote,
    handleAddRemoteOrigin,
    handleApplyStash,
    handleCheckoutBranch,
    handleCloneGitRepository,
    handleCreateBranch,
    handleCreateCommit,
    handleCreateOrOpenPullRequest,
    handleCommitPushAndCreatePullRequest,
    handleCreateInitialCommit,
    handleCreateStash,
    handleCreateTag,
    handleDeleteBranch,
    handleDeleteTag,
    handleDiscardChanges,
    handleDropStash,
    handleFetchUpdates,
    handleInitGitRepo,
    handleListBranches,
    handleListRemotes,
    handleListStashes,
    handleListTags,
    handlePullUpdates,
    handlePushCommits,
    handlePushSingleCommit,
    handleRemoveRemote,
    handleSetRemoteUrl,
    handleSetGlobalGitUser,
    handleStageFiles,
    handleUnstageFiles
} from './handlers/git-write-handlers'
import { createAgentControlHandlers } from './handlers/agent-control-handlers'
import { AGENT_CONTROL_IPC } from '../../shared/agent-control/protocol'
import {
    UPDATE_CHECK_CHANNEL,
    UPDATE_DOWNLOAD_CHANNEL,
    UPDATE_GET_STATE_CHANNEL,
    UPDATE_INSTALL_CHANNEL
} from '../update/manager'
import type { DesktopSetupServices } from '../setup'
import { configureBrowserAdBlockService } from '../browser-adblock-service'
import { configureBrowserBackgroundService } from '../browser-background-service'
import { configureBrowserThreatProtectionService } from '../browser-threat-protection-service'
import { BROWSER_ADBLOCK_DETECTED_CHANNEL, BROWSER_THREAT_BLOCKED_CHANNEL } from '../../shared/contracts/devscope-api'
import {
    onboardingRequiredError,
    registerSetupIpcHandlers
} from './handlers/setup-handlers'
import { createOnboardingGatedIpcMain } from './onboarding-ipc-gate'
import { ipcMain as trustedIpcMain } from './trusted-ipc'

const PRE_ONBOARDING_ALLOWED_INVOKE_CHANNELS = new Set([
    'devscope:selectFolder',
    'window:isMaximized',
    'window:getRuntimeInfo'
])
let isOnboardingAccessAllowed = () => false
const ipcMain = createOnboardingGatedIpcMain(trustedIpcMain, {
    isAccessAllowed: () => isOnboardingAccessAllowed(),
    allowedBeforeOnboarding: PRE_ONBOARDING_ALLOWED_INVOKE_CHANNELS,
    blockedResult: onboardingRequiredError
})

export function registerIpcHandlers(mainWindow: BrowserWindow, setupServices: DesktopSetupServices): void {
    log.info('Registering IPC handlers...')

    isOnboardingAccessAllowed = () => setupServices.onboarding.isAccessAllowed()
    configureHostedAiSecretResolver((provider) => setupServices.secrets.getHostedAiKey(provider))
    configureBrowserBackgroundService(setupServices.secrets, app.getPath('userData'))
    configureBrowserAdBlockService({
        preferences: setupServices.preferences,
        userDataPath: app.getPath('userData'),
        notify: (event) => {
            for (const window of BrowserWindow.getAllWindows()) {
                if (!window.isDestroyed()) window.webContents.send(BROWSER_ADBLOCK_DETECTED_CHANNEL, event)
            }
        }
    })
    configureBrowserThreatProtectionService({
        userDataPath: app.getPath('userData'),
        notify: (ownerWebContentsId, warning) => {
            const owner = webContents.fromId(ownerWebContentsId)
            if (owner && !owner.isDestroyed()) owner.send(BROWSER_THREAT_BLOCKED_CHANNEL, warning)
        }
    })
    registerSetupIpcHandlers(setupServices)
    const requireCompletedSetup = <T extends (...args: any[]) => any>(handler: T) => (
        (...args: Parameters<T>) => setupServices.onboarding.isAccessAllowed()
            ? handler(...args)
            : onboardingRequiredError()
    )
    const controlHandlers = createAgentControlHandlers(mainWindow)
    ipcMain.handle(AGENT_CONTROL_IPC.getState, controlHandlers.getState)
    ipcMain.handle(AGENT_CONTROL_IPC.bindBrowserTab, controlHandlers.bindBrowserTab)
    ipcMain.handle(AGENT_CONTROL_IPC.acknowledgeBrowserSurfaceRequest, controlHandlers.acknowledgeBrowserSurfaceRequest)
    ipcMain.handle(AGENT_CONTROL_IPC.completeBrowserSurfaceRequest, controlHandlers.completeBrowserSurfaceRequest)
    ipcMain.handle(AGENT_CONTROL_IPC.claimBrowserSurfaceRequest, controlHandlers.claimBrowserSurfaceRequest)
    ipcMain.handle(AGENT_CONTROL_IPC.updateWorkspaceState, controlHandlers.updateWorkspaceState)
    ipcMain.handle(AGENT_CONTROL_IPC.approveGrant, controlHandlers.approveGrant)
    ipcMain.handle(AGENT_CONTROL_IPC.rejectGrant, controlHandlers.rejectGrant)
    ipcMain.handle(AGENT_CONTROL_IPC.approveAction, controlHandlers.approveAction)
    ipcMain.handle(AGENT_CONTROL_IPC.rejectAction, controlHandlers.rejectAction)
    ipcMain.handle(AGENT_CONTROL_IPC.revokeGrant, controlHandlers.revokeGrant)
    ipcMain.handle(AGENT_CONTROL_IPC.emergencyStop, controlHandlers.emergencyStop)
    ipcMain.handle(AGENT_CONTROL_IPC.clearAudit, controlHandlers.clearAudit)
    ipcMain.handle(AGENT_CONTROL_IPC.startChromePairing, controlHandlers.startChromePairing)
    ipcMain.handle(AGENT_CONTROL_IPC.stopChromePairing, controlHandlers.stopChromePairing)
    ipcMain.handle(AGENT_CONTROL_IPC.listWindows, controlHandlers.listWindows)
    ipcMain.handle(AGENT_CONTROL_IPC.selectWindow, controlHandlers.selectWindow)

    ipcMain.handle('devscope:getFileSystemRoots', handleGetFileSystemRoots)
    ipcMain.handle(UPDATE_GET_STATE_CHANNEL, requireCompletedSetup(handleGetUpdateState))
    ipcMain.handle(UPDATE_CHECK_CHANNEL, requireCompletedSetup(handleCheckForUpdates))
    ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, requireCompletedSetup(handleDownloadUpdate))
    ipcMain.handle(UPDATE_INSTALL_CHANNEL, requireCompletedSetup(handleInstallUpdate))

    ipcMain.handle('devscope:setStartupSettings', handleSetStartupSettings)
    ipcMain.handle('devscope:getStartupSettings', handleGetStartupSettings)
    ipcMain.handle('devscope:listInstalledPackageRuntimes', handleListInstalledPackageRuntimes)
    ipcMain.handle('devscope:fonts:listManaged', handleListManagedFonts)
    ipcMain.handle('devscope:fonts:listSystem', handleListSystemFonts)
    ipcMain.handle('devscope:fonts:downloadGoogle', handleDownloadGoogleFont)
    ipcMain.handle('devscope:fonts:importFile', handleImportFontFile)
    ipcMain.handle('devscope:fonts:removeManaged', handleRemoveManagedFont)
    ipcMain.handle('devscope:fonts:readManaged', handleReadManagedFont)
    ipcMain.handle('devscope:testGroqConnection', handleTestGroqConnection)
    ipcMain.handle('devscope:testGeminiConnection', handleTestGeminiConnection)
    ipcMain.handle('devscope:testCodexConnection', handleTestCodexConnection)
    ipcMain.handle('devscope:generateCommitMessage', handleGenerateCommitMessage)
    ipcMain.handle('devscope:getAiDebugLogs', handleGetAiDebugLogs)
    ipcMain.handle('devscope:clearAiDebugLogs', handleClearAiDebugLogs)
    ipcMain.handle('zyra:memory:getOverview', handleMemoryGetOverview)
    ipcMain.handle(ASSISTANT_IPC.subscribe, requireCompletedSetup(handleAssistantSubscribe))
    ipcMain.handle(ASSISTANT_IPC.unsubscribe, requireCompletedSetup(handleAssistantUnsubscribe))
    ipcMain.handle(ASSISTANT_IPC.bootstrap, requireCompletedSetup(handleAssistantBootstrap))
    ipcMain.handle(ASSISTANT_IPC.getSnapshot, requireCompletedSetup(handleAssistantGetSnapshot))
    ipcMain.handle(ASSISTANT_IPC.getFleetSnapshot, requireCompletedSetup(handleAssistantGetFleetSnapshot))
    ipcMain.handle(ASSISTANT_IPC.agentAction, requireCompletedSetup(handleAssistantAgentAction))
    ipcMain.handle(ASSISTANT_IPC.workflowAction, requireCompletedSetup(handleAssistantWorkflowAction))
    ipcMain.handle(ASSISTANT_IPC.getStatus, requireCompletedSetup(handleAssistantGetStatus))
    ipcMain.handle(ASSISTANT_IPC.getAccountOverview, requireCompletedSetup(handleAssistantGetAccountOverview))
    ipcMain.handle(ASSISTANT_IPC.redeemAccountReset, requireCompletedSetup(handleAssistantRedeemAccountReset))
    ipcMain.handle(ASSISTANT_IPC.getSessionTurnUsage, requireCompletedSetup(handleAssistantGetSessionTurnUsage))
    ipcMain.handle(ASSISTANT_IPC.listModels, requireCompletedSetup(handleAssistantListModels))
    ipcMain.handle(ASSISTANT_IPC.listProjects, requireCompletedSetup(handleAssistantListProjects))
    ipcMain.handle(ASSISTANT_IPC.createProject, requireCompletedSetup(handleAssistantCreateProject))
    ipcMain.handle(ASSISTANT_IPC.associateProjectFolder, requireCompletedSetup(handleAssistantAssociateProjectFolder))
    ipcMain.handle(ASSISTANT_IPC.removeProjectFolder, requireCompletedSetup(handleAssistantRemoveProjectFolder))
    ipcMain.handle(ASSISTANT_IPC.updateProject, requireCompletedSetup(handleAssistantUpdateProject))
    ipcMain.handle(ASSISTANT_IPC.dismissProjectCandidate, requireCompletedSetup(handleAssistantDismissProjectCandidate))
    ipcMain.handle(ASSISTANT_IPC.listPromptResources, requireCompletedSetup(handleAssistantListPromptResources))
    ipcMain.handle(ASSISTANT_IPC.getSkillSourceOverview, requireCompletedSetup(handleAssistantGetSkillSourceOverview))
    ipcMain.handle(ASSISTANT_IPC.updateSkillSourceSettings, requireCompletedSetup(handleAssistantUpdateSkillSourceSettings))
    ipcMain.handle(ASSISTANT_IPC.connect, requireCompletedSetup(handleAssistantConnect))
    ipcMain.handle(ASSISTANT_IPC.disconnect, requireCompletedSetup(handleAssistantDisconnect))
    ipcMain.handle(ASSISTANT_IPC.createSession, requireCompletedSetup(handleAssistantCreateSession))
    ipcMain.handle(ASSISTANT_IPC.selectSession, requireCompletedSetup(handleAssistantSelectSession))
    ipcMain.handle(ASSISTANT_IPC.selectThread, requireCompletedSetup(handleAssistantSelectThread))
    ipcMain.handle(ASSISTANT_IPC.getThreadDetailBootstrap, requireCompletedSetup(handleAssistantGetThreadDetailBootstrap))
    ipcMain.handle(ASSISTANT_IPC.getHistoryPage, requireCompletedSetup(handleAssistantGetHistoryPage))
    ipcMain.handle(ASSISTANT_IPC.getHistoryAroundMessage, requireCompletedSetup(handleAssistantGetHistoryAroundMessage))
    ipcMain.handle(ASSISTANT_IPC.hydrateHistoryBody, requireCompletedSetup(handleAssistantHydrateHistoryBody))
    ipcMain.handle(ASSISTANT_IPC.getReviewIndex, requireCompletedSetup(handleAssistantGetReviewIndex))
    ipcMain.handle(ASSISTANT_IPC.getTurnDetail, requireCompletedSetup(handleAssistantGetTurnDetail))
    ipcMain.handle(ASSISTANT_IPC.searchChats, requireCompletedSetup(handleAssistantSearchChats))
    ipcMain.handle(ASSISTANT_IPC.searchTurns, requireCompletedSetup(handleAssistantSearchTurns))
    ipcMain.handle(ASSISTANT_IPC.renameSession, requireCompletedSetup(handleAssistantRenameSession))
    ipcMain.handle(ASSISTANT_IPC.regenerateSessionTitle, requireCompletedSetup(handleAssistantRegenerateSessionTitle))
    ipcMain.handle(ASSISTANT_IPC.archiveSession, requireCompletedSetup(handleAssistantArchiveSession))
    ipcMain.handle(ASSISTANT_IPC.deleteSession, requireCompletedSetup(handleAssistantDeleteSession))
    ipcMain.handle(ASSISTANT_IPC.deleteMessage, requireCompletedSetup(handleAssistantDeleteMessage))
    ipcMain.handle(ASSISTANT_IPC.clearLogs, requireCompletedSetup(handleAssistantClearLogs))
    ipcMain.handle(ASSISTANT_IPC.setSessionProject, requireCompletedSetup(handleAssistantSetSessionProject))
    ipcMain.handle(ASSISTANT_IPC.setSessionProjectPath, requireCompletedSetup(handleAssistantSetSessionProjectPath))
    ipcMain.handle(ASSISTANT_IPC.setPlaygroundRoot, requireCompletedSetup(handleAssistantSetPlaygroundRoot))
    ipcMain.handle(ASSISTANT_IPC.createPlaygroundLab, requireCompletedSetup(handleAssistantCreatePlaygroundLab))
    ipcMain.handle(ASSISTANT_IPC.deletePlaygroundLab, requireCompletedSetup(handleAssistantDeletePlaygroundLab))
    ipcMain.handle(ASSISTANT_IPC.attachSessionToPlaygroundLab, requireCompletedSetup(handleAssistantAttachSessionToPlaygroundLab))
    ipcMain.handle(ASSISTANT_IPC.approvePendingPlaygroundLabRequest, requireCompletedSetup(handleAssistantApprovePendingPlaygroundLabRequest))
    ipcMain.handle(ASSISTANT_IPC.declinePendingPlaygroundLabRequest, requireCompletedSetup(handleAssistantDeclinePendingPlaygroundLabRequest))
    ipcMain.handle(ASSISTANT_IPC.persistClipboardImage, requireCompletedSetup(handleAssistantPersistClipboardImage))
    ipcMain.handle(ASSISTANT_IPC.resolveClipboardAttachment, requireCompletedSetup(handleAssistantResolveClipboardAttachment))
    ipcMain.handle(ASSISTANT_IPC.newThread, requireCompletedSetup(handleAssistantNewThread))
    ipcMain.handle(ASSISTANT_IPC.sendPrompt, requireCompletedSetup(handleAssistantSendPrompt))
    ipcMain.handle(ASSISTANT_IPC.interruptTurn, requireCompletedSetup(handleAssistantInterruptTurn))
    ipcMain.handle(ASSISTANT_IPC.respondApproval, requireCompletedSetup(handleAssistantRespondApproval))
    ipcMain.handle(ASSISTANT_IPC.respondUserInput, requireCompletedSetup(handleAssistantRespondUserInput))
    ipcMain.handle(ASSISTANT_IPC.subscribeRealtimeVoice, requireCompletedSetup(handleAssistantSubscribeRealtimeVoice))
    ipcMain.handle(ASSISTANT_IPC.unsubscribeRealtimeVoice, requireCompletedSetup(handleAssistantUnsubscribeRealtimeVoice))
    ipcMain.handle(ASSISTANT_IPC.startRealtimeVoice, requireCompletedSetup(handleAssistantStartRealtimeVoice))
    ipcMain.handle(ASSISTANT_IPC.sendRealtimeVoiceMessage, requireCompletedSetup(handleAssistantSendRealtimeVoiceMessage))
    ipcMain.handle(ASSISTANT_IPC.ingestRealtimeVoiceEvent, requireCompletedSetup(handleAssistantIngestRealtimeVoiceEvent))
    ipcMain.handle(ASSISTANT_IPC.stopRealtimeVoice, requireCompletedSetup(handleAssistantStopRealtimeVoice))
    ipcMain.handle(ASSISTANT_IPC.getVoiceTranscriptionState, requireCompletedSetup(handleAssistantGetVoiceTranscriptionState))
    ipcMain.handle(ASSISTANT_IPC.transcribeVoice, requireCompletedSetup(handleAssistantTranscribeVoice))

    ipcMain.handle('devscope:selectFolder', handleSelectFolder)
    ipcMain.handle('devscope:selectMarkdownFile', handleSelectMarkdownFile)
    ipcMain.handle('devscope:selectProjectIconFile', handleSelectProjectIconFile)
    ipcMain.handle('devscope:getUserHomePath', handleGetUserHomePath)
    ipcMain.handle('devscope:scanProjects', handleScanProjects)
    ipcMain.handle('devscope:indexAllFolders', handleIndexAllFolders)
    ipcMain.handle('devscope:searchIndexedPaths', handleSearchIndexedPaths)
    ipcMain.handle('devscope:openInExplorer', handleOpenInExplorer)
    ipcMain.handle('devscope:openInTerminal', handleOpenInTerminal)
    ipcMain.handle('devscope:listInstalledIdes', handleListInstalledIdes)
    ipcMain.handle('devscope:openProjectInIde', handleOpenProjectInIde)
    ipcMain.handle('devscope:previewTerminal:registerWorkspace', handleRegisterPreviewTerminalWorkspace)
    ipcMain.handle('devscope:previewTerminal:releaseWorkspace', handleReleasePreviewTerminalWorkspace)
    ipcMain.handle('devscope:previewTerminal:create', handleCreatePreviewTerminal)
    ipcMain.handle('devscope:previewTerminal:list', handleListPreviewTerminalSessions)
    ipcMain.handle('devscope:previewTerminal:write', handleWritePreviewTerminal)
    ipcMain.handle('devscope:previewTerminal:setTitle', handleSetPreviewTerminalTitle)
    ipcMain.handle('devscope:previewTerminal:resize', handleResizePreviewTerminal)
    ipcMain.handle('devscope:previewTerminal:clear', handleClearPreviewTerminal)
    ipcMain.handle('devscope:previewTerminal:close', handleClosePreviewTerminal)
    ipcMain.handle('devscope:browserPreview:getConfig', handleGetBrowserPreviewConfig)
    ipcMain.handle('devscope:browserPreview:checkThreatNavigation', handleCheckBrowserThreatNavigation)
    ipcMain.handle('devscope:browserPreview:proceedThreatWarning', handleProceedBrowserThreatWarning)
    ipcMain.handle('devscope:browserPreview:dismissThreatWarning', handleDismissBrowserThreatWarning)
    ipcMain.handle(BROWSER_DOWNLOADS_LIST_CHANNEL, handleListBrowserDownloads)
    ipcMain.handle(BROWSER_DOWNLOADS_ACTION_CHANNEL, handleBrowserDownloadAction)
    ipcMain.handle(BROWSER_DOWNLOADS_PREVIEW_CHANNEL, handleGetBrowserDownloadPreviewTarget)
    ipcMain.handle(BROWSER_DOWNLOADS_FOLDER_LIST_CHANNEL, handleListBrowserDownloadsFolder)
    ipcMain.handle(BROWSER_DOWNLOADS_FOLDER_ACTION_CHANNEL, handleBrowserDownloadsFolderAction)
    ipcMain.handle(BROWSER_PAGE_ICON_CHANNEL, handleGetBrowserPageIcon)
    ipcMain.handle('devscope:browserPreview:getHistory', handleGetBrowserHistory)
    ipcMain.handle('devscope:browserPreview:getSearchSuggestions', handleGetBrowserSearchSuggestions)
    ipcMain.handle('devscope:browserPreview:scanExternalHistory', handleScanExternalBrowserHistoryProfiles)
    ipcMain.handle('devscope:browserPreview:importExternalHistory', handleImportExternalBrowserHistory)
    ipcMain.handle('devscope:browserPreview:recordHistory', handleRecordBrowserHistory)
    ipcMain.handle('devscope:browserPreview:clearHistory', handleClearBrowserHistory)
    ipcMain.handle('devscope:browserPreview:getAdBlockStatus', handleGetBrowserAdBlockStatus)
    ipcMain.handle('devscope:browserPreview:setAdBlockEnabled', handleSetBrowserAdBlockEnabled)
    ipcMain.handle('devscope:browserPreview:getBackgroundProviderStatus', handleGetBrowserBackgroundProviderStatus)
    ipcMain.handle('devscope:browserPreview:validateUnsplashAccessKey', handleValidateBrowserUnsplashAccessKey)
    ipcMain.handle('devscope:browserPreview:getRemoteBackgrounds', handleGetBrowserRemoteBackgrounds)
    ipcMain.handle('devscope:browserPreview:trackRemoteBackground', handleTrackBrowserRemoteBackground)
    ipcMain.handle('devscope:browserPreview:clearData', handleClearBrowserPreviewData)
    ipcMain.handle('devscope:browserPreview:clearCache', handleClearBrowserPreviewCache)
    ipcMain.handle('devscope:browserPreview:clearCookies', handleClearBrowserPreviewCookies)
    ipcMain.handle('devscope:browserPreview:hardReload', handleHardReloadBrowserPreview)
    ipcMain.handle('devscope:browserPreview:setZoom', handleSetBrowserPreviewZoom)
    ipcMain.handle('devscope:browserPreview:setColorScheme', handleSetBrowserPreviewColorScheme)
    ipcMain.handle('devscope:browserPreview:openDevTools', handleOpenBrowserPreviewDevTools)
    ipcMain.handle('devscope:browserPreview:captureScreenshot', handleCaptureBrowserPreviewScreenshot)
    ipcMain.handle('devscope:browserPreview:stageArtifactForAssistant', handleStageBrowserPreviewArtifactForAssistant)
    ipcMain.handle('devscope:browserPreview:openArtifact', handleOpenBrowserPreviewArtifact)
    ipcMain.handle('devscope:browserPreview:revealArtifact', handleRevealBrowserPreviewArtifact)
    ipcMain.handle('devscope:browserPreview:copyArtifact', handleCopyBrowserPreviewArtifact)
    ipcMain.handle('devscope:browserPreview:startAnnotation', handleStartBrowserPreviewAnnotation)
    ipcMain.handle('devscope:browserPreview:cancelAnnotation', handleCancelBrowserPreviewAnnotation)
    ipcMain.handle('devscope:browserPreview:startRecording', handleStartBrowserPreviewRecording)
    ipcMain.handle('devscope:browserPreview:stopRecording', handleStopBrowserPreviewRecording)
    ipcMain.handle('devscope:browserPreview:saveRecording', handleSaveBrowserPreviewRecording)
    ipcMain.handle('devscope:browserPreview:getLinkPreview', handleGetBrowserLinkPreview)
    ipcMain.handle('devscope:browserPreview:openExternal', handleOpenBrowserPreviewExternal)
    ipcMain.handle('devscope:pythonPreview:run', handleRunPythonPreview)
    ipcMain.handle('devscope:pythonPreview:stop', handleStopPythonPreview)
    ipcMain.handle('devscope:copyToClipboard', handleCopyToClipboard)
    ipcMain.handle('devscope:getProjectDetails', handleGetProjectDetails)
    ipcMain.handle('devscope:recordProjectOpen', handleRecordProjectOpen)
    ipcMain.handle('devscope:installProjectDependencies', handleInstallProjectDependencies)
    ipcMain.handle('devscope:getFileTree', handleGetFileTree)
    ipcMain.handle('devscope:readFileContent', handleReadFileContent)
    ipcMain.handle('devscope:readBinaryFile', handleReadBinaryFile)
    ipcMain.handle('devscope:readTextFileFull', handleReadTextFileFull)
    ipcMain.handle('devscope:getPathInfo', handleGetPathInfo)
    ipcMain.handle('devscope:writeTextFile', handleWriteTextFile)
    ipcMain.handle('devscope:openFile', handleOpenFile)
    ipcMain.handle('devscope:openWith', handleOpenWith)
    ipcMain.handle('devscope:createFileSystemItem', handleCreateFileSystemItem)
    ipcMain.handle('devscope:renameFileSystemItem', handleRenameFileSystemItem)
    ipcMain.handle('devscope:deleteFileSystemItem', handleDeleteFileSystemItem)
    ipcMain.handle('devscope:pasteFileSystemItem', handlePasteFileSystemItem)
    ipcMain.handle('devscope:moveFileSystemItem', handleMoveFileSystemItem)
    ipcMain.handle('devscope:getProjectSessions', handleGetProjectSessions)
    ipcMain.handle('devscope:getProjectProcesses', handleGetProjectProcesses)
    ipcMain.handle('devscope:getRunningLocalServers', handleGetRunningLocalServers)

    ipcMain.handle('devscope:getGitHistory', handleGetGitHistory)
    ipcMain.handle('devscope:getGitHistoryCount', handleGetGitHistoryCount)
    ipcMain.handle('devscope:getGitCommitStats', handleGetGitCommitStats)
    ipcMain.handle('devscope:getCommitDiff', handleGetCommitDiff)
    ipcMain.handle('devscope:getWorkingDiff', handleGetWorkingDiff)
    ipcMain.handle('devscope:getWorkingChangesForAI', handleGetWorkingChangesForAI)
    ipcMain.handle('devscope:getGitStatus', handleGetGitStatus)
    ipcMain.handle('devscope:getGitStatusDetailed', handleGetGitStatusDetailed)
    ipcMain.handle('devscope:getGitStatusEntryStats', handleGetGitStatusEntryStats)
    ipcMain.handle('devscope:getGitSyncStatus', handleGetGitSyncStatus)
    ipcMain.handle('devscope:getIncomingCommits', handleGetIncomingCommits)
    ipcMain.handle('devscope:getUnpushedCommits', handleGetUnpushedCommits)
    ipcMain.handle('devscope:getGitUser', handleGetGitUser)
    ipcMain.handle('devscope:getGlobalGitUser', handleGetGlobalGitUser)
    ipcMain.handle('devscope:getRepoOwner', handleGetRepoOwner)
    ipcMain.handle('devscope:getGitHubPublishContext', handleGetGitHubPublishContext)
    ipcMain.handle('devscope:getCurrentBranchPullRequest', handleGetCurrentBranchPullRequest)
    ipcMain.handle('devscope:hasRemoteOrigin', handleHasRemoteOrigin)
    ipcMain.handle('devscope:getProjectsGitOverview', handleGetProjectsGitOverview)
    ipcMain.handle('devscope:checkIsGitRepo', handleCheckIsGitRepo)

    ipcMain.handle('devscope:stageFiles', handleStageFiles)
    ipcMain.handle('devscope:unstageFiles', handleUnstageFiles)
    ipcMain.handle('devscope:discardChanges', handleDiscardChanges)
    ipcMain.handle('devscope:createCommit', handleCreateCommit)
    ipcMain.handle('devscope:createOrOpenPullRequest', handleCreateOrOpenPullRequest)
    ipcMain.handle('devscope:commitPushAndCreatePullRequest', handleCommitPushAndCreatePullRequest)
    ipcMain.handle('devscope:setGlobalGitUser', handleSetGlobalGitUser)
    ipcMain.handle('devscope:pushCommits', handlePushCommits)
    ipcMain.handle('devscope:pushSingleCommit', handlePushSingleCommit)
    ipcMain.handle('devscope:fetchUpdates', handleFetchUpdates)
    ipcMain.handle('devscope:pullUpdates', handlePullUpdates)
    ipcMain.handle('devscope:listBranches', handleListBranches)
    ipcMain.handle('devscope:createBranch', handleCreateBranch)
    ipcMain.handle('devscope:checkoutBranch', handleCheckoutBranch)
    ipcMain.handle('devscope:deleteBranch', handleDeleteBranch)
    ipcMain.handle('devscope:addRemote', handleAddRemote)
    ipcMain.handle('devscope:listRemotes', handleListRemotes)
    ipcMain.handle('devscope:setRemoteUrl', handleSetRemoteUrl)
    ipcMain.handle('devscope:removeRemote', handleRemoveRemote)
    ipcMain.handle('devscope:listTags', handleListTags)
    ipcMain.handle('devscope:createTag', handleCreateTag)
    ipcMain.handle('devscope:deleteTag', handleDeleteTag)
    ipcMain.handle('devscope:listStashes', handleListStashes)
    ipcMain.handle('devscope:createStash', handleCreateStash)
    ipcMain.handle('devscope:applyStash', handleApplyStash)
    ipcMain.handle('devscope:dropStash', handleDropStash)
    ipcMain.handle('devscope:initGitRepo', handleInitGitRepo)
    ipcMain.handle('devscope:createInitialCommit', handleCreateInitialCommit)
    ipcMain.handle('devscope:addRemoteOrigin', handleAddRemoteOrigin)
    ipcMain.handle('devscope:cloneGitRepository', handleCloneGitRepository)
    ipcMain.handle('devscope:getGitignoreTemplates', handleGetGitignoreTemplates)
    ipcMain.handle('devscope:generateGitignoreContent', handleGenerateGitignoreContent)
    ipcMain.handle('devscope:getGitignorePatterns', handleGetGitignorePatterns)
    ipcMain.handle('devscope:generateCustomGitignoreContent', handleGenerateCustomGitignoreContent)

    ipcMain.removeAllListeners('window:minimize')
    ipcMain.removeAllListeners('window:maximize')
    ipcMain.removeAllListeners('window:close')
    ipcMain.removeHandler('window:isMaximized')
    ipcMain.removeHandler('window:getRuntimeInfo')

    ipcMain.on('window:minimize', (event) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow || targetWindow.isDestroyed()) return
        targetWindow.minimize()
    })
    ipcMain.on('window:maximize', (event) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow || targetWindow.isDestroyed()) return
        if (targetWindow.isMaximized()) targetWindow.unmaximize()
        else targetWindow.maximize()
    })
    ipcMain.on('window:close', (event) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow || targetWindow.isDestroyed()) return
        targetWindow.close()
    })
    ipcMain.handle('window:isMaximized', (event) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow || targetWindow.isDestroyed()) return false
        return targetWindow.isMaximized() || targetWindow.isFullScreen()
    })
    ipcMain.handle('window:getTerminalCommandStatus', async () => {
        try { return { success: true, status: await getTerminalCommandStatus() } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not inspect the terminal command.' } }
    })
    ipcMain.handle('window:installTerminalCommand', async () => {
        try { return { success: true, status: await installTerminalCommand() } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not install the terminal command.' } }
    })
    ipcMain.handle('window:removeTerminalCommand', async () => {
        try { return { success: true, status: await removeTerminalCommand() } }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not remove the terminal command.' } }
    })
    ipcMain.handle('window:getRuntimeInfo', () => {
        const platform = process.platform as ZyraDesktopPlatform
        const policy = resolveZyraWindowChromePolicy(platform)
        return {
            platform,
            architecture: process.arch,
            appVersion: app.getVersion(),
            electronVersion: process.versions.electron || null,
            isPackaged: app.isPackaged,
            nativeFrame: policy.nativeFrame,
            customWindowControls: policy.customWindowControls
        }
    })

    mainWindow.webContents.once('destroyed', () => {
        const service = peekAssistantService()
        service?.unsubscribe(mainWindow.webContents.id)
        service?.unsubscribeRealtimeVoice(mainWindow.webContents.id)
    })
}
