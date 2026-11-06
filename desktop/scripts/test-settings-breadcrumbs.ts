import assert from 'node:assert/strict'
import { findSettingsDestination } from '../src/renderer/src/pages/settings/settings-navigation'
import { getSettingsLocationTrail } from '../src/renderer/src/pages/settings/settings-navigation-context'
import { SETTINGS_PAGE_VIEWS } from '../src/renderer/src/pages/settings/settings-page-views'
import { createSettingsRowTargetId, resolveSettingsSearchLocation } from '../src/renderer/src/pages/settings/settings-search'

for (const views of Object.values(SETTINGS_PAGE_VIEWS)) {
    const first = views[0]!
    const page = findSettingsDestination(first.to)
    assert.ok(page, `Missing settings destination for ${first.to}`)
    assert.deepEqual(getSettingsLocationTrail(first.to), ['Settings', page.label, first.label], `First tab breadcrumb: ${first.to}`)
    for (const view of views.slice(1)) {
        assert.deepEqual(getSettingsLocationTrail(view.to), ['Settings', page.label, view.label], `Tab breadcrumb: ${view.to}`)
    }
}

assert.deepEqual(getSettingsLocationTrail('/settings/app/general'), ['Settings', 'Startup & setup'])
assert.deepEqual(getSettingsLocationTrail('/settings/app/appearance/colors'), ['Settings', 'Appearance', 'Customize colors'])
assert.deepEqual(getSettingsLocationTrail('/settings/assistant/skills/conflicts'), ['Settings', 'Skills', 'Skill name conflicts'])
assert.deepEqual(getSettingsLocationTrail('/settings/assistant/archived'), ['Settings', 'Archived chats'])
assert.deepEqual(getSettingsLocationTrail('/settings/data/diagnostics/response-timings'), ['Settings', 'Diagnostics', 'Response timings'])
assert.equal(findSettingsDestination('/settings/data/diagnostics/response-timings')?.parentId, 'diagnostics')
assert.equal(resolveSettingsSearchLocation('response-timings', createSettingsRowTargetId('Summary', 'Turn history'))?.pathname, '/settings/data/diagnostics/response-timings')
console.log('Settings tab breadcrumbs: ok')
