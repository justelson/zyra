import { recoverAttachmentReplay, type ReplayEntry } from './agent-server-attachment-recovery'
import { selectDesktopControlWorker } from './external-tool-routing'
import { resolveDesktopAgentServerNamespace } from './agent-server-namespace'
export { resolveDesktopAgentServerNamespace } from './agent-server-namespace'
import { publishRuntimeActivation } from './runtime-activation'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'

export type PluginAuthorityUpdate = {
    pluginId?: string
    state?: 'active' | 'disabled'
    chats: Array<{ sessionKey: string; sources: Array<{ pluginId: string; releaseId: string; contentDigest: string; dir: string; scope?: string }> | null }>
}

export type ZyraWorkerEventMetadata = {
    sequence?: number
    occurredAt?: string
    turnId?: string
    localThreadId?: string
    replay?: boolean
}

export type ZyraWorkerRequestOptions = { beforeDispatch?: () => void }

export type ZyraWorkerLike = {
    readonly serverOwnedLifecycle?: boolean
    onEvent(listener: (event: unknown, metadata?: ZyraWorkerEventMetadata) => void): () => void
    setControlRequestHandler(handler: (operation: unknown, signal: AbortSignal, principal?: unknown) => Promise<Record<string, unknown>>): void
    isAlive(): boolean
    request(type: string, payload?: Record<string, unknown>, options?: ZyraWorkerRequestOptions): Promise<Record<string, unknown>>
    readPresence?(): Promise<CanonicalAgentChatPresence | null>
    flushReplay(): void
    dispose(): void
}

type AgentServerClient = EventEmitter & {
    serverMethods?: string[]
    connect(): Promise<void>
    refreshRuntimeStatus(): Promise<unknown>
    activateRuntimeUpdate(): Promise<unknown>
    attach(params: Record<string, unknown>): Promise<Record<string, unknown>>
    detach(sessionKey: string): Promise<Record<string, unknown>>
    request(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number; beforeDispatch?: () => void }): Promise<Record<string, unknown>>
    setControlHandler(handler: (operation: unknown, message: Record<string, unknown>) => Promise<Record<string, unknown>>): void
    setAppOperationHandler(handler: (request: Record<string, unknown>) => Promise<Record<string, unknown>>): void
    setDesktopWorkspaceHandler(handler: (request: Record<string, unknown>, message: Record<string, unknown>) => Promise<Record<string, unknown>>): void
    setDesktopWorkspaceCancelHandler(handler: (requestId: string) => void): void
    setDesktopWorkspaceTurnHandler(handler: (canonicalChatId: string, turnId: string) => void): void
    setDesktopWorkspaceTurnEndHandler(handler: (canonicalChatId: string, turnId: string) => void): void
    close(): void
}

export type CanonicalAgentChatPresence = {
    state: 'detached' | 'ready' | 'running' | 'background'
    activeTurnId: string | null
    clients: Array<{ clientId: string; surface: string; displayName?: string }>
    viewers?: Array<{ clientId: string; surface: string }>
    backgroundWorkActive: boolean
    attention?: 'approval' | 'input' | 'user-input' | null
    latestTurn?: {
        id: string
        state: 'running' | 'completed' | 'interrupted' | 'error'
        requestedAt: string
        startedAt: string | null
        completedAt: string | null
        assistantMessageId: string | null
    } | null
    latestSequence?: number
}

export type CanonicalAgentChat = {
    forkPending?: boolean
    forkOrigin?: { canonicalChatId: string; entryId: string; messageId?: string; createdAt: string; namespaceId?: string | null; worktree?: 'shared' | 'isolated' } | null
    settled?: boolean
    settlementManual?: boolean
    agentConversationKind?: 'thread' | 'subagent' | null
    agentCreatedBy?: string | null
    agentLabel?: string | null
    canonicalChatId: string
    aliases?: string[]
    lastSeenCompletedTurnId?: string | null
    sessionPath: string
    storageProject?: string
    project: string
    cwd: string
    title: string
    titleSource?: 'initial' | 'provisional' | 'model' | 'manual' | 'refresh' | null
    archived: boolean
    archivedAt?: string | null
    deleted?: boolean
    deletedAt?: string | null
    createdAt: string
    modifiedAt: string
    messageCount: number
    displayMessageCount?: number
    toolCallCount?: number
    errorCount?: number
    imageCount?: number
    entryCount?: number
    presence?: CanonicalAgentChatPresence
}

export type CanonicalAgentChatHistoryOptions = {
    before?: string | null
    limit?: number
    toolResultBodies?: 'lazy-v1' | 'lazy-desktop-v2'
}

export type CanonicalAgentChatHistory = {
    chat: CanonicalAgentChat
    entries: unknown[]
    pageInfo?: {
        startCursor?: string
        endCursor?: string
        oldestCursor: string | null
        hasOlder: boolean
        totalEntries: number
    }
}

