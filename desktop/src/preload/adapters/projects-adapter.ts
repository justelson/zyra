import { ipcRenderer } from 'electron'
import { BROWSER_EXTENSIONS_IPC } from '../../shared/browser-extensions'
import type {
    DevScopeBrowserAdDetection,
    DevScopeBrowserAnnotationInput,
    DevScopeBrowserBackgroundCategory,
    DevScopeBrowserGuestTargetInput,
    DevScopeBrowserHistoryRecordInput,
    DevScopeBrowserOpenTabRequest,
    DevScopeBrowserRecordingFrame,
    DevScopeBrowserShortcutEvent,
    DevScopeBrowserThreatCheckInput,
    DevScopeBrowserThreatWarning,
    DevScopeGitCloneInput,
    DevScopeGitCloneProgressEvent,
    DevScopePreviewTerminalAccess,
    DevScopePreviewTerminalEvent,
    DevScopePreviewTerminalWorkspaceOwner,
    DevScopePythonPreviewEvent
} from '../../shared/contracts/devscope-api'
import type { ExternalBrowserHistoryImportInput } from '../../shared/external-browser-history-contracts'
import { BROWSER_PAGE_ICON_CHANNEL } from '../../shared/browser-favicon'
import {
    BROWSER_DOWNLOADS_ACTION_CHANNEL,
    BROWSER_DOWNLOADS_CHANGED_CHANNEL,
    BROWSER_DOWNLOADS_FOLDER_ACTION_CHANNEL,
    BROWSER_DOWNLOADS_FOLDER_LIST_CHANNEL,
    BROWSER_DOWNLOADS_LIST_CHANNEL,
    BROWSER_DOWNLOADS_PREVIEW_CHANNEL,
    type BrowserDownloadAction,
    type BrowserDownloadRecord,
    type BrowserDownloadsFolderAction
} from '../../shared/browser-downloads'
import {
    BROWSER_ADBLOCK_DETECTED_CHANNEL,
    BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL,
    BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL,
    BROWSER_PREVIEW_SHORTCUT_CHANNEL,
    BROWSER_THREAT_BLOCKED_CHANNEL,
    GIT_CLONE_PROGRESS_CHANNEL
} from '../../shared/contracts/devscope-api'

