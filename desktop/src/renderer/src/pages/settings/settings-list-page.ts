export function paginateSettingsItems<T>(items: readonly T[], requestedPage: number, pageSize = 12) {
    const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize) || 12) : 12
    const pageCount = Math.max(1, Math.ceil(items.length / size))
    const page = Math.min(pageCount - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0))
    const offset = page * size
    return { items: items.slice(offset, offset + size), page, pageCount, total: items.length, start: items.length ? offset + 1 : 0, end: Math.min(items.length, offset + size) }
}
