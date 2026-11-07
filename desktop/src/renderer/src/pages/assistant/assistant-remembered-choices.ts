import type { AssistantReasoningEffort, AssistantRuntimeMode } from '@shared/assistant/contracts'
import { isAssistantReasoningEffort } from '@shared/assistant/reasoning-efforts'

export type AssistantRememberedChoices = { model: string; effort: AssistantReasoningEffort; runtimeMode: AssistantRuntimeMode }
export const ASSISTANT_REMEMBERED_CHOICES_KEY = 'zyra:composer:last-chosen:v1'
const modes = new Set(['approval-required', 'auto-review', 'edits-only', 'full-access'])
const MODEL_EFFORTS_KEY = 'zyra:composer:model-efforts:v1'
function readModelEfforts(): Array<[string, AssistantReasoningEffort]> {
    try {
        const values: unknown = JSON.parse(localStorage.getItem(MODEL_EFFORTS_KEY) || '[]')
        return Array.isArray(values) ? values.filter((value): value is [string, AssistantReasoningEffort] => Array.isArray(value)
            && typeof value[0] === 'string' && value[0].length <= 512 && isAssistantReasoningEffort(value[1])).slice(-100) : []
    } catch { return [] }
}
export function readRememberedModelEffort(model: string): AssistantReasoningEffort | undefined {
    return readModelEfforts().find(([id]) => id === model)?.[1]
}
export function rememberModelEffort(model: string, effort: AssistantReasoningEffort): void {
    if (!model || model.length > 512 || !isAssistantReasoningEffort(effort)) return
    localStorage.setItem(MODEL_EFFORTS_KEY, JSON.stringify([...readModelEfforts().filter(([id]) => id !== model), [model, effort]].slice(-100)))
}
export function normalizeRememberedChoices(value: unknown): AssistantRememberedChoices | null {
    if (!value || typeof value !== 'object') return null
    const entry = value as Partial<AssistantRememberedChoices>
    return typeof entry.model === 'string' && isAssistantReasoningEffort(entry.effort) && modes.has(String(entry.runtimeMode))
        ? { model: entry.model.trim(), effort: entry.effort, runtimeMode: entry.runtimeMode! } : null
}
/** Read once at chat creation. Existing drafts own their own copy. Legacy defaults seed only an absent record. */
export function readRememberedChoices(fallback?: AssistantRememberedChoices, options: { strict?: boolean } = {}): AssistantRememberedChoices {
    try {
        const saved = normalizeRememberedChoices(JSON.parse(localStorage.getItem(ASSISTANT_REMEMBERED_CHOICES_KEY) || 'null'))
        if (saved) return saved
        const settings = JSON.parse(localStorage.getItem('devscope-settings') || '{}')
        const seeded = normalizeRememberedChoices({ model: settings.assistantDefaultModel ?? fallback?.model ?? '',
            effort: settings.assistantDefaultEffort ?? fallback?.effort ?? 'medium', runtimeMode: settings.assistantDefaultRuntimeMode ?? fallback?.runtimeMode ?? 'approval-required' })
            || fallback || { model: '', effort: 'medium', runtimeMode: 'approval-required' }
        localStorage.setItem(ASSISTANT_REMEMBERED_CHOICES_KEY, JSON.stringify(seeded))
        return seeded
    } catch (error) { if (options.strict) throw error; return fallback || { model: '', effort: 'medium', runtimeMode: 'approval-required' } }
}
/** Only explicit chooser handlers call this. Never call it on hydration/navigation. */
export function rememberComposerChoices(choice: AssistantRememberedChoices, options: { strict?: boolean } = {}): void {
    const valid = normalizeRememberedChoices(choice)
    if (!valid) throw new Error('Invalid composer choices.')
    const serialized = JSON.stringify(valid)
    localStorage.setItem(ASSISTANT_REMEMBERED_CHOICES_KEY, serialized)
    rememberModelEffort(valid.model, valid.effort)
    if (options.strict && localStorage.getItem(ASSISTANT_REMEMBERED_CHOICES_KEY) !== serialized) throw new Error('Remembered choices were not saved.')
}
