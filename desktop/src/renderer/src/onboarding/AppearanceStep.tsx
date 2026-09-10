import { useId, type CSSProperties } from 'react'
import { ArrowUp, Monitor, Moon, Plus, Sun } from 'lucide-react'
import type { OnboardingAppearanceSelection } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'
import { getThemeDefinition } from '@/lib/settings-theme-catalog'
import { AppearanceThemeSelector } from '@/pages/settings/appearance/AppearanceThemeSelect'
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

        <div className="onboarding-workspace-preview mt-4" style={style} role="img" aria-label={`${theme.name} preview of the Zyra workspace`}>
            <div className="onboarding-preview-rail">
                <span className="text-[12px] font-semibold tracking-tight">Zyra</span>
                <span className="mt-4 flex items-center gap-1.5 text-[10px]"><Plus size={11} />New chat</span>
                <span className="mt-3 text-[9px] opacity-60">Recent</span>
                <span className="onboarding-preview-chat mt-1">A fresh idea</span>
                <span className="px-1.5 py-1 text-[9px] opacity-60">Plan for the week</span>
            </div>
            <div className="onboarding-preview-canvas">
                <span className="text-[15px] font-medium tracking-[-0.025em]">What are we working on?</span>
                <div className="onboarding-preview-composer">
                    <span className="text-[10px] opacity-60">Message Zyra…</span>
                    <div className="mt-4 flex items-center justify-between"><Plus size={12} /><span className="onboarding-preview-send"><ArrowUp size={11} /></span></div>
                </div>
            </div>
        </div>

        <AppearanceThemeSelector
            className="onboarding-theme-picker mt-4"
            appearance={activeAppearance}
            lightTheme={selection.appearanceLightTheme}
            darkTheme={selection.appearanceDarkTheme}
            onLightThemeChange={appearanceLightTheme => onChange({ ...selection, appearanceLightTheme })}
            onDarkThemeChange={appearanceDarkTheme => onChange({ ...selection, appearanceDarkTheme })}
        />
    </div>
}
