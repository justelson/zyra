import { sanitizeBrowserPersistentUrl } from '../browser-url-sanitization'
import type { AssistantChatScopeRoot } from './contracts/project'

export const ASSISTANT_UTILITY_GROUP_COLORS = ['#5b8cff', '#a879ff', '#35b889', '#e3a23b', '#e36d76', '#41a7c7', '#c97bd7', '#8ba45b'] as const

export const ASSISTANT_UTILITY_IPC = {
    getState: 'devscope:assistantUtility:getState',
    selectTab: 'devscope:assistantUtility:selectTab',
    closeTab: 'devscope:assistantUtility:closeTab',
    reorderTab: 'devscope:assistantUtility:reorderTab',
    moveTab: 'devscope:assistantUtility:moveTab',
    registerDropZone: 'devscope:assistantUtility:registerDropZone',
    tabReady: 'devscope:assistantUtility:tabReady',
    updateTab: 'devscope:assistantUtility:updateTab',
    updateStateCapsule: 'devscope:assistantUtility:updateStateCapsule',
    addTab: 'devscope:assistantUtility:addTab',
    changed: 'devscope:assistantUtility:changed',
    incomingMainTab: 'devscope:assistantUtility:incomingMainTab',
    cancelIncomingMainTab: 'devscope:assistantUtility:cancelIncomingMainTab',
    completeIncomingMainTab: 'devscope:assistantUtility:completeIncomingMainTab',
    detachMainTab: 'devscope:assistantUtility:detachMainTab',
    beginTearOff: 'devscope:assistantUtility:beginTearOff',
    finishTearOff: 'devscope:assistantUtility:finishTearOff',
    cancelTearOff: 'devscope:assistantUtility:cancelTearOff'
} as const

export type AssistantUtilityWorkspaceKind =
    | 'browser'
    | 'details'
    | 'explorer'
    | 'resources'
    | 'agents'
    | 'diff'
    | 'terminal'
    | 'turn'

export type AssistantUtilityScrollAnchor = {
    key: string
    offset: number
}

export type AssistantUtilityDiffSelection = {
    turnId?: string
    activityId?: string
    filePath: string
    previousPath?: string
}

export type AssistantUtilityExplorerStateCapsule = {
    version: 1
    workspace: 'explorer'
    rootPath?: string
    currentFolderPath?: string
    expandedPaths?: string[]
    selectedPath?: string
    activePreview?: {
        name: string
        path: string
        extension: string
        mode?: 'preview' | 'edit'
        expanded?: boolean
    }
    scrollAnchor?: AssistantUtilityScrollAnchor
}

export type AssistantUtilityReviewStateCapsule = {
    version: 1
    workspace: 'diff' | 'turn'
    selectedTurnId?: string
    selectedDiff?: AssistantUtilityDiffSelection
    scrollAnchor?: AssistantUtilityScrollAnchor
}

export type AssistantUtilityResourcesStateCapsule = {
    version: 1
    workspace: 'resources'
    query?: string
    kindFilter?: 'all' | 'images' | 'links'
    sourceFilter?: 'all' | 'attached' | 'generated' | 'changed' | 'mentioned'
    turnFilter?: string
    selectedResourceId?: string
    drillDown?: { turnId: string; selectedDiff?: AssistantUtilityDiffSelection }
    scrollAnchor?: AssistantUtilityScrollAnchor
}

export type AssistantUtilityDetailsStateCapsule = {
    version: 1
    workspace: 'details'
    scrollAnchor?: AssistantUtilityScrollAnchor
}

export type AssistantUtilityAgentsStateCapsule = {
    version: 1
    workspace: 'agents'
    section?: 'agents' | 'workflows'
    agentPage?: number
    workflowPage?: number
    selectedAgentRunId?: string
    selectedWorkflowRunId?: string
    scrollAnchor?: AssistantUtilityScrollAnchor
}

export type AssistantUtilityStateCapsule =
    | AssistantUtilityExplorerStateCapsule
    | AssistantUtilityReviewStateCapsule
    | AssistantUtilityResourcesStateCapsule
    | AssistantUtilityDetailsStateCapsule
    | AssistantUtilityAgentsStateCapsule

