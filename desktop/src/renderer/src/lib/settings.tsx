/**
 * Zyra - Settings Store & Context
 * Main-owned device settings facade with one-time renderer v4 migration.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { dispatchZyraThemeChanged } from './theme-events'
import { clearProjectViewCaches } from './projectViewCache'
import { clearRecentProjects } from './recentProjects'
import { clearSettingsRuntimeCaches } from './settings-cache-registry'
import type { AssistantReasoningEffort, AssistantRuntimeMode } from '@shared/assistant/contracts'
import {
    DEFAULT_ASSISTANT_AUTO_TITLE_TURNS,
    DEFAULT_ASSISTANT_TITLE_MODEL,
    normalizeAssistantAutoTitleTurnInterval
} from '@shared/assistant/title-generation'
import {
    DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
    DEFAULT_ASSISTANT_REASONING_SUMMARY,
    normalizeAssistantContextCompactionThresholdTokens,
    normalizeAssistantReasoningSummaryMode,
    type AssistantReasoningSummaryMode
} from '@shared/assistant/runtime-policy'
import {
    loadLegacyAssistantComposerDefaults,
    sanitizeAssistantDefaultEffort,
    sanitizeAssistantDefaultRuntimeMode
} from './settings-assistant-defaults'
import {
    DARK_THEMES,
    LIGHT_THEMES,
    THEME_CLASS_IDS,
    THEMES,
    getThemeAppearance,
    getThemeDefinition,
    isDarkThemeId,
    isLightThemeId,
    isThemeId,
    type DarkTheme,
    type LightTheme,
    type Theme,
    type ThemeAppearance,
    type ThemeTokens
} from './settings-theme-catalog'
import { resolveAccentTokens, resolveStatusTokens, resolveThemeTokens, toRgbChannels } from './settings-theme-semantics'
import { getDevicePreferenceOwnership, type DevicePreferenceSurface, type DevicePreferencesSnapshot } from '@shared/preferences/contracts'
import type { UpdateHostedAiSecretsInput } from '@shared/preferences/secrets-contracts'
import { isElectronRendererRuntime } from './browser-file-url'
import { setCanonicalAssistantAutoReconnectPreference } from './assistant/assistant-runtime-preferences'
import { captureProductEvent } from './product-analytics'

export {
    DARK_THEMES,
    LIGHT_THEMES,
    THEMES,
    getThemeAppearance,
    isDarkThemeId,
    isLightThemeId,
    type DarkTheme,
    type LightTheme,
    type Theme,
    type ThemeAppearance
} from './settings-theme-catalog'
export {
    getAssistantBusyMessageModeLabel,
    getAssistantDefaultEffortLabel,
    getAssistantDefaultRuntimeModeLabel,
    getAssistantDefaultSpeedLabel,
    getAssistantDefaultsPreview
} from './settings-assistant-defaults'

// Settings Types
export type Shell = 'powershell' | 'cmd'
export type CommitAIProvider = 'groq' | 'gemini' | 'codex'
export type BrowserViewMode = 'grid' | 'finder'
export type BrowserContentLayout = 'grouped' | 'explorer'
export type AssistantBrowserBackgroundMode = 'off' | 'built-in' | 'unsplash'
export type AssistantBrowserBackgroundCategory = 'all' | 'forest-paths' | 'mountain-highs' | 'ocean-moods' | 'desert-dreams' | 'water-in-motion' | 'wildflower-party' | 'animal-cameos' | 'ice-aurora' | 'earth-above'
export type AssistantBrowserBackgroundRotation = 'every-tab' | 'fixed'
export type GitBulkActionScope = 'project' | 'repo'
export type FilePreviewDefaultMode = 'preview' | 'edit'
export type FilePreviewPythonRunMode = 'terminal' | 'output'
export type FilePreviewExplorerNameLayout = 'wrap' | 'horizontal'
export type FileEditorWordWrap = 'on' | 'off'
export type FileDiffRenderMode = 'stacked' | 'split'
export type PackageRuntimePreference = 'auto' | 'node' | 'npm' | 'pnpm' | 'yarn' | 'bun'
export type PullRequestGuideSource = 'project' | 'global' | 'repo-template' | 'none'
export type PullRequestGuideMode = 'text' | 'file'
export type PullRequestChangeSource = 'unstaged' | 'staged' | 'local-commits' | 'all-local-work'
export type AssistantUsageDisplayMode = 'remaining' | 'used'
export type AssistantTextStreamingMode = 'stream' | 'chunks'
export type AssistantToolOutputDefaultMode = 'expanded' | 'minimized'
export type AssistantDefaultRuntimeMode = AssistantRuntimeMode
export type AssistantDefaultEffort = AssistantReasoningEffort
export type AssistantReasoningSummary = AssistantReasoningSummaryMode
export type AssistantTranscriptionEngine = 'browser' | 'codex'
export type AssistantBusyMessageMode = 'queue' | 'force'
export type AssistantProductProfile = 'default' | 'builder'
export type AppearanceThemeMode = 'system' | 'light' | 'dark'
export type AppearanceManagedFont = `managed:${string}`
export type AppearanceLocalFont = `local:${string}`
export type AppearanceUiFont = 'hanken' | 'bricolage' | 'segoe' | 'system' | AppearanceManagedFont | AppearanceLocalFont
export type AppearanceCodeFont = 'system-mono' | 'cascadia' | 'consolas' | 'jetbrains' | AppearanceManagedFont | AppearanceLocalFont
// Kept dormant until Appearance settings exposes the classic/workspace inspector choice.

export interface PullRequestGuideConfig {
    mode: PullRequestGuideMode
    text: string
    filePath: string
}

export interface ProjectPullRequestConfig {
    guideSource: PullRequestGuideSource
    guide: PullRequestGuideConfig
    targetBranch: string
    draft: boolean
    changeSource: PullRequestChangeSource
}

export interface AccentColor {
    name: string
    primary: string
    secondary: string
}

export interface AppearanceCustomTheme {
    baseTheme: Theme
    tokens: ThemeTokens
    accentColor: AccentColor
    uiFont: AppearanceUiFont
    codeFont: AppearanceCodeFont
}

export const DEFAULT_APPEARANCE_UI_FONT: AppearanceUiFont = 'bricolage'

export const APPEARANCE_UI_FONTS: ReadonlyArray<{ id: AppearanceUiFont; label: string; stack: string }> = [
    { id: 'bricolage', label: 'Bricolage Grotesque', stack: '"Bricolage Grotesque", "Hanken Grotesk", "Segoe UI", system-ui, sans-serif' },
    { id: 'hanken', label: 'Hanken Grotesk', stack: '"Hanken Grotesk Variable", "Hanken Grotesk", "Segoe UI", system-ui, sans-serif' },
    { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
    { id: 'system', label: 'System UI', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }
]

export const APPEARANCE_CODE_FONTS: ReadonlyArray<{ id: AppearanceCodeFont; label: string; stack: string }> = [
    { id: 'system-mono', label: 'System monospace', stack: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace' },
    { id: 'cascadia', label: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
    { id: 'consolas', label: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
    { id: 'jetbrains', label: 'JetBrains Mono', stack: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' }
]

export function createAppearanceManagedFont(fontId: string): AppearanceManagedFont {
    return `managed:${fontId.replace(/[^a-z0-9-]/gi, '').slice(0, 96)}`
}

export function getAppearanceManagedFontId(font: AppearanceUiFont | AppearanceCodeFont): string | null {
    return font.startsWith('managed:') ? font.slice('managed:'.length) : null
}

export function getAppearanceManagedFontAlias(fontId: string): string {
    return `Zyra Managed ${fontId.replace(/[^a-z0-9-]/gi, '-').slice(0, 96)}`
}

export function createAppearanceLocalFont(family: string): AppearanceLocalFont {
    const normalized = family.trim().replace(/\s+/g, ' ').slice(0, 96)
    return `local:${encodeURIComponent(normalized)}`
}

export function getAppearanceLocalFontFamily(font: AppearanceUiFont | AppearanceCodeFont): string | null {
    if (!font.startsWith('local:')) return null
    try {
        return decodeURIComponent(font.slice('local:'.length)).replace(/[";{}]/g, '').trim().slice(0, 96) || null
    } catch {
        return null
    }
}

function quoteFontFamily(family: string): string {
    return `"${family.replace(/["\\]/g, '')}"`
}

export function getAppearanceUiFontStack(font: AppearanceUiFont): string {
    const managedFontId = getAppearanceManagedFontId(font)
    if (managedFontId) return `${quoteFontFamily(getAppearanceManagedFontAlias(managedFontId))}, "Segoe UI", system-ui, sans-serif`
    const localFamily = getAppearanceLocalFontFamily(font)
    if (localFamily) return `${quoteFontFamily(localFamily)}, "Segoe UI", system-ui, sans-serif`
    return APPEARANCE_UI_FONTS.find((entry) => entry.id === font)?.stack || APPEARANCE_UI_FONTS[0].stack
}

export function getAppearanceCodeFontStack(font: AppearanceCodeFont): string {
    const managedFontId = getAppearanceManagedFontId(font)
    if (managedFontId) return `${quoteFontFamily(getAppearanceManagedFontAlias(managedFontId))}, Consolas, monospace`
    const localFamily = getAppearanceLocalFontFamily(font)
    if (localFamily) return `${quoteFontFamily(localFamily)}, Consolas, monospace`
    return APPEARANCE_CODE_FONTS.find((entry) => entry.id === font)?.stack || APPEARANCE_CODE_FONTS[0].stack
}

export const ACCENT_COLORS: AccentColor[] = [
    { name: 'Blue', primary: '#3b82f6', secondary: '#60a5fa' },
    { name: 'Purple', primary: '#8b5cf6', secondary: '#a78bfa' },
    { name: 'Pink', primary: '#ec4899', secondary: '#f472b6' },
    { name: 'Green', primary: '#22c55e', secondary: '#4ade80' },
    { name: 'Orange', primary: '#f97316', secondary: '#fb923c' },
    { name: 'Cyan', primary: '#06b6d4', secondary: '#22d3ee' },
    { name: 'Red', primary: '#ef4444', secondary: '#f87171' },
    { name: 'Yellow', primary: '#eab308', secondary: '#facc15' },
    { name: 'Teal', primary: '#14b8a6', secondary: '#2dd4bf' },
    { name: 'Indigo', primary: '#6366f1', secondary: '#818cf8' },
    { name: 'Rose', primary: '#f43f5e', secondary: '#fb7185' },
    { name: 'Emerald', primary: '#10b981', secondary: '#34d399' },
    { name: 'Violet', primary: '#7c3aed', secondary: '#a78bfa' },
    { name: 'Amber', primary: '#f59e0b', secondary: '#fbbf24' },
    { name: 'Lime', primary: '#84cc16', secondary: '#a3e635' },
    { name: 'Sky', primary: '#0ea5e9', secondary: '#38bdf8' }
]

function accentsEqual(left: AccentColor, right: AccentColor): boolean {
    return left.primary.toLowerCase() === right.primary.toLowerCase()
        && left.secondary.toLowerCase() === right.secondary.toLowerCase()
}

export function getThemePresetAccent(theme: Theme): AccentColor {
    const definition = getThemeDefinition(theme)
    return ACCENT_COLORS.find((accent) => accent.name === definition.accentColor) || ACCENT_COLORS[0]
}

export interface Settings {
    settingsSchemaVersion: 4
    theme: Theme
    appearanceThemeMode: AppearanceThemeMode
    appearanceLightTheme: LightTheme
    appearanceDarkTheme: DarkTheme
    appearanceResolvedMode: ThemeAppearance
    appearanceCustomTheme: AppearanceCustomTheme | null
    appearanceCustomThemeActive: boolean
    appearanceUiFont: AppearanceUiFont
    appearanceCodeFont: AppearanceCodeFont
    accentColor: AccentColor
    compactMode: boolean
    sidebarCollapsed: boolean
    sidebarHoverPreviewEnabled: boolean
    assistantAgentInboxSidebarEnabled: boolean
    explorerTabEnabled: boolean
    explorerHomePath: string
    defaultShell: Shell
    startMinimized: boolean
    startWithWindows: boolean
    browserViewMode: BrowserViewMode
    browserContentLayout: BrowserContentLayout
    filePreviewOpenInFullscreen: boolean
    filePreviewFullscreenShowLeftPanel: boolean
    filePreviewFullscreenShowRightPanel: boolean
    filePreviewDefaultMode: FilePreviewDefaultMode
    filePreviewPythonRunMode: FilePreviewPythonRunMode
    filePreviewExplorerNameLayout: FilePreviewExplorerNameLayout
    fileEditorWordWrap: FileEditorWordWrap
    fileEditorMinimapEnabled: boolean
    fileEditorFontSize: number
    fileCsvDistinctColorsEnabled: boolean
    fileDiffRenderMode: FileDiffRenderMode
    packageRuntimePreference: PackageRuntimePreference
    filePreviewTerminalPanelHeight: number
    terminalFontSize: number
    terminalCursorBlink: boolean
    terminalScrollback: number
    assistantBrowserRestoreTabs: boolean
    assistantBrowserGoogleSuggestions: boolean
    assistantBrowserAdBlockEnabled: boolean
    assistantBrowserAdBlockPromptDismissed: boolean
    assistantBrowserNewTabBackgroundMode: AssistantBrowserBackgroundMode
    assistantBrowserNewTabBackgroundCategory: AssistantBrowserBackgroundCategory
    assistantBrowserNewTabBackgroundRotation: AssistantBrowserBackgroundRotation
    assistantBrowserNewTabBackgroundId: string
    projectsFolder: string
    additionalFolders: string[]
    gitAutoRefreshOnProjectOpen: boolean
    gitInitDefaultBranch: string
    gitInitCreateGitignore: boolean
    gitInitCreateInitialCommit: boolean
    gitWarnOnAuthorMismatch: boolean
    gitBulkActionScope: GitBulkActionScope
    gitPullRequestGlobalGuide: PullRequestGuideConfig
    gitPullRequestDefaultGuideSource: PullRequestGuideSource
    gitPullRequestDefaultTargetBranch: string
    gitPullRequestDefaultDraft: boolean
    gitPullRequestDefaultChangeSource: PullRequestChangeSource
    gitProjectPullRequestConfigs: Record<string, ProjectPullRequestConfig>
    gitAutoCreateBranchWhenTargetMatches: boolean
    groqApiKey: string
    geminiApiKey: string
    groqApiKeyConfigured: boolean
    geminiApiKeyConfigured: boolean
    gitCommitCodexModel: string
    gitPullRequestCodexModel: string
    commitAIProvider: CommitAIProvider
    assistantUsageDisplayMode: AssistantUsageDisplayMode
    assistantTextStreamingMode: AssistantTextStreamingMode
    assistantToolOutputDefaultMode: AssistantToolOutputDefaultMode
    assistantDefaultModel: string
    assistantTitleModel: string
    assistantTitleAutoRegenerate: boolean
    assistantTitleAutoRegenerateTurns: number
    assistantDefaultPromptTemplate: string
    assistantProductProfile: AssistantProductProfile
    assistantDefaultRuntimeMode: AssistantDefaultRuntimeMode
    assistantDefaultEffort: AssistantDefaultEffort
    assistantDefaultFastMode: boolean
    assistantReasoningSummary: AssistantReasoningSummary
    assistantContextCompactionThresholdTokens: number
    assistantDefaultWebSearch: boolean
    assistantDefaultWebFetch: boolean
    assistantBusyMessageMode: AssistantBusyMessageMode
    assistantAutoReconnect: boolean
    assistantHistoryPrefetch: boolean
    assistantShowStatusDetails: boolean
    assistantShowDiagnostics: boolean
    accessibilityReduceMotion: boolean
    projectIconOverrides: Record<string, string>
    assistantTranscriptionEnabled: boolean
    assistantTranscriptionEngine: AssistantTranscriptionEngine
}

const DEFAULT_SETTINGS: Settings = {
    settingsSchemaVersion: 4,
    theme: 'dark',
    appearanceThemeMode: 'system',
    appearanceLightTheme: 'light',
    appearanceDarkTheme: 'dark',
    appearanceResolvedMode: 'dark',
    appearanceCustomTheme: null,
    appearanceCustomThemeActive: false,
    appearanceUiFont: DEFAULT_APPEARANCE_UI_FONT,
    appearanceCodeFont: 'system-mono',
    accentColor: ACCENT_COLORS[0],
    compactMode: false,
    sidebarCollapsed: false,
    sidebarHoverPreviewEnabled: true,
    assistantAgentInboxSidebarEnabled: false,
    explorerTabEnabled: false,
    explorerHomePath: '',
    defaultShell: 'powershell',
    startMinimized: false,
    startWithWindows: false,
    browserViewMode: 'finder',
    browserContentLayout: 'explorer',
    filePreviewOpenInFullscreen: false,
    filePreviewFullscreenShowLeftPanel: true,
    filePreviewFullscreenShowRightPanel: false,
    filePreviewDefaultMode: 'preview',
    filePreviewPythonRunMode: 'terminal',
    filePreviewExplorerNameLayout: 'wrap',
    fileEditorWordWrap: 'on',
    fileEditorMinimapEnabled: true,
    fileEditorFontSize: 13,
    fileCsvDistinctColorsEnabled: true,
    fileDiffRenderMode: 'stacked',
    packageRuntimePreference: 'auto',
    filePreviewTerminalPanelHeight: 220,
    terminalFontSize: 12,
    terminalCursorBlink: true,
    terminalScrollback: 5000,
    assistantBrowserRestoreTabs: true,
    assistantBrowserGoogleSuggestions: true,
    assistantBrowserAdBlockEnabled: false,
    assistantBrowserAdBlockPromptDismissed: false,
    assistantBrowserNewTabBackgroundMode: 'built-in',
    assistantBrowserNewTabBackgroundCategory: 'all',
    assistantBrowserNewTabBackgroundRotation: 'every-tab',
    assistantBrowserNewTabBackgroundId: '',
    projectsFolder: '',
    additionalFolders: [],
    gitAutoRefreshOnProjectOpen: true,
    gitInitDefaultBranch: 'main',
    gitInitCreateGitignore: true,
    gitInitCreateInitialCommit: false,
    gitWarnOnAuthorMismatch: true,
    gitBulkActionScope: 'repo',
    gitPullRequestGlobalGuide: {
        mode: 'text',
        text: '',
        filePath: ''
    },
    gitPullRequestDefaultGuideSource: 'global',
    gitPullRequestDefaultTargetBranch: 'main',
    gitPullRequestDefaultDraft: true,
    gitPullRequestDefaultChangeSource: 'all-local-work',
    gitProjectPullRequestConfigs: {},
    gitAutoCreateBranchWhenTargetMatches: false,
    groqApiKey: '',
    geminiApiKey: '',
    groqApiKeyConfigured: false,
    geminiApiKeyConfigured: false,
    gitCommitCodexModel: '',
    gitPullRequestCodexModel: '',
    commitAIProvider: 'codex',
    assistantUsageDisplayMode: 'remaining',
    assistantTextStreamingMode: 'stream',
    assistantToolOutputDefaultMode: 'minimized',
    assistantDefaultModel: '',
    assistantTitleModel: DEFAULT_ASSISTANT_TITLE_MODEL,
    assistantTitleAutoRegenerate: false,
    assistantTitleAutoRegenerateTurns: DEFAULT_ASSISTANT_AUTO_TITLE_TURNS,
    assistantDefaultPromptTemplate: '',
    assistantProductProfile: 'default',
    assistantDefaultRuntimeMode: 'approval-required',
    assistantDefaultEffort: 'medium',
    assistantDefaultFastMode: false,
    assistantReasoningSummary: DEFAULT_ASSISTANT_REASONING_SUMMARY,
    assistantContextCompactionThresholdTokens: DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
    assistantDefaultWebSearch: true,
    assistantDefaultWebFetch: true,
    assistantBusyMessageMode: 'queue',
    assistantAutoReconnect: true,
    assistantHistoryPrefetch: false,
    assistantShowStatusDetails: true,
    assistantShowDiagnostics: false,
    accessibilityReduceMotion: false,
    projectIconOverrides: {},
    assistantTranscriptionEnabled: false,
    assistantTranscriptionEngine: 'browser'
}

const STORAGE_KEY = 'devscope-settings'
const LEGACY_ASSISTANT_COMPOSER_PREFERENCES_STORAGE_KEY = 'devscope:assistant-composer-preferences'

function sanitizeString(value: unknown, maxLength: number, trim = true): string {
    if (typeof value !== 'string') return ''
    const normalized = trim ? value.trim() : value
    return normalized.slice(0, maxLength)
}

function sanitizeStringRecord(value: unknown, limit = 100): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].trim().length > 0 && entry[1].trim().length > 0)
            .slice(0, limit)
            .map(([key, entryValue]) => [key.trim().slice(0, 2_048), entryValue.trim().slice(0, 2_048)])
    )
}

function sanitizeStringList(value: unknown, limit = 32): string[] {
    if (!Array.isArray(value)) return []
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().slice(0, 2_048))
        .filter(Boolean))]
        .slice(0, limit)
}

function sanitizeDynamicAppearanceFont(value: unknown): AppearanceManagedFont | AppearanceLocalFont | null {
    if (typeof value !== 'string') return null
    if (/^managed:[a-z0-9-]{3,96}$/i.test(value)) return value.toLowerCase() as AppearanceManagedFont
    if (value.startsWith('local:')) {
        const family = getAppearanceLocalFontFamily(value as AppearanceLocalFont)
        return family ? createAppearanceLocalFont(family) : null
    }
    return null
}

function sanitizeAppearanceUiFont(value: unknown): AppearanceUiFont {
    const dynamicFont = sanitizeDynamicAppearanceFont(value)
    if (dynamicFont) return dynamicFont
    return value === 'hanken' || value === 'bricolage' || value === 'segoe' || value === 'system'
        ? value
        : DEFAULT_APPEARANCE_UI_FONT
}

function sanitizeAppearanceCodeFont(value: unknown): AppearanceCodeFont {
    const dynamicFont = sanitizeDynamicAppearanceFont(value)
    if (dynamicFont) return dynamicFont
    return value === 'cascadia' || value === 'consolas' || value === 'jetbrains' ? value : 'system-mono'
}

function sanitizeHexColor(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim().toLowerCase()
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null
}

function sanitizeAccentColor(value: unknown): AccentColor {
    if (!value || typeof value !== 'object') return ACCENT_COLORS[0]
    const candidate = value as Partial<AccentColor>
    const requestedName = sanitizeString(candidate.name, 32)
    const preset = ACCENT_COLORS.find((color) => color.name === requestedName)
    if (preset) return preset

    const primary = sanitizeHexColor(candidate.primary)
    const secondary = sanitizeHexColor(candidate.secondary)
    return requestedName === 'Custom' && primary && secondary
        ? { name: 'Custom', primary, secondary }
        : ACCENT_COLORS[0]
}

function sanitizeThemeTokens(value: unknown, fallback: ThemeTokens): ThemeTokens {
    const candidate = value && typeof value === 'object' ? value as Partial<ThemeTokens> : {}
    return {
        bg: sanitizeHexColor(candidate.bg) || fallback.bg,
        text: sanitizeHexColor(candidate.text) || fallback.text,
        textDark: sanitizeHexColor(candidate.textDark) || fallback.textDark,
        textDarker: sanitizeHexColor(candidate.textDarker) || fallback.textDarker,
        textSecondary: sanitizeHexColor(candidate.textSecondary) || fallback.textSecondary,
        textMuted: sanitizeHexColor(candidate.textMuted) || fallback.textMuted,
        card: sanitizeHexColor(candidate.card) || fallback.card,
        border: sanitizeHexColor(candidate.border) || fallback.border,
        borderSecondary: sanitizeHexColor(candidate.borderSecondary) || fallback.borderSecondary,
        primary: sanitizeHexColor(candidate.primary) || fallback.primary,
        secondary: sanitizeHexColor(candidate.secondary) || fallback.secondary,
        accent: sanitizeHexColor(candidate.accent) || fallback.accent
    }
}

function sanitizeAppearanceCustomTheme(value: unknown): AppearanceCustomTheme | null {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<AppearanceCustomTheme>
    if (!isThemeId(candidate.baseTheme)) return null
    const baseTheme = getThemeDefinition(candidate.baseTheme)
    return {
        baseTheme: candidate.baseTheme,
        tokens: sanitizeThemeTokens(candidate.tokens, baseTheme.tokens),
        accentColor: sanitizeAccentColor(candidate.accentColor),
        uiFont: sanitizeAppearanceUiFont(candidate.uiFont),
        codeFont: sanitizeAppearanceCodeFont(candidate.codeFont)
    }
}

export function getSystemAppearanceTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveAppearanceTheme(
    mode: AppearanceThemeMode,
    lightTheme: LightTheme,
    darkTheme: DarkTheme
): Theme {
    if (mode === 'light') return lightTheme
    if (mode === 'dark') return darkTheme
    return getSystemAppearanceTheme() === 'dark' ? darkTheme : lightTheme
}

function sanitizePullRequestGuideConfig(value: unknown): PullRequestGuideConfig {
    const candidate = typeof value === 'object' && value !== null ? value as Partial<PullRequestGuideConfig> : {}
    return {
        mode: candidate.mode === 'file' ? 'file' : 'text',
        text: sanitizeString(candidate.text, 32_000, false),
        filePath: sanitizeString(candidate.filePath, 2_048)
    }
}

function sanitizePullRequestChangeSource(value: unknown, fallback: PullRequestChangeSource): PullRequestChangeSource {
    if (value === 'unstaged' || value === 'staged' || value === 'local-commits' || value === 'all-local-work') {
        return value
    }
    if (value === 'selected-commits') return 'local-commits'
    if (value === 'all-ready') return 'all-local-work'
    return fallback
}

function sanitizeProjectPullRequestConfig(value: unknown, defaults: Settings): ProjectPullRequestConfig {
    const candidate = typeof value === 'object' && value !== null ? value as Partial<ProjectPullRequestConfig> : {}
    return {
        guideSource: candidate.guideSource === 'project' || candidate.guideSource === 'repo-template' || candidate.guideSource === 'none'
            ? candidate.guideSource
            : 'global',
        guide: sanitizePullRequestGuideConfig(candidate.guide),
        targetBranch: sanitizeString(candidate.targetBranch, 256) || defaults.gitPullRequestDefaultTargetBranch,
        draft: candidate.draft !== false,
        changeSource: sanitizePullRequestChangeSource(
            (candidate as Partial<ProjectPullRequestConfig> & { scope?: unknown }).changeSource
                ?? (candidate as Partial<ProjectPullRequestConfig> & { scope?: unknown }).scope,
            defaults.gitPullRequestDefaultChangeSource
        )
    }
}

export function loadSettings(source?: Record<string, unknown>): Settings {
    const useRendererLegacyStorage = source === undefined
    try {
        const legacyAssistantDefaults = useRendererLegacyStorage
            ? loadLegacyAssistantComposerDefaults(
                LEGACY_ASSISTANT_COMPOSER_PREFERENCES_STORAGE_KEY,
                DEFAULT_SETTINGS
            )
            : {}
        const parsedValue: unknown = useRendererLegacyStorage
            ? (() => {
                const stored = localStorage.getItem(STORAGE_KEY)
                return stored ? JSON.parse(stored) : null
            })()
            : source
        if (parsedValue) {
            const parsed = parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
                ? parsedValue as Record<string, unknown>
                : {}
            const candidate = { ...DEFAULT_SETTINGS, ...legacyAssistantDefaults, ...parsed } as Record<string, any>
            const legacyCodexModel = typeof candidate.codexModel === 'string' ? candidate.codexModel.trim() : ''
            const storedTheme = isThemeId(candidate.theme) ? candidate.theme : DEFAULT_SETTINGS.theme
            const appearanceCustomTheme = sanitizeAppearanceCustomTheme(parsed.appearanceCustomTheme)
            const requestedLightTheme = parsed.appearanceLightTheme
                ?? (parsed.appearanceCustomThemeActive === true && appearanceCustomTheme && isLightThemeId(appearanceCustomTheme.baseTheme)
                    ? appearanceCustomTheme.baseTheme
                    : undefined)
            const appearanceLightTheme = isLightThemeId(requestedLightTheme)
                ? requestedLightTheme
                : isLightThemeId(storedTheme) ? storedTheme : DEFAULT_SETTINGS.appearanceLightTheme
            const requestedDarkTheme = parsed.appearanceDarkTheme
                ?? parsed.lastDarkTheme
                ?? (parsed.appearanceCustomThemeActive === true && appearanceCustomTheme && isDarkThemeId(appearanceCustomTheme.baseTheme)
                    ? appearanceCustomTheme.baseTheme
                    : undefined)
            const appearanceDarkTheme = isDarkThemeId(requestedDarkTheme)
                ? requestedDarkTheme
                : isDarkThemeId(storedTheme) ? storedTheme : DEFAULT_SETTINGS.appearanceDarkTheme
            const appearanceThemeMode: AppearanceThemeMode = parsed.appearanceThemeMode === 'system'
                || parsed.appearanceThemeMode === 'light'
                || parsed.appearanceThemeMode === 'dark'
                ? parsed.appearanceThemeMode
                : parsed.theme === undefined
                    ? DEFAULT_SETTINGS.appearanceThemeMode
                    : getThemeAppearance(storedTheme)
            const theme = resolveAppearanceTheme(appearanceThemeMode, appearanceLightTheme, appearanceDarkTheme)
            const appearanceResolvedMode = getThemeAppearance(theme)
            const appearanceCustomThemeActive = parsed.appearanceCustomThemeActive === true
                && appearanceThemeMode !== 'system'
                && appearanceCustomTheme?.baseTheme === theme
            const appearanceUiFont = appearanceCustomThemeActive && appearanceCustomTheme
                ? appearanceCustomTheme.uiFont
                : sanitizeAppearanceUiFont(candidate.appearanceUiFont)
            const appearanceCodeFont = appearanceCustomThemeActive && appearanceCustomTheme
                ? appearanceCustomTheme.codeFont
                : sanitizeAppearanceCodeFont(candidate.appearanceCodeFont)
            const storedAccent = sanitizeAccentColor(candidate.accentColor)
            const activeThemeAccent = getThemePresetAccent(theme)
            const inactiveTheme = appearanceResolvedMode === 'light' ? appearanceDarkTheme : appearanceLightTheme
            const inactiveThemeAccent = getThemePresetAccent(inactiveTheme)
            const staleSystemAccent = appearanceThemeMode === 'system'
                && !accentsEqual(activeThemeAccent, inactiveThemeAccent)
                && accentsEqual(storedAccent, inactiveThemeAccent)
            const accentColor = appearanceCustomThemeActive && appearanceCustomTheme
                ? appearanceCustomTheme.accentColor
                : staleSystemAccent ? activeThemeAccent : storedAccent
            const gitCommitCodexModel = typeof candidate.gitCommitCodexModel === 'string'
                ? candidate.gitCommitCodexModel.trim()
                : legacyCodexModel
            const gitPullRequestCodexModel = typeof candidate.gitPullRequestCodexModel === 'string'
                ? candidate.gitPullRequestCodexModel.trim()
                : legacyCodexModel
            const legacyFileDiffRenderMode = useRendererLegacyStorage
                ? localStorage.getItem('devscope:project-details:diff-render-mode:v1')
                : null
            const legacyProductProfile = useRendererLegacyStorage
                ? localStorage.getItem('zyra-ui:active-profile:v2') || localStorage.getItem('zyra-ui:active-profile:v1')
                : null

            return {
                settingsSchemaVersion: 4,
                theme,
                appearanceThemeMode,
                appearanceLightTheme,
                appearanceDarkTheme,
                appearanceResolvedMode,
                appearanceCustomTheme,
                appearanceCustomThemeActive,
                appearanceUiFont,
                appearanceCodeFont,
                accentColor,
                compactMode: candidate.compactMode === true,
                sidebarCollapsed: candidate.sidebarCollapsed === true,
                sidebarHoverPreviewEnabled: candidate.sidebarHoverPreviewEnabled !== false,
                assistantAgentInboxSidebarEnabled: candidate.assistantAgentInboxSidebarEnabled === true,
                explorerTabEnabled: candidate.explorerTabEnabled === true,
                explorerHomePath: sanitizeString(candidate.explorerHomePath, 2_048),
                defaultShell: candidate.defaultShell === 'cmd' ? 'cmd' : 'powershell',
                startMinimized: candidate.startMinimized === true,
                startWithWindows: candidate.startWithWindows === true,
                browserViewMode: candidate.browserViewMode === 'finder' ? 'finder' : 'grid',
                browserContentLayout: candidate.browserContentLayout === 'explorer' ? 'explorer' : 'grouped',
                filePreviewOpenInFullscreen: !!candidate.filePreviewOpenInFullscreen,
                filePreviewFullscreenShowLeftPanel: candidate.filePreviewFullscreenShowLeftPanel !== false,
                filePreviewFullscreenShowRightPanel: !!candidate.filePreviewFullscreenShowRightPanel,
                filePreviewDefaultMode: candidate.filePreviewDefaultMode === 'edit' ? 'edit' : 'preview',
                filePreviewPythonRunMode: candidate.filePreviewPythonRunMode === 'output' ? 'output' : 'terminal',
                filePreviewExplorerNameLayout: candidate.filePreviewExplorerNameLayout === 'horizontal' ? 'horizontal' : 'wrap',
                fileEditorWordWrap: candidate.fileEditorWordWrap === 'off' ? 'off' : 'on',
                fileEditorMinimapEnabled: candidate.fileEditorMinimapEnabled !== false,
                fileEditorFontSize: Number.isFinite(Number(candidate.fileEditorFontSize))
                    ? Math.max(10, Math.min(24, Math.round(Number(candidate.fileEditorFontSize))))
                    : 13,
                fileCsvDistinctColorsEnabled: candidate.fileCsvDistinctColorsEnabled !== false,
                fileDiffRenderMode: parsed.fileDiffRenderMode === 'split' || (parsed.fileDiffRenderMode === undefined && legacyFileDiffRenderMode === 'split')
                    ? 'split'
                    : 'stacked',
                packageRuntimePreference:
                    candidate.packageRuntimePreference === 'npm'
                    || candidate.packageRuntimePreference === 'node'
                    || candidate.packageRuntimePreference === 'pnpm'
                    || candidate.packageRuntimePreference === 'yarn'
                    || candidate.packageRuntimePreference === 'bun'
                        ? candidate.packageRuntimePreference
                        : 'auto',
                filePreviewTerminalPanelHeight: Number.isFinite(Number(candidate.filePreviewTerminalPanelHeight))
                    ? Math.max(140, Math.min(720, Math.round(Number(candidate.filePreviewTerminalPanelHeight))))
                    : 220,
                terminalFontSize: Number.isFinite(Number(candidate.terminalFontSize))
                    ? Math.max(10, Math.min(24, Math.round(Number(candidate.terminalFontSize))))
                    : 12,
                terminalCursorBlink: candidate.terminalCursorBlink !== false,
                terminalScrollback: Number.isFinite(Number(candidate.terminalScrollback))
                    ? Math.max(1_000, Math.min(50_000, Math.round(Number(candidate.terminalScrollback))))
                    : 5_000,
                assistantBrowserRestoreTabs: candidate.assistantBrowserRestoreTabs !== false,
                assistantBrowserGoogleSuggestions: candidate.assistantBrowserGoogleSuggestions !== false,
                assistantBrowserAdBlockEnabled: candidate.assistantBrowserAdBlockEnabled === true,
                assistantBrowserAdBlockPromptDismissed: candidate.assistantBrowserAdBlockPromptDismissed === true,
                assistantBrowserNewTabBackgroundMode: candidate.assistantBrowserNewTabBackgroundMode === 'off' || candidate.assistantBrowserNewTabBackgroundMode === 'unsplash' ? candidate.assistantBrowserNewTabBackgroundMode : 'built-in',
                assistantBrowserNewTabBackgroundCategory: ['all', 'forest-paths', 'mountain-highs', 'ocean-moods', 'desert-dreams', 'water-in-motion', 'wildflower-party', 'animal-cameos', 'ice-aurora', 'earth-above'].includes(String(candidate.assistantBrowserNewTabBackgroundCategory)) ? candidate.assistantBrowserNewTabBackgroundCategory as AssistantBrowserBackgroundCategory : 'all',
                assistantBrowserNewTabBackgroundRotation: candidate.assistantBrowserNewTabBackgroundRotation === 'fixed' ? 'fixed' : 'every-tab',
                assistantBrowserNewTabBackgroundId: sanitizeString(candidate.assistantBrowserNewTabBackgroundId, 128),
                projectsFolder: sanitizeString(candidate.projectsFolder, 2_048),
                additionalFolders: sanitizeStringList(candidate.additionalFolders),
                gitAutoRefreshOnProjectOpen: candidate.gitAutoRefreshOnProjectOpen !== false,
                gitInitDefaultBranch: sanitizeString(candidate.gitInitDefaultBranch, 256) || 'main',
                gitInitCreateGitignore: candidate.gitInitCreateGitignore !== false,
                gitInitCreateInitialCommit: !!candidate.gitInitCreateInitialCommit,
                gitWarnOnAuthorMismatch: candidate.gitWarnOnAuthorMismatch !== false,
                gitBulkActionScope: candidate.gitBulkActionScope === 'project' ? 'project' : 'repo',
                gitPullRequestGlobalGuide: sanitizePullRequestGuideConfig(candidate.gitPullRequestGlobalGuide),
                gitPullRequestDefaultGuideSource:
                    candidate.gitPullRequestDefaultGuideSource === 'project'
                    || candidate.gitPullRequestDefaultGuideSource === 'repo-template'
                    || candidate.gitPullRequestDefaultGuideSource === 'none'
                        ? candidate.gitPullRequestDefaultGuideSource
                        : 'global',
                gitPullRequestDefaultTargetBranch: sanitizeString(candidate.gitPullRequestDefaultTargetBranch, 256)
                    || DEFAULT_SETTINGS.gitPullRequestDefaultTargetBranch,
                gitPullRequestDefaultDraft: candidate.gitPullRequestDefaultDraft !== false,
                gitPullRequestDefaultChangeSource: sanitizePullRequestChangeSource(
                    candidate.gitPullRequestDefaultChangeSource ?? candidate.gitPullRequestDefaultScope,
                    DEFAULT_SETTINGS.gitPullRequestDefaultChangeSource
                ),
                gitProjectPullRequestConfigs: Object.fromEntries(
                    Object.entries(
                        typeof candidate.gitProjectPullRequestConfigs === 'object' && candidate.gitProjectPullRequestConfigs !== null
                            ? candidate.gitProjectPullRequestConfigs as Record<string, unknown>
                            : {}
                    ).slice(0, 100).map(([projectPath, config]) => [
                        projectPath.trim().slice(0, 2_048),
                        sanitizeProjectPullRequestConfig(config, DEFAULT_SETTINGS)
                    ]).filter(([projectPath]) => Boolean(projectPath))
                ),
                gitAutoCreateBranchWhenTargetMatches: candidate.gitAutoCreateBranchWhenTargetMatches === true,
                groqApiKey: sanitizeString(candidate.groqApiKey, 4_096),
                geminiApiKey: sanitizeString(candidate.geminiApiKey, 4_096),
                groqApiKeyConfigured: candidate.groqApiKeyConfigured === true,
                geminiApiKeyConfigured: candidate.geminiApiKeyConfigured === true,
                gitCommitCodexModel: gitCommitCodexModel.slice(0, 256),
                gitPullRequestCodexModel: gitPullRequestCodexModel.slice(0, 256),
                commitAIProvider: candidate.commitAIProvider === 'gemini' || candidate.commitAIProvider === 'codex' ? candidate.commitAIProvider : DEFAULT_SETTINGS.commitAIProvider,
                assistantUsageDisplayMode: candidate.assistantUsageDisplayMode === 'used' ? 'used' : 'remaining',
                assistantTextStreamingMode: candidate.assistantTextStreamingMode === 'chunks' ? 'chunks' : 'stream',
                assistantToolOutputDefaultMode: parsed.assistantToolOutputDefaultMode === 'expanded'
                    || (
                        parsed.assistantToolOutputDefaultMode === undefined
                        && (parsed.settingsSchemaVersion === undefined || Number(parsed.settingsSchemaVersion) < 4)
                    )
                    ? 'expanded'
                    : 'minimized',
                assistantDefaultModel: sanitizeString(candidate.assistantDefaultModel, 256),
                assistantTitleModel: sanitizeString(candidate.assistantTitleModel, 256) || DEFAULT_ASSISTANT_TITLE_MODEL,
                assistantTitleAutoRegenerate: candidate.assistantTitleAutoRegenerate === true,
                assistantTitleAutoRegenerateTurns: normalizeAssistantAutoTitleTurnInterval(candidate.assistantTitleAutoRegenerateTurns),
                assistantDefaultPromptTemplate: sanitizeString(candidate.assistantDefaultPromptTemplate, 32_000, false),
                assistantProductProfile: parsed.assistantProductProfile === 'builder'
                    || (parsed.assistantProductProfile === undefined && legacyProductProfile === ['e', 'lson'].join(''))
                    || (parsed.assistantProductProfile === undefined && legacyProductProfile === 'builder')
                    ? 'builder'
                    : 'default',
                assistantDefaultRuntimeMode: sanitizeAssistantDefaultRuntimeMode(candidate.assistantDefaultRuntimeMode),
                assistantDefaultEffort: sanitizeAssistantDefaultEffort(candidate.assistantDefaultEffort),
                assistantDefaultFastMode: !!candidate.assistantDefaultFastMode,
                assistantReasoningSummary: normalizeAssistantReasoningSummaryMode(candidate.assistantReasoningSummary),
                assistantContextCompactionThresholdTokens: normalizeAssistantContextCompactionThresholdTokens(
                    candidate.assistantContextCompactionThresholdTokens
                ),
                assistantDefaultWebSearch: candidate.assistantDefaultWebSearch !== false,
                assistantDefaultWebFetch: candidate.assistantDefaultWebFetch !== false,
                assistantBusyMessageMode: candidate.assistantBusyMessageMode === 'force' ? 'force' : 'queue',
                assistantAutoReconnect: candidate.assistantAutoReconnect !== false,
                assistantHistoryPrefetch: Number(parsed.settingsSchemaVersion) >= 3
                    && candidate.assistantHistoryPrefetch === true,
                assistantShowStatusDetails: candidate.assistantShowStatusDetails !== false,
                assistantShowDiagnostics: candidate.assistantShowDiagnostics === true,
                accessibilityReduceMotion: candidate.accessibilityReduceMotion === true,
                projectIconOverrides: sanitizeStringRecord(candidate.projectIconOverrides),
                assistantTranscriptionEnabled: candidate.assistantTranscriptionEnabled === true,
                assistantTranscriptionEngine: candidate.assistantTranscriptionEngine === 'codex'
                    || candidate.assistantTranscriptionEngine === 'vosk'
                    ? 'codex'
                    : 'browser'
            }
        }
    } catch (e) {
        console.error('Failed to load settings:', e)
    }
    const defaults = {
        ...DEFAULT_SETTINGS,
        ...(useRendererLegacyStorage
            ? loadLegacyAssistantComposerDefaults(LEGACY_ASSISTANT_COMPOSER_PREFERENCES_STORAGE_KEY, DEFAULT_SETTINGS)
            : {})
    }
    const theme = resolveAppearanceTheme(
        defaults.appearanceThemeMode,
        defaults.appearanceLightTheme,
        defaults.appearanceDarkTheme
    )
    return {
        ...defaults,
        theme,
        appearanceResolvedMode: getThemeAppearance(theme)
    }
}

const LEGACY_SETTINGS_KEYS = [
    STORAGE_KEY,
    'devscope:project-details:diff-render-mode:v1',
    LEGACY_ASSISTANT_COMPOSER_PREFERENCES_STORAGE_KEY,
    'zyra-ui:active-profile:v2',
    'zyra-ui:active-profile:v1'
] as const

function clearMigratedLegacySettings(): void {
    try {
        for (const key of LEGACY_SETTINGS_KEYS) localStorage.removeItem(key)
    } catch {
        // Main now owns preferences; an unavailable renderer store needs no recovery action.
    }
}

interface SettingsContextType {
    settings: Settings
    preferencesHydrated: boolean
    preferencesError: string | null
    updateSettings: (partial: Partial<Settings>) => Promise<void>
    updateHostedAiSecrets: (partial: UpdateHostedAiSecretsInput) => Promise<void>
    clearCache: () => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
    const bootstrapRef = useRef<{
        surface: DevicePreferenceSurface
        legacy: Settings | null
        initial: Settings
    } | null>(null)
    if (!bootstrapRef.current) {
        const surface: DevicePreferenceSurface = isElectronRendererRuntime() ? 'desktop' : 'browser'
        const legacy = surface === 'desktop' ? loadSettings() : null
        bootstrapRef.current = {
            surface,
            legacy,
            initial: legacy || loadSettings({ settingsSchemaVersion: 4 })
        }
    }
    const bootstrap = bootstrapRef.current
    const [settings, setSettings] = useState<Settings>(bootstrap.initial)
    const [preferencesHydrated, setPreferencesHydrated] = useState(false)
    const [preferencesError, setPreferencesError] = useState<string | null>(null)
    const settingsRef = useRef(settings)
    const revisionRef = useRef(0)
    const writeQueueRef = useRef<Promise<void>>(Promise.resolve())

    const replaceSettings = useCallback((next: Settings | ((current: Settings) => Settings)) => {
        setSettings((current) => {
            const resolved = typeof next === 'function' ? next(current) : next
            settingsRef.current = resolved
            return resolved
        })
    }, [])

    const applyPreferenceSnapshot = useCallback((snapshot: DevicePreferencesSnapshot) => {
        revisionRef.current = snapshot.revision
        replaceSettings((current) => {
            const loaded = loadSettings({ settingsSchemaVersion: 4, ...snapshot.settings })
            const canonical = {
                ...loaded,
                // Startup is owned by Electron's OS integration; hosted keys are OS-encrypted.
                startMinimized: current.startMinimized,
                startWithWindows: current.startWithWindows,
                groqApiKey: '',
                geminiApiKey: '',
                groqApiKeyConfigured: current.groqApiKeyConfigured,
                geminiApiKeyConfigured: current.geminiApiKeyConfigured
            }
            return canonical
        })
    }, [replaceSettings])

    const refreshPreferences = useCallback(async () => {
        const result = await window.devscope.preferences.get({ surface: bootstrap.surface })
        if (!result.success) throw new Error(result.error || 'Could not load device preferences.')
        applyPreferenceSnapshot(result.snapshot)
        setPreferencesError(null)
    }, [applyPreferenceSnapshot, bootstrap.surface])

    useEffect(() => {
        let mounted = true
        const unsubscribe = window.devscope.preferences.onChanged(() => {
            if (!mounted) return
            void refreshPreferences().catch(() => undefined)
        })

        void (async () => {
            try {
                const preferenceResult = await window.devscope.preferences.get({
                    surface: bootstrap.surface,
                    ...(bootstrap.surface === 'desktop' && bootstrap.legacy
                        ? { legacySettings: bootstrap.legacy as unknown as Record<string, unknown> }
                        : {})
                })
                if (!preferenceResult.success) throw new Error(preferenceResult.error || 'Could not load device preferences.')
                if (mounted) {
                    applyPreferenceSnapshot(preferenceResult.snapshot)
                    setPreferencesError(null)
                }

                if (bootstrap.surface === 'desktop') {
                    const legacySecrets = {
                        groqApiKey: bootstrap.legacy?.groqApiKey || '',
                        geminiApiKey: bootstrap.legacy?.geminiApiKey || ''
                    }
                    const migrationResult = await window.devscope.secrets
                        .migrateLegacyHostedAiKeys(legacySecrets)
                        .catch(() => null)
                    const secretStatus = migrationResult?.success ? migrationResult.status : null
                    if (mounted && secretStatus) {
                        replaceSettings((current) => ({
                            ...current,
                            groqApiKey: '',
                            geminiApiKey: '',
                            groqApiKeyConfigured: secretStatus.groqConfigured,
                            geminiApiKeyConfigured: secretStatus.geminiConfigured
                        }))
                    }
                    if (migrationResult?.success && migrationResult.status.legacyMigrationComplete) {
                        clearMigratedLegacySettings()
                    }
                }
            } catch (error) {
                console.error('Failed to hydrate main-owned settings:', error)
                if (mounted) setPreferencesError(error instanceof Error ? error.message : 'Could not load device preferences.')
            } finally {
                if (mounted) setPreferencesHydrated(true)
            }
        })()

        return () => {
            mounted = false
            unsubscribe()
        }
    }, [applyPreferenceSnapshot, bootstrap.legacy, bootstrap.surface, refreshPreferences, replaceSettings])

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return
        const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
        const syncSystemTheme = () => {
            replaceSettings((current) => {
                if (current.appearanceThemeMode !== 'system') return current
                const appearanceResolvedMode: ThemeAppearance = colorScheme.matches ? 'dark' : 'light'
                const theme: Theme = appearanceResolvedMode === 'dark'
                    ? current.appearanceDarkTheme
                    : current.appearanceLightTheme
                const previousThemeAccent = getThemePresetAccent(current.theme)
                const nextThemeAccent = getThemePresetAccent(theme)
                const accentColor = accentsEqual(current.accentColor, previousThemeAccent)
                    ? nextThemeAccent
                    : current.accentColor
                if (
                    current.theme === theme
                    && current.appearanceResolvedMode === appearanceResolvedMode
                    && accentsEqual(current.accentColor, accentColor)
                ) return current
                return { ...current, theme, appearanceResolvedMode, accentColor, appearanceCustomThemeActive: false }
            })
        }
        syncSystemTheme()
        colorScheme.addEventListener('change', syncSystemTheme)
        return () => colorScheme.removeEventListener('change', syncSystemTheme)
    }, [replaceSettings])

    useEffect(() => {
        const customTokens = settings.appearanceCustomThemeActive
            && settings.appearanceCustomTheme?.baseTheme === settings.theme
            ? settings.appearanceCustomTheme.tokens
            : undefined
        applyTheme(settings.theme, settings.accentColor, customTokens)
    }, [settings.accentColor, settings.appearanceCustomTheme, settings.appearanceCustomThemeActive, settings.theme])

    useEffect(() => {
        const root = document.documentElement
        const uiFont = getAppearanceUiFontStack(settings.appearanceUiFont)
        const codeFont = getAppearanceCodeFontStack(settings.appearanceCodeFont)
        root.style.setProperty('--font-ui', uiFont)
        root.style.setProperty('--font-code', codeFont)
        root.style.setProperty('--font-mono', codeFont)
        void import('./appearance-font-runtime').then(({ ensureAppearanceFontLoaded }) => (
            Promise.all([
                ensureAppearanceFontLoaded(settings.appearanceUiFont),
                ensureAppearanceFontLoaded(settings.appearanceCodeFont)
            ])
        )).then(() => dispatchZyraThemeChanged())
            .catch((error) => console.warn('Failed to load a managed appearance font:', error))
    }, [settings.appearanceCodeFont, settings.appearanceUiFont])

    useEffect(() => {
        if (settings.compactMode) {
            document.body.classList.add('compact-mode')
        } else {
            document.body.classList.remove('compact-mode')
        }
    }, [settings.compactMode])

    useEffect(() => {
        document.body.classList.toggle('zyra-reduce-motion', settings.accessibilityReduceMotion)
        return () => document.body.classList.remove('zyra-reduce-motion')
    }, [settings.accessibilityReduceMotion])

    useEffect(() => {
        setCanonicalAssistantAutoReconnectPreference(settings.assistantAutoReconnect)
    }, [settings.assistantAutoReconnect])

    const updateHostedAiSecrets = useCallback(async (partial: UpdateHostedAiSecretsInput) => {
        const result = await window.devscope.secrets.updateHostedAiKeys(partial)
        if (!result.success) throw new Error(result.error || 'Could not save hosted AI credentials.')
        replaceSettings((current) => ({
            ...current,
            groqApiKey: '',
            geminiApiKey: '',
            groqApiKeyConfigured: result.status.groqConfigured,
            geminiApiKeyConfigured: result.status.geminiConfigured
        }))
    }, [replaceSettings])

    const updateSettings = useCallback((partial: Partial<Settings>) => {
        const capturePersistedAnalyticsChanges = () => {
            if (partial.appearanceThemeMode) {
                captureProductEvent({ event: 'zyra_v1_workspace_ui', properties: { action: 'theme_mode', theme_mode: partial.appearanceThemeMode } })
            }
            if (typeof partial.accessibilityReduceMotion === 'boolean') {
                captureProductEvent({ event: 'zyra_v1_workspace_ui', properties: { action: 'accessibility_toggle', enabled: partial.accessibilityReduceMotion } })
            }
            if (typeof partial.assistantAgentInboxSidebarEnabled === 'boolean') {
                captureProductEvent({ event: 'zyra_v1_workspace_ui', properties: { action: 'agent_inbox_disclosure', enabled: partial.assistantAgentInboxSidebarEnabled } })
            }
        }
        const rendererPartial: Partial<Settings> = { ...partial }
        if (Object.prototype.hasOwnProperty.call(partial, 'groqApiKey')) {
            rendererPartial.groqApiKey = ''
            rendererPartial.groqApiKeyConfigured = settingsRef.current.groqApiKeyConfigured
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'geminiApiKey')) {
            rendererPartial.geminiApiKey = ''
            rendererPartial.geminiApiKeyConfigured = settingsRef.current.geminiApiKeyConfigured
        }
        const next = loadSettings({
            ...settingsRef.current,
            ...rendererPartial,
            settingsSchemaVersion: 4
        } as unknown as Record<string, unknown>)
        replaceSettings(next)

        const preferencePatch: Record<string, unknown> = {}
        const secretPatch: { groqApiKey?: string; geminiApiKey?: string } = {}
        for (const [key, value] of Object.entries(partial)) {
            const ownership = getDevicePreferenceOwnership(key)
            if (ownership === 'shared' || ownership === 'surface') preferencePatch[key] = value
            if (bootstrap.surface === 'desktop' && ownership === 'secret') {
                if (key === 'groqApiKey') secretPatch.groqApiKey = String(value || '')
                if (key === 'geminiApiKey') secretPatch.geminiApiKey = String(value || '')
            }
        }

        if (Object.keys(secretPatch).length > 0) {
            void updateHostedAiSecrets(secretPatch)
                .catch((error) => console.error('Failed to save OS-owned credentials:', error))
        }

        if (Object.keys(preferencePatch).length === 0) return Promise.resolve()
        writeQueueRef.current = writeQueueRef.current.then(async () => {
            const save = () => window.devscope.preferences.update({
                surface: bootstrap.surface,
                expectedRevision: revisionRef.current,
                patch: preferencePatch
            })
            let result = await save()
            if (!result.success && (result as typeof result & { code?: string }).code === 'REVISION_CONFLICT') {
                await refreshPreferences()
                result = await save()
            }
            if (!result.success) throw new Error(result.error || 'Could not save device preferences.')
            applyPreferenceSnapshot(result.snapshot)
            capturePersistedAnalyticsChanges()
        }).catch((error) => {
            console.error('Failed to save main-owned settings:', error)
            setPreferencesError(error instanceof Error ? error.message : 'Could not save device preferences.')
            return refreshPreferences().catch(() => undefined)
        })
        return writeQueueRef.current
    }, [applyPreferenceSnapshot, bootstrap.surface, refreshPreferences, replaceSettings, updateHostedAiSecrets])

    const clearCache = useCallback(() => {
        clearProjectViewCaches()
        clearRecentProjects()
        clearSettingsRuntimeCaches()
        window.dispatchEvent(new CustomEvent('devscope:cache-cleared'))
    }, [])

    return (
        <SettingsContext.Provider value={{ settings, preferencesHydrated, preferencesError, updateSettings, updateHostedAiSecrets, clearCache }}>
            {children}
        </SettingsContext.Provider>
    )
}

export function useSettings() {
    const context = useContext(SettingsContext)
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider')
    }
    return context
}

function applyTheme(theme: Theme, accent: AccentColor, customTokens?: ThemeTokens) {
    const themeDefinition = getThemeDefinition(theme)
    const appearance = getThemeAppearance(theme)
    const tokens = resolveThemeTokens(customTokens || themeDefinition.tokens)
    const roots = [document.documentElement, document.body]
    for (const target of roots) {
        target.classList.remove(...THEME_CLASS_IDS)
        target.classList.toggle('dark', appearance === 'dark')
        target.classList.toggle('light', appearance === 'light')
        if (theme !== 'dark' && theme !== 'light') target.classList.add(theme)
    }
    document.body.classList.add('theme-adaptive')

    const root = document.documentElement
    root.style.colorScheme = appearance
    root.style.setProperty('--color-bg', tokens.bg)
    root.style.setProperty('--color-text', tokens.text)
    root.style.setProperty('--theme-background-rgb', toRgbChannels(tokens.bg))
    root.style.setProperty('--theme-foreground-rgb', toRgbChannels(tokens.text))
    root.style.setProperty('--color-text-dark', tokens.textDark)
    root.style.setProperty('--color-text-darker', tokens.textDarker)
    root.style.setProperty('--color-text-secondary', tokens.textSecondary)
    root.style.setProperty('--color-text-muted', tokens.textMuted)
    root.style.setProperty('--color-card', tokens.card)
    root.style.setProperty('--color-border', tokens.border)
    root.style.setProperty('--color-border-secondary', tokens.borderSecondary)
    root.style.setProperty('--color-primary', tokens.primary)
    root.style.setProperty('--color-primary-on', resolveAccentTokens(tokens.primary, tokens.secondary, tokens.bg).onPrimary)
    root.style.setProperty('--color-secondary', tokens.secondary)
    root.style.setProperty('--color-accent', tokens.accent)
    root.style.setProperty('--color-theme-accent', tokens.textSecondary)

    const resolvedAccent = resolveAccentTokens(accent.primary, accent.secondary, tokens.bg)
    root.style.setProperty('--accent-primary', resolvedAccent.primary)
    root.style.setProperty('--accent-secondary', resolvedAccent.secondary)
    root.style.setProperty('--accent-primary-rgb', toRgbChannels(resolvedAccent.primary))
    root.style.setProperty('--accent-secondary-rgb', toRgbChannels(resolvedAccent.secondary))
    root.style.setProperty('--accent-on-primary', resolvedAccent.onPrimary)
    root.style.setProperty('--accent-contrast', resolvedAccent.onPrimary)

    const status = resolveStatusTokens(tokens.bg, tokens.primary)
    root.style.setProperty('--status-danger', status.danger)
    root.style.setProperty('--status-warning', status.warning)
    root.style.setProperty('--status-success', status.success)
    root.style.setProperty('--status-info', status.info)
    root.style.setProperty('--status-danger-rgb', toRgbChannels(status.danger))
    root.style.setProperty('--status-warning-rgb', toRgbChannels(status.warning))
    root.style.setProperty('--status-success-rgb', toRgbChannels(status.success))
    root.style.setProperty('--status-info-rgb', toRgbChannels(status.info))
    root.style.setProperty('--status-danger-contrast', status.onDanger)
    dispatchZyraThemeChanged()
}
