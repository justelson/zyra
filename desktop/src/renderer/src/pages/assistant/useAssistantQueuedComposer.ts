import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantBusyMessageMode } from '@/lib/settings'
import { parseDevContextCompactionTestCommand } from '@shared/assistant/dev-context-compaction-test'
import type {
    AssistantComposerSendOptions,
    AssistantQueuedComposerMessage,
    ComposerContextFile
} from './assistant-composer-types'
import { parseDevAssistantQueuePreviewCommand, type AssistantQueuePreviewCommand } from './assistant-queue-preview-protocol'

type PendingComposerDispatch = {
    id: string
    sessionId: string
    prompt: string
    contextFiles: ComposerContextFile[]
    options: AssistantComposerSendOptions
    previewOnly?: boolean
}

export type AssistantQueuedComposerSessionState = {
    sessionId: string
    threadState: string
    latestTurnState: string | null
    pendingApprovalCount: number
    pendingUserInputCount: number
}

function removeQueuedDispatchById(
    entries: PendingComposerDispatch[],
    messageId: string
): PendingComposerDispatch[] {
    return entries.filter((entry) => entry.id !== messageId)
}

function moveQueuedDispatch(
    entries: PendingComposerDispatch[],
    messageId: string,
    targetMessageId: string
): PendingComposerDispatch[] {
    const fromIndex = entries.findIndex((entry) => entry.id === messageId)
    const targetIndex = entries.findIndex((entry) => entry.id === targetMessageId)
    if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return entries

    const nextEntries = [...entries]
    const [movedEntry] = nextEntries.splice(fromIndex, 1)
    if (!movedEntry) return entries

    const adjustedTargetIndex = nextEntries.findIndex((entry) => entry.id === targetMessageId)
    if (adjustedTargetIndex === -1) return entries
    nextEntries.splice(fromIndex < targetIndex ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, movedEntry)
    return nextEntries
}

