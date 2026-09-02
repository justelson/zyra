import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { rename as renameFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import log from 'electron-log'
import initSqlJs, { type Database as SqlDatabase } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantActivity,
    AssistantAssociateProjectFolderInput,
    AssistantDismissProjectCandidateInput,
    AssistantDomainEvent,
    AssistantGetHistoryPageInput,
    AssistantGetHistoryAroundMessageInput,
    AssistantHistoryAroundMessageResult,
    AssistantHistoryPage,
    AssistantMessage,
    AssistantChatScope,
    AssistantCreateProjectInput,
    AssistantProject,
    AssistantProjectCatalog,
    AssistantRemoveProjectFolderInput,
    AssistantReviewIndex,
    AssistantSearchChatsInput,
    AssistantSearchChatsResult,
    AssistantSearchTurnsResult,
    AssistantSessionTurnUsageEntry,
    AssistantTurnDetail,
    AssistantSnapshot,
    AssistantThreadDetail,
    AssistantUpdateProjectInput,
    FleetSnapshot
} from '../../shared/assistant/contracts'
import { is } from '../utils'
import { backupAssistantDatabaseSet } from './assistant-database-files'
import { createDefaultSnapshot, recoverPersistedSnapshot } from './projector'
import { mergeAssistantSearchTurnIds, readAssistantActivity, readAssistantHistoryAroundMessage, readAssistantHistoryPage, readAssistantReviewIndex, readAssistantThreadDetail, readAssistantTurnDetail, searchAssistantTurns } from './persistence-history'
import { hydrateSnapshotThreads, summarizeThread } from './persistence-snapshot'
import { initializeAssistantSearchIndex, searchAssistantChatsFallback } from './assistant-search-index'
import { AssistantSearchWorkerClient } from './assistant-search-worker-client'
import { deleteFleetProjection, projectFleetSnapshot, readFleetSnapshot } from './fleet-persistence'
import {
    associateAssistantProjectFolder,
    canonicalAssistantFolderKey,
    createAssistantChatScopeForProject,
    createAssistantProject,
    detectAssistantProjectCandidates,
    dismissAssistantProjectCandidate,
    ensureAssistantProjectHomeDirectories,
    ensureLegacyAssistantProjectForFolder,
    findAssistantProjectByFolderPath,
    isAssistantPathInsideRoot,
    migrateLegacyAssistantProjects,
    readAssistantProjectCatalog,
    removeAssistantProjectFolder,
    updateAssistantProject
} from './assistant-project-persistence'
import {
    readHydratedThreadDetails,
    readAssistantFirstUserMessageText,
    readAssistantLatestUserMessageText,
    readAssistantPersistenceRecord,
    readAssistantSessionTurnUsage,
    readAssistantTimelineProjectionRows
} from './persistence-read'
import {
    initializeAssistantPersistenceSchema,
    PERSISTENCE_FLUSH_DEBOUNCE_MS,
    PERSISTENCE_VERSION,
    readAssistantPersistenceVersion
} from './persistence-utils'
import {
    persistAssistantEvent,
    persistAssistantSnapshotMeta,
    replaceAssistantSnapshot,
    upsertAssistantCanonicalTimelineProjection,
    upsertAssistantMeta
} from './persistence-write'
import {
    coalesceAssistantPersistenceEvents,
    type PendingAssistantPersistenceEvent
} from './persistence-event-batching'

const PERSISTENCE_EVENT_BATCH_DELAY_MS = 240
const FORCE_ASSISTANT_DB_RESET_ENV = 'DEVSCOPE_RESET_ASSISTANT_DB'
function isRecoverableSqlitePersistenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '')
    const normalized = message.toLowerCase()
    return normalized.includes('database disk image is malformed')
        || normalized.includes('file is not a database')
        || normalized.includes('malformed')
        || normalized.includes('not a database')
}

async function writeFileAtomically(filePath: string, contents: Uint8Array | string): Promise<void> {
    const temporaryPath = `${filePath}.tmp`
    await writeFile(temporaryPath, contents)
    await renameFile(temporaryPath, filePath)
}

function shouldForceAssistantDbReset(): boolean {
    return is.dev && process.env[FORCE_ASSISTANT_DB_RESET_ENV] === '1'
}

function shouldUseNativeAssistantPersistence(): boolean {
    return Boolean(process.versions.electron)
        && process.env['ZYRA_ASSISTANT_PERSISTENCE_BACKEND'] !== 'sqljs'
}

