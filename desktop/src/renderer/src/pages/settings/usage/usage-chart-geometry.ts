// Curve math adapted from T3 Code's UsageProviderChart.tsx.
// Copyright (c) 2026 T3 Tools Inc., MIT. See public/licenses/t3-code.txt.
export type UsagePlotPoint = { x: number; y: number; known: boolean }

export function usageNiceScale(peak: number, count = 4) {
    if (!Number.isFinite(peak) || peak <= 0) return { max: 1, ticks: [0] }
    const raw = peak / count
    const magnitude = 10 ** Math.floor(Math.log10(raw))
    const normalized = raw / magnitude
    const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude
    const max = Math.ceil(peak / step) * step
    const ticks: number[] = []
    for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value)
    return { max, ticks }
}
function curve(points: UsagePlotPoint[]) {
    if (!points.length) return ''
    let result = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
    const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x || 1))
    const tangents = points.map((_, index) => index === 0 ? slopes[0] || 0 : index === points.length - 1 ? slopes[index - 1] || 0 : slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2)
    slopes.forEach((slope, index) => {
        if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; return }
        const a = tangents[index] / slope, b = tangents[index + 1] / slope
        if (a * a + b * b > 9) { const factor = 3 / Math.sqrt(a * a + b * b); tangents[index] = factor * a * slope; tangents[index + 1] = factor * b * slope }
    })
    points.slice(1).forEach((to, index) => {
        const from = points[index], delta = (to.x - from.x) / 3
        result += ` C${(from.x + delta).toFixed(2)},${(from.y + tangents[index] * delta).toFixed(2)} ${(to.x - delta).toFixed(2)},${(to.y - tangents[index + 1] * delta).toFixed(2)} ${to.x.toFixed(2)},${to.y.toFixed(2)}`
    })
    return result
}
export function usageCurvePaths(points: UsagePlotPoint[], baseline: number) {
    const groups: UsagePlotPoint[][] = []
    let group: UsagePlotPoint[] = []
    for (const point of points) {
        if (point.known) group.push(point)
        else if (group.length) { groups.push(group); group = [] }
    }
    if (group.length) groups.push(group)
    return groups.map(values => ({ line: curve(values), area: `${curve(values)} L${values[values.length - 1].x},${baseline} L${values[0].x},${baseline} Z` }))
}
