import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
    AssistantChatPluginScope,
    AssistantCreatePluginChatInput,
    AssistantInspectLocalPluginInput,
    AssistantInstallInspectedPluginInput,
    AssistantPluginCatalog,
    AssistantPluginInspection,
    AssistantPluginScopeDiff,
    AssistantPluginSkillSource,
    AssistantRefreshChatPluginScopeInput,
    AssistantSetPluginSetInput
} from '../../shared/assistant/contracts'
import { resolveZyraRoot } from '../zyra/zyra-root'
import { AssistantPluginAcquisitions, type PluginDownloader } from './assistant-plugin-acquisitions'

const PLUGIN_REVIEW_TTL_MS = 5 * 60_000
const MAX_PENDING_PLUGIN_REVIEWS = 32

type PluginPackageInspection = {
    packageRoot: string
    manifest: AssistantPluginInspection['manifest']
    release: Omit<AssistantPluginInspection['release'], never>
}

type CorePluginRegistry = {
    initialize(): Promise<void>
    getCatalog(): Promise<AssistantPluginCatalog>
    inspectLocalPackage(packageRoot: string, options?: { expectedName?: string }): Promise<PluginPackageInspection>
    installLocalPackage(input: {
        packageRoot: string
        expectedName?: string
        sourceId?: string
        sourceKind?: string
        sourceLabel?: string
        sourceLocator?: string
        approved: true
        approvedDigest: string
    }): Promise<unknown>
    setEnabledPlugins(input: AssistantSetPluginSetInput): Promise<unknown>
    createChatScope(input: { sessionId: string; projectId?: string | null; inherit?: boolean; selection?: AssistantCreatePluginChatInput }): Promise<AssistantChatPluginScope>
    ensureLegacyChatScopes(entries: Array<{ sessionId: string; projectId?: string | null }>): Promise<{ created: number }>
    refreshChatScope(input: { sessionId: string; projectId?: string | null; inherit?: boolean }): Promise<{ scope: AssistantChatPluginScope; diff: AssistantPluginScopeDiff }>
    removeChatScope(sessionId: string): Promise<boolean>
    getChatScope(sessionId: string): Promise<AssistantChatPluginScope | null>
    getChatSkillSources(sessionId: string, options?: { verify?: boolean }): Promise<AssistantPluginSkillSource[]>
    setPluginState(pluginId: string, state: 'active' | 'disabled'): Promise<unknown>
    rollbackPlugin(input: { pluginId: string; releaseId: string; approved: true }): Promise<unknown>
}

type CorePluginModule = {
    ZyraPluginRegistry: new (options: { rootPath: string }) => CorePluginRegistry
}

type PendingPluginReview = {
    id: string
    expiresAt: number
    packageRoot: string
    expectedName?: string
    sourceId?: string
    sourceKind?: string
    sourceLabel?: string
    contentDigest: string
    inspection: AssistantPluginInspection
    ownerId?: number
    sourceLocator?: string
}

let corePluginModulePromise: Promise<CorePluginModule> | null = null

async function loadCorePluginModule(): Promise<CorePluginModule> {
    corePluginModulePromise ??= import(
        /* @vite-ignore */ pathToFileURL(join(resolveZyraRoot(), 'src', 'plugins', 'plugin-registry.mjs')).href
    ) as Promise<CorePluginModule>
    return corePluginModulePromise
}

