export type DiagramTransform = { x: number; y: number; scale: number }
export function fitDiagram(width: number, height: number, viewportWidth: number, viewportHeight: number): DiagramTransform {
    const scale = Math.max(0.05, Math.min(2, (viewportWidth - 48) / Math.max(1, width), (viewportHeight - 48) / Math.max(1, height)))
    return { scale, x: (viewportWidth - width * scale) / 2, y: (viewportHeight - height * scale) / 2 }
}
export function zoomDiagram(current: DiagramTransform, factor: number, anchorX: number, anchorY: number): DiagramTransform {
    const scale = Math.max(0.05, Math.min(5, current.scale * factor))
    return { scale, x: anchorX - (anchorX - current.x) * scale / current.scale, y: anchorY - (anchorY - current.y) * scale / current.scale }
}
