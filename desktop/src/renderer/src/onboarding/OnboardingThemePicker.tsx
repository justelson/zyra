import { type ThemeRevealOrigin } from './useThemeReveal'
import { ChevronDown, Ellipsis } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { DARK_THEMES, LIGHT_THEMES, type Theme, type ThemeDefinition } from '@/lib/settings-theme-catalog'
import { themeRevealOrigin } from './useThemeReveal'
import { OnboardingThemeSwatch } from './OnboardingThemeSwatch'
import { OnboardingThemeBrowser } from './OnboardingThemeBrowser'
import { getThemeWindow } from './onboarding-theme-window'

export function OnboardingThemePicker({ appearance, value, onChange }: {
    appearance: 'light' | 'dark'
    value: Theme
    onChange: (theme: Theme, origin?: ThemeRevealOrigin) => void
}) {
    const [expanded, setExpanded] = useState(false)
    const frameRef = useRef<HTMLDivElement>(null)
    const id = useId()
    const themes: readonly (ThemeDefinition & { id: Theme })[] = appearance === 'light' ? LIGHT_THEMES : DARK_THEMES
    const selected = themes.find(theme => theme.id === value) || themes[0]
    const suggested = getThemeWindow(themes, selected.id)
    return <div ref={frameRef} className="onboarding-theme-picker" data-browsing={expanded}>
        <div className="onboarding-theme-caption">
            <span className="onboarding-theme-current">{selected.name}</span>
            <button type="button" aria-haspopup="dialog" aria-expanded={expanded} onClick={() => setExpanded(true)}>
                Browse themes<ChevronDown size={13} />
            </button>
        </div>
        <fieldset className="onboarding-theme-suggestions">
            <legend className="sr-only">Nearby {appearance} themes</legend>
            {suggested.map(theme => <label key={theme.id} data-theme-id={theme.id} className="onboarding-theme-choice">
                <input className="sr-only" type="radio" name={id} value={theme.id} checked={theme.id === selected.id} onChange={event => onChange(theme.id, themeRevealOrigin(event.currentTarget))} />
                <OnboardingThemeSwatch theme={theme} /><span className="onboarding-theme-choice-name" title={theme.name}>{theme.name}</span>
            </label>)}
            <button type="button" className="onboarding-theme-more" onClick={() => setExpanded(true)} aria-haspopup="dialog">
                <span><Ellipsis size={20} /></span><span>More themes</span>
            </button>
        </fieldset>
        {expanded && frameRef.current && <OnboardingThemeBrowser anchor={frameRef.current} themes={themes} value={value} onChange={onChange} onClose={() => setExpanded(false)} />}
    </div>
}
