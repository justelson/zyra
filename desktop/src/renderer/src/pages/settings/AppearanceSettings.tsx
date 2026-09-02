import { RotateCcw } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { DevScopeManagedFont } from '@shared/contracts/font-contracts'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import {
    APPEARANCE_CODE_FONTS,
    APPEARANCE_UI_FONTS,
    DEFAULT_APPEARANCE_DARK_THEME,
    DEFAULT_APPEARANCE_LIGHT_THEME,
    DEFAULT_APPEARANCE_UI_FONT,
    THEMES,
    getAppearanceLocalFontFamily,
    getAppearanceManagedFontId,
    getSystemAppearanceTheme,
    getThemeAppearance,
    getThemePresetAccent,
    resolveAppearanceTheme,
    useSettings,
    type AppearanceCodeFont,
    type AppearanceThemeMode,
    type AppearanceUiFont,
    type DarkTheme,
    type LightTheme
} from '@/lib/settings'
import type { ThemeTokens } from '@/lib/settings-theme-catalog'
import { listAppearanceManagedFonts } from '@/lib/appearance-font-runtime'
import {
    SettingsButton,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSwitch
} from './settings-layout'
import { createSettingsRowTargetId, createSettingsSectionTargetId } from './settings-search'
import { AppearanceThemeController } from './appearance/AppearanceThemeController'
import { AppearanceThemeSelector } from './appearance/AppearanceThemeSelect'
import {
    AppearanceCodePreview,
    AppearanceSystemThemeCard,
    AppearanceThemeCard
} from './appearance/AppearancePreviews'

const AppearanceFontManagerDialog = lazy(async () => ({
    default: (await import('./appearance/AppearanceFontManagerDialog')).AppearanceFontManagerDialog
}))
let cachedManagedFonts: DevScopeManagedFont[] | null = null
let cachedManagedFontsAt = 0
let pendingManagedFonts: Promise<DevScopeManagedFont[]> | null = null
let managedFontGeneration = 0

function loadManagedFonts(): Promise<DevScopeManagedFont[]> {
    if (cachedManagedFonts && Date.now() - cachedManagedFontsAt < 5 * 60_000) return Promise.resolve(cachedManagedFonts)
    if (pendingManagedFonts) return pendingManagedFonts
    const generation = managedFontGeneration
    const request = listAppearanceManagedFonts().then((fonts) => {
        if (generation === managedFontGeneration) {
            cachedManagedFonts = fonts
            cachedManagedFontsAt = Date.now()
        }
        return fonts
    })
    pendingManagedFonts = request
    void request.finally(() => {
        if (pendingManagedFonts === request) pendingManagedFonts = null
    }).catch(() => undefined)
    return request
}

registerSettingsCacheClearer('settings-managed-fonts', () => {
    managedFontGeneration += 1
    cachedManagedFonts = null
    cachedManagedFontsAt = 0
    pendingManagedFonts = null
})

