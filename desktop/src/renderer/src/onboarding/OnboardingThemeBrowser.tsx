import { useRef, useState, useId } from 'react'
import { Search, X } from 'lucide-react'
import type { Theme, ThemeDefinition } from '@/lib/settings-theme-catalog'
import { themeRevealOrigin, type ThemeRevealOrigin } from './useThemeReveal'
import { OnboardingThemeSwatch } from './OnboardingThemeSwatch'
import { useThemeBrowserMotion } from './useThemeBrowserMotion'
import './OnboardingThemeBrowser.css'

export function OnboardingThemeBrowser({ anchor, themes, value, onChange, onClose }: {
    anchor: HTMLDivElement
    themes: readonly (ThemeDefinition & { id: Theme })[]
    value: Theme
    onChange: (theme: Theme, origin?: ThemeRevealOrigin) => void
    onClose: () => void
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const [query, setQuery] = useState('')
    const id = useId()
    const close = useThemeBrowserMotion(dialogRef, anchor, onClose)
    const normalized = query.trim().toLocaleLowerCase()
    const matches = themes.filter(theme => `${theme.name} ${theme.description}`.toLocaleLowerCase().includes(normalized))
    return <dialog ref={dialogRef} className="onboarding-theme-browser" aria-labelledby={`${id}-title`}
        onCancel={event => { event.preventDefault(); close() }}
        onClick={event => { const r = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) close() }}>
        <div className="onboarding-theme-browser-surface" aria-hidden="true" />
        <div className="onboarding-theme-browser-content">
            <header><h2 id={`${id}-title`}>Find your theme</h2><button type="button" onClick={close} aria-label="Close themes"><X size={17} /></button></header>
            <label className="onboarding-theme-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search themes" aria-label="Search themes" /></label>
            <fieldset className="onboarding-theme-browser-grid">
                <legend className="sr-only">All themes</legend>
                {matches.map(theme => <label key={theme.id} data-theme-id={theme.id} className="onboarding-theme-choice">
                    <input className="sr-only" type="radio" name={id} value={theme.id} checked={theme.id === value} onChange={event => onChange(theme.id, themeRevealOrigin(event.currentTarget))} />
                    <OnboardingThemeSwatch theme={theme} /><span className="onboarding-theme-choice-name">{theme.name}</span>
                </label>)}
                {!matches.length && <p className="onboarding-theme-empty">No matching themes</p>}
            </fieldset>
        </div>
        <div className="onboarding-theme-browser-shared" aria-hidden="true" inert />
    </dialog>
}
