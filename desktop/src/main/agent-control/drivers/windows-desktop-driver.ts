import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { createConnection, type Socket } from 'net'
import { join, resolve } from 'path'
import { app } from 'electron'
import type { ControlAction, ControlElement, ControlObservation, ControlTarget, ControlWindowCandidate } from '../../../shared/agent-control/contracts'
import { CONTROL_BOUNDS } from '../../../shared/agent-control/policy'
import { AgentControlError } from '../control-errors'
import type { RegisteredControlTarget } from '../target-registry'
import type { AgentControlDriver, DriverActionContext, DriverObservationOptions } from './driver'

type PendingRpc = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
type SidecarTarget = { windowToken: string; processId: number; executableIdentity: string; applicationName: string; title: string; processStartTime: number }

const SIDECAR_IDLE_TIMEOUT_MS = 15_000

export class WindowsDesktopDriver implements AgentControlDriver {
    readonly kind = 'windows-window' as const
    private child: ChildProcessWithoutNullStreams | null = null
    private socket: Socket | null = null
    private pipeName = ''
    private readonly secret = randomBytes(32).toString('base64url')
    private readonly sidecarSessionId = `windows-sidecar:${randomUUID()}`
    private receiveBuffer = ''
    private readonly pending = new Map<string, PendingRpc>()
    private readonly retainedTargetIds = new Set<string>()
    private idleTimer: NodeJS.Timeout | null = null
    private lastDisconnectReason: string | undefined
    private startPromise: Promise<void> | null = null

    constructor(private readonly artifactDirectory: string) {}

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
        const selected = await this.request('select_window', { windowToken }) as SidecarTarget
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
        const result = await this.request('observe', {
            windowToken: trusted.windowToken,
            revision: options.revision,
            includeScreenshot: options.includeScreenshot
        }, options.signal) as Record<string, unknown>
        return {
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
    }

