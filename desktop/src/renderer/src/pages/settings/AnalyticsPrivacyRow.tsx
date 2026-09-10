import type { AnalyticsStatus } from '@shared/analytics/contracts'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'
import { SettingsNotice, SettingsRow, SettingsSwitch } from './settings-layout'
import { createSettingsRowTargetId } from './settings-search'

export function AnalyticsPrivacyDetails({ status }: { status: AnalyticsStatus | null }) {
    return <div className="space-y-2">
        <p>Send coarse feature outcomes, performance timings, and allowlisted diagnostic codes tied to a stable random installation ID that keeps pseudonymous events together across sessions and is not derived from your account or device identity.</p>
        <p>Unsent events expire from the local queue after 7 days. Zyra never includes prompts, responses, files, paths, URLs, account identity, terminal content, or raw errors.</p>
        {status?.enabledSource === 'environment' ? <p>Your environment controls this setting.</p> : null}
        {status?.requested && !status.enabled ? <p className="text-[var(--status-warning)]">Analytics will stay off until this device has a valid PostHog project key and approved HTTPS host.</p> : null}
    </div>
}

export function AnalyticsPrivacyRow({ status, error, onEnabledChange }: {
    status: AnalyticsStatus | null
    error: string | null
    onEnabledChange: (enabled: boolean) => void
}) {
    return <>
        <SettingsRow
            title={<span className="inline-flex items-center gap-1">Share product analytics
                <SettingsInfoTooltip label="About product analytics"><AnalyticsPrivacyDetails status={status} /></SettingsInfoTooltip>
            </span>}
            searchTargetId={createSettingsRowTargetId('Privacy', 'Share product analytics')}
            description={status?.requested && !status.enabled
                ? 'Collection is off until analytics is configured.'
                : status?.enabledSource === 'environment'
                    ? 'Your environment controls this setting.'
                    : 'Optional usage and performance reports.'}
            status={status?.enabled ? 'Ready' : status?.requested ? 'Needs setup' : 'Off'}
            statusTone={status?.enabled ? 'ready' : status?.requested ? 'warning' : 'muted'}
            control={<SettingsSwitch
                checked={status?.requested === true}
                disabled={!status || !status.canChangeEnabled}
                onCheckedChange={onEnabledChange}
                label="Share product analytics"
            />}
        />
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
    </>
}
