type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }

export function pointerPathIntersectsBounds(points: Point[], bounds: Bounds): boolean {
    for (let index = 1; index < points.length; index++) {
        const from = points[index - 1]!
        const to = points[index]!
        let enter = 0
        let leave = 1
        let intersects = true
        for (const axis of ['x', 'y'] as const) {
            const delta = to[axis] - from[axis]
            const low = bounds[axis]
            const high = low + (axis === 'x' ? bounds.width : bounds.height)
            if (delta === 0) {
                if (from[axis] < low || from[axis] > high) { intersects = false; break }
                continue
            }
            const a = (low - from[axis]) / delta
            const b = (high - from[axis]) / delta
            enter = Math.max(enter, Math.min(a, b))
            leave = Math.min(leave, Math.max(a, b))
            if (enter > leave) { intersects = false; break }
        }
        if (intersects) return true
    }
    return false
}
