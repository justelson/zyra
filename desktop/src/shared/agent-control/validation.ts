import {
    CONTROL_CAPABILITIES,
    type ControlAction,
    type ControlActionRequest,
    type ControlCapability,
    type ControlObservationMode,
    type ControlPlanRequest,
    type ControlPrincipal,
    type ControlSemanticActionSequenceRequest,
    type ControlSemanticActionStep,
    type ControlStageIntent
} from './contracts'
import { CONTROL_BOUNDS, isSafeControlUrl } from './policy'

const capabilitySet = new Set<string>(CONTROL_CAPABILITIES)
const sideEffectSet = new Set([
    'none', 'send-or-publish', 'purchase', 'account-change', 'security-change', 'destructive-delete',
    'file-upload', 'sensitive-data-submit', 'software-install', 'legal-acceptance'
])
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/

export class ControlValidationError extends Error {
    readonly code = 'CONTROL_VALIDATION_ERROR'
}

function fail(message: string): never {
    throw new ControlValidationError(message)
}

export function assertControlIdentifier(value: unknown, label: string): string {
    if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label} is invalid.`)
    return value
}

export function assertControlCapabilities(value: unknown): ControlCapability[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > CONTROL_CAPABILITIES.length) {
        fail('Capabilities must be a non-empty bounded array.')
    }
    const capabilities = [...new Set(value.map((entry) => {
        if (typeof entry !== 'string' || !capabilitySet.has(entry)) fail(`Unknown control capability: ${String(entry)}`)
        return entry as ControlCapability
    }))]
    return capabilities
}

export function assertControlPrincipal(value: unknown): ControlPrincipal {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Principal is invalid.')
    const principal = value as Record<string, unknown>
    if (principal.type === 'root') {
        return {
            type: 'root',
            threadId: assertControlIdentifier(principal.threadId, 'threadId'),
            turnId: assertControlIdentifier(principal.turnId, 'turnId')
        }
    }
    if (principal.type === 'agent') {
        return {
            type: 'agent',
            fleetId: assertControlIdentifier(principal.fleetId, 'fleetId'),
            agentRunId: assertControlIdentifier(principal.agentRunId, 'agentRunId'),
            parentThreadId: assertControlIdentifier(principal.parentThreadId, 'parentThreadId')
        }
    }
    return fail('Principal type is invalid.')
}

function boundedString(value: unknown, label: string, max: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(`${label} is invalid.`)
    return value
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} is invalid.`)
    return value
}

function sideEffect(value: unknown) {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !sideEffectSet.has(value)) fail('Side-effect class is invalid.')
    return value as 'none' | 'send-or-publish' | 'purchase' | 'account-change' | 'security-change' | 'destructive-delete' | 'file-upload' | 'sensitive-data-submit' | 'software-install' | 'legal-acceptance'
}

function pointerButton(value: unknown): 'left' | 'middle' | 'right' | undefined {
    if (value === undefined) return undefined
    if (value !== 'left' && value !== 'middle' && value !== 'right') fail('Pointer button is invalid.')
    return value
}

function pointerCoordinate(value: unknown, label: string): number {
    return finiteNumber(value, label, 0, 100_000)
}

function keyboardModifier(value: unknown): string {
    const modifier = boundedString(value, 'modifier', 24)
    if (!['ctrl', 'control', 'shift', 'alt', 'win', 'windows', 'meta'].includes(modifier.toLowerCase())) {
        fail('Key modifier is not in the bounded allowlist.')
    }
    return modifier
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
    const number = finiteNumber(value, label, min, max)
    if (!Number.isSafeInteger(number)) fail(`${label} must be an integer.`)
    return number
}

