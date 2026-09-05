import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Download,
    ExternalLink,
    RefreshCw,
    Rocket,
    X
} from 'lucide-react'
import type { DevScopeUpdateState, DevScopeUpdateStatus } from '@shared/contracts/devscope-api'
import { getUpdateActionLabel, useAppUpdates } from '@/lib/app-updates'
import { cn } from '@/lib/utils'
import { UpdateInstallConfirmation } from './UpdateInstallConfirmation'

function formatCheckedAt(checkedAt: string | null): string | null {
    if (!checkedAt) return null

    const parsed = new Date(checkedAt)
    if (Number.isNaN(parsed.getTime())) return null

    return parsed.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    })
}

function resolveStatusAccent(statusTone: ReturnType<typeof useAppUpdates>['statusTone']): string {
    switch (statusTone) {
        case 'checking':
        case 'downloading':
            return 'text-sky-300'
        case 'available':
            return 'text-amber-300'
        case 'downloaded':
            return 'text-emerald-300'
        case 'up-to-date':
            return 'text-emerald-200'
        case 'error':
            return 'text-red-300'
        default:
            return 'text-white/80'
    }
}

function resolveStatusOrb(statusTone: ReturnType<typeof useAppUpdates>['statusTone']): string {
    switch (statusTone) {
        case 'checking':
        case 'downloading':
            return 'bg-sky-400'
        case 'available':
            return 'bg-amber-400'
        case 'downloaded':
            return 'bg-emerald-400'
        case 'up-to-date':
            return 'bg-emerald-300'
        case 'error':
            return 'bg-red-400'
        default:
            return 'bg-white/35'
    }
}

function resolveStatusSurface(status: DevScopeUpdateStatus): string {
    switch (status) {
        case 'checking':
        case 'downloading':
            return 'border-[color-mix(in_srgb,var(--status-info)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-info)_10%,transparent)] text-[var(--status-info)]'
        case 'available':
            return 'border-[color-mix(in_srgb,var(--status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] text-[var(--status-warning)]'
        case 'downloaded':
        case 'up-to-date':
            return 'border-[color-mix(in_srgb,var(--status-success)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)] text-[var(--status-success)]'
        case 'error':
            return 'border-[color-mix(in_srgb,var(--status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_10%,transparent)] text-[var(--status-danger)]'
        default:
            return 'border-[var(--settings-border)] bg-[var(--settings-control)] text-[var(--settings-text-muted)]'
    }
}

function resolveUpdateHeadline(updateState: DevScopeUpdateState): string {
    switch (updateState.status) {
        case 'disabled':
            return 'Updates are unavailable'
        case 'checking':
            return 'Checking for updates'
        case 'available':
            return updateState.availableDisplayVersion ? `${updateState.availableDisplayVersion} is available` : 'An update is available'
        case 'downloading':
            return updateState.availableDisplayVersion ? `Downloading ${updateState.availableDisplayVersion}` : 'Downloading update'
        case 'downloaded':
            return updateState.downloadedDisplayVersion ? `${updateState.downloadedDisplayVersion} is ready` : 'Update ready to install'
        case 'up-to-date':
            return 'Zyra is up to date'
        case 'error':
            return 'Update failed'
        default:
            return 'Check for a newer version'
    }
}

function resolveUpdateDescription(updateState: DevScopeUpdateState): string {
    switch (updateState.status) {
        case 'disabled':
            return 'Use the release page to download updates manually.'
        case 'checking':
            return 'Looking for a newer build on the selected release channel.'
        case 'available':
            return 'Download the update now, or keep working and install it later.'
        case 'downloading':
            return 'The update package is downloading in the background.'
        case 'downloaded':
            return 'Restart Zyra when you are ready to finish the installation.'
        case 'up-to-date':
            return 'This installation matches the latest published build.'
        case 'error':
            return 'Zyra could not complete the update operation.'
        default:
            return 'Check the release channel without leaving the app.'
    }
}

function UpdateStatusIcon({ status }: { status: DevScopeUpdateStatus }) {
    if (status === 'error') return <AlertTriangle size={18} />
    if (status === 'downloaded' || status === 'up-to-date') return <CheckCircle2 size={18} />
    if (status === 'available') return <Download size={18} />
    if (status === 'checking' || status === 'downloading') return <RefreshCw size={18} className="animate-spin" />
    return <Clock3 size={18} />
}