type DesktopAgentServerConnectionOptions = {
    onChatAttention?: (notice: import('./chat-notifications').ChatAttentionNotice) => void
    stateDirectory?: string
    channel?: string
    autoStart?: boolean
    authorityProof?: string
    handleAppOperation?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
    openDesktopWorkspace?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
    cancelDesktopWorkspace?: (requestId: string) => void
    handleDesktopWorkspaceTurn?: (canonicalChatId: string, turnId: string) => void
    handleDesktopWorkspaceTurnEnded?: (canonicalChatId: string, turnId: string) => void
    handleDetachedControl?: (input: { canonicalChatId: string; turnId: string | null; operation: unknown; principal?: unknown; signal: AbortSignal }) => Promise<Record<string, unknown>>
}

export class DesktopAgentServerConnection {
    private clientPromise: Promise<AgentServerClient> | null = null
    private readonly workers = new Map<string, Set<ZyraAgentServerWorker>>()
    private readonly pendingAttachments = new Map<ZyraAgentServerWorker, Set<string>>()
    private readonly attachedWorkerKeys = new Map<ZyraAgentServerWorker, Set<string>>()
    private readonly orphanedRemoteAttachments = new Map<string, Set<string>>()
    private attachmentReconcilePromise: Promise<void> | null = null
    private attachmentReconcileRequested = false
    private attachmentReconcileRetryTimer: ReturnType<typeof setTimeout> | null = null
    private attachmentReconcileRetryTimerAt = 0
    private readonly attachmentReconcileRetryAt = new Map<string, number>()
    private readonly attachmentReconcileRetryDelayMs = new Map<string, number>()
    private readonly controlWorkers = new Map<string, ZyraAgentServerWorker>()
    private readonly detachedControlAbortControllers = new Map<string, AbortController>()
    private readonly pendingEvents = new Map<string, ReplayEntry[]>()
    private readonly catalogChangedListeners = new Set<(change: Record<string, unknown> | null) => void>()
    private disposed = false

    constructor(
        private readonly root: string,
        private readonly options: DesktopAgentServerConnectionOptions = {}
    ) {}

    setDesktopWorkspaceHandler(handler: (request: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
        this.options.openDesktopWorkspace = handler
    }

    setDesktopWorkspaceCancelHandler(handler: (requestId: string) => void): void {
        this.options.cancelDesktopWorkspace = handler
    }

    setDesktopWorkspaceTurnHandler(handler: (canonicalChatId: string, turnId: string) => void): void {
        this.options.handleDesktopWorkspaceTurn = handler
    }

    setDesktopWorkspaceTurnEndHandler(handler: (canonicalChatId: string, turnId: string) => void): void {
        this.options.handleDesktopWorkspaceTurnEnded = handler
    }

    setDetachedControlHandler(handler: DesktopAgentServerConnectionOptions['handleDetachedControl']): void {
        this.options.handleDetachedControl = handler
    }

    onCatalogChanged(listener: (change: Record<string, unknown> | null) => void): () => void {
        this.catalogChangedListeners.add(listener)
        return () => this.catalogChangedListeners.delete(listener)
    }

    createWorker(cwd: string, latestSequence = 0): ZyraAgentServerWorker {
        return new ZyraAgentServerWorker(this, cwd, latestSequence)
    }

    async updatePluginAuthority(input: PluginAuthorityUpdate): Promise<void> {
        const client = await this.getClient()
        await client.request('session.pluginAuthority', input, { timeoutMs: 20_000 })
    }

    async reportChatView(session: string, input: Record<string, unknown>): Promise<void> {
        const client = await this.getClient()
        if (!client.serverMethods?.includes('session.view')) throw new Error('Restart the updated agent server to synchronize chat viewing state.')
        await client.request('session.view', { session, ...input })
    }

    async refreshRuntimeStatus(): Promise<void> {
        const client = await this.getClient()
        await client.refreshRuntimeStatus()
    }

    async activateRuntimeUpdate(): Promise<void> {
        const client = await this.getClient()
        await client.activateRuntimeUpdate()
    }

    async prepareRuntime(model: string | null): Promise<void> {
        const client = await this.getClient()
        await client.request('runtime.prepare', { model }, { timeoutMs: 65_000 })
    }

    async listModels(forceRefresh = false, skipAvailability = false): Promise<Record<string, unknown>[]> {
        const client = await this.getClient()
        const result = await client.request('runtime.models', { forceRefresh, skipAvailability }, { timeoutMs: 65_000 })
        return Array.isArray(result['models']) ? result['models'] as Record<string, unknown>[] : []
    }

    async generateText(payload: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
        const client = await this.getClient()
        return client.request('runtime.generateText', payload, { timeoutMs: Math.max(1_000, timeoutMs + 5_000) })
    }

    async listCanonicalChats(project?: string): Promise<CanonicalAgentChat[]> {
        const client = await this.getClient()
        const result = await client.request('catalog.list', { project, allProjects: true, includeArchived: true, limit: 2000 })
        return Array.isArray(result['chats']) ? result['chats'] as CanonicalAgentChat[] : []
    }

    async getCanonicalChat(session: string, project?: string): Promise<CanonicalAgentChat | null> {
        const client = await this.getClient()
        const result = await client.request('catalog.get', { session, project, allProjects: true })
        return asRecord(result['chat']) as CanonicalAgentChat | null
    }

    async readCanonicalChatHistory(
        session: string,
        project?: string,
        options: CanonicalAgentChatHistoryOptions = {}
    ): Promise<CanonicalAgentChatHistory | null> {
        const client = await this.getClient()
        const result = await client.request('catalog.history', {
            session,
            project,
            before: options.before,
            limit: options.limit || 1000,
            toolResultBodies: options.toolResultBodies
        }, { timeoutMs: 35_000 })
        return asRecord(result['history']) as CanonicalAgentChatHistory | null
    }

    async readCanonicalHistoryEntryBody(
        session: string,
        project: string | undefined,
        ref: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> {
        const client = await this.getClient()
        const result = await client.request('catalog.entry.body', { session, project, ref }, { timeoutMs: 35_000 })
        return asRecord(result['body'])
    }

    async searchCanonicalToolOutputs(
        session: string,
        project: string | undefined,
        query: string,
        limit?: number
    ): Promise<Array<Record<string, unknown>>> {
        const client = await this.getClient()
        const result = await client.request('catalog.tool-output.search', { session, project, query, limit }, { timeoutMs: 35_000 })
        return Array.isArray(result['matches']) ? result['matches'].map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value)) : []
    }

