import { randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import type { ControlAction, ControlElement, ControlObservation, ControlTarget, ControlWindowCandidate } from '../../../shared/agent-control/contracts'
import { CONTROL_BOUNDS } from '../../../shared/agent-control/policy'
import { AgentControlError } from '../control-errors'
import type { RegisteredControlTarget } from '../target-registry'
import type { AgentControlDriver, DriverActionContext, DriverObservationOptions } from './driver'
import { resolveWindowsActionScreenPoint, resolveWindowsControlBounds, translateWindowsPointerAction } from '../windows-control-geometry'
import { selectExactWindowsCandidate } from '../windows-candidate-selection'
import { observeExactWindowsTarget } from '../windows-observation-recovery'

import { WindowsSidecarConnection } from './windows-sidecar-connection'
type SidecarTarget = { windowToken: string; processId: number; executableIdentity: string; applicationName: string; title: string; processStartTime: number }

export class WindowsDesktopDriver implements AgentControlDriver {
    readonly kind = 'windows-window' as const
    private readonly sidecarSessionId = `windows-sidecar:${randomUUID()}`
    private readonly connection: WindowsSidecarConnection

    constructor(private readonly artifactDirectory: string) {
        this.connection = new WindowsSidecarConnection(artifactDirectory, { launch: resolveSidecarLaunch })
    }

    retainAcquisition(): () => void { return this.connection.retainAcquisition() }

    async listWindows(): Promise<ControlWindowCandidate[]> {
        const result = await this.request('list_windows', {}) as { windows?: ControlWindowCandidate[] }
        return Array.isArray(result.windows) ? result.windows.slice(0, 256).map((entry) => ({
            windowToken: String(entry.windowToken || '').slice(0, 512),
            title: String(entry.title || '').slice(0, 512),
            applicationName: String(entry.applicationName || '').slice(0, 256),
            executableIdentity: String(entry.executableIdentity || '').slice(0, 128),
            processId: Number(entry.processId),
            blocked: Boolean(entry.blocked),
            blockedReason: entry.blockedReason ? String(entry.blockedReason).slice(0, 512) : undefined
        })) : []
    }

    async openApp(application: string, signal?: AbortSignal): Promise<{ applicationName: string }> {
        const result = await this.request('open_app', { application }, signal, 10_000) as { applicationName?: unknown }
        const applicationName = stringValue(result.applicationName, 256)
        if (!applicationName) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows did not return the registered application name.')
        return { applicationName }
    }

    async selectWindow(windowToken: string) {
        const selected = await selectExactWindowsCandidate<SidecarTarget>({
            windowToken,
            select: () => this.request('select_window', { windowToken }) as Promise<SidecarTarget>,
            listCurrent: () => this.listWindows()
        })
        return {
            trustedIdentity: selected,
            target: {
                kind: 'windows-window' as const,
                sidecarSessionId: this.sidecarSessionId,
                processId: Number(selected.processId),
                windowToken: String(selected.windowToken),
                executableIdentity: String(selected.executableIdentity),
                applicationName: String(selected.applicationName || '').slice(0, 256) || undefined,
                title: String(selected.title || '').slice(0, 512) || undefined
            }
        }
    }

    async observe(target: RegisteredControlTarget, options: DriverObservationOptions): Promise<ControlObservation> {
        const trusted = target.trustedIdentity as SidecarTarget
        const result = await observeExactWindowsTarget({
            windowToken: trusted.windowToken,
            listCurrent: () => this.listWindows(),
            wait: milliseconds => delay(milliseconds, options.signal),
            observe: () => this.request('observe', {
            windowToken: trusted.windowToken,
            revision: options.revision,
            includeScreenshot: options.includeScreenshot
            }, options.signal, undefined, target.target.targetId) as Promise<Record<string, unknown>>
        })
        const observation: ControlObservation = {
            version: 1,
            observationId: `control-observation:${randomUUID()}`,
            revision: options.revision,
            targetId: target.target.targetId,
            capturedAt: new Date().toISOString(),
            targetState: normalizeState(result.targetState),
            title: stringValue(result.title, 512) || undefined,
            elements: normalizeElements(result.elements),
            screenshotRef: stringValue(result.screenshotRef, 192) || undefined,
            focusedElementRef: stringValue(result.focusedElementRef, 192) || undefined,
            truncation: normalizeTruncation(result.truncation),
            redactions: Array.isArray(result.redactions) ? result.redactions.map((entry) => stringValue(entry, 128)).filter(Boolean).slice(0, 32) : []
        }
        // UIA bounds and the existing native input translation are physical
        // screen pixels. Derive dimensions from that same fresh window tree;
        // do not guess DPI or use a screenshot's resized dimensions.
        const bounds = observation.elements.some((element) => element.role === 'window')
            ? resolveWindowsControlBounds(observation)
            : null
        if (bounds && observation.targetState === 'ready') observation.viewport = { width: bounds.width, height: bounds.height, scale: 1 }
        if (options.mode === 'visual') {
            observation.elements = []
            observation.focusedElementRef = undefined
            observation.truncation = undefined
        }
        return observation
    }

    async act(target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext): Promise<{ changed: boolean }> {
        const trusted = target.trustedIdentity as SidecarTarget
        if (action.type === 'navigate' || action.type === 'select') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', `${action.type} is unavailable for Windows targets.`)
        if (action.type === 'wait') {
            await delay(Math.min(action.timeoutMs, action.condition.type === 'delay' ? action.condition.durationMs : 100), context.signal)
            return { changed: false }
        }
        // Semantic invocation has no physical pointer path. Show its observed
        // control location; coordinate input follows native progress exclusively.
        const semantic = 'elementRef' in action && Boolean(action.elementRef)
        const point = semantic ? resolveWindowsActionScreenPoint(action, context.previousObservation) : null
        let lastPoint = point
        if (point) context.updateCursor?.({ ...point, coordinateSpace: 'screen', phase: 'moving', visible: true, durationMs: 80 })
        try {
            const result = await this.connection.request('action', {
                windowToken: trusted.windowToken,
                revision: context.revision,
                ...(!semantic && ['move', 'click', 'drag', 'stroke'].includes(action.type) && context.allowWindowFocus === true ? { allowWindowFocus: true } : {}),
                action: translateWindowsPointerAction(action, context.previousObservation)
            }, context.signal, undefined, target.target.targetId, (cursor) => {
                if (context.signal?.aborted) return
                lastPoint = { x: cursor.x, y: cursor.y }
                context.updateCursor?.({ ...cursor, coordinateSpace: 'screen', visible: true, durationMs: 0 })
            }) as { changed?: boolean }
            return { changed: result.changed !== false }
        } finally {
            // A failed drag stays at its last actual point, never the requested end.
            if (lastPoint && !context.signal?.aborted) context.updateCursor?.({ ...lastPoint, coordinateSpace: 'screen', phase: 'idle', visible: true, durationMs: 0 })
        }
    }

    isTargetBusy(): boolean { return this.connection.hasPendingWork() }

    async getWindowBounds(target: RegisteredControlTarget): Promise<{ x: number; y: number; width: number; height: number }> {
        const trusted = target.trustedIdentity as SidecarTarget
        const result = await this.request('window_bounds', { windowToken: trusted.windowToken }, undefined, 2_000, target.target.targetId) as Record<string, unknown>
        const bounds = {
            x: Number(result.x),
            y: Number(result.y),
            width: Number(result.width),
            height: Number(result.height)
        }
        if (!Object.values(bounds).every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) {
            throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows returned invalid selected-window overlay bounds.')
        }
        return bounds
    }

    readScreenshot(screenshotRef: string) {
        const artifactId = /^control-artifact:([a-f0-9]{32})$/i.exec(screenshotRef)?.[1]
        if (!artifactId) return undefined
        const file = join(this.artifactDirectory, `${artifactId}.jpg`)
        try {
            const bytes = statSync(file).size
            if (bytes < 1 || bytes > CONTROL_BOUNDS.maxScreenshotBytes) return undefined
            return { data: readFileSync(file).toString('base64'), mimeType: 'image/jpeg' as const, bytes }
        } catch {
            return undefined
        }
    }

    retainTarget(target: RegisteredControlTarget): void { this.connection.retainTarget(target.target.targetId) }
    release(target: RegisteredControlTarget): void { this.connection.releaseTarget(target.target.targetId) }
    releaseIdle(): void { this.connection.releaseIdle() }
    async emergencyStop(): Promise<void> { await this.connection.emergencyStop() }
    async dispose(): Promise<void> { this.connection.dispose() }

    health() {
        if (process.platform !== 'win32') return { state: 'unavailable' as const, lastDisconnectReason: 'windows-only' }
        try {
            resolveSidecarLaunch()
            return { state: 'ready' as const, lastDisconnectReason: this.connection.lastDisconnectReason }
        } catch (error) {
            return { state: 'unavailable' as const, lastDisconnectReason: error instanceof Error ? error.message : 'sidecar-unavailable' }
        }
    }

    isTargetCurrent(target: RegisteredControlTarget): boolean {
        return target.target.kind === 'windows-window'
            && target.target.sidecarSessionId === this.sidecarSessionId
    }

    private request(method: string, parameters: Record<string, unknown>, signal?: AbortSignal, timeoutMs: number = CONTROL_BOUNDS.defaultActionTimeoutMs, targetId?: string): Promise<unknown> {
        return this.connection.request(method, parameters, signal, timeoutMs, targetId)
    }
}

function resolveSidecarLaunch(): { command: string; args: string[] } {
    const roots = [app.getAppPath(), resolve(app.getAppPath(), '..'), process.cwd()]
    const executableCandidates = [
        join(process.resourcesPath, 'zyra-computer-use', 'Zyra.ComputerUse.exe'),
        ...roots.map((root) => join(root, 'native', 'zyra-computer-use', 'src', 'Zyra.ComputerUse', 'bin', 'Debug', 'net8.0-windows', 'Zyra.ComputerUse.exe')),
        ...roots.map((root) => join(root, 'native', 'zyra-computer-use', 'publish', 'Zyra.ComputerUse.exe'))
    ]
    const executable = executableCandidates.find(existsSync)
    if (executable) return { command: executable, args: [] }
    const dllCandidates = roots.map((root) => join(root, 'native', 'zyra-computer-use', 'src', 'Zyra.ComputerUse', 'bin', 'Debug', 'net8.0-windows', 'Zyra.ComputerUse.dll'))
    const dll = dllCandidates.find(existsSync)
    if (dll) return { command: 'dotnet', args: [dll] }
    throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The Zyra Windows computer-use sidecar is not built.', { retryable: false })
}

function stringValue(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.slice(0, maximum) : ''
}

function normalizeElements(value: unknown): ControlElement[] {
    if (!Array.isArray(value)) return []
    return value.slice(0, CONTROL_BOUNDS.maxObservationElements).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const element = entry as Record<string, unknown>
        return [{
            elementRef: stringValue(element.elementRef, 192),
            role: stringValue(element.role, 128) || 'control',
            name: stringValue(element.name, 512) || undefined,
            value: stringValue(element.value, 2_048) || undefined,
            description: stringValue(element.description, 2_048) || undefined,
            bounds: normalizeBounds(element.bounds),
            states: Array.isArray(element.states) ? element.states.map((item) => stringValue(item, 64)).filter(Boolean).slice(0, 24) : undefined,
            actions: Array.isArray(element.actions) ? element.actions.map((item) => stringValue(item, 64)).filter(Boolean).slice(0, 16) : undefined,
            sensitive: element.sensitive === true
        }]
    })
}

