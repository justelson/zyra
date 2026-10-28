import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantBusyMessageMode } from '@/lib/settings'
import { appOwnerRevision, registerAppQueueOwner, stopAppTurn } from './assistant-app-owner-state'
import { parseDevContextCompactionTestCommand } from '@shared/assistant/dev-context-compaction-test'
import type { AssistantComposerSendOptions, AssistantQueuedComposerMessage, ComposerContextFile } from './assistant-composer-types'
import { parseDevAssistantQueuePreviewCommand, type AssistantQueuePreviewCommand } from './assistant-queue-preview-protocol'
import {
    cloneComposerQueueValue,
    ASSISTANT_COMPOSER_QUEUE_CHANGED,
    ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY,
    createAssistantComposerQueueStorage,
    emptyAssistantComposerQueue,
    moveQueuedDispatch,
    type AssistantComposerQueueSnapshot,
    type AssistantComposerQueueStorage,
    type PendingComposerDispatch
} from './assistant-composer-queue-storage'

export type AssistantQueuedComposerSessionState = {
    sessionId: string
    threadState: string
    latestTurnState: string | null
    latestTurnId?: string | null
    pendingApprovalCount: number
    pendingUserInputCount: number
    compacting?: boolean
}

export function isAssistantQueuedComposerSessionBusy(state: AssistantQueuedComposerSessionState | null | undefined): boolean {
    return Boolean(state && (state.compacting || state.pendingApprovalCount > 0 || state.pendingUserInputCount > 0
        || state.latestTurnState === 'running' || ['starting', 'running', 'waiting'].includes(state.threadState)))
}

// Compatibility export for older consumers. Queue promotion no longer aborts.
export function resolveAssistantForceInterruptAttempt(_input: {
    messageId: string
    dispatchMode: AssistantComposerSendOptions['dispatchMode']
    previewOnly?: boolean
    sessionId: string
    sessionState: AssistantQueuedComposerSessionState | null | undefined
    selectedSessionId: string | null
    commandPending: boolean
    isThreadWorking: boolean
    activeTurnId: string | null
}): { key: string; turnId: string | undefined } | null {
    return null
}

