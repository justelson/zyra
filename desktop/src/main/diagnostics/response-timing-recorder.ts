import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantRuntimeEvent } from '../../shared/assistant/contracts'
import type { AnalyticsEventInput } from '../../shared/analytics/contracts'
import { responseTimingModel, responseTimingEffort, responseTimingNow, type ResponseTimingRecord, type ResponseTimingOutcome } from '../../shared/response-timing'
import { writeBytesAtomically } from '../setup/atomic-json'

export const RESPONSE_TIMING_STORAGE_LIMIT = 2 * 1024 * 1024
const MAX_RECORDS = 200
const MAX_REQUESTS = 32
const MAX_ACTIVE = 64
const MAX_DURATION = 24 * 60 * 60_000
type Active = { row: ResponseTimingRecord; threadId?: string; requestId?: string; compactionAt?: number; retries: Set<string> }
type TimingStart = { turnId: string; threadId?: string; model: string; effort?: string; submittedAt?: number; receivedAt: number }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^(?:assistant-turn-[a-z0-9-]+|[a-z0-9_-]{1,80})$/i.test(value) && value.length <= 120
const duration = (value: number) => Math.round(Math.max(0, Math.min(MAX_DURATION, value)))

/** Always local. The optional capture callback uses the existing consent owner. */
export class ResponseTimingRecorder {
    private readonly records = new Map<string, ResponseTimingRecord>()
    private readonly active = new Map<string, Active>()
    private readonly summaries = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly ready: Promise<void>
    private writeTimer: ReturnType<typeof setTimeout> | null = null
    private lastWriteAt = 0
    private writes: Promise<void> = Promise.resolve()
    private readonly file: string

    constructor(directory: string, private readonly capture: (input: AnalyticsEventInput<'zyra_v1_response_timing'>) => void = () => {}, private readonly now = responseTimingNow) {
        this.file = join(directory, 'response-timings.json')
        this.ready = this.load()
    }

    start(input: TimingStart): void {
        if (!identifier(input.turnId) || this.records.has(input.turnId)) return
        const submitted = typeof input.submittedAt === 'number' && Number.isFinite(input.submittedAt)
            && input.submittedAt <= input.receivedAt && input.receivedAt - input.submittedAt < 30 * 60_000
            ? input.submittedAt : input.receivedAt
        const row: ResponseTimingRecord = { turnId: input.turnId, startedAt: submitted,
            model: responseTimingModel(input.model), effort: responseTimingEffort(input.effort), outcome: 'running',
            mainReceivedMs: duration(input.receivedAt - submitted), dispatchMs: null, acceptedMs: null,
            firstEventMs: null, firstTextMs: null, firstTextReceivedMs: null, firstDisplayMs: null, completedMs: null,
            requestCount: 0, retryCount: 0, compactionCount: 0, compactionMs: 0, maxStreamingGapMs: null,
            stallCount: 0, mainStallMs: 0, rendererStallMs: 0, maxStallMs: 0, requests: [] }
        this.records.set(row.turnId, row)
        this.active.set(row.turnId, { row, threadId: input.threadId, retries: new Set() })
        if (this.active.size > MAX_ACTIVE) this.finish(this.active.keys().next().value!, 'unfinished')
        this.scheduleWrite(true)
    }

    dispatch(turnId: string): void {
        const row = this.active.get(turnId)?.row
        if (row) { row.dispatchMs ??= duration(this.now() - row.startedAt); this.scheduleWrite(true) }
    }

    configure(turnId: string, threadId: string, model: string, effort: unknown): void {
        const state = this.active.get(turnId)
        if (!state) return
        state.threadId = threadId
        state.row.model = responseTimingModel(model)
        state.row.effort = responseTimingEffort(effort)
    }

