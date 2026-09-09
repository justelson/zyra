import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { CONTROL_BOUNDS } from '../../../shared/agent-control/policy'
import { AgentControlError } from '../control-errors'

export type WindowsPointerProgress = { x: number; y: number; phase: 'moving' | 'pressing' | 'dragging' }
type PendingRpc = { onCursor?: (cursor: WindowsPointerProgress) => void; targetId?: string; resolve(value: unknown): void; reject(error: Error): void }
export type SidecarLaunch = { command: string; args: string[] }
export type WindowsSidecarHost = {
    launch(): SidecarLaunch
    spawn?: (launch: SidecarLaunch, pipeName: string, artifacts: string) => ChildProcessWithoutNullStreams
    connect?: (pipePath: string, signal: AbortSignal) => Promise<Socket>
    terminate?: (child: ChildProcessWithoutNullStreams) => void
    platform?: string
    idleTimeoutMs?: number
    terminationGraceMs?: number
}

// Process/pipe ownership is separate from window identity and grant authority.
// Host injection keeps lifecycle tests independent of Electron and real windows.
export class WindowsSidecarConnection {
    private child: ChildProcessWithoutNullStreams | null = null
    private socket: Socket | null = null
    private generation = 0
    private readonly secret = randomBytes(32).toString('base64url')
    private receiveBuffer = ''
    private readonly pending = new Map<string, PendingRpc>()
    private readonly targets = new Set<string>()
    private readonly targetRequests = new Map<AbortController, string>()
    private cleanupReason: string | null = null
    private acquisitions = 0
    private requests = 0
    private idleTimer: ReturnType<typeof setTimeout> | null = null
    private startTask: { controller: AbortController; promise: Promise<void> } | null = null
    private disposed = false
    private stopping = false
    lastDisconnectReason: string | undefined

    constructor(private artifacts: string, private host: WindowsSidecarHost) {}

    hasPendingWork(): boolean { return this.requests > 0 || this.pending.size > 0 || this.startTask !== null }

    retainTarget(id: string): void { this.targets.add(id); this.cleanupReason = null; this.clearIdleTimer() }
    retainAcquisition(): () => void {
        if (this.disposed || this.stopping) throw this.cancelled()
        this.acquisitions += 1
        this.clearIdleTimer()
        let released = false
        return () => {
            if (released) return
            released = true
            this.acquisitions = Math.max(0, this.acquisitions - 1)
            this.scheduleIdleStop()
        }
    }
    releaseTarget(id: string): void {
        if (!this.targets.delete(id)) return
        // Cover both startup waiters and already-sent input. The native pipe is
        // serial, so stopping sent input can also fail other pending RPCs. None
        // may be replayed automatically after an ambiguous native completion.
        for (const [controller, targetId] of this.targetRequests) if (targetId === id) controller.abort()
        this.stopIfUnused('task-complete')
    }
    releaseIdle(): void { this.stopIfUnused('turn-complete') }