export function useAssistantQueuedComposer(args: {
    selectedSessionId: string | null
    sessionStates: AssistantQueuedComposerSessionState[]
    isAssistantBusy: boolean
    commandPending: boolean
    isThreadWorking: boolean
    activeTurnId: string | null
    busyMessageMode: AssistantBusyMessageMode
    dispatchProfile?: string
    onSendingChange?: (sending: boolean) => void
    canDispatchPrompt?: (sessionId: string) => boolean
    dispatchPrompt: (sessionId: string, prompt: string, contextFiles: ComposerContextFile[], options: AssistantComposerSendOptions, canSubmit?: () => boolean) => Promise<boolean>
    interruptTurn: (turnId?: string, sessionId?: string) => Promise<void>
    queueStorage?: AssistantComposerQueueStorage
}) {
    const { selectedSessionId, sessionStates, isAssistantBusy, commandPending, isThreadWorking, activeTurnId,
        busyMessageMode, dispatchProfile, onSendingChange, canDispatchPrompt, dispatchPrompt } = args
    const storage = useMemo(() => args.queueStorage || createAssistantComposerQueueStorage(), [args.queueStorage])
    const startupErrorRef = useRef<string | null>(null)
    const needsRecoveryRef = useRef(false)
    const [snapshot, setSnapshot] = useState(() => {
        try {
            const recovered = storage.read()
            needsRecoveryRef.current = Object.values(recovered.entries).some(entries => entries.length > 0)
            return recovered
        } catch (error) {
            startupErrorRef.current = String(error)
            return emptyAssistantComposerQueue()
        }
    })
    const startupError = startupErrorRef.current
    const snapshotRef = useRef(snapshot)
    const [queuePersistenceError, setQueuePersistenceError] = useState(startupError)
    const [sendingCount, setSendingCount] = useState(0)
    const activeDispatchRef = useRef(new Map<string, string>())
    const dispatchEpochRef = useRef(new Map<string, number>())
    const liveStatesRef = useRef(sessionStates)
    liveStatesRef.current = sessionStates
    const busyTransitionsRef = useRef(new Map<string, { busy: boolean; revision: number }>())
    for (const state of sessionStates) {
        const busy = isAssistantQueuedComposerSessionBusy(state)
        const previous = busyTransitionsRef.current.get(state.sessionId)
        busyTransitionsRef.current.set(state.sessionId, { busy, revision: (previous?.revision || 0) + (previous && previous.busy !== busy ? 1 : 0) })
    }
    const awaitingTurnRef = useRef(new Map<string, { key: string; busyRevision: number }>())
    const mountedRef = useRef(true)
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
    useEffect(() => {
        if (startupError || !needsRecoveryRef.current) return
        try {
            // Persist recovery holds before subscribing to live updates. Otherwise a
            // detached dictation's live read could resume pre-crash entries implicitly.
            // Re-read so recovery never overwrites entries accepted since render.
            const recovered = storage.read()
            storage.write(recovered)
            needsRecoveryRef.current = false
            snapshotRef.current = recovered
            setSnapshot(recovered)
        } catch (error) { setQueuePersistenceError(`Could not save recovered queue holds: ${String(error)}`) }
    }, [startupError, storage])
    useEffect(() => {
        const changed = (event: Event) => {
            if ('key' in event && event.key !== null && event.key !== ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) return
            try {
                const next = storage.read({ recover: false })
                snapshotRef.current = next
                setSnapshot(next)
                setQueuePersistenceError(null)
            } catch (error) { setQueuePersistenceError(`Could not refresh queued messages: ${String(error)}`) }
        }
        window.addEventListener(ASSISTANT_COMPOSER_QUEUE_CHANGED, changed)
        window.addEventListener('storage', changed)
        return () => {
            window.removeEventListener(ASSISTANT_COMPOSER_QUEUE_CHANGED, changed)
            window.removeEventListener('storage', changed)
        }
    }, [storage])

    const commit = useCallback((next: AssistantComposerQueueSnapshot): boolean => {
        try {
            if (startupError) throw new Error(startupError)
            storage.write(next)
            snapshotRef.current = next
            if (mountedRef.current) { setSnapshot(next); setQueuePersistenceError(null) }
            return true
        } catch (error) {
            if (mountedRef.current) setQueuePersistenceError(`Could not save queued messages: ${String(error)}`)
            return false
        }
    }, [startupError, storage])

    const handleHoldQueue = useCallback((sessionId = selectedSessionId): boolean => {
        if (!sessionId) return false
        const current = snapshotRef.current
        dispatchEpochRef.current.set(sessionId, (dispatchEpochRef.current.get(sessionId) || 0) + 1)
        const next = { ...current, held: { ...current.held, [sessionId]: true } }
        const saved = commit(next)
        // Stop must gate dispatch synchronously, even when storage is unavailable.
        if (!saved) { snapshotRef.current = next; setSnapshot(next) }
        return saved
    }, [commit, selectedSessionId])

    const handleResumeQueue = useCallback((sessionId = selectedSessionId): boolean => {
        if (!sessionId || activeDispatchRef.current.has(sessionId)) return false
        const current = snapshotRef.current
        const saved = commit({ ...current, held: { ...current.held, [sessionId]: false } })
        if (saved) awaitingTurnRef.current.delete(sessionId)
        return saved
    }, [commit, selectedSessionId])

    const handleDispatchPrompt = useCallback(async (sessionId: string, prompt: string, files: ComposerContextFile[], options: AssistantComposerSendOptions) => {
        if (canDispatchPrompt && !canDispatchPrompt(sessionId)) return false
        const epoch = dispatchEpochRef.current.get(sessionId) || 0
        const canSubmit = () => (dispatchEpochRef.current.get(sessionId) || 0) === epoch && !snapshotRef.current.held[sessionId]
        if (!canSubmit()) return false
        setSendingCount(count => count + 1)
        onSendingChange?.(true)
        try { return await dispatchPrompt(sessionId, prompt, files, options, canSubmit) }
        catch { return false }
        finally {
            if (mountedRef.current) setSendingCount(count => count - 1)
            onSendingChange?.(false)
        }
    }, [canDispatchPrompt, dispatchPrompt, onSendingChange])

    const enqueue = useCallback((messages: PendingComposerDispatch[], prepend = false): boolean => {
        if (!selectedSessionId) return false
        try {
            // A detached dictation may retain an older hook. Merge into the current
            // durable queue rather than overwrite work accepted after that hook unmounted.
            const current = storage.read({ recover: false })
            const existing = current.entries[selectedSessionId] || []
            // Copy before acknowledging: edits to the cleared draft cannot mutate saved attachments/options.
            return commit({ ...current, entries: { ...current.entries,
                [selectedSessionId]: cloneComposerQueueValue(prepend ? [...messages, ...existing] : [...existing, ...messages]) } })
        } catch { return false }
    }, [commit, selectedSessionId, storage])

    const enqueuePreviewPrompt = useCallback((command: AssistantQueuePreviewCommand, files: ComposerContextFile[], options: AssistantComposerSendOptions) => {
        if (!selectedSessionId) return false
        return enqueue(Array.from({ length: command.count }, (_, index) => ({
            id: `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sessionId: selectedSessionId,
            prompt: command.count > 1 ? `${command.prompt} (${index + 1})` : command.prompt,
            contextFiles: files,
            options: { ...options, dispatchMode: command.dispatchMode === 'force' ? 'steer' : command.dispatchMode },
            previewOnly: true
        })), command.dispatchMode === 'force')
    }, [enqueue, selectedSessionId])

    const handleSendPrompt = useCallback(async (prompt: string, files: ComposerContextFile[], options: AssistantComposerSendOptions) => {
        if (!selectedSessionId) return false
        const profile = options.profile || dispatchProfile
        if (profile) options = { ...options, profile }
        if (parseDevContextCompactionTestCommand(prompt, { enabled: import.meta.env.DEV })) {
            return handleDispatchPrompt(selectedSessionId, prompt, files, options)
        }
        const preview = parseDevAssistantQueuePreviewCommand(prompt)
        if (preview) return enqueuePreviewPrompt(preview, files, options)
        const compacting = sessionStates.find(state => state.sessionId === selectedSessionId)?.compacting
        const current = snapshotRef.current
        const answerId = options.answerRequestId ? `answer-${options.answerRequestId}` : null
        const existingAnswer = answerId ? current.entries[selectedSessionId]?.find(entry => entry.id === answerId) : null
        if (existingAnswer) return existingAnswer.prompt === prompt && JSON.stringify(existingAnswer.contextFiles) === JSON.stringify(files)
        if (isAssistantBusy || compacting || current.held[selectedSessionId] || current.entries[selectedSessionId]?.length) {
            const requested = options.dispatchMode === 'immediate' || !options.dispatchMode ? busyMessageMode : options.dispatchMode
            const mode = compacting ? 'queue' : requested === 'force' ? 'steer' : requested
            return enqueue([{
                id: answerId || `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                sessionId: selectedSessionId, prompt, contextFiles: files, options: { ...options, targetTurnId: mode === 'steer' ? options.targetTurnId || activeTurnId || undefined : undefined, dispatchMode: mode }
            }], mode === 'steer')
        }
        return handleDispatchPrompt(selectedSessionId, prompt, files, options)
    }, [selectedSessionId, sessionStates, isAssistantBusy, busyMessageMode, dispatchProfile, activeTurnId, enqueue, enqueuePreviewPrompt, handleDispatchPrompt])

    const updateEntries = useCallback((update: (entries: PendingComposerDispatch[]) => PendingComposerDispatch[]): boolean => {
        if (!selectedSessionId || activeDispatchRef.current.has(selectedSessionId)) return false
        const current = snapshotRef.current
        const existing = current.entries[selectedSessionId] || []
        const next = update(existing)
        return next !== existing && commit({ ...current, entries: { ...current.entries, [selectedSessionId]: next } })
    }, [commit, selectedSessionId])

    const handleUpdateQueuedMessage = useCallback((messageId: string, prompt: string): boolean => {
        return updateEntries(entries => {
            const target = entries.find(entry => entry.id === messageId)
            if (!target || (!prompt.trim() && !target.contextFiles.length)) return entries
            return entries.map(entry => entry.id === messageId ? { ...entry, prompt } : entry)
        })
    }, [updateEntries])
    const handleDeleteQueuedMessage = useCallback((messageId: string) => updateEntries(entries => entries.some(entry => entry.id === messageId)
        ? entries.filter(entry => entry.id !== messageId) : entries), [updateEntries])
    const handleMoveQueuedMessage = useCallback((messageId: string, targetMessageId: string) => updateEntries(entries => moveQueuedDispatch(entries, messageId, targetMessageId)), [updateEntries])
    const handleSteerQueuedMessage = useCallback(async (messageId: string) => {
        // Only the chosen message is promoted; preceding queued messages retain their order/mode.
        updateEntries(entries => entries.some(entry => entry.id === messageId)
            ? entries.map(entry => entry.id === messageId ? { ...entry, options: { ...entry.options, dispatchMode: 'steer' as const } } : entry)
            : entries)
    }, [updateEntries])

    useEffect(() => {
        const states = new Map(sessionStates.map(state => [state.sessionId, state]))
        for (const [sessionId, messages] of Object.entries(snapshot.entries)) {
            const state = states.get(sessionId)
            // Unknown/missing chats are never dispatched from recovered local data.
            if (!state || state.compacting || activeDispatchRef.current.has(sessionId) || snapshotRef.current.held[sessionId]) continue
            const busy = isAssistantQueuedComposerSessionBusy(state)
                || (sessionId === selectedSessionId && (commandPending || isThreadWorking || isAssistantBusy))
            const awaited = awaitingTurnRef.current.get(sessionId)
            if (busy || awaited && (`${state.latestTurnId || ''}:${state.latestTurnState || ''}` !== awaited.key
                || (busyTransitionsRef.current.get(sessionId)?.revision || 0) > awaited.busyRevision)) {

                awaitingTurnRef.current.delete(sessionId)
            }
            const liveTurnId = state.latestTurnId || (sessionId === selectedSessionId ? activeTurnId : null)
            const steer = state.latestTurnState === 'running' ? messages.find(entry => !entry.previewOnly && entry.options.dispatchMode === 'steer'
                && (!entry.options.targetTurnId || entry.options.targetTurnId === liveTurnId)) : undefined
            if (!steer && (busy || awaitingTurnRef.current.has(sessionId))) continue
            const next = steer || messages.find(entry => !entry.previewOnly)
            if (!next || (canDispatchPrompt && !canDispatchPrompt(sessionId))) continue
            // Set the lock before any Promise boundary. Persisted entry remains until acceptance.
            activeDispatchRef.current.set(sessionId, next.id)
            const beforeTurn = `${state.latestTurnId || ''}:${state.latestTurnState || ''}`
            const beforeBusyRevision = busyTransitionsRef.current.get(sessionId)?.revision || 0
            void (async () => {
                const success = await handleDispatchPrompt(sessionId, next.prompt, cloneComposerQueueValue(next.contextFiles), {
                    ...next.options, dispatchMode: steer ? 'steer' : 'immediate'
                })
                const current = snapshotRef.current
                if (success) {
                    const afterState = liveStatesRef.current.find(entry => entry.sessionId === sessionId)
                    const finishedBeforeAck = afterState && !isAssistantQueuedComposerSessionBusy(afterState)
                        && (`${afterState.latestTurnId || ''}:${afterState.latestTurnState || ''}` !== beforeTurn
                            || (busyTransitionsRef.current.get(sessionId)?.revision || 0) > beforeBusyRevision)
                    if (!finishedBeforeAck) {
                        awaitingTurnRef.current.set(sessionId, { key: beforeTurn, busyRevision: beforeBusyRevision })
                    } else {
                        awaitingTurnRef.current.delete(sessionId)
                    }
                    const saved = commit({ ...current, entries: { ...current.entries,
                        [sessionId]: (current.entries[sessionId] || []).filter(entry => entry.id !== next.id) } })
                    if (!saved) handleHoldQueue(sessionId)
                } else handleHoldQueue(sessionId)

                activeDispatchRef.current.delete(sessionId)
            })()
        }
    }, [snapshot, sessionStates, selectedSessionId, activeTurnId, commandPending, isThreadWorking, isAssistantBusy, canDispatchPrompt, handleDispatchPrompt, commit, handleHoldQueue])

    useEffect(() => registerAppQueueOwner({
        inspect: sessionId => {
            const current = snapshotRef.current
            return { owner: 'Desktop-profile-local queue', sessionId,
                revision: appOwnerRevision(`queue:${sessionId}`, { entries: current.entries[sessionId] || [], held: !!current.held[sessionId] }),
                held: !!current.held[sessionId], sendingId: activeDispatchRef.current.get(sessionId) || null,
                entries: (current.entries[sessionId] || []).map(entry => ({ id: entry.id, prompt: entry.prompt, options: entry.options, previewOnly: entry.previewOnly,
                    contextFiles: entry.contextFiles.map(file => ({ id: file.id, name: file.name, path: file.path, kind: file.kind, contentLength: file.content?.length || 0, hasInlineImage: !!file.previewDataUrl })) })) }
        },
        operate: async (sessionId, operation, input, expectedRevision) => {
            if (!liveStatesRef.current.some(state => state.sessionId === sessionId)) throw new Error('The canonical queue Chat is unavailable.')
            const current = snapshotRef.current
            if (operation === 'read') {
                const entry = (current.entries[sessionId] || []).find(item => item.id === input.messageId)
                if (!entry) throw new Error('Choose an exact saved queue message.')
                return { id: entry.id, prompt: entry.prompt, options: entry.options, contextFiles: entry.contextFiles.map(({ previewDataUrl, ...file }) => ({ ...file, hasInlineImage: !!previewDataUrl })) }
            }
            if (operation === 'stop') return stopAppTurn(sessionId, String(input.turnId || ''))
            const revision = appOwnerRevision(`queue:${sessionId}`, { entries: current.entries[sessionId] || [], held: !!current.held[sessionId] })
            if (expectedRevision !== revision) throw new Error('Queue revision changed. Inspect before editing or resuming.')
            if (operation === 'hold') { if (!handleHoldQueue(sessionId)) throw new Error('Queue held in memory, but persistence failed.'); return { held: true, sessionId } }
            if (operation === 'resume') { if (!handleResumeQueue(sessionId)) throw new Error('Queue Resume was not accepted.'); return { held: false, sessionId, resumed: true } }
            if (activeDispatchRef.current.has(sessionId)) throw new Error('Wait for the in-flight queue acknowledgement before editing.')
            const entries = current.entries[sessionId] || [], target = entries.find(entry => entry.id === input.messageId)
            if (!target) throw new Error('Choose an exact saved queue message.')
            if (!handleHoldQueue(sessionId)) throw new Error('Could not persist a safe queue hold before editing.')
            let next = entries
            if (operation === 'update') {
                if (typeof input.prompt !== 'string' || (!input.prompt.trim() && !target.contextFiles.length)) throw new Error('Provide a nonempty message or retain its attachments.')
                next = entries.map(entry => entry.id === target.id ? { ...entry, prompt: input.prompt as string } : entry)
            } else if (operation === 'remove') next = entries.filter(entry => entry.id !== target.id)
            else if (operation === 'move') {
                if (!!input.before === !!input.after) throw new Error('Choose exactly one before or after message.')
                const neighborId = input.before || input.after
                if (!entries.some(entry => entry.id === neighborId) || neighborId === target.id) throw new Error('Choose a different saved queue neighbor.')
                next = entries.filter(entry => entry.id !== target.id)
                next.splice(next.findIndex(entry => entry.id === neighborId) + (input.after ? 1 : 0), 0, target)
            } else throw new Error('Unsupported queue operation.')
            const latest = snapshotRef.current
            if (!commit({ ...latest, entries: { ...latest.entries, [sessionId]: next } })) throw new Error('The queue edit could not be saved. The original remains held.')
            return { sessionId, changedMessageId: target.id, held: true, persisted: true }
        }
    }), [commit, handleHoldQueue, handleResumeQueue])

    const selectedMessages = selectedSessionId ? snapshot.entries[selectedSessionId] || [] : []
    const queueHeld = Boolean(selectedSessionId && snapshot.held[selectedSessionId])
    const selectedState = sessionStates.find(state => state.sessionId === selectedSessionId)
    const selectedCompacting = selectedState?.compacting
    const selectedTurnId = selectedState?.latestTurnId || activeTurnId
    const queuedComposerMessageItems = useMemo<AssistantQueuedComposerMessage[]>(() => selectedMessages.map(entry => ({
        id: entry.id, prompt: entry.prompt, contextFiles: cloneComposerQueueValue(entry.contextFiles),
        dispatchMode: selectedState?.latestTurnState === 'running' && (entry.options.dispatchMode === 'steer' || entry.options.dispatchMode === 'force')
            && (!entry.options.targetTurnId || entry.options.targetTurnId === selectedTurnId) ? 'steer' : 'queue',
        status: activeDispatchRef.current.get(selectedSessionId || '') === entry.id ? 'sending' : queueHeld ? 'held' : selectedCompacting ? 'compacting' : 'queued'
    })), [selectedMessages, queueHeld, selectedCompacting, selectedSessionId, selectedState?.latestTurnState, selectedTurnId, sendingCount])

    return {
        sendingComposerPrompt: sendingCount > 0,
        queuedComposerMessageCount: selectedMessages.length,
        queuedComposerMessageItems,
        queueHeld,
        queuePersistenceError,
        handleSendPrompt,
        handleSteerQueuedMessage,
        handleForceQueuedMessage: handleSteerQueuedMessage,
        handleUpdateQueuedMessage,
        handleHoldQueue,
        handleResumeQueue,
        handleDeleteQueuedMessage,
        handleMoveQueuedMessage
    }
}
