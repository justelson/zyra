import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import {
    ACCENT_COLORS,
    APPEARANCE_CODE_FONTS,
    APPEARANCE_UI_FONTS,
    getAppearanceCodeFontStack,
    getAppearanceUiFontStack,
    type AccentColor,
    type AppearanceCodeFont,
    type AppearanceThemeMode,
    type AppearanceUiFont
} from '@/lib/settings'
import type { ThemeDefinition, ThemeTokens } from '@/lib/settings-theme-catalog'
import { SettingsButton, SettingsNotice, SettingsSelect } from '../settings-layout'
import { createSettingsRowTargetId } from '../settings-search'

const TOKEN_LABELS: ReadonlyArray<{ key: keyof ThemeTokens; label: string }> = [
    { key: 'bg', label: 'Background' },
    { key: 'text', label: 'Foreground' },
    { key: 'textDark', label: 'Strong text' },
    { key: 'textDarker', label: 'Subtle text' },
    { key: 'textSecondary', label: 'Secondary text' },
    { key: 'textMuted', label: 'Muted text' },
    { key: 'card', label: 'Card' },
    { key: 'border', label: 'Border' },
    { key: 'borderSecondary', label: 'Strong border' },
    { key: 'primary', label: 'Theme primary' },
    { key: 'secondary', label: 'Theme secondary' },
    { key: 'accent', label: 'Surface accent' }
]

function EditableHexValue({
    label,
    value,
    onCommit
}: {
    label: string
    value: string
    onCommit: (value: string) => void
}) {
    const [draft, setDraft] = useState(value)

    useEffect(() => setDraft(value), [value])

    const commit = () => {
        const normalized = draft.trim().toLowerCase()
        if (/^#[0-9a-f]{6}$/.test(normalized)) {
            setDraft(normalized)
            if (normalized !== value.toLowerCase()) onCommit(normalized)
            return
        }
        setDraft(value)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(value)
            event.currentTarget.select()
        }
    }

    return (
        <div className="zyra-theme-color-control ml-auto flex h-8 w-[160px] min-w-0 overflow-hidden rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)]">
            <input
                type="color"
                value={value}
                onChange={(event) => onCommit(event.target.value.toLowerCase())}
                aria-label={`${label} color picker`}
                className="zyra-native-color-input h-full w-11 shrink-0"
            />
            <input
                type="text"
                value={draft}
                onChange={(event) => {
                    const nextValue = event.target.value
                    setDraft(nextValue)
                    if (/^#[0-9a-fA-F]{6}$/.test(nextValue)) onCommit(nextValue.toLowerCase())
                }}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                aria-label={`${label} hex value`}
                className="zyra-theme-color-hex h-full min-w-0 flex-1 border-0 bg-[var(--settings-control)] px-2.5 text-right font-mono text-[11px] uppercase text-[var(--settings-text-secondary)] outline-none focus:text-[var(--settings-text)]"
            />
        </div>
    )
}

