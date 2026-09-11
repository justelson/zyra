import { memo, useCallback } from 'react'
import { AssistantComposerView } from './AssistantComposerView'
import { buildAssistantVoiceExecutionConfiguration } from './assistant-voice-execution-configuration'
import { useAssistantComposerController } from './useAssistantComposerController'
import type { AssistantComposerProps } from './assistant-composer-types'

export type { AssistantComposerProps, AssistantComposerSendOptions, ComposerContextFile } from './assistant-composer-types'

function AssistantComposerImpl(props: AssistantComposerProps) {
    const controller = useAssistantComposerController(props)
    // Navigation mounts the composer too. Only prepare Voice after user intent,
    // so moving between setup, Settings and Chats does not spawn idle workers.
    const prepareRealtimeVoice = useCallback(() => {
        if (!props.onPrepareRealtimeVoice
            || props.realtimeVoiceDisabled
            || !props.sessionId
            || controller.loadedSessionId !== props.sessionId
            || !controller.selectedModel) return
        props.onPrepareRealtimeVoice(buildAssistantVoiceExecutionConfiguration({
            model: controller.selectedModel,
            runtimeMode: controller.selectedRuntimeMode,
            effort: controller.selectedEffort,
            interactionMode: controller.selectedInteractionMode,
            profile: controller.zyraProfile,
            fastModeEnabled: controller.fastModeEnabled
        }))
    }, [
        controller.fastModeEnabled,
        controller.loadedSessionId,
        controller.selectedEffort,
        controller.selectedInteractionMode,
        controller.selectedModel,
        controller.selectedRuntimeMode,
        controller.zyraProfile,
        props.onPrepareRealtimeVoice,
        props.projectPath,
        props.realtimeVoiceDisabled,
        props.sessionId
    ])
    return (
        <AssistantComposerView
            controller={controller}
            realtimeVoiceDisabled={props.realtimeVoiceDisabled}
            onPrepareRealtimeVoice={prepareRealtimeVoice}
            onStartRealtimeVoice={props.onStartRealtimeVoice}
        />
    )
}

export const AssistantComposer = memo(AssistantComposerImpl)