export type AssistantUtilityTab = {
    id: string
    canonicalChatId: string
    sessionId: string
    threadId: string
    chatTitle: string
    projectPath: string
    projectRoots?: AssistantChatScopeRoot[]
    workspace: AssistantUtilityWorkspaceKind
    title: string
    colorIndex: number
    sessionMode?: 'normal' | 'incognito'
    url?: string
    hasLivePage?: boolean
    faviconUrl?: string
    terminalRuntimeId?: string
    path?: string
    turnId?: string
    stateCapsule?: AssistantUtilityStateCapsule
    createdAt: string
    updatedAt: string
}

export function sanitizeAssistantUtilityTabForPersistence(tab: AssistantUtilityTab): AssistantUtilityTab {
    const { hasLivePage: _hasLivePage, ...persistentValues } = tab
    const persistentTab = {
        ...persistentValues,
        projectRoots: sanitizeAssistantUtilityProjectRoots(tab.projectRoots)
    }
    if (tab.workspace !== 'browser') return persistentTab
    return {
        ...persistentTab,
        url: sanitizeBrowserPersistentUrl(tab.url) || '',
        faviconUrl: sanitizeBrowserPersistentUrl(tab.faviconUrl, 4_096) || undefined
    }
}

export type AssistantUtilityWindowState = {
    id: string
    revision: number
    provisional?: boolean
    activeTabId: string | null
    tabs: AssistantUtilityTab[]
}

export type AssistantUtilityState = {
    version: 1
    windows: AssistantUtilityWindowState[]
}

export type AssistantUtilityMoveInput = {
    tabId: string
    sourceWindowId: string | 'main'
    screenPoint?: { x: number; y: number }
    targetWindowId?: string | 'main'
    targetIndex?: number
    newWindow?: boolean
}

export type AssistantUtilityDropZoneInput = {
    windowId: string | 'main'
    rect: { x: number; y: number; width: number; height: number }
    canonicalChatId?: string | null
    tabSlots?: Array<{ tabId: string; index: number; left: number; right: number }>
}

export type AssistantUtilityAddTabInput = {
    windowId: string
    workspace: Exclude<AssistantUtilityWorkspaceKind, 'turn'>
    sourceTabId?: string
    sessionMode?: 'normal' | 'incognito'
}

export type AssistantUtilityMainTabInput = {
    tab: AssistantUtilityTab
    screenPoint?: { x: number; y: number }
    newWindow?: boolean
}

export type AssistantUtilityTearOffBeginInput = {
    sourceWindowId: string | 'main'
    tab: AssistantUtilityTab
    screenPoint: { x: number; y: number }
    grabOffset: { x: number; y: number }
}

export type AssistantUtilityTearOffFinishInput = {
    sessionId: string
    screenPoint: { x: number; y: number }
}

export type AssistantUtilityTearOffResult = {
    sessionId: string
    targetWindowId: string
}

export type AssistantUtilityTearOffFinishResult = {
    committed: boolean
    targetWindowId: string
}

