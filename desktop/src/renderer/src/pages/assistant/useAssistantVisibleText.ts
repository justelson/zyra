import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AssistantTextStreamingMode } from '@/lib/settings'
import {
    shouldSnapRendererPresentation,
    useRendererVisibilitySnapshot
} from '@/lib/renderer-visibility'
import {
    assistantStreamPresentation,
    type AssistantStreamPresentationChannel
} from '@/lib/assistant/assistant-stream-presentation'

const STREAM_FRAME_INTERVAL_MS = 32
const CHUNKED_FRAME_INTERVAL_MS = 72
import { getAssistantInitialVisibleText, getAssistantStreamRevealCount, revealAssistantStreamText } from './assistant-text-reveal'
export { getAssistantInitialVisibleText, getAssistantStreamRevealCount, revealAssistantStreamText } from './assistant-text-reveal'

export type AssistantVisibleTextPresentation = {
    text: string
    presenting: boolean
    sourceStreaming: boolean
}

type AssistantVisibleTextOptions = {
    streamId: string
    channel: AssistantStreamPresentationChannel
    text: string
    streaming: boolean
    mode: AssistantTextStreamingMode
}

function hasActiveDocumentSelection(): boolean {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
    const selection = window.getSelection()
    return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed)
}

function shouldAvoidAnimatedStreaming(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resolvePresentationTarget(
    authoritativeText: string,
    streamText: string,
    streamRevision: number,
    streaming: boolean
): string {
    if (!streaming || streamRevision === 0) return authoritativeText
    return streamText
}

export function useAssistantVisibleText({
    streamId,
    channel,
    text,
    streaming,
    mode
}: AssistantVisibleTextOptions): AssistantVisibleTextPresentation {
    const subscribe = useCallback(
        (listener: () => void) => assistantStreamPresentation.subscribe(channel, streamId, listener),
        [channel, streamId]
    )
    const getSnapshot = useCallback(
        () => assistantStreamPresentation.getSnapshot(channel, streamId),
        [channel, streamId]
    )
    const streamSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const visibilitySnapshot = useRendererVisibilitySnapshot()
    const targetText = useMemo(
        () => resolvePresentationTarget(
            text,
            streamSnapshot.text,
            streamSnapshot.revision,
            streaming
        ),
        [streamSnapshot.revision, streamSnapshot.text, streaming, text]
    )
    const sourceStreaming = streaming && (streamSnapshot.revision === 0 || streamSnapshot.streaming)
    const initialVisibleText = getAssistantInitialVisibleText(targetText, sourceStreaming, mode)
    const [visibleText, setVisibleText] = useState(initialVisibleText)
    const [selectionPaused, setSelectionPaused] = useState(false)
    const visibleTextRef = useRef(initialVisibleText)
    const lastRevealAtRef = useRef(0)
    const activeStreamKeyRef = useRef({ key: `${channel}:${streamId}`, hasPresentedLiveStream: sourceStreaming })
    const handledResumeRevisionRef = useRef(visibilitySnapshot.resumeRevision)

    useLayoutEffect(() => {
        const nextStreamKey = `${channel}:${streamId}`
        if (activeStreamKeyRef.current.key === nextStreamKey) {
            if (sourceStreaming) activeStreamKeyRef.current.hasPresentedLiveStream = true
            if (activeStreamKeyRef.current.hasPresentedLiveStream || visibleTextRef.current === targetText) return
            // Hydrating a completed response must not animate a saved suffix.
            visibleTextRef.current = targetText
            setVisibleText(targetText)
            return
        }
        activeStreamKeyRef.current = { key: nextStreamKey, hasPresentedLiveStream: sourceStreaming }
        const nextVisibleText = getAssistantInitialVisibleText(targetText, sourceStreaming, mode)
        visibleTextRef.current = nextVisibleText
        lastRevealAtRef.current = 0
        setVisibleText(nextVisibleText)
    }, [channel, mode, sourceStreaming, streamId, targetText])

    useLayoutEffect(() => {
        const shouldSnap = shouldSnapRendererPresentation(
            visibilitySnapshot,
            handledResumeRevisionRef.current
        )
        handledResumeRevisionRef.current = visibilitySnapshot.resumeRevision
        if (!shouldSnap) return

        const latestSnapshot = assistantStreamPresentation.getSnapshot(channel, streamId)
        const latestTargetText = resolvePresentationTarget(
            text,
            latestSnapshot.text,
            latestSnapshot.revision,
            streaming
        )
        lastRevealAtRef.current = 0
        const snapText = getAssistantInitialVisibleText(latestTargetText, sourceStreaming, mode)
        if (visibleTextRef.current === snapText) return
        visibleTextRef.current = snapText
        setVisibleText(snapText)
    }, [
        channel,
        mode,
        sourceStreaming,
        streamId,
        streamSnapshot.revision,
        streaming,
        text,
        visibilitySnapshot.resumeRevision,
        visibilitySnapshot.visible
    ])

    useEffect(() => {
        if (!sourceStreaming) { setSelectionPaused(false); return }

        const syncSelectionState = () => setSelectionPaused(hasActiveDocumentSelection())
        syncSelectionState()
        document.addEventListener('selectionchange', syncSelectionState)
        return () => document.removeEventListener('selectionchange', syncSelectionState)
    }, [sourceStreaming])

    useEffect(() => {
        const latestSnapshot = assistantStreamPresentation.getSnapshot(channel, streamId)
        const presentationTargetText = resolvePresentationTarget(
            text,
            latestSnapshot.text,
            latestSnapshot.revision,
            streaming
        )
        const presentationSourceStreaming = streaming && (latestSnapshot.revision === 0 || latestSnapshot.streaming)

        if (selectionPaused) return
        if (!visibilitySnapshot.visible || shouldAvoidAnimatedStreaming() || !presentationTargetText.startsWith(visibleTextRef.current)) {
            const snapText = getAssistantInitialVisibleText(presentationTargetText, presentationSourceStreaming, mode)
            if (visibleTextRef.current !== snapText) {
                visibleTextRef.current = snapText
                setVisibleText(snapText)
            }
            return
        }
        if (visibleTextRef.current === presentationTargetText) return
        let cancelled = false
        let frameId = 0
        const frameInterval = mode === 'chunks' ? CHUNKED_FRAME_INTERVAL_MS : STREAM_FRAME_INTERVAL_MS
        const minimumRevealCount = getAssistantStreamRevealCount(
            presentationTargetText.length - visibleTextRef.current.length,
            mode,
            !presentationSourceStreaming
        )
        const pump = (timestamp: number) => {
            if (cancelled) return
            const elapsed = timestamp - lastRevealAtRef.current
            if (lastRevealAtRef.current > 0 && elapsed < frameInterval) {
                frameId = window.requestAnimationFrame(pump)
                return
            }

            lastRevealAtRef.current = timestamp
            const previousText = visibleTextRef.current
            const nextText = revealAssistantStreamText(
                visibleTextRef.current,
                presentationTargetText,
                mode,
                !presentationSourceStreaming,
                minimumRevealCount
            )
            if (nextText !== visibleTextRef.current) {
                visibleTextRef.current = nextText
                setVisibleText(nextText)
            }
            // An unfinished chunk waits for a source update, not an idle rAF loop.
            if (nextText !== presentationTargetText && nextText !== previousText) frameId = window.requestAnimationFrame(pump)
        }
        frameId = window.requestAnimationFrame(pump)
        return () => {
            cancelled = true
            window.cancelAnimationFrame(frameId)
        }
    }, [
        channel,
        mode,
        selectionPaused,
        sourceStreaming,
        streamId,
        streaming,
        targetText,
        text,
        visibilitySnapshot.resumeRevision,
        visibilitySnapshot.visible
    ])

    return {
        text: visibleText,
        presenting: sourceStreaming || visibleText !== targetText,
        sourceStreaming
    }
}
