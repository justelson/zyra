import { useCallback, useLayoutEffect, useRef, useState, useId } from 'react'
import { Search, X } from 'lucide-react'
import type { Theme, ThemeDefinition } from '@/lib/settings-theme-catalog'
import { themeRevealOrigin, type ThemeRevealOrigin } from './useThemeReveal'
import { OnboardingThemeSwatch } from './OnboardingThemeSwatch'
import './OnboardingThemeBrowser.css'

export function OnboardingThemeBrowser({ anchor, themes, value, onChange, onClose }: {
    anchor: HTMLDivElement
    themes: readonly (ThemeDefinition & { id: Theme })[]
    value: Theme
    onChange: (theme: Theme, origin?: ThemeRevealOrigin) => void
    onClose: () => void
}) {
    const searchRef = useRef<HTMLInputElement>(null)
    const dialogRef = useRef<HTMLDialogElement>(null)
    const animationRef = useRef<Animation | null>(null)
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const closingRef = useRef(false)
    const [closing, setClosing] = useState(false)
    const [query, setQuery] = useState('')
    const id = useId()
    const reduceMotion = () => document.body.classList.contains('zyra-reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const geometry = (rect: DOMRect) => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })

    useLayoutEffect(() => {
        const dialog = dialogRef.current!
        const source = anchor.getBoundingClientRect()
        const position = () => {
            const width = Math.min(640, window.innerWidth - 32)
            const height = Math.min(486, window.innerHeight - 80)
            Object.assign(dialog.style, { left: `${(window.innerWidth - width) / 2}px`, top: `${(window.innerHeight - height) / 2}px`, width: `${width}px`, height: `${height}px` })
        }
        position()
        dialog.showModal()
        searchRef.current?.focus({ preventScroll: true })
        if (!reduceMotion()) animationRef.current = dialog.animate([geometry(source), geometry(dialog.getBoundingClientRect())], { duration: 580, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
        const resize = () => { animationRef.current?.cancel(); position() }
        window.addEventListener('resize', resize)
        return () => {
            animationRef.current?.cancel()
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
            window.removeEventListener('resize', resize)
            dialog.close()
        }
    }, [anchor])

    const close = useCallback(() => {
        const dialog = dialogRef.current
        if (!dialog || closingRef.current) return
        closingRef.current = true
        setClosing(true)
        animationRef.current?.cancel()
        if (reduceMotion()) { dialog.close(); onClose(); return }
        animationRef.current = dialog.animate([geometry(dialog.getBoundingClientRect()), geometry(anchor.getBoundingClientRect())], { duration: 420, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
        // Closure must not depend on an animation finishing in a background window.
        closeTimerRef.current = setTimeout(() => { dialog.close(); onClose() }, 420)
    }, [anchor, onClose])
    const normalized = query.trim().toLocaleLowerCase()
    const matches = themes.filter(theme => `${theme.name} ${theme.description}`.toLocaleLowerCase().includes(normalized))
    return <dialog ref={dialogRef} className="onboarding-theme-browser" data-closing={closing} aria-labelledby={`${id}-title`}
        onCancel={event => { event.preventDefault(); close() }}
        onClick={event => { const r = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) close() }}>
        <div className="onboarding-theme-browser-content">
            <header><h2 id={`${id}-title`}>Find your theme</h2><button type="button" onClick={close} aria-label="Close themes"><X size={17} /></button></header>
            <label className="onboarding-theme-search"><Search size={15} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search themes" aria-label="Search themes" /></label>
            <fieldset className="onboarding-theme-browser-grid">
                <legend className="sr-only">All themes</legend>
                {matches.map(theme => <label key={theme.id} className="onboarding-theme-choice">
                    <input className="sr-only" type="radio" name={id} value={theme.id} checked={theme.id === value} onChange={event => onChange(theme.id, themeRevealOrigin(event.currentTarget))} />
                    <OnboardingThemeSwatch theme={theme} /><span className="onboarding-theme-choice-name">{theme.name}</span>
                </label>)}
                {!matches.length && <p className="onboarding-theme-empty">No matching themes</p>}
            </fieldset>
        </div>
    </dialog>
}
