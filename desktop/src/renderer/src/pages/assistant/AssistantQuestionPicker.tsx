import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'
import { cn } from '@/lib/utils'

export function AssistantQuestionPicker({ requestId, currentIndex, label, questions, disabled, onChoose }: {
    requestId: string
    currentIndex: number
    label: string
    questions: Array<{ index: number; question: { id: string; header: string; question: string }; answer: string; complete: boolean }>
    disabled: boolean
    onChoose: (index: number) => void
}) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLButtonElement>(null)
    const close = useCallback(() => setOpen(false), [])
    useEffect(close, [close, requestId, currentIndex, disabled])

    if (questions.length < 2) return <span className="tabular-nums">{label}</span>

    return <>
        <button ref={anchorRef} type="button" disabled={disabled} aria-label="Choose question" aria-haspopup="menu" aria-expanded={open && !disabled} title="Switch question" onClick={() => setOpen(value => !value)} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setOpen(true)
            }
        }} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 tabular-nums transition-colors hover:bg-white/5 hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sparkle-text-muted disabled:opacity-40">
            {label}<ChevronDown size={10} aria-hidden="true" />
        </button>
        {open && !disabled ? <AnchoredMenuPopover anchorRef={anchorRef} label="Questions" width={240} align="end" browserZIndex={180} autoFocus onClose={close}>
            <div data-question-picker onKeyDown={event => {
                event.stopPropagation()
                const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
                const index = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement)
                let next: number
                if (event.key === 'ArrowDown') next = (index + 1) % items.length
                else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
                else if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = items.length - 1
                else return
                event.preventDefault()
                items[next]?.focus()
            }}>
                {questions.map(({ question, index, answer, complete }) => <button key={question.id} type="button" role="menuitemradio" aria-checked={index === currentIndex} aria-label={`${index + 1}. ${question.header}, ${complete ? 'completed' : 'unanswered'}${complete ? `, ${answer}` : ''}`} onClick={() => {
                    close()
                    onChoose(index)
                }} className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none', index === currentIndex && 'bg-white/[0.07]')}>
                    <span data-question-number className="w-3 shrink-0 text-center text-[10px] tabular-nums text-sparkle-text-muted" aria-hidden="true">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-sparkle-text" title={question.question}>{question.header}</span>
                    {complete ? <span className="flex max-w-[45%] items-center gap-1 text-[11px] text-sparkle-text-muted" title={answer}><Check size={11} className="shrink-0" aria-hidden="true" /><span className="truncate">{answer}</span></span> : null}
                </button>)}
            </div>
        </AnchoredMenuPopover> : null}
    </>
}
