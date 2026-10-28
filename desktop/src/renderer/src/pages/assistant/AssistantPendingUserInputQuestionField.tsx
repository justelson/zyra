import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    DndContext,
    DragOverlay,
    defaultDropAnimationSideEffects,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Check, FileText, GripVertical } from 'lucide-react'
import type { AssistantUserInputAnswer, AssistantUserInputQuestion } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { usePresentationReducedMotion } from '@/lib/use-presentation-reduced-motion'
import { AssistantCheckbox } from './AssistantCheckbox'
import { AssistantQuestionDatePicker } from './AssistantQuestionDatePicker'
import { reorderAssistantUserInputRanking } from './assistant-pending-user-input'

function getOptions(question: AssistantUserInputQuestion) {
    if (question.type === 'confirm' && question.options.length < 2) {
        return [
            { label: 'Yes', description: 'Confirm and continue' },
            { label: 'No', description: 'Decline' }
        ]
    }
    return question.options
}

function answerValues(answer: AssistantUserInputAnswer | null): string[] {
    return Array.isArray(answer) ? answer : typeof answer === 'string' && answer ? [answer] : []
}

type RankingRowProps = {
    label: string
    index: number
    displayIndex: number
    ranking: string[]
    responding: boolean
    reducedMotion: boolean
    onChange: (value: string[]) => void
}

const rankingRowClass = (dragging: boolean, responding: boolean) => cn(
    'group/ranking relative flex touch-none select-none items-center gap-2 rounded-2xl border px-2.5 py-1.5 will-change-transform transition-[border-color,background-color,box-shadow] motion-reduce:transition-none',
    responding ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
    dragging
        ? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_16%,var(--color-card))] shadow-[0_14px_32px_rgba(0,0,0,0.34),0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_28%,transparent)]'
        : 'border-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] bg-white/[0.025] hover:border-[color-mix(in_srgb,var(--accent-primary)_34%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_7%,transparent)]'
)

function AssistantRankingNumber({ value, reducedMotion }: { value: number; reducedMotion: boolean }) {
    const numberRef = useRef<HTMLSpanElement>(null)
    const previous = useRef(value)
    useLayoutEffect(() => {
        const before = previous.current
        previous.current = value
        if (before === value || reducedMotion || !numberRef.current) return
        const animation = numberRef.current.animate([
            { opacity: .35, transform: `translateY(${value > before ? 6 : -6}px)` },
            { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 140, easing: 'cubic-bezier(.2,.8,.2,1)' })
        return () => animation.cancel()
    }, [value, reducedMotion])
    return <span className="inline-flex h-5 min-w-5 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_16%,transparent)] px-1.5 text-[10px] font-semibold tabular-nums text-[color-mix(in_srgb,var(--accent-primary)_72%,var(--color-text))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]"><span ref={numberRef} data-ranking-number className="inline-block">{value}</span></span>
}

function AssistantRankingContents(props: RankingRowProps) {
    const { label, index, displayIndex, ranking, responding, reducedMotion, onChange } = props
    return (
        <>
            <AssistantRankingNumber value={displayIndex + 1} reducedMotion={reducedMotion} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-sparkle-text">{label}</span>
            <GripVertical size={14} aria-hidden="true" className="shrink-0 text-sparkle-text-muted" />
            <button type="button" disabled={responding || index === 0} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={() => {
                const next = [...ranking]
                ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                onChange(next)
            }} className="inline-flex size-7 items-center justify-center rounded-full text-sparkle-text-muted hover:bg-white/[0.06] hover:text-sparkle-text disabled:opacity-25" aria-label={`Move ${label} up`}><ArrowUp size={13} /></button>
            <button type="button" disabled={responding || index === ranking.length - 1} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={() => {
                const next = [...ranking]
                ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                onChange(next)
            }} className="inline-flex size-7 items-center justify-center rounded-full text-sparkle-text-muted hover:bg-white/[0.06] hover:text-sparkle-text disabled:opacity-25" aria-label={`Move ${label} down`}><ArrowDown size={13} /></button>
        </>
    )
}

function AssistantRankingRow(props: RankingRowProps) {
    const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.label,
        disabled: props.responding,
        transition: props.reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
    })
    return <div ref={setNodeRef} {...listeners} role="listitem" aria-label={props.label} aria-disabled={props.responding}
        data-ranking-row={props.label} data-ranking-dragging={isDragging ? 'true' : 'false'}
        style={{ transform: CSS.Transform.toString(transform), transition: props.reducedMotion ? 'none' : transition, opacity: isDragging ? 0 : undefined }}
        className={rankingRowClass(false, props.responding)}>
        <AssistantRankingContents {...props} />
    </div>
}