export function assertControlAction(value: unknown): ControlAction {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Action is invalid.')
    const action = value as Record<string, unknown>
    switch (action.type) {
        case 'move':
            return {
                type: 'move',
                x: pointerCoordinate(action.x, 'x'),
                y: pointerCoordinate(action.y, 'y'),
                durationMs: action.durationMs === undefined ? undefined : finiteNumber(action.durationMs, 'durationMs', 0, 5_000)
            }
        case 'click': {
            const hasElement = action.elementRef !== undefined
            const hasCoordinates = action.x !== undefined || action.y !== undefined
            if (!hasElement && !hasCoordinates) fail('Click requires an element reference or screen coordinates.')
            if (hasCoordinates && (action.x === undefined || action.y === undefined)) fail('Click coordinates require both x and y.')
            return {
                type: 'click',
                ...(hasElement ? { elementRef: assertControlIdentifier(action.elementRef, 'elementRef') } : {}),
                ...(hasCoordinates ? { x: pointerCoordinate(action.x, 'x'), y: pointerCoordinate(action.y, 'y') } : {}),
                ...(action.button === undefined ? {} : { button: pointerButton(action.button) }),
                ...(action.clickCount === undefined ? {} : { clickCount: boundedInteger(action.clickCount, 'clickCount', 1, 3) }),
                ...(sideEffect(action.sideEffect) ? { sideEffect: sideEffect(action.sideEffect) } : {})
            }
        }
        case 'drag':
            return {
                type: 'drag',
                fromX: pointerCoordinate(action.fromX, 'fromX'),
                fromY: pointerCoordinate(action.fromY, 'fromY'),
                toX: pointerCoordinate(action.toX, 'toX'),
                toY: pointerCoordinate(action.toY, 'toY'),
                durationMs: action.durationMs === undefined ? undefined : finiteNumber(action.durationMs, 'durationMs', 0, 5_000),
                button: pointerButton(action.button),
                ...(sideEffect(action.sideEffect) ? { sideEffect: sideEffect(action.sideEffect) } : {})
            }
        case 'stroke': {
            if (!Array.isArray(action.points) || action.points.length < 2 || action.points.length > 512) {
                fail('Stroke points must contain 2 to 512 bounded points.')
            }
            return {
                type: 'stroke',
                points: action.points.map((point, index) => {
                    if (!point || typeof point !== 'object' || Array.isArray(point)) fail(`Stroke point ${index + 1} is invalid.`)
                    const value = point as Record<string, unknown>
                    return { x: pointerCoordinate(value.x, `points[${index}].x`), y: pointerCoordinate(value.y, `points[${index}].y`) }
                }),
                durationMs: action.durationMs === undefined ? undefined : finiteNumber(action.durationMs, 'durationMs', 0, 12_000),
                button: pointerButton(action.button)
            }
        }
        case 'type': {
            const hasCoordinates = action.x !== undefined || action.y !== undefined
            if (hasCoordinates && (action.x === undefined || action.y === undefined)) fail('Type coordinates require both x and y.')
            return {
                type: 'type',
                elementRef: action.elementRef === undefined ? undefined : assertControlIdentifier(action.elementRef, 'elementRef'),
                x: hasCoordinates ? pointerCoordinate(action.x, 'x') : undefined,
                y: hasCoordinates ? pointerCoordinate(action.y, 'y') : undefined,
                text: boundedString(action.text, 'text', CONTROL_BOUNDS.maxTypedTextLength),
                replace: action.replace === true,
                ...(sideEffect(action.sideEffect) ? { sideEffect: sideEffect(action.sideEffect) } : {})
            }
        }
        case 'key':
            return {
                type: 'key',
                key: boundedString(action.key, 'key', 64),
                modifiers: Array.isArray(action.modifiers) ? [...new Set(action.modifiers.slice(0, 8).map(keyboardModifier))].slice(0, 4) : undefined,
                ...(sideEffect(action.sideEffect) ? { sideEffect: sideEffect(action.sideEffect) } : {})
            }
        case 'scroll': {
            const hasCoordinates = action.x !== undefined || action.y !== undefined
            if (hasCoordinates && (action.x === undefined || action.y === undefined)) fail('Scroll coordinates require both x and y.')
            return {
                type: 'scroll',
                elementRef: action.elementRef === undefined ? undefined : assertControlIdentifier(action.elementRef, 'elementRef'),
                x: hasCoordinates ? pointerCoordinate(action.x, 'x') : undefined,
                y: hasCoordinates ? pointerCoordinate(action.y, 'y') : undefined,
                deltaX: finiteNumber(action.deltaX, 'deltaX', -100_000, 100_000),
                deltaY: finiteNumber(action.deltaY, 'deltaY', -100_000, 100_000)
            }
        }
        case 'select':
            if (!Array.isArray(action.values) || action.values.length === 0 || action.values.length > 32) fail('Select values are invalid.')
            return {
                type: 'select',
                elementRef: assertControlIdentifier(action.elementRef, 'elementRef'),
                values: action.values.map((entry) => boundedString(entry, 'select value', 512)),
                ...(sideEffect(action.sideEffect) ? { sideEffect: sideEffect(action.sideEffect) } : {})
            }
        case 'navigate': {
            const url = boundedString(action.url, 'url', CONTROL_BOUNDS.maxUrlLength)
            if (!isSafeControlUrl(url)) fail('Only HTTP and HTTPS navigation is allowed.')
            return { type: 'navigate', url }
        }
        case 'focus':
            return { type: 'focus' }
        case 'wait': {
            if (!action.condition || typeof action.condition !== 'object' || Array.isArray(action.condition)) fail('Wait condition is invalid.')
            const condition = action.condition as Record<string, unknown>
            const timeoutMs = finiteNumber(action.timeoutMs, 'timeoutMs', 0, CONTROL_BOUNDS.defaultActionTimeoutMs)
            if (condition.type === 'delay') return { type: 'wait', condition: { type: 'delay', durationMs: finiteNumber(condition.durationMs, 'durationMs', 0, timeoutMs) }, timeoutMs }
            if (condition.type === 'target-ready') return { type: 'wait', condition: { type: 'target-ready' }, timeoutMs }
            if (condition.type === 'url-changed') return { type: 'wait', condition: { type: 'url-changed', from: typeof condition.from === 'string' ? condition.from.slice(0, CONTROL_BOUNDS.maxUrlLength) : undefined }, timeoutMs }
            if (condition.type === 'element-absent') return { type: 'wait', condition: { type: 'element-absent', elementRef: assertControlIdentifier(condition.elementRef, 'elementRef') }, timeoutMs }
            if (condition.type === 'element-present') return { type: 'wait', condition: { type: 'element-present', name: typeof condition.name === 'string' ? condition.name.slice(0, 512) : undefined, role: typeof condition.role === 'string' ? condition.role.slice(0, 128) : undefined }, timeoutMs }
            return fail('Unknown wait condition.')
        }
        default:
            return fail(`Unknown control action: ${String(action.type)}`)
    }
}

