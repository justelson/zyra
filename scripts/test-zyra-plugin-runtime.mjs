import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..')
const SKILL_NAME = 'zyra-plugin-runtime-proof'
const SOURCE_ID = 'runtime-proof-source'

async function writePluginPackage(root, version, description, instructions) {
  await Promise.all([
    mkdir(path.join(root, '.codex-plugin'), { recursive: true }),
    mkdir(path.join(root, 'skills', SKILL_NAME), { recursive: true }),
  ])
  await writeFile(path.join(root, '.codex-plugin', 'plugin.json'), `${JSON.stringify({
    name: 'runtime-proof-plugin',
    version,
    description: 'A temporary exact-release runtime proof.',
    skills: './skills',
  }, null, 2)}\n`)
  await writeFile(path.join(root, 'skills', SKILL_NAME, 'SKILL.md'), [
    '---',
    `name: ${SKILL_NAME}`,
    `description: ${description}`,
    '---',
    '',
    '# Runtime proof',
    '',
    instructions,
    '',
  ].join('\n'))
}

function assertPathInside(candidate, root, message) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  assert.equal(
    relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)),
    true,
    message,
  )
}

const fixture = await mkdtemp(path.join(os.tmpdir(), 'zyra-plugin-runtime-'))
const project = path.join(fixture, 'project')
const home = path.join(fixture, 'home')
const store = path.join(fixture, 'plugin-store')
const releasesRoot = path.join(store, 'releases')
const runtimes = []

try {
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(home, { recursive: true }),
  ])
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    ZYRA_CALLER_CWD: project,
    ZYRA_DATA_ROOT: path.join(fixture, 'data'),
    ZYRA_ROOT: REPOSITORY_ROOT,
  })

  const [
    { ZyraPluginRegistry },
    { createZyraSession, listZyraSkills, loadZyraSkillPrompt },
  ] = await Promise.all([
    import('../src/plugins/plugin-registry.mjs'),
    import('../src/zyra-sdk.mjs'),
  ])

  const registry = new ZyraPluginRegistry({ rootPath: store })
  await registry.initialize()
  await registry.ensureLegacyChatScopes([{ sessionId: 'legacy-chat' }])

  const createRuntime = async (sessionId) => {
    const pluginSkillSources = await registry.getChatSkillSources(sessionId)
    const runtime = await createZyraSession({
      project,
      sessions: path.join(fixture, 'sessions', sessionId),
      noSession: true,
      noTools: true,
      enableFleet: false,
      persistStartupPreferences: false,
      skipGuide: true,
      skipMemoryInjection: true,
      skipMemoryStartup: true,
      skipModelAvailability: true,
      skipProfileInjection: true,
      skipProjectMemory: true,
      pluginSkillSources,
    })
    runtimes.push(runtime)
    return runtime
  }

  const assertRuntimeRelease = async (sessionId, expected) => {
    const runtime = await createRuntime(sessionId)
    const skill = listZyraSkills(runtime).find((entry) => entry.name === SKILL_NAME)
    if (!expected) {
      assert.equal(skill, undefined, `${sessionId} must not gain the Plugin Skill without refresh`)
      assert.equal(loadZyraSkillPrompt(runtime, SKILL_NAME), undefined)
      return
    }

    assert.equal(skill?.description, expected.description)
    assert.equal(skill?.zyraPluginId, expected.pluginId)
    assert.equal(skill?.zyraPluginReleaseId, expected.releaseId)
    assert.equal(skill?.zyraPluginContentDigest, expected.contentDigest)
    assertPathInside(skill.filePath, releasesRoot, 'runtime Skill files must come from the immutable installation copy')
    assert.equal(path.resolve(skill.filePath).startsWith(path.resolve(expected.sourcePackage)), false)
    const prompt = loadZyraSkillPrompt(runtime, SKILL_NAME)
    assert.match(prompt, new RegExp(expected.instructions.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.equal(await readFile(skill.filePath, 'utf8').then((text) => text.includes(expected.instructions)), true)
  }

  const packageV1 = path.join(fixture, 'package-v1')
  const v1 = {
    description: 'Exact release one.',
    instructions: 'Release one instructions.',
    sourcePackage: packageV1,
  }
  await writePluginPackage(packageV1, '1.0.0', v1.description, v1.instructions)
  const inspectedV1 = await registry.inspectLocalPackage(packageV1)
  const installedV1 = await registry.installLocalPackage({
    packageRoot: packageV1,
    approved: true,
    approvedDigest: inspectedV1.release.contentDigest,
    sourceId: SOURCE_ID,
  })
  await registry.setEnabledPlugins({
    pluginIds: [installedV1.plugin.id],
    expectedRevision: 1,
  })
  const scopedV1 = await registry.createChatScope({ sessionId: 'scoped-chat' })
  assert.equal(scopedV1.plugins[0]?.releaseId, installedV1.release.id)

  const packageV2 = path.join(fixture, 'package-v2')
  const v2 = {
    description: 'Exact release two.',
    instructions: 'Release two instructions.',
    sourcePackage: packageV2,
  }
  await writePluginPackage(packageV2, '2.0.0', v2.description, v2.instructions)
  const inspectedV2 = await registry.inspectLocalPackage(packageV2)
  const installedV2 = await registry.installLocalPackage({
    packageRoot: packageV2,
    approved: true,
    approvedDigest: inspectedV2.release.contentDigest,
    sourceId: SOURCE_ID,
  })
  assert.equal(installedV2.plugin.id, installedV1.plugin.id, 'an update must retain Plugin identity')
  assert.notEqual(installedV2.release.id, installedV1.release.id)

  const futureScope = await registry.createChatScope({ sessionId: 'future-chat' })
  assert.equal(futureScope.plugins[0]?.releaseId, installedV2.release.id, 'new Chats use the active Plugin release')
  assert.equal((await registry.getChatSkillSources('legacy-chat')).length, 0)
  assert.equal((await registry.getChatSkillSources('scoped-chat'))[0]?.releaseId, installedV1.release.id)

  await assertRuntimeRelease('legacy-chat', null)
  await assertRuntimeRelease('scoped-chat', {
    ...v1,
    pluginId: installedV1.plugin.id,
    releaseId: installedV1.release.id,
    contentDigest: installedV1.release.contentDigest,
  })

  const refreshed = await registry.refreshChatScope({ sessionId: 'scoped-chat' })
  assert.equal(refreshed.diff.added.length, 0)
  assert.equal(refreshed.diff.removed.length, 0)
  assert.equal(refreshed.diff.changed.length, 1)
  assert.equal(refreshed.diff.changed[0]?.before.releaseId, installedV1.release.id)
  assert.equal(refreshed.diff.changed[0]?.after.releaseId, installedV2.release.id)

  await assertRuntimeRelease('scoped-chat', {
    ...v2,
    pluginId: installedV2.plugin.id,
    releaseId: installedV2.release.id,
    contentDigest: installedV2.release.contentDigest,
  })

  console.log('Zyra exact-release Plugin Skill runtime and explicit Chat refresh: ok')
} finally {
  for (const runtime of runtimes.reverse()) {
    await Promise.resolve(runtime.session.dispose())
  }
  await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
