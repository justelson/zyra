import { randomUUID } from 'node:crypto'
import { BrowserWindow, Menu, screen, type IpcMainInvokeEvent } from 'electron'
import {
    ACCESSORIES_IPC,
    type AccessoryBrowserDropZoneInput,
    type AccessoryBrowserTab,
    type AccessoryBrowserTabsInput,
    type AccessoryBrowserTearOffBeginInput,
    type AccessoryBrowserTearOffFinishInput,
    type AccessoryKind,
    type AccessoryNavigationRequest,
    type AccessoryOpenInput,
    type AccessoryResult,
    type AccessoryWindowState
} from '../shared/accessories'
import { isTrustedBrowserTabId } from './agent-control/trusted-guest-registry'
import type { BrowserViewTransferHost } from './browser-view-manager'
import type { BrowserSessionMode } from '../shared/browser-view'
import { desktopWebLink } from '../shared/desktop-link-policy'
import { ipcMain } from './ipc/trusted-ipc'

const MAX_POINT = 100_000

type AccessoryWindowRecord = {
    state: AccessoryWindowState
    window: BrowserWindow
    key: string
    departedBrowserTabIds: Set<string>
    arrivingBrowserTabIds: Set<string>
}

type AccessoryBrowserTearOffSession = {
    id: string
    ownerWebContentsId: number
    sourceWorkspaceId: string
    targetWorkspaceId: string
    tab: AccessoryBrowserTab
    grabOffset: { x: number; y: number }
    followTimer: NodeJS.Timeout
}

type AccessoryWindowManagerOptions = {
    rootPath: string
    openBrowserSettings?: () => void
    createWindow: (state: AccessoryWindowState) => BrowserWindow
    canOpen?: () => boolean
    onTerminalWindowClosed?: (runtimeId: string) => void
}

function stateCopy(state: AccessoryWindowState): AccessoryWindowState {
    return {
        ...state,
        requests: state.requests.map((request) => ({ ...request })),
        browserTabs: state.browserTabs.map((tab) => ({ ...tab }))
    }
}

function normalizeKind(value: unknown): AccessoryKind {
    if (value === 'browser' || value === 'terminal' || value === 'files' || value === 'devscope') return value
    throw new Error('Accessory kind is invalid.')
}

function normalizeSessionMode(kind: AccessoryKind, value: unknown): BrowserSessionMode {
    if (kind !== 'browser') {
        if (value != null && value !== '' && value !== 'normal') throw new Error('Only Browser accessories support incognito mode.')
        return 'normal'
    }
    if (value == null || value === '') return 'normal'
    if (value === 'normal' || value === 'incognito') return value
    throw new Error('Browser session mode is invalid.')
}

function normalizeBrowserTab(value: AccessoryBrowserTab, sessionMode: BrowserSessionMode): AccessoryBrowserTab {
    const id = String(value?.id || '')
    if (!isTrustedBrowserTabId(id)) throw new Error('Browser tab identity is invalid.')
    if (value?.sessionMode !== sessionMode) throw new Error('Browser tabs from different session modes cannot share a window.')
    const rawUrl = String(value?.url || '').trim().slice(0, 2_048)
    const url = rawUrl ? desktopWebLink(rawUrl) : null
    if (rawUrl && !url && !rawUrl.startsWith('zyra-local://')) throw new Error('Browser tab URL is invalid.')
    const favicon = String(value?.faviconUrl || '').trim().slice(0, 8_192)
    return {
        id,
        sessionMode,
        url: url || (rawUrl.startsWith('zyra-local://') ? rawUrl : ''),
        title: String(value?.title || '').trim().slice(0, 512) || (rawUrl ? 'Browser' : 'New tab'),
        faviconUrl: favicon || null
    }
}

function sameBrowserTabs(left: AccessoryBrowserTab[], right: AccessoryBrowserTab[]): boolean {
    return left.length === right.length && left.every((tab, index) => {
        const other = right[index]
        return Boolean(other
            && tab.id === other.id
            && tab.sessionMode === other.sessionMode
            && tab.url === other.url
            && tab.title === other.title
            && tab.faviconUrl === other.faviconUrl)
    })
}

function assertPoint(point: { x: number; y: number } | null | undefined, label: string): void {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_POINT || Math.abs(point.y) > MAX_POINT) {
        throw new Error(`${label} is invalid.`)
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The accessory window request failed.'
}