export function assertControlActionRequest(value: unknown): ControlActionRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Action request is invalid.')
    const request = value as Record<string, unknown>
    if (request.version !== 1) fail('Unsupported control protocol version.')
    return {
        version: 1,
        requestId: assertControlIdentifier(request.requestId, 'requestId'),
        grantId: assertControlIdentifier(request.grantId, 'grantId'),
        targetId: assertControlIdentifier(request.targetId, 'targetId'),
        observationRevision: finiteNumber(request.observationRevision, 'observationRevision', 1, Number.MAX_SAFE_INTEGER),
        action: assertControlAction(request.action)
    }
}

export function assertControlSemanticActionSequenceRequest(value: unknown): ControlSemanticActionSequenceRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Computer interaction sequence is invalid.')
    const request = value as Record<string, unknown>
    if (request.version !== 1) fail('Unsupported control protocol version.')
    if (!Array.isArray(request.steps) || request.steps.length < 1 || request.steps.length > 16) {
        fail('A computer interaction sequence requires 1 to 16 bounded steps.')
    }
    const steps = request.steps.map((step, index): ControlSemanticActionStep => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) fail(`Computer sequence step ${index + 1} is invalid.`)
        const record = step as Record<string, unknown>
        if (record.sideEffect !== 'none') fail(`Computer sequence step ${index + 1} must declare a routine side effect.`)
        if (record.type === 'click') {
            return {
                type: 'click',
                ...semanticActionTarget(record, index),
                sideEffect: 'none'
            }
        }
        if (record.type === 'type') {
            if (typeof record.replace !== 'boolean') fail(`Computer sequence step ${index + 1} must declare whether typing replaces the field.`)
            return {
                type: 'type',
                ...semanticActionTarget(record, index),
                text: boundedString(record.text, `steps[${index}].text`, CONTROL_BOUNDS.maxTypedTextLength),
                replace: record.replace,
                sideEffect: 'none'
            }
        }
        if (record.type === 'key') {
            const key = boundedString(record.key, `steps[${index}].key`, 64)
            const modifiers = Array.isArray(record.modifiers)
                ? [...new Set(record.modifiers.slice(0, 8).map(keyboardModifier))].slice(0, 4)
                : undefined
            assertRoutineSequenceKey(key, modifiers, index)
            return { type: 'key', key, modifiers, sideEffect: 'none' }
        }
        if (record.type === 'wait') {
            return {
                type: 'wait',
                durationMs: finiteNumber(record.durationMs, `steps[${index}].durationMs`, 0, 2_000),
                sideEffect: 'none'
            }
        }
        return fail(`Computer sequence step ${index + 1} has an unsupported action.`)
    })
    const typedCharacters = steps.reduce((total, step) => total + (step.type === 'type' ? step.text.length : 0), 0)
    if (typedCharacters > CONTROL_BOUNDS.maxTypedTextLength) fail('Computer interaction sequence typed text exceeds the bounded total.')
    const waitDuration = steps.reduce((total, step) => total + (step.type === 'wait' ? step.durationMs : 0), 0)
    if (waitDuration > 5_000) fail('Computer interaction sequence wait time exceeds five seconds.')
    return {
        version: 1,
        requestId: assertControlIdentifier(request.requestId, 'requestId'),
        grantId: assertControlIdentifier(request.grantId, 'grantId'),
        targetId: assertControlIdentifier(request.targetId, 'targetId'),
        observationRevision: finiteNumber(request.observationRevision, 'observationRevision', 1, Number.MAX_SAFE_INTEGER),
        steps
    }
}

