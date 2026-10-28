import { randomUUID } from 'node:crypto'
import { screen, type BrowserWindow, type WebContents } from 'electron'
import { ipcMain } from '../ipc/trusted-ipc'
import { idleVoiceWidgetState, voiceWidgetHitTest, VOICE_WIDGET_IPC as IPC, type VoiceWidgetCommand, type VoiceWidgetLaunch, type VoiceWidgetResult, type VoiceWidgetState } from '../../shared/assistant/voice-widget'

type Options = {
    createWindow(): BrowserWindow
    returnToChat(launch: VoiceWidgetLaunch): Promise<void>
    onOwnerLost(senderId: number): Promise<unknown>
}
export class VoiceWidgetManager {
    private window: BrowserWindow | null = null
    private state = idleVoiceWidgetState()
    private readonly observers = new Map<number, WebContents>()
    private readonly pending = new Map<string, { resolve(result: VoiceWidgetResult): void; timer: ReturnType<typeof setTimeout>; command: VoiceWidgetCommand; sent: boolean }>()
    private callReady = false
    private transition: Promise<unknown> = Promise.resolve()
    private pointerTimer: ReturnType<typeof setInterval> | null = null
    private ignoringPointer = false
    private idleCloseTimer: ReturnType<typeof setTimeout> | null = null
    constructor(private readonly options: Options) {}
    ownsWebContents(id: number): boolean { return this.window?.webContents.id === id && !this.window.isDestroyed() }
    registerIpc(): void {
        ipcMain.handle(IPC.getState, event => {
            if (!this.observers.has(event.sender.id)) {
                this.observers.set(event.sender.id, event.sender)
                event.sender.once('destroyed', () => this.observers.delete(event.sender.id))
            }
            return this.snapshot()
        })
        ipcMain.handle(IPC.open, (_event, launch: VoiceWidgetLaunch, expectedCallId?: string) => {
            const work = this.transition.then(() => this.open(launch, expectedCallId))
            this.transition = work.catch(() => undefined)
            return work.catch(error => ({ success: false, error: error instanceof Error ? error.message : 'Voice could not start.' }))
        })
        ipcMain.handle(IPC.command, (_event, command: VoiceWidgetCommand) => this.command(command))
        ipcMain.handle(IPC.publish, (event, callId: string, update: VoiceWidgetState) => {
            this.assertOwner(event.sender.id)
            if (callId !== this.state.callId) return
            if (!['idle', 'requesting-microphone', 'connecting', 'active', 'stopping', 'error'].includes(update?.status)) throw new Error('Invalid Voice status.')
            this.state = {
                ...this.state, status: update.status, startedAt: typeof update.startedAt === 'string' ? update.startedAt : null,
                error: typeof update.error === 'string' ? update.error.slice(0, 1000) : null,
                realtimeVersion: typeof update.realtimeVersion === 'string' ? update.realtimeVersion.slice(0, 32) : null,
                microphoneMuted: update.microphoneMuted === true, speakerMuted: update.speakerMuted === true,
                activityLevel: Number.isFinite(update.activityLevel) ? Math.max(0, Math.min(1, update.activityLevel)) : 0,
                transcript: Array.isArray(update.transcript) ? update.transcript.slice(-256).map(entry => ({ id: String(entry.id).slice(0, 256), role: String(entry.role).slice(0, 32), text: String(entry.text).slice(0, 32_000), final: entry.final === true, ...(entry.canonicalMessageId ? { canonicalMessageId: String(entry.canonicalMessageId).slice(0, 256) } : {}), ...(entry.transcriptSource === 'turn' || entry.transcriptSource === 'chunk' ? { transcriptSource: entry.transcriptSource } : {}) })) : []
            }
            this.callReady = true
            this.broadcast()
            this.dispatchPending()
            if (update.status === 'idle') { this.window?.hide(); this.scheduleIdleClose() }
            else if (this.window && !this.window.isVisible()) this.window.showInactive()
        })
        ipcMain.handle(IPC.complete, (event, commandId: string, result: VoiceWidgetResult) => {
            this.assertOwner(event.sender.id)
            const pending = this.pending.get(commandId)
            if (!pending) return
            clearTimeout(pending.timer)
            this.pending.delete(commandId)
            pending.resolve(result?.success === true ? { success: true } : { success: false, error: String(result?.error || 'Voice command failed.').slice(0, 1000) })
            this.scheduleIdleClose()
        })
    }
    private snapshot(): VoiceWidgetState { return structuredClone(this.state) }
    private assertOwner(id: number): void { if (!this.ownsWebContents(id)) throw new Error('Only the Voice widget can publish call state.') }
    private broadcast(): void {
        this.state.revision += 1
        const state = this.snapshot()
        for (const contents of this.observers.values()) if (!contents.isDestroyed()) contents.send(IPC.state, state)
    }
    async open(launch: VoiceWidgetLaunch, expectedCallId?: string) {
        if (!launch || !launch.sessionId?.trim() || !launch.conversationId?.trim() || !launch.options || typeof launch.options.instructions !== 'string') throw new Error('Select a chat before starting Voice.')
        const busy = this.state.callId !== null && this.state.status !== 'idle' && this.state.status !== 'error'
        if (busy) {
            if (this.state.launch?.conversationId === launch.conversationId) {
                this.window?.showInactive()
                return { success: true as const, disposition: 'existing' as const, state: this.snapshot() }
            }
            if (expectedCallId !== this.state.callId) return { success: true as const, disposition: 'handoff-required' as const, state: this.snapshot() }
            const stopped = await this.command({ callId: expectedCallId, action: 'stop' })
            if (!stopped.success) return stopped
        } else if (expectedCallId && expectedCallId !== this.state.callId) {
            return { success: false as const, error: 'The active call changed. Start Voice again to confirm the new call.' }
        }
        if (this.state.callId && this.state.status === 'error') {
            const stopped = await this.command({ callId: this.state.callId, action: 'stop' })
            if (!stopped.success) return stopped
        }
        if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer)
        this.idleCloseTimer = null
        this.callReady = false
        this.state = { ...idleVoiceWidgetState(), revision: this.state.revision, callId: randomUUID(), status: 'connecting', launch: { ...launch, title: String(launch.title || 'Voice chat').slice(0, 256) } }
        if (!this.window || this.window.isDestroyed()) this.createWindow()
        this.broadcast()
        return { success: true as const, disposition: 'started' as const, state: this.snapshot() }
    }
    async command(command: VoiceWidgetCommand): Promise<VoiceWidgetResult> {
        if (!command || command.callId !== this.state.callId || !this.state.launch) return { success: false, error: 'This Voice call is no longer active.' }
        if (command.action === 'return') {
            await this.options.returnToChat(this.state.launch)
            this.window?.showInactive()
            return { success: true }
        }
        if (!['stop', 'mute', 'speaker', 'clear', 'send'].includes(command.action) || !this.window || this.window.isDestroyed()) return { success: false, error: 'Voice controls are unavailable.' }
        const commandId = randomUUID()
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(commandId)
                resolve({ success: false, error: 'Voice did not acknowledge the command. The current call has not been replaced.' })
            }, 20_000)
            this.pending.set(commandId, { resolve, timer, command, sent: false })
            this.dispatchPending()
        })
    }
    private dispatchPending(): void {
        if (!this.callReady || !this.window || this.window.isDestroyed()) return
        for (const [commandId, pending] of this.pending) {
            if (pending.sent || pending.command.callId !== this.state.callId) continue
            pending.sent = true
            this.window.webContents.send(IPC.receive, { ...pending.command, commandId })
        }
    }
    private scheduleIdleClose(): void {
        if (this.state.status !== 'idle' || this.pending.size || this.idleCloseTimer) return
        // A handoff starts its replacement in the acknowledgement microtask first.
        // Otherwise release the hidden renderer so it cannot keep a closed app alive.
        this.idleCloseTimer = setTimeout(() => {
            this.idleCloseTimer = null
            if (this.state.status === 'idle' && !this.pending.size && this.window && !this.window.isDestroyed()) this.window.destroy()
        }, 0)
    }
    private createWindow(): void {
        const window = this.options.createWindow()
        this.window = window
        this.ignoringPointer = true
        window.setIgnoreMouseEvents(true, { forward: true })
        const ownerId = window.webContents.id
        window.setAlwaysOnTop(true, 'floating')
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        window.setMenu(null)
        window.once('ready-to-show', () => { if (!window.isDestroyed() && this.callReady && this.state.status !== 'idle') window.showInactive() })
        window.webContents.once('did-finish-load', () => this.broadcast())
        const ownerLost = () => {
            if (this.window !== window) return
            this.window = null
            this.callReady = false
            if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer)
            this.idleCloseTimer = null
            if (this.pointerTimer) clearInterval(this.pointerTimer)
            this.pointerTimer = null
            for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.resolve({ success: false, error: 'The Voice window closed.' }) }
            this.pending.clear()
            this.state = { ...idleVoiceWidgetState(), revision: this.state.revision }
            this.broadcast()
            void this.options.onOwnerLost(ownerId).catch(() => undefined)
        }
        window.once('closed', ownerLost)
        window.webContents.once('render-process-gone', () => { if (!window.isDestroyed()) window.destroy() })
        // Native hit testing works even while Chromium forwards mouse events through transparent pixels.
        this.pointerTimer = setInterval(() => {
            if (window.isDestroyed() || !window.isVisible()) return
            const cursor = screen.getCursorScreenPoint(), bounds = window.getBounds()
            const ignore = !voiceWidgetHitTest(cursor.x - bounds.x, cursor.y - bounds.y)
            if (ignore !== this.ignoringPointer) {
                this.ignoringPointer = ignore
                window.setIgnoreMouseEvents(ignore, { forward: true })
            }
        }, 50)
        this.pointerTimer.unref?.()
    }
}
