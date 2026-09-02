import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron'
import { ipcMain } from '../ipc/trusted-ipc'
import {
    ASSISTANT_UTILITY_GROUP_COLORS,
    ASSISTANT_UTILITY_IPC,
    type AssistantUtilityAddTabInput,
    type AssistantUtilityDropZoneInput,
    type AssistantUtilityMainTabInput,
    type AssistantUtilityMoveInput,
    type AssistantUtilityState,
    type AssistantUtilityTearOffBeginInput,
    type AssistantUtilityTearOffFinishInput,
    type AssistantUtilityTab,
    type AssistantUtilityWindowState,
    type AssistantUtilityWorkspaceKind,
    sanitizeAssistantUtilityStateCapsule,
    sanitizeAssistantUtilityTabForPersistence
} from '../../shared/assistant/utility-window'
import { writeJsonAtomically } from '../setup/atomic-json'
import { sanitizeBrowserPersistentUrl } from '../../shared/browser-url-sanitization'
import { getAgentControlBroker } from '../agent-control'
import type { BrowserViewTransferHost } from '../browser-view-manager'
import { classifyAnalyticsErrorCode as utilityAnalyticsErrorCode } from '../../shared/analytics/error-code'
import { normalizeAnalyticsWorkspaceKind as utilityAnalyticsTabKind } from '../../shared/analytics/contracts'

const MAX_WINDOWS = 8
const MAX_TABS_PER_WINDOW = 32
const READY_TIMEOUT_MS = 8_000

export type ResolvedUtilityChat = {
    canonicalChatId: string
    sessionId: string
    threadId: string
    chatTitle: string
    projectPath: string
    projectRoots: Array<{
        id: string
        kind: 'project-home' | 'associated-folder'
        path: string
        label: string
        access: 'read-only' | 'read-write'
    }>
}

export type UtilityWindowCreationOptions = {
    provisional?: boolean
    label?: string
    accentColor?: string
}

type UtilityWindowFactory = (windowId: string, options?: UtilityWindowCreationOptions) => BrowserWindow

type UtilityWindowManagerOptions = {
    userDataPath: string
    createWindow: UtilityWindowFactory
    activateWindow: (window: BrowserWindow, windowId: string) => void
    resolveChat: (canonicalChatId: string) => Promise<ResolvedUtilityChat | null>
    getMainWindow: () => BrowserWindow | null
    browserViews?: BrowserViewTransferHost
    isTrustedRenderer?: (webContentsId: number) => boolean
    captureAnalytics?: (properties: {
        action: 'tab_create' | 'tab_drag' | 'tear_off' | 'merge' | 'close' | 'terminal_transfer'
        outcome: 'started' | 'completed' | 'failed' | 'cancelled' | 'prevented' | 'unknown'
        tab_kind?: 'chat' | 'browser' | 'files' | 'terminal' | 'agents' | 'resources' | 'diff' | 'unknown'
        tab_count?: number
        error_code?: string
    }) => void
}