export function createProjectsAdapter() {
    const PYTHON_PREVIEW_EVENT_CHANNEL = 'devscope:pythonPreview:event'
    const PREVIEW_TERMINAL_EVENT_CHANNEL = 'devscope:previewTerminal:event'

    return {
        getDeveloperWorkspace: (root: string) => ipcRenderer.invoke('devscope:developerWorkspace', root),
        startDeveloperTask: (root: string, name: string) => ipcRenderer.invoke('devscope:startDeveloperTask', root, name),
        stopDeveloperTask: (id: string) => ipcRenderer.invoke('devscope:stopDeveloperTask', id),
        previewRecordedUndo: (root: string, patch: string) => ipcRenderer.invoke('devscope:previewRecordedUndo', root, patch),
        applyRecordedUndo: (token: string) => ipcRenderer.invoke('devscope:applyRecordedUndo', token),
        selectFolder: () => ipcRenderer.invoke('devscope:selectFolder'),
        selectMarkdownFile: () => ipcRenderer.invoke('devscope:selectMarkdownFile'),
        selectProjectIconFile: () => ipcRenderer.invoke('devscope:selectProjectIconFile'),
        getUserHomePath: () => ipcRenderer.invoke('devscope:getUserHomePath'),
        listInstalledPackageRuntimes: () => ipcRenderer.invoke('devscope:listInstalledPackageRuntimes'),
        scanProjects: (folderPath: string, options?: { forceRefresh?: boolean }) =>
            ipcRenderer.invoke('devscope:scanProjects', folderPath, options),
        discoverLocalGitHubProjects: (paths: string[]) => ipcRenderer.invoke('devscope:discoverLocalGitHubProjects', paths),
        openInExplorer: (path: string) => ipcRenderer.invoke('devscope:openInExplorer', path),
        openInTerminal: (path: string, preferredShell: 'powershell' | 'cmd' = 'powershell', initialCommand?: string) =>
            ipcRenderer.invoke('devscope:openInTerminal', path, preferredShell, initialCommand),
        listInstalledIdes: () => ipcRenderer.invoke('devscope:listInstalledIdes'),
        openProjectInIde: (projectPath: string, ideId: string) =>
            ipcRenderer.invoke('devscope:openProjectInIde', projectPath, ideId),
        installProjectDependencies: (projectPath: string, options?: { onlyMissing?: boolean }) =>
            ipcRenderer.invoke('devscope:installProjectDependencies', projectPath, options),
        getProjectDetails: (projectPath: string) => ipcRenderer.invoke('devscope:getProjectDetails', projectPath),
        recordProjectOpen: (projectPath: string) => ipcRenderer.invoke('devscope:recordProjectOpen', projectPath),
        getFileTree: (
            projectPath: string,
            options?: {
                showHidden?: boolean
                maxDepth?: number
                rootPath?: string
                includeGitStatus?: boolean
                includeFileSize?: boolean
                includeDirectoryChildHint?: boolean
            }
        ) =>
            ipcRenderer.invoke('devscope:getFileTree', projectPath, options),
        getGitHistory: (projectPath: string, limit?: number, options?: { all?: boolean; includeStats?: boolean }) =>
            ipcRenderer.invoke('devscope:getGitHistory', projectPath, limit, options),
        getGitHistoryCount: (projectPath: string, options?: { all?: boolean }) =>
            ipcRenderer.invoke('devscope:getGitHistoryCount', projectPath, options),
        getGitCommitStats: (projectPath: string, commitHashes: string[]) =>
            ipcRenderer.invoke('devscope:getGitCommitStats', projectPath, commitHashes),
        getCommitDiff: (projectPath: string, commitHash: string) => ipcRenderer.invoke('devscope:getCommitDiff', projectPath, commitHash),
        getWorkingDiff: (
            projectPath: string,
            filePath?: string,
            mode?: 'combined' | 'staged' | 'unstaged'
        ) => ipcRenderer.invoke('devscope:getWorkingDiff', projectPath, filePath, mode),
        getWorkingChangesForAI: (projectPath: string) => ipcRenderer.invoke('devscope:getWorkingChangesForAI', projectPath),
        getGitStatus: (projectPath: string) => ipcRenderer.invoke('devscope:getGitStatus', projectPath),
        getGitStatusDetailed: (projectPath: string, options?: { includeStats?: boolean; includeIgnored?: boolean }) =>
            ipcRenderer.invoke('devscope:getGitStatusDetailed', projectPath, options),
        getGitStatusEntryStats: (projectPath: string, filePaths: string[]) =>
            ipcRenderer.invoke('devscope:getGitStatusEntryStats', projectPath, filePaths),
        getGitSyncStatus: (projectPath: string) => ipcRenderer.invoke('devscope:getGitSyncStatus', projectPath),
        getIncomingCommits: (projectPath: string, limit?: number) =>
            ipcRenderer.invoke('devscope:getIncomingCommits', projectPath, limit),
        getUnpushedCommits: (projectPath: string) => ipcRenderer.invoke('devscope:getUnpushedCommits', projectPath),
        getGitUser: (projectPath: string) => ipcRenderer.invoke('devscope:getGitUser', projectPath),
        getGlobalGitUser: () => ipcRenderer.invoke('devscope:getGlobalGitUser'),
        getRepoOwner: (projectPath: string) => ipcRenderer.invoke('devscope:getRepoOwner', projectPath),
        getGitHubPublishContext: (projectPath: string) =>
            ipcRenderer.invoke('devscope:getGitHubPublishContext', projectPath),
        getCurrentBranchPullRequest: (projectPath: string) =>
            ipcRenderer.invoke('devscope:getCurrentBranchPullRequest', projectPath),
        createOrOpenPullRequest: (
            projectPath: string,
            input: {
                projectName?: string
                targetBranch?: string
                draft?: boolean
                title?: string
                body?: string
                guideText?: string
                provider?: 'groq' | 'gemini' | 'codex'
                apiKey?: string
                model?: string
            }
        ) => ipcRenderer.invoke('devscope:createOrOpenPullRequest', projectPath, input),
        commitPushAndCreatePullRequest: (
            projectPath: string,
            input: {
                projectName?: string
                commitMessage?: string
                targetBranch?: string
                draft?: boolean
                guideText?: string
                provider?: 'groq' | 'gemini' | 'codex'
                apiKey?: string
                model?: string
                autoStageAll?: boolean
                stageScope?: 'project' | 'repo'
            }
        ) => ipcRenderer.invoke('devscope:commitPushAndCreatePullRequest', projectPath, input),
        hasRemoteOrigin: (projectPath: string) => ipcRenderer.invoke('devscope:hasRemoteOrigin', projectPath),
        getProjectsGitOverview: (projectPaths: string[]) => ipcRenderer.invoke('devscope:getProjectsGitOverview', projectPaths),
        stageFiles: (
            projectPath: string,
            files: string[],
            options?: { scope?: 'project' | 'repo' }
        ) => ipcRenderer.invoke('devscope:stageFiles', projectPath, files, options),
        unstageFiles: (
            projectPath: string,
            files: string[],
            options?: { scope?: 'project' | 'repo' }
        ) => ipcRenderer.invoke('devscope:unstageFiles', projectPath, files, options),
        discardChanges: (
            projectPath: string,
            files: string[],
            options?: { scope?: 'project' | 'repo'; mode?: 'unstaged' | 'staged' | 'both' }
        ) => ipcRenderer.invoke('devscope:discardChanges', projectPath, files, options),
        createCommit: (projectPath: string, message: string) => ipcRenderer.invoke('devscope:createCommit', projectPath, message),
        setGlobalGitUser: (user: { name: string; email: string }) => ipcRenderer.invoke('devscope:setGlobalGitUser', user),
        pushCommits: (projectPath: string, options?: { remoteName?: string; branchName?: string }) =>
            ipcRenderer.invoke('devscope:pushCommits', projectPath, options),
        pushSingleCommit: (projectPath: string, commitHash: string, options?: { remoteName?: string; branchName?: string }) =>
            ipcRenderer.invoke('devscope:pushSingleCommit', projectPath, commitHash, options),
        fetchUpdates: (projectPath: string, remoteName?: string) => ipcRenderer.invoke('devscope:fetchUpdates', projectPath, remoteName),
        pullUpdates: (
            projectPath: string,
            options?: { remoteName?: string; branchName?: string; pushRemoteName?: string }
        ) => ipcRenderer.invoke('devscope:pullUpdates', projectPath, options),
        listBranches: (projectPath: string) => ipcRenderer.invoke('devscope:listBranches', projectPath),
        createBranch: (projectPath: string, branchName: string, checkout?: boolean) =>
            ipcRenderer.invoke('devscope:createBranch', projectPath, branchName, checkout),
        checkoutBranch: (
            projectPath: string,
            branchName: string,
            options?: { autoStash?: boolean; autoCleanupLock?: boolean }
        ) =>
            ipcRenderer.invoke('devscope:checkoutBranch', projectPath, branchName, options),
        deleteBranch: (projectPath: string, branchName: string, force?: boolean) =>
            ipcRenderer.invoke('devscope:deleteBranch', projectPath, branchName, force),
        addRemote: (projectPath: string, remoteName: string, remoteUrl: string) =>
            ipcRenderer.invoke('devscope:addRemote', projectPath, remoteName, remoteUrl),
        listRemotes: (projectPath: string) => ipcRenderer.invoke('devscope:listRemotes', projectPath),
        setRemoteUrl: (projectPath: string, remoteName: string, remoteUrl: string) =>
            ipcRenderer.invoke('devscope:setRemoteUrl', projectPath, remoteName, remoteUrl),
        removeRemote: (projectPath: string, remoteName: string) => ipcRenderer.invoke('devscope:removeRemote', projectPath, remoteName),
        listTags: (projectPath: string) => ipcRenderer.invoke('devscope:listTags', projectPath),
        createTag: (projectPath: string, tagName: string, target?: string) =>
            ipcRenderer.invoke('devscope:createTag', projectPath, tagName, target),
        deleteTag: (projectPath: string, tagName: string) => ipcRenderer.invoke('devscope:deleteTag', projectPath, tagName),
        listStashes: (projectPath: string) => ipcRenderer.invoke('devscope:listStashes', projectPath),
        createStash: (projectPath: string, message?: string) => ipcRenderer.invoke('devscope:createStash', projectPath, message),
        applyStash: (projectPath: string, stashRef?: string, pop?: boolean) =>
            ipcRenderer.invoke('devscope:applyStash', projectPath, stashRef, pop),
        dropStash: (projectPath: string, stashRef?: string) => ipcRenderer.invoke('devscope:dropStash', projectPath, stashRef),
        checkIsGitRepo: (projectPath: string) => ipcRenderer.invoke('devscope:checkIsGitRepo', projectPath),
        initGitRepo: (projectPath: string, branchName: string, createGitignore: boolean, gitignoreTemplate?: string) =>
            ipcRenderer.invoke('devscope:initGitRepo', projectPath, branchName, createGitignore, gitignoreTemplate),
        createInitialCommit: (projectPath: string, message: string) => ipcRenderer.invoke('devscope:createInitialCommit', projectPath, message),
        addRemoteOrigin: (projectPath: string, remoteUrl: string) => ipcRenderer.invoke('devscope:addRemoteOrigin', projectPath, remoteUrl),
        cloneGitRepository: (input: DevScopeGitCloneInput) => ipcRenderer.invoke('devscope:cloneGitRepository', input),
        onGitCloneProgress: (callback: (event: DevScopeGitCloneProgressEvent) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeGitCloneProgressEvent) => {
                callback(payload)
            }
            ipcRenderer.on(GIT_CLONE_PROGRESS_CHANNEL, listener)
            return () => {
                ipcRenderer.removeListener(GIT_CLONE_PROGRESS_CHANNEL, listener)
            }
        },
        getGitignoreTemplates: () => ipcRenderer.invoke('devscope:getGitignoreTemplates'),
        generateGitignoreContent: (template: string) => ipcRenderer.invoke('devscope:generateGitignoreContent', template),
        getGitignorePatterns: () => ipcRenderer.invoke('devscope:getGitignorePatterns'),
        generateCustomGitignoreContent: (selectedPatternIds: string[]) => ipcRenderer.invoke('devscope:generateCustomGitignoreContent', selectedPatternIds),
        copyToClipboard: (text: string) => ipcRenderer.invoke('devscope:copyToClipboard', text),
        readFileContent: (filePath: string, options?: { knownSize?: number | null; knownModifiedAt?: number | null }) => ipcRenderer.invoke('devscope:readFileContent', filePath, options),
        readBinaryFile: (filePath: string) => ipcRenderer.invoke('devscope:readBinaryFile', filePath),
        readTextFileFull: (filePath: string) => ipcRenderer.invoke('devscope:readTextFileFull', filePath),
        getPathInfo: (targetPath: string) => ipcRenderer.invoke('devscope:getPathInfo', targetPath),
        writeTextFile: (filePath: string, content: string, expectedModifiedAt?: number) =>
            ipcRenderer.invoke('devscope:writeTextFile', filePath, content, expectedModifiedAt),
        runPythonPreview: (input: { sessionId: string; filePath: string; projectPath?: string }) =>
            ipcRenderer.invoke('devscope:pythonPreview:run', input),
        stopPythonPreview: (sessionId: string) =>
            ipcRenderer.invoke('devscope:pythonPreview:stop', sessionId),
        onPythonPreviewEvent: (callback: (event: DevScopePythonPreviewEvent) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopePythonPreviewEvent) => {
                callback(payload)
            }
            ipcRenderer.on(PYTHON_PREVIEW_EVENT_CHANNEL, listener)
            return () => {
                ipcRenderer.removeListener(PYTHON_PREVIEW_EVENT_CHANNEL, listener)
            }
        },
        registerPreviewTerminalWorkspace: (owner: DevScopePreviewTerminalWorkspaceOwner) =>
            ipcRenderer.invoke('devscope:previewTerminal:registerWorkspace', owner),
        releasePreviewTerminalWorkspace: (workspaceCapability: string) =>
            ipcRenderer.invoke('devscope:previewTerminal:releaseWorkspace', workspaceCapability),
        createPreviewTerminal: (input: DevScopePreviewTerminalAccess & {
            sessionId: string
            targetPath?: string
            preferredShell?: 'powershell' | 'cmd'
            cols?: number
            rows?: number
            title?: string
        }) => ipcRenderer.invoke('devscope:previewTerminal:create', input),
        listPreviewTerminalSessions: (input?: DevScopePreviewTerminalAccess & { targetPath?: string }) =>
            ipcRenderer.invoke('devscope:previewTerminal:list', input),
        writePreviewTerminal: (input: DevScopePreviewTerminalAccess & { sessionId: string; data: string }) =>
            ipcRenderer.invoke('devscope:previewTerminal:write', input),
        setPreviewTerminalTitle: (input: DevScopePreviewTerminalAccess & { sessionId: string; title: string }) =>
            ipcRenderer.invoke('devscope:previewTerminal:setTitle', input),
        resizePreviewTerminal: (input: DevScopePreviewTerminalAccess & { sessionId: string; cols: number; rows: number }) =>
            ipcRenderer.invoke('devscope:previewTerminal:resize', input),
        clearPreviewTerminal: (input: string | (DevScopePreviewTerminalAccess & { sessionId: string })) =>
            ipcRenderer.invoke('devscope:previewTerminal:clear', input),
        closePreviewTerminal: (input: string | (DevScopePreviewTerminalAccess & { sessionId: string })) =>
            ipcRenderer.invoke('devscope:previewTerminal:close', input),
        onPreviewTerminalEvent: (callback: (event: DevScopePreviewTerminalEvent) => void, workspaceCapability?: string) => {
            const channel = workspaceCapability
                ? `${PREVIEW_TERMINAL_EVENT_CHANNEL}:${workspaceCapability}`
                : PREVIEW_TERMINAL_EVENT_CHANNEL
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopePreviewTerminalEvent) => {
                callback(payload)
            }
            ipcRenderer.on(channel, listener)
            return () => {
                ipcRenderer.removeListener(channel, listener)
            }
        },
        getBrowserPreviewConfig: () =>
            ipcRenderer.invoke('devscope:browserPreview:getConfig'),
        listBrowserExtensions: () => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.list),
        installBrowserExtension: () => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.install),
        inspectBrowserExtensionFromWebStore: (urlOrId: string) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.inspectWebStore, { urlOrId }),
        approveBrowserExtensionFromWebStore: (id: string) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.approveWebStore, id),
        discardBrowserExtensionFromWebStore: (id: string) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.discardWebStore, id),
        setBrowserExtensionEnabled: (input: { id: string; enabled: boolean }) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.setEnabled, input),
        removeBrowserExtension: (id: string) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.remove, id),
        reloadBrowserExtension: (id: string) => ipcRenderer.invoke(BROWSER_EXTENSIONS_IPC.reload, id),
        getBrowserPageIcon: (pageUrl: string) => ipcRenderer.invoke(BROWSER_PAGE_ICON_CHANNEL, pageUrl),
        listBrowserDownloads: () => ipcRenderer.invoke(BROWSER_DOWNLOADS_LIST_CHANNEL),
        actOnBrowserDownload: (action: BrowserDownloadAction) => ipcRenderer.invoke(BROWSER_DOWNLOADS_ACTION_CHANNEL, action),
        getBrowserDownloadPreviewTarget: (id: string) => ipcRenderer.invoke(BROWSER_DOWNLOADS_PREVIEW_CHANNEL, id),
        listBrowserDownloadsFolder: () => ipcRenderer.invoke(BROWSER_DOWNLOADS_FOLDER_LIST_CHANNEL),
        actOnBrowserDownloadsFolderEntry: (action: BrowserDownloadsFolderAction) => ipcRenderer.invoke(BROWSER_DOWNLOADS_FOLDER_ACTION_CHANNEL, action),
        onBrowserDownloadsChanged: (callback: (downloads: BrowserDownloadRecord[]) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, downloads: BrowserDownloadRecord[]) => callback(downloads)
            ipcRenderer.on(BROWSER_DOWNLOADS_CHANGED_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_DOWNLOADS_CHANGED_CHANNEL, listener)
        },
        getBrowserHistory: (input?: { query?: string; limit?: number }) =>
            ipcRenderer.invoke('devscope:browserPreview:getHistory', input),
        getBrowserBookmarks: () => ipcRenderer.invoke('devscope:browserPreview:getBookmarks'),
        saveBrowserBookmark: (input: { url: string; title?: string | null; faviconUrl?: string | null }) => ipcRenderer.invoke('devscope:browserPreview:saveBookmark', input),
        removeBrowserBookmark: (url: string) => ipcRenderer.invoke('devscope:browserPreview:removeBookmark', url),
        getBrowserSearchSuggestions: (input: { query: string }) =>
            ipcRenderer.invoke('devscope:browserPreview:getSearchSuggestions', input),
        scanExternalBrowserHistoryProfiles: () =>
            ipcRenderer.invoke('devscope:browserPreview:scanExternalHistory'),
        importExternalBrowserHistory: (input: ExternalBrowserHistoryImportInput) =>
            ipcRenderer.invoke('devscope:browserPreview:importExternalHistory', input),
        recordBrowserHistory: (input: DevScopeBrowserHistoryRecordInput) =>
            ipcRenderer.invoke('devscope:browserPreview:recordHistory', input),
        clearBrowserHistory: () =>
            ipcRenderer.invoke('devscope:browserPreview:clearHistory'),
        getBrowserAdBlockStatus: () =>
            ipcRenderer.invoke('devscope:browserPreview:getAdBlockStatus'),
        setBrowserAdBlockEnabled: (input: { enabled: boolean; promptDismissed?: boolean }) =>
            ipcRenderer.invoke('devscope:browserPreview:setAdBlockEnabled', input),
        onBrowserAdDetected: (callback: (event: DevScopeBrowserAdDetection) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeBrowserAdDetection) => callback(payload)
            ipcRenderer.on(BROWSER_ADBLOCK_DETECTED_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_ADBLOCK_DETECTED_CHANNEL, listener)
        },
        onBrowserOpenTabRequested: (callback: (event: DevScopeBrowserOpenTabRequest) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeBrowserOpenTabRequest) => callback(payload)
            ipcRenderer.on(BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_PREVIEW_OPEN_TAB_REQUESTED_CHANNEL, listener)
        },
        onBrowserShortcut: (callback: (event: DevScopeBrowserShortcutEvent) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeBrowserShortcutEvent) => callback(payload)
            ipcRenderer.on(BROWSER_PREVIEW_SHORTCUT_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_PREVIEW_SHORTCUT_CHANNEL, listener)
        },
        checkBrowserThreatNavigation: (input: DevScopeBrowserThreatCheckInput) =>
            ipcRenderer.invoke('devscope:browserPreview:checkThreatNavigation', input),
        proceedBrowserThreatWarning: (decisionId: string) =>
            ipcRenderer.invoke('devscope:browserPreview:proceedThreatWarning', decisionId),
        dismissBrowserThreatWarning: (decisionId: string) =>
            ipcRenderer.invoke('devscope:browserPreview:dismissThreatWarning', decisionId),
        onBrowserThreatBlocked: (callback: (event: DevScopeBrowserThreatWarning) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeBrowserThreatWarning) => callback(payload)
            ipcRenderer.on(BROWSER_THREAT_BLOCKED_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_THREAT_BLOCKED_CHANNEL, listener)
        },
        getBrowserBackgroundProviderStatus: () =>
            ipcRenderer.invoke('devscope:browserPreview:getBackgroundProviderStatus'),
        validateBrowserUnsplashAccessKey: (input: { accessKey: string }) =>
            ipcRenderer.invoke('devscope:browserPreview:validateUnsplashAccessKey', input),
        getBrowserRemoteBackgrounds: (input: { category: DevScopeBrowserBackgroundCategory; refresh?: boolean; query?: string }) =>
            ipcRenderer.invoke('devscope:browserPreview:getRemoteBackgrounds', input),
        trackBrowserRemoteBackground: (input: { downloadLocation: string }) =>
            ipcRenderer.invoke('devscope:browserPreview:trackRemoteBackground', input),
        clearBrowserPreviewData: () =>
            ipcRenderer.invoke('devscope:browserPreview:clearData'),
        clearBrowserPreviewCache: () =>
            ipcRenderer.invoke('devscope:browserPreview:clearCache'),
        clearBrowserPreviewCookies: () =>
            ipcRenderer.invoke('devscope:browserPreview:clearCookies'),
        hardReloadBrowserPreview: (input: DevScopeBrowserGuestTargetInput) =>
            ipcRenderer.invoke('devscope:browserPreview:hardReload', input),
        setBrowserPreviewZoom: (input: DevScopeBrowserGuestTargetInput & { factor: number }) =>
            ipcRenderer.invoke('devscope:browserPreview:setZoom', input),
        setBrowserPreviewColorScheme: (input: DevScopeBrowserGuestTargetInput & { colorScheme: 'system' | 'light' | 'dark' }) =>
            ipcRenderer.invoke('devscope:browserPreview:setColorScheme', input),
        openBrowserPreviewDevTools: (input: DevScopeBrowserGuestTargetInput & { mode?: 'docked' | 'popout' }) =>
            ipcRenderer.invoke('devscope:browserPreview:openDevTools', input),
        captureBrowserPreviewScreenshot: (input: DevScopeBrowserGuestTargetInput) =>
            ipcRenderer.invoke('devscope:browserPreview:captureScreenshot', input),
        stageBrowserPreviewArtifactForAssistant: (artifactId: string) =>
            ipcRenderer.invoke('devscope:browserPreview:stageArtifactForAssistant', artifactId),
        openBrowserPreviewArtifact: (artifactId: string) =>
            ipcRenderer.invoke('devscope:browserPreview:openArtifact', artifactId),
        revealBrowserPreviewArtifact: (artifactId: string) =>
            ipcRenderer.invoke('devscope:browserPreview:revealArtifact', artifactId),
        copyBrowserPreviewArtifact: (input: { artifactId: string; mode: 'image' | 'path' }) =>
            ipcRenderer.invoke('devscope:browserPreview:copyArtifact', input),
        startBrowserPreviewAnnotation: (input: DevScopeBrowserAnnotationInput) =>
            ipcRenderer.invoke('devscope:browserPreview:startAnnotation', input),
        cancelBrowserPreviewAnnotation: (input: DevScopeBrowserGuestTargetInput) =>
            ipcRenderer.invoke('devscope:browserPreview:cancelAnnotation', input),
        startBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput) =>
            ipcRenderer.invoke('devscope:browserPreview:startRecording', input),
        prepareBrowserPreviewRecordingAudio: (input: DevScopeBrowserGuestTargetInput & { source: 'tab' | 'system' }) =>
            ipcRenderer.invoke('devscope:browserPreview:prepareRecordingAudio', input),
        stopBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput) =>
            ipcRenderer.invoke('devscope:browserPreview:stopRecording', input),
        saveBrowserPreviewRecording: (input: DevScopeBrowserGuestTargetInput & { mimeType: string; data: Uint8Array }) =>
            ipcRenderer.invoke('devscope:browserPreview:saveRecording', input),
        onBrowserPreviewRecordingFrame: (callback: (frame: DevScopeBrowserRecordingFrame) => void) => {
            const listener = (_event: Electron.IpcRendererEvent, frame: DevScopeBrowserRecordingFrame) => callback(frame)
            ipcRenderer.on(BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL, listener)
            return () => ipcRenderer.removeListener(BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL, listener)
        },
        getBrowserLinkPreview: (input: { url: string }) =>
            ipcRenderer.invoke('devscope:browserPreview:getLinkPreview', input),
        openBrowserPreviewExternal: (url: string) =>
            ipcRenderer.invoke('devscope:browserPreview:openExternal', url),
        openFile: (filePath: string) => ipcRenderer.invoke('devscope:openFile', filePath),
        openWith: (filePath: string) => ipcRenderer.invoke('devscope:openWith', filePath),
        createFileSystemItem: (destinationDirectory: string, name: string, type: 'file' | 'directory') =>
            ipcRenderer.invoke('devscope:createFileSystemItem', destinationDirectory, name, type),
        renameFileSystemItem: (targetPath: string, nextName: string) =>
            ipcRenderer.invoke('devscope:renameFileSystemItem', targetPath, nextName),
        deleteFileSystemItem: (targetPath: string) => ipcRenderer.invoke('devscope:deleteFileSystemItem', targetPath),
        pasteFileSystemItem: (sourcePath: string, destinationDirectory: string) =>
            ipcRenderer.invoke('devscope:pasteFileSystemItem', sourcePath, destinationDirectory),
        moveFileSystemItem: (sourcePath: string, destinationDirectory: string) =>
            ipcRenderer.invoke('devscope:moveFileSystemItem', sourcePath, destinationDirectory),
        getProjectSessions: (_projectPath: string) => Promise.resolve({ success: true, sessions: [] }),
        getProjectProcesses: (projectPath: string) => ipcRenderer.invoke('devscope:getProjectProcesses', projectPath),
        getRunningLocalServers: (projectPath?: string) => ipcRenderer.invoke('devscope:getRunningLocalServers', projectPath),
        indexAllFolders: (folders: string[], options?: { forceRefresh?: boolean }) =>
            ipcRenderer.invoke('devscope:indexAllFolders', folders, options),
        searchIndexedPaths: (input: {
            scopePath?: string
            roots?: string[]
            term?: string
            extensionFilters?: string[]
            limit?: number
            includeFiles?: boolean
            includeDirectories?: boolean
            includeAncestors?: boolean
            showHidden?: boolean
        }) => ipcRenderer.invoke('devscope:searchIndexedPaths', input),
        searchProjectContents: (input: import('../../shared/contracts/project-content-search').ProjectContentSearchInput) => ipcRenderer.invoke('devscope:searchProjectContents', input),
        getFileSystemRoots: () => ipcRenderer.invoke('devscope:getFileSystemRoots')
    }
}
