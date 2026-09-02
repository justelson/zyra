import { useMemo, useState } from 'react'
import { Terminal } from 'lucide-react'
import type { AssistantPendingUserInput } from '@shared/assistant/contracts'
import {
    PLAYGROUND_TERMINAL_ACCESS_APPROVE_OPTION,
    PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID,
    PLAYGROUND_TERMINAL_ACCESS_DECLINE_OPTION
} from '@shared/assistant/playground-terminal-access'
import { cn } from '@/lib/utils'

function findTerminalAccessQuestion(request: AssistantPendingUserInput) {
    return request.questions.find((question) => question.id === PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID) || request.questions[0] || null
}

export function getPendingTerminalAccessRequest(pendingUserInputs: AssistantPendingUserInput[]): AssistantPendingUserInput | null {
    return pendingUserInputs.find((request) => (
        request.status === 'pending'
        && request.questions.some((question) => question.id === PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID)
    )) || null
}

export function AssistantPendingTerminalAccessPanel(props: {
    request: AssistantPendingUserInput
    responding: boolean
    onRespond: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
    onSetTerminalAccess: (enabled: boolean) => void
    onSetRequestMuted: (muted: boolean) => void
}) {
    const {
        request,
        responding,
        onRespond,
        onSetTerminalAccess,
        onSetRequestMuted
    } = props
    const [dontAskAgain, setDontAskAgain] = useState(false)
    const question = useMemo(() => findTerminalAccessQuestion(request), [request])

    if (!question) return null

    const respond = async (enabled: boolean) => {
        if (responding) return
        onSetTerminalAccess(enabled)
        if (enabled) onSetRequestMuted(false)
        else if (dontAskAgain) onSetRequestMuted(true)
        await onRespond(request.requestId, {
            [PLAYGROUND_TERMINAL_ACCESS_DECISION_QUESTION_ID]: enabled
                ? PLAYGROUND_TERMINAL_ACCESS_APPROVE_OPTION
                : PLAYGROUND_TERMINAL_ACCESS_DECLINE_OPTION
        })
    }

    return (
        <div className="pointer-events-auto mx-auto w-full max-w-[760px]" data-assistant-composer-hitbox="true">
            <section className="overflow-hidden rounded-[20px] border border-amber-400/20 bg-sparkle-card shadow-[0_22px_70px_rgba(0,0,0,0.34)]" aria-label="Terminal access request">
                <div className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <div className="mt-0.5 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-amber-200"><Terminal size={17} /></div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-sparkle-text">Allow terminal access?</h3>
                        <p className="mt-1 text-xs leading-5 text-sparkle-text-secondary">{question.question || 'The assistant wants to use the terminal from the Playground folder.'}</p>
                    </div>
                </div>
                <div className="px-4 py-3 sm:px-5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-sparkle-text-secondary">
                        <input type="checkbox" checked={dontAskAgain} onChange={(event) => setDontAskAgain(event.target.checked)} className="h-3.5 w-3.5 rounded border-white/20 bg-transparent accent-emerald-400" />
                        <span>Don’t ask again while terminal access is off</span>
                    </label>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3 sm:px-5">
                    <button type="button" disabled={responding} onClick={() => void respond(false)} className={cn('h-8 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs font-medium text-sparkle-text-secondary hover:bg-white/[0.06]', responding && 'cursor-wait opacity-60')}>Continue without</button>
                    <button type="button" disabled={responding} onClick={() => void respond(true)} className={cn('h-8 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-100 hover:bg-emerald-500/15', responding && 'cursor-wait opacity-60')}>Allow terminal</button>
                </div>
            </section>
        </div>
    )
}
