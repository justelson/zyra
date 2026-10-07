import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { makePluginDirectoryFixture } from './fixtures/plugin-directory-data'

const catalog = makePluginDirectoryFixture()
let desktopHost = true
const directory = {
    catalog: { ...catalog, plugins: [] } as typeof catalog | null,
    busy: false,
    loading: false,
    error: null as string | null,
    notice: null as string | null,
    projects: [],
    updateAppViewSettings: async () => {},
    updatePluginState: async () => {},
}
mock.module('../src/renderer/src/lib/browser-file-url', () => ({ isElectronRendererRuntime: () => desktopHost }))
mock.module('../src/renderer/src/lib/assistant/store', () => ({ useAssistantStoreSelector: () => null }))
mock.module('../src/renderer/src/pages/plugins/usePluginDirectory', () => ({ usePluginDirectory: () => directory }))
mock.module('../src/renderer/src/pages/plugins/AssistantPluginDetail', () => ({ AssistantPluginDetail: () => <div>Plugin detail</div> }))
const { default: PluginsSettings } = await import('../src/renderer/src/pages/settings/PluginsSettings')
const render = (route = '/settings/assistant/plugins') => renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><PluginsSettings /></MemoryRouter>)

catalog.appViews.enabled = false
let html = render()
assert.match(html, /zyra-settings-row/, 'app views uses the shared settings row')
assert.match(html, /<h3[^>]*text-\[13px\][^>]*>Show app views in Chat<\/h3>/, 'labels use the settings typography')
assert.match(html, /<p[^>]*text-\[var\(--settings-text-secondary\)\][^>]*>Interactive views/, 'helper copy uses settings colors without plugin wrapper variables')
assert.match(html, /role="switch"[^>]*aria-checked="false"/)
assert.doesNotMatch(html, /Open app views/)
assert.match(html, /No plugins installed\./)
assert.equal((html.match(/Browse store<\/button>/g) || []).length, 1, 'one labeled browse action serves empty and populated states')
assert.match(html, /<button[^>]*border-\[var\(--settings-border\)\][^>]*>[\s\S]*?Browse store<\/button>/, 'browse uses the shared settings button')
assert.doesNotMatch(html, /class="plugin-(?:detail-row|button|icon-button|help)/, 'store styles do not leak into settings controls or empty states')
assert.ok(html.indexOf('Installed plugins') < html.indexOf('Show app views in Chat'), 'installed plugins are the primary workflow')

catalog.appViews.enabled = true
catalog.appViews.displayMode = 'automatic'
directory.busy = true
html = render()
assert.match(html, /aria-label="Open app views"/)
assert.match(html, /<option value="automatic" selected="">Automatically<\/option>/)
assert.match(html, /role="switch"[^>]*disabled=""/)
assert.match(html, /<select[^>]*disabled=""/)

directory.busy = false
directory.catalog = catalog
html = render()
assert.match(html, /aria-label="Installed Plugins"/)
assert.match(html, /aria-label="Open Review Helper"/)
assert.match(html, /aria-label="Keep Review Helper active"/)
assert.match(html, /aria-label="Search installed plugins"/)
assert.match(html, /plugin-settings-version/)
assert.doesNotMatch(html, /No plugins installed\./)
assert.equal((html.match(/Browse store<\/button>/g) || []).length, 1)
assert.match(render('/settings/assistant/plugins?plugin=missing'), /role="alert"[^>]*>That plugin is no longer installed\./)
assert.match(render(`/settings/assistant/plugins?plugin=${catalog.plugins[0].id}`), /Plugin detail/)

directory.catalog = null
directory.loading = true
assert.match(render(), /role="status"[^>]*>Loading plugins/)
desktopHost = false
assert.match(render(), /Manage plugins in Zyra Desktop\./)
desktopHost = true
directory.loading = false
directory.error = 'Fixture error'
assert.match(render(), /role="alert"[\s\S]*Fixture error/)
directory.error = null
directory.notice = 'Fixture notice'
assert.match(render(), /role="status"[\s\S]*Fixture notice/)
console.log('Plugins settings: shared rows, colors and browse action; app-view, installed, loading and error states: ok')