export default function AppearanceSettings() {
    const { settings, updateSettings } = useSettings()
    const [fontManagerTarget, setFontManagerTarget] = useState<'ui' | 'code' | null>(null)
    const [managedFonts, setManagedFonts] = useState<DevScopeManagedFont[]>(() => cachedManagedFonts || [])
    const baseSelectedTheme = THEMES.find((theme) => theme.id === settings.theme) || THEMES[0]
    const defaultLightTheme = THEMES.find((theme) => theme.id === DEFAULT_APPEARANCE_LIGHT_THEME) || THEMES[0]
    const defaultDarkTheme = THEMES.find((theme) => theme.id === DEFAULT_APPEARANCE_DARK_THEME) || THEMES[0]
    const selectedLightTheme = THEMES.find((theme) => theme.id === settings.appearanceLightTheme) || defaultLightTheme
    const selectedDarkTheme = THEMES.find((theme) => theme.id === settings.appearanceDarkTheme) || defaultDarkTheme
    const customThemeActive = settings.appearanceCustomThemeActive
        && settings.appearanceCustomTheme?.baseTheme === settings.theme
    const selectedTheme = customThemeActive && settings.appearanceCustomTheme
        ? { ...baseSelectedTheme, tokens: settings.appearanceCustomTheme.tokens }
        : baseSelectedTheme
    useEffect(() => {
        let active = true
        void loadManagedFonts().then((fonts) => {
            if (active) setManagedFonts(fonts)
        }).catch(() => undefined)
        return () => { active = false }
    }, [])

    const resolveFontLabel = (font: AppearanceUiFont | AppearanceCodeFont) => {
        const builtIn = [...APPEARANCE_UI_FONTS, ...APPEARANCE_CODE_FONTS].find((entry) => entry.id === font)
        if (builtIn) return builtIn.label
        const managedFontId = getAppearanceManagedFontId(font)
        if (managedFontId) return managedFonts.find((entry) => entry.id === managedFontId)?.family || 'Managed font'
        return getAppearanceLocalFontFamily(font) || 'Local font'
    }

    const paletteChanged = settings.appearanceThemeMode !== 'system'
        || settings.appearanceLightTheme !== DEFAULT_APPEARANCE_LIGHT_THEME
        || settings.appearanceDarkTheme !== DEFAULT_APPEARANCE_DARK_THEME
        || settings.appearanceCustomThemeActive
        || settings.appearanceUiFont !== DEFAULT_APPEARANCE_UI_FONT
        || settings.appearanceCodeFont !== 'system-mono'

    const getPresetAccent = getThemePresetAccent

    const resolvedAppearance = settings.appearanceThemeMode === 'system'
        ? getSystemAppearanceTheme()
        : settings.appearanceThemeMode

    const selectThemeMode = (appearanceThemeMode: AppearanceThemeMode) => {
        const theme = resolveAppearanceTheme(
            appearanceThemeMode,
            settings.appearanceLightTheme,
            settings.appearanceDarkTheme
        )
        updateSettings({
            appearanceThemeMode,
            theme,
            appearanceCustomThemeActive: false,
            accentColor: getPresetAccent(theme)
        })
    }

    const selectLightTheme = (appearanceLightTheme: LightTheme) => {
        const active = resolvedAppearance === 'light'
        updateSettings({
            appearanceLightTheme,
            ...(active ? {
                theme: appearanceLightTheme,
                appearanceCustomThemeActive: false,
                accentColor: getPresetAccent(appearanceLightTheme)
            } : {})
        })
    }

    const selectDarkTheme = (appearanceDarkTheme: DarkTheme) => {
        const active = resolvedAppearance === 'dark'
        updateSettings({
            appearanceDarkTheme,
            ...(active ? {
                theme: appearanceDarkTheme,
                appearanceCustomThemeActive: false,
                accentColor: getPresetAccent(appearanceDarkTheme)
            } : {})
        })
    }

    const useSavedCustomTheme = () => {
        const customTheme = settings.appearanceCustomTheme
        if (!customTheme) return
        const appearance = getThemeAppearance(customTheme.baseTheme)
        updateSettings({
            appearanceThemeMode: appearance,
            ...(appearance === 'light'
                ? { appearanceLightTheme: customTheme.baseTheme as LightTheme }
                : { appearanceDarkTheme: customTheme.baseTheme as DarkTheme }),
            appearanceCustomThemeActive: true,
            appearanceUiFont: customTheme.uiFont,
            appearanceCodeFont: customTheme.codeFont,
            theme: customTheme.baseTheme,
            accentColor: customTheme.accentColor
        })
    }

    const saveCustomTheme = (
        tokens: ThemeTokens,
        accentColor = settings.accentColor,
        uiFont: AppearanceUiFont = settings.appearanceUiFont,
        codeFont: AppearanceCodeFont = settings.appearanceCodeFont
    ) => {
        const baseTheme = settings.theme
        const appearance = getThemeAppearance(baseTheme)
        updateSettings({
            appearanceThemeMode: appearance,
            ...(appearance === 'light'
                ? { appearanceLightTheme: baseTheme as LightTheme }
                : { appearanceDarkTheme: baseTheme as DarkTheme }),
            appearanceCustomTheme: { baseTheme, tokens, accentColor, uiFont, codeFont },
            appearanceCustomThemeActive: true,
            appearanceUiFont: uiFont,
            appearanceCodeFont: codeFont,
            accentColor
        })
    }

    const resetTheme = () => {
        const appearanceLightTheme: LightTheme = DEFAULT_APPEARANCE_LIGHT_THEME
        const appearanceDarkTheme: DarkTheme = DEFAULT_APPEARANCE_DARK_THEME
        const theme = resolveAppearanceTheme('system', appearanceLightTheme, appearanceDarkTheme)
        updateSettings({
            appearanceThemeMode: 'system',
            appearanceLightTheme,
            appearanceDarkTheme,
            appearanceCustomThemeActive: false,
            appearanceUiFont: DEFAULT_APPEARANCE_UI_FONT,
            appearanceCodeFont: 'system-mono',
            theme,
            accentColor: getPresetAccent(theme)
        })
    }

    return (
        <SettingsPageContainer className="!max-w-[780px]" title="Appearance" backTo="/settings/app" backLabel="App">

            <section
                className="space-y-4"
                aria-labelledby="appearance-theme-title"
                data-settings-search-target={createSettingsSectionTargetId('Theme')}
                tabIndex={-1}
            >
                <div className="flex min-h-7 items-center justify-between gap-4 px-0.5">
                    <h2 id="appearance-theme-title" className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--settings-text)]">Theme</h2>
                    {paletteChanged ? (
                        <SettingsButton variant="ghost" onClick={resetTheme}>
                            <RotateCcw size={12} />
                            Reset
                        </SettingsButton>
                    ) : null}
                </div>

                <div
                    className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                    role="radiogroup"
                    aria-label="Appearance mode"
                    data-settings-search-target={createSettingsRowTargetId('Theme', 'Appearance mode')}
                    tabIndex={-1}
                >
                    <AppearanceSystemThemeCard
                        darkTheme={selectedDarkTheme}
                        lightTheme={selectedLightTheme}
                        selected={settings.appearanceThemeMode === 'system'}
                        onSelect={() => selectThemeMode('system')}
                    />
                    <AppearanceThemeCard
                        theme={customThemeActive && settings.appearanceResolvedMode === 'light' ? selectedTheme : selectedLightTheme}
                        label="Light"
                        selected={settings.appearanceThemeMode === 'light'}
                        onSelect={() => selectThemeMode('light')}
                    />
                    <AppearanceThemeCard
                        theme={customThemeActive && settings.appearanceResolvedMode === 'dark' ? selectedTheme : selectedDarkTheme}
                        label="Dark"
                        selected={settings.appearanceThemeMode === 'dark'}
                        onSelect={() => selectThemeMode('dark')}
                    />
                </div>

                <div
                    data-settings-search-target={createSettingsRowTargetId('Theme', 'Light and dark themes')}
                    tabIndex={-1}
                >
                    <AppearanceThemeSelector
                        appearance={settings.appearanceResolvedMode}
                        lightTheme={settings.appearanceLightTheme}
                        darkTheme={settings.appearanceDarkTheme}
                        onLightThemeChange={selectLightTheme}
                        onDarkThemeChange={selectDarkTheme}
                    />
                </div>

                <AppearanceCodePreview theme={selectedTheme} accent={settings.accentColor} compact={settings.compactMode} />

                <AppearanceThemeController
                    mode={settings.appearanceThemeMode}
                    theme={selectedTheme}
                    accent={settings.accentColor}
                    customActive={customThemeActive}
                    customAvailable={settings.appearanceCustomTheme !== null}
                    uiFont={settings.appearanceUiFont}
                    codeFont={settings.appearanceCodeFont}
                    uiFontLabel={resolveFontLabel(settings.appearanceUiFont)}
                    codeFontLabel={resolveFontLabel(settings.appearanceCodeFont)}
                    onUseCustom={useSavedCustomTheme}
                    onTokensChange={(tokens) => saveCustomTheme(tokens)}
                    onAccentChange={(accentColor) => saveCustomTheme(selectedTheme.tokens, accentColor)}
                    onUiFontChange={(uiFont) => saveCustomTheme(selectedTheme.tokens, settings.accentColor, uiFont)}
                    onCodeFontChange={(codeFont) => saveCustomTheme(selectedTheme.tokens, settings.accentColor, settings.appearanceUiFont, codeFont)}
                    onOpenFontManager={setFontManagerTarget}
                />
            </section>

            <SettingsSection title="Preferences">
                <SettingsRow
                    title="Interface density"
                    description="Choose comfortable spacing or fit more information on screen."
                    control={(
                        <SettingsSegmented
                            value={settings.compactMode ? 'compact' : 'comfortable'}
                            options={[
                                { value: 'comfortable', label: 'Comfortable' },
                                { value: 'compact', label: 'Compact' }
                            ]}
                            onChange={(value) => updateSettings({ compactMode: value === 'compact' })}
                            label="Interface density"
                        />
                    )}
                />
                <SettingsRow
                    title="Reduce motion"
                    description="Minimize transitions, animation, and smooth scrolling."
                    control={<SettingsSwitch checked={settings.accessibilityReduceMotion} onCheckedChange={(accessibilityReduceMotion) => updateSettings({ accessibilityReduceMotion })} label="Reduce motion" />}
                />
            </SettingsSection>

            {fontManagerTarget ? (
                <Suspense fallback={null}>
                    <AppearanceFontManagerDialog
                        open
                        target={fontManagerTarget}
                        managedFonts={managedFonts}
                        currentFont={fontManagerTarget === 'code' ? settings.appearanceCodeFont : settings.appearanceUiFont}
                        usedManagedFontIds={[
                            getAppearanceManagedFontId(settings.appearanceUiFont),
                            getAppearanceManagedFontId(settings.appearanceCodeFont),
                            settings.appearanceCustomTheme ? getAppearanceManagedFontId(settings.appearanceCustomTheme.uiFont) : null,
                            settings.appearanceCustomTheme ? getAppearanceManagedFontId(settings.appearanceCustomTheme.codeFont) : null
                        ].filter((fontId): fontId is string => Boolean(fontId))}
                        onManagedFontsChange={(fonts) => {
                            cachedManagedFonts = fonts
                            cachedManagedFontsAt = Date.now()
                            setManagedFonts(fonts)
                        }}
                        onSelect={(font) => {
                            if (fontManagerTarget === 'code') {
                                saveCustomTheme(selectedTheme.tokens, settings.accentColor, settings.appearanceUiFont, font as AppearanceCodeFont)
                            } else {
                                saveCustomTheme(selectedTheme.tokens, settings.accentColor, font as AppearanceUiFont)
                            }
                        }}
                        onClose={() => setFontManagerTarget(null)}
                    />
                </Suspense>
            ) : null}
        </SettingsPageContainer>
    )
}
