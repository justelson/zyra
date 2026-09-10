import type { ThemeDefinition } from '@/lib/settings-theme-catalog'

export function OnboardingThemeSwatch({ theme }: { theme: ThemeDefinition }) {
    return <span className="onboarding-theme-swatch" aria-hidden="true">
        {[theme.tokens.bg, theme.tokens.card, theme.tokens.text, theme.tokens.primary].map((color, index) =>
            <span key={index} style={{ backgroundColor: color }} />)}
    </span>
}
