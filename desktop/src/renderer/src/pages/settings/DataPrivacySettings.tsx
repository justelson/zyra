import { useEffect, useState } from 'react'
import type { AnalyticsStatus } from '@shared/analytics/contracts'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { getDesktopAnalyticsStatus, onDesktopAnalyticsStatusChange, setDesktopAnalyticsEnabled } from '@/lib/product-analytics'
import { useSettings } from '@/lib/settings'
import {
    SettingsButton,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection
} from './settings-layout'
import { AnalyticsPrivacyRow } from './AnalyticsPrivacyRow'

export default function DataPrivacySettings() {
    const { clearCache } = useSettings()
    const desktopHost = isElectronRendererRuntime()
    const [analyticsStatus, setAnalyticsStatus] = useState<AnalyticsStatus | null>(null)
    const [analyticsError, setAnalyticsError] = useState<string | null>(null)

    useEffect(() => {
        if (!desktopHost) return
        let mounted = true
        const refresh = () => {
            void getDesktopAnalyticsStatus().then((status) => {
                if (mounted) setAnalyticsStatus(status)
            }).catch(() => undefined)
        }
        const handleVisibility = () => { if (document.visibilityState === 'visible') refresh() }
        const unsubscribe = onDesktopAnalyticsStatusChange((status) => {
            if (mounted) setAnalyticsStatus(status)
        })
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', handleVisibility)
        refresh()
        return () => {
            mounted = false
            unsubscribe()
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [desktopHost])

    const setAnalyticsEnabled = async (enabled: boolean) => {
        setAnalyticsError(null)
        try {
            const status = await setDesktopAnalyticsEnabled(enabled)
            if (!status) throw new Error('Analytics settings are unavailable.')
            setAnalyticsStatus(status)
        } catch (error) {
            setAnalyticsError(error instanceof Error ? error.message : 'Could not update analytics.')
        }
    }

    return (
        <SettingsPageContainer title="Privacy & maintenance" backTo="/settings/data" backLabel="Data & privacy">
            <SettingsSection title="Privacy">
                {desktopHost ? (
                    <AnalyticsPrivacyRow
                        status={analyticsStatus}
                        error={analyticsError}
                        onEnabledChange={(enabled) => void setAnalyticsEnabled(enabled)}
                    />
                ) : (
                    <SettingsNotice tone="neutral">Open Zyra Desktop on this computer to review product analytics.</SettingsNotice>
                )}
            </SettingsSection>

            <SettingsSection title="Local maintenance">
                <SettingsRow
                    title="Cached UI data"
                    description="Clear cached interface data without deleting your settings."
                    info="Chats, retained workspaces and project files are preserved."
                    control={<SettingsButton onClick={clearCache}>Clear cache</SettingsButton>}
                />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
