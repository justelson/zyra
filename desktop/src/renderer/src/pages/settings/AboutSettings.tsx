import type { ReactNode } from 'react'
import { buildMetadata, isPreviewDistribution } from '@shared/distribution-identity'
import { ChevronDown, Download, RefreshCw, Rocket } from 'lucide-react'
import { getUpdateActionLabel, useAppUpdates } from '@/lib/app-updates'
import { formatDesktopVersion, resolveDesktopReleaseChannel } from '@/lib/release-build-metadata'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { getZyraPlatformLabel } from '@shared/platform-window-chrome'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { AboutLinks } from './AboutLinks'
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

// Keep this in sync with the compact TUI brand source in src/zyra-logo.mjs.
const ZYRA_ASCII_LOGO = [
    '┏━━━┳┓ ┏┳━┳━━┓',
    '┣━━┃┃┃ ┃┃┏┫┏┓┃',
    '┃┃━━┫┗━┛┃┃┃┏┓┃',
    '┗━━━┻━┓┏┻┛┗┛┗┛',
    '    ┏━┛┃',
    '    ┗━━┛'
] as const

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
    const displayVersion = isPreviewDistribution() ? `v${packageVersion}` : updateState?.currentDisplayVersion || formatDesktopVersion(packageVersion)
    const releaseChannel = updateState?.channel || resolveDesktopReleaseChannel(packageVersion)
    const platformLabel = getZyraPlatformLabel(runtime.platform)
    const runtimeLabel = runtime.platform === 'browser'
        ? `Hosted by Zyra Desktop · ${runtime.architecture}`
        : `Electron ${runtime.electronVersion || 'unknown'} · ${runtime.architecture}`

    const runPrimaryUpdateAction = () => {
        if (primaryUpdateAction.id === 'download') void downloadUpdate()
        else if (primaryUpdateAction.id === 'install') void installUpdate()
        else {
            clearSkippedVersion()
            void checkForUpdates()
        }
    }

    return (
        <SettingsPageContainer navigation={<></>}>
            <div className="flex flex-col items-center px-1 pt-1 text-center">
                <h1 className="sr-only">About Zyra</h1>
                <pre role="img" aria-label="Zyra" className="select-none text-left font-mono text-[12px] leading-[1.15] text-[var(--accent-primary)]">{ZYRA_ASCII_LOGO.join('\n')}</pre>
                <div className="mt-3 flex items-baseline justify-center gap-2">
                    <span className="text-[18px] font-medium text-[var(--settings-text)]">{isPreviewDistribution() ? 'Zyra Preview' : 'Zyra'}</span>
                    <span aria-label="App version" className="font-mono text-[11px] text-[var(--settings-text-muted)]">{displayVersion}</span>
                </div>
                <p className="mt-2 max-w-[34rem] text-[12px] leading-5 text-[var(--settings-text-secondary)]">Zyra brings your AI providers, projects and tools together for desktop and terminal work.</p>
            </div>

            <SettingsSection title="Updates" headerAction={<SettingsButton variant="ghost" onClick={openModal}>Open Update Center</SettingsButton>}>
                {!updateState ? <SettingsNotice>Loading the desktop update service…</SettingsNotice> : null}
                {updateState?.disabledReason ? <SettingsNotice tone="warning">{updateState.disabledReason}</SettingsNotice> : null}
                {updateStatus === 'error' && updateState?.message ? <SettingsNotice tone="error">{updateState.message}</SettingsNotice> : null}
                <SettingsRow title="Update status" description={checkedAtLabel} status={updateSummary} statusTone={updateStatus === 'error' ? 'danger' : updateStatus === 'available' || updateStatus === 'downloaded' ? 'info' : 'muted'} />
                <SettingsRow
                    title="Update actions"
                    description="Check, download, or install the next desktop release."
                    control={<div className="flex items-center gap-2">
                        <SettingsButton variant={primaryUpdateAction.id === 'install' ? 'accent' : 'outline'} disabled={primaryUpdateAction.disabled} onClick={runPrimaryUpdateAction}>
                            {primaryUpdateAction.id === 'download' ? <Download size={12} /> : primaryUpdateAction.id === 'install' ? <Rocket size={12} /> : <RefreshCw size={12} className={updateStatus === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''} />}
                            {primaryUpdateAction.label}
                        </SettingsButton>
                        {primaryUpdateAction.id !== 'check' ? <SettingsActionsMenu label="More" disabled={busy || !updatesEnabled} items={[{ id: 'check', label: 'Check for newer updates', onSelect: () => { clearSkippedVersion(); void checkForUpdates() } }]} /> : null}
                    </div>}
                />
                {updateStatus === 'available' ? (<SettingsRow title="Defer this update" description="Postpone the prompt or skip the offered version." control={<SettingsActionsMenu label="Options" ariaLabel="Defer this update" disabled={updateStatus !== 'available' || busy} items={[{ id: 'later', label: 'Remind later', onSelect: remindLater }, { id: 'skip', label: 'Skip this version', onSelect: skipAvailableVersion }]} />} />) : null}
                <SettingsDetails label="Update details">
                    <SettingsKeyValueList label="Update details" items={[
                        { id: 'available', label: 'Available version', value: availableVersion || 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Available version') },
                        { id: 'downloaded', label: 'Downloaded version', value: downloadedVersion || 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Downloaded version') },
                        { id: 'progress', label: 'Download progress', value: updateStatus === 'downloading' ? updateState?.downloadPercent == null ? 'In progress' : `${Math.round(updateState.downloadPercent)}%` : 'Inactive', searchTargetId: createSettingsRowTargetId('Updates', 'Download progress') },
                        { id: 'skipped', label: 'Skipped version', value: skippedVersion ? <span className="inline-flex items-center gap-2">{skippedVersion}<SettingsButton variant="ghost" onClick={clearSkippedVersion}>Clear skip</SettingsButton></span> : 'None', searchTargetId: createSettingsRowTargetId('Updates', 'Skipped version') }
                    ]} />
                </SettingsDetails>
            </SettingsSection>

            <SettingsSection title="About Zyra">
                <SettingsKeyValueList label="About Zyra" items={[
                    { id: 'version', label: 'Version', value: displayVersion, searchTargetId: createSettingsRowTargetId('About Zyra', 'Version') },
                    { id: 'license', label: 'License', value: 'Apache-2.0', searchTargetId: createSettingsRowTargetId('About Zyra', 'License') }
                ]} />
                <SettingsDetails label="Build details">
                    <SettingsKeyValueList label="Build details" items={[
                        { id: 'package', label: 'Package version', value: packageVersion, searchTargetId: createSettingsRowTargetId('About Zyra', 'Package version') },
                        { id: 'distribution', label: 'Distribution', value: buildMetadata.distribution, searchTargetId: createSettingsRowTargetId('About Zyra', 'Distribution') },
                        ...(buildMetadata.sourceSha ? [{ id: 'source', label: 'Source commit', value: <span className="break-all font-mono">{buildMetadata.sourceSha}</span>, searchTargetId: createSettingsRowTargetId('About Zyra', 'Source commit') }] : []),
                        { id: 'channel', label: 'Release channel', value: releaseChannel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Release channel') },
                        { id: 'platform', label: 'Platform', value: platformLabel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Platform') },
                        { id: 'runtime', label: 'Application stack', value: runtimeLabel, searchTargetId: createSettingsRowTargetId('About Zyra', 'Application stack') }
                    ]} />
                </SettingsDetails>
            </SettingsSection>

            <AboutLinks />
        </SettingsPageContainer>
    )
}

function SettingsDetails({ label, children }: { label: string; children: ReactNode }) {
    return (
        <details className="group border-t border-[var(--settings-row-divider)]">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-4 py-2 text-[12px] font-medium text-[var(--settings-text-secondary)] hover:bg-[var(--settings-row-hover)] [&::-webkit-details-marker]:hidden">
                {label}
                <ChevronDown size={13} aria-hidden="true" className="text-[var(--settings-text-muted)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-[var(--settings-row-divider)]">{children}</div>
        </details>
    )
}
