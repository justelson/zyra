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
    SettingsSection,
    SettingsSwitch
} from './settings-layout'

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
                    <>
                        <SettingsRow
                            title="Share product analytics"
                            description="Send coarse feature outcomes, performance timings, and allowlisted diagnostic codes tied to a stable random installation ID that keeps pseudonymous events together across sessions and is not derived from your account or device identity. Unsent events expire from the local queue after 7 days. Zyra never includes prompts, responses, files, paths, URLs, account identity, terminal content, or raw errors."
                            status={analyticsStatus?.enabled ? 'Ready' : analyticsStatus?.requested ? 'Needs setup' : 'Off'}
                            statusTone={analyticsStatus?.enabled ? 'ready' : analyticsStatus?.requested ? 'warning' : 'muted'}
                            control={(
                                <SettingsSwitch
                                    checked={analyticsStatus?.requested === true}
                                    disabled={!analyticsStatus || !analyticsStatus.canChangeEnabled}
                                    onCheckedChange={(enabled) => void setAnalyticsEnabled(enabled)}
                                    label="Share product analytics"
                                />
                            )}
                        />
                        {analyticsStatus?.enabledSource === 'environment' ? <SettingsNotice tone="neutral">Your environment controls this setting.</SettingsNotice> : null}
                        {analyticsStatus?.requested && !analyticsStatus.enabled ? <SettingsNotice tone="warning">Analytics will stay off until this device has a valid PostHog project key and approved HTTPS host.</SettingsNotice> : null}
                        {analyticsError ? <SettingsNotice tone="error">{analyticsError}</SettingsNotice> : null}
                    </>
                ) : (
                    <SettingsNotice tone="neutral">Open Zyra Desktop on this computer to review product analytics.</SettingsNotice>
                )}
            </SettingsSection>

            <SettingsSection title="Local maintenance">
                <SettingsRow
                    title="Cached UI data"
                    description="Clear non-setting renderer caches. Canonical transcripts, retained workspaces, settings, and project files are preserved."
                    control={<SettingsButton onClick={clearCache}>Clear cache</SettingsButton>}
                />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
