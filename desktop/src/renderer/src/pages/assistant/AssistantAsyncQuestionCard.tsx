import { useState, type ComponentProps } from 'react'
import { ChevronDown, MessageCircleQuestion } from 'lucide-react'
import { AssistantPendingUserInputPanel } from './AssistantPendingUserInputPanel'

type Props = ComponentProps<typeof AssistantPendingUserInputPanel> & { onDismiss?: (requestId: string) => Promise<void> | void; agentWorking?: boolean }
/** Answer-later questions remain beside the ordinary composer, never replacing its draft. */
export function AssistantAsyncQuestionCard({ onDismiss, agentWorking, ...props }: Props) {
    const [expanded, setExpanded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const request = props.pendingUserInputs[0]
    if (!request) return null
    return <div className="pointer-events-auto mx-auto mb-2 w-full max-w-[760px]" data-assistant-async-question="true">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--surface-divider)] bg-sparkle-card px-3 py-2 text-xs">
            <MessageCircleQuestion size={15} className="shrink-0 text-sparkle-text-muted" />
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sparkle-text">{request.questions[0]?.question || 'Question from the agent'}</span>
                <span className="text-sparkle-text-muted">Answer later{agentWorking ? ' · Agent is continuing' : ''}{props.pendingUserInputs.length > 1 ? ` · ${props.pendingUserInputs.length} requests` : ''}</span>
            </button>
            <button type="button" onClick={() => setExpanded(value => !value)} className="shrink-0 text-sparkle-text-secondary">{expanded ? 'Minimize' : 'Answer'}<ChevronDown size={12} className="ml-1 inline" /></button>
            {onDismiss ? <button type="button" disabled={props.responding} onClick={async () => { try { await onDismiss(request.requestId) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not dismiss this question.') } }} className="text-sparkle-text-muted disabled:opacity-40">Dismiss</button> : null}
        </div>
        {error ? <p role="alert" className="px-3 py-1 text-xs text-amber-200">{error}</p> : null}
        {expanded ? <div className="mt-2"><AssistantPendingUserInputPanel {...props} /></div> : null}
    </div>
}
