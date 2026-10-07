export function resolveFileActionsMenuWidth(preferred: number, triggerWidth: number, viewportWidth: number, matchTriggerWidth: boolean): number {
    if (!matchTriggerWidth) return preferred
    const measured = Number.isFinite(triggerWidth) && triggerWidth > 0 ? triggerWidth : preferred
    return Math.min(measured, Math.max(1, viewportWidth - 24))
}

export function resolveFileActionsSubmenuPosition(anchor: Pick<DOMRect, 'left' | 'right' | 'top'>, width: number, rows: number, rowHeight: number, viewportWidth: number, viewportHeight: number) {
    const margin = 8
    const gap = 6
    const height = Math.min(280, rows * rowHeight + 8)
    const side = viewportWidth - anchor.right - margin >= width + gap || anchor.left < width + gap ? 'right' as const : 'left' as const
    const left = side === 'right' ? Math.min(viewportWidth - width - margin, anchor.right + gap) : Math.max(margin, anchor.left - width - gap)
    return { top: Math.max(margin, Math.min(anchor.top - 4, viewportHeight - height - margin)), left, side }
}
