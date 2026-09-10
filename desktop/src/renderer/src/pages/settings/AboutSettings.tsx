import { useEffect, useState, type ReactNode } from 'react'
import { Download, ExternalLink, Github, RefreshCw, Rocket, SquareTerminal } from 'lucide-react'
import type { DevScopeTerminalCommandStatus } from '@shared/contracts/devscope-api'
import { getUpdateActionLabel, useAppUpdates } from '@/lib/app-updates'
import { formatDesktopVersion, resolveDesktopReleaseChannel } from '@/lib/release-build-metadata'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { getZyraPlatformLabel } from '@shared/platform-window-chrome'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { SettingsKeyValueList } from './SettingsKeyValueList'
import { createSettingsRowTargetId } from './settings-search'
import { getSettingsUpdateAction } from './settings-update-action'
import {
    SettingsButton,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection
} from './settings-layout'

export default function AboutSettings() {
    const { runtime } = useWindowChrome()
    const {
        updateState,
        pendingAction,
        openModal,
        checkForUpdates,
        downloadUpdate,
        installUpdate,
        skippedVersion,
        skipAvailableVersion,
        remindLater,
        clearSkippedVersion
    } = useAppUpdates()

    const [terminalCommand, setTerminalCommand] = useState<DevScopeTerminalCommandStatus | null>(null)
    const [terminalCommandBusy, setTerminalCommandBusy] = useState(false)
    const [terminalCommandError, setTerminalCommandError] = useState<string | null>(null)
    useEffect(() => {
        let cancelled = false
        void window.devscope.window.getTerminalCommandStatus().then((result) => {
            if (cancelled) return
            if (result.success) setTerminalCommand(result.status)
            else setTerminalCommandError(result.error || 'Command status is unavailable.')
        }).catch(error => { if (!cancelled) setTerminalCommandError(error instanceof Error ? error.message : 'Command status is unavailable.') })
        return () => { cancelled = true }
    }, [])
    const toggleTerminalCommand = async () => {
        setTerminalCommandBusy(true)
        setTerminalCommandError(null)
        try {
            const result = terminalCommand?.installed
                ? await window.devscope.window.removeTerminalCommand()
                : await window.devscope.window.installTerminalCommand()
            if (!result.success) throw new Error(result.error)
            setTerminalCommand(result.status)
        } catch (error) {
            setTerminalCommandError(error instanceof Error ? error.message : 'Could not update the terminal command.')
        } finally {
            setTerminalCommandBusy(false)
        }
    }

    const busy = pendingAction !== null
    const updateSummary = getUpdateActionLabel(updateState)
    const updateStatus = updateState?.status ?? 'idle'
    const updatesEnabled = updateState?.enabled === true
    const primaryUpdateAction = getSettingsUpdateAction(updateStatus, updatesEnabled, busy)
    const availableVersion = updateState?.availableDisplayVersion || updateState?.availableVersion || null
    const downloadedVersion = updateState?.downloadedDisplayVersion || updateState?.downloadedVersion || null
    const checkedAt = updateState?.checkedAt ? new Date(updateState.checkedAt) : null
    const checkedAtLabel = checkedAt && !Number.isNaN(checkedAt.getTime()) ? `Last checked ${checkedAt.toLocaleString()}` : 'Not checked in this session'
    const packageVersion = updateState?.currentVersion || runtime.appVersion || __ZYRA_DESKTOP_VERSION__
    const displayVersion = updateState?.currentDisplayVersion || formatDesktopVersion(packageVersion)
    const releaseChannel = updateState?.channel || resolveDesktopReleaseChannel(packageVersion)
    const platformLabel = getZyraPlatformLabel(runtime.platform)
    const runtimeLabel = runtime.platform === 'browser'
        ? `Hosted by Zyra Desktop · ${runtime.architecture}`
        : `Electron ${runtime.electronVersion || 'unknown'} · ${runtime.architecture}`

    return (
        <SettingsPageContainer title="About & updates">
            <SettingsSection title="About Zyra">
                <SettingsKeyValueList label="About Zyra" items={[
                    { id: 'version', label: 'Version', value: displayVersion, searchTargetId: createSettingsRowTargetId('About Zyra', 'Version') },
                    { id: 'package', label: 'Package version', value: packageVersion, searchTargetId: createSettingsRowTargetId('About Zyra', 'Package version') },
                    { id: 'channel', label: 'Release channel', value: releaseChannel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Release channel') },
                    { id: 'platform', label: 'Platform', value: platformLabel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Platform') },
                    { id: 'runtime', label: 'Application stack', value: runtimeLabel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Application stack') },
                    { id: 'license', label: 'License', value: 'Apache-2.0', searchTargetId: createSettingsRowTargetId('About Zyra', 'License') }
                ]} />
            </SettingsSection>

            <SettingsSection title="Terminal">
                {terminalCommandError ? <SettingsNotice tone="error">{terminalCommandError}</SettingsNotice> : null}
                <SettingsRow
                    title="zyra command"
                    description="Run the bundled Zyra TUI from your terminal."
                    info={terminalCommand?.installed ? <code className="break-all text-[11px]">{terminalCommand.path}</code> : undefined}
                    status={!terminalCommand ? terminalCommandError ? 'Unavailable' : 'Checking…' : terminalCommand.installed ? (terminalCommand.pathConfigured ? 'Ready' : 'Add folder to PATH') : 'Not installed'}
                    control={<SettingsButton onClick={() => void toggleTerminalCommand()} disabled={terminalCommandBusy || !terminalCommand}><SquareTerminal size={12} />{terminalCommandBusy ? 'Updating…' : terminalCommand?.installed ? 'Remove' : 'Install'}</SettingsButton>}
                />
            </SettingsSection>

            <SettingsSection title="Updates" headerAction={<SettingsButton variant="ghost" onClick={openModal}>Open Update Center</SettingsButton>}>
                {!updateState ? <SettingsNotice>Loading the desktop update service…</SettingsNotice> : null}
                {updateState?.disabledReason ? <SettingsNotice tone="warning">{updateState.disabledReason}</SettingsNotice> : null}
                {updateStatus === 'error' && updateState?.message ? <SettingsNotice tone="error">{updateState.message}</SettingsNotice> : null}
                <SettingsRow title="Update status" description="Current state of the desktop update service." status={checkedAtLabel} control={<span className="text-xs font-medium text-sparkle-text-secondary">{updateSummary}</span>} />
                <SettingsKeyValueList label="Update details" items={[
                    { id: 'available', label: 'Available version', value: availableVersion || 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Available version') },
                    { id: 'downloaded', label: 'Downloaded version', value: downloadedVersion || 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Downloaded version') },
                    { id: 'progress', label: 'Download progress', value: updateStatus === 'downloading' ? updateState?.downloadPercent == null ? 'In progress' : `${Math.round(updateState.downloadPercent)}%` : 'Inactive', searchTargetId: createSettingsRowTargetId('Updates', 'Download progress') },
                    { id: 'skipped', label: 'Skipped version', value: skippedVersion ? <span className="inline-flex items-center gap-2">{skippedVersion}<SettingsButton variant="ghost" onClick={clearSkippedVersion}>Clear skip</SettingsButton></span> : 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Skipped version') }
                ]} />
                <SettingsRow
                    title="Update actions"
                    description="Keep this installation up to date."
                    control={<div className="flex items-center gap-2"><SettingsButton variant={primaryUpdateAction.id === 'install' ? 'accent' : 'outline'} disabled={primaryUpdateAction.disabled} onClick={() => {
                        if (primaryUpdateAction.id === 'download') void downloadUpdate()
                        else if (primaryUpdateAction.id === 'install') void installUpdate()
                        else { clearSkippedVersion(); void checkForUpdates() }
                    }}>{primaryUpdateAction.id === 'download' ? <Download size={12} /> : primaryUpdateAction.id === 'install' ? <Rocket size={12} /> : <RefreshCw size={12} className={updateStatus === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''} />}{primaryUpdateAction.label}</SettingsButton>{primaryUpdateAction.id !== 'check' ? <SettingsActionsMenu label="More" disabled={busy || !updatesEnabled} items={[{ id: 'check', label: 'Check for newer updates', onSelect: () => { clearSkippedVersion(); void checkForUpdates() } }]} /> : null}</div>}
                />
                <SettingsRow title="Defer this update" description="Postpone the prompt or skip the offered version." control={<SettingsActionsMenu label="Options" ariaLabel="Defer this update" disabled={updateStatus !== 'available' || busy} items={[{ id: 'later', label: 'Remind later', onSelect: remindLater }, { id: 'skip', label: 'Skip this version', onSelect: skipAvailableVersion }]} />} />
            </SettingsSection>

            <SettingsSection title="Links">
                <ExternalRow title="Creator GitHub" description="Profile for the Zyra project creator." href="https://github.com/justelson" icon={<Github size={13} />} />
                <ExternalRow title="Source code" description="Zyra source repository." href="https://github.com/justelson/zyra" icon={<Github size={13} />} />
                <ExternalRow title="Report an issue" description="Open a bug report or feature request." href="https://github.com/justelson/zyra/issues" icon={<ExternalLink size={13} />} />
            </SettingsSection>
        </SettingsPageContainer>
    )
}

function ExternalRow({ title, description, href, icon }: { title: string; description: string; href: string; icon: ReactNode }) {
    return (
        <SettingsRow title={title} description={description} control={<a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-2.5 text-xs font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--settings-control-hover)] hover:text-sparkle-text">{icon}Open</a>} />
    )
}
