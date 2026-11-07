import type { AssistantModelInfo, AssistantReasoningEffort } from './contracts'
import { normalizeReasoningChoice, reasoningChoiceLabel } from '../../../../src/reasoning-choices.mjs'
export { reasoningChoiceLabel }

export const CHATGPT_REASONING_EFFORTS: readonly AssistantReasoningEffort[] = Object.freeze([
    'low',
    'medium',
    'high',
    'xhigh'
])

export const GPT_56_REASONING_EFFORTS: readonly AssistantReasoningEffort[] = Object.freeze([
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
])

function isDirectOpenAiModel(id: string): boolean {
    return id.startsWith('openai-codex/') || id.startsWith('openai/')
        || (!id.includes('/') && /^(?:gpt-|codex-)/i.test(id))
}
export function isAssistantReasoningEffort(value: unknown): value is AssistantReasoningEffort {
    return typeof value === 'string' && normalizeReasoningChoice(value) === value
}

export function isGpt56AssistantModel(model: string | Pick<AssistantModelInfo, 'id' | 'label'> | null | undefined): boolean {
    const id = typeof model === 'string' ? model : model?.id || ''
    if (id.includes('/') && !id.startsWith('openai-codex/') && !id.startsWith('openai/')) return false
    const value = typeof model === 'string' ? model : `${id} ${model?.label || ''}`
    return /(?:^|[/\s])gpt-5\.6(?:-|$)/i.test(value)
}

export function getAssistantModelReasoningEfforts(
    model: string | AssistantModelInfo | null | undefined
): AssistantReasoningEffort[] {
    if (typeof model !== 'string' && model?.reasoningStatus === 'unknown') return []
    if (typeof model !== 'string' && model?.supportedEfforts) {
        const supported = model.supportedEfforts.filter((effort) => (
            isAssistantReasoningEffort(effort)
        ))
        return [...supported]
    }
    const id = typeof model === 'string' ? model : model?.id || ''
    if (typeof model !== 'string' || !isDirectOpenAiModel(id)) return []
    return [...(isGpt56AssistantModel(model) ? GPT_56_REASONING_EFFORTS : CHATGPT_REASONING_EFFORTS)]
}

export function coerceAssistantReasoningEffortForModel(
    value: unknown,
    model: string | AssistantModelInfo | null | undefined
): AssistantReasoningEffort {
    const efforts = getAssistantModelReasoningEfforts(model)
    if (value === 'default' || efforts.length === 0) return 'default'
    const requested = isAssistantReasoningEffort(value) ? value : 'medium'
    if (typeof model !== 'string' && model?.supportedEfforts) return efforts.includes(requested) ? requested : 'default'
    if (isGpt56AssistantModel(model)) {
        const compatible = requested === 'off' || requested === 'none' || requested === 'minimal' ? 'low' : requested
        return efforts.includes(compatible) ? compatible : 'medium'
    }

    const compatible = requested === 'off' || requested === 'none' || requested === 'minimal'
        ? 'low'
        : requested === 'max'
            ? 'xhigh'
            : requested
    return efforts.includes(compatible) ? compatible : efforts[0]

}

/** Absence of capability metadata never means that reasoning is disabled. */
export function getAssistantModelReasoningChoices(model: string | AssistantModelInfo | null | undefined): AssistantReasoningEffort[] {
    return ['default', ...getAssistantModelReasoningEfforts(model).filter(effort => effort !== 'default')]
}
