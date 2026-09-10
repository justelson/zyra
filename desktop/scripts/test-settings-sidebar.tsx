import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SettingsSidebarNavigation } from '../src/renderer/src/pages/settings/SettingsSidebarNavigation'
import { SETTINGS_DESTINATIONS, SETTINGS_NAVIGATION_ITEMS, getSettingsCategoryDestinations, getSettingsCategoryEntry } from '../src/renderer/src/pages/settings/settings-navigation'

const render = (route: string, hidden = false) => renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}><SettingsSidebarNavigation hidden={hidden} preloadRoute={() => { throw Error('Rendering must not preload page modules') }} /></MemoryRouter>
)
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) || []
const appSource = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
assert.deepEqual(SETTINGS_NAVIGATION_ITEMS.map(item => item.id), ['app', 'assistant', 'workspace', 'account', 'data'])
assert.deepEqual(getSettingsCategoryDestinations('assistant').map(item => item.id), ['assistant', 'skills', 'voice', 'memory', 'archived'])
assert.deepEqual(getSettingsCategoryDestinations('workspace').map(item => item.id), ['projects', 'files-editor', 'terminal-runtime', 'source-control', 'browser-control'])
assert.deepEqual(getSettingsCategoryDestinations('data').map(item => item.id), ['privacy', 'diagnostics', 'about'])
assert.equal(getSettingsCategoryEntry('workspace').id, 'projects')
const groupedIds = SETTINGS_NAVIGATION_ITEMS.flatMap(item => getSettingsCategoryDestinations(item.id).map(page => page.id))
assert.equal(new Set(groupedIds).size, SETTINGS_DESTINATIONS.length)
assert.equal(groupedIds.length, SETTINGS_DESTINATIONS.length, 'each destination belongs to exactly one visible group')
for (const destination of SETTINGS_DESTINATIONS) {
    assert.ok(appSource.includes(`<Route path="${destination.to.slice('/settings/'.length)}" element={<`), 'each page remains wired to its real route')
    for (const route of [destination.to, ...(destination.legacyPaths || [])]) {
        const html = render(route)
        const active = anchors(html).filter(tag => tag.includes('aria-current="page"'))
        assert.equal(active.length, 1, 'canonical and legacy links identify exactly one current page')
        assert.ok(active[0].includes(`href="${destination.to}"`))
        assert.equal(anchors(html).length, SETTINGS_DESTINATIONS.length, 'all pages are available without expanding a category')
        assert.ok(!html.includes('<button') && !html.includes('aria-expanded'), 'group headings cannot add a hidden navigation step')
        for (const page of SETTINGS_DESTINATIONS) assert.equal(anchors(html).filter(tag => tag.includes(`href="${page.to}"`)).length, 1)
    }
}
for (const category of SETTINGS_NAVIGATION_ITEMS) {
    assert.ok(appSource.includes(`<Route path="${category.id}" element={<SettingsCategoryRedirect categoryId="${category.id}" />}`), 'legacy category URLs redirect to a useful entry page')
}
assert.ok(render('/settings/app/general', true).startsWith('<div hidden=""'), 'search can hide and restore the same navigation component')
const styles = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
assert.match(styles, /\.settings-sidebar-scrollbar,\s*\.settings-content-scrollbar\s*\{\s*scrollbar-gutter: stable;/)
console.log('Settings sidebar: 18 one-click destinations, five purposeful groups, current/legacy routes, category redirects and stable scroll space: ok')