    async appendCanonicalMessage(session: string, message: Record<string, unknown>): Promise<Record<string, unknown>> {
        const client = await this.getClient()
        const result = await client.request('catalog.message.append', { session, message }, { timeoutMs: 15_000 })
        return asRecord(result['receipt']) || {}
    }

    async findCanonicalMessageReceipt(session: string, operationId: string): Promise<Record<string, unknown> | null> {
        const client = await this.getClient()
        const result = await client.request('catalog.message.find', { session, operationId }, { timeoutMs: 15_000 })
        return asRecord(result['receipt'])
    }

    async updateCanonicalChat(
        session: string,
        patch: { title?: string; expectedTitle?: string; titleSource?: 'refresh'; project?: string; cwd?: string; archived?: boolean; deleted?: boolean; settled?: boolean; settlementIfAbsent?: boolean }
    ): Promise<CanonicalAgentChat | null> {
        const client = await this.getClient()
        const result = await client.request('catalog.update', { session, ...patch }, { timeoutMs: 5_000 })
        return asRecord(result['chat']) as CanonicalAgentChat | null
    }

    async attach(worker: ZyraAgentServerWorker, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (worker.isDisposed()) throw new Error('Zyra agent-server worker is detached.')
        const attachmentKeys = new Set(
            [payload['threadId'], payload['providerThreadId'], payload['localThreadId']]
                .map((value) => String(value || '').trim()).filter(Boolean)
        )
        this.pendingAttachments.set(worker, attachmentKeys)
        try {
            const client = await this.getClient()
            if (worker.isDisposed()) throw new Error('Zyra agent-server worker is detached.')
            const result = await client.attach({
                project: payload['cwd'],
                cwd: payload['cwd'],
                filesystemScope: payload['filesystemScope'],
                pluginSkillSources: payload['pluginSkillSources'],
                session: payload['threadId'] || payload['providerThreadId'],
                localThreadId: payload['localThreadId'],
                model: payload['model'],
                thinking: payload['thinking'],
                profile: payload['profile'],
                runtimeMode: payload['runtimeMode'],
                webSearch: payload['webSearch'],
                webFetch: payload['webFetch'],
                noSession: payload['noSession'],
                lastSequence: worker.latestSequence
            })
            const sessionKey = String(result['sessionKey'] || result['canonicalChatId'] || '')
            if (!sessionKey) throw new Error('Zyra agent server did not return a canonical chat id.')
            if (worker.isDisposed()) {
                this.markOrphanedRemoteAttachment(sessionKey, attachmentKeys)
                throw new Error('Zyra agent-server worker is detached.')
            }
            worker.bindSession(sessionKey, payload)
            const attachedWorkers = this.workers.get(sessionKey) || new Set<ZyraAgentServerWorker>()
            attachedWorkers.add(worker)
            this.workers.set(sessionKey, attachedWorkers)
            this.attachedWorkerKeys.set(worker, attachmentKeys)
            this.orphanedRemoteAttachments.delete(sessionKey)
            this.clearAttachmentReconciliationRetry(sessionKey)
            const recovery = recoverAttachmentReplay(result, worker.latestSequence)
            if (recovery.resetWatermark) worker.latestSequence = 0
            const replay = [...this.takePendingEvents(sessionKey), ...recovery.entries]
            worker.queueReplay(replay)
            const connected = asRecord(result['connected']) || {}
            const activeRequestContext = asRecord(result['activeRequestContext'])
            const presence = asRecord(result['presence'])
            const presenceLatestTurn = asRecord(presence?.['latestTurn'])
            const orphanedTurnId = !activeRequestContext
                && presence?.['state'] === 'ready'
                && presenceLatestTurn?.['state'] === 'running'
                ? String(presenceLatestTurn['id'] || '') || null
                : null
            return {
                ...connected,
                threadId: String(result['canonicalChatId'] || connected['threadId'] || sessionKey),
                providerThreadId: String(connected['providerThreadId'] || result['canonicalChatId'] || sessionKey),
                agentServerPendingCompactions: Array.isArray(result['pendingOperations'])
                    ? (result['pendingOperations'] as ReplayEntry[]).filter(entry => asRecord(entry.event)?.type === 'compaction_start').map(entry => ({ sequence: entry.sequence, occurredAt: entry.occurredAt }))
                    : undefined,
                agentServerActiveTurnId: activeRequestContext?.['turnId'],
                agentServerLatestTurnId: presenceLatestTurn?.['id'],
                agentServerLatestTurnState: presenceLatestTurn?.['state'],
                agentServerLatestTurnCompletedAt: presenceLatestTurn?.['completedAt'],
                agentServerOrphanedTurnId: orphanedTurnId || undefined
            }
        } finally {
            this.pendingAttachments.delete(worker)
            this.scheduleAttachmentReconciliation()
        }
    }