const updateActionBase = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45'
const updateActionSecondary = `${updateActionBase} border border-[var(--settings-border)] bg-[var(--settings-control)] text-[var(--settings-text-secondary)] hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]`
const updateActionGhost = `${updateActionBase} text-[var(--settings-text-muted)] hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]`
const updateActionPrimary = `${updateActionBase} border border-[color-mix(in_srgb,var(--accent-primary)_35%,transparent)] bg-[var(--accent-primary)] text-[var(--accent-on-primary)] hover:brightness-110`

function ExternalReleaseButton({
    href,
    label,
    className
}: {
    href: string
    label: string
    className?: string
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(updateActionSecondary, className)}
        >
            <ExternalLink size={13} />
            {label}
        </a>
    )
}

function UpdateActionRow() {
    const {
        updateState,
        pendingAction,
        checkForUpdates,
        downloadUpdate,
        installUpdate,
        skipAvailableVersion,
        remindLater,
        clearSkippedVersion
    } = useAppUpdates()

    if (!updateState) return null

    const isBusy = pendingAction !== null

    switch (updateState.status) {
        case 'disabled':
            return <ExternalReleaseButton href={updateState.releasePageUrl} label="Open latest release" />
        case 'available':
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={skipAvailableVersion} className={updateActionGhost}>Skip version</button>
                    <ExternalReleaseButton href={updateState.releasePageUrl} label="Release notes" />
                    <button type="button" disabled={isBusy} onClick={() => { void downloadUpdate() }} className={updateActionPrimary}>
                        <Download size={13} />
                        {pendingAction === 'download' ? 'Downloading…' : 'Download update'}
                    </button>
                </div>
            )
        case 'downloading':
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ExternalReleaseButton href={updateState.releasePageUrl} label="Release notes" />
                    <span className={cn(updateActionSecondary, 'text-[var(--status-info)]')}>
                        <RefreshCw size={13} className="animate-spin" />
                        Downloading…
                    </span>
                </div>
            )
        case 'downloaded':
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={remindLater} className={updateActionGhost}>Later</button>
                    <button type="button" disabled={isBusy} onClick={() => { void installUpdate() }} className={updateActionPrimary}>
                        <Rocket size={13} />
                        {pendingAction === 'install' ? 'Restarting…' : 'Restart and install'}
                    </button>
                </div>
            )
        case 'checking':
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ExternalReleaseButton href={updateState.releasePageUrl} label="Release page" />
                    <span className={cn(updateActionSecondary, 'text-[var(--status-info)]')}>
                        <RefreshCw size={13} className="animate-spin" />
                        Checking…
                    </span>
                </div>
            )
        case 'error':
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ExternalReleaseButton href={updateState.releasePageUrl} label="Latest release" />
                    {updateState.availableVersion ? (
                        <button type="button" disabled={isBusy} onClick={() => { void downloadUpdate() }} className={updateActionSecondary}>Download again</button>
                    ) : null}
                    {updateState.downloadedVersion ? (
                        <button type="button" disabled={isBusy} onClick={() => { void installUpdate() }} className={updateActionSecondary}>Install again</button>
                    ) : null}
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            clearSkippedVersion()
                            void checkForUpdates()
                        }}
                        className={updateActionPrimary}
                    >
                        <RefreshCw size={13} className={cn(pendingAction === 'check' && 'animate-spin')} />
                        Check again
                    </button>
                </div>
            )
        default:
            return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ExternalReleaseButton href={updateState.releasePageUrl} label="Release page" />
                    <button
                        type="button"
                        disabled={isBusy || !updateState.enabled}
                        onClick={() => {
                            clearSkippedVersion()
                            void checkForUpdates()
                        }}
                        className={updateActionPrimary}
                    >
                        <RefreshCw size={13} className={cn(pendingAction === 'check' && 'animate-spin')} />
                        {updateState.status === 'up-to-date' ? 'Check again' : 'Check for updates'}
                    </button>
                </div>
            )
    }
}

