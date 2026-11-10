import type { DesktopLinkPreference } from '@shared/desktop-link-policy'
import type { BrowserExtensionRecord } from '@shared/browser-extensions'
import { useEffect, useState } from 'react'
import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useSettings } from '@/lib/settings'
import { useDesktopLinkPreference, setDesktopLinkPreference } from '@/lib/desktop-links'
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
    SettingsInput,
    SettingsSwitch
} from './settings-layout'
import { SettingsPageTabs, SettingsPageLink } from './SettingsPageTabs'

export default function BrowserControlSettings({ view = 'browsing' }: { view?: 'browsing' | 'privacy' | 'data' | 'extensions' }) {
    const { settings, updateSettings } = useSettings()
    const linkPreference = useDesktopLinkPreference()
    const [retainedWorkspaceCount, setRetainedWorkspaceCount] = useState(() => view === 'data' ? countPersistedAssistantBrowserWorkspaces() : 0)
    const [browserHistoryState, setBrowserHistoryState] = useState<'checking' | 'present' | 'empty' | 'unavailable'>('checking')
    const [adBlockBusy, setAdBlockBusy] = useState(false)
    const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string; view: typeof view } | null>(null)
    const [extensions, setExtensions] = useState<BrowserExtensionRecord[]>([])
    const [extensionsBusy, setExtensionsBusy] = useState(false)
    const [webStoreInput, setWebStoreInput] = useState('')
    const showStatus = (next: Omit<NonNullable<typeof status>, 'view'>) => setStatus({ ...next, view })
    const integratedBrowserAvailable = isElectronRendererRuntime()

    useEffect(() => {
        if (view !== 'extensions') return
        let cancelled = false
        void window.devscope.listBrowserExtensions().then(result => {
            if (!cancelled && result.success) setExtensions(result.extensions)
        })
        return () => { cancelled = true }
    }, [view])

    const refreshExtensions = async () => {
        const result = await window.devscope.listBrowserExtensions()
        if (result.success) setExtensions(result.extensions)
        else throw new Error(result.error || 'Could not read Browser extensions.')
    }

    const installExtension = async () => {
        setExtensionsBusy(true)
        try {
            const result = await window.devscope.installBrowserExtension()
            if (!result.success) throw new Error(result.error || 'Could not install the Browser extension.')
            await refreshExtensions()
            showStatus({ tone: 'success', message: `${result.extension.name} is ready in Zyra Browser.` })
        } catch (error) {
            if (error instanceof Error && error.message !== 'Extension installation cancelled.') showStatus({ tone: 'error', message: error.message })
        } finally { setExtensionsBusy(false) }
    }

    const installFromWebStore = async () => {
        if (!webStoreInput.trim()) return
        setExtensionsBusy(true)
        try {
            const review = await window.devscope.inspectBrowserExtensionFromWebStore(webStoreInput.trim())
            if (!review.success) throw new Error(review.error || 'Could not download the Chrome Web Store extension.')
            const permissions = [...review.extension.permissions, ...review.extension.hostPermissions]
            const approved = window.confirm(`Install ${review.extension.name} v${review.extension.version}?\n\n${permissions.length > 0 ? `Requested permissions:\n${permissions.join(', ')}` : 'This extension declares no permissions.'}\n\n${review.extension.warnings.length ? review.extension.warnings.join('\n') + '\n\n' : ''}Only approve extensions you trust. Some Chrome APIs may not work in Zyra.`)
            if (!approved) {
                await window.devscope.discardBrowserExtensionFromWebStore(review.extension.id)
                throw new Error('Extension was not kept.')
            }
            const result = await window.devscope.approveBrowserExtensionFromWebStore(review.extension.id)
            if (!result.success) throw new Error(result.error || 'Could not install the approved extension.')
            setWebStoreInput('')
            await refreshExtensions()
            showStatus({ tone: 'success', message: `${result.extension.name} is installed in Zyra Browser.` })
        } catch (error) { showStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not install the Chrome Web Store extension.' }) }
        finally { setExtensionsBusy(false) }
    }

    const setExtensionEnabled = async (id: string, enabled: boolean) => {
        setExtensionsBusy(true)
        try {
            const result = await window.devscope.setBrowserExtensionEnabled({ id, enabled })
            if (!result.success) throw new Error(result.error || 'Could not update the extension.')
            await refreshExtensions()
        } catch (error) { showStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not update the extension.' }) }
        finally { setExtensionsBusy(false) }
    }

    const removeExtension = async (id: string, name: string) => {
        if (!window.confirm(`Remove ${name} from Zyra Browser?`)) return
        setExtensionsBusy(true)
        try {
            const result = await window.devscope.removeBrowserExtension(id)
            if (!result.success) throw new Error(result.error || 'Could not remove the extension.')
            await refreshExtensions()
            showStatus({ tone: 'success', message: `${name} was removed.` })
        } catch (error) { showStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not remove the extension.' }) }
        finally { setExtensionsBusy(false) }
    }

    useEffect(() => {
        if (view !== 'data') return
        setRetainedWorkspaceCount(countPersistedAssistantBrowserWorkspaces())
        setBrowserHistoryState('checking')
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
    }, [integratedBrowserAvailable, view])

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
            showStatus({ tone: 'success', message: action === 'profile' ? 'Local Browser profile reset.' : action === 'cookies' ? 'Signed out of websites.' : `Browser ${action} cleared.` })
        } catch (error) {
            showStatus({ tone: 'error', message: error instanceof Error ? error.message : `Failed to clear Browser ${action}.` })
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
            showStatus({ tone: 'success', message: enabled ? 'Built-in ad and tracker blocking enabled.' : 'Built-in ad and tracker blocking disabled.' })
        } catch (error) {
            showStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not update built-in ad blocking.' })
        } finally {
            setAdBlockBusy(false)
        }
    }

    const clearRetainedWorkspaces = () => {
        if (retainedWorkspaceCount > 0 && !window.confirm(`Clear ${retainedWorkspaceCount} retained Browser workspace${retainedWorkspaceCount === 1 ? '' : 's'}? Open chats and project files are not affected.`)) return
        clearPersistedAssistantBrowserWorkspaces()
        setRetainedWorkspaceCount(0)
        showStatus({ tone: 'success', message: 'Retained Browser workspace layouts cleared.' })
    }

    return (
        <SettingsPageContainer
            title="Browser"
            description="Manage browsing preferences, privacy controls, and local site data."
            navigation={<SettingsPageTabs family="browser" />}
            backTo="/settings/workspace/browser"
            backLabel="Browser"
        >
            {integratedBrowserAvailable ? (
                <>
                    {view === 'extensions' ? (
                        <SettingsSection title="Extensions" searchSection="Browser extensions" headerAction={
                            <SettingsButton variant="accent" className="w-8 px-0" aria-label="Install unpacked extension" title="Install unpacked extension" onClick={() => void installExtension()} disabled={extensionsBusy}>
                                <FolderPlus size={15} aria-hidden="true" />
                            </SettingsButton>
                        }>
                            <SettingsNotice tone="warning">Review extension permissions. Some Chrome extensions need browser APIs Zyra does not support.</SettingsNotice>
                            <SettingsRow title="Chrome Web Store" description="Install an extension from its Chrome Web Store URL or ID." control={<div className="flex w-full gap-2 sm:w-auto"><SettingsInput value={webStoreInput} onChange={event => setWebStoreInput(event.target.value)} placeholder="Extension URL or ID" aria-label="Chrome Web Store extension URL or ID" /><SettingsButton variant="accent" disabled={extensionsBusy || !webStoreInput.trim()} onClick={() => void installFromWebStore()}>Install</SettingsButton></div>} />
                            {extensions.length === 0 ? <div className="px-4 py-6 text-xs text-[var(--settings-text-secondary)]">No extensions installed.</div> : extensions.map(extension => (
                                <SettingsRow key={extension.id} title={extension.name} description={extension.description || 'No description provided.'} status={`v${extension.version}`} statusTone="info" control={<div className="flex items-center gap-1"><SettingsSwitch checked={extension.enabled} disabled={extensionsBusy} onCheckedChange={enabled => void setExtensionEnabled(extension.id, enabled)} label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`} /><SettingsButton variant="ghost" aria-label={`Reload ${extension.name}`} title="Reload extension" disabled={extensionsBusy} onClick={() => void window.devscope.reloadBrowserExtension(extension.id).then(refreshExtensions).catch(error => showStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Could not reload the extension.' }))}><RefreshCw size={13} /></SettingsButton><SettingsButton variant="ghost" aria-label={`Remove ${extension.name}`} title="Remove extension" disabled={extensionsBusy} onClick={() => void removeExtension(extension.id, extension.name)}><Trash2 size={13} /></SettingsButton></div>}>
                                    {extension.warnings.length > 0 ? <p className="mt-2 text-[11px] leading-5 text-amber-200/80">{extension.warnings.join(' ')}</p> : null}
                                    <p className="mt-1 break-all text-[10px] text-[var(--settings-text-faint)]">{[...extension.permissions, ...extension.hostPermissions].length > 0 ? `Permissions: ${[...extension.permissions, ...extension.hostPermissions].join(', ')}` : 'No declared permissions.'}</p>
                                </SettingsRow>
                            ))}
                        </SettingsSection>
                    ) : view === 'browsing' ? (
                        <SettingsSection title="Browsing" searchSection="Browser workspace">
                            <SettingsRow title="Open links in" description="Choose where links from chats, files, and the Plugin store open." info="Remembered on this device. Sign-in flows and explicitly named browser actions keep their own destination." control={<SettingsSegmented<DesktopLinkPreference> value={linkPreference} options={[{ value: 'ask', label: 'Ask me' }, { value: 'zyra', label: 'Zyra Browser' }, { value: 'system', label: 'Default browser' }]} onChange={value => { try { setDesktopLinkPreference(value) } catch { showStatus({ tone: 'error', message: 'Could not save the link preference.' }) } }} label="Open links in" />} />
                            <SettingsRow title="Standalone AI tools" description="Show selection, screenshot and recording tools in standalone Browser windows." control={<SettingsSwitch checked={settings.assistantBrowserStandaloneAiTools} onCheckedChange={assistantBrowserStandaloneAiTools => updateSettings({ assistantBrowserStandaloneAiTools })} label="Standalone AI tools" />} />
                            <SettingsRow title="Restore Browser tabs" description="Reopen saved tabs when you return to a chat workspace." control={<SettingsSwitch checked={settings.assistantBrowserRestoreTabs} onCheckedChange={(assistantBrowserRestoreTabs) => updateSettings({ assistantBrowserRestoreTabs })} label="Restore Browser tabs" />} />
                            <SettingsRow title="New Tab backgrounds" description="Choose a background source for new tabs." info="Built-in uses an attributed nature pack; configure your Unsplash key in the New Tab background picker." control={<SettingsSegmented value={settings.assistantBrowserNewTabBackgroundMode} options={[{ value: 'off', label: 'Off' }, { value: 'built-in', label: 'Built-in' }, { value: 'unsplash', label: 'Unsplash' }]} onChange={(assistantBrowserNewTabBackgroundMode) => updateSettings({ assistantBrowserNewTabBackgroundMode })} label="New Tab background source" />} />
                            {settings.assistantBrowserNewTabBackgroundMode !== 'off' ? (<SettingsRow title="Background behavior" description="Change the image per tab or keep your selected image." control={<SettingsSegmented value={settings.assistantBrowserNewTabBackgroundRotation} options={[{ value: 'every-tab', label: 'Every tab' }, { value: 'fixed', label: 'Locked' }]} onChange={(assistantBrowserNewTabBackgroundRotation) => updateSettings({ assistantBrowserNewTabBackgroundRotation })} label="New Tab background behavior" />} />) : null}
                            <SettingsPageLink to="/settings/workspace/browser/captures" title="Captures" description="Saved screenshots and recordings." />
                        </SettingsSection>
                    ) : view === 'privacy' ? (
                        <SettingsSection title="Browser privacy" searchSection="Browser workspace">
                            <SettingsRow title="Website sign-ins" description="Keep website sign-ins on this device across chats." info="Cookies and site storage persist across restarts; Zyra does not save passwords." status="Saved on this device" statusTone="ready" />
                            <SettingsRow title="Google search suggestions" description="Send search text to Google for live suggestions." info="Addresses, localhost targets, paths and credential-shaped text are excluded." control={<SettingsSwitch checked={settings.assistantBrowserGoogleSuggestions} onCheckedChange={(assistantBrowserGoogleSuggestions) => updateSettings({ assistantBrowserGoogleSuggestions })} label="Google search suggestions" />} />
                            <SettingsRow title="Built-in ad blocking" description="Block ads and trackers in the built-in Browser." info="Off by default; enabled blocking covers network, media, cosmetic, popup and tracking rules, excluding local development sites." status={settings.assistantBrowserAdBlockEnabled ? 'On' : 'Off'} statusTone={settings.assistantBrowserAdBlockEnabled ? 'ready' : 'muted'} control={<SettingsSwitch checked={settings.assistantBrowserAdBlockEnabled} disabled={adBlockBusy} onCheckedChange={(enabled) => void setAdBlocking(enabled)} label="Built-in ad blocking" />} />
                        </SettingsSection>
                    ) : (
                        <SettingsSection title="Site data" searchSection="Browser workspace">
                            <SettingsRow title="Retained workspaces" description="Clear saved tab layouts without deleting chats or files." status={`${retainedWorkspaceCount} saved`} statusTone={retainedWorkspaceCount > 0 ? 'info' : 'muted'} control={<SettingsButton variant="ghost" onClick={clearRetainedWorkspaces} disabled={retainedWorkspaceCount === 0}><Trash2 size={12} />Clear layouts</SettingsButton>} />
                            <SettingsRow title="Browser history" description="Clear visited addresses while keeping website sign-ins." status={browserHistoryState === 'checking' ? 'Checking…' : browserHistoryState === 'present' ? 'Saved locally' : browserHistoryState === 'empty' ? 'Empty' : 'Unavailable'} statusTone={browserHistoryState === 'present' ? 'info' : 'muted'} control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('history')} disabled={browserHistoryState !== 'present'}>Clear history</SettingsButton>} />
                            <SettingsRow title="Temporary cache" description="Clear downloaded resources while keeping website sign-ins." control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('cache')}>Clear cache</SettingsButton>} />
                            <SettingsRow title="Sign out of websites" description="Clear cookies and sign out of all Browser websites." info="This requires confirmation and does not involve saved passwords because Zyra does not store them." control={<SettingsButton variant="ghost" onClick={() => void runMaintenance('cookies')}>Sign out everywhere</SettingsButton>} />
                            <SettingsRow title="Reset Browser profile" description="Remove all local Browser history, cookies and site data." info="This also clears cached resources and site permissions after confirmation." control={<SettingsButton variant="danger" onClick={() => void runMaintenance('profile')}>Reset profile</SettingsButton>} />
                        </SettingsSection>
                    )}
                    {status && status.view === view ? <SettingsNotice tone={status.tone}>{status.message}</SettingsNotice> : null}
                </>
            ) : (
                <SettingsSection title="Browser workspace"><SettingsNotice>Open Zyra Desktop to manage its Browser and site data.</SettingsNotice></SettingsSection>
            )}
        </SettingsPageContainer>
    )
}
