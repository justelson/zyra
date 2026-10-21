import type {
    AssistantInteractionMode,
    AssistantReasoningEffort,
    AssistantRuntimeMode,
    AssistantThread
} from '@shared/assistant/contracts'
import type { Settings } from '@/lib/settings'
import { readRememberedChoices } from './assistant-remembered-choices'

type AssistantComposerConfigurationSettings = Pick<
    Settings,
    | 'assistantDefaultEffort'
    | 'assistantDefaultFastMode'
    | 'assistantDefaultModel'
    | 'assistantDefaultRuntimeMode'
>

export type AssistantComposerLaunchConfiguration = {
    activeModel: string | undefined
    activeEffort: AssistantReasoningEffort | null
    activeFastModeEnabled: boolean
    runtimeMode: AssistantRuntimeMode
    interactionMode: AssistantInteractionMode
    activeProfile: 'safe-dev' | 'yolo-fast'
}

export function resolveAssistantComposerLaunchConfiguration(input: {
    useSettingsDefaults: boolean
    settings: AssistantComposerConfigurationSettings
    thread: AssistantThread | null | undefined
    fallbackModel?: string
    interactionModeOverride?: AssistantInteractionMode | null
}): AssistantComposerLaunchConfiguration {
    if (input.useSettingsDefaults) {
        const remembered = readRememberedChoices({ model: input.settings.assistantDefaultModel, effort: input.settings.assistantDefaultEffort, runtimeMode: input.settings.assistantDefaultRuntimeMode })
        const runtimeMode = input.thread?.runtimeMode || remembered.runtimeMode
        return {
            activeModel: input.thread?.model || remembered.model || undefined,
            activeEffort: input.thread?.thinking || remembered.effort,
            activeFastModeEnabled: input.settings.assistantDefaultFastMode,
            runtimeMode,
            interactionMode: 'default',
            activeProfile: runtimeMode === 'full-access' ? 'yolo-fast' : 'safe-dev'
        }
    }

    const runtimeMode = input.thread?.runtimeMode || 'approval-required'
    return {
        activeModel: input.thread?.model || input.fallbackModel || undefined,
        activeEffort: input.thread?.thinking || input.thread?.latestTurn?.effort || null,
        activeFastModeEnabled: input.thread?.latestTurn?.serviceTier === 'fast',
        runtimeMode,
        interactionMode: 'default',
        activeProfile: runtimeMode === 'full-access' ? 'yolo-fast' : 'safe-dev'
    }
}
