import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectWithStablePluginAuthority } from '../src/main/assistant/assistant-plugin-authority'
import { AssistantPluginRegistry } from '../src/main/assistant/assistant-plugin-registry'
import { ASSISTANT_IPC, assertAssistantIpcContract } from '../src/shared/assistant/contracts'
import { BROWSER_ASSISTANT_BRIDGE_METHODS } from '../src/shared/browser-assistant-bridge'
import {
    GLOBAL_PLUGIN_OWNER_ID,
    getPluginSet,
    isChatPluginScopeCurrent,
    previewChatPluginScopeDiff,
    togglePluginSetId
} from '../src/renderer/src/pages/plugins/plugin-directory-state'

const fixture = await mkdtemp(join(tmpdir(), 'zyra-assistant-plugin-'))
const packageRoot = join(fixture, 'source', 'review-helper')
const registryRoot = join(fixture, 'Zyra-dev', 'assistant', 'plugins')
const executionMarker = join(fixture, 'executed.txt')

async function writePackage(version: string, body: string) {
    await mkdir(join(packageRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(packageRoot, 'skills', 'review-helper', 'scripts'), { recursive: true })
    await writeFile(join(packageRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
        name: 'review-helper',
        version,
        description: 'Review a bounded change before applying it.',
        skills: './skills',
        interface: {
            displayName: 'Review Helper',
            developerName: 'Fixture Publisher',
            category: 'Developer Tools',
            capabilities: ['Read']
        }
    }))
    await writeFile(join(packageRoot, 'skills', 'review-helper', 'SKILL.md'), [
        '---',
        'name: review-helper',
        'description: Review a bounded change before applying it.',
        '---',
        '',
        body
    ].join('\n'))
    await writeFile(
        join(packageRoot, 'skills', 'review-helper', 'scripts', 'never-run.js'),
        `await import('node:fs/promises').then(fs => fs.writeFile(${JSON.stringify(executionMarker)}, 'ran'))\n`
    )
}