export function AppearanceThemeController({
    mode,
    theme,
    accent,
    uiFont,
    codeFont,
    uiFontLabel,
    codeFontLabel,
    customActive,
    customAvailable,
    onUseCustom,
    onTokensChange,
    onAccentChange,
    onUiFontChange,
    onCodeFontChange,
    onOpenFontManager
}: {
    mode: AppearanceThemeMode
    theme: ThemeDefinition
    accent: AccentColor
    uiFont: AppearanceUiFont
    codeFont: AppearanceCodeFont
    uiFontLabel: string
    codeFontLabel: string
    customActive: boolean
    customAvailable: boolean
    onUseCustom: () => void
    onTokensChange: (tokens: ThemeTokens) => void
    onAccentChange: (accent: AccentColor) => void
    onUiFontChange: (font: AppearanceUiFont) => void
    onCodeFontChange: (font: AppearanceCodeFont) => void
    onOpenFontManager: (target: 'ui' | 'code') => void
}) {
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const modeTitle = customActive
        ? `Custom ${theme.name} theme`
        : mode === 'system' ? 'System default' : `${theme.name} theme`
    const modeDescription = customActive
        ? `Saved custom values based on ${theme.name}`
        : mode === 'system'
            ? `Following system appearance · ${theme.name}`
            : theme.description
    const matchedAccent = ACCENT_COLORS.find((entry) => (
        entry.primary.toLowerCase() === accent.primary.toLowerCase()
        && entry.secondary.toLowerCase() === accent.secondary.toLowerCase()
    ))
    const copyTheme = async () => {
        setCopyError(null)
        try {
            await navigator.clipboard.writeText(JSON.stringify({
                mode: customActive ? 'custom' : mode,
                baseTheme: theme.id,
                accent,
                uiFont,
                codeFont,
                tokens: theme.tokens
            }, null, 2))
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
        } catch {
            setCopied(false)
            setCopyError('Could not copy theme values to the clipboard.')
        }
    }

    return (
        <div className="overflow-visible rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)] text-[var(--settings-text)] shadow-[inset_0_1px_0_var(--settings-section-highlight)]">
            <div
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                data-settings-search-target={createSettingsRowTargetId('Theme', 'Custom theme')}
                tabIndex={-1}
            >
                <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-semibold text-[var(--settings-text)]">{modeTitle}</h3>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--settings-text-muted)]">{modeDescription}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    {customAvailable && !customActive ? (
                        <SettingsButton variant="ghost" onClick={onUseCustom}>Use saved custom</SettingsButton>
                    ) : null}
                    <SettingsButton variant="ghost" onClick={() => void copyTheme()}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy values'}
                    </SettingsButton>
                </div>
            </div>

            {copyError ? <SettingsNotice tone="error">{copyError}</SettingsNotice> : null}
            <div className="max-h-[420px] overflow-auto border-t border-[var(--settings-border)] [scrollbar-gutter:stable]">
                <table
                    className="w-full table-fixed border-collapse"
                    aria-label="Editable theme values"
                    data-settings-search-target={createSettingsRowTargetId('Theme', 'Theme colors')}
                    tabIndex={-1}
                >
                    <colgroup>
                        <col className="w-[42%]" />
                        <col />
                    </colgroup>
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-[var(--settings-control)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--settings-text-muted)]">
                            <th scope="col" className="px-4 py-2 text-left">Property</th>
                            <th scope="col" className="px-4 py-2 text-right">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            className="border-t border-[var(--settings-border)]"
                            data-settings-search-target={createSettingsRowTargetId('Theme', 'Accent preset')}
                            tabIndex={-1}
                        >
                            <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">Accent preset</th>
                            <td className="px-4 py-2.5 text-right">
                                <SettingsSelect
                                    value={matchedAccent?.name || 'Custom'}
                                    onChange={(event) => {
                                        const nextAccent = ACCENT_COLORS.find((entry) => entry.name === event.target.value)
                                        if (nextAccent) onAccentChange(nextAccent)
                                    }}
                                    aria-label="Accent preset"
                                    className="!w-[150px]"
                                >
                                    {!matchedAccent ? <option value="Custom">Custom</option> : null}
                                    {ACCENT_COLORS.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
                                </SettingsSelect>
                            </td>
                        </tr>
                        <tr
                            className="border-t border-[var(--settings-border)]"
                            data-settings-search-target={createSettingsRowTargetId('Theme', 'Accent primary')}
                            tabIndex={-1}
                        >
                            <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">Accent primary</th>
                            <td className="px-4 py-2.5">
                                <EditableHexValue
                                    label="Accent primary"
                                    value={accent.primary}
                                    onCommit={(primary) => onAccentChange({ name: 'Custom', primary, secondary: accent.secondary })}
                                />
                            </td>
                        </tr>
                        <tr
                            className="border-t border-[var(--settings-border)]"
                            data-settings-search-target={createSettingsRowTargetId('Theme', 'Accent secondary')}
                            tabIndex={-1}
                        >
                            <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">Accent secondary</th>
                            <td className="px-4 py-2.5">
                                <EditableHexValue
                                    label="Accent secondary"
                                    value={accent.secondary}
                                    onCommit={(secondary) => onAccentChange({ name: 'Custom', primary: accent.primary, secondary })}
                                />
                            </td>
                        </tr>
                        <tr
                            className="border-t border-[var(--settings-border)]"
                            data-settings-search-target={createSettingsRowTargetId('Theme', 'UI font')}
                            tabIndex={-1}
                        >
                            <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">UI font</th>
                            <td className="px-4 py-2.5 text-right">
                                <SettingsSelect
                                    value={uiFont}
                                    onChange={(event) => {
                                        if (event.target.value === '__more_fonts__') onOpenFontManager('ui')
                                        else onUiFontChange(event.target.value as AppearanceUiFont)
                                    }}
                                    aria-label="UI font"
                                    className="!w-[190px] !min-w-[190px]"
                                    style={{ fontFamily: getAppearanceUiFontStack(uiFont) }}
                                >
                                    {!APPEARANCE_UI_FONTS.some((entry) => entry.id === uiFont) ? <option value={uiFont}>{uiFontLabel}</option> : null}
                                    {APPEARANCE_UI_FONTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                                    <option disabled>──────────</option>
                                    <option value="__more_fonts__">More fonts…</option>
                                </SettingsSelect>
                            </td>
                        </tr>
                        <tr
                            className="border-t border-[var(--settings-border)]"
                            data-settings-search-target={createSettingsRowTargetId('Theme', 'Code font')}
                            tabIndex={-1}
                        >
                            <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">Code font</th>
                            <td className="px-4 py-2.5 text-right">
                                <SettingsSelect
                                    value={codeFont}
                                    onChange={(event) => {
                                        if (event.target.value === '__more_fonts__') onOpenFontManager('code')
                                        else onCodeFontChange(event.target.value as AppearanceCodeFont)
                                    }}
                                    aria-label="Code font"
                                    className="!w-[190px] !min-w-[190px]"
                                    style={{ fontFamily: getAppearanceCodeFontStack(codeFont) }}
                                >
                                    {!APPEARANCE_CODE_FONTS.some((entry) => entry.id === codeFont) ? <option value={codeFont}>{codeFontLabel}</option> : null}
                                    {APPEARANCE_CODE_FONTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                                    <option disabled>──────────</option>
                                    <option value="__more_fonts__">More fonts…</option>
                                </SettingsSelect>
                            </td>
                        </tr>
                        {TOKEN_LABELS.map(({ key, label }) => (
                            <tr
                                key={key}
                                className="border-t border-[var(--settings-border)]"
                                data-settings-search-target={createSettingsRowTargetId('Theme', label)}
                                tabIndex={-1}
                            >
                                <th scope="row" className="px-4 py-2.5 text-left text-[12px] font-medium text-[var(--settings-text-secondary)]">{label}</th>
                                <td className="px-4 py-2.5">
                                    <EditableHexValue
                                        label={label}
                                        value={theme.tokens[key]}
                                        onCommit={(value) => onTokensChange({ ...theme.tokens, [key]: value })}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