function createAssistantFallbackSnapshot(snapshot: AssistantSnapshot): AssistantSnapshot {
    return {
        ...snapshot,
        playground: structuredClone(snapshot.playground),
        knownModels: structuredClone(snapshot.knownModels),
        fleetByThreadId: structuredClone(snapshot.fleetByThreadId || {}),
        sessions: snapshot.sessions.map((session) => ({
            ...session,
            threadIds: [...session.threadIds],
            threads: session.threads.map(summarizeThread)
        }))
    }
}

export class AssistantPersistence {
    private readonly filePath: string
    private readonly legacyFilePath: string
    private readonly projectHomesRoot: string
    private readonly globalWorkspaceRoot: string
    private readonly internalProjectPathKeys: ReadonlySet<string>
    private db: SqlDatabase | null = null
    private databaseBackend: 'native' | 'sqljs' = 'sqljs'
    private initPromise: Promise<void> | null = null
    private operationQueue: Promise<void> = Promise.resolve()
    private writeTimer: NodeJS.Timeout | null = null
    private pendingEvents: PendingAssistantPersistenceEvent[] = []
    private pendingEventTimer: NodeJS.Timeout | null = null
    private pendingProcessingPromise: Promise<void> | null = null
    private fallbackSnapshotSource: AssistantSnapshot | null = null
    private readonly activeStreamingThreadIds = new Set<string>()
    private readonly searchWorker = new AssistantSearchWorkerClient()
    private searchIndexAvailable = false
    private searchBackfillTimer: NodeJS.Timeout | null = null
    private searchWorkerStartTimer: NodeJS.Timeout | null = null
    private searchBackfillPending = false
    private closing = false
    private diskFlushDeferred = false

    constructor() {
        const assistantDir = join(app.getPath('userData'), 'assistant')
        if (!existsSync(assistantDir)) {
            mkdirSync(assistantDir, { recursive: true })
        }
        this.filePath = join(assistantDir, 'assistant-state.sqlite')
        this.legacyFilePath = join(assistantDir, 'assistant-state.json')
        this.projectHomesRoot = join(assistantDir, 'project-homes')
        this.globalWorkspaceRoot = join(assistantDir, 'global-workspace')
        mkdirSync(this.globalWorkspaceRoot, { recursive: true })
        const internalPaths = [this.globalWorkspaceRoot]
        if (app.isPackaged) internalPaths.push(dirname(app.getPath('exe')))
        this.internalProjectPathKeys = new Set(internalPaths.map(canonicalAssistantFolderKey))
    }

    getGlobalWorkspaceRoot(): string {
        return this.globalWorkspaceRoot
    }

    isInternalProjectPath(value?: string | null): boolean {
        const normalized = String(value || '').trim()
        return Boolean(normalized && [...this.internalProjectPathKeys].some((root) => (
            isAssistantPathInsideRoot(normalized, root)
        )))
    }

    async load(): Promise<{ version: number; snapshot: AssistantSnapshot; events: AssistantDomainEvent[] }> {
        await this.ensureInitialized()
        return this.enqueue(() => {
            const record = readAssistantPersistenceRecord(this.requireDb())
            this.fallbackSnapshotSource = record.snapshot
            return record
        })
    }

    appendEvent(event: AssistantDomainEvent, snapshot: AssistantSnapshot): void {
        this.fallbackSnapshotSource = snapshot
        this.pendingEvents.push({ event, snapshot })
        this.schedulePendingEventProcessing()
    }

    setStreamingActive(threadId: string, active: boolean): void {
        const normalizedThreadId = String(threadId || '').trim()
        if (!normalizedThreadId) return

        if (active) {
            this.activeStreamingThreadIds.add(normalizedThreadId)
            if (this.writeTimer) {
                clearTimeout(this.writeTimer)
                this.writeTimer = null
                this.diskFlushDeferred = true
            }
            return
        }

        this.activeStreamingThreadIds.delete(normalizedThreadId)
        if (this.activeStreamingThreadIds.size === 0 && this.diskFlushDeferred) {
            this.diskFlushDeferred = false
            this.scheduleFlush()
        }
    }

    replaceSnapshot(snapshot: AssistantSnapshot): void {
        this.fallbackSnapshotSource = snapshot
        this.pendingEvents = []
        this.clearPendingEventTimer()
        void this.enqueue(() => {
            replaceAssistantSnapshot(this.requireDb(), snapshot)
            this.scheduleFlush()
        }).catch((error) => {
            log.error('[AssistantPersistence] Failed to replace assistant snapshot.', error)
        })
    }

