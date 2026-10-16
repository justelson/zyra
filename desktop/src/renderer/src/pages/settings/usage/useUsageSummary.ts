import { useCallback, useEffect, useState } from 'react'
import type { UsageSummary, UsageSummaryInput, UsageRange } from '@shared/assistant/usage-summary'

const cache = new Map<string, { value: UsageSummary; at: number }>()
const pending = new Map<string, Promise<UsageSummary>>()
export async function fetchUsageSummary(input: UsageSummaryInput, force = false): Promise<UsageSummary> {
    const key = JSON.stringify(input)
    const saved = cache.get(key)
    if (!force && saved && Date.now() - saved.at < (saved.value.sources?.some(source => source.state === 'indexing') ? 2_000 : 30_000)) return saved.value
    const existing = pending.get(key)
    if (existing) return existing
    let timer: ReturnType<typeof setTimeout>
    const request = Promise.race([
        window.devscope.assistant.getUsageSummary(input).then(result => {
            if (!result.success) throw new Error(result.error || 'Could not read usage.')
            return result.summary
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Usage took too long to load. Try refreshing.')), 20_000) })
    ]).then(value => {
        cache.set(key, { value, at: Date.now() })
        if (cache.size > 12) cache.delete(cache.keys().next().value!)
        return value
    }).finally(() => { clearTimeout(timer); pending.delete(key) })
    pending.set(key, request)
    return request
}
export function useUsageSummary(days: UsageRange, harness: UsageSummaryInput['harness'] = 'zyra', active = true) {
    const [summary, setSummary] = useState<UsageSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)
    const refresh = useCallback(() => setRevision(value => value + 1), [])
    useEffect(() => {
        if (!active) { setLoading(false); return }
        let disposed = false
        let running = false
        let lastLoadedAt = 0
        let indexing = false
        const input = { days, harness, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        setSummary(cache.get(JSON.stringify(input))?.value || null)
        const load = async (force = false) => {
            if (running) return
            running = true; setLoading(true); setError(null)
            try { const value = await fetchUsageSummary(input, force); if (!disposed) { setSummary(value); indexing = !!value.sources?.some(source => source.state === 'indexing'); lastLoadedAt = Date.now() } }
            catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : 'Could not read usage.') }
            finally { running = false; if (!disposed) setLoading(false) }
        }
        void load(revision > 0)
        const visible = () => { if (document.visibilityState === 'visible' && (indexing || Date.now()-lastLoadedAt >= 60_000)) void load() }
        const interval = setInterval(visible, 3_000)
        window.addEventListener('focus', visible)
        document.addEventListener('visibilitychange', visible)
        return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
    }, [days, harness, revision, active])
    return { summary, loading, error, refresh }
}
