import type { AssistantModelInfo } from '@shared/assistant/contracts'

const providerLabels: Record<string, string> = {
    'openai-codex': 'ChatGPT',
    openai: 'OpenAI API',
    anthropic: 'Claude API',
    'opencode-harness': 'OpenCode',
    opencode: 'OpenCode Zen'
}

export function groupAssistantModels<T extends Pick<AssistantModelInfo, 'id'>>(models: readonly T[]) {
    const groups = new Map<string, { id: string; label: string; models: Array<{ model: T; index: number }> }>()
    models.forEach((model, index) => {
        const provider = model.id.split('/')[0] || 'other'
        let group = groups.get(provider)
        if (!group) {
            group = { id: provider, label: providerLabels[provider] || provider, models: [] }
            groups.set(provider, group)
        }
        group.models.push({ model, index })
    })
    return [...groups.values()].sort((left, right) => {
        const order = ['openai-codex', 'openai', 'anthropic', 'opencode-harness', 'opencode']
        const leftIndex = order.indexOf(left.id)
        const rightIndex = order.indexOf(right.id)
        return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
            || left.label.localeCompare(right.label)
    })
}

export function defaultExpandedAssistantModelGroup(groups: ReturnType<typeof groupAssistantModels>, selectedModel: string): string | null {
    const smallestFirst = [...groups].sort((left, right) => left.models.length - right.models.length
        || Number(right.models.some(({ model }) => model.id === selectedModel)) - Number(left.models.some(({ model }) => model.id === selectedModel)))
    return smallestFirst[0]?.id || null
}

export function supportsAssistantFastMode(modelId: string): boolean {
    return modelId.startsWith('openai-codex/')
}

// Existing drafts store Standard/Fast as booleans.
export type AssistantSpeedPreference = boolean | 'ultrafast'

export function resolveComposerSpeed(model: Pick<AssistantModelInfo, 'id' | 'serviceTiers'> | null | undefined, preference: AssistantSpeedPreference): AssistantSpeedPreference {
    if (!model || !supportsAssistantFastMode(model.id) || !preference) return false
    if (preference === 'ultrafast') return model.serviceTiers?.includes('ultrafast') ? preference : false
    return model.serviceTiers?.includes('fast') === true
}

export function composerServiceTier(preference: AssistantSpeedPreference): 'fast' | 'ultrafast' | undefined {
    return preference === 'ultrafast' ? preference : preference ? 'fast' : undefined
}
