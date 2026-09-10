import { useId } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { OnboardingAppearanceSelection } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'
import { type LightTheme, type DarkTheme } from '@/lib/settings-theme-catalog'
import { OnboardingThemePicker } from './OnboardingThemePicker'
import { themeRevealOrigin, type ThemeRevealOrigin } from './useThemeReveal'
import { cn } from '@/lib/utils'

const MODES = [{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }] as const

export function AppearanceStep({ selection, onChange }: {
    selection: OnboardingAppearanceSelection
    onChange: (selection: OnboardingAppearanceSelection, origin?: ThemeRevealOrigin) => void
}) {
    const { settings } = useSettings()
    const modeId = useId()
    const activeAppearance = selection.appearanceThemeMode === 'system' ? settings.appearanceResolvedMode : selection.appearanceThemeMode
    return <div className="onboarding-appearance-controls mx-auto w-full max-w-[460px]">
        <fieldset className="onboarding-appearance-modes">
            <legend className="sr-only">Zyra appearance</legend>
            <span className="onboarding-appearance-selection" style={{ transform: `translateX(${MODES.findIndex(mode => mode.value === selection.appearanceThemeMode) * 100}%)` }} aria-hidden="true" />
            {MODES.map(({ value, label, icon: Icon }) => <label key={value} className={cn('onboarding-appearance-mode', selection.appearanceThemeMode === value && 'text-sparkle-text')}>
                <input className="sr-only" type="radio" name={modeId} value={value} checked={selection.appearanceThemeMode === value} onChange={event => onChange({ ...selection, appearanceThemeMode: value }, themeRevealOrigin(event.currentTarget))} />
                <Icon size={14} strokeWidth={1.6} />{label}
            </label>)}
        </fieldset>

        <OnboardingThemePicker
            key={activeAppearance}
            appearance={activeAppearance}
            value={activeAppearance === 'light' ? selection.appearanceLightTheme : selection.appearanceDarkTheme}
            onChange={(themeId, origin) => onChange(activeAppearance === 'light'
                ? { ...selection, appearanceLightTheme: themeId as LightTheme }
                : { ...selection, appearanceDarkTheme: themeId as DarkTheme }, origin)}
        />
    </div>
}
