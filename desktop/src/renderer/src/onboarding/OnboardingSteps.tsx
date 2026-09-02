import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronRight, FolderOpen, Info, KeyRound, Palette, RefreshCw } from 'lucide-react'
import type {
    OnboardingAppearanceSelection,
    OnboardingAuthStatus,
    OnboardingProjectsSelection,
    OnboardingRecord
} from '@shared/onboarding/contracts'
import { useSettings, type Settings } from '@/lib/settings'
import { getThemeDefinition } from '@/lib/settings-theme-catalog'
import { AppearanceSystemThemeCard, AppearanceThemeCard } from '@/pages/settings/appearance/AppearancePreviews'
import { AppearanceThemeSelector } from '@/pages/settings/appearance/AppearanceThemeSelect'
import { SettingsInput, SettingsSwitch } from '@/pages/settings/settings-layout'
import { OpenAiLogo } from '@/components/ui/OpenAiLogo'
import { ZyraLogoASCII } from '@/components/ui/ZyraLogo'
import { cn } from '@/lib/utils'

type OnboardingAnalyticsChoiceProps = {
    analyticsChoice: boolean | null
    analyticsConfigured: boolean
    analyticsManagedByEnvironment: boolean
    analyticsLoading: boolean
    analyticsError: string | null
    onAnalyticsChoice: (enabled: boolean) => void
}

function OnboardingAnalyticsChoice({
    analyticsChoice,
    analyticsConfigured,
    analyticsManagedByEnvironment,
    analyticsLoading,
    analyticsError,
    onAnalyticsChoice
}: OnboardingAnalyticsChoiceProps) {
    const [detailsOpen, setDetailsOpen] = useState(false)
    const detail = analyticsError
        || (analyticsManagedByEnvironment
            ? 'This build manages the setting.'
            : analyticsLoading
                ? 'Saving…'
                : analyticsChoice === true && !analyticsConfigured
                    ? 'Enabled, but unavailable in this build.'
                    : 'Share coarse feature outcomes, performance timings, and allowlisted diagnostic codes. Events use a stable random installation ID to keep pseudonymous events together across sessions; it is not derived from your account or device identity. Unsent events expire from the local queue after 7 days. Never prompts, responses, transcripts, files, paths, URLs, account identity, or terminal content.')

    return (
        <div className="flex min-h-12 w-full items-center justify-between gap-5 px-1 py-2 text-left">
            <span className="flex min-w-0 items-center gap-1.5">
                <span id="onboarding-analytics-title" className="truncate text-[11px] font-semibold text-sparkle-text">Share product usage and diagnostics</span>
                <span className="group relative inline-flex shrink-0">
                    <button
                        type="button"
                        aria-label="About product usage and diagnostics"
                        aria-expanded={detailsOpen}
                        aria-describedby="onboarding-analytics-detail"
                        onClick={() => setDetailsOpen((open) => !open)}
                        onBlur={() => setDetailsOpen(false)}
                        className="inline-flex size-5 items-center justify-center rounded text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
                    >
                        <Info size={12} strokeWidth={1.8} />
                    </button>
                    <span
                        id="onboarding-analytics-detail"
                        role={analyticsError ? 'alert' : 'tooltip'}
                        className={cn(
                            'absolute bottom-full left-1/2 z-40 mb-2 w-72 -translate-x-1/2 rounded-md border border-[var(--surface-divider)] bg-[var(--settings-popover)] px-3 py-2 text-[10px] font-normal leading-4 text-sparkle-text-secondary shadow-xl transition-[opacity,transform] group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100',
                            detailsOpen ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
                        )}
                    >
                        {detail}
                    </span>
                </span>
            </span>
            <SettingsSwitch
                checked={analyticsChoice === true}
                disabled={analyticsLoading || analyticsManagedByEnvironment}
                onCheckedChange={onAnalyticsChoice}
                label="Share product usage and diagnostics"
            />
        </div>
    )
}

