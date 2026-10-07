import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw, RotateCcw } from 'lucide-react'
import type {
    AssistantAccountOverview,
    AssistantRateLimitResetCredit
} from '@shared/assistant/contracts'
import { buildRateLimitCards } from './assistant-account-rate-limits'
import {
    SettingsButton,
    SettingsDialog,
    SettingsNotice,
    SettingsRow,
    SettingsSection,
    SettingsStatusPill
} from './settings-layout'

type AccountResetCreditsSectionProps = {
    compact?: boolean
    overview: AssistantAccountOverview | null
    loading: boolean
    onOverviewChange: (overview: AssistantAccountOverview) => void
}

export function AccountResetCreditsSection({
    compact = false,
    overview,
    loading,
    onOverviewChange
}: AccountResetCreditsSectionProps) {
    const [resetsOpen, setResetsOpen] = useState(false)
    const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null)
    const [redeeming, setRedeeming] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [actionWarning, setActionWarning] = useState<string | null>(null)
    const [actionSuccess, setActionSuccess] = useState<string | null>(null)
    const credits = overview?.resetCredits || []
    const availableCount = overview?.availableResetCount
        ?? credits.filter((credit) => credit.available).length
    const selectedCredit = selectedCreditId
        ? credits.find((credit) => credit.id === selectedCreditId) || null
        : null
    const currentUsage = useMemo(
        () => buildRateLimitCards(overview, 'used'),
        [overview]
    )

    const openResetManager = () => {
        setSelectedCreditId(null)
        setActionError(null)
        setActionWarning(null)
        setActionSuccess(null)
        setResetsOpen(true)
    }

    const closeResetManager = () => {
        if (redeeming) return
        setResetsOpen(false)
        setSelectedCreditId(null)
        setActionError(null)
        setActionWarning(null)
        setActionSuccess(null)
    }

    const openConfirmation = (credit: AssistantRateLimitResetCredit) => {
        if (!credit.available || redeeming) return
        setActionError(null)
        setActionWarning(null)
        setActionSuccess(null)
        setSelectedCreditId(credit.id)
    }

    const returnToResetList = () => {
        if (redeeming) return
        setSelectedCreditId(null)
        setActionError(null)
    }

    const redeemSelectedCredit = async () => {
        if (!selectedCredit?.available || redeeming) return
        const creditId = selectedCredit.id
        setRedeeming(true)
        setActionError(null)
        setActionWarning(null)
        setActionSuccess(null)
        try {
            const result = await window.devscope.assistant.redeemAccountReset({
                creditId,
                confirmed: true
            })
            if (!result.success) throw new Error(result.error || 'The banked reset could not be used.')

            if (result.overview) {
                onOverviewChange(result.overview)
            } else if (overview) {
                onOverviewChange({
                    ...overview,
                    availableResetCount: Math.max(0, availableCount - 1),
                    resetCredits: credits.map((credit) => credit.id === creditId
                        ? { ...credit, available: false, status: 'redeemed' }
                        : credit)
                })
            }

            const resetWindowCount = result.redemption.windowsReset
            setActionSuccess(resetWindowCount == null
                ? 'Banked reset used. Eligible usage windows were reset.'
                : `Banked reset used. ${resetWindowCount} usage window${resetWindowCount === 1 ? '' : 's'} reset.`)
            setActionWarning(result.refreshError)
            setSelectedCreditId(null)
        } catch (error) {
            setActionError(error instanceof Error ? error.message : 'The banked reset could not be used.')
        } finally {
            setRedeeming(false)
        }
    }

    const summaryStatus = loading && !overview
        ? 'Checking'
        : overview?.resetCreditsError
            ? 'Needs attention'
            : `${availableCount} available`

    return (
        <>
            {compact ? <button type="button" className="chatgpt-reset-credit" disabled={loading && !overview} onClick={openResetManager}
                aria-label={loading && !overview ? 'Checking reset credits' : overview?.resetCreditsError ? 'Check reset credits' : `${availableCount} reset credit${availableCount === 1 ? '' : 's'}`}
                title={overview?.resetCreditsError || `${availableCount} reset credit${availableCount === 1 ? '' : 's'} available`}>
                <RotateCcw size={11} aria-hidden="true" /><span>{loading && !overview ? '…' : overview?.resetCreditsError ? '!' : availableCount}</span>
            </button> : <SettingsSection title="Banked resets">
                <SettingsRow
                    title="Reset credits"
                    description="Review banked resets for the connected ChatGPT account and approve one when needed."
                    status={summaryStatus}
                    statusTone={overview?.resetCreditsError ? 'warning' : availableCount > 0 ? 'info' : 'muted'}
                    statusTitle={overview?.resetCreditsError || undefined}
                    control={(
                        <SettingsButton
                            disabled={loading && !overview}
                            onClick={openResetManager}
                        >
                            {loading && !overview ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}
                            View resets
                        </SettingsButton>
                    )}
                />
            </SettingsSection>}

            <SettingsDialog
                open={resetsOpen}
                title={selectedCredit ? 'Approve banked reset' : 'Banked resets'}
                className="[&>header]:border-b-0"
                onClose={closeResetManager}
                contentClassName="!space-y-0"
                footer={selectedCredit ? (
                    <>
                        <SettingsButton variant="ghost" disabled={redeeming} onClick={returnToResetList}>
                            <ArrowLeft size={12} />
                            Back
                        </SettingsButton>
                        <SettingsButton
                            variant="danger"
                            disabled={!selectedCredit.available || redeeming}
                            onClick={() => void redeemSelectedCredit()}
                        >
                            {redeeming ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}
                            {redeeming ? 'Using reset…' : 'Approve and use reset'}
                        </SettingsButton>
                    </>
                ) : undefined}
            >
                {selectedCredit ? (
                    <ResetApproval
                        credit={selectedCredit}
                        currentUsage={currentUsage}
                        actionError={actionError}
                    />
                ) : (
                    <ResetCreditList
                        credits={credits}
                        loading={loading && !overview}
                        resetCreditsError={overview?.resetCreditsError || null}
                        actionSuccess={actionSuccess}
                        actionWarning={actionWarning}
                        onReview={openConfirmation}
                    />
                )}
            </SettingsDialog>
        </>
    )
}