    async request(method: string, parameters: Record<string, unknown>, signal?: AbortSignal, timeoutMs: number = CONTROL_BOUNDS.defaultActionTimeoutMs, targetId?: string, onCursor?: (cursor: WindowsPointerProgress) => void): Promise<unknown> {
        if (this.disposed || this.stopping || signal?.aborted) throw this.cancelled()
        const controller = targetId ? new AbortController() : null
        if (controller) this.targetRequests.set(controller, targetId!)
        const requestSignal = controller ? AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]) : signal
        this.requests += 1
        this.clearIdleTimer()
        try {
            await this.waitForStartup(requestSignal)
            if (requestSignal?.aborted) throw this.cancelled()
            return await this.sendRequest(method, parameters, requestSignal, timeoutMs, targetId, onCursor)
        } finally {
            if (controller) this.targetRequests.delete(controller)
            this.requests = Math.max(0, this.requests - 1)
            this.scheduleIdleStop()
        }
    }

    async emergencyStop(): Promise<void> {
        this.stopping = true
        this.targets.clear()
        try {
            // Do not start a helper just to stop it or wait for an old startup.
            if (!this.startTask && this.socket?.writable) await this.sendRequest('emergency_stop', {}, undefined, 2_000).catch(() => undefined)
        } finally {
            this.stopProcess('emergency-stop')
            this.stopping = false
        }
    }
    dispose(): void { this.disposed = true; this.targets.clear(); this.stopProcess('disposed') }

    private sendRequest(method: string, parameters: Record<string, unknown>, signal?: AbortSignal, timeoutMs: number = CONTROL_BOUNDS.defaultActionTimeoutMs, targetId?: string, onCursor?: (cursor: WindowsPointerProgress) => void): Promise<unknown> {
        const socket = this.socket
        if (!socket?.writable) return Promise.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows sidecar pipe is unavailable.', { retryable: true }))
        const id = `sidecar-request:${randomUUID()}`
        const message = JSON.stringify({ id, method, params: parameters, auth: this.secret, version: 1 })
        if (Buffer.byteLength(message) > CONTROL_BOUNDS.maxBridgeMessageBytes) return Promise.reject(new AgentControlError('CONTROL_VALIDATION_ERROR', 'Windows sidecar request exceeds 512 KiB.'))
        return new Promise((resolve, reject) => {
            let settled = false
            const finish = (error: Error | null, value?: unknown) => {
                if (settled) return false
                settled = true
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
                this.pending.delete(id)
                if (error) reject(error); else resolve(value)
                return true
            }
            const cancelNative = (error: AgentControlError, reason: string) => {
                // Native RPCs are serial: even discovery can wedge the pipe. Stop the
                // helper on cancellation/timeout; never replay input or old tokens.
                if (finish(error) && this.socket === socket) this.stopProcess(reason)
            }
            const abort = () => cancelNative(this.cancelled(), 'request-cancelled')
            const timer = setTimeout(() => cancelNative(new AgentControlError('CONTROL_TIMEOUT', 'Windows sidecar request timed out.', { retryable: true }), 'request-timeout'), timeoutMs)
            if (signal?.aborted) { abort(); return }
            signal?.addEventListener('abort', abort, { once: true })
            this.pending.set(id, { targetId, onCursor, resolve: value => finish(null, value), reject: error => finish(error) })
            try { socket.write(`${message}\n`, error => { if (error) finish(error) }) }
            catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
        })
    }

    private waitForStartup(signal?: AbortSignal): Promise<void> {
        const startup = this.ensureStarted()
        if (!signal) return startup
        // An individual waiter can leave shared startup without killing another
        // target's health handshake or later sending its own revoked input.
        return new Promise((resolve, reject) => {
            const abort = () => { signal.removeEventListener('abort', abort); reject(this.cancelled()) }
            signal.addEventListener('abort', abort, { once: true })
            startup.then(
                () => { signal.removeEventListener('abort', abort); resolve() },
                error => { signal.removeEventListener('abort', abort); reject(error) }
            )
            if (signal.aborted) abort()
        })
    }

    private async ensureStarted(): Promise<void> {
        if ((this.host.platform || process.platform) !== 'win32') throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'Windows computer use is available only on Windows.')
        if (this.disposed || this.stopping) throw this.cancelled()
        // A writable pipe is not ready until its own health handshake completes.
        if (this.startTask) return this.startTask.promise
        if (this.child && this.socket?.writable) return
        const controller = new AbortController()
        const task = { controller, promise: this.start(controller.signal) }
        this.startTask = task
        try { await task.promise } finally {
            if (this.startTask === task) { this.startTask = null; this.scheduleIdleStop() }
        }
    }

    private async start(signal: AbortSignal): Promise<void> {
        this.stopProcess('restart')
        const generation = this.generation
        const pipeName = `zyra-computer-use-${process.pid}-${randomUUID()}`
        const launch = this.host.launch()
        const child = this.host.spawn ? this.host.spawn(launch, pipeName, this.artifacts) : spawn(launch.command, [...launch.args, '--pipe', pipeName, '--artifacts', this.artifacts], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        this.child = child
        const current = () => this.generation === generation && this.child === child && !signal.aborted && !this.disposed
        child.on('exit', code => { if (current()) this.stopProcess(`sidecar-exit:${code ?? 'unknown'}`, false) })
        child.on('error', error => { if (current()) this.stopProcess(`sidecar-error:${error.message}`, false) })
        const pipePath = `\\\\.\\pipe\\${pipeName}`
        let lastError: unknown
        try {
            child.stdin.on('error', error => { if (current()) this.stopProcess(`stdin-error:${error.message}`) })
            child.stdin.write(`${this.secret}\n`)
            child.stderr.setEncoding('utf8')
            child.stderr.on('data', () => { /* Never expose sidecar stderr to the model. */ })
            for (let attempt = 0; attempt < 40; attempt++) {
                if (!current()) throw this.cancelled()
                try {
                    const socket = await (this.host.connect || connectPipe)(pipePath, signal)
                    if (!current()) { socket.destroy(); throw this.cancelled() }
                    this.socket = socket
                    break
                } catch (error) {
                    if (!current()) throw this.cancelled()
                    lastError = error
                    await pause(50, signal)
                }
            }
            if (!this.socket || !current()) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', `Could not connect to the Windows sidecar: ${lastError instanceof Error ? lastError.message : 'unknown error'}`, { retryable: true })
            const socket = this.socket
            const ownsSocket = () => current() && this.socket === socket
            socket.setEncoding('utf8')
            socket.on('data', chunk => { if (ownsSocket()) this.handleData(String(chunk)) })
            socket.on('close', () => { if (ownsSocket()) this.stopProcess('pipe-closed') })
            socket.on('error', error => { if (ownsSocket()) this.stopProcess(`pipe-error:${error.message}`) })
            await this.sendRequest('health', {}, signal, 3_000)
            if (!ownsSocket()) throw this.cancelled()
            this.lastDisconnectReason = undefined
        } catch (error) {
            if (current()) this.stopProcess('startup-failed')
            throw error
        }
    }

    private handleData(chunk: string): void {
        this.receiveBuffer += chunk
        if (this.receiveBuffer.length > CONTROL_BOUNDS.maxBridgeMessageBytes * 2) { this.stopProcess('oversized-sidecar-response'); return }
        for (;;) {
            const newline = this.receiveBuffer.indexOf('\n')
            if (newline < 0) return
            const line = this.receiveBuffer.slice(0, newline).trim()
            this.receiveBuffer = this.receiveBuffer.slice(newline + 1)
            if (!line) continue
            try {
                const response = JSON.parse(line) as { id?: string; cursor?: WindowsPointerProgress; ok?: boolean; result?: unknown; error?: { code?: string; message?: string; retryable?: boolean } }
                const pending = this.pending.get(String(response.id || ''))
                if (!pending) continue
                if (response.cursor) {
                    const { x, y, phase } = response.cursor
                    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100_000 && Math.abs(y) <= 100_000 && ['moving', 'pressing', 'dragging'].includes(phase)) {
                        pending.onCursor?.({ x, y, phase })
                    }
                    continue
                }
                if (response.ok) pending.resolve(response.result)
                else pending.reject(new AgentControlError(response.error?.code === 'STALE_OBSERVATION' ? 'CONTROL_STALE_OBSERVATION' : response.error?.code === 'POLICY_DENIED' ? 'CONTROL_TARGET_BLOCKED' : 'CONTROL_DRIVER_UNAVAILABLE', response.error?.message || 'Windows sidecar request failed.', { retryable: Boolean(response.error?.retryable) }))
            } catch { this.stopProcess('invalid-sidecar-response'); return }
        }
    }

    private busy(): boolean { return this.targets.size > 0 || this.acquisitions > 0 || this.requests > 0 || this.pending.size > 0 || this.startTask !== null }
    private stopIfUnused(reason: string): void {
        if (this.targets.size) return
        this.cleanupReason = reason
        if (!this.busy()) this.stopProcess(reason)
    }
    private scheduleIdleStop(): void {
        this.clearIdleTimer()
        if (this.disposed || this.busy()) return
        if (this.cleanupReason) { this.stopProcess(this.cleanupReason); return }
        if (!this.child) return
        this.idleTimer = setTimeout(() => this.stopIfUnused('idle'), this.host.idleTimeoutMs ?? 15_000)
        this.idleTimer.unref?.()
    }
    private clearIdleTimer(): void { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = null }
    private cancelled(): AgentControlError { return new AgentControlError('CONTROL_CANCELLED', 'Windows sidecar request or startup was cancelled.') }
    private stopProcess(reason: string, terminate = true): void {
        this.generation += 1
        this.clearIdleTimer()
        this.cleanupReason = null
        this.lastDisconnectReason = ['idle', 'task-complete', 'turn-complete'].includes(reason) ? undefined : reason
        const task = this.startTask
        this.startTask = null
        task?.controller.abort()
        const socket = this.socket, child = this.child
        this.socket = null; this.child = null; this.receiveBuffer = ''
        socket?.destroy()
        if (terminate && child && child.exitCode === null) {
            // EOF lets the native read pump stop input and release a held button.
            // Only this retired child may be killed if cooperative exit stalls.
            const timer = setTimeout(() => {
                child.removeListener('exit', exited)
                if (child.exitCode === null) (this.host.terminate || terminateChild)(child)
            }, this.host.terminationGraceMs ?? 250)
            const exited = () => clearTimeout(timer)
            child.once('exit', exited)
        }
        for (const pending of this.pending.values()) pending.reject(new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', `Windows sidecar disconnected: ${reason}`, { retryable: true }))
        this.pending.clear()
    }
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
    if (process.platform !== 'win32') { child.kill(); return }
    const terminator = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    terminator.once('error', () => child.kill())
    terminator.unref()
}
function connectPipe(pipePath: string, signal: AbortSignal): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = createConnection(pipePath)
        const clear = () => { socket.removeListener('error', fail); socket.removeListener('connect', connected); signal.removeEventListener('abort', aborted) }
        const fail = (error: Error) => { clear(); socket.destroy(); reject(error) }
        const aborted = () => fail(new AgentControlError('CONTROL_CANCELLED', 'Windows sidecar startup was cancelled.'))
        const connected = () => { socket.once('error', () => {}); clear(); resolve(socket) }
        socket.once('error', fail); socket.once('connect', connected)
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
    })
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', abort); resolve() }
        const timer = setTimeout(finish, ms)
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new AgentControlError('CONTROL_CANCELLED', 'Windows sidecar startup was cancelled.')) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
    })
}