type PendingReady = { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

type TearOffSession = {
    id: string
    ownerWebContentsId: number
    sourceWindowId: string | 'main'
    sourceTabId: string
    targetWindowId: string
    grabOffset: { x: number; y: number }
    followTimer: NodeJS.Timeout
    expiryTimer: NodeJS.Timeout
}

export class AssistantUtilityWindowManager {
    private readonly filePath: string
    private state: AssistantUtilityState = { version: 1, windows: [] }
    private readonly windows = new Map<string, BrowserWindow>()
    private readonly dropZones = new Map<string | 'main', AssistantUtilityDropZoneInput>()
    private readonly pendingReady = new Map<string, PendingReady>()
    private readonly pendingMainMoves = new Map<string, PendingReady>()
    private readonly tearOffSessions = new Map<string, TearOffSession>()
    private loadPromise: Promise<void> | null = null
    private shuttingDown = false
    private writeQueue: Promise<void> = Promise.resolve()
    private moveQueue: Promise<unknown> = Promise.resolve()
    private registered = false
    private readonly cancelledTuiRequests = new Set<string>()
    private readonly tuiRequestTabs = new Map<string, { windowId: string; tabId: string; threadId: string }>()
    private readonly windowStackOrder = new Map<string | 'main', number>()
    private windowStackSequence = 0

    constructor(private readonly options: UtilityWindowManagerOptions) {
        this.filePath = join(options.userDataPath, 'assistant', 'utility-windows-v1.json')
    }

    registerIpc(): void {
        if (this.registered) return
        this.registered = true
        ipcMain.handle(ASSISTANT_UTILITY_IPC.getState, (event, windowId: string) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.getWindowState(windowId) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.selectTab, (event, windowId: string, tabId: string) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.selectTab(windowId, tabId) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.closeTab, (event, windowId: string, tabId: string) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.closeTab(windowId, tabId) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.reorderTab, (event, windowId: string, fromTabId: string, toTabId: string) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.reorderTab(windowId, fromTabId, toTabId) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.moveTab, (event, input: AssistantUtilityMoveInput) => this.result(event, () => { this.assertWindowAccess(event, String(input.sourceWindowId)); return this.serializeMove(() => this.moveTab(input)) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.registerDropZone, (event, input: AssistantUtilityDropZoneInput | null) => this.result(event, () => this.registerDropZone(event, input)))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.tabReady, (event, windowId: string, tabId: string) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.markTabReady(windowId, tabId) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.updateTab, (event, windowId: string, tabId: string, patch: { title?: string; url?: string; faviconUrl?: string | null }) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.updateTab(windowId, tabId, patch) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.updateStateCapsule, (event, windowId: string, tabId: string, capsule: unknown) => this.result(event, () => { this.assertWindowAccess(event, windowId); return this.updateStateCapsule(windowId, tabId, capsule) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.addTab, (event, input: AssistantUtilityAddTabInput) => this.result(event, () => { this.assertWindowAccess(event, input.windowId); return this.addTab(input) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.detachMainTab, (event, input: AssistantUtilityMainTabInput) => this.result(event, () => { this.assertMainSender(event); return this.serializeMove(() => this.detachMainTab(input)) }))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.beginTearOff, (event, input: AssistantUtilityTearOffBeginInput) => this.result(event, () => this.serializeMove(() => this.beginTearOff(event, input))))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.finishTearOff, (event, input: AssistantUtilityTearOffFinishInput) => this.result(event, () => this.serializeMove(() => this.finishTearOff(event, input))))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.cancelTearOff, (event, sessionId: string) => this.result(event, () => this.serializeMove(() => this.cancelTearOff(event, sessionId))))
        ipcMain.handle(ASSISTANT_UTILITY_IPC.completeIncomingMainTab, (event, requestId: string, accepted: boolean, error?: string) => this.result(event, () => { this.assertMainSender(event); return this.completeIncomingMainTab(requestId, accepted, error) }))
    }

    isUtilityRenderer(webContentsId: number): boolean {
        return [...this.windows.values()].some((window) => !window.isDestroyed() && window.webContents.id === webContentsId)
    }

    windowIdForWebContents(webContentsId: number): string | null {
        return this.windowIdForSender(webContentsId)
    }

    async resolveOwnedTerminalRuntimeId(webContentsId: number, tabId: string): Promise<string | null> {
        await this.load()
        const windowId = this.windowIdForSender(webContentsId)
        if (!windowId) return null
        const tab = this.findWindowState(windowId).tabs.find((entry) => entry.id === tabId)
        if (!tab || tab.workspace !== 'terminal') return null
        return String(tab.terminalRuntimeId || tab.id).trim() || null
    }

    getOpenWindows(): BrowserWindow[] {
        return [...this.windows.values()].filter((window) => !window.isDestroyed())
    }

    async restorePersistedWindows(show = true): Promise<void> {
        await this.load()
        for (const state of this.state.windows.filter((window) => window.tabs.length > 0)) {
            const window = this.ensureWindow(state.id)
            if (show) this.reveal(window, false)
        }
    }

    async handleDetachedControl(input: { canonicalChatId: string; turnId: string | null; operation: unknown; principal?: unknown; signal: AbortSignal }): Promise<Record<string, unknown>> {
        const chat = await this.options.resolveChat(input.canonicalChatId)
        if (!chat) throw Object.assign(new Error('The Browser control chat is unavailable in Desktop.'), { code: 'CONTROL_DRIVER_UNAVAILABLE' })
        const raw = input.principal && typeof input.principal === 'object' ? input.principal as Record<string, unknown> : null
        const principal = raw?.['type'] === 'agent'
            ? { type: 'agent' as const, fleetId: String(raw['fleetId'] || ''), agentRunId: String(raw['agentRunId'] || ''), parentThreadId: chat.threadId }
            : { type: 'root' as const, threadId: chat.threadId, turnId: input.turnId || String(raw?.['turnId'] || '') }
        if (principal.type === 'root' && !principal.turnId) throw Object.assign(new Error('Detached Browser control requires an active canonical turn.'), { code: 'CONTROL_PRINCIPAL_MISMATCH' })
        if (principal.type === 'root') {
            try { getAgentControlBroker().materializeUserAuthorizedBrowserGrant(chat.threadId, principal.turnId) } catch {}
        }
        return getAgentControlBroker().handleToolOperation(principal, input.operation, input.signal)
    }

    handleTuiTurnEnded(canonicalChatId: string, turnId: string): void {
        if (!canonicalChatId || !turnId) return
        void this.options.resolveChat(canonicalChatId).then((chat) => {
            if (chat) getAgentControlBroker().revokePrincipal({ type: 'root', threadId: chat.threadId, turnId }, 'Root Browser control ended with its TUI turn.')
        }).catch(() => undefined)
    }

    handleTuiTurn(canonicalChatId: string, turnId: string): void {
        if (!canonicalChatId || !turnId) return
        void this.options.resolveChat(canonicalChatId).then((chat) => {
            if (chat) getAgentControlBroker().materializeUserAuthorizedBrowserGrant(chat.threadId, turnId)
        }).catch(() => undefined)
    }

    cancelFromTui(requestId: string): void {
        if (!requestId) return
        this.cancelledTuiRequests.add(requestId)
        if (this.cancelledTuiRequests.size > 100) this.cancelledTuiRequests.delete(this.cancelledTuiRequests.values().next().value!)
        const created = this.tuiRequestTabs.get(requestId)
        if (!created) return
        this.tuiRequestTabs.delete(requestId)
        getAgentControlBroker().cancelUserAuthorizedBrowserIntent(created.threadId, created.tabId)
        void this.load().then(async () => {
            const windowState = this.state.windows.find((window) => window.id === created.windowId)
            if (!windowState) return
            removeTabFromWindow(windowState, created.tabId)
            await this.commitAndPublish(windowState.id)
            await this.pruneEmptyWindow(windowState)
        }).catch(() => undefined)
    }

    async openFromTui(request: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.load()
        const tuiRequestId = String(request['_requestId'] || '')
        const assertNotCancelled = () => {
            if (tuiRequestId && this.cancelledTuiRequests.has(tuiRequestId)) throw Object.assign(new Error('The requesting TUI disconnected.'), { code: 'DESKTOP_WORKSPACE_UNAVAILABLE' })
        }
        assertNotCancelled()
        const operation = String(request['operation'] || 'open')
        if (operation === 'list') {
            return {
                tabs: this.state.windows.flatMap((windowState) => windowState.tabs
                    .filter((tab) => tab.workspace === 'browser')
                    .map((tab) => ({ id: tab.id, title: tab.title, chatTitle: tab.chatTitle, background: !this.windows.get(windowState.id)?.isVisible() })))
            }
        }
        if (operation === 'show') {
            const candidate = [...this.state.windows].reverse().flatMap((windowState) => [...windowState.tabs].reverse().map((tab) => ({ windowState, tab })))
                .find(({ tab }) => tab.workspace === 'browser' && tab.canonicalChatId === request['canonicalChatId'])
            if (!candidate) throw Object.assign(new Error('No Browser tab is open for this chat.'), { code: 'DESKTOP_WORKSPACE_TAB_NOT_FOUND' })
            candidate.windowState.activeTabId = candidate.tab.id
            const window = this.ensureWindow(candidate.windowState.id)
            this.reveal(window, request['focus'] === true)
            await this.commitAndPublish(candidate.windowState.id)
            return { tabId: candidate.tab.id, chatTitle: candidate.tab.chatTitle, label: candidate.tab.title }
        }

        const workspace = String(request['workspace'] || '') as AssistantUtilityWorkspaceKind
        const chat = await this.options.resolveChat(String(request['canonicalChatId'] || ''))
        assertNotCancelled()
        if (!chat) throw Object.assign(new Error('The requested chat is unavailable in Zyra Desktop.'), { code: 'AGENT_SERVER_SESSION_NOT_FOUND' })
        let windowState = request['newWindow'] === true ? this.createWindowState() : this.defaultWindowState()
        const singleton = workspace !== 'browser' && workspace !== 'turn'
            ? windowState.tabs.find((tab) => tab.canonicalChatId === chat.canonicalChatId && tab.workspace === workspace)
            : null
        if (singleton) {
            windowState.activeTabId = singleton.id
            const existingWindow = this.ensureWindow(windowState.id)
            if (request['background'] !== true) this.reveal(existingWindow, request['focus'] === true)
            await this.commitAndPublish(windowState.id)
            return { tabId: singleton.id, chatTitle: singleton.chatTitle, label: singleton.title }
        }
        if (windowState.tabs.length >= MAX_TABS_PER_WINDOW) {
            windowState = this.createWindowState()
        }
        const tab = this.createTab(chat, workspace, request)
        windowState.tabs.push(tab)
        windowState.tabs = groupTabsByChat(windowState.tabs)
        if (tuiRequestId) this.tuiRequestTabs.set(tuiRequestId, { windowId: windowState.id, tabId: tab.id, threadId: tab.threadId })
        windowState.activeTabId = request['background'] === true && windowState.activeTabId ? windowState.activeTabId : tab.id
        const targetWindow = this.ensureWindow(windowState.id)
        if (request['background'] !== true) this.reveal(targetWindow, request['focus'] === true)
        await this.commitAndPublish(windowState.id)
        try { assertNotCancelled() } catch (error) {
            removeTabFromWindow(windowState, tab.id)
            await this.commitAndPublish(windowState.id)
            throw error
        }
        if (request['background'] === true && workspace === 'browser') {
            try {
                const target = await this.waitForBrowserTarget(tab.threadId, tab.id)
                assertNotCancelled()
                getAgentControlBroker().armUserAuthorizedBrowserGrant({
                    threadId: tab.threadId,
                    tabId: tab.id,
                    turnId: typeof request['activeTurnId'] === 'string' ? request['activeTurnId'] : null
                })
                if (tuiRequestId) this.tuiRequestTabs.delete(tuiRequestId)
                return { tabId: tab.id, targetId: target.targetId, chatTitle: tab.chatTitle, label: tab.title, background: true }
            } catch (error) {
                if (tuiRequestId) this.tuiRequestTabs.delete(tuiRequestId)
                removeTabFromWindow(windowState, tab.id)
                await this.commitAndPublish(windowState.id)
                if (windowState.tabs.length === 0) targetWindow.close()
                throw error
            }
        }
        if (tuiRequestId) this.tuiRequestTabs.delete(tuiRequestId)
        return { tabId: tab.id, chatTitle: tab.chatTitle, label: tab.title, background: false }
    }

    async dispose(): Promise<void> {
        this.shuttingDown = true
        for (const pending of this.pendingReady.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Utility window manager closed.'))
        }
        this.pendingReady.clear()
        for (const pending of this.pendingMainMoves.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Utility window manager closed.'))
        }
        this.pendingMainMoves.clear()
        for (const session of this.tearOffSessions.values()) {
            clearInterval(session.followTimer)
            clearTimeout(session.expiryTimer)
        }
        this.tearOffSessions.clear()
        await this.writeQueue.catch(() => undefined)
    }

    private serializeMove<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.moveQueue.catch(() => undefined).then(operation)
        this.moveQueue = next
        return next
    }

    private async load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise
        this.loadPromise = (async () => {
            try {
                const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
                this.state = normalizeState(parsed)
            } catch {
                this.state = { version: 1, windows: [] }
            }
        })()
        return this.loadPromise
    }

    private async getWindowState(windowId: string): Promise<{ state: AssistantUtilityWindowState }> {
        await this.load()
        const state = this.findWindowState(windowId)
        return { state: cloneWindowState(state) }
    }

    private async selectTab(windowId: string, tabId: string): Promise<{ selected: true }> {
        await this.load()
        const state = this.findWindowState(windowId)
        if (!state.tabs.some((tab) => tab.id === tabId)) throw new Error('Utility tab was not found.')
        state.activeTabId = tabId
        await this.commitAndPublish(windowId)
        return { selected: true }
    }

    private async closeTab(windowId: string, tabId: string): Promise<{ closed: true }> {
        await this.load()
        const state = this.findWindowState(windowId)
        const index = state.tabs.findIndex((tab) => tab.id === tabId)
        if (index < 0) return { closed: true }
        const closingTab = state.tabs[index]
        if (closingTab.workspace === 'browser') this.options.browserViews?.closeIfOwned(closingTab.id, this.windows.get(windowId) || null)
        state.tabs.splice(index, 1)
        if (state.activeTabId === tabId) state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)]?.id || null
        await this.commitAndPublish(windowId)
        if (shouldCaptureUtilityTab(closingTab)) this.options.captureAnalytics?.({ action: 'close', outcome: 'completed', tab_kind: utilityAnalyticsTabKind(closingTab.workspace), tab_count: state.tabs.length })
        if (state.tabs.length === 0) {
            this.windows.get(windowId)?.close()
            if (windowId !== 'default') {
                this.state.windows = this.state.windows.filter((window) => window.id !== windowId)
                this.writeQueue = this.writeQueue.catch(() => undefined).then(() => writeJsonAtomically(this.filePath, persistentAssistantUtilityState(this.state)))
                await this.writeQueue
            }
        }
        return { closed: true }
    }

    private async addTab(input: AssistantUtilityAddTabInput): Promise<{ tabId: string }> {
        await this.load()
        const state = this.findWindowState(input.windowId)
        const sourceTab = input.sourceTabId
            ? state.tabs.find((tab) => tab.id === input.sourceTabId)
            : state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0]
        if (!sourceTab) throw new Error(input.sourceTabId ? 'That tab group is no longer available.' : 'Open a chat tab before adding another tab.')
        const canonicalChatId = sourceTab.canonicalChatId
        const chat = await this.options.resolveChat(canonicalChatId)
        if (!chat) throw new Error('This chat is no longer available.')
        const existing = input.workspace !== 'browser'
            ? state.tabs.find((tab) => tab.canonicalChatId === canonicalChatId && tab.workspace === input.workspace)
            : null
        if (existing) {
            state.activeTabId = existing.id
            await this.commitAndPublish(state.id)
            return { tabId: existing.id }
        }
        if (state.tabs.length >= MAX_TABS_PER_WINDOW) throw new Error('Close a tab before opening another one.')
        const tab = this.createTab(chat, input.workspace, { sessionMode: input.sessionMode })
        state.tabs.push(tab)
        state.tabs = groupTabsByChat(state.tabs)
        state.activeTabId = tab.id
        await this.commitAndPublish(state.id)
        if (shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: 'tab_create', outcome: 'completed', tab_kind: utilityAnalyticsTabKind(tab.workspace), tab_count: state.tabs.length })
        return { tabId: tab.id }
    }

    private async reorderTab(windowId: string, fromTabId: string, toTabId: string): Promise<{ reordered: true }> {
        await this.load()
        const state = this.findWindowState(windowId)
        const from = state.tabs.findIndex((tab) => tab.id === fromTabId)
        const to = state.tabs.findIndex((tab) => tab.id === toTabId)
        if (from < 0 || to < 0 || from === to) return { reordered: true }
        const [tab] = state.tabs.splice(from, 1)
        state.tabs.splice(to, 0, tab)
        state.tabs = groupTabsByChat(state.tabs)
        await this.commitAndPublish(windowId)
        if (shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: 'tab_drag', outcome: 'completed', tab_kind: utilityAnalyticsTabKind(tab.workspace), tab_count: state.tabs.length })
        return { reordered: true }
    }

    private async beginTearOff(event: IpcMainInvokeEvent, input: AssistantUtilityTearOffBeginInput): Promise<{ sessionId: string; targetWindowId: string }> {
        await this.load()
        this.assertTrusted(event)
        if (input.sourceWindowId === 'main') this.assertMainSender(event)
        else this.assertWindowAccess(event, input.sourceWindowId)
        assertFinitePoint(input.screenPoint, 'Tear-off cursor position')
        assertFinitePoint(input.grabOffset, 'Tear-off grab offset')

        for (const existing of [...this.tearOffSessions.values()]) {
            if (existing.ownerWebContentsId === event.sender.id) await this.discardTearOff(existing)
        }

        const tab = input.sourceWindowId === 'main'
            ? {
                ...input.tab,
                stateCapsule: sanitizeAssistantUtilityStateCapsule(input.tab.stateCapsule, input.tab.workspace)
            }
            : (() => {
                const source = this.findWindowState(input.sourceWindowId)
                const sourceTab = source.tabs.find((entry) => entry.id === input.tab.id)
                if (!sourceTab) throw new Error('Utility tab was not found.')
                const capturedCapsule = sanitizeAssistantUtilityStateCapsule(input.tab.stateCapsule, sourceTab.workspace)
                if (capturedCapsule) sourceTab.stateCapsule = capturedCapsule
                return { ...sourceTab, stateCapsule: capturedCapsule || sourceTab.stateCapsule }
            })()
        const target = this.createWindowState()
        target.provisional = true
        target.tabs.push({ ...tab, updatedAt: new Date().toISOString() })
        target.activeTabId = tab.id
        const targetWindow = this.ensureWindow(target.id, {
            provisional: true,
            label: tab.title,
            accentColor: ASSISTANT_UTILITY_GROUP_COLORS[tab.colorIndex % ASSISTANT_UTILITY_GROUP_COLORS.length]
        })
        const sourceWindow = BrowserWindow.fromWebContents(event.sender)
        if (sourceWindow && !sourceWindow.isDestroyed()) {
            const bounds = sourceWindow.getBounds()
            targetWindow.setBounds({ width: bounds.width, height: bounds.height })
        }
        this.positionTearOffWindow(targetWindow, input.screenPoint, input.grabOffset)
        targetWindow.setIgnoreMouseEvents(true, { forward: true })
        await this.waitForProvisionalSurface(targetWindow)
        this.reveal(targetWindow, false)
        targetWindow.moveTop()
        await this.commitAndPublish(target.id)

        const sessionId = `tear-off:${randomUUID()}`
        let session: TearOffSession
        const followTimer = setInterval(() => {
            const window = this.windows.get(target.id)
            if (!window || window.isDestroyed()) return
            this.positionTearOffWindow(window, screen.getCursorScreenPoint(), input.grabOffset)
        }, 16)
        const expiryTimer = setTimeout(() => {
            void this.serializeMove(() => this.discardTearOff(session))
        }, 30_000)
        session = {
            id: sessionId,
            ownerWebContentsId: event.sender.id,
            sourceWindowId: input.sourceWindowId,
            sourceTabId: tab.id,
            targetWindowId: target.id,
            grabOffset: { ...input.grabOffset },
            followTimer,
            expiryTimer
        }
        this.tearOffSessions.set(sessionId, session)
        if (shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: 'tear_off', outcome: 'started', tab_kind: utilityAnalyticsTabKind(tab.workspace) })
        return { sessionId, targetWindowId: target.id }
    }

    private async finishTearOff(event: IpcMainInvokeEvent, input: AssistantUtilityTearOffFinishInput): Promise<{ committed: boolean; targetWindowId: string }> {
        await this.load()
        assertFinitePoint(input.screenPoint, 'Tear-off drop position')
        const session = this.requireOwnedTearOff(event, input.sessionId)
        this.stopTearOffFollow(session)
        const provisionalWindow = this.windows.get(session.targetWindowId)
        if (provisionalWindow && !provisionalWindow.isDestroyed()) {
            this.positionTearOffWindow(provisionalWindow, input.screenPoint, session.grabOffset)
            provisionalWindow.setIgnoreMouseEvents(false)
        }
        const provisional = this.findWindowState(session.targetWindowId)
        const tab = provisional.tabs.find((entry) => entry.id === session.sourceTabId)
        if (!tab) {
            this.tearOffSessions.delete(session.id)
            throw new Error('Detached tab was not found in its provisional window.')
        }

        let dropTarget = this.targetAt(input.screenPoint, session.targetWindowId)
        if (dropTarget === 'main' && this.dropZones.get('main')?.canonicalChatId !== tab.canonicalChatId) dropTarget = null
        if (dropTarget === session.sourceWindowId) {
            await this.discardTearOff(session)
            return { committed: false, targetWindowId: String(session.sourceWindowId) }
        }

        try {
            let targetWindowId = session.targetWindowId
            if (dropTarget && dropTarget !== session.targetWindowId) {
                targetWindowId = (await this.moveTab({
                    tabId: tab.id,
                    sourceWindowId: session.targetWindowId,
                    targetWindowId: dropTarget,
                    targetIndex: this.targetIndexAt(dropTarget, input.screenPoint.x),
                    screenPoint: input.screenPoint
                })).targetWindowId
            }

            if (targetWindowId === session.targetWindowId) {
                provisional.provisional = false
                if (!provisionalWindow || provisionalWindow.isDestroyed()) throw new Error('The Browser transfer destination closed.')
                const ready = this.waitForDestination(tab, provisional.id, provisionalWindow)
                this.options.activateWindow(provisionalWindow, provisional.id)
                await this.commitAndPublish(provisional.id)
                await ready
            }

            if (session.sourceWindowId !== 'main') {
                const source = this.state.windows.find((candidate) => candidate.id === session.sourceWindowId)
                if (source) {
                    removeTabFromWindow(source, session.sourceTabId)
                    await this.commitAndPublish(source.id)
                    await this.pruneEmptyWindow(source)
                }
            }
            this.tearOffSessions.delete(session.id)
            if (targetWindowId === 'main') {
                const main = this.options.getMainWindow()
                if (main && !main.isDestroyed()) this.reveal(main, true)
            } else {
                const targetWindow = this.windows.get(targetWindowId)
                if (targetWindow && !targetWindow.isDestroyed()) this.reveal(targetWindow, true)
            }
            if (shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: dropTarget ? 'merge' : 'tear_off', outcome: 'completed', tab_kind: utilityAnalyticsTabKind(tab.workspace) })
            return { committed: true, targetWindowId }
        } catch (error) {
            if (shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: 'tear_off', outcome: 'failed', tab_kind: utilityAnalyticsTabKind(tab.workspace), error_code: utilityAnalyticsErrorCode(error) })
            await this.discardTearOff(session).catch(() => undefined)
            throw error
        }
    }

    private async cancelTearOff(event: IpcMainInvokeEvent, sessionId: string): Promise<{ cancelled: true }> {
        const session = this.requireOwnedTearOff(event, sessionId)
        const tab = this.state.windows.find((window) => window.id === session.targetWindowId)?.tabs.find((entry) => entry.id === session.sourceTabId)
        await this.discardTearOff(session)
        if (tab && shouldCaptureUtilityTab(tab)) this.options.captureAnalytics?.({ action: 'tear_off', outcome: 'cancelled' })
        return { cancelled: true }
    }

    private requireOwnedTearOff(event: IpcMainInvokeEvent, sessionId: string): TearOffSession {
        this.assertTrusted(event)
        const session = this.tearOffSessions.get(sessionId)
        if (!session || session.ownerWebContentsId !== event.sender.id) throw new Error('Tab tear-off session is unavailable.')
        return session
    }

    private stopTearOffFollow(session: TearOffSession): void {
        clearInterval(session.followTimer)
        clearTimeout(session.expiryTimer)
    }

    private async discardTearOff(session: TearOffSession): Promise<void> {
        if (!this.tearOffSessions.has(session.id) && !this.state.windows.some((window) => window.id === session.targetWindowId)) return
        this.stopTearOffFollow(session)
        this.tearOffSessions.delete(session.id)
        const target = this.state.windows.find((window) => window.id === session.targetWindowId)
        if (!target) return
        removeTabFromWindow(target, session.sourceTabId)
        await this.commitAndPublish(target.id)
        await this.pruneEmptyWindow(target)
    }

    private async waitForProvisionalSurface(window: BrowserWindow): Promise<void> {
        if (window.isDestroyed() || (!window.webContents.isLoadingMainFrame() && window.webContents.getURL() !== 'about:blank')) return
        await new Promise<void>((resolve) => {
            let settled = false
            const finish = () => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                window.webContents.removeListener('did-finish-load', finish)
                window.webContents.removeListener('did-fail-load', finish)
                resolve()
            }
            const timer = setTimeout(finish, 750)
            window.webContents.once('did-finish-load', finish)
            window.webContents.once('did-fail-load', finish)
            if (!window.webContents.isLoadingMainFrame() && window.webContents.getURL() !== 'about:blank') finish()
        })
    }

    private positionTearOffWindow(window: BrowserWindow, point: { x: number; y: number }, grabOffset: { x: number; y: number }): void {
        if (window.isDestroyed()) return
        window.setPosition(
            Math.round(point.x - grabOffset.x),
            Math.round(point.y - grabOffset.y),
            false
        )
    }

    private async moveTab(input: AssistantUtilityMoveInput): Promise<{ targetWindowId: string }> {
        await this.load()
        if (input.sourceWindowId === 'main') throw new Error('Use detachMainTab for main-window tabs.')
        const source = this.findWindowState(input.sourceWindowId)
        const sourceIndex = source.tabs.findIndex((tab) => tab.id === input.tabId)
        if (sourceIndex < 0) throw new Error('Utility tab was not found.')
        const tab = source.tabs[sourceIndex]
        const targetId = input.targetWindowId || this.targetAt(input.screenPoint, source.id) || (input.newWindow ? null : null)
        if (targetId === 'main' && this.dropZones.get('main')?.canonicalChatId !== tab.canonicalChatId) {
            const target = this.createWindowState()
            target.tabs.push(tab)
            target.tabs = groupTabsByChat(target.tabs)
            target.activeTabId = tab.id
            const targetWindow = this.ensureWindow(target.id)
            const ready = this.waitForDestination(tab, target.id, targetWindow)
            await this.commitAndPublish(target.id)
            await ready.catch(async (error) => {
                removeExactTabFromWindow(target, tab)
                await this.commitAndPublish(target.id)
                await this.pruneEmptyWindow(target)
                throw error
            })
            removeTabFromWindow(source, tab.id)
            await this.commitAndPublish(source.id)
            await this.pruneEmptyWindow(source)
            this.reveal(this.ensureWindow(target.id), false)
            this.captureUtilityMove(tab, target.tabs.length)
            return { targetWindowId: target.id }
        }
        if (targetId === 'main') {
            const main = this.options.getMainWindow()
            if (!main || main.isDestroyed()) throw new Error('The main Zyra window is unavailable.')
            const requestId = `main-move:${randomUUID()}`
            const accepted = this.waitForMainMove(requestId)
            const transferred = tab.workspace === 'browser' && this.options.browserViews
                ? this.options.browserViews.transferTo(tab.id, main).then(() => undefined)
                : Promise.resolve()
            main.webContents.send(ASSISTANT_UTILITY_IPC.incomingMainTab, { requestId, tab })
            try {
                await Promise.all([accepted, transferred])
            } catch (error) {
                if (!main.isDestroyed() && !main.webContents.isDestroyed()) {
                    main.webContents.send(ASSISTANT_UTILITY_IPC.cancelIncomingMainTab, { requestId, tabId: tab.id })
                }
                throw error
            }
            removeTabFromWindow(source, tab.id)
            await this.commitAndPublish(source.id)
            await this.pruneEmptyWindow(source)
            this.captureUtilityMove(tab, 0)
            return { targetWindowId: 'main' }
        }
        const target = targetId ? this.findWindowState(targetId) : this.createWindowState()
        if (target.id === source.id) return { targetWindowId: source.id }
        if (target.tabs.some((entry) => entry.id === tab.id)) throw new Error('That window already contains this tab.')
        if (target.tabs.length >= MAX_TABS_PER_WINDOW) throw new Error('That window already has the maximum number of tabs.')
        target.tabs.splice(Math.max(0, Math.min(target.tabs.length, input.targetIndex ?? target.tabs.length)), 0, tab)
        target.tabs = groupTabsByChat(target.tabs)
        target.activeTabId = tab.id
        const targetWindow = this.ensureWindow(target.id)
        const ready = this.waitForDestination(tab, target.id, targetWindow)
        await this.commitAndPublish(target.id)
        await ready.catch(async (error) => {
            removeExactTabFromWindow(target, tab)
            await this.commitAndPublish(target.id)
            await this.pruneEmptyWindow(target)
            throw error
        })
        removeTabFromWindow(source, tab.id)
        await this.commitAndPublish(source.id)
        await this.pruneEmptyWindow(source)
        this.reveal(this.ensureWindow(target.id), false)
        this.captureUtilityMove(tab, target.tabs.length)
        return { targetWindowId: target.id }
    }

    private captureUtilityMove(tab: AssistantUtilityTab, tabCount: number): void {
        if (!shouldCaptureUtilityTab(tab)) return
        this.options.captureAnalytics?.({
            action: tab.workspace === 'terminal' ? 'terminal_transfer' : 'merge',
            outcome: 'completed',
            tab_kind: utilityAnalyticsTabKind(tab.workspace),
            tab_count: tabCount
        })
    }

    private async detachMainTab(input: AssistantUtilityMainTabInput): Promise<{ targetWindowId: string }> {
        await this.load()
        const targetId = this.targetAt(input.screenPoint, 'main')
        const target = targetId && targetId !== 'main' ? this.findWindowState(targetId) : this.createWindowState()
        if (target.tabs.some((tab) => tab.id === input.tab.id)) throw new Error('That window already contains this tab.')
        if (target.tabs.length >= MAX_TABS_PER_WINDOW) throw new Error('That window already has the maximum number of tabs.')
        target.tabs.push({
            ...input.tab,
            stateCapsule: sanitizeAssistantUtilityStateCapsule(input.tab.stateCapsule, input.tab.workspace),
            updatedAt: new Date().toISOString()
        })
        target.tabs = groupTabsByChat(target.tabs)
        target.activeTabId = input.tab.id
        const targetWindow = this.ensureWindow(target.id)
        const ready = this.waitForDestination(input.tab, target.id, targetWindow)
        await this.commitAndPublish(target.id)
        const insertedTab = target.tabs.find((tab) => tab.id === input.tab.id)!
        await ready.catch(async (error) => {
            removeExactTabFromWindow(target, insertedTab)
            await this.commitAndPublish(target.id)
            await this.pruneEmptyWindow(target)
            throw error
        })
        this.reveal(this.ensureWindow(target.id), false)
        return { targetWindowId: target.id }
    }

    private async waitForBrowserTarget(threadId: string, tabId: string): Promise<Extract<ReturnType<ReturnType<typeof getAgentControlBroker>['state']>['targets'][number], { kind: 'zyra-browser' }>> {
        const deadline = Date.now() + READY_TIMEOUT_MS
        while (Date.now() < deadline) {
            const target = getAgentControlBroker().state().targets.find((candidate) => candidate.kind === 'zyra-browser' && candidate.ownerThreadId === threadId && candidate.tabId === tabId)
            if (target?.kind === 'zyra-browser') return target
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw Object.assign(new Error('The background Browser tab did not become ready.'), { code: 'CONTROL_TARGET_NOT_FOUND' })
    }

    private async registerDropZone(event: IpcMainInvokeEvent, input: AssistantUtilityDropZoneInput | null): Promise<{ registered: true }> {
        this.assertTrusted(event)
        const ownedWindowId = this.windowIdForSender(event.sender.id)
        if (!input) {
            if (ownedWindowId) this.dropZones.delete(ownedWindowId)
            else this.dropZones.delete('main')
            return { registered: true }
        }
        const expectedId = ownedWindowId || 'main'
        if (input.windowId !== expectedId) throw new Error('Drop zone window identity does not match its sender.')
        const rect = input.rect
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1) throw new Error('Drop zone bounds are invalid.')
        const tabSlots = (input.tabSlots || []).filter((slot) => (
            typeof slot.tabId === 'string'
            && Number.isInteger(slot.index)
            && slot.index >= 0
            && Number.isFinite(slot.left)
            && Number.isFinite(slot.right)
            && slot.right >= slot.left
        )).map((slot) => ({ ...slot }))
        this.dropZones.set(expectedId, { ...input, rect: { ...rect }, tabSlots })
        const dropWindow = expectedId === 'main' ? this.options.getMainWindow() : this.windows.get(expectedId)
        if (dropWindow?.isFocused()) this.touchWindowStack(expectedId)
        return { registered: true }
    }

    private async updateTab(windowId: string, tabId: string, patch: { title?: string; url?: string; hasLivePage?: boolean; faviconUrl?: string | null }): Promise<{ updated: true }> {
        const state = this.findWindowState(windowId)
        const tab = state.tabs.find((entry) => entry.id === tabId)
        if (!tab) throw new Error('Utility tab was not found.')
        if (typeof patch.title === 'string') tab.title = patch.title.trim().slice(0, 512) || tab.title
        if (tab.workspace === 'browser' && typeof patch.url === 'string') tab.url = sanitizeBrowserPersistentUrl(patch.url) || ''
        if (tab.workspace === 'browser' && typeof patch.hasLivePage === 'boolean') tab.hasLivePage = patch.hasLivePage
        if (tab.workspace === 'browser' && patch.faviconUrl !== undefined) tab.faviconUrl = sanitizeBrowserPersistentUrl(patch.faviconUrl, 4_096) || undefined
        tab.updatedAt = new Date().toISOString()
        await this.commitAndPublish(windowId)
        return { updated: true }
    }

    private async updateStateCapsule(windowId: string, tabId: string, capsule: unknown): Promise<{ updated: true }> {
        const state = this.findWindowState(windowId)
        const tab = state.tabs.find((entry) => entry.id === tabId)
        if (!tab) throw new Error('Utility tab was not found.')
        tab.stateCapsule = sanitizeAssistantUtilityStateCapsule(capsule, tab.workspace)
        tab.updatedAt = new Date().toISOString()
        state.revision += 1
        this.writeQueue = this.writeQueue.catch(() => undefined).then(() => writeJsonAtomically(this.filePath, persistentAssistantUtilityState(this.state)))
        await this.writeQueue
        return { updated: true }
    }

    private completeIncomingMainTab(requestId: string, accepted: boolean, error?: string): { completed: true } {
        const pending = this.pendingMainMoves.get(requestId)
        if (!pending) return { completed: true }
        this.pendingMainMoves.delete(requestId)
        clearTimeout(pending.timer)
        if (accepted) pending.resolve()
        else pending.reject(new Error(error || 'The main Zyra window did not accept the tab.'))
        return { completed: true }
    }

    private waitForMainMove(requestId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingMainMoves.delete(requestId)
                reject(new Error('The main Zyra window did not acknowledge the moved tab.'))
            }, READY_TIMEOUT_MS)
            this.pendingMainMoves.set(requestId, { resolve, reject, timer })
        })
    }

    private markTabReady(windowId: string, tabId: string): { ready: true } {
        const pending = this.pendingReady.get(`${windowId}:${tabId}`)
        if (pending) {
            this.pendingReady.delete(`${windowId}:${tabId}`)
            clearTimeout(pending.timer)
            pending.resolve()
        }
        return { ready: true }
    }

    private waitForReady(windowId: string, tabId: string): Promise<void> {
        const key = `${windowId}:${tabId}`
        this.pendingReady.get(key)?.reject(new Error('A newer tab transfer replaced this request.'))
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingReady.delete(key)
                reject(new Error('The destination window did not prepare the tab.'))
            }, READY_TIMEOUT_MS)
            this.pendingReady.set(key, { resolve, reject, timer })
        })
    }

    private waitForDestination(tab: AssistantUtilityTab, windowId: string, window: BrowserWindow): Promise<void> {
        if (tab.workspace === 'browser' && this.options.browserViews) {
            return this.options.browserViews.transferTo(tab.id, window).then(() => undefined)
        }
        return this.waitForReady(windowId, tab.id)
    }

    private targetAt(point: { x: number; y: number } | undefined, sourceId: string): string | 'main' | null {
        if (!point) return null
        const entries = [...this.dropZones.entries()].sort(([leftId], [rightId]) => (
            (this.windowStackOrder.get(rightId) || 0) - (this.windowStackOrder.get(leftId) || 0)
        ))
        for (const [id, zone] of entries) {
            if (id === sourceId) continue
            const targetWindow = id === 'main' ? this.options.getMainWindow() : this.windows.get(id)
            if (!targetWindow || targetWindow.isDestroyed() || !targetWindow.isVisible() || targetWindow.isMinimized()) continue
            const { rect } = zone
            if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return id
        }
        return null
    }

    private targetIndexAt(windowId: string | 'main', screenX: number): number | undefined {
        if (windowId === 'main') return undefined
        const slots = this.dropZones.get(windowId)?.tabSlots || []
        if (slots.length === 0) return undefined
        for (const slot of slots) {
            if (screenX < slot.left + (slot.right - slot.left) / 2) return slot.index
        }
        return Math.max(...slots.map((slot) => slot.index)) + 1
    }

    private touchWindowStack(windowId: string | 'main'): void {
        this.windowStackSequence += 1
        this.windowStackOrder.set(windowId, this.windowStackSequence)
    }

    private defaultWindowState(): AssistantUtilityWindowState {
        const existing = this.state.windows.find((window) => window.id === 'default')
        return existing || this.createWindowState('default')
    }

    private createWindowState(id = `window:${randomUUID()}`): AssistantUtilityWindowState {
        if (this.state.windows.length >= MAX_WINDOWS) throw new Error('Close an independent Zyra window before opening another one.')
        const state: AssistantUtilityWindowState = { id, revision: 0, activeTabId: null, tabs: [] }
        this.state.windows.push(state)
        return state
    }

    private ensureWindow(windowId: string, creationOptions?: UtilityWindowCreationOptions): BrowserWindow {
        const current = this.windows.get(windowId)
        if (current && !current.isDestroyed()) return current
        const window = this.options.createWindow(windowId, creationOptions)
        const ownerWebContentsId = window.webContents.id
        this.windows.set(windowId, window)
        this.touchWindowStack(windowId)
        window.on('focus', () => this.touchWindowStack(windowId))
        window.on('show', () => this.touchWindowStack(windowId))
        window.once('closed', () => {
            try { getAgentControlBroker().updateWorkspaceState(null, ownerWebContentsId) } catch {}
            if (this.windows.get(windowId) === window) this.windows.delete(windowId)
            this.dropZones.delete(windowId)
            this.windowStackOrder.delete(windowId)
            if (!this.shuttingDown) {
                this.state.windows = this.state.windows.filter((state) => state.id !== windowId)
                this.writeQueue = this.writeQueue.catch(() => undefined).then(() => writeJsonAtomically(this.filePath, persistentAssistantUtilityState(this.state)))
            }
        })
        return window
    }

    private reveal(window: BrowserWindow, focus: boolean): void {
        const show = () => {
            if (window.isDestroyed()) return
            if (focus) {
                if (window.isMinimized()) window.restore()
                window.show()
                window.focus()
            } else if (!window.isVisible()) {
                window.showInactive()
            }
        }
        show()
    }

    private createTab(chat: ResolvedUtilityChat, workspace: AssistantUtilityWorkspaceKind, request: Record<string, unknown>): AssistantUtilityTab {
        const now = new Date().toISOString()
        const safeBrowserUrl = workspace === 'browser' ? sanitizeBrowserPersistentUrl(request['url']) || '' : ''
        const requestedPath = String(request['path'] || '').trim()
        const projectRoot = realpathSync(resolve(chat.projectPath))
        const availableRoots = chat.projectRoots.flatMap((root) => {
            try {
                return [{ ...root, path: realpathSync(resolve(root.path)) }]
            } catch {
                return []
            }
        }).sort((left, right) => right.path.length - left.path.length)
        const resolvedPath = requestedPath ? realpathSync(resolve(projectRoot, requestedPath)) : ''
        const targetPath = resolvedPath || projectRoot
        const matchedRoot = availableRoots.find((root) => {
            const rootRelative = relative(root.path, targetPath)
            return rootRelative !== '..'
                && !rootRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
                && !isAbsolute(rootRelative)
        }) || null
        if (!matchedRoot) throw new Error('Files and Terminal paths must stay inside the selected Chat scope.')
        if (workspace === 'terminal' && matchedRoot.access === 'read-only') {
            throw new Error('Terminal cannot start inside a read-only Project folder.')
        }
        return {
            id: workspace === 'browser'
                ? `browser:utility:${randomUUID()}`
                : `utility:${chat.canonicalChatId}:${workspace}:${randomUUID()}`,
            canonicalChatId: chat.canonicalChatId,
            sessionId: chat.sessionId,
            threadId: chat.threadId,
            chatTitle: chat.chatTitle,
            projectPath: chat.projectPath,
            projectRoots: chat.projectRoots,
            workspace,
            title: workspaceTitle(workspace, safeBrowserUrl),
            colorIndex: colorIndex(chat.canonicalChatId),
            sessionMode: workspace === 'browser' && request['sessionMode'] === 'incognito' ? 'incognito' : workspace === 'browser' ? 'normal' : undefined,
            url: workspace === 'browser' ? safeBrowserUrl : undefined,
            path: workspace === 'explorer' || workspace === 'terminal' ? resolvedPath || undefined : undefined,
            turnId: workspace === 'turn' ? String(request['turnId'] || '') : undefined,
            createdAt: now,
            updatedAt: now
        }
    }

    private async pruneEmptyWindow(windowState: AssistantUtilityWindowState): Promise<void> {
        if (windowState.tabs.length > 0) return
        this.state.windows = this.state.windows.filter((entry) => entry.id !== windowState.id)
        const window = this.windows.get(windowState.id)
        if (window && !window.isDestroyed()) window.close()
        this.writeQueue = this.writeQueue.catch(() => undefined).then(() => writeJsonAtomically(this.filePath, persistentAssistantUtilityState(this.state)))
        await this.writeQueue
    }

    private async commitAndPublish(windowId: string): Promise<void> {
        const state = this.findWindowState(windowId)
        state.revision += 1
        this.writeQueue = this.writeQueue.catch(() => undefined).then(() => writeJsonAtomically(this.filePath, persistentAssistantUtilityState(this.state)))
        await this.writeQueue
        const window = this.windows.get(windowId)
        if (window && !window.isDestroyed()) window.webContents.send(ASSISTANT_UTILITY_IPC.changed, cloneWindowState(state))
    }

    private findWindowState(windowId: string): AssistantUtilityWindowState {
        const state = this.state.windows.find((window) => window.id === windowId)
        if (!state) throw new Error('Independent Zyra window was not found.')
        return state
    }

    private windowIdForSender(webContentsId: number): string | null {
        for (const [id, window] of this.windows) if (!window.isDestroyed() && window.webContents.id === webContentsId) return id
        return null
    }

    private assertMainSender(event: IpcMainInvokeEvent): void {
        const main = this.options.getMainWindow()
        if (!main || main.isDestroyed() || main.webContents.id !== event.sender.id) throw new Error('This action requires the main Zyra window.')
    }

    private assertWindowAccess(event: IpcMainInvokeEvent, windowId: string): void {
        const ownedWindowId = this.windowIdForSender(event.sender.id)
        if (ownedWindowId === windowId) return
        const main = this.options.getMainWindow()
        if (main && !main.isDestroyed() && main.webContents.id === event.sender.id) return
        throw new Error('A Zyra window cannot mutate another window directly.')
    }

    private assertTrusted(event: IpcMainInvokeEvent): void {
        const windowId = this.windowIdForSender(event.sender.id)
        if (windowId) return
        const main = this.options.getMainWindow()
        if (main && !main.isDestroyed() && main.webContents.id === event.sender.id) return
        if (this.options.isTrustedRenderer?.(event.sender.id)) return
        throw new Error('Independent-window requests require a trusted Zyra renderer.')
    }

    private async result<T>(event: IpcMainInvokeEvent, operation: () => T | Promise<T>): Promise<{ success: true } & T | { success: false; error: string }> {
        try {
            this.assertTrusted(event)
            return { success: true, ...(await operation() as object) } as { success: true } & T
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Independent-window request failed.' }
        }
    }
}

