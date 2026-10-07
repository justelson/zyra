import { useEffect, useState } from 'react'

export function usePresentationReducedMotion(): boolean {
    const read = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('zyra-reduce-motion')
    const [reduced, setReduced] = useState(read)
    useEffect(() => {
        const update = () => setReduced(read())
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        media.addEventListener('change', update)
        const observer = new MutationObserver(update)
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
        update()
        return () => { media.removeEventListener('change', update); observer.disconnect() }
    }, [])
    return reduced
}
