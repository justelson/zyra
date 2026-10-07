import type { ChatGptAccountProfile, ChatGptAccountUsageWindow, ChatGptRoutingPolicy } from '@shared/onboarding/contracts'

export type ChatGptUsageGroup = { key: string; label: string; entries: { account: ChatGptAccountProfile; window: ChatGptAccountUsageWindow | null }[] }
export function usagePeriodLabel(seconds: number | null, fallback: string) {
    if (!seconds) return fallback
    if (seconds === 604800) return 'Weekly'
    if (seconds % 86400 === 0) return `${seconds / 86400}-day`
    if (seconds % 3600 === 0) return `${seconds / 3600}-hour`
    return `${Math.ceil(seconds / 60)}-minute`
}
export function currentUsedPercent(window: ChatGptAccountUsageWindow, now = Date.now()) {
    return window.resetAt && Date.parse(window.resetAt) <= now ? 0 : Math.min(100, Math.max(0, window.usedPercent))
}
export function isUsageAccountAllowed(account: ChatGptAccountProfile, policy: ChatGptRoutingPolicy) {
    return account.enabled && account.state !== 'needs-sign-in' && (policy.accountMode === 'all' || policy.accountIds.includes(account.id))
}
export function groupChatGptUsage(accounts: ChatGptAccountProfile[], now = Date.now()): ChatGptUsageGroup[] {
    const groups = new Map<string, ChatGptUsageGroup>()
    for (const account of accounts) {
        const windows = [account.usage?.primary, account.usage?.secondary]
        const reported = windows.some(Boolean)
        for (const [index, window] of (reported ? windows : [null]).entries()) {
            if (reported && !window) continue
            const key = window?.windowSeconds ? String(window.windowSeconds) : reported ? `unknown-${index}` : 'unavailable'
            const label = window ? usagePeriodLabel(window.windowSeconds, index === 0 ? 'Primary window' : 'Secondary window') : 'Usage'
            const group = groups.get(key) || { key, label, entries: [] }
            const duplicate = group.entries.find(entry => entry.account.id === account.id)
            if (duplicate?.window && window) {
                // If two constraints have the same duration, show the tighter one once.
                if (currentUsedPercent(window, now) > currentUsedPercent(duplicate.window, now)) duplicate.window = window
            } else group.entries.push({ account, window: window || null })
            groups.set(key, group)
        }
    }
    return [...groups.values()].sort((a, b) => (Number(a.key) || Infinity) - (Number(b.key) || Infinity))
}
export function summarizeUsageGroup(group: ChatGptUsageGroup, policy: ChatGptRoutingPolicy, now = Date.now()) {
    const allowed = group.entries.filter(entry => isUsageAccountAllowed(entry.account, policy))
    const known = allowed.filter((entry): entry is typeof entry & { window: ChatGptAccountUsageWindow } => entry.window !== null)
    // Capacity is not reported, so this is a per-account average, never a pooled quota.
    const averageUsed = known.length ? known.reduce((sum, entry) => sum + currentUsedPercent(entry.window, now), 0) / known.length : null
    const resets = known.map(entry => entry.window.resetAt ? Date.parse(entry.window.resetAt) : NaN).filter(reset => Number.isFinite(reset) && reset > now)
    return { averageUsed, count: known.length, allowedCount: allowed.length, nextReset: resets.length ? Math.min(...resets) : null }
}
