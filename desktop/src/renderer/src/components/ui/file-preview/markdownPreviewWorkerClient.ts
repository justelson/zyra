import type { Root } from 'hast'

type MarkdownWorkerResponse =
    | { type: 'ready' }
    | { type: 'parsed'; id: number; tree: Root }
    | { type: 'error'; id: number; error: string }

type ParseConsumer = {
    id: number
    resolve: (tree: Root | null) => void
}

type ParseJob = {
    id: number
    cacheKey: string
    queueKey: string
    content: string
    headingIds: readonly string[]
    urgent: boolean
    attempts: number
    consumers: Map<number, ParseConsumer>
}

type ParsedTreeCacheEntry = { content: string; tree: Root; estimatedBytes: number }
export type MarkdownPreviewParseRequest = {
    promise: Promise<Root | null>
    cancel: () => void
}

const MAX_PARSED_TREE_CACHE_ENTRIES = 128
const MAX_PARSED_TREE_CACHE_BYTES = 24 * 1024 * 1024
const MARKDOWN_PARSE_WORKER_IDLE_TTL_MS = 20_000
const parsedTreeCache = new Map<string, ParsedTreeCacheEntry>()
let parsedTreeCacheBytes = 0

let worker: Worker | null = null
let workerReady = false
let workerUnavailable = false
let requestSequence = 0
let consumerSequence = 0
let inFlightJob: ParseJob | null = null
let parseWatchdogTimer: number | null = null
let workerIdleTimer: number | null = null
const urgentParseQueue = new Map<string, ParseJob>()
const normalParseQueue = new Map<string, ParseJob>()

