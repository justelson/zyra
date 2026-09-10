import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readSettingsPageSections, sameSettingsPageSections } from '../src/renderer/src/pages/settings/settings-page-sections'

type FixtureSection = { id: string; label?: string; ariaLabel?: string; hidden?: boolean; outsideHidden?: boolean }
function root(sections: FixtureSection[]): ParentNode & Node {
    return { contains: (node: { outside?: boolean }) => !node.outside, querySelectorAll: (selector: string) => {
        assert.equal(selector, 'section[data-settings-search-target]')
        return sections.map(section => ({
            getAttribute: (name: string) => name === 'data-settings-search-target' ? section.id : name === 'aria-label' ? section.ariaLabel || null : null,
            querySelector: (selector: string) => { assert.equal(selector, 'h2'); return section.label == null ? null : { textContent: section.label } },
            closest: (selector: string) => { assert.equal(selector, '[hidden], [aria-hidden="true"], [inert]'); return section.hidden ? {} : section.outsideHidden ? { outside: true } : null }
        }))
    } } as unknown as ParentNode & Node
}
const source = root([
    { id: 'settings-section-privacy', label: ' Privacy ' },
    { id: 'settings-row-not-a-section', label: 'Not a section' },
    { id: 'settings-section-hidden', label: 'Unavailable', hidden: true },
    { id: 'settings-section-empty', label: '  ' },
    { id: 'settings-section-privacy', label: 'Duplicate' },
    { id: 'settings-section-maintenance', ariaLabel: 'Maintenance' }
])
const expected = [{ id: 'settings-section-privacy', label: 'Privacy' }, { id: 'settings-section-maintenance', label: 'Maintenance' }]
assert.deepEqual(readSettingsPageSections(source), expected, 'navigation uses only real, visible, named sections in document order')
assert.deepEqual(readSettingsPageSections(root([])), [], 'loading/empty pages have no fake navigation')
assert.deepEqual(readSettingsPageSections(root([{ id: 'settings-section-dialog-background', label: 'Kept', outsideHidden: true }])), [{ id: 'settings-section-dialog-background', label: 'Kept' }], 'a modal hiding an outer app container must not erase this page navigation')
assert.equal(sameSettingsPageSections(expected, expected.map(item => ({ ...item }))), true, 'unchanged sections do not churn React state')
assert.equal(sameSettingsPageSections(expected, [...expected].reverse()), false)
assert.equal(sameSettingsPageSections(expected, [{ ...expected[0], label: 'Renamed' }, expected[1]]), false)
const component = readFileSync(new URL('../src/renderer/src/pages/settings/SettingsSectionNavigation.tsx', import.meta.url), 'utf8')
assert.match(component, /observer\.disconnect\(\)/)
assert.match(component, /window\.cancelAnimationFrame\(frame\)/)
assert.doesNotMatch(component, /setInterval|\.devscope|fetch\(/, 'section navigation cannot poll or request settings data')
assert.match(component, /search\.set\('setting', section\.id\)/, 'section jumps use the existing exact-target routing')
console.log('Settings page sections: live ownership, hidden/duplicate filtering, order, stable updates, deep links and cleanup: ok')