export function WelcomeStep({ saving, error, onStart }: {
    saving: boolean
    error: string | null
    onStart: () => void
}) {
    return (
        <section className="mx-auto flex w-full max-w-[520px] flex-col items-center text-center" aria-labelledby="onboarding-welcome-title">
            <h1 id="onboarding-welcome-title" className="text-[18px] font-medium tracking-[-0.025em] text-sparkle-text-secondary sm:text-[20px]">
                Welcome to
            </h1>
            <ZyraLogoASCII size="lg" variant="loading" className="mt-5 drop-shadow-[0_0_24px_color-mix(in_srgb,var(--accent-primary)_22%,transparent)]" />
            <button
                type="button"
                disabled={saving}
                onClick={onStart}
                className="mt-8 inline-flex h-11 min-w-[142px] items-center justify-center gap-2 rounded-md bg-[var(--accent-primary)] px-5 text-[13px] font-semibold text-[var(--accent-on-primary)] shadow-[0_10px_30px_color-mix(in_srgb,var(--accent-primary)_22%,transparent)] transition-[opacity,transform] hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
                Start setup<ArrowRight size={14} />
            </button>
            {error ? <p role="alert" className="mt-4 text-[11px] text-[var(--status-danger)]">{error}</p> : null}
        </section>
    )
}

export function ConnectOpenAiStep({
    status,
    loading,
    activity,
    error,
    onRefresh,
    onConnectChatGpt,
    onConnectApiKey
}: {
    status: OnboardingAuthStatus | null
    loading: boolean
    activity: 'checking' | 'chatgpt' | 'api-key' | null
    error: string | null
    onRefresh: () => Promise<void>
    onConnectChatGpt: () => Promise<void>
    onConnectApiKey: (apiKey: string) => Promise<void>
}) {
    const [apiKey, setApiKey] = useState('')
    const [showApiKey, setShowApiKey] = useState(false)
    const [apiKeyOpen, setApiKeyOpen] = useState(false)
    const connected = status?.verified === true
    const chatGptConnected = connected && status?.method === 'chatgpt'
    const apiKeyConnected = connected && status?.method === 'api-key'

    useEffect(() => {
        if (!apiKeyConnected) return
        setApiKey('')
        setShowApiKey(false)
    }, [apiKeyConnected])

    const statusCopy = activity === 'checking'
        ? 'Checking this device…'
        : activity === 'chatgpt'
            ? 'Finish signing in in your browser…'
            : activity === 'api-key'
                ? 'Verifying your API key…'
                : error || status?.detail || (connected ? status?.label : 'Choose a connection to continue.')

    return (
        <div className="mx-auto w-full max-w-[500px]">
            <button
                type="button"
                disabled={loading}
                onClick={() => void onConnectChatGpt()}
                className={cn(
                    'group grid w-full grid-cols-[42px_minmax(0,1fr)_20px] items-center gap-3 rounded-xl border bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] px-4 py-4 text-left shadow-[0_18px_50px_color-mix(in_srgb,var(--color-bg)_28%,transparent)] backdrop-blur-md transition-[border-color,background-color,transform] hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0',
                    chatGptConnected
                        ? 'border-[color-mix(in_srgb,var(--status-success)_52%,transparent)]'
                        : 'border-[color-mix(in_srgb,var(--accent-primary)_46%,transparent)]'
                )}
            >
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]"><OpenAiLogo className="size-[18px]" /></span>
                <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-sparkle-text">
                        {chatGptConnected ? 'ChatGPT connected' : 'Continue with ChatGPT'}
                        {chatGptConnected ? <Check size={13} className="text-[var(--status-success)]" /> : <span className="text-[10px] font-medium text-[var(--accent-primary)]">Recommended</span>}
                    </span>
                    <span className="mt-1 block text-[11px] text-sparkle-text-muted">Opens a secure sign-in page in your browser</span>
                </span>
                <ArrowRight size={14} className="text-sparkle-text-muted transition-transform group-hover:translate-x-0.5" />
            </button>

            <div className="mt-4 flex items-center gap-3 text-[10px] font-medium text-sparkle-text-muted" role="separator" aria-label="Alternative OpenAI connection">
                <span className="h-px flex-1 bg-[var(--surface-divider)]" />
                <span>or</span>
                <span className="h-px flex-1 bg-[var(--surface-divider)]" />
            </div>

            <div className="pt-1">
                <button
                    type="button"
                    disabled={loading}
                    onClick={() => setApiKeyOpen((value) => !value)}
                    aria-expanded={apiKeyOpen}
                    className="mx-auto flex h-10 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:cursor-not-allowed disabled:opacity-55"
                >
                    <KeyRound size={13} />
                    {apiKeyConnected ? 'API key connected' : 'Use an API key instead'}
                    {apiKeyConnected ? <Check size={12} className="text-[var(--status-success)]" /> : null}
                    <ChevronRight size={13} className={cn('transition-transform', apiKeyOpen && 'rotate-90')} />
                </button>

                <div inert={!apiKeyOpen} aria-hidden={!apiKeyOpen} className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none', apiKeyOpen ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0')}>
                    <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-2 pb-1 pt-2 sm:flex-row">
                            <SettingsInput
                                type={showApiKey ? 'text' : 'password'}
                                value={apiKey}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="sk-…"
                                aria-label="OpenAI API key"
                                onChange={(event) => setApiKey(event.target.value)}
                                className="!h-10 !w-full sm:!w-auto sm:flex-1"
                            />
                            <button type="button" onClick={() => setShowApiKey((value) => !value)} className="h-10 rounded-md px-3 text-[11px] font-medium text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text">{showApiKey ? 'Hide' : 'Show'}</button>
                            <button type="button" disabled={loading || !apiKey.trim()} onClick={() => void onConnectApiKey(apiKey)} className="h-10 rounded-md bg-[var(--accent-primary)] px-4 text-[11px] font-semibold text-[var(--accent-on-primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">Verify key</button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-4 flex min-h-6 items-center justify-center gap-2 text-center text-[11px]">
                {loading ? <RefreshCw size={12} className="shrink-0 animate-spin motion-reduce:animate-none text-sparkle-text-muted" /> : connected ? <Check size={12} className="shrink-0 text-[var(--status-success)]" /> : null}
                <span className={error ? 'text-[var(--status-danger)]' : connected ? 'text-[var(--status-success)]' : 'text-sparkle-text-muted'}>{statusCopy}</span>
                {!loading && !connected ? <button type="button" onClick={() => void onRefresh()} className="ml-1 text-sparkle-text-secondary underline decoration-[color-mix(in_srgb,var(--color-text)_24%,transparent)] underline-offset-2 hover:text-sparkle-text">Check again</button> : null}
            </div>
        </div>
    )
}

