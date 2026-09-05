import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { directoryMcpContributions, directorySkills, matchesDirectoryQuery, pluginDirectoryTab } from '../src/renderer/src/pages/plugins/plugin-contribution-directory'
import { McpList, PluginList, SkillList } from '../src/renderer/src/pages/plugins/PluginDirectoryLists'
import { makePluginDirectoryFixture, fixtureStandaloneSkills } from './fixtures/plugin-directory-data'
import { PluginStore } from '../src/renderer/src/pages/plugins/PluginStore'
import { PluginProductPage } from '../src/renderer/src/pages/plugins/PluginProductPage'
import storeCatalog from '../src/shared/plugins/openai-directory.json'
import descriptionOverrides from '../src/shared/plugins/plugin-description-overrides.json'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const catalog = makePluginDirectoryFixture()
const before = JSON.stringify(catalog)
const skills = directorySkills(catalog, fixtureStandaloneSkills)
assert.equal(skills.length, 9)
assert.equal(new Set(skills.map((skill) => skill.id)).size, 9)
assert.equal(skills.find((skill) => skill.name === 'test-manual-check')?.manualOnly, true)
assert.equal(skills.find((skill) => skill.pluginId === catalog.plugins[3].id)?.version, '1.0.0', 'disabled Plugin contents stay inspectable without claiming they are active')
const pinned = structuredClone(catalog.releases[0])
pinned.id = 'retained-release'
pinned.version = '0.9.0'
pinned.skills[0].name = 'old-skill'
catalog.releases.push(pinned)
assert.equal(directorySkills(catalog, []).some((skill) => skill.name === 'old-skill'), false, 'directory uses installation release, not every retained or pinned Chat release')
const duplicateName = { ...fixtureStandaloneSkills[0], name: 'review-helper' }
assert.equal(directorySkills(catalog, [duplicateName]).filter((skill) => skill.name === 'review-helper').length, 2, 'source and Plugin contributions remain distinct')
assert.equal(directorySkills(catalog, [{ ...duplicateName, pluginId: catalog.plugins[0].id }]).length, 6, 'do not duplicate Plugin provenance from prompt projections')
assert.deepEqual(directorySkills(null, []), [])
assert.deepEqual(directoryMcpContributions(null), [])
const mcps = directoryMcpContributions(catalog)
assert.equal(mcps.length, 2, 'count contribution packages, not unparsed servers')
assert.equal(pluginDirectoryTab('skills'), 'skills')
assert.equal(pluginDirectoryTab('mcps'), 'mcps')
assert.equal(pluginDirectoryTab('invalid'), 'plugins')
assert.equal(matchesDirectoryQuery('  DOCS ', 'Docs Toolkit'), true)
assert.equal(matchesDirectoryQuery('missing', 'Docs Toolkit'), false)
assert.equal(matchesDirectoryQuery(' ', undefined), true)
const mcpHtml = renderToStaticMarkup(<McpList contributions={mcps} onSelect={() => {}} />)
assert.ok(mcpHtml.includes('MCP connections are not available yet.'))
assert.ok(!mcpHtml.includes('role="switch"'), 'unavailable MCP execution has no live-looking toggle')
const listHtml = renderToStaticMarkup(<PluginList catalog={catalog} plugins={catalog.plugins} busy={false} onSelect={() => {}} onToggle={() => {}} />)
assert.equal((listHtml.match(/role="switch"/g) || []).length, 6)
assert.ok(listHtml.includes('aria-label="Open Review Helper"'))
assert.ok(!listHtml.includes('C:/fixture'), 'primary rows do not expose package paths')
const skillsHtml = renderToStaticMarkup(<SkillList skills={skills} onSelect={() => {}} />)
assert.ok(!skillsHtml.includes('role="switch"'), 'source-level settings must not become invented per-Skill enablement')
assert.ok(skillsHtml.includes('Open Skill test-code-review'))
catalog.releases.pop()
assert.equal(JSON.stringify(catalog), before, 'directory projections do not mutate the catalog')
const storeHtml = renderToStaticMarkup(<PluginStore canInstall={true} busy={false} installedCatalog={catalog} loading={false} onManage={() => {}} onSelectInstalled={() => {}} onUseInChat={() => {}} onOpenEntry={() => {}} onImportFolder={() => {}} />)
assert.ok(storeHtml.indexOf('Installed preview') < storeHtml.indexOf('aria-label="Developer Tools"'), 'Installed is the first store section')
assert.ok(storeHtml.includes('View all Plugins, Skills, and MCPs'))
assert.ok(storeHtml.includes('aria-label="About this catalog"'))
const logoTags = storeHtml.match(/<img\b[^>]*>/g) || []
assert.equal(logoTags.length, storeCatalog.entries.length, 'every catalog entry has its official logo')
assert.ok(logoTags.every(tag => !/src="https?:/.test(tag)), 'store logos use bundled assets, not remote image requests')
for (const name of ['adobe', 'lovable', 'consensus', 'higgsfield']) assert.ok(logoTags.some(tag => tag.includes(`/plugin-logos/${name}.`)), `${name} no longer falls back to a Plug icon`)
assert.ok(!storeHtml.includes('externally hosted entries'), 'catalog notes stay behind the info control')
assert.ok(!storeHtml.includes('Manage your Plugins, Skills, and MCP contributions.'), 'the store does not narrate its Installed section')
const emptyStoreHtml = renderToStaticMarkup(<PluginStore canInstall={true} busy={false} installedCatalog={{ ...catalog, plugins: [] }} loading={false} onManage={() => {}} onSelectInstalled={() => {}} onUseInChat={() => {}} onOpenEntry={() => {}} onImportFolder={() => {}} />)
const emptyInstalled = emptyStoreHtml.match(/<section class="plugin-store-installed"[\s\S]*?<\/section>/)?.[0] || ''
assert.ok(emptyInstalled.includes('None yet'))
assert.ok(emptyInstalled.includes('View all'))
assert.ok(!/<(?:p|ul)(?:\s|>)/.test(emptyInstalled), 'empty Installed uses one header row, not a padded content block')
assert.equal(new Set(storeCatalog.entries.map((entry) => entry.name)).size, storeCatalog.entries.length)
assert.ok(storeCatalog.entries.length > 0 && storeCatalog.entries.length <= 512)
assert.match(storeCatalog.commit, /^[a-f0-9]{40}$/)
for (const entry of storeCatalog.entries) {
    assert.ok(entry.sourceUrl.startsWith(`https://github.com/openai/plugins/tree/${storeCatalog.commit}/plugins/`))
    if (entry.iconUrl) assert.ok(entry.iconUrl.startsWith(`https://raw.githubusercontent.com/openai/plugins/${storeCatalog.commit}/plugins/`))
}
const detailHtml = renderToStaticMarkup(<PluginProductPage entry={storeCatalog.entries.find(e => e.name === 'vercel')!} installation={null} catalog={null} canInstall busy={false} onBack={() => {}} onInstall={() => {}} onUseInChat={() => {}} onManage={() => {}} />)
assert.ok(detailHtml.includes('aria-label="Breadcrumb"'))
assert.match(detailHtml, /<img[^>]*loading="eager"/, 'a product page loads its main logo immediately, including when opened in the background')
assert.ok(detailHtml.includes('Included'))
assert.ok(detailHtml.includes('Not supported yet'))
assert.ok(detailHtml.includes('>Install</button>'))
assert.ok(!detailHtml.includes('<dialog') && !detailHtml.includes('Choose downloaded folder'))
for (const entryName of ['canva', 'adobe'] as const) {
    const entry = storeCatalog.entries.find(entry => entry.name === entryName)!
    assert.equal(entry.longDescriptionSource, 'zyra')
    assert.equal(entry.longDescription, descriptionOverrides[entryName].longDescription)
    const summaryHtml = renderToStaticMarkup(<PluginProductPage entry={entry} installation={null} catalog={null} canInstall busy={false} onBack={() => {}} onInstall={() => {}} onUseInChat={() => {}} onManage={() => {}} />)
    assert.ok(summaryHtml.includes('Zyra summary'))
    assert.ok(!summaryHtml.includes('Publisher description'), 'Zyra-written copy is never attributed to the publisher')
    assert.ok(summaryHtml.includes('are not available through Zyra'))
}
assert.ok(detailHtml.includes('Publisher description'), 'unchanged vendor text retains its attribution')
const installedDetail = renderToStaticMarkup(<PluginProductPage entry={null} installation={catalog.plugins[0]} catalog={catalog} canInstall busy={false} onBack={() => {}} onInstall={() => {}} onUseInChat={() => {}} onManage={() => {}} />)
assert.ok(installedDetail.includes('Use in Chat'))
assert.ok(installedDetail.includes('review-helper'))
assert.ok(!installedDetail.includes('>Install</button>'))
const source = (path: string) => readFileSync(join(import.meta.dir, '../src/renderer/src', path), 'utf8')
const railSource = source('pages/assistant/AssistantChatSessionsRail.tsx')
const header = railSource.slice(railSource.indexOf('const baseSidebarActions'), railSource.indexOf('return (', railSource.indexOf('const baseSidebarActions')))
assert.ok(header.includes('aria-label="Search chats"'))
assert.ok(header.includes('label="Plugins"'))
assert.ok(!header.includes('label="Search"'), 'Search is an icon in the New Chat row')
assert.ok(!railSource.slice(railSource.indexOf('mt-auto shrink-0 space-y-0.5 border-t')).includes("navigate('/plugins')"), 'Plugins is not in the footer')
assert.ok(source('pages/assistant/AssistantWorkspaceLayout.tsx').includes('<ConnectedAssistantSessionsRail'), 'Chat and Plugins share one persistent connected sidebar')
assert.ok(source('pages/plugins/PluginsPage.tsx').includes("params.get('view') !== 'manage'"), 'the store is the default destination')
assert.ok(source('pages/plugins/PluginsPage.css').includes('scrollbar-gutter: stable both-edges'))
assert.match(source('pages/plugins/PluginsPage.tsx'), /aria-label="Browse store" title="Browse store"><Store size=/, 'store navigation is a labeled icon button')
const storeSource = source('pages/plugins/PluginStore.tsx')
assert.ok(storeSource.includes('Each release requires review; installation runs no code.'))
assert.ok(!storeSource.includes('Choose downloaded folder'))
assert.ok(!storeHtml.includes('Add from folder'))
assert.ok(!storeSource.includes('Download the package from its source, then choose its folder'))
assert.ok(storeSource.includes('Unavailable in Zyra'), 'unsupported contribution status remains visible in details')
assert.ok(source('pages/plugins/AssistantPluginInstallDialog.tsx').includes('Installation does not change Project availability or add Plugins to existing Chats.'))
console.log('Assistant unified Plugin directory, store, navigation, Skill provenance, MCP honesty, and row contracts: ok')
