import { useEffect, useState, type ComponentProps } from 'react'
import { ChevronDown, MessageCircleQuestion } from 'lucide-react'
import { AssistantPendingUserInputPanel } from './AssistantPendingUserInputPanel'
import { AssistantComposerAttentionShelf } from './AssistantComposerAttentionShelf'

type Props = ComponentProps<typeof AssistantPendingUserInputPanel> & {
    onDismiss?: (requestId: string) => Promise<void> | void
    agentWorking?: boolean
    expanded?: boolean
    onExpandedChange?: (expanded: boolean) => void
}

/** Arrival only reveals a tray. Explicit Answer opens the one question dock. */
export function AssistantAsyncQuestionCard({ onDismiss, expanded: controlledExpanded, onExpandedChange, ...props }: Props) {
    const [localExpanded, setLocalExpanded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dismissing, setDismissing] = useState(false)
    const request = props.pendingUserInputs[0]
    const expanded = controlledExpanded ?? localExpanded
    const setExpanded = (value: boolean) => {
        setLocalExpanded(value)
        onExpandedChange?.(value)
    }
    useEffect(() => { setError(null); setLocalExpanded(false) }, [request?.requestId, props.sessionId])
    const count = props.pendingUserInputs.reduce((sum, input) => sum + input.questions.length, 0)
    if (!request) return null
    const dismiss = async () => {
        if (!onDismiss || props.responding || dismissing) return
        setDismissing(true)
        setError(null)
        try {
            await onDismiss(request.requestId)
            setExpanded(false)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not dismiss this question.')
        } finally { setDismissing(false) }
    }
    const dismissButton = onDismiss ? <button type="button" disabled={props.responding || dismissing} onClick={() => void dismiss()} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-sparkle-text-muted transition-colors hover:bg-white/5 hover:text-sparkle-text disabled:opacity-40">{dismissing ? 'Skipping…' : 'Skip'}</button> : null
    const errorMessage = error ? <p role="alert" className="px-3 pb-2 text-xs text-amber-200">{error}</p> : null
    if (!expanded) return (
        <AssistantComposerAttentionShelf title="Questions">
            <div data-assistant-async-question="true" className="flex flex-wrap items-center pr-2">
                <button type="button" aria-label="Answer agent question" title="Answer" aria-expanded={false} onClick={() => setExpanded(true)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5">
                    <MessageCircleQuestion size={13} />
                    <span className="truncate">{count > 1 ? `Agent needs to know ${count} things` : request.questions[0]?.question || 'Question from the agent'}</span>
                </button>
                {props.pendingUserInputs.length === 1 && dismissButton}
                {errorMessage}
            </div>
        </AssistantComposerAttentionShelf>
    )
    return (
        <div className="pointer-events-auto mx-auto w-full max-w-[760px]" data-assistant-async-question="true" data-assistant-composer-hitbox="true">
            <AssistantPendingUserInputPanel {...props} titleActions={<>
                {dismissButton}
                <button type="button" aria-label="Back to message" title="Back to message" onClick={() => setExpanded(false)} className="rounded p-1 hover:bg-white/5"><ChevronDown size={14} /></button>
            </>} onRespond={async (...args) => {
                await props.onRespond(...args)
                setExpanded(false)
            }} />
            {errorMessage}
        </div>
    )
}
