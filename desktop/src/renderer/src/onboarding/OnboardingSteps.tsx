import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowRight, ChevronRight, FolderOpen, Info, Palette } from 'lucide-react'
import type {
    OnboardingAppearanceSelection,
    OnboardingAuthStatus,
    OnboardingProjectsSelection,
    OnboardingRecord
} from '@shared/onboarding/contracts'
import { useSettings, type Settings } from '@/lib/settings'
import { getThemeDefinition } from '@/lib/settings-theme-catalog'
import { SettingsSwitch } from '@/pages/settings/settings-layout'
import { OpenAiLogo } from '@/components/ui/OpenAiLogo'
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
            <h1 id="onboarding-welcome-title" aria-label="Welcome to Zyra" className="text-[28px] font-medium tracking-[-0.035em] text-sparkle-text">
                <span aria-hidden="true" className="onboarding-welcome-letters">{Array.from('Welcome to Zyra').map((letter, index) => <span key={index} style={{ '--letter-index': index } as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>)}</span>
            </h1>
            <button
                type="button"
                disabled={saving}
                onClick={onStart}
                className="onboarding-welcome-button mt-8 inline-flex h-11 min-w-[142px] items-center justify-center gap-2 rounded-full bg-[var(--accent-primary)] px-5 text-[13px] font-semibold text-[var(--accent-on-primary)] shadow-[0_10px_30px_color-mix(in_srgb,var(--accent-primary)_22%,transparent)] transition-[opacity,transform] hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
                Let’s get you set up<ArrowRight size={14} />
            </button>
            {error ? <p role="alert" className="mt-4 text-[11px] text-[var(--status-danger)]">{error}</p> : null}
        </section>
    )
}

export { ConnectOpenAiStep } from './ConnectOpenAiStep'

export { AppearanceStep } from './AppearanceStep'

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
        <div className="mx-auto w-full max-w-[440px]">
            <button
                type="button"
                disabled={choosing}
                onClick={() => void choose()}
                className="group grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-text)_13%,transparent)] bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] p-4 text-left backdrop-blur-md transition-[border-color,background-color] hover:border-[color-mix(in_srgb,var(--accent-primary)_42%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] disabled:opacity-55 disabled:hover:translate-y-0"
            >
                <span className="inline-flex size-6 items-center justify-center text-sparkle-text-secondary"><FolderOpen size={18} /></span>
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
    const items = [
        {
            id: 'account',
            label: 'Account',
            value: record.data.auth?.label?.replace(/ connected$/i, '') || (accountUsesApiKey ? 'OpenAI API' : 'ChatGPT'),
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
        <div className="mx-auto w-full max-w-[440px]">
            <dl className="onboarding-review-grid">
                {items.map((item, index) => (
                    <div key={item.id} className="onboarding-review-item" style={{ '--item-index': index } as CSSProperties}>
                        <span className="onboarding-review-icon">{item.icon}</span>
                        <dt className="row-span-2 text-[12px] font-medium text-sparkle-text">{item.label}</dt>
                        <dd className="truncate text-right text-[13px] font-medium text-sparkle-text" title={item.value}>{item.value}</dd>
                        <dd className={cn('onboarding-review-detail truncate text-right text-[11px] text-sparkle-text-muted', item.id === 'projects' && 'font-mono')} title={item.detail}>{item.detail}</dd>
                    </div>
                ))}
            </dl>

            <div className="onboarding-review-choice mt-4"><OnboardingAnalyticsChoice analyticsChoice={analyticsChoice} analyticsConfigured={analyticsConfigured} analyticsManagedByEnvironment={analyticsManagedByEnvironment} analyticsLoading={analyticsLoading} analyticsError={analyticsError} onAnalyticsChoice={onAnalyticsChoice} /></div>

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