export class AccessoryWindowManager {
    private readonly primaryByKey = new Map<string, AccessoryWindowRecord>()
    private readonly recordsById = new Map<string, AccessoryWindowRecord>()
    private readonly recordsByWebContentsId = new Map<number, AccessoryWindowRecord>()
    private readonly browserDropZones = new Map<string, AccessoryBrowserDropZoneInput>()
    private readonly tearOffSessions = new Map<string, AccessoryBrowserTearOffSession>()
    private browserViews: BrowserViewTransferHost | null = null
    private moveQueue: Promise<unknown> = Promise.resolve()
    private registered = false

    constructor(private readonly options: AccessoryWindowManagerOptions) {}

    setBrowserViews(browserViews: BrowserViewTransferHost): void {
        if (this.browserViews && this.browserViews !== browserViews) throw new Error('Accessory Browser transfer host is already configured.')
        this.browserViews = browserViews
    }

    registerIpc(): void {
        if (this.registered) return
        this.registered = true
        ipcMain.handle(ACCESSORIES_IPC.open, (_event, input: AccessoryOpenInput) => this.open(input))
        ipcMain.handle(ACCESSORIES_IPC.getState, (event) => this.getState(event))
        ipcMain.handle(ACCESSORIES_IPC.acknowledge, (event, requestId: string) => this.acknowledge(event, requestId))
        ipcMain.handle(ACCESSORIES_IPC.syncBrowserTabs, (event, input: AccessoryBrowserTabsInput) => this.result(() => this.syncBrowserTabs(event, input)))
        ipcMain.handle(ACCESSORIES_IPC.registerBrowserDropZone, (event, input: AccessoryBrowserDropZoneInput | null) => this.result(() => this.registerBrowserDropZone(event, input)))
        ipcMain.handle(ACCESSORIES_IPC.beginBrowserTabTearOff, (event, input: AccessoryBrowserTearOffBeginInput) => this.result(() => this.serializeMove(() => this.beginBrowserTabTearOff(event, input))))
        ipcMain.handle(ACCESSORIES_IPC.finishBrowserTabTearOff, (event, input: AccessoryBrowserTearOffFinishInput) => this.result(() => this.serializeMove(() => this.finishBrowserTabTearOff(event, input))))
        ipcMain.handle(ACCESSORIES_IPC.cancelBrowserTabTearOff, (event, sessionId: string) => this.result(() => this.serializeMove(() => this.cancelBrowserTabTearOff(event, sessionId))))
    }

    open(input: AccessoryOpenInput): AccessoryResult<{ state: AccessoryWindowState }> {
        try {
            if (this.options.canOpen?.() === false) throw new Error('Accessories are unavailable until Zyra setup is complete.')
            const kind = normalizeKind(input?.kind)
            const sessionMode = normalizeSessionMode(kind, input?.sessionMode)
            const rawUrl = typeof input?.url === 'string' ? input.url.trim() : ''
            if (rawUrl && kind !== 'browser') throw new Error('Only Browser accessories accept a URL.')
            const url = rawUrl ? desktopWebLink(rawUrl) : null
            if (rawUrl && !url) throw new Error('Only HTTP and HTTPS links without embedded credentials can be opened.')
            const key = `${kind}:${sessionMode}`
            let record = this.primaryByKey.get(key)
            if (!record || record.window.isDestroyed()) {
                record = this.createRecord(kind, sessionMode, { primary: true })
            }
            if (url) {
                if (record.state.requests.length >= 64) throw new Error('Too many links are waiting for this Browser window.')
                const request: AccessoryNavigationRequest = {
                    id: `accessory-request:${randomUUID()}`,
                    url,
                    sessionMode
                }
                record.state.requests.push(request)
                this.publish(record)
            }
            this.focus(record.window)
            return { success: true, state: stateCopy(record.state) }
        } catch (error) {
            return { success: false, error: errorMessage(error) }
        }
    }

    windowIdForWebContents(webContentsId: number): string | null {
        return this.recordsByWebContentsId.get(webContentsId)?.state.id || null
    }

    resolveOwnedTerminalRuntimeId(webContentsId: number, workspaceId: string): string | null {
        const record = this.recordsByWebContentsId.get(webContentsId)
        if (!record || record.state.kind !== 'terminal' || record.state.id !== workspaceId) return null
        return this.terminalRuntimeId(record.state.id)
    }

