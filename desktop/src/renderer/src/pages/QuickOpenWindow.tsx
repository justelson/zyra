import { lazy, Suspense } from 'react'
import { HashRouter } from 'react-router-dom'
import { SettingsProvider } from '@/lib/settings'
import { OnboardingProvider } from '@/lib/onboarding'
import { OnboardingGate } from '@/onboarding/OnboardingGate'

const QuickOpen = lazy(() => import('./QuickOpen'))

export function QuickOpenLoading() {
    return <div className="flex h-screen items-center justify-center bg-sparkle-bg text-sm text-sparkle-text-secondary" role="status">Opening file...</div>
}

export default function QuickOpenWindow() {
    return (
        <SettingsProvider>
            <OnboardingProvider>
                <OnboardingGate loadingFallback={<QuickOpenLoading />}>
                    <HashRouter>
                        <Suspense fallback={<QuickOpenLoading />}>
                            <QuickOpen />
                        </Suspense>
                    </HashRouter>
                </OnboardingGate>
            </OnboardingProvider>
        </SettingsProvider>
    )
}
