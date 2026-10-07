import { Worker, type WorkerOptions } from 'node:worker_threads'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopTerminalEnvironment } from '../assistant/agent-server-namespace'
import { resolveZyraRoot } from '../zyra/zyra-root'
import type { ChatGptAccountsUpdate } from '../../shared/onboarding/contracts'

type WorkerCallbacks = {
    onAuth?: (info: unknown) => unknown
    onDeviceCode?: (info: unknown) => unknown
    onProgress?: (progress: unknown) => void
    signal?: AbortSignal
}

type PendingRequest = WorkerCallbacks & {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout | null
    abortHandler?: () => void
    operation: string
}

type WorkerResponse = {
    type?: 'auth' | 'deviceCode' | 'progress' | 'result' | 'error'
    id?: number
    info?: unknown
    progress?: unknown
    result?: unknown
    error?: string
    code?: string
}

function workerUrl(): URL {
    return pathToFileURL(join(resolveZyraRoot(), 'src', 'desktop-provider-worker.mjs'))
}

export function createDesktopProviderWorker(
    createWorker: (url: URL, options: WorkerOptions) => Worker = (url, options) => new Worker(url, options)
): Worker {
    const namespace = desktopTerminalEnvironment()
    if (!namespace.ZYRA_STATE_DIR) throw new Error('Desktop provider credential namespace is not configured.')
    return createWorker(workerUrl(), {
        env: { ...process.env, ...namespace }
    })
}

export class ProviderWorkerClient {
    private worker: Worker | null = null
    private nextRequestId = 1
    private readonly pending = new Map<number, PendingRequest>()
    private warmPromise: Promise<void> | null = null

    constructor(private readonly createWorker: () => Worker = () => createDesktopProviderWorker()) {}

    readonly sdk = {
        getChatGptAccounts: (options?: { refreshUsage?: boolean }) => this.request({ operation: 'getChatGptAccounts', options }),
        updateChatGptAccounts: (input: ChatGptAccountsUpdate) => this.request({ operation: 'updateChatGptAccounts', input }),
        loginZyraAuth: (provider: string, options: Record<string, unknown> = {}) => this.request({
            operation: 'loginZyraAuth',
            provider,
            signInMethod: options.signInMethod,
            accountId: options.accountId
        }, {
            onAuth: typeof options.onAuth === 'function' ? options.onAuth as (info: unknown) => unknown : undefined,
            onDeviceCode: typeof options.onDeviceCode === 'function' ? options.onDeviceCode as (info: unknown) => unknown : undefined,
            onProgress: typeof options.onProgress === 'function' ? options.onProgress as (progress: unknown) => void : undefined,
            signal: options.signal instanceof AbortSignal ? options.signal : undefined
        }),
        configureZyraOpenAIApiKey: (apiKey: string) => this.request({ operation: 'configureZyraOpenAIApiKey', apiKey }),
        verifyZyraOpenAIApiAuth: () => this.request({ operation: 'verifyZyraOpenAIApiAuth' }),
        getZyraAuthStatus: (provider: string) => this.request({ operation: 'getZyraAuthStatus', provider }),
        removeZyraAuth: (method: 'subscription' | 'api') => this.request({ operation: 'removeZyraAuth', method })
    }

    readonly providers = {
        delegationPreferences: () => this.request({ operation: 'readDelegationPreferences' }),
        saveDelegationPreferences: (input: unknown) => this.request({ operation: 'saveDelegationPreferences', input }),
        roleModels: () => this.request({ operation: 'readRoleModels' }),
        saveRoleModel: (input: unknown) => this.request({ operation: 'saveRoleModel', input }),
        disconnect: (provider: string) => this.request({ operation: 'disconnectModelProvider', provider }),
        connect: (input: unknown) => this.request({ operation: 'connectModelProvider', input }),
        list: () => this.request({ operation: 'listModelProviders' }),
        detectHarness: () => this.request({ operation: 'detectHarness' }),
        connectHarness: (input: unknown) => this.request({ operation: 'connectHarness', input })
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
        this.rejectPending(new Error('Provider connection worker stopped.'))
        return worker ? worker.terminate() : Promise.resolve(0)
    }