    private createRecord(
        kind: AccessoryKind,
        sessionMode: BrowserSessionMode,
        options: { primary?: boolean; provisional?: boolean; browserTab?: AccessoryBrowserTab } = {}
    ): AccessoryWindowRecord {
        const id = `${kind}-${sessionMode}-${randomUUID()}`
        const browserTab = kind === 'browser'
            ? options.browserTab || { id: `browser:accessory:${id}:0`, sessionMode, url: '', title: 'New tab', faviconUrl: null }
            : null
        const state: AccessoryWindowState = {
            id,
            kind,
            sessionMode,
            rootPath: this.options.rootPath,
            requests: [],
            browserTabs: browserTab ? [{ ...browserTab }] : [],
            activeBrowserTabId: browserTab?.id || null,
            ...(options.provisional ? { provisional: true } : {})
        }
        const window = this.options.createWindow(state)
        const record: AccessoryWindowRecord = {
            state,
            window,
            key: `${kind}:${sessionMode}`,
            departedBrowserTabIds: new Set(),
            arrivingBrowserTabIds: new Set(options.provisional && browserTab ? [browserTab.id] : [])
        }
        if (kind === 'browser') {
            const showTabMenu = () => Menu.buildFromTemplate([
                { label: 'Show tabs vertically', click: () => window.webContents.send(ACCESSORIES_IPC.tabLayout, true) },
                { label: 'Show tabs horizontally', click: () => window.webContents.send(ACCESSORIES_IPC.tabLayout, false) },
                { type: 'separator' },
                { label: 'Zyra Browser settings', click: () => this.options.openBrowserSettings?.() }
            ]).popup({ window })
            window.on('system-context-menu', event => { event.preventDefault(); showTabMenu() })
            window.webContents.on('context-menu', (event, params) => {
                if (params.y < 40) { event.preventDefault(); showTabMenu() }
            })
        }
        const webContentsId = window.webContents.id
        this.recordsById.set(id, record)
        this.recordsByWebContentsId.set(webContentsId, record)
        if (options.primary) this.primaryByKey.set(record.key, record)
        window.webContents.once('did-finish-load', () => this.publish(record))
        window.on('close', (event) => {
            const session = [...this.tearOffSessions.values()].find((candidate) => candidate.targetWorkspaceId === state.id)
            const source = session ? this.recordsById.get(session.sourceWorkspaceId) : null
            if (!session || !source || source.window.isDestroyed()) return
            event.preventDefault()
            void this.serializeMove(async () => {
                if (this.tearOffSessions.has(session.id)) await this.rollbackTearOff(session)
            }).catch(() => undefined)
        })
        window.once('closed', () => this.handleWindowClosed(record, webContentsId))
        return record
    }

    private handleWindowClosed(record: AccessoryWindowRecord, webContentsId: number): void {
        this.recordsById.delete(record.state.id)
        this.recordsByWebContentsId.delete(webContentsId)
        this.browserDropZones.delete(record.state.id)
        if (this.primaryByKey.get(record.key) === record) {
            const replacement = [...this.recordsById.values()].find((candidate) => candidate.key === record.key && !candidate.state.provisional && !candidate.window.isDestroyed())
            if (replacement) this.primaryByKey.set(record.key, replacement)
            else this.primaryByKey.delete(record.key)
        }
        if (record.state.kind === 'terminal') this.options.onTerminalWindowClosed?.(this.terminalRuntimeId(record.state.id))
        for (const session of [...this.tearOffSessions.values()]) {
            if (session.sourceWorkspaceId === record.state.id) {
                void this.serializeMove(() => this.commitAfterSourceClosed(session)).catch(() => undefined)
            } else if (session.targetWorkspaceId === record.state.id) {
                this.stopTearOffFollow(session)
                this.tearOffSessions.delete(session.id)
            }
        }
    }

    private terminalRuntimeId(workspaceId: string): string {
        return `accessory-terminal:${workspaceId}`
    }

    private getState(event: IpcMainInvokeEvent): AccessoryResult<{ state: AccessoryWindowState }> {
        try {
            return { success: true, state: stateCopy(this.requireOwnedRecord(event).state) }
        } catch (error) {
            return { success: false, error: errorMessage(error) }
        }
    }

