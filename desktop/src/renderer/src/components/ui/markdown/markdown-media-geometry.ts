type MediaGeometry = Readonly<{ width: number; height: number }>
const MAX_ENTRIES = 128
const geometry = new Map<string, MediaGeometry>()

/** Session-local layout hints only. Never retain large inline media payloads. */
export function readMarkdownMediaGeometry(source: string): MediaGeometry | undefined {
    const known = geometry.get(source)
    if (known) { geometry.delete(source); geometry.set(source, known) }
    return known
}

export function rememberMarkdownMediaGeometry(source: string, width: number, height: number): void {
    if (!source || source.length > 4096 || !Number.isFinite(width) || !Number.isFinite(height)
        || width <= 0 || height <= 0 || width > 100_000 || height > 100_000) return
    geometry.delete(source)
    geometry.set(source, { width, height })
    if (geometry.size > MAX_ENTRIES) geometry.delete(geometry.keys().next().value!)
}