    updateMetadata(snapshot: AssistantSnapshot): void {
        this.fallbackSnapshotSource = snapshot
        void this.enqueue(() => {
            persistAssistantSnapshotMeta(this.requireDb(), snapshot)
            this.scheduleFlush()
        }).catch((error) => {
            log.error('[AssistantPersistence] Failed to update assistant metadata.', error)
        })
    }

    async listProjects(discoveryRoots: readonly string[] = []): Promise<AssistantProjectCatalog> {
        await this.ensureInitialized()
        return this.enqueue(() => {
            if (discoveryRoots.length > 0) {
                detectAssistantProjectCandidates(
                    this.requireDb(),
                    discoveryRoots,
                    undefined,
                    [...this.internalProjectPathKeys]
                )
            }
            const catalog = readAssistantProjectCatalog(this.requireDb())
            ensureAssistantProjectHomeDirectories(catalog.projects.map((project) => project.homePath))
            if (discoveryRoots.length > 0) this.scheduleFlush()
            return catalog
        })
    }

    async createProject(input: AssistantCreateProjectInput, candidateId?: string): Promise<AssistantProject> {
        if (this.isInternalProjectPath(input.folderPath)) throw new Error('Zyra installation and internal workspace folders cannot become Projects.')
        await this.ensureInitialized()
        return this.enqueue(() => {
            const project = createAssistantProject(this.requireDb(), input, {
                projectHomesRoot: this.projectHomesRoot,
                candidateId
            })
            this.scheduleFlush()
            return project
        })
    }

    async associateProjectFolder(input: AssistantAssociateProjectFolderInput): Promise<AssistantProject> {
        if (this.isInternalProjectPath(input.path)) throw new Error('Zyra installation and internal workspace folders cannot be associated with Projects.')
        await this.ensureInitialized()
        return this.enqueue(() => {
            const project = associateAssistantProjectFolder(this.requireDb(), input)
            this.scheduleFlush()
            return project
        })
    }

    async removeProjectFolder(input: AssistantRemoveProjectFolderInput): Promise<AssistantProject> {
        await this.ensureInitialized()
        return this.enqueue(() => {
            const project = removeAssistantProjectFolder(this.requireDb(), input)
            this.scheduleFlush()
            return project
        })
    }

    async updateProject(input: AssistantUpdateProjectInput): Promise<AssistantProject> {
        await this.ensureInitialized()
        return this.enqueue(() => {
            const project = updateAssistantProject(this.requireDb(), input)
            this.scheduleFlush()
            return project
        })
    }

    async dismissProjectCandidate(input: AssistantDismissProjectCandidateInput): Promise<void> {
        await this.ensureInitialized()
        return this.enqueue(() => {
            dismissAssistantProjectCandidate(this.requireDb(), input)
            this.scheduleFlush()
        })
    }

    async ensureLegacyProjectForFolder(folderPath: string): Promise<AssistantProject> {
        if (this.isInternalProjectPath(folderPath)) throw new Error('Internal Zyra folders do not represent Projects.')
        await this.ensureInitialized()
        return this.enqueue(() => {
            const project = ensureLegacyAssistantProjectForFolder(this.requireDb(), folderPath, {
                projectHomesRoot: this.projectHomesRoot
            })
            this.scheduleFlush()
            return project
        })
    }

    async ensureProjectForFolder(folderPath: string): Promise<AssistantProject> {
        if (this.isInternalProjectPath(folderPath)) throw new Error('Zyra installation and internal workspace folders cannot become Projects.')
        await this.ensureInitialized()
        return this.enqueue(() => {
            const existing = findAssistantProjectByFolderPath(this.requireDb(), folderPath)
            if (existing) return existing
            const project = createAssistantProject(this.requireDb(), { folderPath }, {
                projectHomesRoot: this.projectHomesRoot,
                allowUnavailableFolder: true
            })
            this.scheduleFlush()
            return project
        })
    }

    async createProjectChatScope(projectId: string, workingRoot?: string | null): Promise<AssistantChatScope> {
        await this.ensureInitialized()
        return this.enqueue(() => createAssistantChatScopeForProject(
            this.requireDb(),
            projectId,
            workingRoot
        ))
    }