function ResetCreditList({
    credits,
    loading,
    resetCreditsError,
    actionSuccess,
    actionWarning,
    onReview
}: {
    credits: AssistantRateLimitResetCredit[]
    loading: boolean
    resetCreditsError: string | null
    actionSuccess: string | null
    actionWarning: string | null
    onReview: (credit: AssistantRateLimitResetCredit) => void
}) {
    return (
        <div className="space-y-2.5">
            {actionSuccess ? <SettingsNotice tone="success">{actionSuccess}</SettingsNotice> : null}
            {actionWarning ? <SettingsNotice tone="warning">{actionWarning}</SettingsNotice> : null}
            {resetCreditsError ? <SettingsNotice tone="warning">{resetCreditsError}</SettingsNotice> : null}

            {loading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 text-xs text-[var(--settings-text-muted)]">
                    <RefreshCw size={13} className="animate-spin motion-reduce:animate-none" />
                    Checking reset credits…
                </div>
            ) : credits.length > 0 ? (
                <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--settings-border)]">
                    {credits.map((credit) => (
                        <div key={credit.id} className="flex min-h-12 items-center gap-3 border-b border-[var(--settings-row-divider)] px-3 py-2 last:border-b-0">
                            <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <p className="min-w-0 truncate text-[12px] font-medium text-[var(--settings-text)]">{credit.title}</p>
                                    {!credit.available ? (
                                        <SettingsStatusPill
                                            label={formatResetCreditStatus(credit)}
                                            tone={credit.status === 'expired' ? 'warning' : 'muted'}
                                        />
                                    ) : null}
                                </div>
                                <p className="mt-0.5 truncate text-[10px] leading-4 text-[var(--settings-text-muted)]">
                                    {formatResetCreditExpiry(credit.expiresAt)}
                                </p>
                            </div>
                            <SettingsButton
                                variant="outline"
                                className="!h-7 !px-2"
                                disabled={!credit.available}
                                onClick={() => onReview(credit)}
                            >
                                Review
                            </SettingsButton>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex min-h-24 flex-col items-center justify-center px-5 text-center">
                    <RotateCcw size={15} className="mb-1.5 text-[var(--settings-text-muted)]" />
                    <p className="text-[12px] font-medium text-[var(--settings-text)]">No reset credits</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-[var(--settings-text-muted)]">No banked resets are available.</p>
                </div>
            )}
        </div>
    )
}

