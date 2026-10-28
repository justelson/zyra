import type { AssistantComposerDisabledReason } from './assistant-composer-types'

export type AssistantComposerUxMode = 'standard' | 'guided'

export type AssistantComposerUxTone = 'neutral' | 'info' | 'warning'

export type AssistantComposerCapabilities = {
    inputDisabled: boolean
    attachDisabled: boolean
    controlsLocked: boolean
    voiceDisabled: boolean
    canSend: boolean
    canStop: boolean
    sendDisabled: boolean
    showBusySendActions: boolean
    placeholder: string
    statusLabel: string
    detailLabel: string | null
    tone: AssistantComposerUxTone
}

const DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER = 'Message Zyra...'
const NO_SESSION_PLACEHOLDER = 'Select or start a chat to write here'
const GUIDED_INPUT_PLACEHOLDER = 'Choose an option above or write your own answer here'
const REVIEW_ANSWERS_PLACEHOLDER = 'Review your answers before finishing'

type DeriveAssistantComposerCapabilitiesArgs = {
    mode: AssistantComposerUxMode
    disabled: boolean
    disabledReason?: AssistantComposerDisabledReason | null
    isConnected: boolean
    isConnecting?: boolean
    isSending: boolean
    isThinking: boolean
    allowEmptySubmit: boolean
    hasContent: boolean
    voiceBusy?: boolean
    hasStopHandler?: boolean
    controlsLocked?: boolean
    attachmentsLocked?: boolean
    isResponding?: boolean
    isReviewStep?: boolean
}

export function deriveAssistantComposerDisabledReason(
    args: {
        sessionId?: string | null
        sessionMode?: 'work' | 'playground'
        projectPath?: string | null
    }
): AssistantComposerDisabledReason | null {
    const { sessionId, sessionMode, projectPath } = args
    if (!sessionId) return 'no-session'
    void sessionMode
    void projectPath
    return null
}

