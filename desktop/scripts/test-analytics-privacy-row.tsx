import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AnalyticsStatus } from '../src/shared/analytics/contracts'
import { AnalyticsPrivacyDetails, AnalyticsPrivacyRow } from '../src/renderer/src/pages/settings/AnalyticsPrivacyRow'
import { createSettingsRowTargetId } from '../src/renderer/src/pages/settings/settings-search'

const off: AnalyticsStatus = {
    requested: false, preferenceSet: true, enabled: false, configured: true,
    reason: 'disabled', hostCategory: 'approved', enabledSource: 'persisted',
    canChangeEnabled: true, queueSize: 0, catalogId: 'fixture'
}
const render = (status: AnalyticsStatus | null, error: string | null = null) => renderToStaticMarkup(
    <AnalyticsPrivacyRow status={status} error={error} onEnabledChange={() => { throw Error('Rendering cannot change consent') }} />
)
for (const status of [null, off, { ...off, requested: true, configured: false }, { ...off, requested: true, enabled: true }, { ...off, enabledSource: 'environment' as const, canChangeEnabled: false }]) {
    const html = render(status)
    const control = (html.match(/<button\b[^>]*>/g) || []).find(tag => tag.includes('role="switch"'))!
    assert.ok(control.includes(`aria-checked="${status?.requested === true}"`), 'the toggle reflects requested consent, not effective collection')
    assert.equal(control.includes('disabled=""'), !status || !status.canChangeEnabled, 'loading and environment locks are preserved')
    assert.ok(html.includes(status?.enabled ? 'Ready' : status?.requested ? 'Needs setup' : 'Off'))
    assert.ok(html.includes('aria-label="About product analytics"'), 'the compact row exposes an information button')
    assert.ok(html.includes(`data-settings-search-target="${createSettingsRowTargetId('Privacy', 'Share product analytics')}"`), 'a React title cannot break exact-setting search')
    assert.ok(!html.includes('stable random installation ID') && !html.includes('PostHog project key'), 'long disclosures do not expand the resting row')
}
const unavailable = { ...off, requested: true, configured: false }
assert.ok(render(unavailable).includes('Collection is off until analytics is configured.'))
assert.ok(render(off, 'Could not update analytics.').includes('Could not update analytics.'), 'response errors remain visible without opening a tooltip')
const details = renderToStaticMarkup(<AnalyticsPrivacyDetails status={{ ...unavailable, enabledSource: 'environment' }} />)
for (const text of ['coarse feature outcomes', 'performance timings', 'allowlisted diagnostic codes', 'stable random installation ID', 'pseudonymous events together across sessions', 'not derived from your account or device identity', '7 days', 'prompts, responses, files, paths, URLs, account identity, terminal content, or raw errors', 'Your environment controls this setting.', 'valid PostHog project key and approved HTTPS host']) assert.ok(details.includes(text), `preserve disclosure: ${text}`)
console.log('Analytics privacy row: compact disclosure, unchanged consent/status/locks, visible errors and exact search target: ok')
