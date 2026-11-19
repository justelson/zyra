import { useRef, useState, type ReactNode } from 'react'
import { AssistantPendingUserInputQuestionField } from './AssistantPendingUserInputQuestionField'
import type { AssistantUserInputQuestion } from '@shared/assistant/contracts'

type Choice = { label: string; description: string }
const unused = () => {}

/** Host-owned operations use the question tool's confirm field with their own decision endpoint. */
export function AssistantPermissionQuestion(props: {
    title: string
    details?: ReactNode
    choices: Choice[]
    busy?: boolean
    canSubmit?: (label: string) => boolean
    onAnswer: (label: string) => Promise<void> | void
}) {
    const [answer, setAnswer] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const submitting = useRef(false)
    const question: AssistantUserInputQuestion = { id: 'decision', type: 'confirm', header: 'Permission', question: props.title,
        options: props.choices, required: true, allowOther: false }
    const valid = answer !== null && props.choices.some(choice => choice.label === answer) && (props.canSubmit?.(answer) ?? true)
    const submit = async () => {
        if (props.busy || submitting.current || !valid || !answer) return
        submitting.current = true
        setSaving(true)
        setError('')
        try { await props.onAnswer(answer) }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not submit this answer.') }
        finally { submitting.current = false; setSaving(false) }
    }
    return <section data-zyra-part="permission.approval" data-zyra-state={props.busy || saving ? 'responding' : 'pending'} data-question-tray aria-label={props.title} className="pointer-events-auto mx-auto w-full max-w-[760px] rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-2 text-sparkle-text">
        <h3 className="px-3 py-2 text-sm font-medium">{props.title}</h3>
        {props.details && <div className="custom-scrollbar max-h-36 overflow-auto whitespace-pre-wrap break-words px-3 pb-2 text-xs text-sparkle-text-secondary">{props.details}</div>}
        <AssistantPendingUserInputQuestionField question={question} answer={answer} responding={saving || Boolean(props.busy)}
            onSelectOption={(_, label) => setAnswer(label)} onToggleOption={unused} onScalarChange={unused} onRankingChange={unused} />
        {error && <p role="alert" className="px-3 py-1 text-xs text-[var(--status-warning)]">{error}</p>}
        <div className="flex justify-end px-2 pt-1"><button type="button" disabled={!valid || saving || props.busy}
            onClick={() => void submit()} className="rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] disabled:opacity-40">Submit answer</button></div>
    </section>
}
