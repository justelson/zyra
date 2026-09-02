import { useEffect, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { BROWSER_CLIENT_HOST_ORIGIN } from '@shared/browser-assistant-bridge'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import {
    SettingsButton,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection
} from './settings-layout'

type ConnectionActionStatus = {
    label: string
    tone: 'ready' | 'danger'
    detail?: string
}

export default function ConnectionsSettings() {
    const [actionStatus, setActionStatus] = useState<ConnectionActionStatus | null>(null)
    const desktopHost = isElectronRendererRuntime()

    useEffect(() => {
        if (!actionStatus) return
        const timer = window.setTimeout(() => setActionStatus(null), 3_000)
        return () => window.clearTimeout(timer)
    }, [actionStatus])

    const copyLocalBrowserLink = async () => {
        try {
            const result = await window.devscope.copyToClipboard(BROWSER_CLIENT_HOST_ORIGIN)
            if (!result.success) throw new Error(result.error || 'Could not copy the browser link.')
            setActionStatus({ label: 'Link copied', tone: 'ready' })
        } catch (error) {
            setActionStatus({
                label: 'Copy failed',
                tone: 'danger',
                detail: error instanceof Error ? error.message : 'Could not copy the browser link.'
            })
        }
    }

    const openLocalBrowserClient = async () => {
        try {
            const result = await window.devscope.openBrowserPreviewExternal(BROWSER_CLIENT_HOST_ORIGIN)
            if (!result.success) throw new Error(result.error || 'Could not open the local browser client.')
            setActionStatus({ label: 'Opened', tone: 'ready' })
        } catch (error) {
            setActionStatus({
                label: 'Open failed',
                tone: 'danger',
                detail: error instanceof Error ? error.message : 'Could not open the local browser client.'
            })
        }
    }

    return (
        <SettingsPageContainer title="Device connections" backTo="/settings/account" backLabel="Account & connections">
            <SettingsSection title="This device">
                <SettingsRow
                    title="Zyra in your browser"
                    description="Open the same chats, projects, files, terminals, and approvals in Chrome."
                    status={actionStatus?.label || (desktopHost ? 'This computer' : 'Connected')}
                    statusTone={actionStatus?.tone || (desktopHost ? 'info' : 'ready')}
                    statusTitle={actionStatus?.detail}
                    control={(
                        <>
                            <SettingsButton variant="ghost" onClick={() => void copyLocalBrowserLink()}><Copy size={12} />Copy link</SettingsButton>
                            {desktopHost ? <SettingsButton onClick={() => void openLocalBrowserClient()}><ExternalLink size={12} />Open</SettingsButton> : null}
                        </>
                    )}
                >
                    <code className="mt-3 block w-full select-all overflow-x-auto rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-3 py-2 font-mono text-[11px] text-[var(--settings-text-secondary)]">
                        {BROWSER_CLIENT_HOST_ORIGIN}
                    </code>
                </SettingsRow>
                <SettingsRow
                    title="Connection scope"
                    description="The local browser client accepts connections from this computer only."
                    status="Local only"
                    statusTone="ready"
                />
            </SettingsSection>

            <SettingsSection title="Trusted devices">
                <SettingsRow
                    title="Other devices"
                    description="Connections from phones and other computers are currently disabled."
                    status="Not enabled"
                    statusTone="muted"
                />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