    async request(worker: ZyraAgentServerWorker, type: string, payload: Record<string, unknown>, options?: ZyraWorkerRequestOptions): Promise<Record<string, unknown>> {
        await this.ensureAttached(worker)
        const client = await this.getClient()
        const request = () => client.request('session.request', {
            sessionKey: worker.sessionKey,
            type,
            payload,
            ...(type === 'prompt' ? {
                requestContext: {
                    turnId: payload['turnId'],
                    localThreadId: worker.localThreadId
                }
            } : {})
        }, options)
        try {
            return await request()
        } catch (error: any) {
            if (error?.code !== 'AGENT_SERVER_SESSION_NOT_FOUND' && error?.code !== 'AGENT_SERVER_AUTH_FAILED') throw error
            this.markWorkerRemoteDetached(worker)
            await this.ensureAttached(worker)
            return request()
        }
    }

    detach(worker: ZyraAgentServerWorker): void {
        const sessionKey = worker.sessionKey
        const attachmentKeys = this.attachedWorkerKeys.get(worker) || new Set(sessionKey ? [sessionKey] : [])
        this.attachedWorkerKeys.delete(worker)
        if (!sessionKey) {
            if (this.pendingAttachments.has(worker)) this.scheduleAttachmentReconciliation()
            return
        }
        const attachedWorkers = this.workers.get(sessionKey)
        attachedWorkers?.delete(worker)
        if (attachedWorkers && attachedWorkers.size > 0) return
        this.workers.delete(sessionKey)
        this.markOrphanedRemoteAttachment(sessionKey, attachmentKeys)
    }

    close(): void {
        if (this.disposed) return
        this.disposed = true
        void this.clientPromise?.then((client) => client.close())
        this.clientPromise = null
        this.workers.clear()
        this.pendingAttachments.clear()
        this.attachedWorkerKeys.clear()
        this.orphanedRemoteAttachments.clear()
        this.attachmentReconcileRequested = false
        if (this.attachmentReconcileRetryTimer) clearTimeout(this.attachmentReconcileRetryTimer)
        this.attachmentReconcileRetryTimer = null
        this.attachmentReconcileRetryTimerAt = 0
        this.attachmentReconcileRetryAt.clear()
        this.attachmentReconcileRetryDelayMs.clear()
        this.controlWorkers.clear()
        for (const controller of this.detachedControlAbortControllers.values()) controller.abort(new Error('Desktop control connection closed.'))
        this.detachedControlAbortControllers.clear()
        this.pendingEvents.clear()
        this.catalogChangedListeners.clear()
    }

    private markOrphanedRemoteAttachment(sessionKey: string, attachmentKeys: Set<string>): void {
        const keys = this.orphanedRemoteAttachments.get(sessionKey) || new Set<string>()
        keys.add(sessionKey)
        for (const key of attachmentKeys) keys.add(key)
        this.orphanedRemoteAttachments.set(sessionKey, keys)
        this.scheduleAttachmentReconciliation()
    }

