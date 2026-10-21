import type { AssistantReasoningEffort, AssistantRuntimeMode } from '@shared/assistant/contracts'
import { isAssistantReasoningEffort } from '@shared/assistant/reasoning-efforts'

export type AssistantRememberedChoices = { model: string; effort: AssistantReasoningEffort; runtimeMode: AssistantRuntimeMode }
export const ASSISTANT_REMEMBERED_CHOICES_KEY = 'zyra:composer:last-chosen:v1'
const modes = new Set(['approval-required', 'auto-review', 'edits-only', 'full-access'])
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
    if (options.strict && localStorage.getItem(ASSISTANT_REMEMBERED_CHOICES_KEY) !== serialized) throw new Error('Remembered choices were not saved.')
}