export type AssistantUtilityApi = {
    getState(windowId: string): Promise<{ success: true; state: AssistantUtilityWindowState } | { success: false; error: string }>
    selectTab(windowId: string, tabId: string): Promise<{ success: boolean; error?: string }>
    closeTab(windowId: string, tabId: string): Promise<{ success: boolean; error?: string }>
    reorderTab(windowId: string, fromTabId: string, toTabId: string): Promise<{ success: boolean; error?: string }>
    moveTab(input: AssistantUtilityMoveInput): Promise<{ success: boolean; error?: string; targetWindowId?: string }>
    registerDropZone(input: AssistantUtilityDropZoneInput | null): Promise<{ success: boolean; error?: string }>
    tabReady(windowId: string, tabId: string): Promise<{ success: boolean; error?: string }>
    updateTab(windowId: string, tabId: string, patch: { title?: string; url?: string; hasLivePage?: boolean; faviconUrl?: string | null }): Promise<{ success: boolean; error?: string }>
    updateStateCapsule(windowId: string, tabId: string, capsule: AssistantUtilityStateCapsule | null): Promise<{ success: boolean; error?: string }>
    addTab(input: AssistantUtilityAddTabInput): Promise<{ success: boolean; error?: string; tabId?: string }>
    detachMainTab(input: AssistantUtilityMainTabInput): Promise<{ success: boolean; error?: string; targetWindowId?: string }>
    beginTearOff(input: AssistantUtilityTearOffBeginInput): Promise<{ success: boolean; error?: string; sessionId?: string; targetWindowId?: string }>
    finishTearOff(input: AssistantUtilityTearOffFinishInput): Promise<{ success: boolean; error?: string; committed?: boolean; targetWindowId?: string }>
    cancelTearOff(sessionId: string): Promise<{ success: boolean; error?: string }>
    completeIncomingMainTab(requestId: string, accepted: boolean, error?: string): Promise<{ success: boolean; error?: string }>
    onStateChange(callback: (state: AssistantUtilityWindowState) => void): () => void
    onIncomingMainTab(callback: (input: { requestId: string; tab: AssistantUtilityTab }) => void): () => void
    onCancelIncomingMainTab(callback: (input: { requestId: string; tabId: string }) => void): () => void
}

const CAPSULE_ID_LIMIT = 192
const CAPSULE_PATH_LIMIT = 1_024
const CAPSULE_QUERY_LIMIT = 256
const CAPSULE_EXPANDED_PATH_LIMIT = 64
const CAPSULE_SCROLL_LIMIT = 10_000_000

function sanitizeAssistantUtilityProjectRoots(value: unknown): AssistantChatScopeRoot[] | undefined {
    if (!Array.isArray(value)) return undefined
    const roots = value.slice(0, 64).flatMap((candidate) => {
        const record = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : null
        const id = boundedString(record?.['id'], 256)
        const path = boundedString(record?.['path'], CAPSULE_PATH_LIMIT)
        if (!id || !path) return []
        return [{
            id,
            kind: record?.['kind'] === 'project-home' ? 'project-home' as const : 'associated-folder' as const,
            path,
            label: boundedString(record?.['label'], 256) || path,
            access: record?.['access'] === 'read-only' ? 'read-only' as const : 'read-write' as const
        }]
    })
    return roots.length > 0 ? roots : undefined
}

function boundedString(value: unknown, limit: number): string | undefined {
    if (typeof value !== 'string') return undefined
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit)
    return clean || undefined
}

function boundedInteger(value: unknown, maximum: number): number | undefined {
    const number = Number(value)
    if (!Number.isFinite(number)) return undefined
    return Math.max(0, Math.min(maximum, Math.floor(number)))
}

function sanitizeScrollAnchor(value: unknown): AssistantUtilityScrollAnchor | undefined {
    if (!value || typeof value !== 'object') return undefined
    const input = value as Record<string, unknown>
    const key = boundedString(input['key'], CAPSULE_ID_LIMIT)
    const offset = boundedInteger(input['offset'], CAPSULE_SCROLL_LIMIT)
    return key && offset !== undefined ? { key, offset } : undefined
}

function sanitizeDiffSelection(value: unknown): AssistantUtilityDiffSelection | undefined {
    if (!value || typeof value !== 'object') return undefined
    const input = value as Record<string, unknown>
    const filePath = boundedString(input['filePath'], CAPSULE_PATH_LIMIT)
    if (!filePath) return undefined
    return {
        filePath,
        turnId: boundedString(input['turnId'], CAPSULE_ID_LIMIT),
        activityId: boundedString(input['activityId'], CAPSULE_ID_LIMIT),
        previousPath: boundedString(input['previousPath'], CAPSULE_PATH_LIMIT)
    }
}

