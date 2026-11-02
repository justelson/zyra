// Return null when native scrolling owns the gesture. Only take over when a
// delta must cross the opaque frame boundary, and consume panel capacity first.
export function consumeVisualizationWheelDelta(wheel) {
    if (wheel.ctrlKey || wheel.shiftKey || !Number.isFinite(wheel.deltaY) || !wheel.deltaY || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null
    const doc = wheel.target?.ownerDocument || document
    const view = doc.defaultView
    const panels = []
    let element = wheel.target instanceof Element ? wheel.target : wheel.target?.parentElement
    while (element) {
        const style = view.getComputedStyle(element)
        if (/^(auto|scroll|overlay)$/.test(style.overflowY) && element.clientHeight > 0) {
            // A deliberate overscroll barrier remains entirely native, even at
            // its boundary. Likewise, native snap physics own partial gestures.
            if (style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') return null
            const extent = Math.max(0, element.scrollHeight - element.clientHeight)
            const reverse = style.flexDirection === 'column-reverse'
            const minimum = reverse ? -extent : 0
            const maximum = reverse ? 0 : extent
            const position = Math.max(minimum, Math.min(maximum, element.scrollTop))
            panels.push({ element, style, capacity: wheel.deltaY > 0 ? maximum - position : position - minimum })
        }
        element = element.parentElement
    }
    const first = panels[0]
    const unit = wheel.deltaMode === 1 ? parseFloat(first?.style.lineHeight) || 21
        : wheel.deltaMode === 2 ? first?.element.clientHeight || view.innerHeight : 1
    const delta = Math.max(-10_000, Math.min(10_000, wheel.deltaY * unit))
    if (panels.some(panel => panel.capacity >= Math.abs(delta) || panel.capacity > 0 && panel.style.scrollSnapType !== 'none')) return null
    wheel.preventDefault()
    let remaining = delta
    for (const { element } of panels) {
        const before = element.scrollTop
        element.scrollBy({ top: remaining, behavior: 'instant' })
        const moved = element.scrollTop - before
        const consumed = remaining > 0 ? Math.max(0, Math.min(remaining, moved)) : Math.min(0, Math.max(remaining, moved))
        remaining -= consumed
        if (Math.abs(remaining) < 0.01) return 0
    }
    return remaining
}