export function AppearanceStep({ selection, onChange }: {
    selection: OnboardingAppearanceSelection
    onChange: (selection: OnboardingAppearanceSelection) => void
}) {
    const { settings } = useSettings()
    const lightTheme = getThemeDefinition(selection.appearanceLightTheme)
    const darkTheme = getThemeDefinition(selection.appearanceDarkTheme)
    const activeAppearance = selection.appearanceThemeMode === 'system'
        ? settings.appearanceResolvedMode
        : selection.appearanceThemeMode
    const selectMode = (appearanceThemeMode: OnboardingAppearanceSelection['appearanceThemeMode']) => onChange({ ...selection, appearanceThemeMode })

    return (
        <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Zyra appearance">
                <AppearanceSystemThemeCard darkTheme={darkTheme} lightTheme={lightTheme} selected={selection.appearanceThemeMode === 'system'} onSelect={() => selectMode('system')} />
                <AppearanceThemeCard theme={lightTheme} label="Light" selected={selection.appearanceThemeMode === 'light'} onSelect={() => selectMode('light')} />
                <AppearanceThemeCard theme={darkTheme} label="Dark" selected={selection.appearanceThemeMode === 'dark'} onSelect={() => selectMode('dark')} />
            </div>
            <AppearanceThemeSelector
                className="mt-5"
                appearance={activeAppearance}
                lightTheme={selection.appearanceLightTheme}
                darkTheme={selection.appearanceDarkTheme}
                onLightThemeChange={(appearanceLightTheme) => onChange({ ...selection, appearanceLightTheme })}
                onDarkThemeChange={(appearanceDarkTheme) => onChange({ ...selection, appearanceDarkTheme })}
            />
        </div>
    )
}

