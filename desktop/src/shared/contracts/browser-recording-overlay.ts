import type { DevScopeBrowserGuestTargetInput } from './devscope-api'

export const BROWSER_RECORDING_OVERLAY_IPC = {
    update: 'devscope:browserRecordingOverlay:update',
    command: 'devscope:browserRecordingOverlay:command',
    state: 'zyra:browserRecordingOverlay:state',
    presentation: 'devscope:browserRecordingOverlay:presentation',
    read: 'zyra:browserRecordingOverlay:read',
    action: 'zyra:browserRecordingOverlay:action',
    resize: 'zyra:browserRecordingOverlay:resize'
} as const

export type BrowserRecordingOverlayPresentation = {
    target: DevScopeBrowserGuestTargetInput
    visible: boolean
    targetGone: boolean
    error: string | null
}

export type BrowserRecordingOverlayCommand =
    | { kind: 'start' | 'pause' | 'resume' | 'stop' | 'dismiss' | 'save-copy' | 'show-artifact' | 'show-tab' | 'refresh-devices' | 'attach-chat' }
    | { kind: 'microphone'; deviceId: string }
    | { kind: 'audio'; source: 'off' | 'tab' | 'system' }

export type BrowserRecordingOverlayState = {
    target: DevScopeBrowserGuestTargetInput
    status: 'ready' | 'starting' | 'recording' | 'paused' | 'stopping' | 'saved' | 'error'
    title: string
    elapsedMs: number
    microphone: string
    microphonePending: boolean
    microphones: Array<{ id: string; label: string }>
    audioSource: 'off' | 'tab' | 'system'
    audioPending: boolean
    tabAudioSupported: boolean
    systemAudioSupported: boolean
    error: string | null
    unsaved: boolean
    hasArtifact: boolean
    canAttachToChat?: boolean
    theme: { background: string; foreground: string; muted: string; accent: string; border: string; dark: boolean; fontFamily?: string; fontCss?: string }
}

export type BrowserRecordingOverlayApi = {
    getState: () => Promise<BrowserRecordingOverlayState | null>
    onState: (listener: (state: BrowserRecordingOverlayState) => void) => () => void
    command: (command: BrowserRecordingOverlayCommand) => void
    resize: (size: { width: number; height: number }) => void
}

export function isBrowserRecordingOverlayCommand(value: unknown): value is BrowserRecordingOverlayCommand {
    if (!value || typeof value !== 'object') return false
    const command = value as Record<string, unknown>
    if (command.kind === 'microphone') return typeof command.deviceId === 'string' && command.deviceId.length <= 256
    if (command.kind === 'audio') return ['off', 'tab', 'system'].includes(String(command.source))
    return ['start', 'pause', 'resume', 'stop', 'dismiss', 'save-copy', 'show-artifact', 'show-tab', 'refresh-devices', 'attach-chat'].includes(String(command.kind))
}
