import { useEffect, useState, type ComponentProps } from 'react'
import { ArrowLeft, MessageCircleQuestion } from 'lucide-react'
import { AssistantPendingUserInputPanel } from './AssistantPendingUserInputPanel'
import { AssistantComposerAttentionShelf } from './AssistantComposerAttentionShelf'

type Props = ComponentProps<typeof AssistantPendingUserInputPanel> & {
    onDismiss?: (requestId: string) => Promise<void> | void
    agentWorking?: boolean
    expanded?: boolean
    onExpandedChange?: (expanded: boolean) => void
}

/** Arrival only reveals a tray. Explicit Answer opens the one question dock. */
export function AssistantAsyncQuestionCard({ onDismiss, agentWorking, expanded: controlledExpanded, onExpandedChange, ...props }: Props) {
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
    const dismissButton = onDismiss ? <button type="button" disabled={props.responding || dismissing} onClick={() => void dismiss()} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-sparkle-text-muted transition-colors hover:bg-white/5 hover:text-sparkle-text disabled:opacity-40">{dismissing ? 'Dismissing…' : 'Dismiss'}</button> : null
    const errorMessage = error ? <p role="alert" className="px-3 pb-2 text-xs text-amber-200">{error}</p> : null
    if (!expanded) return (
        <AssistantComposerAttentionShelf title="Questions">
            <div data-assistant-async-question="true">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-sparkle-text-muted">
                    <MessageCircleQuestion size={13} aria-hidden="true" />
                    <span className="min-w-0 flex-1">Answer later{agentWorking ? ' · Agent is continuing' : ''}{props.pendingUserInputs.length > 1 ? ` · ${props.pendingUserInputs.length} requests` : ''}</span>
                    {dismissButton}
                </div>
                <button type="button" aria-label="Answer agent question" title="Answer" aria-expanded={false} onClick={() => setExpanded(true)} className="flex w-full items-center gap-3 px-3 pb-3 pt-1 text-left transition-colors hover:bg-white/[0.045]">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-sparkle-text">{request.questions[0]?.question || 'Question from the agent'}</span>
                    <span className="shrink-0 text-xs text-sparkle-text-secondary">Answer</span>
                </button>
                {errorMessage}
            </div>
        </AssistantComposerAttentionShelf>
    )
    return (
        <div className="pointer-events-auto mx-auto w-full max-w-[760px]" data-assistant-async-question="true" data-assistant-composer-hitbox="true">
            <AssistantPendingUserInputPanel {...props} onRespond={async (...args) => {
                await props.onRespond(...args)
                setExpanded(false)
            }} />
            <div className="flex items-center gap-2 px-3 pt-2 text-[11px] text-sparkle-text-muted">
                <button type="button" onClick={() => setExpanded(false)} className="inline-flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-white/5 hover:text-sparkle-text"><ArrowLeft size={12} aria-hidden="true" />Back to message</button>
                <span className="min-w-0 flex-1 truncate">Your message draft is saved{props.pendingUserInputs.length > 1 ? ` · ${props.pendingUserInputs.length} requests` : ''}</span>
                {dismissButton}
            </div>
            {errorMessage}
        </div>
    )
}
