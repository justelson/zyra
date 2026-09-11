/** Local bounded diagnostics. Never include paths, prompts, credentials or response text. */
export type PerformanceSample = { area: 'editor' | 'inspector' | 'stream'; stage: string; elapsedMs: number; count?: number }
const samples: PerformanceSample[] = []
const MAX_SAMPLES = 120
export function recordPerformanceSample(sample: PerformanceSample): void {
    if (!Number.isFinite(sample.elapsedMs)) return
    samples.push({ ...sample, elapsedMs: Math.max(0, Math.round(sample.elapsedMs * 10) / 10) })
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
}
export function readPerformanceSamples(): readonly PerformanceSample[] { return samples.map(sample => ({ ...sample })) }
export function startEditorMeasurement(now = () => performance.now()) {
    const started = now()
    const completed = new Set<string>()
    const mark = (stage: 'readable' | 'interactive') => {
        if (completed.has(stage)) return
        completed.add(stage)
        recordPerformanceSample({ area: 'editor', stage, elapsedMs: now() - started })
    }
    return { readable: () => mark('readable'), interactive: () => { mark('readable'); mark('interactive') } }
}
export function recordStreamQueue(events: readonly { occurredAt: string }[], now = Date.now()): void {
    const oldest = events.reduce((value, event) => { const time = Date.parse(event.occurredAt); return Number.isFinite(time) ? Math.min(value, time) : value }, now)
    recordPerformanceSample({ area: 'stream', stage: 'queue-flush', count: events.length, elapsedMs: now - oldest })
}