export function deriveAssistantComposerCapabilities(
    args: DeriveAssistantComposerCapabilitiesArgs
): AssistantComposerCapabilities {
    const {
        mode,
        disabled,
        disabledReason = null,
        isConnected,
        isConnecting = false,
        isSending,
        isThinking,
        allowEmptySubmit,
        hasContent,
        voiceBusy = false,
        hasStopHandler = false,
        controlsLocked = false,
        attachmentsLocked = false,
        isResponding = false,
        isReviewStep = false
    } = args

    const canSend = allowEmptySubmit || hasContent
    const canStop = mode === 'standard' && isThinking && hasStopHandler && isConnected && !disabled

    if (disabledReason === 'no-session') {
        return {
            inputDisabled: true,
            attachDisabled: true,
            controlsLocked: true,
            voiceDisabled: true,
            canSend: false,
            canStop: false,
            sendDisabled: true,
            showBusySendActions: false,
            placeholder: NO_SESSION_PLACEHOLDER,
            statusLabel: 'No active chat',
            detailLabel: 'Create or select a thread before composing a message.',
            tone: 'warning'
        }
    }

    if (disabled) {
        return {
            inputDisabled: true,
            attachDisabled: true,
            controlsLocked: true,
            voiceDisabled: true,
            canSend: false,
            canStop: false,
            sendDisabled: true,
            showBusySendActions: false,
            placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
            statusLabel: 'Assistant unavailable',
            detailLabel: 'Wait for the assistant to become available before sending messages.',
            tone: 'warning'
        }
    }

    if (mode === 'guided') {
        if (isConnecting && !isResponding) {
            return {
                inputDisabled: isReviewStep,
                attachDisabled: true,
                controlsLocked: true,
                voiceDisabled: true,
                canSend,
                canStop: false,
                sendDisabled: true,
                showBusySendActions: false,
                placeholder: REVIEW_ANSWERS_PLACEHOLDER,
                statusLabel: 'Connecting...',
                detailLabel: isReviewStep
                    ? 'Review stays available. Finish once the assistant is connected again.'
                    : 'Your draft stays here while the assistant session reconnects.',
                tone: 'info'
            }
        }

        if (!isConnected && !isResponding) {
            return {
                inputDisabled: isReviewStep,
                attachDisabled: true,
                controlsLocked: true,
                voiceDisabled: true,
                canSend,
                canStop: false,
                sendDisabled: true,
                showBusySendActions: false,
                placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
                statusLabel: 'Disconnected',
                detailLabel: isReviewStep
                    ? 'Review stays available. Reconnect before finishing.'
                    : 'Your draft stays here. Reconnect before sending the answer back.',
                tone: 'warning'
            }
        }

        if (isResponding) {
            return {
                inputDisabled: true,
                attachDisabled: true,
                controlsLocked: true,
                voiceDisabled: true,
                canSend: false,
                canStop: false,
                sendDisabled: true,
                showBusySendActions: false,
                placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
                statusLabel: 'Submitting answers',
                detailLabel: 'Your guided response is being sent back to the assistant.',
                tone: 'info'
            }
        }

        if (isReviewStep) {
            return {
                inputDisabled: true,
                attachDisabled: true,
                controlsLocked: true,
                voiceDisabled: true,
                canSend,
                canStop: false,
                sendDisabled: !canSend,
                showBusySendActions: false,
                placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
                statusLabel: 'Review answers',
                detailLabel: 'Use Back or Change to revise anything before finishing.',
                tone: 'info'
            }
        }

        return {
            inputDisabled: false,
            attachDisabled: attachmentsLocked,
            controlsLocked: true,
            voiceDisabled: false,
            canSend,
            canStop: false,
            sendDisabled: !canSend,
            showBusySendActions: false,
            placeholder: GUIDED_INPUT_PLACEHOLDER,
            statusLabel: 'Guided input',
            detailLabel: 'Pick one of the suggested answers or write a custom response below.',
            tone: 'info'
        }
    }

    if (isConnecting) {
        return {
            inputDisabled: false,
            attachDisabled: attachmentsLocked,
            controlsLocked,
            voiceDisabled: false,
            canSend,
            canStop: false,
            sendDisabled: !canSend,
            showBusySendActions: false,
            placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
            statusLabel: 'Getting ready',
            detailLabel: 'You can send now. Zyra will begin as soon as the session is ready.',
            tone: 'info'
        }
    }

    if (!isConnected) {
        return {
            inputDisabled: false,
            attachDisabled: attachmentsLocked,
            controlsLocked,
            voiceDisabled: true,
            canSend,
            canStop: false,
            sendDisabled: true,
            showBusySendActions: false,
            placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
            statusLabel: 'Disconnected',
            detailLabel: 'Drafting stays available. Reconnect before sending.',
            tone: 'warning'
        }
    }

    if (isThinking) {
        return {
            inputDisabled: false,
            attachDisabled: attachmentsLocked,
            controlsLocked,
            voiceDisabled: false,
            canSend,
            canStop,
            sendDisabled: !(canStop || canSend),
            showBusySendActions: canSend && !voiceBusy,
            placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
            statusLabel: 'Assistant is working',
            detailLabel: canSend
                ? 'Queue or force the next message while the current turn is still running.'
                : null,
            tone: 'info'
        }
    }

    if (isSending) {
        return {
            inputDisabled: false,
            attachDisabled: attachmentsLocked,
            controlsLocked,
            voiceDisabled: false,
            canSend,
            canStop: false,
            sendDisabled: true,
            showBusySendActions: false,
            placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
            statusLabel: 'Sending message',
            detailLabel: 'You can keep editing the draft while the current send completes.',
            tone: 'info'
        }
    }

    return {
        inputDisabled: false,
        attachDisabled: attachmentsLocked,
        controlsLocked,
        voiceDisabled: false,
        canSend,
        canStop: false,
        sendDisabled: !canSend,
        showBusySendActions: false,
        placeholder: DEFAULT_ASSISTANT_COMPOSER_PLACEHOLDER,
        statusLabel: 'Ready',
        detailLabel: hasContent ? 'Ready to send when you are.' : null,
        tone: 'neutral'
    }
}
