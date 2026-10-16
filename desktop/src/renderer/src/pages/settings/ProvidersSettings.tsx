import { lazy, Suspense } from 'react'
import { SettingsNotice, SettingsPageContainer } from './settings-layout'
import { SettingsPageTabs } from './SettingsPageTabs'

const ProviderConnections = lazy(() => import('./providers/ProviderConnections'))
const ProviderModelsPage = lazy(() => import('./providers/ProviderModelsPage'))
const ProviderLimits = lazy(() => import('./AccountSettings'))
const ProviderUsage = lazy(() => import('./UsageSettings'))

export default function ProvidersSettings({ view = 'connections' }: { view?: 'connections' | 'models' | 'limits' | 'usage' }) {
    if (view === 'usage') return <Suspense fallback={<SettingsNotice>Loading usage...</SettingsNotice>}><ProviderUsage /></Suspense>
    return <SettingsPageContainer title="Providers" description="Connect providers and choose the models Zyra uses." navigation={<SettingsPageTabs family="providers" />}>
        <Suspense fallback={<SettingsNotice>Opening provider settings…</SettingsNotice>}>
            {view === 'connections' ? <ProviderConnections /> : view === 'models' ? <ProviderModelsPage /> : view === 'limits' ? <ProviderLimits /> : <ProviderUsage />}
        </Suspense>
    </SettingsPageContainer>
}
