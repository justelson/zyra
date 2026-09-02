import { randomUUID } from 'crypto'
import type { ControlAction, ControlElement, ControlObservation, ControlTarget, ControlWindowCandidate } from '../../../shared/agent-control/contracts'
import type { AgentControlDriver, DriverActionContext, DriverObservationOptions } from './driver'
import type { RegisteredControlTarget } from '../target-registry'

export class FakeControlDriver implements AgentControlDriver {
    readonly kind: ControlTarget['kind']
    private readonly elements = new Map<string, ControlElement>()
    private title = 'Fixture'
    private url = 'http://127.0.0.1/fixture'
    private stopped = false
    private readonly retainedTargetIds = new Set<string>()
    private idleReleaseCalls = 0

    constructor(kind: ControlTarget['kind'] = 'zyra-browser') {
        this.kind = kind
        this.elements.set('fixture:button', { elementRef: 'fixture:button', role: 'button', name: 'Continue', actions: ['click'] })
        this.elements.set('fixture:password', { elementRef: 'fixture:password', role: 'password', name: 'Password', value: 'never-return-this', sensitive: true, actions: ['type'] })
    }

    async openApp(application: string): Promise<{ applicationName: string }> {
        return { applicationName: application }
    }

    async listWindows(): Promise<ControlWindowCandidate[]> {
        if (this.kind !== 'windows-window') return []
        return [{
            windowToken: 'fixture:window',
            title: 'Fixture editor',
            applicationName: 'Fixture',
            executableIdentity: 'fixture.exe',
            processId: 4242,
            blocked: false
        }]
    }

    async selectWindow(windowToken: string) {
        if (this.kind !== 'windows-window' || windowToken !== 'fixture:window') throw new Error('Fixture window is unavailable.')
        const trustedIdentity = {
            windowToken,
            processId: 4242,
            executableIdentity: 'fixture.exe',
            applicationName: 'Fixture',
            title: 'Fixture editor',
            processStartTime: 1
        }
        return {
            trustedIdentity,
            target: {
                kind: 'windows-window' as const,
                sidecarSessionId: 'fixture:sidecar',
                processId: trustedIdentity.processId,
                windowToken,
                executableIdentity: trustedIdentity.executableIdentity,
                applicationName: trustedIdentity.applicationName,
                title: trustedIdentity.title
            }
        }
    }

    async observe(target: RegisteredControlTarget, options: DriverObservationOptions): Promise<ControlObservation> {
        if (this.stopped) throw new Error('Fake driver stopped.')
        return {
            version: 1,
            observationId: `fixture-observation:${randomUUID()}`,
            revision: options.revision,
            targetId: target.target.targetId,
            capturedAt: new Date().toISOString(),
            targetState: 'ready',
            url: this.kind === 'windows-window' ? undefined : this.url,
            title: this.title,
            origin: this.kind === 'windows-window' ? undefined : new URL(this.url).origin,
            viewport: { width: 800, height: 600, scale: 1 },
            elements: options.mode === 'visual' ? [] : [...this.elements.values()],
            screenshotRef: options.includeScreenshot ? 'control-artifact:fixture' : undefined,
            redactions: []
        }
    }

    async act(_target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext): Promise<{ changed: boolean }> {
        if (this.stopped) throw new Error('Fake driver stopped.')
        if (action.type === 'navigate') this.url = action.url
        if (action.type === 'move') context.updateCursor?.({ x: action.x, y: action.y, phase: 'idle', visible: true })
        if (action.type === 'click') {
            context.updateCursor?.({ x: action.x ?? 100, y: action.y ?? 80, phase: 'pressing', visible: true })
            this.title = 'Clicked'
        }
        if (action.type === 'drag') context.updateCursor?.({ x: action.toX, y: action.toY, phase: 'idle', visible: true })
        if (action.type === 'stroke') {
            for (const point of action.points) context.updateCursor?.({ ...point, phase: 'dragging', visible: true })
            const last = action.points[action.points.length - 1]
            context.updateCursor?.({ x: last.x, y: last.y, phase: 'idle', visible: true })
        }
        if (action.type === 'type') this.title = `Typed ${action.text.length} characters`
        if (action.type === 'wait') {
            const condition = action.condition
            if (condition.type === 'delay') await new Promise((resolve) => setTimeout(resolve, condition.durationMs))
        }
        return { changed: !['wait', 'move'].includes(action.type) }
    }

    retainTarget(target: RegisteredControlTarget): void {
        this.retainedTargetIds.add(target.target.targetId)
    }

    release(target: RegisteredControlTarget): void {
        this.retainedTargetIds.delete(target.target.targetId)
    }

    retainedTargetCount(): number {
        return this.retainedTargetIds.size
    }

    releaseIdle(): void {
        if (this.retainedTargetIds.size === 0) this.idleReleaseCalls += 1
    }

    idleReleaseCallCount(): number {
        return this.idleReleaseCalls
    }

    readScreenshot(screenshotRef: string) {
        if (screenshotRef !== 'control-artifact:fixture') return undefined
        const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        return { data, mimeType: 'image/png' as const, bytes: Buffer.from(data, 'base64').length }
    }

    emergencyStop(): void {
        this.stopped = true
        this.retainedTargetIds.clear()
    }

    resume(): void {
        this.stopped = false
    }

    health() {
        return { state: this.stopped ? 'disconnected' as const : 'ready' as const }
    }
}
