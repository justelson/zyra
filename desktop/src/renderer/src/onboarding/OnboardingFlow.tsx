import { useEffect, useRef, useState } from 'react'
import { ONBOARDING_STEPS, getPreviousOnboardingStep, type OnboardingStep } from '@shared/onboarding/contracts'
import type { AnalyticsStatus } from '@shared/analytics/contracts'
import { getDesktopAnalyticsStatus, onDesktopAnalyticsStatusChange, setDesktopAnalyticsEnabled } from '@/lib/product-analytics'
import { useSettings } from '@/lib/settings'
import { useOnboarding } from '@/lib/onboarding'
import { getThemeDefinition } from '@/lib/settings-theme-catalog'
import { onboardingThemeStyle } from './onboarding-theme'
import { useThemeReveal, type ThemeRevealOrigin } from './useThemeReveal'
import { OnboardingShowcase } from './OnboardingShowcase'
import { OnboardingStage } from './OnboardingStage'
import { OnboardingFooter } from './OnboardingFooter'
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
    'connect-openai': 'Connect a provider',
    appearance: 'Choose your look',
    projects: 'Choose a projects folder',
    review: 'Review setup'
}

const STEP_DESCRIPTIONS: Record<OnboardingStep, string> = {
    welcome: '',
    'connect-openai': 'Choose how Zyra connects to its models.',
    appearance: 'Make this space feel like yours.',
    projects: 'Choose the folder where you keep your work.',
    review: 'Your essentials are ready. You can change them later in Settings.'
}

export function OnboardingFlow() {
    const { settings } = useSettings()
    const onboarding = useOnboarding()
    const record = onboarding.snapshot?.record
    if (!record) return null

    const [appearance, setAppearance] = useState(() => createAppearanceSelection(settings, record))
    const [projects, setProjects] = useState(() => createProjectsSelection(settings, record))
    const revealTheme = useThemeReveal(settings.accessibilityReduceMotion)
    const resolvedMode = appearance.appearanceThemeMode === 'system' ? settings.appearanceResolvedMode : appearance.appearanceThemeMode
    const selectedTheme = getThemeDefinition(resolvedMode === 'light' ? appearance.appearanceLightTheme : appearance.appearanceDarkTheme)
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

    const changeAppearance = (nextAppearance: typeof appearance, origin?: ThemeRevealOrigin) => {
        if (actionInFlight.current) return
        latestAppearance.current = nextAppearance
        revealTheme(() => setAppearance(nextAppearance), origin)
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
        ? 'Your essentials are ready. You can change them later in Settings.'
        : STEP_DESCRIPTIONS[record.currentStep]
    const continueLabel = record.currentStep === 'review'
        ? record.reviewActive ? 'Save setup' : 'Open Zyra'
        : 'Continue'
    const recovery = onboarding.snapshot?.recovery
    return (
        <div className="relative h-screen overflow-hidden bg-sparkle-bg text-sparkle-text" style={onboardingThemeStyle(selectedTheme)}>
            <OnboardingBackground theme={selectedTheme} />
            <OnboardingChrome reviewActive={record.reviewActive} onExitReview={record.reviewActive ? () => void exitReview() : undefined} />

            <main className="relative z-10 h-full pt-[34px]">
                <OnboardingStage step={record.currentStep} direction={transitionDirection.current} reducedMotion={settings.accessibilityReduceMotion} decoration={<OnboardingShowcase theme={selectedTheme} />}>
                    {record.currentStep === 'welcome' ? (
                        <WelcomeStep saving={saving} error={error} onStart={() => void continueStep()} />
                    ) : <>
                        {record.currentStep !== 'connect-openai' ? (
                            <header className="onboarding-step-heading text-center">
                                <h1 id="onboarding-step-title" className="text-[28px] font-medium tracking-[-0.035em] text-sparkle-text">{stepTitle}</h1>
                                <p className="mx-auto mt-3 max-w-[360px] text-[13px] leading-[1.7] text-sparkle-text-secondary">{stepDescription}</p>
                            </header>
                        ) : null}
                        {record.currentStep === 'connect-openai' ? (
                            <ConnectOpenAiStep status={auth.status} loading={auth.loading} activity={auth.activity} error={auth.error}
                                onRefresh={auth.refresh} onConnectChatGpt={() => runAuth('chatgpt', onboarding.connectChatGpt)}
                                onConnectApiKey={apiKey => runAuth('api-key', () => onboarding.connectApiKey(apiKey))} />
                        ) : null}
                        {record.currentStep === 'appearance' ? <AppearanceStep selection={appearance} onChange={changeAppearance} /> : null}
                        {record.currentStep === 'projects' ? <ProjectsStep selection={projects} onChange={setProjects} /> : null}
                        {record.currentStep === 'review' ? (
                            <ReviewStep record={record} analyticsChoice={analyticsChoice} analyticsConfigured={analyticsStatus?.configured === true}
                                analyticsManagedByEnvironment={analyticsStatus?.canChangeEnabled === false} analyticsLoading={analyticsLoading}
                                analyticsError={analyticsError} onAnalyticsChoice={enabled => { void setAnalyticsChoice(enabled) }} />
                        ) : null}
                    </>}
                    {recovery ? <p role="status" className="mx-auto mt-5 max-w-[440px] text-center text-[11px] leading-5 text-[var(--status-warning)]">Zyra recovered setup from a fresh checkpoint.</p> : null}
                </OnboardingStage>

                <OnboardingFooter
                    visible={record.currentStep !== 'welcome'} index={currentIndex} total={ONBOARDING_STEPS.length}
                    stepLabel={STEP_LABELS[record.currentStep]} continueLabel={continueLabel} finalStep={record.currentStep === 'review'}
                    backDisabled={saving} continueDisabled={saving || analyticsLoading || !canContinue || !projectReady}
                    reducedMotion={settings.accessibilityReduceMotion} direction={transitionDirection.current} error={error}
                    onBack={() => void goBack()} onContinue={() => void continueStep()}
                />
            </main>
        </div>
    )
}
