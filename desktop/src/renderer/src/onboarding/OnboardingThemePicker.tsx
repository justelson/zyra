import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { DARK_THEMES, LIGHT_THEMES, type Theme, type ThemeDefinition } from '@/lib/settings-theme-catalog'

const SUGGESTED = {
    dark: ['dark', 'midnight', 'nord', 'gruvbox', 'rose-pine', 'catppuccin-mocha'],
    light: ['light', 'paper-light', 'nord-snow', 'rose-pine-dawn', 'catppuccin-latte', 'everforest-light']
}

function Palette({ theme }: { theme: ThemeDefinition }) {
    return <span className="onboarding-theme-swatch" aria-hidden="true">
        {[theme.tokens.bg, theme.tokens.card, theme.tokens.text, theme.tokens.primary].map((color, index) =>
            <span key={index} style={{ backgroundColor: color }} />)}
    </span>
}

export function OnboardingThemePicker({ appearance, value, onChange }: {
    appearance: 'light' | 'dark'
    value: Theme
    onChange: (theme: Theme) => void
}) {
    const [expanded, setExpanded] = useState(false)
    const [query, setQuery] = useState('')
    const id = useId()
    const triggerRef = useRef<HTMLButtonElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const themes = appearance === 'light' ? LIGHT_THEMES : DARK_THEMES
    const selected = themes.find(theme => theme.id === value) || themes[0]
    const suggested = themes.filter(theme => SUGGESTED[appearance].includes(theme.id))
    if (!suggested.some(theme => theme.id === selected.id)) suggested[suggested.length - 1] = selected
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const matches = themes.filter(theme => `${theme.name} ${theme.description}`.toLocaleLowerCase().includes(normalizedQuery))

    useEffect(() => { if (expanded) searchRef.current?.focus() }, [expanded])

    return <div className="onboarding-theme-picker">
        <div className="onboarding-theme-caption">
            <span className="onboarding-theme-current">{selected.name}</span>
            <button ref={triggerRef} type="button" aria-expanded={expanded} aria-controls={`${id}-catalog`}
                onClick={() => { setQuery(''); setExpanded(open => !open) }}>
                {expanded ? 'Close themes' : 'Browse themes'}<ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
            </button>
        </div>
        <fieldset className="onboarding-theme-suggestions">
            <legend className="sr-only">Suggested {appearance} themes</legend>
            {suggested.map(theme => <label key={theme.id} className="onboarding-theme-choice">
                <input className="sr-only" type="radio" name={`${id}-suggested`} value={theme.id} checked={theme.id === selected.id}
                    onChange={() => onChange(theme.id)} />
                <Palette theme={theme} />
                <span className="onboarding-theme-choice-name" title={theme.name}>{theme.name}</span>
            </label>)}
        </fieldset>
        <div id={`${id}-catalog`} className="onboarding-theme-catalog" data-expanded={expanded} inert={!expanded}
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); triggerRef.current?.focus() } }}>
            <div className="onboarding-theme-catalog-clip">
                <div className="onboarding-theme-catalog-content">
                    <label className="onboarding-theme-search"><Search size={14} />
                        <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search themes" aria-label="Search themes" />
                    </label>
                    <fieldset className="onboarding-theme-results">
                        <legend className="sr-only">All {appearance} themes</legend>
                        {matches.map(theme => <label key={theme.id} className="onboarding-theme-result">
                            <input className="sr-only" type="radio" name={`${id}-all`} value={theme.id} checked={theme.id === selected.id}
                                onChange={() => onChange(theme.id)} />
                            <Palette theme={theme} /><span>{theme.name}</span>
                            {theme.id === selected.id && <Check size={13} aria-hidden="true" />}
                        </label>)}
                        {!matches.length && <p className="onboarding-theme-empty">No matching themes</p>}
                    </fieldset>
                </div>
            </div>
        </div>
    </div>
}