export const assertControlSemanticClickSequenceRequest = assertControlSemanticActionSequenceRequest

function semanticActionTarget(record: Record<string, unknown>, index: number): { role?: string; name: string } {
    return {
        ...(record.role === undefined ? {} : { role: boundedString(record.role, `steps[${index}].role`, 128) }),
        name: boundedString(record.name, `steps[${index}].name`, 512)
    }
}

function assertRoutineSequenceKey(key: string, modifiers: string[] | undefined, index: number): void {
    const normalizedKey = key.toLowerCase()
    const normalizedModifiers = (modifiers || []).map((modifier) => modifier.toLowerCase().replace('control', 'ctrl'))
    if (normalizedModifiers.some((modifier) => modifier === 'alt' || modifier === 'win' || modifier === 'windows' || modifier === 'meta')) {
        fail(`Computer sequence step ${index + 1} cannot use system or menu modifiers.`)
    }
    const navigationKeys = new Set(['tab', 'escape', 'home', 'end', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
    const editingShortcuts = new Set(['a', 'z', 'y'])
    const isNavigation = navigationKeys.has(normalizedKey)
        && (normalizedKey === 'escape'
            ? normalizedModifiers.length === 0
            : normalizedKey === 'tab'
                ? normalizedModifiers.every((modifier) => modifier === 'shift')
                : normalizedModifiers.every((modifier) => modifier === 'ctrl' || modifier === 'shift'))
    const isEditingShortcut = editingShortcuts.has(normalizedKey)
        && normalizedModifiers.length > 0
        && normalizedModifiers.every((modifier) => modifier === 'ctrl' || modifier === 'shift')
        && normalizedModifiers.includes('ctrl')
    if (!isNavigation && !isEditingShortcut) fail(`Computer sequence step ${index + 1} uses a key that requires an individual reviewed action.`)
}

function assertObservationMode(value: unknown): ControlObservationMode {
    if (value !== 'visual' && value !== 'structure' && value !== 'both') fail('Observation mode is invalid.')
    return value
}

function assertStageIntent(value: unknown): ControlStageIntent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Stage intent is invalid.')
    const intent = value as Record<string, unknown>
    if (!['pointer', 'keyboard', 'scroll', 'mixed'].includes(String(intent.expectedActivity))) fail('Stage activity is invalid.')
    let expectedRegion: ControlStageIntent['expectedRegion']
    if (intent.expectedRegion !== undefined) {
        if (!intent.expectedRegion || typeof intent.expectedRegion !== 'object' || Array.isArray(intent.expectedRegion)) fail('Stage region is invalid.')
        const region = intent.expectedRegion as Record<string, unknown>
        expectedRegion = {
            x: pointerCoordinate(region.x, 'stage.expectedRegion.x'),
            y: pointerCoordinate(region.y, 'stage.expectedRegion.y'),
            width: finiteNumber(region.width, 'stage.expectedRegion.width', 1, 100_000),
            height: finiteNumber(region.height, 'stage.expectedRegion.height', 1, 100_000)
        }
    }
    return {
        summary: boundedString(intent.summary, 'stage.summary', 512),
        expectedActivity: intent.expectedActivity as ControlStageIntent['expectedActivity'],
        ...(expectedRegion ? { expectedRegion } : {})
    }
}

export function assertControlPlanRequest(value: unknown): ControlPlanRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Control plan is invalid.')
    const request = value as Record<string, unknown>
    if (request.version !== 1) fail('Unsupported control protocol version.')
    if (!Array.isArray(request.steps) || request.steps.length < 1 || request.steps.length > 64) fail('A Browser stage requires 1 to 64 bounded steps.')
    const steps = request.steps.map(assertControlAction)
    const navigationIndex = steps.findIndex((action) => action.type === 'navigate')
    if (navigationIndex >= 0 && navigationIndex !== steps.length - 1) fail('Navigation must be the final step in a Browser stage.')
    const estimatedDuration = steps.reduce((total, action) => total + (
        action.type === 'wait' && action.condition.type === 'delay' ? action.condition.durationMs
            : action.type === 'stroke' ? action.durationMs || 420
                : 'durationMs' in action && typeof action.durationMs === 'number' ? action.durationMs
                    : 250
    ), 0)
    if (estimatedDuration > 12_000) fail('A Browser stage must stay within the 12 second execution bound.')
    return {
        version: 1,
        requestId: assertControlIdentifier(request.requestId, 'requestId'),
        grantId: assertControlIdentifier(request.grantId, 'grantId'),
        targetId: assertControlIdentifier(request.targetId, 'targetId'),
        observationRevision: finiteNumber(request.observationRevision, 'observationRevision', 1, Number.MAX_SAFE_INTEGER),
        stage: assertStageIntent(request.stage),
        steps,
        observationMode: assertObservationMode(request.observationMode),
        includeScreenshot: request.includeScreenshot === true
    }
}

export function assertBridgeMessageSize(value: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > CONTROL_BOUNDS.maxBridgeMessageBytes) fail('Control message exceeds the size limit.')
}
