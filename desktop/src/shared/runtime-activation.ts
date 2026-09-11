export type RuntimeActivationStatus = { phase: 'idle' | 'checking' | 'waiting' | 'restarting' | 'ready' | 'failed'; revision?: string }
export const RUNTIME_ACTIVATION_GET = 'zyra:runtime:activation:get'
export const RUNTIME_ACTIVATION_CHANGED = 'zyra:runtime:activation:changed'
