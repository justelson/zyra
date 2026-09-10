import { useId, type CSSProperties } from 'react'
import { ArrowUp, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type { OnboardingAppearanceSelection } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'
import { getThemeDefinition, type LightTheme, type DarkTheme } from '@/lib/settings-theme-catalog'
import { OnboardingThemePicker } from './OnboardingThemePicker'
import { cn } from '@/lib/utils'

const MODES = [{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }] as const

export function AppearanceStep({ selection, onChange }: {
    selection: OnboardingAppearanceSelection
    onChange: (selection: OnboardingAppearanceSelection) => void
}) {
    const { settings } = useSettings()
    const modeId = useId()
    const activeAppearance = selection.appearanceThemeMode === 'system' ? settings.appearanceResolvedMode : selection.appearanceThemeMode
    const theme = getThemeDefinition(activeAppearance === 'light' ? selection.appearanceLightTheme : selection.appearanceDarkTheme)
    const tokens = theme.tokens
    const style = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--preview-${key}`, value])) as CSSProperties
    return <div className="mx-auto w-full max-w-[460px]">
        <fieldset className="onboarding-appearance-modes">
            <legend className="sr-only">Zyra appearance</legend>
            <span className="onboarding-appearance-selection" style={{ transform: `translateX(${MODES.findIndex(mode => mode.value === selection.appearanceThemeMode) * 100}%)` }} aria-hidden="true" />
            {MODES.map(({ value, label, icon: Icon }) => <label key={value} className={cn('onboarding-appearance-mode', selection.appearanceThemeMode === value && 'text-sparkle-text')}>
                <input className="sr-only" type="radio" name={modeId} value={value} checked={selection.appearanceThemeMode === value} onChange={() => onChange({ ...selection, appearanceThemeMode: value })} />
                <Icon size={14} strokeWidth={1.6} />{label}
            </label>)}
        </fieldset>

        <div className="onboarding-workspace-preview" style={style} role="img" aria-label={`${theme.name} preview of the Zyra workspace`}>
            <div className="onboarding-preview-canvas">
                <span className="onboarding-preview-title">What are we working on?</span>
                <div className="onboarding-preview-composer">
                    <span className="onboarding-preview-placeholder">Message Zyra…</span>
                    <div className="onboarding-preview-composer-tools"><Plus size={15} /><span className="onboarding-preview-send"><ArrowUp size={14} /></span></div>
                </div>
            </div>
        </div>

        <OnboardingThemePicker
            key={activeAppearance}
            appearance={activeAppearance}
            value={activeAppearance === 'light' ? selection.appearanceLightTheme : selection.appearanceDarkTheme}
            onChange={themeId => onChange(activeAppearance === 'light'
                ? { ...selection, appearanceLightTheme: themeId as LightTheme }
                : { ...selection, appearanceDarkTheme: themeId as DarkTheme })}
        />
    </div>
}