    observe(event: AssistantRuntimeEvent): void {
        const state = event.turnId ? this.active.get(event.turnId) : undefined
        if (!state) return
        const { row } = state
        const at = this.now()
        const elapsed = duration(at - row.startedAt)
        if (event.type === 'turn.started') {
            if (event.payload.model) row.model = responseTimingModel(event.payload.model)
            if (event.payload.effort) row.effort = responseTimingEffort(event.payload.effort)
        }
        if (event.type === 'turn.accepted') row.acceptedMs ??= elapsed
        if (event.type === 'model.progress') {
            const p = event.payload.progress
            if (!p) {
                const request = row.requests.at(-1)
                if (request && state.requestId) request.durationMs = duration(at - row.startedAt - request.startedMs)
                state.requestId = undefined
            } else {
                if (state.requestId !== p.requestId) {
                    state.requestId = p.requestId
                    row.requestCount++
                    row.requests.push({ startedMs: duration(p.startedAt - row.startedAt), firstEventMs: null, firstTextMs: null, lastEventMs: null, durationMs: null, maxGapMs: null })
                    if (row.requests.length > MAX_REQUESTS) row.requests.shift()
                }
                const request = row.requests.at(-1)!
                if (p.phase === 'streaming') request.lastEventMs = duration(p.lastActivityAt - p.startedAt)
                if (p.maxActivityGapMs !== undefined) {
                    request.maxGapMs = Math.max(request.maxGapMs ?? 0, p.maxActivityGapMs)
                    row.maxStreamingGapMs = Math.max(row.maxStreamingGapMs ?? 0, request.maxGapMs)
                }
                if (p.firstEventAt !== undefined) {
                    request.firstEventMs ??= duration(p.firstEventAt - p.startedAt)
                    row.firstEventMs ??= duration(p.firstEventAt - row.startedAt)
                }
                if (p.firstTextAt !== undefined) {
                    request.firstTextMs ??= duration(p.firstTextAt - p.startedAt)
                    row.firstTextMs ??= duration(p.firstTextAt - row.startedAt)
                }
            }
            this.scheduleWrite()
        }
        if ((event.type === 'content.delta' && event.payload.streamKind === 'assistant_text' && (event.payload.delta || event.payload.replaceText))
            || (event.type === 'content.completed' && event.payload.streamKind === 'assistant_text' && event.payload.text)) {
            if (row.firstTextReceivedMs === null) { row.firstTextReceivedMs = elapsed; this.scheduleWrite(true) }
        }
        if (event.type === 'activity') {
            const status = event.payload.data?.['status']
            if (event.payload.kind === 'context.compaction' && event.payload.data?.['replay'] !== true) {
                if (status === 'running' && state.compactionAt === undefined) { state.compactionAt = at; row.compactionCount++ }
                else if (status !== 'running' && state.compactionAt !== undefined) { row.compactionMs += duration(at - state.compactionAt); state.compactionAt = undefined }
            }
            if (['connection.recovery', 'provider.recovery', 'model.ping'].includes(event.payload.kind) && status === 'retrying') {
                const key = `${event.payload.activityId}:${event.payload.data?.['attempt'] || ''}`
                if (!state.retries.has(key)) { row.retryCount++; state.retries.add(key); if (state.retries.size > 64) state.retries.delete(state.retries.values().next().value!) }
            }
            this.scheduleWrite()
        }
        if (event.type === 'turn.completed') this.finish(row.turnId, event.payload.outcome === 'completed' ? 'completed' : event.payload.outcome === 'failed' ? 'failed' : 'cancelled')
    }

    displayed(input: unknown): boolean {
        if (!input || typeof input !== 'object') return false
        const { turnId, at } = input as { turnId?: unknown; at?: unknown }
        if (!identifier(turnId) || typeof at !== 'number' || !Number.isFinite(at)) return false
        const row = this.records.get(turnId)
        if (!row || row.firstTextReceivedMs === null || row.firstDisplayMs !== null || at < row.startedAt + row.firstTextReceivedMs - 10 || at > this.now() + 1000 || at - row.startedAt > MAX_DURATION) return false
        row.firstDisplayMs = duration(at - row.startedAt)
        this.scheduleWrite(true)
        return true
    }

