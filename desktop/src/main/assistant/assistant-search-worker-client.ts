import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AssistantSearchChatsInput, AssistantSearchChatsResult } from '../../shared/assistant/contracts'
import { resolveZyraRoot } from '../zyra/zyra-root'

const SEARCH_TIMEOUT_MS = 5_000

export type AssistantSearchBackfillResult = { complete: boolean; indexed: number }

type WorkerResult = AssistantSearchChatsResult | AssistantSearchBackfillResult | null

type PendingRequest = {
    resolve: (value: WorkerResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}

type WorkerResponse = {
    id?: number
    type?: 'result' | 'error'
    result?: WorkerResult
    error?: string
}

function workerUrl(): URL {
    return pathToFileURL(join(resolveZyraRoot(), 'src', 'desktop-assistant-search-worker.mjs'))
}

export class AssistantSearchWorkerClient {
    private worker: Worker | null = null
    private nextRequestId = 1
    private readonly pending = new Map<number, PendingRequest>()

    start(): void {
        this.ensureWorker()
    }

    search(databasePath: string, input: AssistantSearchChatsInput): Promise<AssistantSearchChatsResult> {
        return this.request({ operation: 'search', databasePath, input }).then((result) => {
            if (!result || !('matches' in result)) throw new Error('Assistant search worker returned no search result.')
            return result
        })
    }

    backfill(databasePath: string): Promise<AssistantSearchBackfillResult> {
        return this.request({ operation: 'backfill', databasePath }, 30_000).then((result) => {
            if (!result || !('indexed' in result)) throw new Error('Assistant search worker returned no backfill result.')
            return result
        })
    }

    async reset(): Promise<void> {
        if (!this.worker) return
        await this.request({ operation: 'reset' }).then(() => undefined)
    }

    async dispose(): Promise<void> {
        const worker = this.worker
        this.worker = null
        this.rejectPending(new Error('Assistant search worker stopped.'))
        if (worker) await worker.terminate().catch(() => 0)
    }

    private request(message: Record<string, unknown>, timeoutMs = SEARCH_TIMEOUT_MS): Promise<WorkerResult> {
        const worker = this.ensureWorker()
        const id = this.nextRequestId++
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this.pending.delete(id)) return
                reject(new Error('Chat search timed out.'))
            }, timeoutMs)
            timeout.unref?.()
            this.pending.set(id, { resolve, reject, timeout })
            try {
                worker.postMessage({ ...message, id })
            } catch (error) {
                this.pending.delete(id)
                clearTimeout(timeout)
                reject(error instanceof Error ? error : new Error('Could not start chat search.'))
            }
        })
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker
        const worker = new Worker(workerUrl())
        worker.unref()
        worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
        worker.on('error', (error) => this.handleWorkerFailure(worker, error))
        worker.on('exit', (code) => {
            if (this.worker !== worker) return
            this.handleWorkerFailure(worker, new Error(`Assistant search worker exited with code ${code}.`))
        })
        this.worker = worker
        return worker
    }

    private handleMessage(message: WorkerResponse): void {
        if (!Number.isSafeInteger(message.id)) return
        const id = message.id as number
        const request = this.pending.get(id)
        if (!request) return
        this.pending.delete(id)
        clearTimeout(request.timeout)
        if (message.type === 'result') request.resolve(message.result || null)
        else request.reject(new Error(message.error || 'Chat search failed.'))
    }

    private handleWorkerFailure(worker: Worker, error: Error): void {
        if (this.worker === worker) this.worker = null
        this.rejectPending(error)
    }

    private rejectPending(error: Error): void {
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout)
            request.reject(error)
        }
        this.pending.clear()
    }
}
