import type { BrowserSessionMode } from './browser-view'

export const ACCESSORIES_IPC = {
    open: 'devscope:accessories:open',
    getState: 'devscope:accessories:getState',
    acknowledge: 'devscope:accessories:acknowledge',
    syncBrowserTabs: 'devscope:accessories:syncBrowserTabs',
    registerBrowserDropZone: 'devscope:accessories:registerBrowserDropZone',
    beginBrowserTabTearOff: 'devscope:accessories:beginBrowserTabTearOff',
    finishBrowserTabTearOff: 'devscope:accessories:finishBrowserTabTearOff',
    cancelBrowserTabTearOff: 'devscope:accessories:cancelBrowserTabTearOff',
    tabLayout: 'devscope:accessories:tabLayout',
    changed: 'devscope:accessories:changed'
} as const

export type AccessoryKind = 'browser' | 'terminal' | 'files' | 'devscope'

export type AccessoryOpenInput = {
    kind: AccessoryKind
    sessionMode?: BrowserSessionMode
    url?: string
}

export type AccessoryNavigationRequest = {
    id: string
    url: string
    sessionMode: BrowserSessionMode
}

export type AccessoryBrowserTab = {
    id: string
    sessionMode: BrowserSessionMode
    url: string
    title: string
    faviconUrl: string | null
}

export type AccessoryBrowserTabsInput = {
    workspaceId: string
    activeTabId: string | null
    tabs: AccessoryBrowserTab[]
}

export type AccessoryBrowserDropZoneInput = {
    workspaceId: string
    rect: { x: number; y: number; width: number; height: number }
    vertical?: boolean
    tabSlots: Array<{ tabId: string; index: number; left: number; right: number; top?: number; bottom?: number }>
}

export type AccessoryBrowserTearOffBeginInput = {
    workspaceId: string
    tabId: string
    screenPoint: { x: number; y: number }
    grabOffset: { x: number; y: number }
}

export type AccessoryBrowserTearOffFinishInput = {
    sessionId: string
    screenPoint: { x: number; y: number }
}

export type AccessoryWindowState = {
    id: string
    kind: AccessoryKind
    sessionMode: BrowserSessionMode
    rootPath: string
    requests: AccessoryNavigationRequest[]
    browserTabs: AccessoryBrowserTab[]
    activeBrowserTabId: string | null
    provisional?: boolean
}

export type AccessoryResult<T extends object = Record<string, never>> =
    | ({ success: true } & T)
    | { success: false; error: string }

export type AccessoriesApi = {
    open(input: AccessoryOpenInput): Promise<AccessoryResult<{ state: AccessoryWindowState }>>
    getState(): Promise<AccessoryResult<{ state: AccessoryWindowState }>>
    acknowledge(requestId: string): Promise<AccessoryResult<{ state: AccessoryWindowState }>>
    syncBrowserTabs(input: AccessoryBrowserTabsInput): Promise<AccessoryResult<{ state: AccessoryWindowState }>>
    registerBrowserDropZone(input: AccessoryBrowserDropZoneInput | null): Promise<AccessoryResult<{ registered: true }>>
    beginBrowserTabTearOff(input: AccessoryBrowserTearOffBeginInput): Promise<AccessoryResult<{ sessionId: string; targetWorkspaceId: string }>>
    finishBrowserTabTearOff(input: AccessoryBrowserTearOffFinishInput): Promise<AccessoryResult<{ committed: boolean; targetWorkspaceId: string }>>
    cancelBrowserTabTearOff(sessionId: string): Promise<AccessoryResult<{ cancelled: true }>>
    onTabLayout?(callback: (vertical: boolean) => void): () => void
    onChanged(callback: (state: AccessoryWindowState) => void): () => void
}