    recordStall(incident: { reason: string; processKind: 'main' | 'renderer' | 'other'; durationMs?: number }, selectedThreadId?: string | null): void {
        // High CPU is an alert, not proof that the UI was blocked.
        if (!/event-loop-stall|long-task|heartbeat-stalled|renderer-unresponsive/.test(incident.reason)) return
        const ms = typeof incident.durationMs === 'number' && Number.isFinite(incident.durationMs) ? duration(incident.durationMs) : 0
        let changed = false
        for (const state of this.active.values()) {
            if (incident.processKind !== 'main' && (!selectedThreadId || selectedThreadId !== state.threadId)) continue
            state.row.stallCount++
            changed = true
            if (incident.processKind === 'main') state.row.mainStallMs += ms
            else state.row.rendererStallMs += ms
            state.row.maxStallMs = Math.max(state.row.maxStallMs, ms)
        }
        if (changed) this.scheduleWrite(true)
    }

    finish(turnId: string, outcome: Exclude<ResponseTimingOutcome, 'running'>): void {
        const state = this.active.get(turnId)
        if (!state) return
        const { row } = state
        row.outcome = outcome
        row.completedMs = duration(this.now() - row.startedAt)
        if (state.compactionAt !== undefined) row.compactionMs += duration(this.now() - state.compactionAt)
        this.active.delete(turnId)
        this.scheduleWrite(true)
        // Let an already queued display acknowledgement arrive before the one
        // opt-in summary. A hidden/offscreen response retains a missing value.
        const timer = setTimeout(() => { this.summaries.delete(turnId); this.captureSummary(row) }, 1500)
        timer.unref?.()
        this.summaries.set(turnId, timer)
    }

    async read(): Promise<{ records: ResponseTimingRecord[]; storageLimitBytes: number }> {
        await this.ready
        return { records: structuredClone(this.recent()), storageLimitBytes: RESPONSE_TIMING_STORAGE_LIMIT }
    }

    async flush(): Promise<void> {
        if (this.writeTimer) clearTimeout(this.writeTimer)
        this.writeTimer = null
        await this.ready
        this.queueWrite()
        await this.writes
    }

    async dispose(): Promise<void> {
        for (const [id, timer] of this.summaries) { clearTimeout(timer); const row = this.records.get(id); if (row) this.captureSummary(row) }
        this.summaries.clear()
        await this.flush()
    }

