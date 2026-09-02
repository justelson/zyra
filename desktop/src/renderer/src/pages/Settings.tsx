import { useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings'
import { useOnboarding } from '@/lib/onboarding'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import {
    SettingsButton,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSwitch
} from './settings/settings-layout'

let cachedStartupSettings: { openAtLogin: boolean; openAsHidden: boolean } | null = null
let cachedStartupSettingsAt = 0
let startupSettingsGeneration = 0

registerSettingsCacheClearer('settings-startup', () => {
    startupSettingsGeneration += 1
    cachedStartupSettings = null
    cachedStartupSettingsAt = 0
})

export default function GeneralSettings() {
    const { settings, updateSettings } = useSettings()
    const onboarding = useOnboarding()
    const desktopHost = isElectronRendererRuntime()
    const [startupStatus, setStartupStatus] = useState<string | null>(null)
    const [setupReviewError, setSetupReviewError] = useState<string | null>(null)

    useEffect(() => {
        if (!desktopHost) return
        const applyStartupSettings = (startup: { openAtLogin?: boolean; openAsHidden?: boolean }) => {
            const startWithWindows = startup.openAtLogin === true
            const startMinimized = startup.openAsHidden === true
            if (settings.startWithWindows === startWithWindows && settings.startMinimized === startMinimized) return
            updateSettings({ startWithWindows, startMinimized })
        }
        if (cachedStartupSettings && Date.now() - cachedStartupSettingsAt < 2 * 60_000) {
            applyStartupSettings(cachedStartupSettings)
            return
        }
        let mounted = true
        const generation = startupSettingsGeneration
        void window.devscope.getStartupSettings().then((result) => {
            if (!mounted || !result.success) return
            const payload = result as typeof result & {
                settings?: { openAtLogin?: boolean; openAsHidden?: boolean }
                openAtLogin?: boolean
                openAsHidden?: boolean
            }
            const startup = payload.settings ?? payload
            const nextStartupSettings = {
                openAtLogin: startup.openAtLogin === true,
                openAsHidden: startup.openAsHidden === true
            }
            if (generation === startupSettingsGeneration) {
                cachedStartupSettings = nextStartupSettings
                cachedStartupSettingsAt = Date.now()
            }
            applyStartupSettings(nextStartupSettings)
        }).catch(() => {})
        return () => { mounted = false }
    }, [desktopHost, settings.startMinimized, settings.startWithWindows, updateSettings])

    const reviewSetup = async () => {
        const revision = onboarding.snapshot?.record?.revision
        if (revision === undefined) return
        setSetupReviewError(null)
        try {
            await onboarding.beginReview({ expectedRevision: revision })
        } catch (error) {
            setSetupReviewError(error instanceof Error ? error.message : 'Could not open setup review.')
        }
    }

    const setStartup = async (openAtLogin: boolean, openAsHidden: boolean) => {
        try {
            const result = await window.devscope.setStartupSettings({ openAtLogin, openAsHidden })
            if (!result.success) throw new Error(result.error || 'Startup update failed.')
            cachedStartupSettings = { openAtLogin, openAsHidden }
            cachedStartupSettingsAt = Date.now()
            updateSettings({ startWithWindows: openAtLogin, startMinimized: openAsHidden })
            setStartupStatus('Saved')
        } catch (error) {
            setStartupStatus(error instanceof Error ? error.message : 'Startup update failed.')
        }
        window.setTimeout(() => setStartupStatus(null), 3000)
    }

    return (
        <SettingsPageContainer title="General" backTo="/settings/app" backLabel="App">
            {desktopHost ? (
                <SettingsSection title="Desktop host">
                    <SettingsRow
                        title="Open at login"
                        description="Launch Zyra automatically when you sign in to this computer."
                        status={startupStatus === 'Saved' ? 'Saved' : startupStatus ? 'Not saved' : null}
                        statusTone={startupStatus === 'Saved' ? 'ready' : 'danger'}
                        statusTitle={startupStatus && startupStatus !== 'Saved' ? startupStatus : undefined}
                        control={<SettingsSwitch checked={settings.startWithWindows} onCheckedChange={(checked) => void setStartup(checked, checked ? settings.startMinimized : false)} label="Open Zyra at login" />}
                    />
                    <SettingsRow title="Start hidden" description="Start Zyra in the background. Open Zyra again whenever you want to show the window." control={<SettingsSwitch checked={settings.startWithWindows && settings.startMinimized} disabled={!settings.startWithWindows} onCheckedChange={(checked) => void setStartup(true, checked)} label="Start Zyra hidden" />} />
                </SettingsSection>
            ) : (
                <SettingsSection title="Desktop host">
                    <SettingsNotice tone="neutral">Open Zyra Desktop on this computer to change login and background-start behavior.</SettingsNotice>
                </SettingsSection>
            )}

            <SettingsSection title="Interface">
                <SettingsRow title="Chat rail" description="Keep the conversation sidebar collapsed across restarts on this surface." control={<SettingsSwitch checked={settings.sidebarCollapsed} onCheckedChange={(sidebarCollapsed) => updateSettings({ sidebarCollapsed })} label="Collapse chat rail" />} />
                <SettingsRow title="Sidebar hover preview" description="Temporarily show a minimized sidebar when the pointer reaches the left edge." control={<SettingsSwitch checked={settings.sidebarHoverPreviewEnabled} onCheckedChange={(sidebarHoverPreviewEnabled) => updateSettings({ sidebarHoverPreviewEnabled })} label="Preview minimized sidebar on hover" />} />
                <SettingsRow title="Agent Inbox sidebar" description="Use one flat chat list in creation order. Active work renders as rich cards; settled chats collapse to compact rows. Switch back any time." control={<SettingsSwitch checked={settings.assistantAgentInboxSidebarEnabled} onCheckedChange={(assistantAgentInboxSidebarEnabled) => updateSettings({ assistantAgentInboxSidebarEnabled })} label="Use Agent Inbox sidebar" />} />
            </SettingsSection>

            {desktopHost ? (
                <SettingsSection title="Setup">
                    <SettingsRow
                        title="Review device setup"
                        description="Revisit your OpenAI connection, appearance, and projects folder. Your completed status stays valid while you review."
                        status={onboarding.snapshot?.record?.completedAt ? 'Completed' : null}
                        statusTone="ready"
                        control={<SettingsButton onClick={() => void reviewSetup()}>Review setup</SettingsButton>}
                    />
                    {setupReviewError ? <SettingsNotice tone="error">{setupReviewError}</SettingsNotice> : null}
                </SettingsSection>
            ) : null}

        </SettingsPageContainer>
    )
}