    async hydrateSelectedSession(snapshot: AssistantSnapshot, sessionId: string): Promise<AssistantSnapshot> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => hydrateSnapshotThreads(
            snapshot,
            sessionId,
            readHydratedThreadDetails(this.requireDb(), snapshot, sessionId)
        ))
    }

    async readThreadDetail(threadId: string): Promise<AssistantThreadDetail> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantThreadDetail(this.requireDb(), threadId))
    }

    async readTimelineProjectionRows(threadId: string) {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantTimelineProjectionRows(this.requireDb(), threadId))
    }

    async readActivity(threadId: string, activityId: string): Promise<AssistantActivity | null> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantActivity(this.requireDb(), threadId, activityId))
    }

    async readHistoryPage(input: AssistantGetHistoryPageInput): Promise<AssistantHistoryPage> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantHistoryPage(this.requireDb(), input))
    }

    async readHistoryAroundMessage(input: AssistantGetHistoryAroundMessageInput): Promise<AssistantHistoryAroundMessageResult> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantHistoryAroundMessage(this.requireDb(), input))
    }

    async readReviewIndex(threadId: string): Promise<AssistantReviewIndex> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantReviewIndex(this.requireDb(), threadId))
    }

    async projectCanonicalReviewTimeline(input: {
        threadId: string
        messages: AssistantMessage[]
        activities: AssistantActivity[]
        removedMessageIds?: string[]
        removedActivityIds?: string[]
    }): Promise<void> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        await this.enqueue(() => {
            upsertAssistantCanonicalTimelineProjection(this.requireDb(), input)
            this.scheduleFlush()
        })
    }

    async searchChats(input: AssistantSearchChatsInput): Promise<AssistantSearchChatsResult> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        if (this.databaseBackend === 'native') {
            if (!this.searchIndexAvailable) {
                throw new Error('Indexed chat search is unavailable.')
            }
            try {
                return await this.searchWorker.search(this.filePath, input)
            } catch (error) {
                log.warn('[AssistantPersistence] Worker-owned indexed chat search failed.', error)
                throw error
            }
        }
        return this.enqueue(() => searchAssistantChatsFallback(this.requireDb(), input))
    }

    async searchTurns(threadId: string, query: string, limit?: number): Promise<AssistantSearchTurnsResult> {
        await this.ensureInitialized()
        return this.enqueue(() => searchAssistantTurns(this.requireDb(), threadId, query, limit))
    }

    async mergeSearchTurnIds(threadId: string, existingTurnIds: string[], activityIds: string[], limit?: number): Promise<AssistantSearchTurnsResult> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => mergeAssistantSearchTurnIds(this.requireDb(), threadId, existingTurnIds, activityIds, limit))
    }

    async readTurnDetail(threadId: string, turnId: string): Promise<AssistantTurnDetail> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantTurnDetail(this.requireDb(), threadId, turnId))
    }

    async readFirstUserMessageText(sessionId: string): Promise<string | null> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantFirstUserMessageText(this.requireDb(), sessionId))
    }

    async readLatestUserMessageText(sessionId: string): Promise<string | null> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        await this.processPendingEvents()
        return this.enqueue(() => readAssistantLatestUserMessageText(this.requireDb(), sessionId))
    }

    async readSessionTurnUsage(sessionId: string): Promise<AssistantSessionTurnUsageEntry[]> {
        await this.ensureInitialized()
        return this.enqueue(() => readAssistantSessionTurnUsage(this.requireDb(), sessionId))
    }

    projectFleet(threadId: string, snapshot: FleetSnapshot): void {
        void this.enqueue(() => {
            projectFleetSnapshot(this.requireDb(), threadId, snapshot)
            this.scheduleFlush()
        }).catch((error) => {
            log.error('[AssistantPersistence] Failed to project fleet snapshot.', error)
        })
    }

    async readFleet(threadId: string): Promise<FleetSnapshot | null> {
        await this.ensureInitialized()
        return this.enqueue(() => readFleetSnapshot(this.requireDb(), threadId))
    }

    deleteFleet(threadId: string): void {
        void this.enqueue(() => {
            deleteFleetProjection(this.requireDb(), threadId)
            this.scheduleFlush()
        }).catch((error) => log.error('[AssistantPersistence] Failed to delete fleet projection.', error))
    }

    async flush(): Promise<void> {
        await this.ensureInitialized()
        this.clearPendingEventTimer()
        let lastPersistenceError: unknown = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await this.processPendingEvents()
                lastPersistenceError = null
                break
            } catch (error) {
                lastPersistenceError = error
                if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
            }
        }
        if (lastPersistenceError || this.pendingEvents.length > 0 || this.pendingProcessingPromise) {
            throw lastPersistenceError instanceof Error
                ? lastPersistenceError
                : new Error('Assistant persistence still has an uncommitted event batch.')
        }
        await this.enqueue(async () => {
            if (this.writeTimer) {
                clearTimeout(this.writeTimer)
                this.writeTimer = null
            }
            this.diskFlushDeferred = false
            await this.flushNow()
        })
    }

    async close(): Promise<void> {
        this.closing = true
        this.clearSearchBackfillTimer()
        this.clearSearchWorkerStartTimer()
        await this.flush()
        await this.searchWorker.dispose()
        await this.enqueue(() => {
            this.db?.close()
            this.db = null
        })
    }

    private projectMigrationOptions() {
        return {
            projectHomesRoot: this.projectHomesRoot,
            excludedLegacyProjectPaths: [...this.internalProjectPathKeys],
            globalWorkspaceRoot: this.globalWorkspaceRoot
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initPromise) return this.initPromise
        this.initPromise = this.initialize()
        return this.initPromise
    }

    private async initialize(): Promise<void> {
        try {
            const hadDatabase = existsSync(this.filePath)
            let SQL: Awaited<ReturnType<typeof initSqlJs>> | undefined
            if (shouldUseNativeAssistantPersistence()) {
                this.databaseBackend = 'native'
                const { openNativeAssistantDatabase } = await import('./native-sqlite-adapter')
                this.db = await openNativeAssistantDatabase(this.filePath)
            } else {
                this.databaseBackend = 'sqljs'
                SQL = await initSqlJs()
                const dbBytes = hadDatabase ? readFileSync(this.filePath) : null
                this.db = dbBytes ? new SQL.Database(dbBytes) : new SQL.Database()
            }
            initializeAssistantPersistenceSchema(this.requireDb())
            const projectMigration = migrateLegacyAssistantProjects(this.requireDb(), this.projectMigrationOptions())
            ensureAssistantProjectHomeDirectories(projectMigration.projectHomePaths)
            this.initializeSearchIndex()

            const storedVersion = hadDatabase ? readAssistantPersistenceVersion(this.requireDb()) : PERSISTENCE_VERSION
            if (shouldForceAssistantDbReset()) {
                log.warn('[AssistantPersistence] Forced dev assistant DB reset requested.')
                await this.rebuildDatabase({
                    sql: SQL,
                    backupReason: 'forced-reset',
                    importLegacyJson: false,
                    backupLegacyJson: true
                })
                return
            }

            if (hadDatabase && is.dev && storedVersion !== PERSISTENCE_VERSION) {
                log.warn(`[AssistantPersistence] Dev assistant DB version mismatch (${storedVersion ?? 'unknown'} -> ${PERSISTENCE_VERSION}). Resetting dev assistant database.`)
                await this.rebuildDatabase({
                    sql: SQL,
                    backupReason: `dev-v${storedVersion ?? 'unknown'}-to-v${PERSISTENCE_VERSION}`,
                    importLegacyJson: false,
                    backupLegacyJson: true
                })
                return
            }

            upsertAssistantMeta(this.requireDb(), 'persistenceVersion', String(PERSISTENCE_VERSION))

            if (!hadDatabase && existsSync(this.legacyFilePath)) {
                this.importLegacyJson()
                const importedProjectMigration = migrateLegacyAssistantProjects(this.requireDb(), this.projectMigrationOptions())
                ensureAssistantProjectHomeDirectories(importedProjectMigration.projectHomePaths)
                await this.flushNow()
            } else if (projectMigration.changed) {
                await this.flushNow()
            }
        } catch (error) {
            if (existsSync(this.filePath) && isRecoverableSqlitePersistenceError(error)) {
                log.warn('[AssistantPersistence] Corrupt SQLite persistence detected. Rebuilding assistant database.')
                log.debug('[AssistantPersistence] Corrupt SQLite initialize error:', error)
                await this.rebuildDatabase({
                    backupReason: 'corrupt',
                    importLegacyJson: true,
                    backupLegacyJson: false
                })
                return
            }
            log.error('[AssistantPersistence] Failed to initialize SQLite persistence.', error)
            throw error
        }
    }

    private importLegacyJson(): void {
        try {
            const raw = readFileSync(this.legacyFilePath, 'utf8')
            const parsed = JSON.parse(raw) as Partial<{ snapshot: AssistantSnapshot }>
            const snapshot = recoverPersistedSnapshot(parsed.snapshot || createDefaultSnapshot())
            replaceAssistantSnapshot(this.requireDb(), snapshot)
        } catch (error) {
            log.error('[AssistantPersistence] Failed to import legacy assistant JSON state.', error)
        }
    }

    private async rebuildDatabase(options: {
        sql?: Awaited<ReturnType<typeof initSqlJs>>
        backupReason: string
        importLegacyJson: boolean
        backupLegacyJson: boolean
    }): Promise<void> {
        this.clearSearchBackfillTimer()
        this.clearSearchWorkerStartTimer()
        await this.searchWorker.reset().catch(() => undefined)
        let closeError: unknown = null
        try {
            this.db?.close()
        } catch (error) {
            closeError = error
        }
        this.db = null

        const timestamp = Date.now()
        const backupPath = `${this.filePath}.${options.backupReason}-${timestamp}.bak`
        try {
            const preservedDatabaseFiles = backupAssistantDatabaseSet(this.filePath, backupPath)
            if (preservedDatabaseFiles.length > 0) log.warn(`[AssistantPersistence] Backed up assistant database set to ${backupPath}`)
            if (closeError) log.warn('[AssistantPersistence] Database close failed; the complete database/WAL set was preserved before recovery.', closeError)
        } catch (backupError) {
            log.error('[AssistantPersistence] Failed to back up the complete assistant database set.', backupError)
            throw backupError
        }

        if (options.backupLegacyJson && existsSync(this.legacyFilePath)) {
            const legacyBackupPath = `${this.legacyFilePath}.${options.backupReason}-${timestamp}.bak`
            try {
                renameSync(this.legacyFilePath, legacyBackupPath)
                log.warn(`[AssistantPersistence] Backed up assistant JSON snapshot to ${legacyBackupPath}`)
            } catch (backupError) {
                log.error('[AssistantPersistence] Failed to back up assistant JSON snapshot.', backupError)
                throw backupError
            }
        }

        if (this.databaseBackend === 'native') {
            const { openNativeAssistantDatabase } = await import('./native-sqlite-adapter')
            this.db = await openNativeAssistantDatabase(this.filePath)
        } else {
            const SQL = options.sql || await initSqlJs()
            this.db = new SQL.Database()
        }
        initializeAssistantPersistenceSchema(this.requireDb())
        this.initializeSearchIndex()
        upsertAssistantMeta(this.requireDb(), 'persistenceVersion', String(PERSISTENCE_VERSION))

        if (options.importLegacyJson && existsSync(this.legacyFilePath)) {
            this.importLegacyJson()
        }
        const projectMigration = migrateLegacyAssistantProjects(this.requireDb(), this.projectMigrationOptions())
        ensureAssistantProjectHomeDirectories(projectMigration.projectHomePaths)

        await this.flushNow()
    }

    private initializeSearchIndex(): void {
        this.searchIndexAvailable = initializeAssistantSearchIndex(this.requireDb())
        if (!this.searchIndexAvailable) return
        this.scheduleSearchBackfill()
        this.clearSearchWorkerStartTimer()
        this.searchWorkerStartTimer = setTimeout(() => {
            this.searchWorkerStartTimer = null
            if (!this.closing && this.searchIndexAvailable) this.searchWorker.start()
        }, 350)
        this.searchWorkerStartTimer.unref?.()
    }

    private scheduleSearchBackfill(delayMs = 25): void {
        if (this.closing || !this.searchIndexAvailable || this.searchBackfillTimer || this.searchBackfillPending) return
        this.searchBackfillTimer = setTimeout(() => {
            this.searchBackfillTimer = null
            this.searchBackfillPending = true
            let complete = false
            let nextDelayMs = 8
            void this.searchWorker.backfill(this.filePath).then((result) => {
                complete = result.complete
            }).catch((error) => {
                nextDelayMs = 2_000
                log.warn('[AssistantPersistence] Background chat search indexing paused after an error.', error)
            }).finally(() => {
                this.searchBackfillPending = false
                if (!complete) this.scheduleSearchBackfill(nextDelayMs)
            })
        }, delayMs)
        this.searchBackfillTimer.unref?.()
    }

    private clearSearchBackfillTimer(): void {
        if (!this.searchBackfillTimer) return
        clearTimeout(this.searchBackfillTimer)
        this.searchBackfillTimer = null
    }

    private clearSearchWorkerStartTimer(): void {
        if (!this.searchWorkerStartTimer) return
        clearTimeout(this.searchWorkerStartTimer)
        this.searchWorkerStartTimer = null
    }

    private schedulePendingEventProcessing(delayMs = PERSISTENCE_EVENT_BATCH_DELAY_MS): void {
        if (this.pendingEventTimer) return
        this.pendingEventTimer = setTimeout(() => {
            this.pendingEventTimer = null
            void this.processPendingEvents().catch((error) => {
                log.error('[AssistantPersistence] Failed to persist assistant event batch; retry remains queued.', error)
                this.schedulePendingEventProcessing(1_000)
            })
        }, delayMs)
        this.pendingEventTimer.unref?.()
    }

    private clearPendingEventTimer(): void {
        if (!this.pendingEventTimer) return
        clearTimeout(this.pendingEventTimer)
        this.pendingEventTimer = null
    }

    private processPendingEvents(): Promise<void> {
        if (this.pendingProcessingPromise) return this.pendingProcessingPromise
        if (this.pendingEvents.length === 0) return Promise.resolve()
        const pending = (async () => {
            while (this.pendingEvents.length > 0) {
                const eventsToPersist = coalesceAssistantPersistenceEvents(
                    this.pendingEvents.splice(0, this.pendingEvents.length)
                )
                try {
                    await this.enqueue(() => {
                        for (const entry of eventsToPersist) {
                            persistAssistantEvent(this.requireDb(), entry.event, entry.snapshot)
                        }
                        this.scheduleFlush()
                    })
                } catch (error) {
                    this.pendingEvents.unshift(...eventsToPersist)
                    try {
                        await this.writeFallbackSnapshot()
                    } catch (fallbackError) {
                        log.error('[AssistantPersistence] Failed to preserve fallback state after an event write error.', fallbackError)
                    }
                    throw error
                }
            }
        })().finally(() => {
            if (this.pendingProcessingPromise === pending) this.pendingProcessingPromise = null
        })
        this.pendingProcessingPromise = pending
        return pending
    }

    private scheduleFlush(): void {
        if (this.searchIndexAvailable && !this.closing) this.scheduleSearchBackfill(25)
        if (this.activeStreamingThreadIds.size > 0) {
            if (this.writeTimer) {
                clearTimeout(this.writeTimer)
                this.writeTimer = null
            }
            this.diskFlushDeferred = true
            return
        }

        this.diskFlushDeferred = false
        if (this.writeTimer) {
            clearTimeout(this.writeTimer)
        }
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null
            void this.enqueue(async () => {
                await this.flushNow()
            })
        }, PERSISTENCE_FLUSH_DEBOUNCE_MS)
        this.writeTimer.unref?.()
    }

    private async flushNow(): Promise<void> {
        const db = this.requireDb()
        let databaseWriteError: unknown = null

        if (this.databaseBackend === 'sqljs') {
            try {
                const bytes = Buffer.from(db.export())
                await writeFileAtomically(this.filePath, bytes)
            } catch (error) {
                databaseWriteError = error
                log.error('[AssistantPersistence] Failed to write SQLite assistant state.', error)
            }
        }

        try {
            await this.writeFallbackSnapshot()
        } catch (error) {
            log.error('[AssistantPersistence] Failed to write JSON assistant fallback state.', error)
        }
        if (databaseWriteError) throw databaseWriteError
    }

    private async writeFallbackSnapshot(): Promise<void> {
        const snapshot = this.fallbackSnapshotSource
            ? createAssistantFallbackSnapshot(this.fallbackSnapshotSource)
            : readAssistantPersistenceRecord(this.requireDb()).snapshot
        await writeFileAtomically(this.legacyFilePath, JSON.stringify({ snapshot }, null, 2))
    }

    private enqueue<T>(work: () => T | Promise<T>): Promise<T> {
        const nextOperation = this.operationQueue.then(work)
        this.operationQueue = nextOperation.then(() => undefined, () => undefined)
        return nextOperation
    }

    private requireDb(): SqlDatabase {
        if (!this.db) {
            throw new Error('Assistant SQLite database is not initialized.')
        }
        return this.db
    }
}
