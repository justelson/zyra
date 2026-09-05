import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  ZYRA_PLUGIN_LIMITS,
  ZyraPluginValidationError,
  normalizeZyraPluginManifest,
  parseZyraPluginMarketplaceText,
} from '../src/plugins/plugin-contract.mjs'
import {
  inspectZyraPluginPackage,
  readZyraPluginMarketplace,
} from '../src/plugins/plugin-package.mjs'
import { ZyraPluginRegistry } from '../src/plugins/plugin-registry.mjs'
import {
  createEmptyZyraPluginState,
  normalizeZyraPluginState,
} from '../src/plugins/plugin-state.mjs'

const fixture = await mkdtemp(path.join(os.tmpdir(), 'zyra-plugin-system-'))
const marketplaceRoot = path.join(fixture, 'marketplace')
const pluginRoot = path.join(marketplaceRoot, 'plugins', 'release-helper')
const devRoot = path.join(fixture, 'Zyra-dev', 'assistant', 'plugins')
const prodRoot = path.join(fixture, 'Zyra', 'assistant', 'plugins')
const executionMarker = path.join(fixture, 'plugin-script-ran.txt')
let tick = 0
const now = () => new Date(Date.UTC(2026, 8, 4, 12, 0, tick++))

async function writePlugin(options = {}) {
  const version = options.version || '1.0.0'
  const skillBody = options.skillBody || 'Inspect the release and report a bounded result.'
  await mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true })
  await mkdir(path.join(pluginRoot, 'skills', 'release-check', 'scripts'), { recursive: true })
  await mkdir(path.join(pluginRoot, 'assets'), { recursive: true })
  await writeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), `${JSON.stringify({
    name: 'release-helper',
    version,
    description: 'Inspect and verify a software release.',
    author: { name: 'Fixture Publisher', url: 'https://example.com/publisher' },
    homepage: 'https://example.com/release-helper',
    repository: 'https://example.com/release-helper/source',
    license: 'MIT',
    keywords: ['release', 'verification'],
    skills: options.skillsPath || './skills/',
    mcpServers: './.mcp.json',
    apps: './.app.json',
    interface: {
      displayName: 'Release Helper',
      shortDescription: 'Inspect a release before publication',
      longDescription: 'Checks release metadata and produces a bounded verification report.',
      developerName: 'Fixture Publisher',
      category: 'Developer Tools',
      capabilities: ['Interactive', 'Read'],
      websiteURL: 'https://example.com/release-helper',
      privacyPolicyURL: 'https://example.com/privacy',
      termsOfServiceURL: 'https://example.com/terms',
      defaultPrompt: ['Check this release.'],
      composerIcon: './assets/icon.svg',
      logo: './assets/icon.svg',
      brandColor: '#0EA5E9',
    },
  }, null, 2)}\n`)
  await writeFile(path.join(pluginRoot, '.mcp.json'), '{}\n')
  await writeFile(path.join(pluginRoot, '.app.json'), '{}\n')
  await writeFile(path.join(pluginRoot, 'skills', 'release-check', 'SKILL.md'), [
    '---',
    'name: release-check',
    'description: Inspect and verify a software release before publication.',
    '---',
    '',
    '# Release check',
    '',
    skillBody,
  ].join('\n'))
  await writeFile(path.join(pluginRoot, 'skills', 'release-check', 'scripts', 'must-not-run.js'), `await import('node:fs/promises').then(fs => fs.writeFile(${JSON.stringify(executionMarker)}, 'ran'))\n`)
  await writeFile(path.join(pluginRoot, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>\n')
}

async function writeMarketplace() {
  await mkdir(path.join(marketplaceRoot, '.agents', 'plugins'), { recursive: true })
  await writeFile(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify({
    name: 'fixture-marketplace',
    interface: { displayName: 'Fixture marketplace' },
    plugins: [{
      name: 'release-helper',
      source: { source: 'local', path: './plugins/release-helper' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
      category: 'Developer Tools',
    }],
  }, null, 2)}\n`)
}

async function expectPluginError(work, code) {
  await assert.rejects(work, (error) => {
    assert.ok(error instanceof ZyraPluginValidationError)
    assert.equal(error.code, code)
    return true
  })
}

function emptyChatScope(index) {
  const sessionId = `capacity-chat-${String(index).padStart(4, '0')}`
  return {
    sessionId,
    ownerKind: 'global',
    ownerId: 'global',
    pluginSetRevision: 1,
    scopeRevision: 1,
    plugins: [],
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
  }
}

try {
  await writePlugin()
  await writeMarketplace()

  const manifest = normalizeZyraPluginManifest(JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8')))
  assert.equal(manifest.format, 'openai-codex-plugin-v1')
  assert.equal(manifest.name, 'release-helper')
  assert.equal(manifest.interface.brandColor, '#0ea5e9')
  assert.deepEqual(manifest.declaredCapabilityCeiling, ['interactive', 'read'])
  assert.equal(manifest.contributions.mcp, './.mcp.json', 'OpenAI mcpServers declarations normalize to Zyra MCP contributions')

  assert.throws(() => normalizeZyraPluginState({ version: 2 }, { installationRoot: devRoot }), (error) => (
    error instanceof ZyraPluginValidationError && error.code === 'PLUGIN_STATE_NEWER'
  ))
  const oversizedScopeState = createEmptyZyraPluginState()
  oversizedScopeState.chatScopes = Array.from({ length: ZYRA_PLUGIN_LIMITS.maxChatScopes + 1 }, (_, index) => emptyChatScope(index))
  assert.throws(() => normalizeZyraPluginState(oversizedScopeState, { installationRoot: devRoot }), (error) => (
    error instanceof ZyraPluginValidationError && error.code === 'PLUGIN_SCOPE_LIMIT'
  ), 'oversized persisted scope state fails closed instead of dropping pinned Chats')
  for (const [field, limit, code] of [
    ['sources', ZYRA_PLUGIN_LIMITS.maxPlugins, 'PLUGIN_SOURCE_LIMIT'],
    ['plugins', ZYRA_PLUGIN_LIMITS.maxPlugins, 'PLUGIN_INSTALLATION_LIMIT'],
    ['releases', ZYRA_PLUGIN_LIMITS.maxPlugins * ZYRA_PLUGIN_LIMITS.maxReleasesPerPlugin, 'PLUGIN_RELEASE_LIMIT'],
    ['pluginSets', ZYRA_PLUGIN_LIMITS.maxPluginSets, 'PLUGIN_SET_LIMIT'],
  ]) {
    const oversizedState = createEmptyZyraPluginState()
    oversizedState[field] = Array.from({ length: limit + 1 }, () => ({}))
    assert.throws(() => normalizeZyraPluginState(oversizedState, { installationRoot: devRoot }), (error) => (
      error instanceof ZyraPluginValidationError && error.code === code
    ), `${field} capacity fails closed instead of truncating persisted state`)
  }
  assert.throws(() => normalizeZyraPluginManifest({
    name: 'bad-plugin',
    version: '1.0.0',
    description: 'Bad path.',
    skills: '../outside',
  }), (error) => error instanceof ZyraPluginValidationError && error.code === 'PLUGIN_PATH_INVALID')
  assert.throws(() => normalizeZyraPluginManifest({
    name: 'bad-plugin',
    version: 'latest',
    description: 'Bad version.',
    skills: './skills',
  }), (error) => error instanceof ZyraPluginValidationError && error.code === 'PLUGIN_MANIFEST_INVALID')
  assert.throws(() => parseZyraPluginMarketplaceText(JSON.stringify({
    name: 'duplicate-marketplace',
    plugins: [
      { name: 'same-plugin', source: { source: 'local', path: './one' } },
      { name: 'same-plugin', source: { source: 'local', path: './two' } },
    ],
  })), (error) => error instanceof ZyraPluginValidationError && error.code === 'PLUGIN_MARKETPLACE_DUPLICATE')

  const marketplace = await readZyraPluginMarketplace(marketplaceRoot, { sourceId: 'fixture-source' })
  assert.equal(marketplace.displayName, 'Fixture marketplace')
  assert.equal(marketplace.plugins[0]?.packageRoot, pluginRoot)

  const firstInspection = await inspectZyraPluginPackage(pluginRoot, { expectedName: 'release-helper' })
  const repeatedInspection = await inspectZyraPluginPackage(pluginRoot, { expectedName: 'release-helper' })
  assert.equal(firstInspection.release.contentDigest, repeatedInspection.release.contentDigest, 'unchanged Plugin bytes have a deterministic digest')
  assert.equal(firstInspection.release.skills[0]?.name, 'release-check')
  assert.equal(firstInspection.release.contributions.find((entry) => entry.kind === 'mcp')?.support, 'planned')
  assert.equal(firstInspection.release.contributions.find((entry) => entry.kind === 'apps')?.support, 'planned')
  assert.equal(firstInspection.release.containsExecutableFiles, true, 'bundled helper scripts are visible in install review')
  assert.equal(existsSync(executionMarker), false, 'inspection never executes bundled scripts')

  const duplicateRoot = path.join(fixture, 'duplicate-skills')
  await mkdir(path.join(duplicateRoot, '.codex-plugin'), { recursive: true })
  await mkdir(path.join(duplicateRoot, 'skills', 'one'), { recursive: true })
  await mkdir(path.join(duplicateRoot, 'skills', 'two'), { recursive: true })
  await writeFile(path.join(duplicateRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'duplicate-skills', version: '1.0.0', description: 'Duplicate fixture.', skills: './skills' }))
  const duplicateSkill = '---\nname: duplicate\ndescription: Duplicate fixture Skill.\n---\n'
  await writeFile(path.join(duplicateRoot, 'skills', 'one', 'SKILL.md'), duplicateSkill)
  await writeFile(path.join(duplicateRoot, 'skills', 'two', 'SKILL.md'), duplicateSkill)
  await expectPluginError(() => inspectZyraPluginPackage(duplicateRoot), 'PLUGIN_SKILL_DUPLICATE')

  const linkedRoot = path.join(fixture, 'linked-package')
  await mkdir(path.join(linkedRoot, '.codex-plugin'), { recursive: true })
  await mkdir(path.join(linkedRoot, 'skills'), { recursive: true })
  await writeFile(path.join(linkedRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'linked-package', version: '1.0.0', description: 'Link fixture.', skills: './skills' }))
  let linkCreated = false
  try {
    await symlink(path.join(pluginRoot, 'skills', 'release-check'), path.join(linkedRoot, 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    linkCreated = true
  } catch {}
  if (linkCreated) await expectPluginError(() => inspectZyraPluginPackage(linkedRoot), 'PLUGIN_LINK_UNSUPPORTED')

  const registry = new ZyraPluginRegistry({ rootPath: devRoot, now })
  await registry.initialize()
  await expectPluginError(() => registry.installLocalPackage({
    packageRoot: pluginRoot,
    sourceId: 'fixture-source',
  }), 'PLUGIN_INSTALL_APPROVAL_REQUIRED')

  const installedV1 = await registry.installLocalPackage({
    packageRoot: pluginRoot,
    sourceId: 'fixture-source',
    sourceKind: 'marketplace',
    sourceLabel: 'Fixture marketplace',
    expectedName: 'release-helper',
    approved: true,
    approvedDigest: firstInspection.release.contentDigest,
  })
  assert.equal(installedV1.release.version, '1.0.0')
  assert.equal(existsSync(executionMarker), false, 'installation copies bytes without running package scripts')

  const pluginId = installedV1.plugin.id
  const projectSetV1 = await registry.setEnabledPlugins({
    projectId: 'project-one',
    pluginIds: [pluginId],
    expectedRevision: 1,
  })
  assert.equal(projectSetV1.revision, 2)
  await expectPluginError(() => registry.setEnabledPlugins({
    projectId: 'project-one',
    pluginIds: [],
    expectedRevision: 1,
  }), 'PLUGIN_SET_REVISION_CHANGED')
  const unchangedProjectSet = await registry.setEnabledPlugins({
    projectId: 'project-one',
    pluginIds: [pluginId],
    expectedRevision: 2,
  })
  assert.equal(unchangedProjectSet.revision, 2, 'setting the same Project Plugin IDs is idempotent')
  const migratedExistingChat = await registry.createChatScope({ sessionId: 'chat-existing', projectId: 'project-one', inherit: false })
  assert.equal(migratedExistingChat.plugins.length, 0, 'migrated existing Chats start with an empty Plugin scope')
  const chatA = await registry.createChatScope({ sessionId: 'chat-a', projectId: 'project-one' })
  assert.equal(chatA.plugins[0]?.version, '1.0.0')
  assert.equal((await registry.createChatScope({ sessionId: 'chat-a', projectId: 'project-one' })).scopeRevision, 1, 'creating an existing Chat scope never refreshes it')
  assert.equal((await registry.getChatSkillSources('chat-a')).length, 1)

  await writePlugin({ version: '1.1.0', skillBody: 'Inspect the newer release and report its exact digest.' })
  const secondInspection = await inspectZyraPluginPackage(pluginRoot)
  assert.notEqual(secondInspection.release.contentDigest, firstInspection.release.contentDigest)
  const installedV2 = await registry.installLocalPackage({
    packageRoot: pluginRoot,
    sourceId: 'fixture-source',
    sourceKind: 'marketplace',
    sourceLabel: 'Fixture marketplace',
    expectedName: 'release-helper',
    approved: true,
    approvedDigest: secondInspection.release.contentDigest,
  })
  assert.equal(installedV2.plugin.id, pluginId, 'a source and Plugin name keep stable installation identity')
  assert.equal((await registry.getChatScope('chat-a'))?.plugins[0]?.version, '1.0.0', 'activating an update does not change an existing Chat Plugin scope')
  const chatB = await registry.createChatScope({ sessionId: 'chat-b', projectId: 'project-one' })
  assert.equal(chatB.plugins[0]?.version, '1.1.0', 'new Chats snapshot the active release')

  const refreshedA = await registry.refreshChatScope({ sessionId: 'chat-a', projectId: 'project-one' })
  assert.equal(refreshedA.scope.plugins[0]?.version, '1.1.0')
  assert.equal(refreshedA.diff.changed.length, 1)

  const sourceStateOrder = []
  const verifiedSources = registry.getChatSkillSources('chat-b').then((sources) => {
    sourceStateOrder.push('verified')
    return sources
  })
  await Promise.resolve()
  const disabled = registry.setPluginState(pluginId, 'disabled').then(() => {
    sourceStateOrder.push('disabled')
  })
  assert.equal((await verifiedSources).length, 1)
  await disabled
  assert.deepEqual(sourceStateOrder, ['verified', 'disabled'], 'verified Skill resolution and disable mutations have one deterministic order')
  await expectPluginError(() => registry.getChatSkillSources('chat-b'), 'PLUGIN_DISABLED')
  const reinstalledWhileDisabled = await registry.installLocalPackage({
    packageRoot: pluginRoot,
    sourceId: 'fixture-source',
    sourceKind: 'marketplace',
    sourceLabel: 'Fixture marketplace',
    expectedName: 'release-helper',
    approved: true,
    approvedDigest: secondInspection.release.contentDigest,
  })
  assert.equal(reinstalledWhileDisabled.plugin.state, 'disabled', 'installing an update never silently re-enables a disabled Plugin')
  const rolledBackWhileDisabled = await registry.rollbackPlugin({ pluginId, releaseId: installedV1.release.id, approved: true })
  assert.equal(rolledBackWhileDisabled.plugin.state, 'disabled', 'rollback never silently re-enables a disabled Plugin')
  await registry.rollbackPlugin({ pluginId, releaseId: installedV2.release.id, approved: true })
  await registry.setPluginState(pluginId, 'active')
  await registry.setEnabledPlugins({ projectId: 'project-one', pluginIds: [pluginId], expectedRevision: 3 })

  await registry.setEnabledPlugins({ pluginIds: [pluginId], expectedRevision: 1 })
  const globalChat = await registry.createChatScope({ sessionId: 'global-chat' })
  assert.equal(globalChat.ownerKind, 'global')
  assert.equal(globalChat.plugins.length, 1)
  await registry.setEnabledPlugins({ pluginIds: [], expectedRevision: 2 })
  assert.equal((await registry.getChatScope('global-chat'))?.plugins.length, 1, 'later global changes do not rewrite an existing Chat')

  await registry.rollbackPlugin({ pluginId, releaseId: installedV1.release.id, approved: true })
  const chatC = await registry.createChatScope({ sessionId: 'chat-c', projectId: 'project-one' })
  assert.equal(chatC.plugins[0]?.version, '1.0.0')

  const installedSkillPath = (await registry.getChatSkillSources('chat-c', { verify: false }))[0]?.dir
  const installedSkillFile = path.join(installedSkillPath, 'release-check', 'SKILL.md')
  const originalInstalledSkill = await readFile(installedSkillFile, 'utf8')
  await writeFile(installedSkillFile, `${originalInstalledSkill}\nTampered.\n`)
  await expectPluginError(() => registry.getChatSkillSources('chat-c'), 'PLUGIN_RELEASE_TAMPERED')
  await expectPluginError(
    () => registry.rollbackPlugin({ pluginId, releaseId: installedV1.release.id, approved: true }),
    'PLUGIN_RELEASE_TAMPERED'
  )
  await writeFile(installedSkillFile, originalInstalledSkill)
  assert.equal((await registry.getChatSkillSources('chat-c')).length, 1, 'restoring exact bytes restores the digest check')

  const reopened = new ZyraPluginRegistry({ rootPath: devRoot, now })
  const reopenedCatalog = await reopened.getCatalog()
  assert.equal(reopenedCatalog.plugins.length, 1)
  assert.equal(reopenedCatalog.releases.length, 2)
  assert.equal((await reopened.getChatScope('chat-a'))?.plugins[0]?.version, '1.1.0')
  assert.deepEqual(await readdir(path.join(devRoot, 'staging')), [], 'staging directories are empty after success and failure')

  const productionRegistry = new ZyraPluginRegistry({ rootPath: prodRoot, now })
  assert.equal((await productionRegistry.getCatalog()).plugins.length, 0, 'development and production Plugin stores are independent')
  assert.notEqual(path.resolve(devRoot), path.resolve(prodRoot))

  const capacityRoot = path.join(fixture, 'scope-capacity', 'plugins')
  const capacityState = createEmptyZyraPluginState()
  capacityState.chatScopes = Array.from({ length: ZYRA_PLUGIN_LIMITS.maxChatScopes }, (_, index) => emptyChatScope(index))
  await mkdir(capacityRoot, { recursive: true })
  await writeFile(path.join(capacityRoot, 'plugin-state.json'), `${JSON.stringify(capacityState)}\n`)
  const capacityRegistry = new ZyraPluginRegistry({ rootPath: capacityRoot, now })
  await capacityRegistry.initialize()
  assert.equal((await capacityRegistry.createChatScope({ sessionId: 'capacity-chat-0000' })).sessionId, 'capacity-chat-0000')
  await expectPluginError(() => capacityRegistry.createChatScope({ sessionId: 'capacity-overflow' }), 'PLUGIN_SCOPE_LIMIT')
  await expectPluginError(() => capacityRegistry.refreshChatScope({ sessionId: 'capacity-refresh-overflow' }), 'PLUGIN_SCOPE_LIMIT')
  await expectPluginError(() => capacityRegistry.ensureLegacyChatScopes([{ sessionId: 'capacity-legacy-overflow' }]), 'PLUGIN_SCOPE_LIMIT')
  assert.equal((await capacityRegistry.getCatalog()).chatScopes.length, ZYRA_PLUGIN_LIMITS.maxChatScopes)
  assert.ok(await capacityRegistry.getChatScope('capacity-chat-0000'), 'capacity failures never evict the oldest pinned Chat')
  await capacityRegistry.removeChatScope('capacity-chat-0000')
  await capacityRegistry.createChatScope({ sessionId: 'capacity-replacement' })
  assert.equal((await capacityRegistry.getCatalog()).chatScopes.length, ZYRA_PLUGIN_LIMITS.maxChatScopes)
  assert.ok(await capacityRegistry.getChatScope('capacity-chat-0001'), 'freeing capacity preserves every other pinned Chat')

  const stateText = await readFile(path.join(devRoot, 'plugin-state.json'), 'utf8')
  assert.doesNotMatch(stateText, /approvedDigest|plugin-script-ran/, 'state excludes approval payloads and script contents')
  if (process.platform !== 'win32') {
    await chmod(path.join(devRoot, 'plugin-state.json'), 0o600)
  }

  console.log('Zyra Plugin manifest, package, install, scope, update, rollback, tamper, and isolation contracts: ok')
} finally {
  await rm(fixture, { recursive: true, force: true })
}
