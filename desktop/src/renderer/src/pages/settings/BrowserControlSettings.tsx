import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useSettings } from '@/lib/settings'
import {
    clearPersistedAssistantBrowserWorkspaces,
    countPersistedAssistantBrowserWorkspaces
} from '../assistant/assistant-browser-workspace-state'
import {
    SettingsButton,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSwitch
} from './settings-layout'

export default function BrowserControlSettings() {
    const { settings, updateSettings } = useSettings()
    const [retainedWorkspaceCount, setRetainedWorkspaceCount] = useState(() => countPersistedAssistantBrowserWorkspaces())
    const [browserHistoryState, setBrowserHistoryState] = useState<'checking' | 'present' | 'empty' | 'unavailable'>('checking')
    const [adBlockBusy, setAdBlockBusy] = useState(false)
    const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
    const integratedBrowserAvailable = isElectronRendererRuntime()

    useEffect(() => {
        if (!integratedBrowserAvailable || typeof window.devscope.getBrowserHistory !== 'function') {
            setBrowserHistoryState('unavailable')
            return
        }
        let cancelled = false
        void window.devscope.getBrowserHistory({ limit: 1 }).then((result) => {
            if (!cancelled) setBrowserHistoryState(result.success ? result.entries.length > 0 ? 'present' : 'empty' : 'unavailable')
        }).catch(() => {
            if (!cancelled) setBrowserHistoryState('unavailable')
        })
        return () => { cancelled = true }
    }, [integratedBrowserAvailable])

    const runMaintenance = async (action: 'history' | 'cache' | 'cookies' | 'profile') => {
        if (action === 'history' && !window.confirm('Clear visited addresses and omnibox suggestions from Zyra Browser?')) return
        if (action === 'cookies' && !window.confirm('Sign out of every website in Zyra Browser? History and cached files will stay.')) return
        if (action === 'profile' && !window.confirm('Reset Zyra’s complete local Browser profile, including history, cache, cookies, and site data? This cannot be undone.')) return
        setStatus(null)
        try {
            const result = action === 'history'
                ? await window.devscope.clearBrowserHistory()
                : action === 'cache'
                    ? await window.devscope.clearBrowserPreviewCache()
                    : action === 'cookies'
                        ? await window.devscope.clearBrowserPreviewCookies()
                        : await window.devscope.clearBrowserPreviewData()
            if (!result.success) throw new Error(result.error || `Failed to clear Browser ${action}.`)
            if (action === 'history' || action === 'profile') setBrowserHistoryState('empty')
            setStatus({ tone: 'success', message: action === 'profile' ? 'Local Browser profile reset.' : action === 'cookies' ? 'Signed out of websites.' : `Browser ${action} cleared.` })
        } catch (error) {
            setStatus({ tone: 'error', message: error instanceof Error ? error.message : `Failed to clear Browser ${action}.` })
        }
    }

    const setAdBlocking = async (enabled: boolean) => {
        if (adBlockBusy) return
        setAdBlockBusy(true)
        setStatus(null)
        try {
            if (typeof window.devscope.setBrowserAdBlockEnabled !== 'function') throw new Error('Restart Zyra Desktop to load built-in ad blocking.')
            const result = await window.devscope.setBrowserAdBlockEnabled({ enabled, promptDismissed: true })
            if (!result.success) throw new Error(result.error || 'Could not update built-in ad blocking.')
            setStatus({ tone: 'success', message: enabled ? 'Built-in ad and tracker blocking enabled.' : 'Built-in ad and tracker blocking disabled.' })
        } catch (error) {
            setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not update built-in ad blocking.' })
        } finally {
            setAdBlockBusy(false)
        }
    }

    const clearRetainedWorkspaces = () => {
        if (retainedWorkspaceCount > 0 && !window.confirm(`Clear ${retainedWorkspaceCount} retained Browser workspace${retainedWorkspaceCount === 1 ? '' : 's'}? Open chats and project files are not affected.`)) return
        clearPersistedAssistantBrowserWorkspaces()
        setRetainedWorkspaceCount(0)
        setStatus({ tone: 'success', message: 'Retained Browser workspace layouts cleared.' })
    }

    return (
        <SettingsPageContainer title="Browser" backTo="/settings/workspace" backLabel="Workspace">
            {integratedBrowserAvailable ? <>
                <SettingsSection title="Browsing" searchSection="Browser workspace">
                    <SettingsRow title="Restore Browser tabs" description="Reopen saved tabs when you return to a chat workspace." control={<SettingsSwitch checked={settings.assistantBrowserRestoreTabs} onCheckedChange={(assistantBrowserRestoreTabs) => updateSettings({ assistantBrowserRestoreTabs })} label="Restore Browser tabs" />} />
                    <SettingsRow title="New Tab backgrounds" description="Choose a background source for new tabs." info="Built-in uses an attributed nature pack; configure your Unsplash key in the New Tab background picker." control={<SettingsSegmented value={settings.assistantBrowserNewTabBackgroundMode} options={[{ value: 'off', label: 'Off' }, { value: 'built-in', label: 'Built-in' }, { value: 'unsplash', label: 'Unsplash' }]} onChange={(assistantBrowserNewTabBackgroundMode) => updateSettings({ assistantBrowserNewTabBackgroundMode })} label="New Tab background source" />} />
                    <SettingsRow title="Background behavior" description="Change the image per tab or keep your selected image." control={<SettingsSegmented value={settings.assistantBrowserNewTabBackgroundRotation} options={[{ value: 'every-tab', label: 'Every tab' }, { value: 'fixed', label: 'Locked' }]} onChange={(assistantBrowserNewTabBackgroundRotation) => updateSettings({ assistantBrowserNewTabBackgroundRotation })} label="New Tab background behavior" disabled={settings.assistantBrowserNewTabBackgroundMode === 'off'} />} />
                </SettingsSection>
                <SettingsSection title="Browser privacy" searchSection="Browser workspace">
                    <SettingsRow title="Website sign-ins" description="Keep website sign-ins on this device across chats." info="Cookies and site storage persist across restarts; Zyra does not save passwords." status="Saved on this device" statusTone="ready" />
                    <SettingsRow title="Google search suggestions" description="Send search text to Google for live suggestions." info="Addresses, localhost targets, paths and credential-shaped text are excluded." control={<SettingsSwitch checked={settings.assistantBrowserGoogleSuggestions} onCheckedChange={(assistantBrowserGoogleSuggestions) => updateSettings({ assistantBrowserGoogleSuggestions })} label="Google search suggestions" />} />
                    <SettingsRow title="Built-in ad blocking" description="Block ads and trackers in the built-in Browser." info="Off by default; enabled blocking covers network, media, cosmetic, popup and tracking rules, excluding local development sites." status={settings.assistantBrowserAdBlockEnabled ? 'On' : 'Off'} statusTone={settings.assistantBrowserAdBlockEnabled ? 'ready' : 'muted'} control={<SettingsSwitch checked={settings.assistantBrowserAdBlockEnabled} disabled={adBlockBusy} onCheckedChange={(enabled) => void setAdBlocking(enabled)} label="Built-in ad blocking" />} />
                </SettingsSection>
                <SettingsSection title="Site data" searchSection="Browser workspace">
                    <SettingsRow title="Retained workspaces" description="Clear saved tab layouts without deleting chats or files." status={`${retainedWorkspaceCount} saved`} statusTone={retainedWorkspaceCount > 0 ? 'info' : 'muted'} control={<SettingsButton variant="ghost" onClick={clearRetainedWorkspaces} disabled={retainedWorkspaceCount === 0}><Trash2 size={12} />Clear layouts</SettingsButton>} />
                    <SettingsRow title="Browser history" description="Clear visited addresses while keeping website sign-ins." status={browserHistoryState === 'checking' ? 'Checking…' : browserHistoryState === 'present' ? 'Saved locally' : browserHistoryState === 'empty' ? 'Empty' : 'Unavailable'} statusTone={browserHistoryState === 'present' ? 'info' : 'muted'} control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('history')} disabled={browserHistoryState !== 'present'}>Clear history</SettingsButton>} />
                    <SettingsRow title="Temporary cache" description="Clear downloaded resources while keeping website sign-ins." control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('cache')}>Clear cache</SettingsButton>} />
                    <SettingsRow title="Sign out of websites" description="Clear cookies and sign out of all Browser websites." info="This requires confirmation and does not involve saved passwords because Zyra does not store them." control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('cookies')}>Sign out everywhere</SettingsButton>} />
                    <SettingsRow title="Reset Browser profile" description="Remove all local Browser history, cookies and site data." info="This also clears cached resources and site permissions after confirmation." control={<SettingsButton variant="danger" onClick={() => void runMaintenance('profile')}>Reset profile</SettingsButton>} />
                </SettingsSection>
                {status ? <SettingsNotice tone={status.tone}>{status.message}</SettingsNotice> : null}
            </> : <SettingsSection title="Browser workspace"><SettingsNotice>Open Zyra Desktop to manage its Browser and site data.</SettingsNotice></SettingsSection>}

        </SettingsPageContainer>
    )
}