function bounded(value: unknown, limit: number): string {
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function reviewInspection(inspection: PluginPackageInspection, reviewId: string, expiresAt: number): AssistantPluginInspection {
    return {
        reviewId,
        expiresAt: new Date(expiresAt).toISOString(),
        manifest: structuredClone(inspection.manifest),
        release: structuredClone(inspection.release)
    }
}

export class AssistantPluginRegistry {
    private readonly rootPath: string
    private readonly now: () => number
    private readonly reviewTtlMs: number
    private registryPromise: Promise<CorePluginRegistry> | null = null
    private readonly pendingReviews = new Map<string, PendingPluginReview>()
    readonly acquisitions: AssistantPluginAcquisitions

    constructor(options: { rootPath: string; now?: () => number; reviewTtlMs?: number; download?: PluginDownloader }) {
        if (!options.rootPath) throw new Error('AssistantPluginRegistry requires an installation-specific rootPath.')
        this.rootPath = options.rootPath
        this.now = options.now || Date.now
        this.reviewTtlMs = Math.max(1, Math.min(PLUGIN_REVIEW_TTL_MS, Math.trunc(options.reviewTtlMs || PLUGIN_REVIEW_TTL_MS)))
        this.acquisitions = new AssistantPluginAcquisitions({
            rootPath: join(this.rootPath, 'acquisitions'),
            download: options.download,
            inspect: (packageRoot, entry, locator, ownerId) => this.inspectLocalPlugin({
                packagePath: packageRoot, expectedName: entry.name,
                sourceId: `openai-catalog:${entry.name}`, sourceKind: 'official', sourceLabel: 'OpenAI Plugin catalog'
            }, ownerId, locator),
            discardReview: (reviewId) => { this.pendingReviews.delete(reviewId) }
        })
    }

    async initialize(): Promise<void> {
        await this.registry()
        await this.acquisitions.initialize()
    }

    async getCatalog(): Promise<AssistantPluginCatalog> {
        return this.registry().then((registry) => registry.getCatalog())
    }

    async inspectLocalPlugin(input: AssistantInspectLocalPluginInput, ownerId?: number, sourceLocator?: string): Promise<AssistantPluginInspection> {
        this.pruneReviews()
        const packagePath = bounded(input.packagePath, 4_096)
        if (!packagePath) throw new Error('Choose a Plugin package folder.')
        const registry = await this.registry()
        const inspected = await registry.inspectLocalPackage(packagePath, {
            ...(input.expectedName ? { expectedName: bounded(input.expectedName, 64) } : {})
        })
        const reviewId = randomUUID()
        const expiresAt = this.now() + this.reviewTtlMs
        const inspection = reviewInspection(inspected, reviewId, expiresAt)
        this.pendingReviews.set(reviewId, {
            id: reviewId,
            expiresAt,
            packageRoot: inspected.packageRoot,
            expectedName: input.expectedName ? bounded(input.expectedName, 64) : undefined,
            sourceId: input.sourceId ? bounded(input.sourceId, 128) : undefined,
            sourceKind: input.sourceKind,
            sourceLabel: input.sourceLabel ? bounded(input.sourceLabel, 120) : undefined,
            contentDigest: inspected.release.contentDigest,
            ownerId,
            sourceLocator,
            inspection
        })
        this.trimReviews()
        return structuredClone(inspection)
    }

    async installInspectedPlugin(input: AssistantInstallInspectedPluginInput, ownerId?: number): Promise<{ success: true; catalog: AssistantPluginCatalog }> {
        this.pruneReviews()
        const reviewId = bounded(input.reviewId, 128)
        const review = this.pendingReviews.get(reviewId)
        if (review?.ownerId !== undefined && review.ownerId !== ownerId) throw new Error('Plugin review belongs to another Desktop window.')
        const cleanup = this.acquisitions.takeReview(reviewId, ownerId)
        this.pendingReviews.delete(reviewId)
        try {
            if (input.confirmed !== true || !review || review.expiresAt <= this.now()) {
                throw new Error('Plugin install review is missing or expired. Inspect the package again.')
            }
            const registry = await this.registry()
            await registry.installLocalPackage({
                packageRoot: review.packageRoot,
                expectedName: review.expectedName,
                sourceId: review.sourceId,
                sourceKind: review.sourceKind,
                sourceLabel: review.sourceLabel,
                sourceLocator: review.sourceLocator,
                approved: true,
                approvedDigest: review.contentDigest
            })
            return { success: true, catalog: await registry.getCatalog() }
        } finally { await cleanup?.() }
    }

    async setPluginSet(input: AssistantSetPluginSetInput): Promise<{ success: true; catalog: AssistantPluginCatalog }> {
        const registry = await this.registry()
        await registry.setEnabledPlugins({
            projectId: bounded(input.projectId, 192) || null,
            pluginIds: Array.isArray(input.pluginIds) ? input.pluginIds.map((id) => bounded(id, 128)) : [],
            expectedRevision: input.expectedRevision
        })
        return { success: true, catalog: await registry.getCatalog() }
    }

    async createChatScope(sessionId: string, projectId?: string | null, inherit = true, selection?: AssistantCreatePluginChatInput): Promise<AssistantChatPluginScope> {
        return this.registry().then((registry) => registry.createChatScope({ sessionId, projectId, inherit, selection }))
    }

    async ensureLegacyChatScope(sessionId: string, projectId?: string | null): Promise<AssistantChatPluginScope> {
        const registry = await this.registry()
        const existing = await registry.getChatScope(sessionId)
        return existing || registry.createChatScope({ sessionId, projectId, inherit: false })
    }

    async ensureLegacyChatScopes(entries: Array<{ sessionId: string; projectId?: string | null }>): Promise<void> {
        await (await this.registry()).ensureLegacyChatScopes(entries)
    }

    async refreshChatScope(input: AssistantRefreshChatPluginScopeInput, projectId?: string | null): Promise<{
        success: true
        scope: AssistantChatPluginScope
        diff: AssistantPluginScopeDiff
    }> {
        const result = await (await this.registry()).refreshChatScope({
            sessionId: bounded(input.sessionId, 192),
            projectId
        })
        return { success: true, ...result }
    }

    async resetChatScope(sessionId: string, projectId?: string | null): Promise<AssistantChatPluginScope> {
        const result = await (await this.registry()).refreshChatScope({ sessionId, projectId, inherit: false })
        return result.scope
    }

    async removeChatScope(sessionId: string): Promise<void> {
        await (await this.registry()).removeChatScope(sessionId)
    }

    async getChatScope(sessionId: string): Promise<AssistantChatPluginScope | null> {
        return this.registry().then((registry) => registry.getChatScope(sessionId))
    }

    async getChatSkillSources(sessionId: string): Promise<AssistantPluginSkillSource[]> {
        return this.registry().then((registry) => registry.getChatSkillSources(sessionId))
    }

    async setPluginState(pluginId: string, state: 'active' | 'disabled'): Promise<{ success: true; catalog: AssistantPluginCatalog }> {
        const registry = await this.registry()
        await registry.setPluginState(pluginId, state)
        return { success: true, catalog: await registry.getCatalog() }
    }

    async rollbackPlugin(pluginId: string, releaseId: string, confirmed: boolean): Promise<{ success: true; catalog: AssistantPluginCatalog }> {
        if (!confirmed) throw new Error('Plugin rollback requires confirmation.')
        const registry = await this.registry()
        await registry.rollbackPlugin({ pluginId, releaseId, approved: true })
        return { success: true, catalog: await registry.getCatalog() }
    }

    async dispose(): Promise<void> {
        await this.acquisitions.dispose()
        this.pendingReviews.clear()
    }

    private async registry(): Promise<CorePluginRegistry> {
        this.registryPromise ??= loadCorePluginModule().then(async ({ ZyraPluginRegistry }) => {
            const registry = new ZyraPluginRegistry({ rootPath: this.rootPath })
            await registry.initialize()
            return registry
        })
        return this.registryPromise
    }

    private pruneReviews(): void {
        const now = this.now()
        for (const [id, review] of this.pendingReviews) {
            if (review.expiresAt <= now) this.pendingReviews.delete(id)
        }
    }

    private trimReviews(): void {
        while (this.pendingReviews.size > MAX_PENDING_PLUGIN_REVIEWS) {
            const oldest = this.pendingReviews.keys().next().value as string | undefined
            if (!oldest) break
            this.pendingReviews.delete(oldest)
        }
    }
}
