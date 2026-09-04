import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, MessageSquareReply, X } from 'lucide-react'
import type { AssistantPendingUserInput } from '@shared/assistant/contracts'
import { formatAssistantUserInputAnswer } from './assistant-pending-user-input'

type QuestionResponseEntry = {
    id: string
    header: string
    question: string
    answer: string
}

function buildQuestionResponseEntries(input: AssistantPendingUserInput): QuestionResponseEntry[] {
    return input.questions.map((question, index) => ({
        id: question.id || `question-${index + 1}`,
        header: question.header || `Question ${index + 1}`,
        question: question.question,
        answer: formatAssistantUserInputAnswer(question, input.answers?.[question.id])
    }))
}

function AssistantQuestionResponseModal(props: {
    entries: QuestionResponseEntry[]
    onClose: () => void
}) {
    const titleId = useId()

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [props.onClose])

    if (typeof document === 'undefined') return null

    return createPortal(
        <div
            className="fixed inset-0 z-[2147482000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) props.onClose()
            }}
        >
            <section className="flex max-h-[min(760px,86vh)] w-[min(680px,94vw)] min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--surface-divider)] bg-[var(--color-card)] shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
                <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--surface-divider)] px-4">
                    <MessageSquareReply size={15} className="shrink-0 text-[var(--accent-primary)]" />
                    <div className="min-w-0 flex-1">
                        <h2 id={titleId} className="truncate text-[13px] font-semibold text-sparkle-text">Response to agent question{props.entries.length === 1 ? '' : 's'}</h2>
                        <p className="text-[10px] text-sparkle-text-muted">{props.entries.length} {props.entries.length === 1 ? 'answer' : 'answers'}</p>
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                        aria-label="Close full response"
                    >
                        <X size={15} />
                    </button>
                </header>
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5">
                    <div className="divide-y divide-[var(--surface-divider)]">
                        {props.entries.map((entry, index) => (
                            <section key={entry.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 py-5">
                                <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[10px] font-semibold tabular-nums text-sparkle-text-muted">{index + 1}</span>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sparkle-text-muted">{entry.header}</p>
                                    <p className="mt-1 text-[13px] leading-5 text-sparkle-text">{entry.question}</p>
                                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-sparkle-text-secondary">{entry.answer}</p>
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </section>
        </div>,
        document.body
    )
}

export function AssistantQuestionResponse(props: { input: AssistantPendingUserInput }) {
    const [open, setOpen] = useState(false)
    const entries = useMemo(() => buildQuestionResponseEntries(props.input), [props.input])
    const first = entries[0]
    if (!first) return null

    return (
        <div data-assistant-question-response="true">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-[var(--accent-primary)]">
                <MessageSquareReply size={11} />
                <span>Responded to agent question</span>
            </div>
            <p className="line-clamp-2 text-[12px] leading-5 text-sparkle-text-secondary">{first.question}</p>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-5 text-sparkle-text">{first.answer}</p>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sparkle-text-muted transition-colors hover:text-sparkle-text"
            >
                {entries.length > 1 ? `Show more (${entries.length - 1} more)` : 'View answer'}
                <ChevronRight size={11} />
            </button>
            {open ? <AssistantQuestionResponseModal entries={entries} onClose={() => setOpen(false)} /> : null}
        </div>
    )
}