export function ProjectsStep({ selection, onChange }: {
    selection: OnboardingProjectsSelection
    onChange: (selection: OnboardingProjectsSelection) => void
}) {
    const [choosing, setChoosing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const choose = async () => {
        setChoosing(true)
        setError(null)
        try {
            const result = await window.devscope.selectFolder()
            if (!result.success) throw new Error(result.error || 'Could not open the folder chooser.')
            if (result.folderPath) onChange({ projectsFolder: result.folderPath })
        } catch (choiceError) {
            setError(choiceError instanceof Error ? choiceError.message : 'Could not choose a projects folder.')
        } finally {
            setChoosing(false)
        }
    }

    return (
        <div className="mx-auto w-full max-w-[540px]">
            <button
                type="button"
                disabled={choosing}
                onClick={() => void choose()}
                className="group grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-[color-mix(in_srgb,var(--color-text)_13%,transparent)] bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] p-4 text-left backdrop-blur-md transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--accent-primary)_42%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] disabled:opacity-55 disabled:hover:translate-y-0"
            >
                <span className="inline-flex size-11 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]"><FolderOpen size={18} /></span>
                <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-sparkle-text">{selection.projectsFolder ? 'Projects folder' : 'Choose a folder'}</span>
                    <span className={cn('mt-1 block truncate text-[11px]', selection.projectsFolder ? 'font-mono text-sparkle-text-secondary' : 'text-sparkle-text-muted')} title={selection.projectsFolder || undefined}>
                        {selection.projectsFolder || 'Pick the folder where you keep your work'}
                    </span>
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-sparkle-text-secondary">
                    {choosing ? 'Opening…' : selection.projectsFolder ? 'Change' : 'Choose'}
                    <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                </span>
            </button>
            {error ? <p className="mt-3 text-center text-[11px] text-[var(--status-danger)]">{error}</p> : null}
        </div>
    )
}

export function ReviewStep({
    record,
    analyticsChoice,
    analyticsConfigured,
    analyticsManagedByEnvironment,
    analyticsLoading,
    analyticsError,
    onAnalyticsChoice
}: {
    record: OnboardingRecord
    analyticsChoice: boolean | null
    analyticsConfigured: boolean
    analyticsManagedByEnvironment: boolean
    analyticsLoading: boolean
    analyticsError: string | null
    onAnalyticsChoice: (enabled: boolean) => void
}) {
    const appearance = record.data.appearance
    const lightThemeName = appearance
        ? getThemeDefinition(appearance.appearanceLightTheme).name
        : 'Zyra Light'
    const darkThemeName = appearance
        ? getThemeDefinition(appearance.appearanceDarkTheme).name
        : 'Dark'
    const appearanceMode = appearance?.appearanceThemeMode || 'system'
    const appearanceValue = appearanceMode === 'system'
        ? 'System'
        : appearanceMode === 'light' ? lightThemeName : darkThemeName
    const appearanceDetail = appearanceMode === 'system'
        ? `${lightThemeName} / ${darkThemeName}`
        : `${appearanceMode === 'light' ? 'Light' : 'Dark'} mode`
    const projectsFolder = record.data.projects?.projectsFolder || ''
    const projectFolderName = projectsFolder.split(/[\\/]/).filter(Boolean).at(-1) || 'Projects folder'
    const accountUsesApiKey = record.data.auth?.method === 'api-key'
    const readyTitle = record.reviewActive ? 'Your setup is in sync' : 'Your workspace is set'
    const readyDescription = record.reviewActive
        ? 'Save your choices and return to Zyra.'
        : 'Open Zyra and start your first chat.'
    const items = [
        {
            id: 'account',
            label: 'Account',
            value: accountUsesApiKey ? 'OpenAI API' : 'ChatGPT',
            detail: accountUsesApiKey ? 'API key verified' : 'Subscription connected',
            icon: <OpenAiLogo className="size-[15px]" />
        },
        {
            id: 'appearance',
            label: 'Appearance',
            value: appearanceValue,
            detail: appearanceDetail,
            icon: <Palette size={15} />
        },
        {
            id: 'projects',
            label: 'Projects',
            value: projectFolderName,
            detail: projectsFolder || 'Ready to choose later',
            icon: <FolderOpen size={15} />
        }
    ]

    return (
        <div className="mx-auto w-full max-w-[600px]">
            <div className="onboarding-review-ready">
                <span className="onboarding-review-ready-mark"><Check size={18} strokeWidth={2.5} /></span>
                <span className="min-w-0">
                    <span className="block text-[14px] font-semibold tracking-[-0.015em] text-sparkle-text">{readyTitle}</span>
                    <span className="mt-0.5 block text-[11px] text-sparkle-text-muted">{readyDescription}</span>
                </span>
            </div>

            <dl className="onboarding-review-grid">
                {items.map((item) => (
                    <div key={item.id} className="onboarding-review-item">
                        <span className="onboarding-review-icon">{item.icon}</span>
                        <dt className="mt-3 text-[10px] font-medium text-sparkle-text-muted">{item.label}</dt>
                        <dd className="mt-1 truncate text-[13px] font-semibold text-sparkle-text" title={item.value}>{item.value}</dd>
                        <dd className={cn('mt-1 truncate text-[10px] text-sparkle-text-muted', item.id === 'projects' && 'font-mono')} title={item.detail}>{item.detail}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-4"><OnboardingAnalyticsChoice analyticsChoice={analyticsChoice} analyticsConfigured={analyticsConfigured} analyticsManagedByEnvironment={analyticsManagedByEnvironment} analyticsLoading={analyticsLoading} analyticsError={analyticsError} onAnalyticsChoice={onAnalyticsChoice} /></div>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-sparkle-text-muted">
                <Check size={11} className="text-[var(--status-success)]" />
                You can change this later in Settings.
            </p>
        </div>
    )
}

export function createAppearanceSelection(settings: Settings, _record: OnboardingRecord): OnboardingAppearanceSelection {
    return {
        appearanceThemeMode: settings.appearanceThemeMode,
        appearanceLightTheme: settings.appearanceLightTheme,
        appearanceDarkTheme: settings.appearanceDarkTheme,
        appearanceUiFont: settings.appearanceUiFont,
        appearanceCodeFont: settings.appearanceCodeFont,
        accessibilityReduceMotion: settings.accessibilityReduceMotion
    }
}

export function createProjectsSelection(settings: Settings, record: OnboardingRecord): OnboardingProjectsSelection {
    return record.data.projects || { projectsFolder: settings.projectsFolder }
}

export function useOpenAiStatus(load: () => Promise<OnboardingAuthStatus>, stepActive: boolean) {
    const [status, setStatus] = useState<OnboardingAuthStatus | null>(null)
    const [loading, setLoading] = useState(false)
    const [activity, setActivity] = useState<'checking' | 'chatgpt' | 'api-key' | null>(null)
    const [error, setError] = useState<string | null>(null)

    const refresh = async () => {
        setLoading(true)
        setActivity('checking')
        setError(null)
        try {
            setStatus(await load())
        } catch (statusError) {
            setError(statusError instanceof Error ? statusError.message : 'Could not verify OpenAI.')
        } finally {
            setLoading(false)
            setActivity(null)
        }
    }

    useEffect(() => {
        if (stepActive) void refresh()
        // The caller is stable for the lifetime of this wizard.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepActive])

    return { status, setStatus, loading, setLoading, activity, setActivity, error, setError, refresh }
}