    private request(message: Record<string, unknown>, callbacks: WorkerCallbacks = {}): Promise<any> {
        if (callbacks.signal?.aborted) return Promise.reject(callbacks.signal.reason)
        const worker = this.ensureWorker()
        const id = this.nextRequestId++
        const operation = String(message.operation || '')
        const timeoutMs = operation === 'connectModelProvider' || operation === 'connectHarness' ? 60_000 : operation === 'loginZyraAuth' ? 0 : operation === 'warm' ? 30_000 : 20_000
        return new Promise((resolve, reject) => {
            const timeout = timeoutMs > 0
                ? setTimeout(() => {
                    const request = this.pending.get(id)
                    if (!request) return
                    this.clearRequest(id, request)
                    reject(new Error('Connection check timed out. Try again.'))
                }, timeoutMs)
                : null
            const request: PendingRequest = { resolve, reject, timeout, operation, ...callbacks }
            this.pending.set(id, request)
            try {
                worker.postMessage({ ...message, id })
                if (callbacks.signal) {
                    request.abortHandler = () => {
                        try {
                            worker.postMessage({ operation: 'cancelRequest', targetId: id })
                        } catch (error) {
                            this.rejectRequest(id, request, error)
                        }
                    }
                    callbacks.signal.addEventListener('abort', request.abortHandler, { once: true })
                    if (callbacks.signal.aborted) request.abortHandler()
                }
            } catch (error) {
                this.clearRequest(id, request)
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
            if (wasCurrent) this.rejectPending(new Error('Provider connection worker exited unexpectedly.'))
        })
        this.worker = worker
        return worker
    }

    private handleMessage(message: WorkerResponse) {
        if (!Number.isSafeInteger(message.id)) return
        const id = message.id as number
        const request = this.pending.get(id)
        if (!request) return
        if (message.type === 'auth' || message.type === 'deviceCode' || message.type === 'progress') {
            if (request.signal?.aborted) return
            try {
                if (message.type === 'auth') void Promise.resolve(request.onAuth?.(message.info)).catch((error) => this.rejectRequest(id, request, error))
                else if (message.type === 'deviceCode') void Promise.resolve(request.onDeviceCode?.(message.info)).catch((error) => this.rejectRequest(id, request, error))
                else request.onProgress?.(message.progress)
            } catch (error) {
                this.rejectRequest(id, request, error)
            }
            return
        }
        this.clearRequest(id, request)
        if (message.type === 'result') request.resolve(message.result)
        else request.reject(Object.assign(new Error(message.error || 'OpenAI connection action failed.'), { code: message.code }))
    }

    private rejectRequest(id: number, request: PendingRequest, error: unknown) {
        if (this.pending.get(id) !== request) return
        this.clearRequest(id, request)
        if (request.operation === 'loginZyraAuth') {
            try { this.worker?.postMessage({ operation: 'cancelRequest', targetId: id }) } catch { }
        }
        request.reject(error instanceof Error ? error : new Error('OpenAI connection action failed.'))
    }

    private clearRequest(id: number, request: PendingRequest) {
        this.pending.delete(id)
        if (request.timeout) clearTimeout(request.timeout)
        if (request.abortHandler) request.signal?.removeEventListener('abort', request.abortHandler)
    }

    private rejectPending(error: Error) {
        for (const [id, request] of this.pending) {
            this.clearRequest(id, request)
            request.reject(error)
        }
    }
}

let sharedProviderWorker: ProviderWorkerClient | null = null

export function getSharedProviderWorkerClient(): ProviderWorkerClient {
    if (!sharedProviderWorker) sharedProviderWorker = new ProviderWorkerClient()
    return sharedProviderWorker
}
