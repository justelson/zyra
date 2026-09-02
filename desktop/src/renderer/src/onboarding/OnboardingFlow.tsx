import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ONBOARDING_STEPS, getPreviousOnboardingStep, type OnboardingStep } from '@shared/onboarding/contracts'
import type { AnalyticsStatus } from '@shared/analytics/contracts'
import { getDesktopAnalyticsStatus, onDesktopAnalyticsStatusChange, setDesktopAnalyticsEnabled } from '@/lib/product-analytics'
import { useSettings } from '@/lib/settings'
import { useOnboarding } from '@/lib/onboarding'
import { cn } from '@/lib/utils'
import { OnboardingBackground } from './OnboardingBackground'
import { OnboardingChrome } from './OnboardingChrome'
import './OnboardingFlow.css'
import {
    AppearanceStep,
    ConnectOpenAiStep,
    ProjectsStep,
    ReviewStep,
    WelcomeStep,
    createAppearanceSelection,
    createProjectsSelection,
    useOpenAiStatus
} from './OnboardingSteps'

type StepTransitionDirection = 'forward' | 'backward'

const STEP_LABELS: Record<OnboardingStep, string> = {
    welcome: 'Welcome',
    'connect-openai': 'Connect ChatGPT',
    appearance: 'Choose your look',
    projects: 'Choose your projects folder',
    review: 'Review setup'
}

const STEP_DESCRIPTIONS: Record<OnboardingStep, string> = {
    welcome: '',
    'connect-openai': 'Sign in with ChatGPT to start using Zyra.',
    appearance: 'Pick the appearance that feels right.',
    projects: 'Choose the folder where you keep your work.',
    review: 'Check the essentials before opening Zyra.'
}