export function sanitizeAssistantUtilityStateCapsule(
    value: unknown,
    expectedWorkspace?: AssistantUtilityWorkspaceKind
): AssistantUtilityStateCapsule | undefined {
    if (!value || typeof value !== 'object') return undefined
    const input = value as Record<string, unknown>
    if (input['version'] !== 1) return undefined
    const workspace = boundedString(input['workspace'], 16) as AssistantUtilityStateCapsule['workspace'] | undefined
    if (!workspace || (expectedWorkspace && workspace !== expectedWorkspace)) return undefined
    const scrollAnchor = sanitizeScrollAnchor(input['scrollAnchor'])

    if (workspace === 'explorer') {
        const expandedPaths = (Array.isArray(input['expandedPaths']) ? input['expandedPaths'] : [])
            .flatMap((entry) => boundedString(entry, CAPSULE_PATH_LIMIT) || [])
            .filter((entry, index, entries) => entries.indexOf(entry) === index)
            .slice(0, CAPSULE_EXPANDED_PATH_LIMIT)
        const previewInput = input['activePreview'] && typeof input['activePreview'] === 'object'
            ? input['activePreview'] as Record<string, unknown>
            : null
        const previewPath = boundedString(previewInput?.['path'], CAPSULE_PATH_LIMIT)
        const previewName = boundedString(previewInput?.['name'], CAPSULE_ID_LIMIT)
        return {
            version: 1,
            workspace,
            rootPath: boundedString(input['rootPath'], CAPSULE_PATH_LIMIT),
            currentFolderPath: boundedString(input['currentFolderPath'], CAPSULE_PATH_LIMIT),
            expandedPaths: expandedPaths.length ? expandedPaths : undefined,
            selectedPath: boundedString(input['selectedPath'], CAPSULE_PATH_LIMIT),
            activePreview: previewPath && previewName ? {
                path: previewPath,
                name: previewName,
                extension: boundedString(previewInput?.['extension'], 32) || '',
                mode: previewInput?.['mode'] === 'preview' || previewInput?.['mode'] === 'edit'
                    ? previewInput['mode']
                    : undefined,
                expanded: typeof previewInput?.['expanded'] === 'boolean' ? previewInput.expanded : undefined
            } : undefined,
            scrollAnchor
        }
    }

    if (workspace === 'diff' || workspace === 'turn') {
        return {
            version: 1,
            workspace,
            selectedTurnId: boundedString(input['selectedTurnId'], CAPSULE_ID_LIMIT),
            selectedDiff: sanitizeDiffSelection(input['selectedDiff']),
            scrollAnchor
        }
    }

    if (workspace === 'resources') {
        const kindFilter = ['all', 'images', 'links'].includes(String(input['kindFilter']))
            ? input['kindFilter'] as AssistantUtilityResourcesStateCapsule['kindFilter']
            : undefined
        const sourceFilter = ['all', 'attached', 'generated', 'changed', 'mentioned'].includes(String(input['sourceFilter']))
            ? input['sourceFilter'] as AssistantUtilityResourcesStateCapsule['sourceFilter']
            : undefined
        const drillInput = input['drillDown'] && typeof input['drillDown'] === 'object'
            ? input['drillDown'] as Record<string, unknown>
            : null
        const drillTurnId = boundedString(drillInput?.['turnId'], CAPSULE_ID_LIMIT)
        return {
            version: 1,
            workspace,
            query: boundedString(input['query'], CAPSULE_QUERY_LIMIT),
            kindFilter,
            sourceFilter,
            turnFilter: boundedString(input['turnFilter'], CAPSULE_ID_LIMIT),
            selectedResourceId: boundedString(input['selectedResourceId'], CAPSULE_ID_LIMIT),
            drillDown: drillTurnId ? { turnId: drillTurnId, selectedDiff: sanitizeDiffSelection(drillInput?.['selectedDiff']) } : undefined,
            scrollAnchor
        }
    }

    if (workspace === 'details') return { version: 1, workspace, scrollAnchor }

    if (workspace === 'agents') {
        return {
            version: 1,
            workspace,
            section: input['section'] === 'workflows' ? 'workflows' : input['section'] === 'agents' ? 'agents' : undefined,
            agentPage: boundedInteger(input['agentPage'], 10_000),
            workflowPage: boundedInteger(input['workflowPage'], 10_000),
            selectedAgentRunId: boundedString(input['selectedAgentRunId'], CAPSULE_ID_LIMIT),
            selectedWorkflowRunId: boundedString(input['selectedWorkflowRunId'], CAPSULE_ID_LIMIT),
            scrollAnchor
        }
    }

    return undefined
}
