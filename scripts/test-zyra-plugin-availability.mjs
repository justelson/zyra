import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ZYRA_PLUGIN_LIMITS } from '../src/plugins/plugin-contract.mjs'
import { ZyraPluginRegistry } from '../src/plugins/plugin-registry.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'zyra-plugin-availability-'))
const rootPath = path.join(root, 'registry')
const stateFile = path.join(rootPath, 'plugin-state.json')
const limit = ZYRA_PLUGIN_LIMITS.maxActiveSkillPlugins
let tick = 0
const options = { rootPath, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) }

async function install(registry, name, version = '1.0.0', supported = true) {
  const packageRoot = path.join(root, 'packages', name, version)
  await mkdir(path.join(packageRoot, '.codex-plugin'), { recursive: true })
  await writeFile(path.join(packageRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name, version, description: 'Availability test fixture.',
    ...(supported ? { skills: './skills' } : {}), mcpServers: './.mcp.json',
  }))
  await writeFile(path.join(packageRoot, '.mcp.json'), '{}\n')
  if (supported) {
    // Multiple Skills still consume one active Skill package slot.
    for (const skill of ['first', 'second']) {
      const directory = path.join(packageRoot, 'skills', skill)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${skill}\ndescription: Test availability.\n---\nFixture ${version}.\n`)
    }
  }
  const inspected = await registry.inspectLocalPackage(packageRoot)
  return registry.installLocalPackage({ packageRoot, sourceId: 'fixture-source', approved: true, approvedDigest: inspected.release.contentDigest })
}

async function unchangedOnError(registry, work, code) {
  const before = await registry.getCatalog()
  const disk = await readFile(stateFile, 'utf8')
  await assert.rejects(work, { code })
  assert.deepEqual(await registry.getCatalog(), before, 'failure preserves all in-memory revisions, sets and pins')
  assert.equal(await readFile(stateFile, 'utf8'), disk, 'failure leaves persisted bytes unchanged')
}

try {
  const setup = new ZyraPluginRegistry(options)
  const installed = []
  for (let index = 0; index <= limit; index++) installed.push(await install(setup, `skill-${index}`))
  const unsupported = await install(setup, 'unsupported-only', '1.0.0', false)
  const baseline = await setup.getCatalog()
  const ids = installed.map(({ plugin }) => plugin.id)
  const accepted = ids.slice(0, limit)
  async function fresh(change = () => {}) {
    const state = structuredClone(baseline)
    change(state)
    await writeFile(stateFile, JSON.stringify(state))
    const registry = new ZyraPluginRegistry(options)
    await registry.initialize()
    return registry
  }

  for (const projectId of [undefined, 'fixture-project']) {
    const label = projectId || 'global'
    await test(`${label}: 24 packages accepted, 25th rejected before mutation`, async () => {
      assert.equal(limit, 24)
      const registry = await fresh()
      const set = await registry.setEnabledPlugins({ projectId, pluginIds: accepted, expectedRevision: 1 })
      assert.equal(set.revision, 2)
      const scope = await registry.createChatScope({ sessionId: 'valid', projectId })
      assert.equal(scope.plugins.length, limit)
      assert.equal((await registry.getChatSkillSources('valid')).length, limit)
      await unchangedOnError(registry, () => registry.setEnabledPlugins({ projectId, pluginIds: ids, expectedRevision: 2 }), 'PLUGIN_SKILL_SOURCE_LIMIT')
      await unchangedOnError(registry, () => registry.setEnabledPlugins({ projectId, pluginIds: [], expectedRevision: 1 }), 'PLUGIN_SET_REVISION_CHANGED')
      assert.deepEqual(await registry.getChatScope('valid'), scope)
    })
    await test(`${label}: unsupported-only import stays inspectable but cannot be enabled`, async () => {
      const registry = await fresh()
      assert.equal(unsupported.release.skills.length, 0)
      assert.ok((await registry.getCatalog()).plugins.some((entry) => entry.id === unsupported.plugin.id))
      await unchangedOnError(registry, () => registry.setEnabledPlugins({ projectId, pluginIds: [unsupported.plugin.id], expectedRevision: 1 }), 'PLUGIN_NO_SUPPORTED_SKILLS')
    })
  }

  for (const [label, pluginIds, code] of [
    ['over-limit', ids, 'PLUGIN_SKILL_SOURCE_LIMIT'],
    ['unsupported-only', [unsupported.plugin.id], 'PLUGIN_NO_SUPPORTED_SKILLS'],
  ]) {
    await test(`${label} legacy set cannot persist invalid create or refresh`, async () => {
      const registry = await fresh((state) => { state.pluginSets[0].pluginIds = pluginIds })
      const previous = await registry.createChatScope({ sessionId: 'pinned', selection: {
        pluginId: ids[0], releaseId: installed[0].release.id, contentDigest: installed[0].release.contentDigest,
      } })
      await unchangedOnError(registry, () => registry.createChatScope({ sessionId: 'invalid' }), code)
      await unchangedOnError(registry, () => registry.refreshChatScope({ sessionId: 'pinned' }), code)
      await unchangedOnError(registry, () => registry.refreshChatScope({ sessionId: 'missing' }), code)
      assert.deepEqual(await registry.getChatScope('pinned'), previous)
      assert.equal(await registry.getChatScope('invalid'), null)
      await registry.ensureLegacyChatScopes([{ sessionId: 'legacy' }])
      assert.deepEqual((await registry.getChatScope('legacy')).plugins, [])
    })
  }

  await test('scope count uses resolved active releases and preserves empty legacy fallback', async () => {
    const registry = await fresh((state) => {
      state.pluginSets[0].pluginIds = ids
      state.plugins.find((entry) => entry.id === ids[limit]).state = 'disabled'
    })
    assert.equal((await registry.createChatScope({ sessionId: 'resolved' })).plugins.length, limit)
    assert.deepEqual((await registry.createChatScope({ sessionId: 'project', projectId: 'no-set' })).plugins, [])
    assert.deepEqual(await registry.getChatSkillSources('unrecorded'), [])
    assert.deepEqual((await registry.createChatScope({ sessionId: 'no-inherit', inherit: false })).plugins, [])
    const missingRelease = await fresh((state) => {
      state.pluginSets[0].pluginIds = ids
      state.releases = state.releases.filter((entry) => entry.id !== installed[limit].release.id)
    })
    assert.equal((await missingRelease.createChatScope({ sessionId: 'missing-release' })).plugins.length, limit)
  })

  await test('updates preserve pins; explicit refresh advances revisions and release diff', async () => {
    const registry = await fresh()
    const pluginId = ids[0]
    const set = await registry.setEnabledPlugins({ pluginIds: [pluginId], expectedRevision: 1 })
    const old = await registry.createChatScope({ sessionId: 'pinned' })
    const updated = await install(registry, 'skill-0', '2.0.0')
    assert.deepEqual(await registry.getChatScope('pinned'), old)
    assert.equal((await registry.getChatSkillSources('pinned'))[0].releaseId, installed[0].release.id)
    const result = await registry.refreshChatScope({ sessionId: 'pinned' })
    assert.equal(result.scope.scopeRevision, old.scopeRevision + 1)
    assert.equal(result.scope.pluginSetRevision, set.revision)
    assert.equal(result.scope.createdAt, old.createdAt)
    assert.equal(result.scope.plugins[0].releaseId, updated.release.id)
    assert.equal(result.diff.changed.length, 1)
    assert.equal(result.diff.added.length + result.diff.removed.length, 0)
    const unsupportedUpdate = await install(registry, 'skill-0', '3.0.0', false)
    await unchangedOnError(registry, () => registry.refreshChatScope({ sessionId: 'pinned' }), 'PLUGIN_NO_SUPPORTED_SKILLS')
    await unchangedOnError(registry, () => registry.createChatScope({ sessionId: 'new' }), 'PLUGIN_NO_SUPPORTED_SKILLS')
    await unchangedOnError(registry, () => registry.setEnabledPlugins({ pluginIds: [pluginId], expectedRevision: set.revision }), 'PLUGIN_NO_SUPPORTED_SKILLS')
    await unchangedOnError(registry, () => registry.createChatScope({ sessionId: 'selected', selection: {
      pluginId, releaseId: unsupportedUpdate.release.id, contentDigest: unsupportedUpdate.release.contentDigest,
    } }), 'PLUGIN_NO_SUPPORTED_SKILLS')
    const reopened = new ZyraPluginRegistry(options)
    assert.deepEqual(await reopened.getChatScope('pinned'), result.scope)
  })
} finally {
  await rm(root, { recursive: true, force: true })
}
