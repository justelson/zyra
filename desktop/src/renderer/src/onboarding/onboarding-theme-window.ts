/** A contiguous catalog window, keeping the selected theme and its neighbours visible. */
export function getThemeWindow<T extends { id: string }>(themes: readonly T[], selectedId: string): readonly T[] {
    const index = Math.max(0, themes.findIndex(theme => theme.id === selectedId))
    const row = Math.floor(index / 6)
    let start = Math.max(0, (row - 1) * 6)
    // The last cell belongs to More themes; move forward if it would hide selection.
    if (index - start >= 11) start += 6
    start = Math.min(start, Math.max(0, themes.length - 11))
    return themes.slice(start, start + 11)
}
