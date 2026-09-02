import { useEffect, useState, type ReactNode } from 'react'
import { Download, ExternalLink, Github, RefreshCw, Rocket, SquareTerminal } from 'lucide-react'
import type { DevScopeTerminalCommandStatus } from '@shared/contracts/devscope-api'
import { getUpdateActionLabel, useAppUpdates } from '@/lib/app-updates'
import { formatDesktopVersion, resolveDesktopReleaseChannel } from '@/lib/release-build-metadata'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { getZyraPlatformLabel } from '@shared/platform-window-chrome'
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
            if (!cancelled && result.success) setTerminalCommand(result.status)
        })
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
                <SettingsRow title="Version" description="Unified Zyra version reported by this Desktop host." control={<span className="font-mono text-xs font-medium text-sparkle-text-secondary">{displayVersion}</span>} />
                <SettingsRow title="Package version" description="Lockstep repository and Desktop package version." control={<span className="font-mono text-xs text-sparkle-text-secondary">{packageVersion}</span>} />
                <SettingsRow title="Release channel" description="Update feed selected for this installation." control={<span className="text-xs font-medium capitalize text-sparkle-text-secondary">{releaseChannel}</span>} />
                <SettingsRow title="Platform" description="Native Desktop host for this client." control={<span className="text-xs font-medium text-sparkle-text-secondary">{platformLabel}</span>} />
                <SettingsRow title="Application stack" description="Host runtime and architecture." control={<span className="text-xs font-medium text-sparkle-text-secondary">{runtimeLabel}</span>} />
                <SettingsRow title="License" description="Source-code license used by this project." control={<span className="text-xs font-medium text-sparkle-text-secondary">Apache-2.0</span>} />
            </SettingsSection>

            <SettingsSection title="Terminal">
                {terminalCommandError ? <SettingsNotice tone="error">{terminalCommandError}</SettingsNotice> : null}
                <SettingsRow
                    title="zyra command"
                    description={terminalCommand?.installed ? `Installed at ${terminalCommand.path}` : 'Run the bundled Zyra TUI from any terminal.'}
                    status={terminalCommand?.installed ? (terminalCommand.pathConfigured ? 'Ready' : 'Installed · add its folder to PATH') : 'Not installed'}
                    control={<SettingsButton onClick={() => void toggleTerminalCommand()} disabled={terminalCommandBusy}><SquareTerminal size={12} />{terminalCommand?.installed ? 'Remove' : 'Install'}</SettingsButton>}
                />
            </SettingsSection>

            <SettingsSection title="Updates" headerAction={<SettingsButton variant="ghost" onClick={openModal}>Open Update Center</SettingsButton>}>
                {!updateState ? <SettingsNotice>Loading the desktop update service…</SettingsNotice> : null}
                {updateState?.disabledReason ? <SettingsNotice tone="warning">{updateState.disabledReason}</SettingsNotice> : null}
                {updateStatus === 'error' && updateState?.message ? <SettingsNotice tone="error">{updateState.message}</SettingsNotice> : null}
                <SettingsRow title="Update status" description="Current state of the desktop update service." status={checkedAtLabel} control={<span className="text-xs font-medium text-sparkle-text-secondary">{updateSummary}</span>} />
                <SettingsRow title="Available version" description="Version currently offered by the configured release channel." status={availableVersion ? undefined : 'None'} statusTone="muted" control={availableVersion ? <span className="font-mono text-xs font-medium text-sparkle-text-secondary">{availableVersion}</span> : null} />
                <SettingsRow title="Downloaded version" description="Update package ready to install after restart." status={downloadedVersion ? undefined : 'None'} statusTone="muted" control={downloadedVersion ? <span className="font-mono text-xs font-medium text-sparkle-text-secondary">{downloadedVersion}</span> : null} />
                <SettingsRow title="Download progress" description="Signed update package currently being downloaded." status={updateStatus === 'downloading' ? undefined : 'Inactive'} statusTone="muted" control={updateStatus === 'downloading' ? <span className="font-mono text-xs font-medium text-sparkle-text-secondary">{updateState?.downloadPercent == null ? 'In progress' : `${Math.round(updateState.downloadPercent)}%`}</span> : null} />
                <SettingsRow title="Skipped version" description="This version will remain hidden until the skip is cleared." status={skippedVersion ? undefined : 'None'} statusTone="muted" control={skippedVersion ? <div className="flex items-center gap-2"><span className="font-mono text-xs text-sparkle-text-secondary">{skippedVersion}</span><SettingsButton variant="ghost" onClick={clearSkippedVersion}>Clear skip</SettingsButton></div> : null} />
                <SettingsRow
                    title="Update actions"
                    description="Check, download, and install through the signed desktop update flow."
                    control={<div className="flex flex-wrap justify-end gap-1"><SettingsButton onClick={() => { clearSkippedVersion(); void checkForUpdates() }} disabled={busy || !updatesEnabled || updateStatus === 'checking'}><RefreshCw size={12} className={pendingAction === 'check' ? 'animate-spin' : ''} />Check</SettingsButton><SettingsButton onClick={() => void downloadUpdate()} disabled={busy || updateStatus !== 'available'}><Download size={12} />Download</SettingsButton><SettingsButton variant="accent" onClick={() => void installUpdate()} disabled={busy || updateStatus !== 'downloaded'}><Rocket size={12} />Restart to install</SettingsButton></div>}
                />
                <SettingsRow title="Defer this update" description="Postpone the prompt or skip the offered version." control={<div className="flex gap-1"><SettingsButton variant="ghost" onClick={remindLater} disabled={updateStatus !== 'available'}>Remind later</SettingsButton><SettingsButton variant="ghost" onClick={skipAvailableVersion} disabled={updateStatus !== 'available'}>Skip version</SettingsButton></div>} />
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