const rankingDropAnimation = {
    duration: 180,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
}

function AssistantRankingField(props: {
    questionId: string
    ranking: string[]
    responding: boolean
    onRankingChange: (questionId: string, value: string[]) => void
}) {
    const { questionId, ranking, responding, onRankingChange } = props
    const reducedMotion = usePresentationReducedMotion()
    const [activeId, setActiveId] = useState<string | null>(null)
    const [overId, setOverId] = useState<string | null>(null)
    const projectedRanking = activeId && overId ? reorderAssistantUserInputRanking(ranking, activeId, overId) : ranking
    const resetDrag = () => { setActiveId(null); setOverId(null) }
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
    const handleDragEnd = (event: DragEndEvent) => {
        resetDrag()
        const activeLabel = String(event.active.id)
        const targetLabel = event.over ? String(event.over.id) : ''
        if (!targetLabel || activeLabel === targetLabel) return
        onRankingChange(questionId, reorderAssistantUserInputRanking(ranking, activeLabel, targetLabel))
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragStart={({ active }) => { setActiveId(String(active.id)); setOverId(String(active.id)) }}
            onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
            onDragCancel={resetDrag}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
                <div data-guided-animate role="list" aria-label="Priority order" className="space-y-1.5">
                    {ranking.map((label, index) => (
                        <AssistantRankingRow
                            key={label}
                            label={label}
                            index={index}
                            displayIndex={projectedRanking.indexOf(label)}
                            reducedMotion={reducedMotion}
                            ranking={ranking}
                            responding={responding}
                            onChange={(value) => onRankingChange(questionId, value)}
                        />
                    ))}
                </div>
            </SortableContext>
            {createPortal(<DragOverlay dropAnimation={reducedMotion ? null : rankingDropAnimation} zIndex={120}>
                {activeId ? <div data-ranking-overlay aria-hidden="true" inert className={cn(rankingRowClass(true, false), 'pointer-events-none')}>
                    <AssistantRankingContents label={activeId} index={ranking.indexOf(activeId)} displayIndex={projectedRanking.indexOf(activeId)} ranking={ranking} responding={false} reducedMotion={reducedMotion} onChange={() => {}} />
                </div> : null}
            </DragOverlay>, document.body)}
        </DndContext>
    )
}