function contentFingerprint(content: string): string {
    let hash = 2166136261
    for (let index = 0; index < content.length; index += 1) {
        hash ^= content.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `${content.length}:${(hash >>> 0).toString(36)}`
}

function touchParsedTree(cacheKey: string, entry: ParsedTreeCacheEntry): Root {
    parsedTreeCache.delete(cacheKey)
    parsedTreeCache.set(cacheKey, entry)
    return entry.tree
}

function parsedSectionCacheKey(content: string, headingIds: readonly string[] = []): string {
    return `${contentFingerprint(content)}|${headingIds.join('\u001f')}`
}

export function readCachedMarkdownPreviewSection(content: string, headingIds: readonly string[] = []): Root | null {
    const cacheKey = parsedSectionCacheKey(content, headingIds)
    const cached = parsedTreeCache.get(cacheKey)
    return cached?.content === content ? touchParsedTree(cacheKey, cached) : null
}

function estimateTreeBytes(tree: Root, content: string): number {
    let nodes = 0
    let propertyCharacters = 0
    const visitNode = (node: Root['children'][number]) => {
        nodes += 1
        if (node.type === 'text' || node.type === 'comment' || node.type === 'raw') propertyCharacters += node.value.length
        if (node.type === 'element') {
            propertyCharacters += node.tagName.length
            propertyCharacters += JSON.stringify(node.properties || {}).length
            for (const child of node.children) visitNode(child as Root['children'][number])
        }
    }
    for (const child of tree.children) visitNode(child)
    return (content.length + propertyCharacters) * 2 + nodes * 80
}

function retainParsedTree(key: string, content: string, tree: Root): void {
    const previous = parsedTreeCache.get(key)
    if (previous) parsedTreeCacheBytes -= previous.estimatedBytes
    const estimatedBytes = estimateTreeBytes(tree, content)
    if (estimatedBytes > MAX_PARSED_TREE_CACHE_BYTES) return
    parsedTreeCache.delete(key)
    parsedTreeCache.set(key, { content, tree, estimatedBytes })
    parsedTreeCacheBytes += estimatedBytes
    while (parsedTreeCache.size > MAX_PARSED_TREE_CACHE_ENTRIES || parsedTreeCacheBytes > MAX_PARSED_TREE_CACHE_BYTES) {
        const oldest = parsedTreeCache.entries().next().value as [string, ParsedTreeCacheEntry] | undefined
        if (!oldest) break
        parsedTreeCache.delete(oldest[0])
        parsedTreeCacheBytes -= oldest[1].estimatedBytes
    }
}

export function cacheMarkdownPreviewSection(content: string, tree: Root, headingIds: readonly string[] = []): void {
    retainParsedTree(parsedSectionCacheKey(content, headingIds), content, tree)
}

function resolveJob(job: ParseJob, tree: Root | null): void {
    for (const consumer of job.consumers.values()) consumer.resolve(tree)
    job.consumers.clear()
}

function clearQueuedJobs(): void {
    for (const job of urgentParseQueue.values()) resolveJob(job, null)
    for (const job of normalParseQueue.values()) resolveJob(job, null)
    urgentParseQueue.clear()
    normalParseQueue.clear()
}

function clearParseWatchdog(): void {
    if (parseWatchdogTimer !== null && typeof window !== 'undefined') window.clearTimeout(parseWatchdogTimer)
    parseWatchdogTimer = null
}

function clearWorkerIdleTimer(): void {
    if (workerIdleTimer !== null && typeof window !== 'undefined') window.clearTimeout(workerIdleTimer)
    workerIdleTimer = null
}

function scheduleWorkerIdleTermination(): void {
    if (!worker || inFlightJob || urgentParseQueue.size > 0 || normalParseQueue.size > 0 || workerIdleTimer !== null) return
    workerIdleTimer = window.setTimeout(() => {
        workerIdleTimer = null
        if (inFlightJob || urgentParseQueue.size > 0 || normalParseQueue.size > 0) return
        worker?.terminate()
        worker = null
        workerReady = false
    }, MARKDOWN_PARSE_WORKER_IDLE_TTL_MS)
}

function restartWorkerForUrgentWork(): void {
    clearParseWatchdog()
    clearWorkerIdleTimer()
    worker?.terminate()
    worker = null
    workerReady = false
    inFlightJob = null
    warmMarkdownPreviewWorker()
}

function disableWorker(): void {
    clearParseWatchdog()
    clearWorkerIdleTimer()
    workerUnavailable = true
    workerReady = false
    worker?.terminate()
    worker = null
    if (inFlightJob) resolveJob(inFlightJob, null)
    inFlightJob = null
    clearQueuedJobs()
}

function dequeueNextJob(): ParseJob | null {
    const urgent = urgentParseQueue.entries().next().value as [string, ParseJob] | undefined
    if (urgent) {
        urgentParseQueue.delete(urgent[0])
        return urgent[1]
    }
    const normal = normalParseQueue.entries().next().value as [string, ParseJob] | undefined
    if (!normal) return null
    normalParseQueue.delete(normal[0])
    return normal[1]
}

function pumpParseQueue(): void {
    if (!worker || !workerReady || inFlightJob) return
    let next = dequeueNextJob()
    while (next && next.consumers.size === 0) next = dequeueNextJob()
    if (!next) {
        scheduleWorkerIdleTermination()
        return
    }
    clearWorkerIdleTimer()
    inFlightJob = next
    worker.postMessage({ type: 'parse', id: next.id, content: next.content, allowRawHtml: true, headingIds: next.headingIds })
    parseWatchdogTimer = window.setTimeout(() => {
        if (inFlightJob !== next) return
        clearParseWatchdog()
        worker?.terminate()
        worker = null
        workerReady = false
        inFlightJob = null
        if (next.consumers.size > 0 && next.attempts < 1) {
            next.attempts += 1
            ;(next.urgent ? urgentParseQueue : normalParseQueue).set(next.queueKey, next)
        } else {
            resolveJob(next, null)
        }
        warmMarkdownPreviewWorker()
    }, 15_000)
}

function findPendingJob(queueKey: string): ParseJob | null {
    if (inFlightJob?.queueKey === queueKey) return inFlightJob
    return urgentParseQueue.get(queueKey) || normalParseQueue.get(queueKey) || null
}

function promoteJob(job: ParseJob): void {
    if (job.urgent || inFlightJob === job) return
    job.urgent = true
    if (normalParseQueue.get(job.queueKey) === job) normalParseQueue.delete(job.queueKey)
    urgentParseQueue.delete(job.queueKey)
    urgentParseQueue.set(job.queueKey, job)
}

export function warmMarkdownPreviewWorker(): void {
    clearWorkerIdleTimer()
    if (worker || workerUnavailable || typeof window === 'undefined' || typeof Worker === 'undefined') {
        if (worker && workerReady) scheduleWorkerIdleTermination()
        return
    }
    try {
        worker = new Worker(new URL('./markdown-preview.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
            const response = event.data
            if (response.type === 'ready') {
                workerReady = true
                pumpParseQueue()
                return
            }
            const job = inFlightJob
            if (!job || response.id !== job.id) return
            clearParseWatchdog()
            inFlightJob = null
            if (response.type === 'parsed') {
                if (job.consumers.size > 0) retainParsedTree(job.cacheKey, job.content, response.tree)
                resolveJob(job, response.tree)
            } else {
                resolveJob(job, null)
            }
            pumpParseQueue()
        }
        worker.onerror = (event) => {
            console.error('Markdown preview worker failed.', event.message, event.filename, event.lineno)
            disableWorker()
        }
        worker.onmessageerror = disableWorker
        worker.postMessage({ type: 'warm' })
    } catch {
        disableWorker()
    }
}

export function requestMarkdownPreviewSection(
    content: string,
    urgent: boolean,
    headingIds: readonly string[] = []
): MarkdownPreviewParseRequest {
    const cachedTree = readCachedMarkdownPreviewSection(content, headingIds)
    if (cachedTree) return { promise: Promise.resolve(cachedTree), cancel: () => undefined }

    warmMarkdownPreviewWorker()
    if (!worker) return { promise: Promise.resolve(null), cancel: () => undefined }

    const cacheKey = parsedSectionCacheKey(content, headingIds)
    const queueKey = cacheKey
    if (urgent && inFlightJob && inFlightJob.queueKey !== queueKey && inFlightJob.consumers.size === 0) {
        restartWorkerForUrgentWork()
    }
    let job = findPendingJob(queueKey)
    if (!job) {
        requestSequence += 1
        job = {
            id: requestSequence,
            cacheKey,
            queueKey,
            content,
            headingIds: [...headingIds],
            urgent,
            attempts: 0,
            consumers: new Map()
        }
        ;(urgent ? urgentParseQueue : normalParseQueue).set(job.queueKey, job)
    } else if (urgent) {
        promoteJob(job)
    }

    consumerSequence += 1
    const consumerId = consumerSequence
    let settled = false
    const promise = new Promise<Root | null>((resolve) => {
        job?.consumers.set(consumerId, {
            id: consumerId,
            resolve: (tree) => {
                if (settled) return
                settled = true
                resolve(tree)
            }
        })
    })
    clearWorkerIdleTimer()
    pumpParseQueue()

    return {
        promise,
        cancel: () => {
            if (settled || !job) return
            job.consumers.get(consumerId)?.resolve(null)
            job.consumers.delete(consumerId)
            if (job === inFlightJob || job.consumers.size > 0) return
            urgentParseQueue.delete(job.queueKey)
            normalParseQueue.delete(job.queueKey)
            scheduleWorkerIdleTermination()
        }
    }
}

/** Compatibility wrapper for non-virtual callers. */
export function parseMarkdownPreviewSection(content: string): Promise<Root | null> {
    return requestMarkdownPreviewSection(content, true).promise
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        clearParseWatchdog()
        clearWorkerIdleTimer()
        worker?.terminate()
        worker = null
        workerReady = false
    })
}
