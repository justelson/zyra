import type { ControlAction, ControlCapability, ControlSideEffectClass, ControlTarget } from './contracts'

export const CONTROL_BOUNDS = {
    maxObservationElements: 1_500,
    maxObservationBytes: 512 * 1024,
    maxScreenshotBytes: 2 * 1024 * 1024,
    maxVisualScreenshotBytes: 300 * 1024,
    maxPendingActionsPerTarget: 32,
    maxAuditEntries: 500,
    maxPendingPairingRequests: 32,
    maxBridgeMessageBytes: 512 * 1024,
    maxTypedTextLength: 16_384,
    maxUrlLength: 2_048,
    maxGrantDurationMs: 30 * 60 * 1000,
    maxGrantActions: 500,
    defaultActionTimeoutMs: 15_000,
    minInspectorWidth: 340,
    maxInspectorWidth: 1_600
} as const

export const CONTROL_ACTION_CAPABILITY: Record<ControlAction['type'], ControlCapability | null> = {
    move: 'pointer.move',
    click: 'pointer.click',
    drag: 'pointer.drag',
    stroke: 'pointer.drag',
    type: 'keyboard.type',
    key: 'keyboard.key',
    scroll: 'scroll',
    select: 'form.select',
    navigate: 'navigate',
    focus: 'window.focus',
    wait: null
}

export const CONTROL_SIDE_EFFECTS_REQUIRING_APPROVAL = new Set<ControlSideEffectClass>([
    'send-or-publish',
    'purchase',
    'account-change',
    'security-change',
    'destructive-delete',
    'file-upload',
    'sensitive-data-submit',
    'software-install',
    'legal-acceptance'
])

export const TARGET_CAPABILITIES: Record<ControlTarget['kind'], ReadonlySet<ControlCapability>> = {
    'zyra-browser': new Set([
        'observe.structure', 'observe.screenshot', 'navigate', 'pointer.click', 'pointer.move', 'pointer.drag',
        'keyboard.type', 'keyboard.key', 'scroll', 'form.select', 'tab.manage'
    ]),
    'chrome-tab': new Set([
        'observe.structure', 'observe.screenshot', 'navigate', 'pointer.click', 'pointer.move',
        'keyboard.type', 'keyboard.key', 'scroll', 'form.select', 'window.focus'
    ]),
    'windows-window': new Set([
        'observe.structure', 'observe.screenshot', 'pointer.click', 'pointer.move', 'pointer.drag',
        'keyboard.type', 'keyboard.key', 'scroll', 'form.select', 'window.focus'
    ])
}

export function isSafeControlUrl(value: string): boolean {
    if (value.length > CONTROL_BOUNDS.maxUrlLength) return false
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

export function normalizedOrigin(value: string): string | null {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
    } catch {
        return null
    }
}
