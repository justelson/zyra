import type { CSSProperties } from 'react'
import type { ThemeDefinition } from '@/lib/settings-theme-catalog'
import { resolveAccentTokens, resolveThemeTokens } from '@/lib/settings-theme-semantics'

export function onboardingThemeStyle(theme: ThemeDefinition): CSSProperties {
    const tokens = resolveThemeTokens(theme.tokens)
    const accent = resolveAccentTokens(tokens.primary, tokens.secondary, tokens.bg)
    return {
        ...Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--color-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value])),
        '--accent-primary': accent.primary,
        '--accent-secondary': accent.secondary,
        '--accent-on-primary': accent.onPrimary,
        '--accent-contrast': accent.onPrimary,
        '--color-primary-on': accent.onPrimary,
        '--surface-border': tokens.border,
        '--surface-hover': tokens.accent,
        '--surface-active': tokens.card
    } as CSSProperties
}