    private scheduleAttachmentReconciliation(): void {
        if (this.disposed) return
        this.attachmentReconcileRequested = true
        if (this.attachmentReconcilePromise) return
        const pending = (async () => {
            while (this.attachmentReconcileRequested && !this.disposed) {
                this.attachmentReconcileRequested = false
                await this.reconcileOrphanedRemoteAttachments()
            }
        })()
        this.attachmentReconcilePromise = pending
        void pending.then(
            () => this.finishAttachmentReconciliation(pending),
            () => this.finishAttachmentReconciliation(pending)
        )
    }

    private finishAttachmentReconciliation(pending: Promise<void>): void {
        if (this.attachmentReconcilePromise !== pending) return
        this.attachmentReconcilePromise = null
        if (this.attachmentReconcileRequested) this.scheduleAttachmentReconciliation()
    }

    private scheduleAttachmentReconciliationRetry(sessionKey: string): void {
        if (this.disposed) return
        const delayMs = this.attachmentReconcileRetryDelayMs.get(sessionKey) || 100
        this.attachmentReconcileRetryDelayMs.set(sessionKey, Math.min(5_000, delayMs * 2))
        this.attachmentReconcileRetryAt.set(sessionKey, Date.now() + delayMs)
        this.scheduleAttachmentReconciliationRetryTimer()
    }

    private clearAttachmentReconciliationRetry(sessionKey: string): void {
        this.attachmentReconcileRetryAt.delete(sessionKey)
        this.attachmentReconcileRetryDelayMs.delete(sessionKey)
        this.scheduleAttachmentReconciliationRetryTimer()
    }

    private scheduleAttachmentReconciliationRetryTimer(): void {
        if (this.disposed) return
        for (const sessionKey of this.attachmentReconcileRetryAt.keys()) {
            if (this.orphanedRemoteAttachments.has(sessionKey)) continue
            this.attachmentReconcileRetryAt.delete(sessionKey)
            this.attachmentReconcileRetryDelayMs.delete(sessionKey)
        }
        const nextRetryAt = Math.min(...this.attachmentReconcileRetryAt.values())
        if (!Number.isFinite(nextRetryAt)) {
            if (this.attachmentReconcileRetryTimer) clearTimeout(this.attachmentReconcileRetryTimer)
            this.attachmentReconcileRetryTimer = null
            this.attachmentReconcileRetryTimerAt = 0
            return
        }
        if (this.attachmentReconcileRetryTimer && this.attachmentReconcileRetryTimerAt <= nextRetryAt) return
        if (this.attachmentReconcileRetryTimer) clearTimeout(this.attachmentReconcileRetryTimer)
        this.attachmentReconcileRetryTimerAt = nextRetryAt
        this.attachmentReconcileRetryTimer = setTimeout(() => {
            this.attachmentReconcileRetryTimer = null
            this.attachmentReconcileRetryTimerAt = 0
            this.scheduleAttachmentReconciliation()
        }, Math.max(0, nextRetryAt - Date.now()))
        this.attachmentReconcileRetryTimer.unref?.()
    }

    private async reconcileOrphanedRemoteAttachments(): Promise<void> {
        const clientPromise = this.clientPromise
        if (!clientPromise) return
        let client: AgentServerClient
        try {
            client = await clientPromise
        } catch {
            return
        }
        for (const [sessionKey, attachmentKeys] of [...this.orphanedRemoteAttachments]) {
            if (this.disposed) return
            if (this.orphanedRemoteAttachments.get(sessionKey) !== attachmentKeys) continue
            const hasAttachedWorker = [...(this.workers.get(sessionKey) || [])]
                .some((candidate) => !candidate.isDisposed())
            if (hasAttachedWorker) {
                this.orphanedRemoteAttachments.delete(sessionKey)
                this.clearAttachmentReconciliationRetry(sessionKey)
                continue
            }
            const hasPendingReplacement = [...this.pendingAttachments.entries()].some(([candidate, candidateKeys]) => {
                if (candidate.isDisposed()) return false
                if (candidateKeys.has(sessionKey)) return true
                return [...candidateKeys].some((key) => attachmentKeys.has(key))
            })
            if (hasPendingReplacement) {
                this.clearAttachmentReconciliationRetry(sessionKey)
                continue
            }
            const retryAt = this.attachmentReconcileRetryAt.get(sessionKey) || 0
            if (retryAt > Date.now()) continue
            try {
                await client.detach(sessionKey)
                if (this.orphanedRemoteAttachments.get(sessionKey) === attachmentKeys) {
                    this.orphanedRemoteAttachments.delete(sessionKey)
                }
                this.clearAttachmentReconciliationRetry(sessionKey)
            } catch (error: any) {
                const remoteAttachmentAbsent = [
                    'AGENT_SERVER_SESSION_NOT_FOUND',
                    'AGENT_SERVER_AUTH_FAILED',
                    'AGENT_SERVER_DISCONNECTED'
                ].includes(String(error?.code || ''))
                if (remoteAttachmentAbsent) {
                    if (this.orphanedRemoteAttachments.get(sessionKey) === attachmentKeys) {
                        this.orphanedRemoteAttachments.delete(sessionKey)
                    }
                    this.clearAttachmentReconciliationRetry(sessionKey)
                } else if (this.orphanedRemoteAttachments.get(sessionKey) === attachmentKeys) {
                    this.scheduleAttachmentReconciliationRetry(sessionKey)
                } else {
                    this.clearAttachmentReconciliationRetry(sessionKey)
                }
            }
        }
        this.scheduleAttachmentReconciliationRetryTimer()
    }

