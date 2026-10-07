export const BROWSER_VIEW_IPC = {
    ensure: 'devscope:browserView:ensure',
    command: 'devscope:browserView:command',
    close: 'devscope:browserView:close',
    release: 'devscope:browserView:release',
    reportSlot: 'devscope:browserView:reportSlot',
    refreshTheme: 'devscope:browserView:refreshTheme',
    event: 'devscope:browserView:event'
} as const

export const BROWSER_LOCAL_FILE_SCHEME = 'zyra-local'

export type BrowserViewStatus = 'idle' | 'loading' | 'ready' | 'error'
export type BrowserSessionMode = 'normal' | 'incognito'

export type BrowserViewBounds = {
    x: number
    y: number
    width: number
    height: number
}

export type BrowserViewState = {
    version: 1
    revision: number
    tabId: string
    sessionMode: BrowserSessionMode
    guestWebContentsId: number
    url: string
    displayAddress: string | null
    title: string
    status: BrowserViewStatus
    error: string | null
    canGoBack: boolean
    canGoForward: boolean
    faviconUrl: string | null
    audible: boolean
    fullscreen: boolean
}

export type BrowserViewStateCause =
    | 'snapshot'
    | 'navigation'
    | 'metadata'
    | 'audio'
    | 'fullscreen'
    | 'ownership'
    | 'error'

export type BrowserViewEvent =
    | { type: 'link-hover'; tabId: string; url: string }
    | {
        type: 'state'
        cause: BrowserViewStateCause
        state: BrowserViewState
    }
    | {
        type: 'focus'
        tabId: string
        guestWebContentsId: number
    }

export type BrowserViewEnsureInput = {
    tabId: string
    threadId: string
    sessionMode?: BrowserSessionMode
    initialUrl?: string
}

export type BrowserViewSlotInput = {
    tabId: string
    revision: number
    bounds: BrowserViewBounds | null
    contentSize: { width: number; height: number } | null
    active: boolean
    visible: boolean
}

export type BrowserViewControlOverlay = {
    controlled: boolean
    cursor: {
        x: number
        y: number
        visible: boolean
        phase: 'idle' | 'moving' | 'pressing' | 'dragging' | 'typing' | 'scrolling'
        label: 'Zyra' | 'Agent'
    } | null
}

export type BrowserViewCommand =
    | { tabId: string; type: 'navigate'; url: string }
    | { tabId: string; type: 'open-local-file' }
    | { tabId: string; type: 'back' }
    | { tabId: string; type: 'forward' }
    | { tabId: string; type: 'reload' }
    | { tabId: string; type: 'new-tab' }
    | { tabId: string; type: 'stop' }
    | { tabId: string; type: 'focus' }
    | { tabId: string; type: 'blur' }
    | { tabId: string; type: 'capture' }
    | ({ tabId: string; type: 'control-overlay' } & BrowserViewControlOverlay)

export type BrowserViewResult<T extends object = Record<string, never>> =
    | ({ success: true } & T)
    | { success: false; error: string }

export type BrowserViewApi = {
    ensure(input: BrowserViewEnsureInput): Promise<BrowserViewResult<{ created: boolean; state: BrowserViewState }>>
    command(command: BrowserViewCommand): Promise<BrowserViewResult<{ accepted: boolean; state: BrowserViewState; snapshotDataUrl?: string }>>
    close(tabId: string): Promise<BrowserViewResult<{ closed: boolean }>>
    release(tabId: string): void
    reportSlot(input: BrowserViewSlotInput): void
    refreshTheme(): void
    onEvent(callback: (event: BrowserViewEvent) => void): () => void
}