function createQueuedDispatchId(prefix: 'queued' | 'preview'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneContextFiles(contextFiles: ComposerContextFile[]): ComposerContextFile[] {
    return contextFiles.map((file) => ({ ...file }))
}

export function isAssistantQueuedComposerSessionBusy(sessionState: AssistantQueuedComposerSessionState | null | undefined): boolean {
    if (!sessionState) return false
    if (sessionState.pendingApprovalCount > 0 || sessionState.pendingUserInputCount > 0) return true
    if (sessionState.latestTurnState === 'running') return true
    return sessionState.threadState === 'starting'
        || sessionState.threadState === 'running'
        || sessionState.threadState === 'waiting'
}

export function useAssistantQueuedComposer(args: {
    selectedSessionId: string | null
    sessionStates: AssistantQueuedComposerSessionState[]
    isAssistantBusy: boolean
    commandPending: boolean
    isThreadWorking: boolean
    activeTurnId: string | null
    busyMessageMode: AssistantBusyMessageMode
    onSendingChange?: (sending: boolean) => void
    dispatchPrompt: (
        sessionId: string,
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => Promise<boolean>
    interruptTurn: (turnId?: string, sessionId?: string) => Promise<void>
}) {
    const {
        selectedSessionId,
        sessionStates,
        isAssistantBusy,
        commandPending,
        isThreadWorking,
        activeTurnId,
        busyMessageMode,
        onSendingChange,
        dispatchPrompt,
        interruptTurn
    } = args

    const [queuedComposerMessagesBySessionId, setQueuedComposerMessagesBySessionId] = useState<Record<string, PendingComposerDispatch[]>>({})
    const [pausedQueueMessageIdBySessionId, setPausedQueueMessageIdBySessionId] = useState<Record<string, string | null>>({})
    const [sendingComposerPrompt, setSendingComposerPrompt] = useState(false)
    const queueDrainSessionIdsRef = useRef<Set<string>>(new Set())

    const queuedComposerMessages = selectedSessionId ? (queuedComposerMessagesBySessionId[selectedSessionId] || []) : []
    const queuedComposerMessageCount = queuedComposerMessages.length
    const queuedComposerMessageItems = useMemo<AssistantQueuedComposerMessage[]>(() => (
        queuedComposerMessages.map((entry) => ({
            id: entry.id,
            prompt: entry.prompt,
            contextFiles: entry.contextFiles.map((file) => ({ ...file })),
            dispatchMode: entry.options.dispatchMode === 'force' ? 'force' : 'queue',
            status: pausedQueueMessageIdBySessionId[selectedSessionId || ''] === entry.id ? 'paused' : 'queued'
        }))
    ), [pausedQueueMessageIdBySessionId, queuedComposerMessages, selectedSessionId])

    const handleDispatchPrompt = useCallback(async (
        sessionId: string,
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => {
        setSendingComposerPrompt(true)
        onSendingChange?.(true)
        try {
            return await dispatchPrompt(sessionId, prompt, contextFiles, options)
        } finally {
            setSendingComposerPrompt(false)
            onSendingChange?.(false)
        }
    }, [dispatchPrompt, onSendingChange])

    const enqueuePreviewPrompt = useCallback((
        command: AssistantQueuePreviewCommand,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => {
        if (!selectedSessionId) return false

        const nextDispatches: PendingComposerDispatch[] = Array.from({ length: command.count }, (_, index) => ({
            id: createQueuedDispatchId('preview'),
            sessionId: selectedSessionId,
            prompt: command.count > 1 ? `${command.prompt} (${index + 1})` : command.prompt,
            contextFiles: cloneContextFiles(contextFiles),
            options: {
                ...options,
                dispatchMode: command.dispatchMode
            },
            previewOnly: true
        }))

        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[selectedSessionId] || []
            return {
                ...current,
                [selectedSessionId]: command.dispatchMode === 'force'
                    ? [...nextDispatches, ...existing]
                    : [...existing, ...nextDispatches]
            }
        })
        return true
    }, [selectedSessionId])

    const restoreQueuedMessage = useCallback((sessionId: string, message: PendingComposerDispatch) => {
        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[sessionId] || []
            if (existing.some((entry) => entry.id === message.id)) return current
            return {
                ...current,
                [sessionId]: [message, ...existing]
            }
        })
    }, [])

    const dispatchQueuedMessage = useCallback(async (
        sessionId: string,
        queuedMessage: PendingComposerDispatch,
        dispatchMode: 'immediate' | 'force' = 'immediate'
    ) => {
        if (queuedMessage.previewOnly) return true

        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[sessionId] || []
            if (!existing.some((entry) => entry.id === queuedMessage.id)) return current
            return {
                ...current,
                [sessionId]: removeQueuedDispatchById(existing, queuedMessage.id)
            }
        })
        setPausedQueueMessageIdBySessionId((current) => ({
            ...current,
            [sessionId]: null
        }))

        const success = await handleDispatchPrompt(
            queuedMessage.sessionId,
            queuedMessage.prompt,
            queuedMessage.contextFiles,
            {
                ...queuedMessage.options,
                dispatchMode
            }
        )

        if (success) return true

        restoreQueuedMessage(sessionId, queuedMessage)
        setPausedQueueMessageIdBySessionId((current) => ({
            ...current,
            [sessionId]: queuedMessage.id
        }))
        return false
    }, [handleDispatchPrompt, restoreQueuedMessage])

    const enqueueBusyPrompt = useCallback(async (
        mode: 'queue' | 'force',
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => {
        if (!selectedSessionId) return false

        const nextDispatch: PendingComposerDispatch = {
            id: createQueuedDispatchId('queued'),
            sessionId: selectedSessionId,
            prompt,
            contextFiles: cloneContextFiles(contextFiles),
            options: {
                ...options,
                dispatchMode: mode
            }
        }

        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[selectedSessionId] || []
            return {
                ...current,
                [selectedSessionId]: mode === 'force' ? [nextDispatch, ...existing] : [...existing, nextDispatch]
            }
        })
        setPausedQueueMessageIdBySessionId((current) => ({
            ...current,
            [selectedSessionId]: null
        }))

        if (mode === 'force' && (commandPending || isThreadWorking)) {
            try {
                await interruptTurn(activeTurnId || undefined, selectedSessionId)
            } catch {}
        }
        return true
    }, [activeTurnId, commandPending, interruptTurn, isThreadWorking, selectedSessionId])

    const handleSendPrompt = useCallback(async (
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => {
        if (!selectedSessionId) return false
        const compactionTestCommand = parseDevContextCompactionTestCommand(prompt, { enabled: import.meta.env.DEV })
        if (compactionTestCommand) {
            return handleDispatchPrompt(selectedSessionId, prompt, contextFiles, options)
        }

        const previewCommand = parseDevAssistantQueuePreviewCommand(prompt)
        if (previewCommand) return enqueuePreviewPrompt(previewCommand, contextFiles, options)

        if (isAssistantBusy) {
            const dispatchMode = options.dispatchMode === 'force' || options.dispatchMode === 'queue'
                ? options.dispatchMode
                : busyMessageMode
            return enqueueBusyPrompt(dispatchMode, prompt, contextFiles, options)
        }
        return handleDispatchPrompt(selectedSessionId, prompt, contextFiles, options)
    }, [busyMessageMode, enqueueBusyPrompt, enqueuePreviewPrompt, handleDispatchPrompt, isAssistantBusy, selectedSessionId])

    const handleForceQueuedMessage = useCallback(async (messageId: string) => {
        if (!selectedSessionId) return

        let hasTargetMessage = false
        let targetIsPreviewOnly = false
        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[selectedSessionId] || []
            const targetIndex = existing.findIndex((entry) => entry.id === messageId)
            if (targetIndex === -1) return current

            hasTargetMessage = true
            targetIsPreviewOnly = Boolean(existing[targetIndex]?.previewOnly)
            const nextQueuedMessages: PendingComposerDispatch[] = existing.map((entry, index) => (
                targetIsPreviewOnly
                    ? entry.id === messageId
                        ? {
                            ...entry,
                            options: {
                                ...entry.options,
                                dispatchMode: 'force' as const
                            }
                        }
                        : entry
                    : index <= targetIndex
                    ? {
                        ...entry,
                        options: {
                            ...entry.options,
                            dispatchMode: 'force' as const
                        }
                    }
                    : entry
            ))

            return {
                ...current,
                [selectedSessionId]: nextQueuedMessages
            }
        })

        if (!hasTargetMessage || targetIsPreviewOnly) return

        setPausedQueueMessageIdBySessionId((current) => ({
            ...current,
            [selectedSessionId]: null
        }))

        if (commandPending || isThreadWorking) {
            try {
                await interruptTurn(activeTurnId || undefined, selectedSessionId)
            } catch {}
        }
    }, [activeTurnId, commandPending, interruptTurn, isThreadWorking, selectedSessionId])

    const handleDeleteQueuedMessage = useCallback((messageId: string) => {
        if (!selectedSessionId) return

        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[selectedSessionId] || []
            if (!existing.some((entry) => entry.id === messageId)) return current
            return {
                ...current,
                [selectedSessionId]: removeQueuedDispatchById(existing, messageId)
            }
        })

        setPausedQueueMessageIdBySessionId((current) => {
            if (current[selectedSessionId] !== messageId) return current
            return {
                ...current,
                [selectedSessionId]: null
            }
        })
    }, [selectedSessionId])

    const handleMoveQueuedMessage = useCallback((messageId: string, targetMessageId: string) => {
        if (!selectedSessionId || messageId === targetMessageId) return

        setQueuedComposerMessagesBySessionId((current) => {
            const existing = current[selectedSessionId] || []
            const moved = moveQueuedDispatch(existing, messageId, targetMessageId)
            if (moved === existing) return current
            return {
                ...current,
                [selectedSessionId]: moved
            }
        })
    }, [selectedSessionId])

    useEffect(() => {
        const sessionStateById = new Map(sessionStates.map((sessionState) => [sessionState.sessionId, sessionState]))

        for (const [sessionId, queuedMessages] of Object.entries(queuedComposerMessagesBySessionId)) {
            if (queueDrainSessionIdsRef.current.has(sessionId)) continue
            if (isAssistantQueuedComposerSessionBusy(sessionStateById.get(sessionId))) continue

            const nextQueuedMessage = queuedMessages.find((entry) => !entry.previewOnly)
            if (!nextQueuedMessage) continue
            if (pausedQueueMessageIdBySessionId[sessionId] === nextQueuedMessage.id) continue

            queueDrainSessionIdsRef.current.add(sessionId)
            void (async () => {
                try {
                    await dispatchQueuedMessage(sessionId, nextQueuedMessage, 'immediate')
                } finally {
                    queueDrainSessionIdsRef.current.delete(sessionId)
                }
            })()
        }
    }, [
        dispatchQueuedMessage,
        pausedQueueMessageIdBySessionId,
        queuedComposerMessagesBySessionId,
        sessionStates
    ])

    return {
        sendingComposerPrompt,
        queuedComposerMessageCount,
        queuedComposerMessageItems,
        handleSendPrompt,
        handleForceQueuedMessage,
        handleDeleteQueuedMessage,
        handleMoveQueuedMessage
    }
}