    private async ensureAttached(worker: ZyraAgentServerWorker): Promise<void> {
        if (!worker.connectPayload) throw new Error('Zyra agent-server worker is not connected.')
        const client = await this.getClient()
        await client.connect()
        if (worker.sessionKey && this.workers.get(worker.sessionKey)?.has(worker)) return
        await this.attach(worker, worker.connectPayload)
        worker.flushReplay()
    }

    private markWorkerRemoteDetached(worker: ZyraAgentServerWorker): void {
        if (worker.sessionKey) this.workers.get(worker.sessionKey)?.delete(worker)
        this.attachedWorkerKeys.delete(worker)
        worker.markRemoteDetached()
    }

    private handleClientDisconnect(): void {
        for (const workers of this.workers.values()) {
            for (const worker of workers) worker.markRemoteDetached()
        }
        this.workers.clear()
        this.attachedWorkerKeys.clear()
        this.orphanedRemoteAttachments.clear()
        if (this.attachmentReconcileRetryTimer) clearTimeout(this.attachmentReconcileRetryTimer)
        this.attachmentReconcileRetryTimer = null
        this.attachmentReconcileRetryTimerAt = 0
        this.attachmentReconcileRetryAt.clear()
        this.attachmentReconcileRetryDelayMs.clear()
        this.controlWorkers.clear()
        for (const controller of this.detachedControlAbortControllers.values()) controller.abort(new Error('Desktop control connection disconnected.'))
        this.detachedControlAbortControllers.clear()
    }

    private async getClient(): Promise<AgentServerClient> {
        if (this.disposed) throw new Error('Zyra agent-server connection is closed.')
        if (!this.clientPromise) {
            const pending = this.createClient()
            const tracked = pending.catch((error) => {
                if (this.clientPromise === tracked) this.clientPromise = null
                throw error
            })
            this.clientPromise = tracked
        }
        return this.clientPromise
    }

