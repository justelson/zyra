import type { AssistantSpeedPreference } from './assistant-model-groups'
import type { AssistantVoiceExecutionConfiguration } from '@shared/assistant/contracts'
import { composerServiceTier, supportsAssistantFastMode } from './assistant-model-groups'

export function buildAssistantVoiceExecutionConfiguration(input: {
    model: string
    runtimeMode: AssistantVoiceExecutionConfiguration['runtimeMode']
    effort: AssistantVoiceExecutionConfiguration['effort']
    interactionMode: AssistantVoiceExecutionConfiguration['interactionMode']
    profile?: string | null
    fastModeEnabled: AssistantSpeedPreference
}): AssistantVoiceExecutionConfiguration {
    return {
        model: input.model,
        runtimeMode: input.runtimeMode,
        effort: input.effort,
        interactionMode: input.interactionMode,
        profile: input.profile || 'default',
        serviceTier: supportsAssistantFastMode(input.model) ? composerServiceTier(input.fastModeEnabled) : undefined
    }
}
