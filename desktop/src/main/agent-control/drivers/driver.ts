import type {
    ControlAction,
    ControlCursorState,
    ControlObservation,
    ControlObservationMode,
    ControlTarget,
    ControlWindowCandidate
} from '../../../shared/agent-control/contracts'
import type { RegisteredControlTarget } from '../target-registry'

export type DriverObservationOptions = {
    revision: number
    includeScreenshot: boolean
    mode?: ControlObservationMode
    signal?: AbortSignal
}

export type DriverActionContext = {
    revision: number
    previousObservation: ControlObservation
    signal?: AbortSignal
    updateCursor?: (patch: Partial<Omit<ControlCursorState, 'targetId' | 'updatedAt'>>) => void
    runAgentInput?: <T>(operation: () => Promise<T>) => Promise<T>
}

export type ControlScreenshotPayload = {
    data: string
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    bytes: number
}

export interface AgentControlDriver {
    readonly kind: ControlTarget['kind']
    observe(target: RegisteredControlTarget, options: DriverObservationOptions): Promise<ControlObservation>
    act(target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext): Promise<{ changed: boolean }>
    readScreenshot?(screenshotRef: string): ControlScreenshotPayload | undefined
    retainTarget?(target: RegisteredControlTarget): void
    release?(target: RegisteredControlTarget): Promise<void> | void
    releaseIdle?(): Promise<void> | void
    releaseInputFocus?(target: RegisteredControlTarget): void
    emergencyStop?(): Promise<void> | void
    dispose?(): Promise<void> | void
    health?(): { state: 'ready' | 'degraded' | 'disconnected' | 'unavailable'; lastDisconnectReason?: string }
    isTargetCurrent?(target: RegisteredControlTarget): boolean
    listWindows?(): Promise<ControlWindowCandidate[]>
    openApp?(application: string, signal?: AbortSignal): Promise<{ applicationName: string }>
    selectWindow?(windowToken: string): Promise<{ trustedIdentity: unknown; target: Omit<Extract<ControlTarget, { kind: 'windows-window' }>, 'targetId'> }>
    getWindowBounds?(target: RegisteredControlTarget): Promise<{ x: number; y: number; width: number; height: number }>
}