export function OnboardingFlow() {
    const { settings } = useSettings()
    const onboarding = useOnboarding()
    const record = onboarding.snapshot?.record
    if (!record) return null

    const [appearance, setAppearance] = useState(() => createAppearanceSelection(settings, record))
    const [projects, setProjects] = useState(() => createProjectsSelection(settings, record))
    const latestAppearance = useRef(appearance)
    const appearanceRevision = useRef(record.revision)
    const appearanceSavesPending = useRef(0)
    const appearanceSaveQueue = useRef<Promise<void>>(Promise.resolve())
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [analyticsStatus, setAnalyticsStatus] = useState<AnalyticsStatus | null>(null)
    const [analyticsLoading, setAnalyticsLoading] = useState(false)
    const [analyticsError, setAnalyticsError] = useState<string | null>(null)
    const transitionDirection = useRef<StepTransitionDirection>('forward')
    const actionInFlight = useRef(false)
    const stepScrollRef = useRef<HTMLDivElement | null>(null)
    const auth = useOpenAiStatus(onboarding.getAuthStatus, record.currentStep === 'connect-openai')

    useEffect(() => {
        if (appearanceSavesPending.current === 0) appearanceRevision.current = record.revision
        if (record.data.projects) setProjects(record.data.projects)
    }, [record.data.projects, record.revision])

    useEffect(() => {
        if (record.currentStep !== 'appearance' || appearanceSavesPending.current > 0) return
        const canonicalAppearance = createAppearanceSelection(settings, record)
        latestAppearance.current = canonicalAppearance
        setAppearance(canonicalAppearance)
    }, [
        record.currentStep,
        settings.accessibilityReduceMotion,
        settings.appearanceCodeFont,
        settings.appearanceDarkTheme,
        settings.appearanceLightTheme,
        settings.appearanceThemeMode,
        settings.appearanceUiFont
    ])

    useEffect(() => {
        if (stepScrollRef.current) stepScrollRef.current.scrollTop = 0
    }, [record.currentStep])

    useEffect(() => {
        let cancelled = false
        const refresh = () => {
            setAnalyticsLoading(true)
            setAnalyticsError(null)
            void getDesktopAnalyticsStatus().then((status) => {
                if (cancelled) return
                if (!status) throw new Error('Product analytics is unavailable in this Desktop session.')
                setAnalyticsStatus(status)
            }).catch((statusError) => {
                if (!cancelled) setAnalyticsError(statusError instanceof Error ? statusError.message : 'Could not load the analytics preference.')
            }).finally(() => {
                if (!cancelled) setAnalyticsLoading(false)
            })
        }
        const handleVisibility = () => { if (document.visibilityState === 'visible') refresh() }
        const unsubscribe = onDesktopAnalyticsStatusChange((status) => {
            if (!cancelled) {
                setAnalyticsStatus(status)
                setAnalyticsError(null)
            }
        })
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', handleVisibility)
        refresh()
        return () => {
            cancelled = true
            unsubscribe()
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [record.startedAt])

    const setAnalyticsChoice = async (enabled: boolean): Promise<boolean> => {
        if (analyticsLoading) return false
        if (analyticsStatus?.canChangeEnabled === false) return true
        setAnalyticsLoading(true)
        setAnalyticsError(null)
        try {
            const status = await setDesktopAnalyticsEnabled(enabled)
            if (!status || !status.preferenceSet) throw new Error('Zyra could not save the analytics preference.')
            setAnalyticsStatus(status)
            return true
        } catch (choiceError) {
            setAnalyticsError(choiceError instanceof Error ? choiceError.message : 'Could not save the analytics preference.')
            return false
        } finally {
            setAnalyticsLoading(false)
        }
    }

    const runAuth = async (
        activity: 'chatgpt' | 'api-key',
        work: () => ReturnType<typeof onboarding.connectChatGpt>
    ) => {
        auth.setLoading(true)
        auth.setActivity(activity)
        auth.setError(null)
        try {
            auth.setStatus(await work())
        } catch (authError) {
            auth.setError(authError instanceof Error ? authError.message : 'Could not connect OpenAI.')
        } finally {
            auth.setLoading(false)
            auth.setActivity(null)
        }
    }

    const runStepTransition = async (direction: StepTransitionDirection, work: () => Promise<void>) => {
        transitionDirection.current = direction
        await work()
    }

    const runAction = async (work: () => Promise<void>, fallbackError: string) => {
        if (actionInFlight.current) return
        actionInFlight.current = true
        setError(null)
        const busyTimer = window.setTimeout(() => setSaving(true), 500)
        try {
            await work()
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : fallbackError)
        } finally {
            window.clearTimeout(busyTimer)
            setSaving(false)
            actionInFlight.current = false
        }
    }

    const changeAppearance = (nextAppearance: typeof appearance) => {
        if (actionInFlight.current) return
        latestAppearance.current = nextAppearance
        setAppearance(nextAppearance)
        setError(null)
        appearanceSavesPending.current += 1
        const save = appearanceSaveQueue.current
            .catch(() => undefined)
            .then(async () => {
                const snapshot = await onboarding.updateAppearance({
                    expectedRevision: appearanceRevision.current,
                    selection: nextAppearance
                })
                if (!snapshot.record) throw new Error('Zyra did not return the saved appearance.')
                appearanceRevision.current = snapshot.record.revision
            })
            .finally(() => {
                appearanceSavesPending.current = Math.max(0, appearanceSavesPending.current - 1)
            })
        appearanceSaveQueue.current = save
        void save.catch((saveError) => {
            setError(saveError instanceof Error ? saveError.message : 'Could not save this appearance.')
            void onboarding.refresh().catch(() => undefined)
        })
    }

    const revisionAfterAppearanceSaves = async () => {
        if (record.currentStep !== 'appearance') return record.revision
        await appearanceSaveQueue.current
        return appearanceRevision.current
    }

    const continueStep = () => runAction(
        () => runStepTransition('forward', async () => {
            const expectedRevision = await revisionAfterAppearanceSaves()
            switch (record.currentStep) {
                case 'welcome':
                    await onboarding.commitStep({ expectedRevision, step: 'welcome' })
                    break
                case 'connect-openai':
                    await onboarding.commitStep({ expectedRevision, step: 'connect-openai' })
                    break
                case 'appearance':
                    await onboarding.commitStep({ expectedRevision, step: 'appearance', selection: latestAppearance.current })
                    break
                case 'projects':
                    await onboarding.commitStep({ expectedRevision, step: 'projects', selection: projects })
                    break
                case 'review':
                    if (analyticsChoice === null) {
                        const analyticsPreferenceSaved = await setAnalyticsChoice(false)
                        if (!analyticsPreferenceSaved) throw new Error('Save the diagnostics preference before finishing setup.')
                    }
                    await onboarding.commitStep({ expectedRevision, step: 'review' })
                    break
            }
        }),
        'Could not save setup.'
    )

    const goBack = async () => {
        const previous = getPreviousOnboardingStep(record.currentStep)
        if (!previous) return
        await runAction(
            () => runStepTransition('backward', async () => {
                const expectedRevision = await revisionAfterAppearanceSaves()
                await onboarding.navigate({ expectedRevision, step: previous })
            }),
            'Could not go back.'
        )
    }

    const exitReview = () => runAction(
        async () => {
            const expectedRevision = await revisionAfterAppearanceSaves()
            await onboarding.cancelReview({ expectedRevision })
        },
        'Could not exit setup review.'
    )

    const analyticsChoice = analyticsStatus?.preferenceSet ? analyticsStatus.requested : null
    const canContinue = record.currentStep !== 'connect-openai' || auth.status?.verified === true
    const projectReady = record.currentStep !== 'projects' || Boolean(projects.projectsFolder.trim())
    const currentIndex = ONBOARDING_STEPS.indexOf(record.currentStep)
    const stepTitle = record.currentStep === 'review' && !record.reviewActive
        ? 'Ready to open Zyra'
        : STEP_LABELS[record.currentStep]
    const stepDescription = record.currentStep === 'review' && !record.reviewActive
        ? 'Everything is ready.'
        : STEP_DESCRIPTIONS[record.currentStep]
    const continueLabel = record.currentStep === 'review'
        ? record.reviewActive ? 'Save setup' : 'Open Zyra'
        : 'Continue'
    const recovery = onboarding.snapshot?.recovery
    const stepMotionClass = transitionDirection.current === 'backward'
        ? 'onboarding-step-enter-backward'
        : 'onboarding-step-enter-forward'

    return (
        <div className="relative h-screen overflow-hidden bg-sparkle-bg text-sparkle-text">
            <OnboardingBackground />
            <OnboardingChrome reviewActive={record.reviewActive} onExitReview={record.reviewActive ? () => void exitReview() : undefined} />

            <main className="relative z-10 h-full pt-[34px]">
                {record.currentStep === 'welcome' ? (
                    <div className="flex h-full min-h-0 overflow-y-auto px-6 pb-[12vh] pt-[4vh]">
                        <div key="welcome" className={cn('onboarding-step-transition-surface m-auto w-full', stepMotionClass)}>
                            {recovery ? (
                                <p role="status" className="mx-auto mb-8 max-w-[520px] text-center text-[11px] leading-5 text-[var(--status-warning)]">
                                    Your previous setup checkpoint could not be read, so Zyra started a fresh review.
                                </p>
                            ) : null}
                            <WelcomeStep
                                saving={saving}
                                error={error}
                                onStart={() => void continueStep()}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="relative h-full min-h-0">
                        <div className="onboarding-fixed-heading">
                            <header key={`heading-${record.currentStep}`} className={cn('onboarding-step-transition-surface text-center', stepMotionClass)}>
                                <h1 id="onboarding-step-title" className="text-[27px] font-medium tracking-[-0.04em] text-sparkle-text sm:text-[30px]">{stepTitle}</h1>
                                <p className="mt-2 text-[13px] leading-5 text-sparkle-text-secondary">{stepDescription}</p>
                            </header>
                        </div>

                        <div ref={stepScrollRef} className="onboarding-fixed-step-scroll px-6 sm:px-10">
                            <section key={record.currentStep} aria-labelledby="onboarding-step-title" className={cn('onboarding-step-content onboarding-step-transition-surface mx-auto w-full max-w-[640px]', stepMotionClass)}>
                                {recovery ? (
                                    <p role="status" className="mb-7 text-center text-[11px] leading-5 text-[var(--status-warning)]">
                                        Zyra recovered setup from a fresh checkpoint.
                                    </p>
                                ) : null}

                                <div>
                                    {record.currentStep === 'connect-openai' ? (
                                        <ConnectOpenAiStep
                                            status={auth.status}
                                            loading={auth.loading}
                                            activity={auth.activity}
                                            error={auth.error}
                                            onRefresh={auth.refresh}
                                            onConnectChatGpt={() => runAuth('chatgpt', onboarding.connectChatGpt)}
                                            onConnectApiKey={(apiKey) => runAuth('api-key', () => onboarding.connectApiKey(apiKey))}
                                        />
                                    ) : null}
                                    {record.currentStep === 'appearance' ? <AppearanceStep selection={appearance} onChange={changeAppearance} /> : null}
                                    {record.currentStep === 'projects' ? <ProjectsStep selection={projects} onChange={setProjects} /> : null}
                                    {record.currentStep === 'review' ? (
                                        <ReviewStep
                                            record={record}
                                            analyticsChoice={analyticsChoice}
                                            analyticsConfigured={analyticsStatus?.configured === true}
                                            analyticsManagedByEnvironment={analyticsStatus?.canChangeEnabled === false}
                                            analyticsLoading={analyticsLoading}
                                            analyticsError={analyticsError}
                                            onAnalyticsChoice={(enabled) => { void setAnalyticsChoice(enabled) }}
                                        />
                                    ) : null}
                                </div>
                            </section>
                        </div>

                        <footer className="onboarding-action-dock">
                            {error ? <p role="alert" className="onboarding-action-error">{error}</p> : null}
                            <div className="onboarding-action-row">
                                <button type="button" disabled={saving} onClick={() => void goBack()} className="inline-flex h-11 w-[120px] items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:opacity-45">
                                    <ArrowLeft size={13} />Back
                                </button>

                                <div className="onboarding-dock-progress" aria-label={`Setup step ${currentIndex + 1} of ${ONBOARDING_STEPS.length}: ${STEP_LABELS[record.currentStep]}`}>
                                    <div className="mb-2 text-center text-[10px] font-medium text-sparkle-text-muted">
                                        {currentIndex + 1} of {ONBOARDING_STEPS.length}
                                    </div>
                                    <div className="h-px overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_14%,transparent)]">
                                        <div className="h-full bg-[var(--accent-primary)] transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${((currentIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
                                    </div>
                                </div>

                                <button type="button" disabled={saving || analyticsLoading || !canContinue || !projectReady} onClick={() => void continueStep()} className="inline-flex h-11 w-[120px] items-center justify-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-4 text-[12px] font-semibold text-[var(--accent-on-primary)] shadow-[0_8px_24px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)] transition-[opacity,transform] hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
                                    {continueLabel}{record.currentStep !== 'review' ? <ArrowRight size={13} /> : null}
                                </button>
                            </div>
                        </footer>
                    </div>
                )}
            </main>
        </div>
    )
}
