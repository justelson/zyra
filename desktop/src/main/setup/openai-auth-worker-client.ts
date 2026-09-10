import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveZyraRoot } from '../zyra/zyra-root'

type WorkerCallbacks = {
    onAuth?: (info: unknown) => void
    onProgress?: (progress: unknown) => void
}

type PendingRequest = WorkerCallbacks & {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout | null
}

type WorkerResponse = {
    type?: 'auth' | 'progress' | 'result' | 'error'
    id?: number
    info?: unknown
    progress?: unknown
    result?: unknown
    error?: string
}

function workerUrl(): URL {
    return pathToFileURL(join(resolveZyraRoot(), 'src', 'desktop-openai-auth-worker.mjs'))
}

export class OpenAIAuthWorkerClient {
    private worker: Worker | null = null
    private nextRequestId = 1
    private readonly pending = new Map<number, PendingRequest>()
    private warmPromise: Promise<void> | null = null

    constructor(private readonly createWorker: () => Worker = () => new Worker(workerUrl())) {}

    readonly sdk = {
        loginZyraAuth: (provider: string, options: Record<string, unknown> = {}) => this.request({
            operation: 'loginZyraAuth',
            provider
        }, {
            onAuth: typeof options.onAuth === 'function' ? options.onAuth as (info: unknown) => void : undefined,
            onProgress: typeof options.onProgress === 'function' ? options.onProgress as (progress: unknown) => void : undefined
        }),
        configureZyraOpenAIApiKey: (apiKey: string) => this.request({ operation: 'configureZyraOpenAIApiKey', apiKey }),
        verifyZyraOpenAIApiAuth: () => this.request({ operation: 'verifyZyraOpenAIApiAuth' }),
        getZyraAuthStatus: (provider: string) => this.request({ operation: 'getZyraAuthStatus', provider }),
        removeZyraAuth: (method: 'subscription' | 'api') => this.request({ operation: 'removeZyraAuth', method })
    }

    readonly providers = {
        disconnect: (provider: string) => this.request({ operation: 'disconnectModelProvider', provider }),
        connect: (input: unknown) => this.request({ operation: 'connectModelProvider', input }),
        list: () => this.request({ operation: 'listModelProviders' })
    }

    readonly account = {
        buildChatGptAccountStatus: (provider?: string, options?: { includeUsage?: boolean; refreshCredential?: boolean }) => this.request({
            operation: 'buildChatGptAccountStatus',
            provider,
            options
        }),
        resolveChatGptAccountAuth: () => this.request({ operation: 'resolveChatGptAccountAuth' }),
        fetchCodexResetCredits: () => this.request({ operation: 'fetchCodexResetCredits' })
    }

    warm(): Promise<void> {
        if (!this.warmPromise) {
            this.warmPromise = this.request({ operation: 'warm' })
                .then(() => undefined)
                .catch((error) => {
                    this.warmPromise = null
                    throw error
                })
        }
        return this.warmPromise
    }

    dispose(): Promise<number> {
        const worker = this.worker
        this.worker = null
        this.warmPromise = null
        this.rejectPending(new Error('OpenAI connection worker stopped.'))
        return worker ? worker.terminate() : Promise.resolve(0)
    }

    private request(message: Record<string, unknown>, callbacks: WorkerCallbacks = {}): Promise<any> {
        const worker = this.ensureWorker()
        const id = this.nextRequestId++
        const operation = String(message.operation || '')
        const timeoutMs = operation === 'connectModelProvider' ? 60_000 : operation === 'loginZyraAuth' ? 0 : operation === 'warm' ? 30_000 : 20_000
        return new Promise((resolve, reject) => {
            const timeout = timeoutMs > 0
                ? setTimeout(() => {
                    if (!this.pending.delete(id)) return
                    reject(new Error('Connection check timed out. Try again.'))
                }, timeoutMs)
                : null
            this.pending.set(id, { resolve, reject, timeout, ...callbacks })
            try {
                worker.postMessage({ ...message, id })
            } catch (error) {
                this.pending.delete(id)
                if (timeout) clearTimeout(timeout)
                reject(error instanceof Error ? error : new Error('Could not start the connection action.'))
            }
        })
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker
        const worker = this.createWorker()
        worker.unref()
        worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
        worker.on('error', (error) => {
            if (this.worker === worker) this.worker = null
            this.warmPromise = null
            this.rejectPending(error)
        })
        worker.on('exit', () => {
            const wasCurrent = this.worker === worker
            if (wasCurrent) this.worker = null
            this.warmPromise = null
            if (wasCurrent) this.rejectPending(new Error('OpenAI connection worker exited unexpectedly.'))
        })
        this.worker = worker
        return worker
    }

    private handleMessage(message: WorkerResponse) {
        if (!Number.isSafeInteger(message.id)) return
        const request = this.pending.get(message.id as number)
        if (!request) return
        if (message.type === 'auth') {
            request.onAuth?.(message.info)
            return
        }
        if (message.type === 'progress') {
            request.onProgress?.(message.progress)
            return
        }
        this.pending.delete(message.id as number)
        if (request.timeout) clearTimeout(request.timeout)
        if (message.type === 'result') request.resolve(message.result)
        else request.reject(new Error(message.error || 'OpenAI connection action failed.'))
    }

    private rejectPending(error: Error) {
        for (const request of this.pending.values()) {
            if (request.timeout) clearTimeout(request.timeout)
            request.reject(error)
        }
        this.pending.clear()
    }
}

let sharedOpenAIAuthWorker: OpenAIAuthWorkerClient | null = null

export function getSharedOpenAIAuthWorkerClient(): OpenAIAuthWorkerClient {
    if (!sharedOpenAIAuthWorker) sharedOpenAIAuthWorker = new OpenAIAuthWorkerClient()
    return sharedOpenAIAuthWorker
}