function ResetApproval({
    credit,
    currentUsage,
    actionError
}: {
    credit: AssistantRateLimitResetCredit
    currentUsage: ReturnType<typeof buildRateLimitCards>
    actionError: string | null
}) {
    const resetLabel = credit.resetType
        ? `${credit.title} · ${humanize(credit.resetType)}`
        : credit.title

    return (
        <div className="space-y-3">
            <div className="flex gap-2.5 rounded-md border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2.5 text-amber-100">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p className="text-[11px] leading-4">
                    <span className="font-semibold">This spends one banked reset.</span> The action cannot be undone; availability is rechecked before use.
                </p>
            </div>

            {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
            {!credit.available ? (
                <SettingsNotice tone="warning">This credit is no longer available. Return to the list and refresh the account.</SettingsNotice>
            ) : null}

            <dl className="overflow-hidden rounded-md border border-[var(--settings-border)] text-xs">
                <ResetDetail label="Reset" value={resetLabel} />
                <ResetDetail label="Expiry" value={formatResetCreditExpiry(credit.expiresAt)} />
            </dl>

            {currentUsage.length > 0 ? (
                <section className="space-y-1.5">
                    <h3 className="text-[11px] font-medium text-[var(--settings-text-muted)]">Current usage windows</h3>
                    <div className="max-h-32 overflow-y-auto border-y border-[var(--settings-divider)]">
                        {currentUsage.map((card) => (
                            <div key={card.id} className="flex items-center justify-between gap-4 border-b border-[var(--settings-row-divider)] px-1 py-2 text-[11px] last:border-b-0">
                                <span className="min-w-0 truncate text-[var(--settings-text-secondary)]">{card.bucketLabel} · {card.durationLabel}</span>
                                <span className="shrink-0 tabular-nums text-[var(--settings-text)]">{card.percentLabel}</span>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    )
}

function ResetDetail({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,0.28fr)_minmax(0,0.72fr)] gap-3 border-b border-[var(--settings-row-divider)] px-3 py-2 last:border-b-0">
            <dt className="text-[var(--settings-text-muted)]">{label}</dt>
            <dd className="min-w-0 text-right font-medium text-[var(--settings-text)]">{value}</dd>
        </div>
    )
}

function formatResetCreditStatus(credit: AssistantRateLimitResetCredit): string {
    if (credit.available) return 'Available'
    if (credit.status === 'consumed' || credit.status === 'redeemed' || credit.status === 'used') return 'Used'
    if (credit.status === 'expired') return 'Expired'
    return capitalize(credit.status || 'Unavailable')
}

function formatResetCreditExpiry(value: string | null): string {
    if (!value) return 'Expiry unavailable'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Expiry unavailable'
    const dateLabel = date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    })
    const remaining = date.getTime() - Date.now()
    if (remaining <= 0) return `Expired ${dateLabel}`
    return `Expires ${dateLabel} · ${formatDuration(remaining)} left`
}

function formatDuration(milliseconds: number): string {
    const minutes = Math.max(0, Math.ceil(milliseconds / 60_000))
    const days = Math.floor(minutes / 1_440)
    const hours = Math.floor((minutes % 1_440) / 60)
    const remainingMinutes = minutes % 60
    if (days > 0) return `${days}d${hours ? ` ${hours}h` : ''}`
    if (hours > 0) return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}`
    return `${remainingMinutes}m`
}

function humanize(value: string): string {
    return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}