export function AssistantPendingUserInputQuestionField(props: {
    question: AssistantUserInputQuestion
    answer: AssistantUserInputAnswer | null
    responding: boolean
    onSelectOption: (questionId: string, optionLabel: string) => void
    onToggleOption: (questionId: string, optionLabel: string) => void
    onScalarChange: (questionId: string, value: string) => void
    onRankingChange: (questionId: string, value: string[]) => void
}) {
    const {
        question,
        answer,
        responding,
        onSelectOption,
        onToggleOption,
        onScalarChange,
        onRankingChange
    } = props
    const options = getOptions(question)
    const selectedValues = answerValues(answer)
    const isMultiple = question.type === 'multi_select' || (question.type === 'file_select' && question.multiple !== false)

    if (question.type === 'text') return null

    if (question.type === 'number') {
        const value = typeof answer === 'string' ? answer : ''
        const bounded = typeof question.min === 'number' && Number.isFinite(question.min)
            && typeof question.max === 'number' && Number.isFinite(question.max) && question.min <= question.max
        if (bounded) {
            const min = question.min!
            const max = question.max!
            const numericValue = value.trim() ? Number(value) : NaN
            const sliderValue = Number.isFinite(numericValue) ? Math.max(min, Math.min(max, numericValue)) : min
            const fill = max === min ? 0 : (sliderValue - min) / (max - min) * 100
            return <div data-guided-animate data-question-number-range className="flex h-8 items-center overflow-hidden rounded-md bg-white/[0.04]">
                <div className="relative min-w-0 flex-1">
                    <span data-number-slider-fill aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 rounded-md bg-[var(--surface-active)] transition-[width] duration-100 ease-out motion-reduce:transition-none" style={{ width: `${fill}%` }} />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 z-10 flex max-w-[80%] items-center truncate text-[12px] text-sparkle-text-secondary">{question.header}</span>
                    <input type="range" min={min} max={max} step={question.step || 'any'} value={sliderValue} title={`${min} to ${max}`}
                        aria-label={question.question} aria-valuetext={value.trim() ? value : 'Not answered'} disabled={responding || min === max}
                        onChange={event => onScalarChange(question.id, event.target.value)}
                        onPointerUp={event => { if (!value.trim()) onScalarChange(question.id, event.currentTarget.value) }}
                        onKeyUp={event => { if (!value.trim() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onScalarChange(question.id, event.currentTarget.value) }}
                        className="zyra-question-slider relative block h-8 w-full disabled:cursor-not-allowed disabled:opacity-40" />
                    <span data-number-slider-handle aria-hidden="true" className="pointer-events-none absolute top-[7px] h-[18px] w-[3px] rounded bg-sparkle-text-muted transition-[left] duration-100 ease-out motion-reduce:transition-none" style={{ left: `calc(${fill}% - ${3 * fill / 100}px)` }} />
                </div>
                <input type="number" aria-label={`${question.question} value`} value={value} min={min} max={max} step={question.step || 'any'}
                    placeholder="—" disabled={responding} onChange={event => onScalarChange(question.id, event.target.value)}
                    className="zyra-question-number-value h-8 w-16 shrink-0 border-0 bg-transparent px-3 text-right text-[12px] tabular-nums text-sparkle-text outline-none transition-colors placeholder:text-sparkle-text-muted hover:bg-white/[0.04] focus:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]/45 disabled:opacity-40" />
            </div>
        }
        return (
            <input
                data-guided-animate
                type="number"
                aria-label={question.question}
                value={typeof answer === 'string' ? answer : ''}
                min={question.min}
                max={question.max}
                step={question.step || 'any'}
                placeholder={question.placeholder || 'Enter a number'}
                disabled={responding}
                onChange={(event) => onScalarChange(question.id, event.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.025] px-3 text-[13px] text-sparkle-text outline-none transition-colors placeholder:text-sparkle-text-muted focus:border-[var(--accent-primary)]/45"
            />
        )
    }

    if (question.type === 'date') {
        return <AssistantQuestionDatePicker key={question.id} value={typeof answer === 'string' ? answer : ''} label={question.question} disabled={responding} onChange={value => onScalarChange(question.id, value)} />
    }

    if (question.type === 'ranking') {
        const ranking = Array.isArray(answer) && answer.length === options.length
            ? answer
            : options.map((option) => option.label)
        return (
            <AssistantRankingField
                key={question.id}
                questionId={question.id}
                ranking={ranking}
                responding={responding}
                onRankingChange={onRankingChange}
            />
        )
    }

    return (
        <div className="space-y-0.5">
            {options.map((option, index) => {
                const selected = selectedValues.includes(option.label)
                const optionKey = `${question.id}:${option.label}`
                const hasDetails = Boolean(option.description && option.description !== option.label)
                const choose = () => {
                    if (responding) return
                    if (isMultiple) onToggleOption(question.id, option.label)
                    else onSelectOption(question.id, option.label)
                }
                return (
                    <div
                        data-guided-animate
                        key={optionKey}
                        onClick={choose}
                        onKeyDown={(event) => {
                            if (responding || (event.key !== 'Enter' && event.key !== ' ')) return
                            event.preventDefault()
                            choose()
                        }}
                        role={isMultiple ? 'checkbox' : 'radio'}
                        tabIndex={responding ? -1 : 0}
                        aria-checked={selected}
                        aria-disabled={responding}
                        className={cn(
                            'group/option relative w-full cursor-pointer rounded-lg px-3 py-2 text-left outline-none transition-colors duration-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]',
                            selected ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-secondary hover:bg-white/[0.045] hover:text-sparkle-text',
                            responding && 'cursor-not-allowed opacity-60'
                        )}
                    >
                        <div className="flex items-start gap-2.5">
                            <span aria-hidden="true" className={cn('inline-flex h-5 w-4 shrink-0 items-center justify-center font-mono text-[10px] tabular-nums', selected ? 'text-[var(--accent-primary)]' : 'text-sparkle-text-muted')}>
                                {question.type === 'file_select' ? <FileText size={12} /> : String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="break-words text-[12px] font-medium leading-5">{option.label}</span>{option.recommended ? <span className="text-[10px] font-normal text-sparkle-text-muted">Recommended</span> : null}</span>
                                {hasDetails ? <span className="block break-words text-[11px] leading-4 text-sparkle-text-muted">{option.description}</span> : null}
                            </span>
                            {isMultiple ? (
                                <span onClick={(event) => event.stopPropagation()}><AssistantCheckbox checked={selected} disabled={responding} label={option.label} onChange={choose} /></span>
                            ) : (
                                <span aria-hidden="true" className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)]' : 'border-white/15')}>{selected ? <Check size={10} strokeWidth={2.5} /> : null}</span>
                            )}
                        </div>
                    </div>
                )
            })}


        </div>
    )
}
