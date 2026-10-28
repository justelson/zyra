import type { VoiceWidgetApi } from '@shared/assistant/voice-widget'

type NativeVoiceWidgetClient = Pick<VoiceWidgetApi, 'getState' | 'onState' | 'open' | 'command'>

/** Browser adapters synthesize functions for unknown properties; truthiness is not capability. */
export function getNativeVoiceWidgetClient(value: unknown): NativeVoiceWidgetClient | undefined {
    if (!value) return undefined
    const api = value as Partial<NativeVoiceWidgetClient>
    return typeof api.getState === 'function' && typeof api.onState === 'function'
        && typeof api.open === 'function' && typeof api.command === 'function'
        ? api as NativeVoiceWidgetClient : undefined
}