    private recent(): ResponseTimingRecord[] {
        const running = [...this.active.values()].map(state => state.row)
        const settled = [...this.records.values()].filter(row => !this.active.has(row.turnId))
            .sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RECORDS - running.length)
        return [...running, ...settled].sort((a, b) => b.startedAt - a.startedAt)
    }

    private captureSummary(row: ResponseTimingRecord): void {
        const properties = { model_name: row.model, effort: row.effort,
            outcome: row.outcome as Exclude<ResponseTimingOutcome, 'running'>, request_count: row.requestCount, retry_count: row.retryCount,
            compaction_count: row.compactionCount, compaction_ms: row.compactionMs,
            stall_count: row.stallCount, main_stall_ms: row.mainStallMs, renderer_stall_ms: row.rendererStallMs, max_stall_ms: row.maxStallMs,
            ...Object.fromEntries(Object.entries({ main_received_ms: row.mainReceivedMs, dispatch_ms: row.dispatchMs, accepted_ms: row.acceptedMs,
                first_event_ms: row.firstEventMs, first_text_ms: row.firstTextMs, first_text_received_ms: row.firstTextReceivedMs,
                first_display_ms: row.firstDisplayMs, duration_ms: row.completedMs, max_streaming_gap_ms: row.maxStreamingGapMs }).filter(([, value]) => value !== null)) }
        try { this.capture({ event: 'zyra_v1_response_timing', properties }) } catch { /* Diagnostics cannot affect a turn. */ }
    }

    private async load(): Promise<void> {
        try {
            if ((await stat(this.file)).size > RESPONSE_TIMING_STORAGE_LIMIT) return
            const raw = await readFile(this.file)
            if (raw.byteLength > RESPONSE_TIMING_STORAGE_LIMIT) return
            const rows: unknown = JSON.parse(raw.toString('utf8'))
            if (!Array.isArray(rows)) return
            // Only restore our own allowlisted shape, never arbitrary log data.
            for (const input of rows.slice(0, MAX_RECORDS)) {
                if (!input || !identifier(input.turnId) || !Number.isFinite(input.startedAt) || !Array.isArray(input.requests)) continue
                const row = sanitizeStoredRecord(input)
                if (row && !this.records.has(row.turnId)) this.records.set(row.turnId, row)
            }
        } catch { /* Missing/corrupt diagnostics must not block startup. */ }
    }

    private scheduleWrite(urgent = false): void {
        if (this.writeTimer && !urgent) return
        if (this.writeTimer) clearTimeout(this.writeTimer)
        const wait = urgent ? 200 : Math.max(1000, 10_000 - (this.now() - this.lastWriteAt))
        this.writeTimer = setTimeout(() => { this.writeTimer = null; void this.ready.then(() => this.queueWrite()) }, wait)
        this.writeTimer.unref?.()
        // Completed rows have bounded retention even in a long-lived process.
        const keep = new Set(this.recent().map(row => row.turnId))
        for (const key of this.records.keys()) if (!keep.has(key) && !this.active.has(key) && !this.summaries.has(key)) this.records.delete(key)
    }

    private queueWrite(): void {
        this.lastWriteAt = this.now()
        const data = JSON.stringify(this.recent())
        if (Buffer.byteLength(data) > RESPONSE_TIMING_STORAGE_LIMIT) return
        this.writes = this.writes.then(async () => {
            await writeBytesAtomically(this.file, data)
        }).catch(() => undefined)
    }
}

function sanitizeStoredRecord(input: ResponseTimingRecord): ResponseTimingRecord {
    const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? duration(value) : null
    return {
        turnId: input.turnId, startedAt: input.startedAt, model: responseTimingModel(input.model), effort: responseTimingEffort(input.effort),
        outcome: input.outcome === 'completed' || input.outcome === 'failed' || input.outcome === 'cancelled' ? input.outcome : 'unfinished',
        mainReceivedMs: number(input.mainReceivedMs) ?? 0, dispatchMs: number(input.dispatchMs), acceptedMs: number(input.acceptedMs),
        firstEventMs: number(input.firstEventMs), firstTextMs: number(input.firstTextMs), firstTextReceivedMs: number(input.firstTextReceivedMs),
        firstDisplayMs: number(input.firstDisplayMs), completedMs: number(input.completedMs), requestCount: number(input.requestCount) ?? 0,
        retryCount: number(input.retryCount) ?? 0, compactionCount: number(input.compactionCount) ?? 0,
        compactionMs: number(input.compactionMs) ?? 0, maxStreamingGapMs: number(input.maxStreamingGapMs),
        stallCount: number(input.stallCount) ?? 0, mainStallMs: number(input.mainStallMs) ?? 0,
        rendererStallMs: number(input.rendererStallMs) ?? 0, maxStallMs: number(input.maxStallMs) ?? 0,
        requests: input.requests.slice(-MAX_REQUESTS).filter(value => value && typeof value === 'object').map(value => ({
            startedMs: number(value.startedMs) ?? 0, firstEventMs: number(value.firstEventMs), firstTextMs: number(value.firstTextMs),
            lastEventMs: number(value.lastEventMs),
            durationMs: number(value.durationMs), maxGapMs: number(value.maxGapMs)
        }))
    }
}