    async act(target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext): Promise<{ changed: boolean }> {
        const trusted = target.trustedIdentity as SidecarTarget
        if (action.type === 'navigate' || action.type === 'select') throw new AgentControlError('CONTROL_CAPABILITY_DENIED', `${action.type} is unavailable for Windows targets.`)
        if (action.type === 'wait') {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(action.timeoutMs, action.condition.type === 'delay' ? action.condition.durationMs : 100)))
            return { changed: false }
        }
        const result = await this.request('action', {
            windowToken: trusted.windowToken,
            revision: context.revision,
            action
        }, context.signal) as { changed?: boolean }
        return { changed: result.changed !== false }
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

    retainTarget(target: RegisteredControlTarget): void {
        this.retainedTargetIds.add(target.target.targetId)
        this.clearIdleTimer()
    }

    release(target: RegisteredControlTarget): void {
        this.retainedTargetIds.delete(target.target.targetId)
        if (this.retainedTargetIds.size === 0) this.disposeProcess('task-complete')
    }

    releaseIdle(): void {
        if (this.retainedTargetIds.size === 0) this.disposeProcess('turn-complete')
    }

    async emergencyStop(): Promise<void> {
        this.retainedTargetIds.clear()
        await this.request('emergency_stop', {}, undefined, 2_000).catch(() => undefined)
        this.disposeProcess('emergency-stop')
    }

    async dispose(): Promise<void> {
        this.retainedTargetIds.clear()
        this.disposeProcess('disposed')
    }

    health() {
        if (process.platform !== 'win32') return { state: 'unavailable' as const, lastDisconnectReason: 'windows-only' }
        try {
            resolveSidecarLaunch()
            return { state: 'ready' as const, lastDisconnectReason: this.lastDisconnectReason }
        } catch (error) {
            return { state: 'unavailable' as const, lastDisconnectReason: error instanceof Error ? error.message : 'sidecar-unavailable' }
        }
    }

    isTargetCurrent(target: RegisteredControlTarget): boolean {
        return target.target.kind === 'windows-window'
            && target.target.sidecarSessionId === this.sidecarSessionId
    }

    private async request(method: string, parameters: Record<string, unknown>, signal?: AbortSignal, timeoutMs: number = CONTROL_BOUNDS.defaultActionTimeoutMs): Promise<unknown> {
        await this.ensureStarted()
        this.clearIdleTimer()
        try {
            return await this.sendRequest(method, parameters, signal, timeoutMs)
        } finally {
            this.scheduleIdleStop()
        }
    }

    private sendRequest(method: string, parameters: Record<string, unknown>, signal?: AbortSignal, timeoutMs: number = CONTROL_BOUNDS.defaultActionTimeoutMs): Promise<unknown> {
        if (!this.socket?.writable) return Promise.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows sidecar pipe is unavailable.', { retryable: true }))
        const id = `sidecar-request:${randomUUID()}`
        const message = JSON.stringify({ id, method, params: parameters, auth: this.secret, version: 1 })
        if (Buffer.byteLength(message) > CONTROL_BOUNDS.maxBridgeMessageBytes) return Promise.reject(new AgentControlError('CONTROL_VALIDATION_ERROR', 'Windows sidecar request exceeds 512 KiB.'))
        return new Promise((resolveRequest, rejectRequest) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                rejectRequest(new AgentControlError('CONTROL_TIMEOUT', 'Windows sidecar request timed out.', { retryable: true }))
            }, timeoutMs)
            const abort = () => {
                clearTimeout(timer)
                this.pending.delete(id)
                rejectRequest(new AgentControlError('CONTROL_CANCELLED', 'Windows sidecar request was cancelled.'))
            }
            if (signal?.aborted) return abort()
            signal?.addEventListener('abort', abort, { once: true })
            this.pending.set(id, {
                timer,
                resolve: (value) => { signal?.removeEventListener('abort', abort); resolveRequest(value) },
                reject: (error) => { signal?.removeEventListener('abort', abort); rejectRequest(error) }
            })
            this.socket!.write(`${message}\n`, (error) => {
                if (!error) return
                clearTimeout(timer)
                this.pending.delete(id)
                rejectRequest(error)
            })
        })
    }

    private async ensureStarted(): Promise<void> {
        if (process.platform !== 'win32') throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows computer use is available only on Windows.')
        if (this.child && this.socket?.writable) return
        if (this.startPromise) return this.startPromise
        this.startPromise = this.start()
        try { await this.startPromise } finally { this.startPromise = null }
    }

    private async start(): Promise<void> {
        this.disposeProcess('restart')
        this.pipeName = `zyra-computer-use-${process.pid}-${randomUUID()}`
        const launch = resolveSidecarLaunch()
        this.child = spawn(launch.command, [...launch.args, '--pipe', this.pipeName, '--artifacts', this.artifactDirectory], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        })
        this.child.stdin.write(`${this.secret}\n`)
        this.child.stderr.setEncoding('utf8')
        this.child.stderr.on('data', () => { /* Sidecar stderr is intentionally not copied into model-visible logs. */ })
        this.child.on('exit', (code) => this.disposeProcess(`sidecar-exit:${code ?? 'unknown'}`, false))
        this.child.on('error', (error) => this.disposeProcess(`sidecar-error:${error.message}`, false))
        const pipePath = `\\\\.\\pipe\\${this.pipeName}`
        let lastError: unknown
        for (let attempt = 0; attempt < 40; attempt += 1) {
            try {
                this.socket = await connectPipe(pipePath)
                break
            } catch (error) {
                lastError = error
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
            }
        }
        if (!this.socket) {
            this.disposeProcess('pipe-connect-failed')
            throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', `Could not connect to the Windows sidecar: ${lastError instanceof Error ? lastError.message : 'unknown error'}`, { retryable: true })
        }
        this.socket.setEncoding('utf8')
        this.socket.on('data', (chunk) => this.handleData(String(chunk)))
        this.socket.on('close', () => this.disposeProcess('pipe-closed', false))
        this.socket.on('error', (error) => this.disposeProcess(`pipe-error:${error.message}`, false))
        this.lastDisconnectReason = undefined
        await this.sendRequest('health', {}, undefined, 3_000)
    }

    private handleData(chunk: string): void {
        this.receiveBuffer += chunk
        if (this.receiveBuffer.length > CONTROL_BOUNDS.maxBridgeMessageBytes * 2) return this.disposeProcess('oversized-sidecar-response')
        for (;;) {
            const newline = this.receiveBuffer.indexOf('\n')
            if (newline < 0) return
            const line = this.receiveBuffer.slice(0, newline).trim()
            this.receiveBuffer = this.receiveBuffer.slice(newline + 1)
            if (!line) continue
            try {
                const response = JSON.parse(line) as { id?: string; ok?: boolean; result?: unknown; error?: { code?: string; message?: string; retryable?: boolean } }
                const pending = this.pending.get(String(response.id || ''))
                if (!pending) continue
                clearTimeout(pending.timer)
                this.pending.delete(String(response.id))
                if (response.ok) pending.resolve(response.result)
                else pending.reject(new AgentControlError(
                    response.error?.code === 'STALE_OBSERVATION' ? 'CONTROL_STALE_OBSERVATION' : response.error?.code === 'POLICY_DENIED' ? 'CONTROL_TARGET_BLOCKED' : 'CONTROL_DRIVER_UNAVAILABLE',
                    response.error?.message || 'Windows sidecar request failed.',
                    { retryable: Boolean(response.error?.retryable) }
                ))
            } catch {
                this.disposeProcess('invalid-sidecar-response')
            }
        }
    }

    private scheduleIdleStop(): void {
        this.clearIdleTimer()
        if (this.retainedTargetIds.size > 0 || !this.child) return
        this.idleTimer = setTimeout(() => this.disposeProcess('idle'), SIDECAR_IDLE_TIMEOUT_MS)
        this.idleTimer.unref?.()
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer)
        this.idleTimer = null
    }

    private disposeProcess(reason: string, terminate = true): void {
        this.clearIdleTimer()
        this.lastDisconnectReason = ['idle', 'task-complete'].includes(reason) ? undefined : reason
        const socket = this.socket
        const child = this.child
        this.socket = null
        this.child = null
        this.receiveBuffer = ''
        socket?.destroy()
        if (terminate && child && child.exitCode === null) {
            if (process.platform === 'win32') {
                const terminator = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore'
                })
                terminator.once('error', () => child.kill())
                terminator.unref()
            } else child.kill()
        }
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer)
            pending.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', `Windows sidecar disconnected: ${reason}`, { retryable: true }))
        }
        this.pending.clear()
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

function connectPipe(path: string): Promise<Socket> {
    return new Promise((resolveConnection, rejectConnection) => {
        const socket = createConnection(path)
        const fail = (error: Error) => { socket.destroy(); rejectConnection(error) }
        socket.once('error', fail)
        socket.once('connect', () => { socket.removeListener('error', fail); resolveConnection(socket) })
    })
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