export function UpdatePromptCenter() {
    const {
        updateState,
        actionError,
        isModalOpen,
        shouldShowPrompt,
        pendingAction,
        closeModal,
        openModal,
        downloadUpdate,
        installUpdate,
        remindLater,
        skipAvailableVersion,
        updateSuccessToast,
        dismissUpdateSuccessToast,
        statusTone
    } = useAppUpdates()

    useEffect(() => {
        if (!isModalOpen) return
        const originalOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = originalOverflow
        }
    }, [isModalOpen])

    if (!updateState) return null

    const checkedAtLabel = formatCheckedAt(updateState.checkedAt)
    const statusLabel = getUpdateActionLabel(updateState)
    const statusAccent = resolveStatusAccent(statusTone)
    const statusOrb = resolveStatusOrb(statusTone)
    const downloadPercent = Math.max(0, Math.min(100, updateState.downloadPercent ?? 0))
    const detailMessage = actionError || (updateState.message && updateState.message !== updateState.disabledReason
        ? updateState.message
        : null)
    const offeredVersion = updateState.downloadedDisplayVersion
        || updateState.availableDisplayVersion
        || updateState.downloadedVersion
        || updateState.availableVersion
        || null
    const offeredVersionLabel = updateState.status === 'downloaded' ? 'Ready to install' : 'Available version'

    const prompt = shouldShowPrompt ? (
        <div className="fixed bottom-4 right-4 z-[140] w-full max-w-md rounded-2xl border border-white/10 bg-sparkle-card/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-3">
                <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]', statusAccent)}>
                    {updateState.status === 'downloaded' ? (
                        <CheckCircle2 size={18} />
                    ) : updateState.status === 'available' ? (
                        <Rocket size={18} />
                    ) : (
                        <RefreshCw size={18} className="animate-spin" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={openModal}
                        className="w-full text-left"
                    >
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-sparkle-text">
                                {updateState.status === 'downloaded'
                                    ? 'Download ready'
                                    : updateState.status === 'available'
                                        ? 'Update available'
                                        : 'Downloading update'}
                            </p>
                            <span className={cn('h-2 w-2 rounded-full', statusOrb)} />
                        </div>
                        <p className="mt-1 text-sm text-sparkle-text-secondary">
                            {statusLabel}
                        </p>
                    </button>

                    {updateState.status === 'downloading' && (
                        <div className="mt-3">
                            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                                <div
                                    className="h-full bg-sky-400 transition-[width] duration-300"
                                    style={{ width: `${downloadPercent}%` }}
                                />
                            </div>
                            <p className="mt-2 text-xs text-sparkle-text-muted">
                                {Math.round(downloadPercent)}% downloaded
                            </p>
                        </div>
                    )}

                    {updateState.status === 'available' && (
                        <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={skipAvailableVersion}
                                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-white"
                            >
                                Skip
                            </button>
                            <button
                                type="button"
                                disabled={pendingAction === 'download'}
                                onClick={() => { void downloadUpdate() }}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 transition-colors hover:border-white/20 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Download size={15} />
                                {pendingAction === 'download' ? 'Downloading...' : 'Download'}
                            </button>
                        </div>
                    )}

                    {updateState.status === 'downloaded' && (
                        <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={remindLater}
                                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-white"
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                disabled={pendingAction === 'install'}
                                onClick={() => { void installUpdate() }}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 transition-colors hover:border-white/20 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Rocket size={15} />
                                {pendingAction === 'install' ? 'Restarting...' : 'Install & restart'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    ) : null

    const successToast = updateSuccessToast ? (
        <div
            className={cn(
                'fixed bottom-4 right-4 z-[145] w-full max-w-sm rounded-xl border border-emerald-400/20 bg-sparkle-card/95 p-3 shadow-2xl backdrop-blur-xl transition-all duration-150',
                updateSuccessToast.isVisible
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-2 opacity-0'
            )}
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/12 text-emerald-200">
                    <CheckCircle2 size={17} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-sparkle-text">
                        Update successful
                    </p>
                    <p className="mt-0.5 truncate text-sm text-sparkle-text-secondary">
                        Running {updateSuccessToast.versionLabel}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={dismissUpdateSuccessToast}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white"
                    aria-label="Dismiss update success"
                >
                    <X size={15} />
                </button>
            </div>
        </div>
    ) : null

    const modal = isModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
                className="fixed inset-0 z-[150] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_68%,transparent)] p-5 backdrop-blur-[3px] animate-fadeIn"
                onClick={closeModal}
            >
                <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="update-center-title"
                    className="flex max-h-[calc(100vh-40px)] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-[var(--settings-border-strong)] bg-[var(--settings-popover)] text-[var(--settings-text)] shadow-[0_24px_80px_color-mix(in_srgb,var(--color-bg)_70%,transparent)]"
                    onClick={(event) => event.stopPropagation()}
                >
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--settings-divider)] px-5 py-4">
                        <div className="min-w-0">
                            <h2 id="update-center-title" className="text-[15px] font-semibold tracking-[-0.01em]">Update Center</h2>
                            <p className="mt-1 text-[12px] leading-5 text-[var(--settings-text-secondary)]">Updates for this Zyra installation.</p>
                        </div>
                        <button
                            type="button"
                            onClick={closeModal}
                            aria-label="Close Update Center"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]"
                        >
                            <X size={14} />
                        </button>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="px-5 py-5">
                            <div className="flex items-start gap-3.5">
                                <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', resolveStatusSurface(updateState.status))}>
                                    <UpdateStatusIcon status={updateState.status} />
                                </div>
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <h3 className="text-[16px] font-semibold tracking-[-0.015em] text-[var(--settings-text)]">{resolveUpdateHeadline(updateState)}</h3>
                                    <p className="mt-1 text-[12px] leading-5 text-[var(--settings-text-secondary)]">{resolveUpdateDescription(updateState)}</p>
                                </div>
                            </div>

                            {updateState.disabledReason ? (
                                <div className="mt-4 border-l-2 border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_7%,transparent)] px-3 py-2 text-[12px] leading-5 text-[color-mix(in_srgb,var(--status-warning)_78%,var(--settings-text))]">
                                    {updateState.disabledReason}
                                </div>
                            ) : null}

                            {detailMessage ? (
                                <div className={cn(
                                    'mt-4 border-l-2 px-3 py-2 text-[12px] leading-5',
                                    updateState.status === 'error'
                                        ? 'border-[var(--status-danger)] bg-[color-mix(in_srgb,var(--status-danger)_7%,transparent)] text-[color-mix(in_srgb,var(--status-danger)_78%,var(--settings-text))]'
                                        : 'border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_7%,transparent)] text-[color-mix(in_srgb,var(--status-warning)_78%,var(--settings-text))]'
                                )}>
                                    {detailMessage}
                                </div>
                            ) : null}

                            {updateState.status === 'downloading' ? (
                                <div className="mt-5 border-t border-[var(--settings-divider)] pt-4">
                                    <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-[var(--settings-text-secondary)]">
                                        <span>Downloading update package</span>
                                        <span className="font-mono text-[var(--settings-text)]">{Math.round(downloadPercent)}%</span>
                                    </div>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--settings-track)]">
                                        <div
                                            className="h-full rounded-full bg-[var(--status-info)] transition-[width] duration-300"
                                            style={{ width: `${downloadPercent}%` }}
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <dl className="border-y border-[var(--settings-divider)] bg-[color-mix(in_srgb,var(--settings-section)_70%,transparent)] px-5">
                            <div className="flex min-h-11 items-center justify-between gap-5 border-b border-[var(--settings-row-divider)] py-2.5">
                                <dt className="text-[11px] text-[var(--settings-text-muted)]">Installed version</dt>
                                <dd className="font-mono text-[12px] font-medium text-[var(--settings-text)]">{updateState.currentDisplayVersion}</dd>
                            </div>
                            {offeredVersion ? (
                                <div className="flex min-h-11 items-center justify-between gap-5 border-b border-[var(--settings-row-divider)] py-2.5">
                                    <dt className="text-[11px] text-[var(--settings-text-muted)]">{offeredVersionLabel}</dt>
                                    <dd className="font-mono text-[12px] font-medium text-[var(--settings-text)]">{offeredVersion}</dd>
                                </div>
                            ) : null}
                            <div className="flex min-h-11 items-center justify-between gap-5 border-b border-[var(--settings-row-divider)] py-2.5">
                                <dt className="text-[11px] text-[var(--settings-text-muted)]">Release channel</dt>
                                <dd className="text-[12px] font-medium capitalize text-[var(--settings-text)]">{updateState.channel}</dd>
                            </div>
                            <div className="flex min-h-11 items-center justify-between gap-5 border-b border-[var(--settings-row-divider)] py-2.5">
                                <dt className="text-[11px] text-[var(--settings-text-muted)]">Last checked</dt>
                                <dd className="text-right text-[12px] text-[var(--settings-text-secondary)]">{checkedAtLabel || 'Not checked yet'}</dd>
                            </div>
                            <div className="flex min-h-11 items-center justify-between gap-5 py-2.5">
                                <dt className="text-[11px] text-[var(--settings-text-muted)]">Release source</dt>
                                <dd className="max-w-[70%] truncate text-right font-mono text-[11px] text-[var(--settings-text-secondary)]" title={updateState.repository}>{updateState.repository}</dd>
                            </div>
                        </dl>
                    </div>

                    <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--settings-divider)] px-5 py-3.5">
                        <UpdateActionRow />
                    </footer>
                </section>
            </div>,
            document.body
        )
        : null

    return (
        <>
            {successToast}
            {prompt}
            {modal}
            <UpdateInstallConfirmation />
        </>
    )
}