    private acknowledge(event: IpcMainInvokeEvent, rawRequestId: string): AccessoryResult<{ state: AccessoryWindowState }> {
        try {
            const record = this.requireOwnedRecord(event)
            const requestId = String(rawRequestId || '').trim()
            if (!requestId || requestId.length > 128) throw new Error('Accessory request identity is invalid.')
            const requestIndex = record.state.requests.findIndex((request) => request.id === requestId)
            if (requestIndex < 0) throw new Error('Accessory request is no longer pending.')
            record.state.requests.splice(requestIndex, 1)
            this.publish(record)
            return { success: true, state: stateCopy(record.state) }
        } catch (error) {
            return { success: false, error: errorMessage(error) }
        }
    }

    private syncBrowserTabs(event: IpcMainInvokeEvent, input: AccessoryBrowserTabsInput): { state: AccessoryWindowState } {
        const record = this.requireOwnedBrowserRecord(event, input?.workspaceId)
        if (JSON.stringify(input).length > 2_000_000) throw new Error('Browser tab update is too large.')
        const tabs = (Array.isArray(input?.tabs) ? input.tabs : []).map((tab) => normalizeBrowserTab(tab, record.state.sessionMode))
        if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) throw new Error('Browser tab identities must be unique.')
        const incomingIds = new Set(tabs.map((tab) => tab.id))
        for (const departedId of [...record.departedBrowserTabIds]) {
            if (!incomingIds.has(departedId)) record.departedBrowserTabIds.delete(departedId)
        }
        for (const arrivingId of [...record.arrivingBrowserTabIds]) {
            if (incomingIds.has(arrivingId)) record.arrivingBrowserTabIds.delete(arrivingId)
        }
        const acceptedTabs = tabs.filter((tab) => !record.departedBrowserTabIds.has(tab.id))
        const acceptedIds = new Set(acceptedTabs.map((tab) => tab.id))
        const protectedArrivals = record.state.browserTabs.filter((tab) => (
            record.arrivingBrowserTabIds.has(tab.id)
            && !record.departedBrowserTabIds.has(tab.id)
            && !acceptedIds.has(tab.id)
        ))
        for (const protectedTab of protectedArrivals) {
            const priorIndex = record.state.browserTabs.findIndex((tab) => tab.id === protectedTab.id)
            acceptedTabs.splice(Math.min(Math.max(priorIndex, 0), acceptedTabs.length), 0, { ...protectedTab })
            acceptedIds.add(protectedTab.id)
        }
        const requestedActiveId = String(input?.activeTabId || '')
        const protectedActiveId = record.state.activeBrowserTabId && protectedArrivals.some((tab) => tab.id === record.state.activeBrowserTabId)
            ? record.state.activeBrowserTabId
            : null
        const activeBrowserTabId = protectedActiveId
            || (acceptedIds.has(requestedActiveId) ? requestedActiveId : acceptedTabs[0]?.id || null)
        const changed = activeBrowserTabId !== record.state.activeBrowserTabId || !sameBrowserTabs(acceptedTabs, record.state.browserTabs)
        if (changed) {
            record.state.browserTabs = acceptedTabs
            record.state.activeBrowserTabId = activeBrowserTabId
            this.publish(record)
        }
        return { state: stateCopy(record.state) }
    }

    private registerBrowserDropZone(event: IpcMainInvokeEvent, input: AccessoryBrowserDropZoneInput | null): { registered: true } {
        const record = this.requireOwnedRecord(event)
        if (record.state.kind !== 'browser') throw new Error('Only Browser accessories have a tab drop zone.')
        if (!input) {
            this.browserDropZones.delete(record.state.id)
            return { registered: true }
        }
        if (input.workspaceId !== record.state.id) throw new Error('Browser drop zone ownership does not match this window.')
        const { rect } = input
        if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1) {
            throw new Error('Browser drop zone bounds are invalid.')
        }
        const tabSlots = (Array.isArray(input.tabSlots) ? input.tabSlots : []).flatMap((slot) => {
            const tabId = String(slot?.tabId || '')
            if (!isTrustedBrowserTabId(tabId) || !Number.isInteger(slot?.index) || slot.index < 0 || !Number.isFinite(slot.left) || !Number.isFinite(slot.right) || slot.right < slot.left) return []
            if (input.vertical && (!Number.isFinite(slot.top) || !Number.isFinite(slot.bottom) || slot.bottom! < slot.top!)) return []
            return [{ tabId, index: slot.index, left: slot.left, right: slot.right, top: slot.top, bottom: slot.bottom }]
        })
        this.browserDropZones.set(record.state.id, {
            workspaceId: record.state.id,
            rect: { ...rect },
            vertical: input.vertical === true, tabSlots
        })
        return { registered: true }
    }

    private async beginBrowserTabTearOff(event: IpcMainInvokeEvent, input: AccessoryBrowserTearOffBeginInput): Promise<{ sessionId: string; targetWorkspaceId: string }> {
        const browserViews = this.requireBrowserViews()
        const source = this.requireOwnedBrowserRecord(event, input?.workspaceId)
        assertPoint(input?.screenPoint, 'Browser tear-off cursor position')
        assertPoint(input?.grabOffset, 'Browser tear-off grab offset')
        const tabId = String(input?.tabId || '')
        const tab = source.state.browserTabs.find((candidate) => candidate.id === tabId)
        if (!tab) throw new Error('The Browser tab is no longer owned by this window.')
        for (const existing of [...this.tearOffSessions.values()]) {
            if (existing.ownerWebContentsId === event.sender.id) await this.rollbackTearOff(existing)
        }

        const target = this.createRecord('browser', source.state.sessionMode, { provisional: true, browserTab: tab })
        const sourceBounds = source.window.getBounds()
        target.window.setBounds({ width: sourceBounds.width, height: sourceBounds.height })
        this.positionTearOffWindow(target.window, input.screenPoint, input.grabOffset)
        target.window.setIgnoreMouseEvents(true, { forward: true })
        const sessionId = `accessory-tear-off:${randomUUID()}`
        const session: AccessoryBrowserTearOffSession = {
            id: sessionId,
            ownerWebContentsId: event.sender.id,
            sourceWorkspaceId: source.state.id,
            targetWorkspaceId: target.state.id,
            tab: { ...tab },
            grabOffset: { ...input.grabOffset },
            followTimer: setInterval(() => {
                if (!target.window.isDestroyed()) this.positionTearOffWindow(target.window, screen.getCursorScreenPoint(), input.grabOffset)
            }, 16)
        }
        this.tearOffSessions.set(sessionId, session)
        try {
            await browserViews.transferTo(tab.id, target.window, {
                expectedSourceWindow: source.window,
                expectedSourceOwnerId: `accessory:${source.state.id}`,
                expectedSessionMode: source.state.sessionMode,
                destinationThreadId: `accessory:${target.state.id}`
            })
            return { sessionId, targetWorkspaceId: target.state.id }
        } catch (error) {
            this.stopTearOffFollow(session)
            this.tearOffSessions.delete(session.id)
            if (!target.window.isDestroyed()) target.window.close()
            throw error
        }
    }

    private async finishBrowserTabTearOff(event: IpcMainInvokeEvent, input: AccessoryBrowserTearOffFinishInput): Promise<{ committed: boolean; targetWorkspaceId: string }> {
        assertPoint(input?.screenPoint, 'Browser tear-off drop position')
        const session = this.requireOwnedTearOff(event, input?.sessionId)
        this.stopTearOffFollow(session)
        const target = this.recordsById.get(session.targetWorkspaceId)
        if (!target || target.window.isDestroyed()) {
            this.tearOffSessions.delete(session.id)
            throw new Error('The Browser tear-off window closed before the drop completed.')
        }
        this.positionTearOffWindow(target.window, input.screenPoint, session.grabOffset)
        target.window.setIgnoreMouseEvents(false)
        const dropTarget = this.browserDropTargetAt(input.screenPoint, session)
        if (dropTarget?.state.id === session.sourceWorkspaceId) {
            await this.rollbackTearOff(session)
            return { committed: false, targetWorkspaceId: session.sourceWorkspaceId }
        }
        if (dropTarget) {
            await this.mergeTearOff(session, dropTarget, input.screenPoint)
            return { committed: true, targetWorkspaceId: dropTarget.state.id }
        }
        this.commitStandalone(session)
        this.focus(target.window)
        return { committed: true, targetWorkspaceId: target.state.id }
    }

    private async cancelBrowserTabTearOff(event: IpcMainInvokeEvent, rawSessionId: string): Promise<{ cancelled: true }> {
        const session = this.requireOwnedTearOff(event, rawSessionId)
        await this.rollbackTearOff(session)
        return { cancelled: true }
    }

    private async rollbackTearOff(session: AccessoryBrowserTearOffSession): Promise<void> {
        this.stopTearOffFollow(session)
        const source = this.recordsById.get(session.sourceWorkspaceId)
        const target = this.recordsById.get(session.targetWorkspaceId)
        if (!source || source.window.isDestroyed()) {
            await this.commitAfterSourceClosed(session)
            return
        }
        if (!target || target.window.isDestroyed()) {
            this.tearOffSessions.delete(session.id)
            throw new Error('The Browser tear-off destination closed before rollback.')
        }
        try {
            await this.requireBrowserViews().transferTo(session.tab.id, source.window, {
                expectedSourceWindow: target.window,
                expectedSourceOwnerId: `accessory:${target.state.id}`,
                expectedSessionMode: source.state.sessionMode,
                destinationThreadId: `accessory:${source.state.id}`
            })
        } catch (error) {
            this.commitStandalone(session)
            throw new Error(`The tab could not return to its source window. The detached Browser was kept open. ${errorMessage(error)}`)
        }
        this.tearOffSessions.delete(session.id)
        target.state.browserTabs = target.state.browserTabs.filter((tab) => tab.id !== session.tab.id)
        target.state.activeBrowserTabId = target.state.browserTabs[0]?.id || null
        if (!target.window.isDestroyed()) target.window.close()
        this.publish(source)
    }

    private async mergeTearOff(session: AccessoryBrowserTearOffSession, destination: AccessoryWindowRecord, point: { x: number; y: number }): Promise<void> {
        const source = this.recordsById.get(session.sourceWorkspaceId)
        const provisional = this.recordsById.get(session.targetWorkspaceId)
        if (!source || source.window.isDestroyed() || !provisional || provisional.window.isDestroyed()) throw new Error('The Browser transfer owner closed during the drop.')
        if (destination.state.sessionMode !== session.tab.sessionMode) throw new Error('Normal and incognito Browser tabs cannot share a window.')
        if (destination.state.browserTabs.some((tab) => tab.id === session.tab.id)) throw new Error('That Browser window already contains this tab.')
        const index = this.browserDropIndex(destination.state.id, point)
        destination.state.browserTabs.splice(index, 0, { ...session.tab })
        destination.state.activeBrowserTabId = session.tab.id
        destination.arrivingBrowserTabIds.add(session.tab.id)
        this.publish(destination)
        try {
            await this.requireBrowserViews().transferTo(session.tab.id, destination.window, {
                expectedSourceWindow: provisional.window,
                expectedSourceOwnerId: `accessory:${provisional.state.id}`,
                expectedSessionMode: destination.state.sessionMode,
                destinationThreadId: `accessory:${destination.state.id}`
            })
        } catch (error) {
            destination.arrivingBrowserTabIds.delete(session.tab.id)
            destination.state.browserTabs = destination.state.browserTabs.filter((tab) => tab.id !== session.tab.id)
            destination.state.activeBrowserTabId = destination.state.browserTabs[0]?.id || null
            this.publish(destination)
            await this.rollbackTearOff(session)
            throw error
        }
        this.removeTransferredSourceTab(source, session.tab.id)
        this.tearOffSessions.delete(session.id)
        provisional.state.browserTabs = []
        provisional.state.activeBrowserTabId = null
        if (!provisional.window.isDestroyed()) provisional.window.close()
        this.publish(source)
        this.publish(destination)
        this.focus(destination.window)
    }

    private commitStandalone(session: AccessoryBrowserTearOffSession): void {
        const source = this.recordsById.get(session.sourceWorkspaceId)
        const target = this.recordsById.get(session.targetWorkspaceId)
        this.stopTearOffFollow(session)
        this.tearOffSessions.delete(session.id)
        if (target && !target.window.isDestroyed()) {
            target.state.provisional = undefined
            target.window.setIgnoreMouseEvents(false)
            this.publish(target)
        }
        if (source && !source.window.isDestroyed()) {
            this.removeTransferredSourceTab(source, session.tab.id)
            this.publish(source)
        }
    }

    private async commitAfterSourceClosed(session: AccessoryBrowserTearOffSession): Promise<void> {
        if (!this.tearOffSessions.has(session.id)) return
        const target = this.recordsById.get(session.targetWorkspaceId)
        this.stopTearOffFollow(session)
        this.tearOffSessions.delete(session.id)
        if (!target || target.window.isDestroyed()) return
        target.state.provisional = undefined
        target.window.setIgnoreMouseEvents(false)
        if (!this.primaryByKey.has(target.key)) this.primaryByKey.set(target.key, target)
        this.publish(target)
        this.focus(target.window)
    }

    private removeTransferredSourceTab(source: AccessoryWindowRecord, tabId: string): void {
        source.departedBrowserTabIds.add(tabId)
        source.state.browserTabs = source.state.browserTabs.filter((tab) => tab.id !== tabId)
        if (source.state.activeBrowserTabId === tabId) source.state.activeBrowserTabId = source.state.browserTabs[0]?.id || null
    }

    private browserDropTargetAt(point: { x: number; y: number }, session: AccessoryBrowserTearOffSession): AccessoryWindowRecord | null {
        const candidates = [...this.browserDropZones.entries()].reverse()
        for (const [workspaceId, zone] of candidates) {
            if (workspaceId === session.targetWorkspaceId) continue
            const record = this.recordsById.get(workspaceId)
            if (!record || record.state.kind !== 'browser' || record.state.provisional || record.state.sessionMode !== session.tab.sessionMode) continue
            if (record.window.isDestroyed() || !record.window.isVisible() || record.window.isMinimized()) continue
            const { rect } = zone
            if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return record
        }
        return null
    }

    private browserDropIndex(workspaceId: string, point: { x: number; y: number }): number {
        const zone = this.browserDropZones.get(workspaceId)
        const slots = zone?.tabSlots || []
        for (const slot of slots) {
            if (zone?.vertical && slot.top !== undefined && slot.bottom !== undefined) {
                if (point.y < (slot.top + slot.bottom) / 2) return slot.index
            } else if (point.x < (slot.left + slot.right) / 2) return slot.index
        }
        return slots.length
    }

    private positionTearOffWindow(window: BrowserWindow, point: { x: number; y: number }, grabOffset: { x: number; y: number }): void {
        if (window.isDestroyed()) return
        window.setPosition(Math.round(point.x - grabOffset.x), Math.round(point.y - grabOffset.y), false)
    }

    private stopTearOffFollow(session: AccessoryBrowserTearOffSession): void {
        clearInterval(session.followTimer)
    }

    private requireOwnedTearOff(event: IpcMainInvokeEvent, rawSessionId: string): AccessoryBrowserTearOffSession {
        const sessionId = String(rawSessionId || '')
        const session = this.tearOffSessions.get(sessionId)
        if (!session || session.ownerWebContentsId !== event.sender.id) throw new Error('Browser tab tear-off session is unavailable.')
        const source = this.recordsById.get(session.sourceWorkspaceId)
        if (!source || source.window.isDestroyed() || source.window.webContents.id !== event.sender.id) {
            throw new Error('Browser tab tear-off source ownership changed.')
        }
        return session
    }

    private requireBrowserViews(): BrowserViewTransferHost {
        if (!this.browserViews) throw new Error('Browser tab transfer is unavailable until Zyra restarts.')
        return this.browserViews
    }

    private requireOwnedBrowserRecord(event: IpcMainInvokeEvent, workspaceId: unknown): AccessoryWindowRecord {
        const record = this.requireOwnedRecord(event)
        if (record.state.kind !== 'browser' || record.state.id !== String(workspaceId || '')) {
            throw new Error('Browser accessory ownership does not match this window.')
        }
        return record
    }

    private requireOwnedRecord(event: IpcMainInvokeEvent): AccessoryWindowRecord {
        const window = BrowserWindow.fromWebContents(event.sender)
        const record = this.recordsByWebContentsId.get(event.sender.id)
        if (!window || !record || record.window !== window || window.isDestroyed()) {
            throw new Error('Accessory state requires its trusted Zyra accessory window.')
        }
        return record
    }

    private publish(record: AccessoryWindowRecord): void {
        if (record.window.isDestroyed() || record.window.webContents.isDestroyed() || record.window.webContents.isLoading()) return
        record.window.webContents.send(ACCESSORIES_IPC.changed, stateCopy(record.state))
    }

    private focus(window: BrowserWindow): void {
        if (window.isDestroyed()) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
    }

    private serializeMove<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.moveQueue.catch(() => undefined).then(operation)
        this.moveQueue = next
        return next
    }

    private async result<T extends object>(operation: () => T | Promise<T>): Promise<({ success: true } & T) | { success: false; error: string }> {
        try {
            return { success: true, ...(await operation()) }
        } catch (error) {
            return { success: false, error: errorMessage(error) }
        }
    }
}
