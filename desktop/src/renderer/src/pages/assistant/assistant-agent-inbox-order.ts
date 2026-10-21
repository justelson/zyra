import { useSyncExternalStore } from 'react'

export const ASSISTANT_INBOX_ORDER_STORAGE_KEY = 'assistant-agent-inbox-order-v1'
export type AssistantInboxOrderGroup = 'pinned' | 'chats'
export type AssistantInboxOrder = Record<AssistantInboxOrderGroup, string[]>

type InboxSessionItem = { session: { id: string; createdAt: string } }

export function parseAssistantInboxOrder(raw: string | null): AssistantInboxOrder {
    try {
        const value: unknown = JSON.parse(raw || 'null')
        if (value && typeof value === 'object') {
            const stored = value as Partial<AssistantInboxOrder>
            const ids = (input: unknown): string[] => Array.isArray(input)
                ? [...new Set(input.filter((id): id is string => typeof id === 'string'))]
                : []
            return { pinned: ids(stored.pinned), chats: ids(stored.chats) }
        }
    } catch { /* An older or invalid value must not prevent sidebar loading. */ }
    return { pinned: [], chats: [] }
}

const listeners = new Set<() => void>()
let persistedRaw: string | null | undefined
let snapshot = { order: { pinned: [], chats: [] } as AssistantInboxOrder, revision: 0 }
function refreshOrder(): void {
    try {
        const raw = window.localStorage.getItem(ASSISTANT_INBOX_ORDER_STORAGE_KEY)
        if (raw === persistedRaw) return
        persistedRaw = raw
        const order = parseAssistantInboxOrder(raw)
        if (JSON.stringify(order) !== JSON.stringify(snapshot.order)) snapshot = { order, revision: snapshot.revision + 1 }
    } catch { /* Retain memory when storage is unavailable. */ }
}
export function getAssistantInboxOrderSnapshot() { refreshOrder(); return snapshot }
function publish() { for (const listener of listeners) listener() }
function onStorage(event: StorageEvent) {
    if (event.key === ASSISTANT_INBOX_ORDER_STORAGE_KEY || event.key === null) { refreshOrder(); publish() }
}
function subscribe(listener: () => void) {
    if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
        if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    }
}
/** Synchronous shared writer for UI and renderer agent operations. */
export function setAssistantInboxGroupOrder(group: AssistantInboxOrderGroup, ids: string[] | ((current: string[]) => string[]), options: { strict?: boolean } = {}): void {
    const current = getAssistantInboxOrderSnapshot().order
    const next = [...new Set(typeof ids === 'function' ? ids([...current[group]]) : ids)]
    if (JSON.stringify(next) === JSON.stringify(current[group])) return
    const order = { ...current, [group]: next }
    try {
        const raw = JSON.stringify(order)
        window.localStorage.setItem(ASSISTANT_INBOX_ORDER_STORAGE_KEY, raw)
        if (options.strict && window.localStorage.getItem(ASSISTANT_INBOX_ORDER_STORAGE_KEY) !== raw) throw new Error('Sidebar order could not be persisted.')
        persistedRaw = raw
    } catch (error) { if (options.strict) throw error }
    snapshot = { order, revision: snapshot.revision + 1 }
    publish()
}

/** Creation time and a deterministic tie-breaker, never status, selection or activity. */
export function compareAssistantInboxCreation(left: InboxSessionItem, right: InboxSessionItem): number {
    const timestamp = (value: string) => {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
    }
    return timestamp(right.session.createdAt) - timestamp(left.session.createdAt)
        || left.session.id.localeCompare(right.session.id)
}

/** Keep newly created chats ahead of an explicit order; activity never changes it. */
export function applyAssistantInboxOrder<T extends { session: { id: string } }>(items: readonly T[], order: readonly string[]): T[] {
    const byId = new Map(items.map(item => [item.session.id, item]))
    const orderedIds = new Set(order)
    return [
        ...items.filter(item => !orderedIds.has(item.session.id)),
        ...order.flatMap(id => {
            const item = byId.get(id)
            return item ? [item] : []
        })
    ]
}

/** Restore even an old chat above all current chats, retaining inactive saved IDs. */
export function restoreAssistantInboxItem(currentIds: readonly string[], savedIds: readonly string[], id: string): string[] {
    return [...new Set([id, ...currentIds, ...savedIds])]
}

/** Swap visible neighbors without changing the positions of other project chats. */
export function moveAssistantInboxItem(order: readonly string[], visibleIds: readonly string[], id: string, direction: -1 | 1): string[] {
    const visibleIndex = visibleIds.indexOf(id)
    const neighbor = visibleIndex < 0 ? undefined : visibleIds[visibleIndex + direction]
    const next = [...order]
    if (!neighbor) return next
    const from = next.indexOf(id)
    const to = next.indexOf(neighbor)
    const movingId = next[from]
    const neighborId = next[to]
    if (from >= 0 && to >= 0 && movingId !== undefined && neighborId !== undefined) {
        next[from] = neighborId
        next[to] = movingId
    }
    return next
}

/** Reorder only visible slots. Hidden Project and inactive saved slots stay in place. */
export function reorderAssistantInboxSlots(effectiveIds: readonly string[], savedIds: readonly string[], visibleIds: readonly string[], sessionId: string, targetId: string, placement: 'before' | 'after'): string[] {
    if (sessionId === targetId || !visibleIds.includes(sessionId) || !visibleIds.includes(targetId)) return [...savedIds]
    const moved = visibleIds.filter(id => id !== sessionId)
    moved.splice(moved.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, sessionId)
    const visible = new Set(visibleIds)
    let visibleIndex = 0
    const effective = effectiveIds.map(id => visible.has(id) ? moved[visibleIndex++]! : id)
    const active = new Set(effectiveIds)
    const saved = new Set(savedIds)
    const newCount = effectiveIds.filter(id => !saved.has(id)).length
    let index = newCount
    return [...effective.slice(0, newCount), ...savedIds.map(id => active.has(id) ? effective[index++]! : id)]
}

export function useAssistantInboxOrder() {
    const state = useSyncExternalStore(subscribe, getAssistantInboxOrderSnapshot, getAssistantInboxOrderSnapshot)
    return [state.order, setAssistantInboxGroupOrder] as const
}