    setAppOperationHandler(handler: (request: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
        this.options.handleAppOperation = handler
        // The installed wrapper reads current options and retains live validation.
    }

    private async createClient(): Promise<AgentServerClient> {
        const moduleUrl = pathToFileURL(join(this.root, 'src', 'agent-server', 'client.mjs')).href
        const module = await import(/* @vite-ignore */ moduleUrl) as {
            ZyraAgentServerClient: new (options: Record<string, unknown>) => AgentServerClient
        }
        const userDataPath = this.options.stateDirectory
            ? ''
            : (await import('electron')).app.getPath('userData')
        const namespace = resolveDesktopAgentServerNamespace(userDataPath, this.options)
        const clientOptions = { ...this.options, ...namespace }
        const authorityProof = this.options.authorityProof || await loadDesktopAuthorityProof(clientOptions)
        const client = new module.ZyraAgentServerClient({
            root: this.root,
            clientId: `desktop:${process.pid}:${randomUUID()}`,
            surface: 'desktop',
            authorities: ['desktop-control', 'desktop-workspace', ...(this.options.handleAppOperation ? ['desktop-app'] : [])],
            authorityProof,
            ...clientOptions
        })
        client.setAppOperationHandler(async request => {
            if (!this.options.handleAppOperation) throw new Error('Desktop app operations are unavailable.')
            return this.options.handleAppOperation({ ...request, assertCurrent: async () => {
                const state = await client.request('desktop.app.validate', { operationId: request['operationId'], requestId: request['ownerRequestId'] }, { timeoutMs: 5_000 })
                if (state['valid'] !== true) throw new Error('The app operation expired, its owner disconnected, or its originating turn was stopped.')
            } })
        })
        client.setDesktopWorkspaceHandler(async (request, message) => {
            request = { ...request, _requestId: String(message['requestId'] || '') }
            if (!this.options.openDesktopWorkspace) {
                throw Object.assign(new Error('Desktop workspace routing is unavailable.'), { code: 'DESKTOP_WORKSPACE_UNAVAILABLE', retryable: true })
            }
            return this.options.openDesktopWorkspace(request)
        })
        client.setDesktopWorkspaceCancelHandler((requestId) => this.options.cancelDesktopWorkspace?.(requestId))
        client.setDesktopWorkspaceTurnHandler((canonicalChatId, turnId) => this.options.handleDesktopWorkspaceTurn?.(canonicalChatId, turnId))
        client.setDesktopWorkspaceTurnEndHandler((canonicalChatId, turnId) => this.options.handleDesktopWorkspaceTurnEnded?.(canonicalChatId, turnId))
        client.setControlHandler(async (operation, message) => {
            const requestId = String(message['requestId'] || '')
            const candidates = [...(this.workers.get(String(message['sessionKey'] || '')) || [])].filter((candidate) => candidate.isAlive())
            const requestLocalThreadId = asRecord(message['requestContext'])?.['localThreadId']
            const worker = selectDesktopControlWorker(candidates, requestLocalThreadId, message['externalToolSessionId'])
            if (!worker) {
                if (!this.options.handleDetachedControl) throw Object.assign(new Error('No desktop runtime is attached to this canonical chat.'), { code: 'CONTROL_DRIVER_UNAVAILABLE', retryable: true })
                const controller = new AbortController()
                this.detachedControlAbortControllers.set(requestId, controller)
                try {
                    return await this.options.handleDetachedControl({
                        canonicalChatId: String(message['sessionKey'] || ''),
                        turnId: String(asRecord(message['requestContext'])?.['turnId'] || '') || null,
                        operation,
                        principal: message['principal'],
                        signal: controller.signal
                    })
                } finally {
                    this.detachedControlAbortControllers.delete(requestId)
                }
            }
            this.controlWorkers.set(requestId, worker)
            try {
                return await worker.handleControlRequest(requestId, operation, message['principal'])
            } finally {
                this.controlWorkers.delete(requestId)
            }
        })
        client.on('control-cancel', (message: Record<string, unknown>) => {
            const requestId = String(message['requestId'] || '')
            this.controlWorkers.get(requestId)?.cancelControlRequest(requestId)
            this.detachedControlAbortControllers.get(requestId)?.abort(new Error('Detached Browser control was cancelled.'))
        })
        client.on('runtime-status', publishRuntimeActivation)
        client.on('chat-attention', (notice: import('./chat-notifications').ChatAttentionNotice) => this.options.onChatAttention?.(notice))
        client.on('session-event', (message: Record<string, unknown>) => this.handleSessionEvent(message))
        client.on('disconnect', () => this.handleClientDisconnect())
        client.on('catalog-changed', (message: Record<string, unknown>) => {
            const change = asRecord(message['change'])
            for (const listener of this.catalogChangedListeners) listener(change)
        })
        await client.connect()
        return client
    }

    private handleSessionEvent(message: Record<string, unknown>): void {
        const sessionKey = String(message['sessionKey'] || '')
        if (!sessionKey) return
        const entry: ReplayEntry = {
            sequence: Number(message['sequence']) || undefined,
            occurredAt: typeof message['occurredAt'] === 'string' ? message['occurredAt'] : undefined,
            event: message['event'],
            requestContext: asRecord(message['requestContext']) as ReplayEntry['requestContext']
        }
        const workers = this.workers.get(sessionKey)
        if (workers?.size) {
            for (const worker of workers) worker.receive(entry, false)
        } else {
            const pending = this.pendingEvents.get(sessionKey) || []
            pending.push(entry)
            this.pendingEvents.set(sessionKey, pending.slice(-512))
        }
    }

    private takePendingEvents(sessionKey: string): ReplayEntry[] {
        const entries = this.pendingEvents.get(sessionKey) || []
        this.pendingEvents.delete(sessionKey)
        return entries
    }
}

export class ZyraAgentServerWorker implements ZyraWorkerLike {
    readonly serverOwnedLifecycle = true
    readonly eventListeners = new Set<(event: unknown, metadata?: ZyraWorkerEventMetadata) => void>()
    readonly controlAbortControllers = new Map<string, AbortController>()
    private replay: ReplayEntry[] = []
    private controlRequestHandler: ((operation: unknown, signal: AbortSignal, principal?: unknown) => Promise<Record<string, unknown>>) | null = null
    private disposed = false
    sessionKey: string | null = null
    localThreadId: string | null = null
    latestSequence = 0
    connectPayload: Record<string, unknown> | null = null

    constructor(
        private readonly connection: DesktopAgentServerConnection,
        readonly cwd: string,
        latestSequence = 0
    ) {
        this.latestSequence = Math.max(0, Number(latestSequence) || 0)
    }

    onEvent(listener: (event: unknown, metadata?: ZyraWorkerEventMetadata) => void): () => void {
        this.eventListeners.add(listener)
        return () => this.eventListeners.delete(listener)
    }