function assertFinitePoint(point: { x: number; y: number }, label: string): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${label} is invalid.`)
}

function workspaceTitle(workspace: AssistantUtilityWorkspaceKind, url: string): string {
    if (workspace === 'browser') {
        try { return new URL(url).hostname || 'New tab' } catch { return 'New tab' }
    }
    return ({ details: 'Thread Details', explorer: 'Files', resources: 'Resources', agents: 'Agents', diff: 'Diff', terminal: 'Terminal', turn: 'Turn' })[workspace]
}

function colorIndex(value: string): number {
    let hash = 0
    for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
    return Math.abs(hash) % 8
}

function removeExactTabFromWindow(windowState: AssistantUtilityWindowState, tab: AssistantUtilityTab): void {
    const index = windowState.tabs.indexOf(tab)
    if (index < 0) return
    windowState.tabs.splice(index, 1)
    if (windowState.activeTabId === tab.id) windowState.activeTabId = windowState.tabs[Math.min(index, windowState.tabs.length - 1)]?.id || null
}

function removeTabFromWindow(windowState: AssistantUtilityWindowState, tabId: string): void {
    const index = windowState.tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    windowState.tabs.splice(index, 1)
    if (windowState.activeTabId === tabId) windowState.activeTabId = windowState.tabs[Math.min(index, windowState.tabs.length - 1)]?.id || null
}

function groupTabsByChat(tabs: AssistantUtilityTab[]): AssistantUtilityTab[] {
    const order: string[] = []
    const groups = new Map<string, AssistantUtilityTab[]>()
    for (const tab of tabs) {
        if (!groups.has(tab.canonicalChatId)) {
            groups.set(tab.canonicalChatId, [])
            order.push(tab.canonicalChatId)
        }
        groups.get(tab.canonicalChatId)!.push(tab)
    }
    return order.flatMap((chatId) => groups.get(chatId) || [])
}

function cloneWindowState(state: AssistantUtilityWindowState): AssistantUtilityWindowState {
    return {
        ...state,
        tabs: state.tabs.map((tab) => ({
            ...tab,
            stateCapsule: tab.stateCapsule ? structuredClone(tab.stateCapsule) : undefined
        }))
    }
}

function normalizeState(value: unknown): AssistantUtilityState {
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return { version: 1, windows: [] }
    const windows = Array.isArray((value as { windows?: unknown }).windows) ? (value as { windows: unknown[] }).windows : []
    const normalized: AssistantUtilityWindowState[] = []
    const seenTabIds = new Set<string>()
    for (const raw of windows.slice(0, MAX_WINDOWS)) {
        if (!raw || typeof raw !== 'object') continue
        const candidate = raw as Partial<AssistantUtilityWindowState>
        const id = String(candidate.id || '')
        if (!id) continue
        const requestedActiveTabId = String(candidate.activeTabId || '')
        let resolvedActiveTabId: string | null = null
        const tabs = (Array.isArray(candidate.tabs) ? candidate.tabs : []).filter((tab): tab is AssistantUtilityTab => Boolean(
            tab
            && typeof tab === 'object'
            && String((tab as AssistantUtilityTab).id || '')
            && String((tab as AssistantUtilityTab).threadId || '')
            && !((tab as AssistantUtilityTab).workspace === 'browser' && (tab as AssistantUtilityTab).sessionMode === 'incognito')
        )).slice(0, MAX_TABS_PER_WINDOW).map((tab) => {
            const originalId = String(tab.id)
            const nextId = seenTabIds.has(originalId)
                ? `${tab.workspace === 'browser' ? 'browser:utility' : `utility:${tab.canonicalChatId}:${tab.workspace}`}:${randomUUID()}`
                : originalId
            seenTabIds.add(nextId)
            if (!resolvedActiveTabId && originalId === requestedActiveTabId) resolvedActiveTabId = nextId
            return {
                ...tab,
                id: nextId,
                sessionMode: tab.workspace === 'browser' ? 'normal' as const : undefined,
                url: tab.workspace === 'browser' ? sanitizeBrowserPersistentUrl(tab.url) || '' : undefined,
                hasLivePage: undefined,
                faviconUrl: tab.workspace === 'browser' ? sanitizeBrowserPersistentUrl(tab.faviconUrl, 4_096) || undefined : undefined,
                stateCapsule: sanitizeAssistantUtilityStateCapsule(tab.stateCapsule, tab.workspace)
            }
        })
        normalized.push({ id, revision: Math.max(0, Number(candidate.revision) || 0), provisional: undefined, activeTabId: resolvedActiveTabId || tabs[0]?.id || null, tabs })
    }
    return { version: 1, windows: normalized }
}

function persistentAssistantUtilityState(state: AssistantUtilityState): AssistantUtilityState {
    const windows = state.windows.map((windowState) => {
        const tabs = windowState.tabs
            .filter((tab) => !(tab.workspace === 'browser' && tab.sessionMode === 'incognito'))
            .map(sanitizeAssistantUtilityTabForPersistence)
        const activeTabId = tabs.some((tab) => tab.id === windowState.activeTabId)
            ? windowState.activeTabId
            : tabs[0]?.id || null
        return { ...windowState, activeTabId, tabs }
    }).filter((windowState) => windowState.id === 'default' || windowState.tabs.length > 0)
    return { version: 1, windows }
}

function shouldCaptureUtilityTab(tab: AssistantUtilityTab): boolean {
    return tab.workspace !== 'browser' || tab.sessionMode !== 'incognito'
}
