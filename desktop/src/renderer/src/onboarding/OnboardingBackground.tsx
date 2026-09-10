import { getThemeAppearance, type Theme, type ThemeDefinition } from '@/lib/settings-theme-catalog'
import { useMemo } from 'react'
import CloudField from '@/components/ui/CloudField'
import { useSettings } from '@/lib/settings'
import { useThemeRevision } from '@/lib/use-theme-revision'
import './OnboardingBackground.css'

function readThemeColor(variable: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback
}

export function OnboardingBackground({ theme }: { theme?: ThemeDefinition } = {}) {
    const { settings } = useSettings()
    const themeRevision = useThemeRevision()
    const palette = useMemo(() => ({
        background: theme?.tokens.bg || readThemeColor('--color-bg', '#0c121f'),
        accent: theme?.tokens.primary || readThemeColor('--accent-primary', settings.accentColor.primary),
        ink: theme?.tokens.text || readThemeColor('--color-text', '#f0f4f8')
    }), [theme, settings.accentColor.primary, settings.theme, themeRevision])

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" data-appearance={theme ? getThemeAppearance(theme.id as Theme) : settings.appearanceResolvedMode} aria-hidden="true">
            <CloudField
                backgroundColor={palette.background}
                accentColor={palette.accent}
                inkColor={palette.ink}
                speed={0.72}
                maxFps={24}
                reducedMotion={settings.accessibilityReduceMotion}
                className="onboarding-cloud-field"
            />
            <div className="onboarding-cloud-wash absolute inset-0" />
        </div>
    )
}
