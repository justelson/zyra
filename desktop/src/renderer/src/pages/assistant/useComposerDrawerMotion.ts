import { useEffect, useLayoutEffect, useState } from 'react'

/** Mount the closed position, paint it, then reveal; retain the drawer on exit. */
export function useComposerDrawerMotion(isOpen: boolean, duration = 220) {
    const [present, setPresent] = useState(isOpen)
    const [open, setOpen] = useState(false)
    useEffect(() => {
        if (isOpen) { setPresent(true); return }
        const timer = window.setTimeout(() => setPresent(false), duration)
        return () => window.clearTimeout(timer)
    }, [isOpen, duration])
    useLayoutEffect(() => {
        if (!isOpen || !present) { setOpen(false); return }
        let second = 0
        const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setOpen(true)) })
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }, [isOpen, present])
    return { present, open }
}