function normalizeBounds(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const bounds = value as Record<string, unknown>
    const entries = ['x', 'y', 'width', 'height'].map((key) => Number(bounds[key]))
    return entries.every(Number.isFinite) ? { x: entries[0], y: entries[1], width: entries[2], height: entries[3] } : undefined
}

function normalizeTruncation(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const data = value as Record<string, unknown>
    const totalElements = Number(data.totalElements)
    const returnedElements = Number(data.returnedElements)
    return [totalElements, returnedElements].every(Number.isFinite) ? { totalElements, returnedElements } : undefined
}

function normalizeState(value: unknown): ControlObservation['targetState'] {
    return ['ready', 'navigating', 'detached', 'closed', 'blocked'].includes(String(value)) ? value as ControlObservation['targetState'] : 'ready'
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new AgentControlError('CONTROL_CANCELLED', 'Windows computer action was cancelled.')
    await new Promise<void>((resolveDelay, rejectDelay) => {
        const finish = () => {
            signal?.removeEventListener('abort', abort)
            resolveDelay()
        }
        const timer = setTimeout(finish, Math.max(0, ms))
        const abort = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            rejectDelay(new AgentControlError('CONTROL_CANCELLED', 'Windows computer action was cancelled.'))
        }
        signal?.addEventListener('abort', abort, { once: true })
    })
}
