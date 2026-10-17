/** Resolved evidence wins over stale pending aliases during identity repair. */
export function mergeAssistantRequests<T extends { id: string; requestId: string; createdAt: string; status: 'pending' | 'resolved'; resolvedAt: string | null }>(preferred: T[], fallback: T[]): T[] {
    const ordered = [...fallback, ...preferred].sort((left, right) => Number(left.status === 'resolved') - Number(right.status === 'resolved')
        || (left.resolvedAt || left.createdAt).localeCompare(right.resolvedAt || right.createdAt))
    return ordered.reduce<T[]>((items, incoming) => upsertAssistantRequest(items, incoming), [])
}

/** A recovered request can keep its durable ID while gaining a new runtime ID.
 * Replace both aliases together so replay cannot leave two visible questions. */
export function upsertAssistantRequest<T extends { id: string; requestId: string; createdAt: string }>(items: T[], incoming: T): T[] {
    const matches = (item: T) => item.id === incoming.id || item.requestId === incoming.requestId
    const index = items.findIndex(matches)
    if (index < 0) return [...items, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (items[index] === incoming && !items.slice(index + 1).some(matches)) return items
    return items.flatMap((item, position) => position === index ? [incoming] : matches(item) ? [] : [item])
}
