import type { ControlAction, ControlObservation } from '../../shared/agent-control/contracts'

export type WindowsControlBounds = { x: number; y: number; width: number; height: number }
export type WindowsControlPoint = { x: number; y: number }

export function resolveWindowsControlBounds(observation: ControlObservation | undefined): WindowsControlBounds | null {
    const candidates = (observation?.elements || []).flatMap((element) => {
        const bounds = normalizeBounds(element.bounds)
        return bounds && (element.role === 'window' || element.role === 'titlebar') ? [bounds] : []
    })
    return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] || null
}

export function resolveWindowsActionScreenPoint(action: ControlAction, observation: ControlObservation): WindowsControlPoint | null {
    const elementRef = 'elementRef' in action ? action.elementRef : undefined
    if (elementRef) {
        const bounds = normalizeBounds(observation.elements.find((element) => element.elementRef === elementRef)?.bounds)
        if (bounds) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    }
    const targetBounds = resolveWindowsControlBounds(observation)
    if (!targetBounds) return null
    if (action.type === 'drag') return { x: targetBounds.x + action.fromX, y: targetBounds.y + action.fromY }
    if ('x' in action && 'y' in action && action.x !== undefined && action.y !== undefined) {
        return { x: targetBounds.x + action.x, y: targetBounds.y + action.y }
    }
    return null
}

export function resolveWindowsDragEndScreenPoint(action: ControlAction, observation: ControlObservation): WindowsControlPoint | null {
    if (action.type !== 'drag') return null
    const targetBounds = resolveWindowsControlBounds(observation)
    return targetBounds ? { x: targetBounds.x + action.toX, y: targetBounds.y + action.toY } : null
}

export function translateWindowsPointerAction(action: ControlAction, observation: ControlObservation): ControlAction {
    const targetBounds = resolveWindowsControlBounds(observation)
    if (!targetBounds) return action
    if ((action.type === 'move' || action.type === 'click') && 'x' in action && 'y' in action && action.x !== undefined && action.y !== undefined) {
        return { ...action, x: targetBounds.x + action.x, y: targetBounds.y + action.y }
    }
    if (action.type === 'drag') {
        return {
            ...action,
            fromX: targetBounds.x + action.fromX,
            fromY: targetBounds.y + action.fromY,
            toX: targetBounds.x + action.toX,
            toY: targetBounds.y + action.toY
        }
    }
    return action
}

function normalizeBounds(value: WindowsControlBounds | undefined): WindowsControlBounds | null {
    if (!value) return null
    const bounds = { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) }
    return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null
}
