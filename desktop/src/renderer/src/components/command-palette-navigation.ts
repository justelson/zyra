export type CommandPaletteArrowDirection = 'ArrowDown' | 'ArrowUp'

export function resolveCommandPaletteArrowIndex(
    currentIndex: number,
    direction: CommandPaletteArrowDirection,
    resultCount: number
): number {
    if (resultCount <= 0) return 0
    const normalizedIndex = Number.isFinite(currentIndex)
        ? Math.min(Math.max(Math.trunc(currentIndex), 0), resultCount - 1)
        : 0
    if (direction === 'ArrowDown') return (normalizedIndex + 1) % resultCount
    return (normalizedIndex - 1 + resultCount) % resultCount
}
