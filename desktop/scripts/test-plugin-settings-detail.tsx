import assert from 'node:assert/strict'
import './fixtures/inline-overlay-ssr'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { makePluginDirectoryFixture } from './fixtures/plugin-directory-data'
import { AssistantPluginDetail, type AssistantPluginDetailProps } from '../src/renderer/src/pages/plugins/AssistantPluginDetail'

const catalog = makePluginDirectoryFixture()
const plugin = catalog.plugins[0]
const old = structuredClone(catalog.releases[0]); old.id = 'previous-release'; old.version = '0.9.0'; catalog.releases.push(old)
const noop = () => {}
const props: AssistantPluginDetailProps = { inline: true, catalog, plugin, projects: [], selectedSession: null, busy: false, onClose: noop, onUseInChat: noop, onToggleInstallation: noop, onToggleAppViews: noop, onToggleSet: noop, onRefreshChat: noop, onRollback: noop }
const render = () => renderToStaticMarkup(<MemoryRouter><AssistantPluginDetail {...props} /></MemoryRouter>)
let html = render()
assert.match(html, /plugin-settings-detail/, 'inline details use the Settings surface')
assert.match(html, /Installed plugins/)
assert.match(html, /Version 1\.0\.0/)
assert.match(html, /About Enabled/)
assert.match(html, /Turn on app views in Plugins first/)
assert.match(html, /aria-label="Allow app views from Review Helper"[^>]*disabled/)
assert.match(html, /<details[^>]*><summary[^>]*>[\s\S]*?Release details/)
assert.doesNotMatch(html, /<details[^>]*\bopen/, 'secondary release data starts collapsed')
assert.match(html, /Version 0\.9\.0/)
assert.match(html, /Use release/)
assert.doesNotMatch(html, /plugin-dialog/, 'inline details never acquire store dialog styling')
plugin.state = 'disabled'
html = render()
assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Use in Chat/, 'disabled plugins cannot start new chats')
plugin.state = 'quarantined'
html = render()
assert.match(html, /Quarantined/)
assert.doesNotMatch(html, /Keep Review Helper active/, 'quarantine cannot be overridden with an ordinary switch')
plugin.state = 'active'
props.inline = false
html = render()
assert.match(html, /plugin-dialog/, 'store modal keeps its original surface')
assert.doesNotMatch(html, /plugin-settings-detail/)
console.log('Plugin settings details: native rows, capability controls, disabled/quarantine states, release disclosure and store modal preservation: ok')