    setControlRequestHandler(handler: (operation: unknown, signal: AbortSignal, principal?: unknown) => Promise<Record<string, unknown>>): void {
        this.controlRequestHandler = handler
    }

    isAlive(): boolean {
        return !this.disposed && Boolean(this.sessionKey)
    }

    isDisposed(): boolean {
        return this.disposed
    }

    async request(type: string, payload: Record<string, unknown> = {}, options?: ZyraWorkerRequestOptions): Promise<Record<string, unknown>> {
        if (this.disposed) throw new Error('Zyra agent-server worker is detached.')
        if (type === 'connect') return this.connection.attach(this, payload)
        return this.connection.request(this, type, payload, options)
    }

    async readPresence(): Promise<CanonicalAgentChatPresence | null> {
        if (!this.sessionKey || this.disposed) return null
        const chat = await this.connection.getCanonicalChat(this.sessionKey, this.cwd)
        return chat?.presence || null
    }

    bindSession(sessionKey: string, payload: Record<string, unknown>): void {
        this.sessionKey = sessionKey
        this.localThreadId = String(payload['localThreadId'] || this.localThreadId || '') || null
        this.connectPayload = { ...payload, threadId: sessionKey, providerThreadId: sessionKey }
    }

    markRemoteDetached(): void {
        const detachedSessionKey = this.sessionKey
        this.sessionKey = null
        if (!detachedSessionKey || this.disposed) return
        for (const listener of this.eventListeners) {
            listener({ type: 'server.transport.detached', sessionKey: detachedSessionKey })
        }
    }

    queueReplay(entries: ReplayEntry[]): void {
        this.replay.push(...entries)
        this.replay.sort((left, right) => (Number(left.sequence) || Number.MAX_SAFE_INTEGER) - (Number(right.sequence) || Number.MAX_SAFE_INTEGER))
    }

    flushReplay(): void {
        const replay = this.replay
        this.replay = []
        for (const entry of replay) this.receive(entry, true)
    }

    receive(entry: ReplayEntry, replay: boolean): void {
        const sequence = Number(entry.sequence) || 0
        if (sequence && sequence <= this.latestSequence && !entry.recovery) return
        if (sequence) this.latestSequence = Math.max(this.latestSequence, sequence)
        const metadata: ZyraWorkerEventMetadata = {
            ...(sequence ? { sequence } : {}),
            ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
            ...(entry.requestContext?.turnId ? { turnId: entry.requestContext.turnId } : {}),
            ...(entry.requestContext?.localThreadId ? { localThreadId: entry.requestContext.localThreadId } : {}),
            ...(replay ? { replay: true } : {})
        }
        for (const listener of this.eventListeners) listener(entry.event, metadata)
    }

    async handleControlRequest(requestId: string, operation: unknown, principal?: unknown): Promise<Record<string, unknown>> {
        const controller = new AbortController()
        this.controlAbortControllers.set(requestId, controller)
        try {
            if (!this.controlRequestHandler) throw Object.assign(new Error('Desktop control authority is not bound to this chat.'), { code: 'CONTROL_DRIVER_UNAVAILABLE' })
            return await this.controlRequestHandler(operation, controller.signal, principal)
        } finally {
            this.controlAbortControllers.delete(requestId)
        }
    }

    cancelControlRequest(requestId: string): void {
        this.controlAbortControllers.get(requestId)?.abort()
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        for (const controller of this.controlAbortControllers.values()) controller.abort()
        this.controlAbortControllers.clear()
        this.connection.detach(this)
        this.eventListeners.clear()
    }
}

async function loadDesktopAuthorityProof(options: DesktopAgentServerConnectionOptions): Promise<string> {
    const electron = await import('electron')
    if (!electron.safeStorage?.isEncryptionAvailable?.()) return ''
    const secretFile = join(electron.app.getPath('userData'), 'agent-control', 'agent-server-authority.bin')
    let proof = ''
    try {
        if (existsSync(secretFile)) proof = electron.safeStorage.decryptString(readFileSync(secretFile))
    } catch {
        proof = ''
    }
    if (!proof) {
        proof = randomBytes(32).toString('base64url')
        mkdirSync(dirname(secretFile), { recursive: true })
        writeFileSync(secretFile, electron.safeStorage.encryptString(proof), { mode: 0o600 })
    }
    const stateDirectory = resolve(options.stateDirectory || process.env.ZYRA_STATE_DIR || join(os.homedir(), '.zyra'))
    const channel = String(options.channel || process.env.ZYRA_AGENT_SERVER_CHANNEL || 'default').trim().toLowerCase()
    mkdirSync(stateDirectory, { recursive: true })
    writeFileSync(
        join(stateDirectory, `agent-server-${channel}.desktop-authority`),
        createHash('sha256').update(proof).digest('base64url'),
        { encoding: 'utf8', mode: 0o600 }
    )
    return proof
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}
