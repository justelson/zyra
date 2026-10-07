import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SETTINGS_PAGE_VIEWS, type SettingsPageFamily } from '../src/renderer/src/pages/settings/settings-page-views'
import { SETTINGS_DESTINATIONS, SETTINGS_NAVIGATION_ITEMS, findSettingsDestination, getSettingsCategoryDestinations } from '../src/renderer/src/pages/settings/settings-navigation'
import { SETTINGS_SEARCH_TARGETS, createSettingsRowTargetId, resolveSettingsSearchLocation } from '../src/renderer/src/pages/settings/settings-search'
import { SettingsPageTabs } from '../src/renderer/src/pages/settings/SettingsPageTabs'
import { AppearanceAccentPicker } from '../src/renderer/src/pages/settings/appearance/AppearanceAccentPicker'
import { ACCENT_COLORS } from '../src/renderer/src/lib/settings'
import { SettingsSidebarNavigation } from '../src/renderer/src/pages/settings/SettingsSidebarNavigation'

const source = (name: string) => readFileSync(new URL(`../src/renderer/src/${name}`, import.meta.url), 'utf8')
const app = source('App.tsx')
const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map(match => `/settings/${match[1]}`))
const primary = SETTINGS_NAVIGATION_ITEMS.flatMap(group => getSettingsCategoryDestinations(group.id))
assert.equal(primary.length, 19, 'Archived chats and Plugins are standalone destinations while provider views and usage remain nested')
assert.deepEqual(getSettingsCategoryDestinations('assistant').map(page => page.label), ['Chats', 'Archived chats', 'Providers', 'Plugins', 'Skills', 'Voice', 'Context & memory'])
assert.deepEqual(getSettingsCategoryDestinations('account').map(page => page.label), ['Devices'])
assert.ok(primary.every(page => !/OpenAI|AI providers/.test(page.label)))
for (const page of SETTINGS_DESTINATIONS) {
    assert.equal(findSettingsDestination(page.to)?.id, page.id, 'the most specific inner route wins over its parent')
    assert.ok(routes.has(page.to), `${page.id} has a real route`)
    assert.ok(SETTINGS_SEARCH_TARGETS[page.id]?.length, `${page.id} has searchable controls`)
    assert.equal(new Set(SETTINGS_SEARCH_TARGETS[page.id].map(target => target.targetId)).size, SETTINGS_SEARCH_TARGETS[page.id].length)
    const markup = renderToStaticMarkup(<MemoryRouter initialEntries={[page.to]}><SettingsSidebarNavigation preloadRoute={() => {}} /></MemoryRouter>)
    assert.equal((markup.match(/aria-current="page"/g) || []).length, 1, `${page.id} highlights exactly one sidebar parent`)
    const parent = SETTINGS_DESTINATIONS.find(value => value.id === (page.parentId || page.id))!
    const activeTag = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0] || ''
    assert.ok(activeTag.includes(`href="${parent.to}"`), `${page.id} highlights ${parent.id}`)
    for (const target of SETTINGS_SEARCH_TARGETS[page.id]) assert.equal(resolveSettingsSearchLocation(page.id, target.targetId)?.pathname, page.to, `${page.id}: ${target.label} stays on its owning view`)
}
for (const [family, views] of Object.entries(SETTINGS_PAGE_VIEWS)) for (const view of views) {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[view.to]}><SettingsPageTabs family={family as SettingsPageFamily} /></MemoryRouter>)
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1, `${family}/${view.id} has one current inner view`)
}
for (const [oldPage, section, label, destination] of [
    ['general', 'Interface', 'Chat rail', '/settings/app/appearance/layout'],
    ['assistant', 'Assistant defaults', 'Model', '/settings/providers/models'],
    ['assistant', 'Assistant defaults', 'Permission mode', '/settings/assistant/chat-defaults'],
    ['assistant', 'Output and history', 'Canonical diagnostics', '/settings/data/diagnostics'],
    ['assistant', 'Reasoning and context', 'Context limit', '/settings/assistant/memory'],
    ['appearance', 'Theme', 'UI font', '/settings/app/appearance/typography'],
    ['appearance', 'Theme', 'Accent primary', '/settings/app/appearance/colors'],
    ['about', 'Terminal', 'zyra command', '/settings/workspace/terminal'],
    ['account', 'OpenAI connections', 'ChatGPT subscription', '/settings/providers']
]) assert.equal(resolveSettingsSearchLocation(oldPage, createSettingsRowTargetId(section, label))?.pathname, destination)

assert.deepEqual(SETTINGS_PAGE_VIEWS.files.map(view => view.label), ['Preview', 'Editor'])
assert.equal(resolveSettingsSearchLocation('files-editor', createSettingsRowTargetId('File preview', 'Python run target')), null)
assert.equal(resolveSettingsSearchLocation('terminal-runtime', createSettingsRowTargetId('Terminal', 'Preview panel height')), null)
assert.match(app, /path="workspace\/files\/run" element=\{<Navigate to="\/settings\/workspace\/files" replace \/>\}/)

const accents = renderToStaticMarkup(<AppearanceAccentPicker value={ACCENT_COLORS[0]} background="#000000" onChange={() => {}} />)
assert.equal((accents.match(/type="radio"/g) || []).length, ACCENT_COLORS.length, 'accent choices use native keyboard-operable radios')
assert.equal((accents.match(/checked=""/g) || []).length, 1)
assert.match(source('pages/settings/AppearanceSettings.tsx'), /useAppearanceSettingsController\(view === 'typography'\)/, 'theme and layout views do not fetch font-management data')
assert.match(source('pages/settings/MemorySettings.tsx'), /overview\.memoryDirectory[\s\S]*overview\.sessionsDirectory[\s\S]*overview\.cliPath/, 'the real memory locations remain available in Inspect')
const controller = source('pages/settings/providers/useOpenAIAccountSettings.ts')
assert.match(controller, /if \(!usageActive\) return\s+const polling = startAccountOverviewPolling/)
assert.match(controller, /if \(desktopHost && connectionsActive\) void loadConnectionState/)
assert.match(controller, /polling\.dispose\(\)/)
assert.match(source('pages/settings/AccountSettings.tsx'), /useOpenAIAccountSettings\(\{ usageActive: true \}\)/)
assert.match(source('pages/settings/providers/ProviderConnections.tsx'), /useOpenAIAccountSettings\(\{ connectionsActive: true \}\)/)
assert.doesNotMatch(source('pages/settings/ModelProviderConnections.tsx'), /<AgentRoleModels/)
assert.match(source('pages/settings/SettingsShell.tsx'), /details\.open = true/, 'search reveals collapsed details before focusing a control')
console.log('Settings views: 19 primary pages, routed inner views, parent selection, migrated search, scoped provider reads and writing-provider boundaries: ok')
