import type {
    AssistantBusyMessageMode,
    AssistantDefaultEffort,
    AssistantDefaultRuntimeMode,
    Settings
} from './settings'
import { isAssistantReasoningEffort } from '@shared/assistant/reasoning-efforts'
import { isAssistantRuntimeMode } from '@shared/assistant/contracts'

type AssistantDefaultsSubset = Pick<
    Settings,
    | 'assistantDefaultModel'
    | 'assistantDefaultPromptTemplate'
    | 'assistantDefaultRuntimeMode'
    | 'assistantDefaultEffort'
    | 'assistantDefaultFastMode'
    | 'assistantBusyMessageMode'
>

export function loadLegacyAssistantComposerDefaults(
    storageKey: string,
    defaults: AssistantDefaultsSubset
): Partial<Settings> {
    try {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as {
            model?: unknown
            runtimeMode?: unknown
            effort?: unknown
            fastModeEnabled?: unknown
        }
        return {
            assistantDefaultModel: typeof parsed.model === 'string' ? parsed.model.trim() : defaults.assistantDefaultModel,
            assistantDefaultRuntimeMode: parsed.runtimeMode == null
                ? defaults.assistantDefaultRuntimeMode
                : sanitizeAssistantDefaultRuntimeMode(parsed.runtimeMode),
            assistantDefaultEffort:
                isAssistantReasoningEffort(parsed.effort)
                    ? parsed.effort
                    : defaults.assistantDefaultEffort,
            assistantDefaultFastMode: typeof parsed.fastModeEnabled === 'boolean'
                ? parsed.fastModeEnabled
                : defaults.assistantDefaultFastMode
        }
    } catch {
        return {}
    }
}

export function sanitizeAssistantDefaultRuntimeMode(value: unknown): AssistantDefaultRuntimeMode {
    return isAssistantRuntimeMode(value) ? value : 'approval-required'
}

export function sanitizeAssistantDefaultEffort(value: unknown): AssistantDefaultEffort {
    return isAssistantReasoningEffort(value) ? value : 'medium'
}

export function getAssistantDefaultRuntimeModeLabel(value: AssistantDefaultRuntimeMode): string {
    if (value === 'full-access') return 'Full access'
    if (value === 'auto-review') return 'Auto review'
    if (value === 'edits-only') return 'Edits only'
    return 'Supervised'
}

export function getAssistantDefaultEffortLabel(value: AssistantDefaultEffort): string {
    switch (value) {
        case 'off':
            return 'Off'
        case 'none':
            return 'None'
        case 'minimal':
            return 'Minimal'
        case 'low':
            return 'Light'
        case 'medium':
            return 'Medium'
        case 'xhigh':
            return 'Extra High'
        case 'max':
            return 'Max'
        case 'high':
        default:
            return 'High'
    }
}

export function getAssistantDefaultSpeedLabel(fastModeEnabled: boolean): string {
    return fastModeEnabled ? 'Fast' : 'Standard'
}

export function getAssistantBusyMessageModeLabel(value: AssistantBusyMessageMode): string {
    return value === 'force' ? 'Force while busy' : 'Queue while busy'
}

export function getAssistantDefaultsPreview(settings: AssistantDefaultsSubset): string {
    const modelLabel = settings.assistantDefaultModel.trim() || 'Auto model'
    const parts = [
        modelLabel,
        getAssistantDefaultRuntimeModeLabel(settings.assistantDefaultRuntimeMode),
        getAssistantDefaultEffortLabel(settings.assistantDefaultEffort),
        getAssistantDefaultSpeedLabel(settings.assistantDefaultFastMode),
        getAssistantBusyMessageModeLabel(settings.assistantBusyMessageMode)
    ]

    if (settings.assistantDefaultPromptTemplate.trim()) {
        parts.push('Template set')
    }

    return parts.join(' • ')
}
