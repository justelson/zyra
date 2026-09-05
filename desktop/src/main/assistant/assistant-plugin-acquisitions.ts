import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import catalog from '../../shared/plugins/openai-directory.json'
import type { AssistantPluginDownload, AssistantPluginInspection } from '../../shared/assistant/contracts'
import { resolveZyraRoot } from '../zyra/zyra-root'

type Entry = typeof catalog.entries[number]
export type PluginDownloader = (input: { stagingRoot: string; entry: Entry; commit: string; signal: AbortSignal }) => Promise<{ packageRoot: string; sourceLocator: string }>
type Operation = { id: string; owner: number; controller: AbortController; state: AssistantPluginDownload; work: Promise<void>; timer: ReturnType<typeof setTimeout>; packageRoot?: string }
const REVIEW_LIFETIME_MS = 5 * 60_000

async function assertUnlinkedStorage(storagePath: string): Promise<void> {
    for (let current = resolve(storagePath); ; current = dirname(current)) {
        try {
            const info = await lstat(current)
            if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Plugin download storage must use ordinary directories.')
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (dirname(current) === current) break
    }
}

async function download(input: Parameters<PluginDownloader>[0]) {
    const module = await import(/* @vite-ignore */ pathToFileURL(join(resolveZyraRoot(), 'src/plugins/plugin-download.mjs')).href)
    return module.downloadCatalogPlugin(input)
}

export class AssistantPluginAcquisitions {
    private readonly operations = new Map<string, Operation>()
    private initializing: Promise<void> | null = null
    private disposed = false
    constructor(private readonly options: {
        rootPath: string
        inspect: (packageRoot: string, entry: Entry, locator: string, owner: number) => Promise<AssistantPluginInspection>
        discardReview: (reviewId: string) => void
        download?: PluginDownloader
        lifetimeMs?: number
    }) {}

    initialize(): Promise<void> {
        this.initializing ??= (async () => {
            await assertUnlinkedStorage(this.options.rootPath)
            await mkdir(this.options.rootPath, { recursive: true })
            if ((await lstat(this.options.rootPath)).isSymbolicLink()) throw new Error('Plugin download storage cannot be a link.')
            for (const entry of await readdir(this.options.rootPath)) await rm(join(this.options.rootPath, entry), { recursive: true, force: true })
        })()
        return this.initializing
    }

    async start(name: string, owner: number): Promise<AssistantPluginDownload> {
        await this.initialize()
        if (this.disposed) throw new Error('Plugin downloads are shutting down.')
        if (!Number.isSafeInteger(owner) || owner < 1) throw new Error('Plugin downloads require a Desktop owner.')
        const entry = catalog.entries.find(entry => entry.name === name)
        if (!entry || !entry.hasSkills || entry.installation === 'BLOCKED') throw new Error('This Plugin cannot be installed from the catalog.')
        if (this.operations.size >= 16 || [...this.operations.values()].filter(op => op.state.status === 'downloading').length >= 2) throw new Error('Finish or cancel the current Plugin downloads first.')
        if ([...this.operations.values()].some(op => op.owner === owner)) throw new Error('Finish or cancel your current Plugin review first.')
        const id = randomUUID()
        const operation: Operation = {
            id, owner, controller: new AbortController(), state: { id, status: 'downloading' }, work: Promise.resolve(),
            timer: setTimeout(() => { void this.cancel(id, owner).catch(() => undefined) }, this.options.lifetimeMs ?? REVIEW_LIFETIME_MS)
        }
        operation.timer.unref?.()
        this.operations.set(id, operation)
        operation.work = this.prepare(operation, entry)
        return structuredClone(operation.state)
    }

    get(id: string, owner: number): AssistantPluginDownload {
        const op = this.owned(id, owner)
        return structuredClone(op.state)
    }

    private owned(id: string, owner: number): Operation {
        const op = this.operations.get(id)
        if (!op || op.owner !== owner) throw new Error('Plugin download is missing or expired. Try again.')
        return op
    }

    private async prepare(op: Operation, entry: Entry): Promise<void> {
        try {
            const result = await (this.options.download || download)({ stagingRoot: this.options.rootPath, entry, commit: catalog.commit, signal: op.controller.signal })
            const localPath = relative(resolve(this.options.rootPath), resolve(result.packageRoot))
            if (!localPath || isAbsolute(localPath) || localPath.startsWith('..') || /[\\/]/.test(localPath)) throw new Error('Invalid Plugin download location.')
            op.packageRoot = result.packageRoot
            op.controller.signal.throwIfAborted()
            const inspection = await this.options.inspect(result.packageRoot, entry, result.sourceLocator, op.owner)
            if (op.controller.signal.aborted) { this.options.discardReview(inspection.reviewId); op.controller.signal.throwIfAborted() }
            op.state = { id: op.id, status: 'ready', inspection }
            clearTimeout(op.timer)
            const remaining = Math.max(1, Math.min(this.options.lifetimeMs ?? REVIEW_LIFETIME_MS, Date.parse(inspection.expiresAt) - Date.now()))
            op.timer = setTimeout(() => { void this.cancel(op.id, op.owner).catch(() => undefined) }, remaining)
            op.timer.unref?.()
        } catch (error) {
            op.state = { id: op.id, status: 'failed', error: op.controller.signal.aborted ? 'Plugin download cancelled.' : error instanceof Error ? error.message : 'Could not download this Plugin.' }
            await this.removePackage(op)
        }
    }

    // Installation takes ownership of the bytes. Cancellation/expiry can no longer
    // remove the source during exact-digest verification and activation.
    takeReview(reviewId: string, owner: number | undefined): (() => Promise<void>) | null {
        const op = [...this.operations.values()].find(op => op.state.status === 'ready' && op.state.inspection?.reviewId === reviewId)
        if (!op) return null
        if (op.owner !== owner) throw new Error('Plugin review belongs to another Desktop window.')
        this.operations.delete(op.id)
        clearTimeout(op.timer)
        return () => this.removePackage(op)
    }

    async cancel(id: string, owner: number): Promise<void> {
        const op = this.owned(id, owner)
        op.controller.abort()
        clearTimeout(op.timer)
        await op.work
        if (op.state.inspection) this.options.discardReview(op.state.inspection.reviewId)
        await this.removePackage(op)
        this.operations.delete(op.id)
    }

    async cancelOwner(owner: number): Promise<void> {
        await Promise.all([...this.operations.values()].filter(op => op.owner === owner).map(op => this.cancel(op.id, owner).catch(() => undefined)))
    }

    async dispose(): Promise<void> {
        this.disposed = true
        await Promise.all([...this.operations.values()].map(op => this.cancel(op.id, op.owner).catch(() => undefined)))
    }

    private async removePackage(op: Operation): Promise<void> {
        if (op.packageRoot) await rm(op.packageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
}
