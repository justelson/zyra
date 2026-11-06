import type { ResponseTimingRecord } from '@shared/response-timing'

export type ResponseTimingSort = 'newest' | 'oldest' | 'first-text' | 'visible'
export const RESPONSE_TIMING_SORTS: ReadonlyArray<{ value: ResponseTimingSort; label: string }> = [
    { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
    { value: 'first-text', label: 'Slowest first text' }, { value: 'visible', label: 'Slowest visible text' }
]

export const formatResponseTiming = (value: number | null) => value === null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`

export function sortResponseTimings(records: readonly ResponseTimingRecord[], sort: ResponseTimingSort) {
    return [...records].sort((a, b) => {
        if (sort === 'oldest') return a.startedAt - b.startedAt
        if (sort === 'newest') return b.startedAt - a.startedAt
        const key = sort === 'first-text' ? 'firstTextReceivedMs' : 'firstDisplayMs'
        // Missing observations stay last, including in slowest-first views.
        return (b[key] ?? -1) - (a[key] ?? -1) || b.startedAt - a.startedAt
    })
}

function median(values: Array<number | null>) {
    const observed = values.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    const middle = Math.floor(observed.length / 2)
    return { value: observed.length ? observed.length % 2 ? observed[middle] : (observed[middle - 1] + observed[middle]) / 2 : null, count: observed.length }
}

export function summarizeResponseTimings(records: readonly ResponseTimingRecord[]) {
    const recent = sortResponseTimings(records, 'newest').filter(row => row.outcome === 'completed').slice(0, 20)
    return {
        total: records.length, completed: records.filter(row => row.outcome === 'completed').length,
        running: records.filter(row => row.outcome === 'running').length,
        sampled: recent.length,
        firstText: median(recent.map(row => row.firstTextReceivedMs)),
        visible: median(recent.map(row => row.firstDisplayMs))
    }
}