try {
    assertAssistantIpcContract()
    assert.equal(ASSISTANT_IPC.getPluginCatalog, 'devscope:assistant:getPluginCatalog')
    assert.equal(ASSISTANT_IPC.installInspectedPlugin, 'devscope:assistant:installInspectedPlugin')
    assert.equal(BROWSER_ASSISTANT_BRIDGE_METHODS.includes('getPluginCatalog'), true)
    assert.equal(BROWSER_ASSISTANT_BRIDGE_METHODS.includes('setPluginSet'), true)
    assert.equal(BROWSER_ASSISTANT_BRIDGE_METHODS.includes('inspectLocalPlugin' as never), false, 'Browser clients cannot submit local package paths')
    assert.equal(BROWSER_ASSISTANT_BRIDGE_METHODS.includes('installInspectedPlugin' as never), false, 'Browser clients cannot approve local package installation')

    let authorityGeneration = 0
    let connectionAttempts = 0
    let staleDisconnects = 0
    await connectWithStablePluginAuthority({
        getGeneration: () => authorityGeneration,
        resolve: async () => ({ releaseId: authorityGeneration === 0 ? 'old-release' : 'new-release' }),
        connect: async () => {
            connectionAttempts += 1
            if (connectionAttempts === 1) authorityGeneration += 1
        },
        disconnect: () => { staleDisconnects += 1 }
    })
    assert.equal(connectionAttempts, 2, 'a Plugin mutation during connect retries with fresh authority')
    assert.equal(staleDisconnects, 1, 'a connection completed with stale Plugin authority is disconnected')

    let resolutionGeneration = 0
    let resolutions = 0
    let stableConnects = 0
    await connectWithStablePluginAuthority({
        getGeneration: () => resolutionGeneration,
        resolve: async () => {
            resolutions += 1
            if (resolutions === 1) resolutionGeneration += 1
            return { releaseId: `release-${resolutionGeneration}` }
        },
        connect: async () => { stableConnects += 1 },
        disconnect: () => undefined
    })
    assert.equal(resolutions, 2, 'a Plugin mutation during source resolution discards the stale result')
    assert.equal(stableConnects, 1)

    await writePackage('1.0.0', 'Review the exact change.')
    let reviewNow = Date.now()
    const registry = new AssistantPluginRegistry({
        rootPath: registryRoot,
        now: () => reviewNow,
        reviewTtlMs: 100
    })
    await registry.initialize()

    const firstReview = await registry.inspectLocalPlugin({
        packagePath: packageRoot,
        sourceId: 'fixture-source',
        sourceKind: 'marketplace',
        sourceLabel: 'Fixture source'
    })
    assert.equal(firstReview.manifest.name, 'review-helper')
    assert.equal(firstReview.release.containsExecutableFiles, true)
    assert.equal('packageRoot' in firstReview, false, 'renderer review excludes the private source path')
    assert.equal(existsSync(executionMarker), false)

    await writePackage('1.0.0', 'The source changed after review.')
    await assert.rejects(
        () => registry.installInspectedPlugin({ reviewId: firstReview.reviewId, confirmed: true }),
        /exact inspected content digest|approved release digest/i,
        'source changes invalidate the exact review instead of installing different bytes'
    )
    await assert.rejects(
        () => registry.installInspectedPlugin({ reviewId: firstReview.reviewId, confirmed: true }),
        /missing or expired/i,
        'an install review is consumed once even when activation fails'
    )

    const approvedReview = await registry.inspectLocalPlugin({
        packagePath: packageRoot,
        sourceId: 'fixture-source',
        sourceKind: 'marketplace',
        sourceLabel: 'Fixture source'
    })
    const installed = await registry.installInspectedPlugin({ reviewId: approvedReview.reviewId, confirmed: true })
    const plugin = installed.catalog.plugins[0]
    assert.ok(plugin)
    assert.equal(GLOBAL_PLUGIN_OWNER_ID, 'global')
    assert.equal(getPluginSet(installed.catalog, null)?.ownerId, 'global')
    assert.deepEqual(togglePluginSetId(['one'], 'two', true), ['one', 'two'])
    assert.deepEqual(togglePluginSetId(['one', 'two'], 'one', false), ['two'])
    assert.equal(installed.catalog.releases[0]?.contentDigest, approvedReview.release.contentDigest)
    assert.equal(existsSync(executionMarker), false, 'main-process install review never executes Plugin scripts')

    await registry.setPluginSet({ projectId: 'project-one', pluginIds: [plugin.id], expectedRevision: 1 })
    await assert.rejects(
        () => registry.setPluginSet({ projectId: 'project-one', pluginIds: [], expectedRevision: 1 }),
        /changed after it was inspected/i,
        'stale Plugin-set writers cannot overwrite a newer availability revision'
    )
    const chatScope = await registry.createChatScope('new-chat', 'project-one')
    assert.equal(chatScope.plugins[0]?.pluginId, plugin.id)
    const currentCatalog = await registry.getCatalog()
    assert.equal(isChatPluginScopeCurrent(currentCatalog, chatScope), true)
    assert.equal(isChatPluginScopeCurrent(currentCatalog, {
        ...chatScope,
        ownerId: 'project-without-set',
        pluginSetRevision: 1,
        plugins: []
    }), true, 'an implicit empty Project Plugin set is current at its initial revision')
    const changedReleaseCatalog = structuredClone(currentCatalog)
    const activePlugin = changedReleaseCatalog.plugins.find((entry) => entry.id === plugin.id)!
    const activeRelease = changedReleaseCatalog.releases.find((entry) => entry.id === activePlugin.activeReleaseId)!
    const replacementRelease = {
        ...activeRelease,
        id: `${activeRelease.id}-replacement`,
        version: '1.0.1',
        contentDigest: 'a'.repeat(64)
    }
    changedReleaseCatalog.releases.push(replacementRelease)
    activePlugin.activeReleaseId = replacementRelease.id
    assert.equal(isChatPluginScopeCurrent(changedReleaseCatalog, chatScope), false, 'an active release change requires explicit Chat refresh even when the set revision is unchanged')
    const releaseDiff = previewChatPluginScopeDiff(changedReleaseCatalog, chatScope)
    assert.equal(releaseDiff.changed[0]?.before.releaseId, activeRelease.id)
    assert.equal(releaseDiff.changed[0]?.after.releaseId, replacementRelease.id)
    const skillSources = await registry.getChatSkillSources('new-chat')
    assert.equal(skillSources[0]?.scope, 'project')
    assert.equal(skillSources[0]?.pluginId, plugin.id)
    assert.equal(skillSources[0]?.installationRoot.endsWith(join('plugins', 'releases')), true)

    await registry.ensureLegacyChatScopes([
        { sessionId: 'old-project-chat', projectId: 'project-one' },
        { sessionId: 'old-global-chat' }
    ])
    assert.equal((await registry.getChatScope('old-project-chat'))?.plugins.length, 0)
    assert.equal((await registry.getChatScope('old-global-chat'))?.plugins.length, 0)

    await registry.resetChatScope('new-chat', null)
    assert.equal((await registry.getChatScope('new-chat'))?.ownerKind, 'global')
    assert.equal((await registry.getChatScope('new-chat'))?.plugins.length, 0, 'changing Project clears old Plugin authority')

    const disabledChat = await registry.createChatScope('disabled-chat', 'project-one')
    assert.equal(disabledChat.plugins.length, 1)
    await registry.setPluginState(plugin.id, 'disabled')
    await assert.rejects(() => registry.getChatSkillSources('disabled-chat'), /disabled/i, 'disabling a Plugin revokes scoped runtime loading')

    const sourceSkill = await readFile(join(packageRoot, 'skills', 'review-helper', 'SKILL.md'), 'utf8')
    assert.match(sourceSkill, /source changed after review/i, 'install and disable never mutate the source package')

    const expiringReview = await registry.inspectLocalPlugin({ packagePath: packageRoot })
    reviewNow += 101
    await assert.rejects(
        () => registry.installInspectedPlugin({ reviewId: expiringReview.reviewId, confirmed: true }),
        /missing or expired/i,
        'expired opaque install reviews cannot activate a Plugin release'
    )

    const serviceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
    const ipcHandlersSource = readFileSync(new URL('../src/main/ipc/handlers.ts', import.meta.url), 'utf8')
    const preloadSource = readFileSync(new URL('../src/preload/adapters/assistant-adapter.ts', import.meta.url), 'utf8')
    const browserBridgeSource = readFileSync(new URL('../src/main/assistant/browser-assistant-bridge.ts', import.meta.url), 'utf8')
    const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
    const workerSource = readFileSync(new URL('../src/main/assistant/zyra-agent-server-worker.ts', import.meta.url), 'utf8')
    const serverSource = readFileSync(new URL('../../src/agent-server/server.mjs', import.meta.url), 'utf8')
    const bridgeSource = readFileSync(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
    const scopeCaptureIndex = serviceSource.indexOf('createChatScope(plannedSessionId')
    assert.ok(scopeCaptureIndex >= 0 && serviceSource.indexOf('createAssistantSessionAction', scopeCaptureIndex) > scopeCaptureIndex, 'new Chat Plugin scope is captured before the Chat is published')
    assert.match(serviceSource, /ensureLegacyChatScopes/u, 'existing Chats receive one bounded empty-scope migration')
    assert.match(serviceSource, /connectWithStablePluginAuthority/u, 'runtime connection is rejected and retried when Plugin authority changes concurrently')
    assert.match(ipcHandlersSource, /ASSISTANT_IPC\.installInspectedPlugin[\s\S]*handleAssistantInstallInspectedPlugin/u, 'trusted Desktop IPC registers exact-review installation')
    assert.match(preloadSource, /installInspectedPlugin[\s\S]*ASSISTANT_IPC\.installInspectedPlugin/u, 'the Desktop preload exposes the bounded install review method')
    assert.match(browserBridgeSource, /case 'getPluginCatalog'/u, 'the browser bridge can inspect installed Plugin state')
    assert.match(browserBridgeSource, /withoutDesktopPluginPaths/u, 'browser Plugin catalogs remove Desktop-only source and release paths')
    assert.doesNotMatch(browserBridgeSource, /case 'inspectLocalPlugin'/u, 'the browser bridge cannot submit a local Plugin path')
    assert.doesNotMatch(browserBridgeSource, /case 'installInspectedPlugin'/u, 'the browser bridge cannot approve a local Plugin install')
    assert.match(runtimeSource, /pluginSkillSources: context\.pluginSkillSources/u, 'runtime sends exact Plugin Skill sources to its worker')
    assert.match(workerSource, /pluginSkillSources: payload\['pluginSkillSources'\]/u, 'desktop agent-server adapter preserves Plugin sources')
    assert.match(serverSource, /canonicalConnectionAuthorityKey[\s\S]*pluginSkillSources/u, 'agent-server worker reuse includes Plugin release authority')
    assert.match(bridgeSource, /pluginSkillSources: Array\.isArray\(payload\.pluginSkillSources\)/u, 'worker bridge passes only an array into SDK startup')

    registry.dispose()
    console.log('Assistant Plugin review, install, scope migration, runtime wiring, and source-isolation contracts: ok')
} finally {
    await rm(fixture, { recursive: true, force: true })
}
