import { useEffect, useState } from 'react'

export function useStreamingReview(source: string, chunk: number) {
    const [state, setState] = useState({ text: '', running: false, run: 0 })
    useEffect(() => {
        if (!state.running) return
        const timer = window.setInterval(() => setState(current => {
            const text = source.slice(0, current.text.length + chunk)
            return { ...current, text, running: text.length < source.length }
        }), 40)
        return () => window.clearInterval(timer)
    }, [source, chunk, state.running, state.run])
    const replay = () => setState(current => ({ text: '', running: true, run: current.run + 1 }))
    return { ...state, replay }
}
