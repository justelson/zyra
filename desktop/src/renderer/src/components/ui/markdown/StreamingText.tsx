import { Children, useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import type { Element, Root } from 'hast'

type Piece = { start: number; text: string; settledAt: number }
export type StreamingTextState = { value: string; settled: string; pieces: Piece[] }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function advanceStreamingText(state: StreamingTextState, value: string): StreamingTextState {
    if (state.value === value) return state
    if (!value.startsWith(state.value)) return { value, settled: value, pieces: [] }
    let start = state.value.length
    const suffix = value.slice(start)
    const tail = state.pieces.at(-1)
    const last = tail ? { segment: tail.text, index: tail.start } : start ? segmenter.segment(state.value).containing(start - 1) : undefined
    if (last && segmenter.segment(last.segment + suffix)[Symbol.iterator]().next().value?.segment !== last.segment) start = last.index
    const pieces = state.pieces.filter(part => part.start < start)
    const settledAt = performance.now() + 320
    for (const part of segmenter.segment(value.slice(start))) {
        if (pieces.length === 64) pieces.shift()
        const offset = start + part.index
        pieces.push({ start: offset, text: part.segment, settledAt: tail?.start === offset ? tail.settledAt : settledAt })
    }
    return { value, settled: value.slice(0, pieces[0]?.start ?? value.length), pieces }
}

export function StreamingMarkdownSpan({ children, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) {
    const live = (props as Record<string, unknown>)['data-zyra-live-text']
    const initial = (props as Record<string, unknown>)['data-zyra-live-initial'] === 'true'
    const parts = Children.toArray(children)
    // Color-aware paragraphs normalize plain text children into arrays.
    if (!live || !parts.every(part => typeof part === 'string')) return <span {...props}>{children}</span>
    return <StreamingText value={parts.join('')} animateInitial={initial} />
}

function StreamingText({ value, animateInitial }: { value: string; animateInitial: boolean }) {
    const [state, setState] = useState<StreamingTextState>(() => animateInitial
        ? advanceStreamingText({ value: '', settled: '', pieces: [] }, value)
        : { value, settled: value, pieces: [] })
    if (state.value !== value) setState(advanceStreamingText(state, value))
    const oldest = state.pieces[0]?.start
    useEffect(() => {
        if (oldest === undefined) return
        const settle = () => {
            const selection = document.getSelection()
            if (selection && !selection.isCollapsed) return
            setState(current => {
                const pieces = current.pieces.filter(part => part.settledAt > performance.now())
                return pieces.length === current.pieces.length ? current : { ...current, settled: current.value.slice(0, pieces[0]?.start ?? current.value.length), pieces }
            })
        }
        const timer = window.setTimeout(settle, Math.max(0, state.pieces[0].settledAt - performance.now()) + 1)
        document.addEventListener('selectionchange', settle)
        return () => { window.clearTimeout(timer); document.removeEventListener('selectionchange', settle) }
    }, [oldest])
    return <span data-assistant-stream-text>{state.settled}{state.pieces.map(part => <span key={part.start} className="assistant-stream-token">{part.text}</span>)}</span>
}

export function wrapStreamingText(tree: Root, animateInitial: boolean): void {
    const walk = (parent: Root | Element, blocked = false) => {
        const skip = blocked || (parent.type === 'element' && (['code', 'pre', 'math', 'style', 'script'].includes(parent.tagName) || parent.properties.dataMathSource !== undefined))
        parent.children = parent.children.map(child => {
            if (child.type === 'text' && !skip && child.value.trim()) return {
                type: 'element', tagName: 'span', properties: { dataZyraLiveText: 'true', dataZyraLiveInitial: String(animateInitial) }, children: [child]
            } satisfies Element
            if (child.type === 'element') walk(child, skip)
            return child
        }) as typeof parent.children
    }
    walk(tree)
}
