import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDesktopBuildMetadata, resolveDistributionIdentity, canManageGlobalTerminalCommand, previewAutoUpdateDisabledReason } from '../src/shared/distribution-identity'
import { desktopNamespaceId, configureDesktopTerminalEnvironment, desktopTerminalEnvironment } from '../src/main/assistant/agent-server-namespace'
import { configurePreviewDataEnvironment, resolveZyraDataRoot } from '../src/main/zyra/zyra-data-root'
import { join, resolve } from 'node:path'

const stable = createDesktopBuildMetadata({})
const preview = createDesktopBuildMetadata({ ZYRA_BUILD_DISTRIBUTION: 'preview', ZYRA_BUILD_SOURCE_SHA: 'a'.repeat(40), ZYRA_BUILD_SOURCE_REPOSITORY: 'example/source', GITHUB_RUN_ID: '123' })
const prod = resolveDistributionIdentity(false, stable)
const test = resolveDistributionIdentity(false, preview)
const stableEnv = {ZYRA_DATA_ROOT: '/stable-data', ZYRA_STATE_DIR: '/stable-state'}
configurePreviewDataEnvironment('/profiles/stable', stableEnv, stable)
assert.deepEqual(stableEnv, {ZYRA_DATA_ROOT: '/stable-data', ZYRA_STATE_DIR: '/stable-state'}, 'Stable explicit roots are unchanged')
const previewEnv: NodeJS.ProcessEnv = {...stableEnv}
configurePreviewDataEnvironment('/profiles/preview', previewEnv, preview)
assert.equal(previewEnv.ZYRA_DATA_ROOT, join('/profiles/preview','runtime-data'))
assert.equal(previewEnv.ZYRA_STATE_DIR, join('/profiles/preview','assistant','agent-server'))
const originalDataRoot = process.env.ZYRA_DATA_ROOT
try {
    process.env.ZYRA_DATA_ROOT = previewEnv.ZYRA_DATA_ROOT
    configureDesktopTerminalEnvironment('/profiles/preview')
    assert.equal(resolveZyraDataRoot(), resolve(previewEnv.ZYRA_DATA_ROOT!))
    assert.equal(desktopTerminalEnvironment().ZYRA_DATA_ROOT, previewEnv.ZYRA_DATA_ROOT, 'Preview terminals inherit isolated memory')
} finally {
    if (originalDataRoot === undefined) delete process.env.ZYRA_DATA_ROOT
    else process.env.ZYRA_DATA_ROOT = originalDataRoot
}
assert.equal(prod.appName, 'Zyra')
assert.equal(prod.appUserModelId, 'app.zyra.desktop')
assert.equal(prod.isolated, false)
assert.equal(test.appName, 'Zyra Preview')
assert.equal(test.appUserModelId, 'app.zyra.desktop.preview')
assert.equal(test.isolated, true)
assert.notEqual(test.userDataDirectoryName, prod.userDataDirectoryName)
assert.notEqual(desktopNamespaceId(`/profiles/${test.userDataDirectoryName}`), desktopNamespaceId(`/profiles/${prod.userDataDirectoryName}`))
assert.equal(resolveDistributionIdentity(true, preview, 'Fixture A').appName, 'Zyra-dev-fixture-a')
assert.equal(canManageGlobalTerminalCommand(true, stable), true)
assert.equal(canManageGlobalTerminalCommand(false, stable), false)
assert.equal(canManageGlobalTerminalCommand(true, preview), false)
assert.equal(previewAutoUpdateDisabledReason(stable), null)
assert.match(previewAutoUpdateDisabledReason(preview)!, /do not use the stable update feed/)
assert.throws(() => createDesktopBuildMetadata({ ZYRA_BUILD_DISTRIBUTION: 'preview' }), /require/)
assert.throws(() => createDesktopBuildMetadata({ ZYRA_BUILD_DISTRIBUTION: 'preivew' }), /Unknown/)
assert.throws(() => createDesktopBuildMetadata({ ZYRA_BUILD_SOURCE_SHA: 'main' }), /full commit/)
assert.throws(() => createDesktopBuildMetadata({ ZYRA_BUILD_SOURCE_REPOSITORY: '../source' }), /Invalid/)
const root = new URL('../', import.meta.url)
const main = readFileSync(new URL('src/main/index.ts', root), 'utf8')
assert.match(main, /if \(!identity\.isolated\) return/)
assert.ok(main.indexOf("configurePreviewDataEnvironment(app.getPath('userData'))") < main.indexOf("const setupServices = createDesktopSetupServices"), 'Preview roots applied before consent services are created')
assert.match(main, /if \(!isPreviewDistribution\(\)\)\s*\{\s*void registerInstalledDesktop/)
const terminal = readFileSync(new URL('src/main/terminal-command-service.ts', root), 'utf8')
assert.match(terminal, /terminalChannel\(\) === 'preview' \? 'zyra-dev' : 'zyra'/)
assert.equal(terminal.match(/if \(!app\.isPackaged\) throw/g)?.length, 2)
const updater = readFileSync(new URL('src/main/update/manager.ts', root), 'utf8')
assert.match(updater, /return previewAutoUpdateDisabledReason\(\) \|\| getAutoUpdateDisabledReason/)
const installer = readFileSync(new URL('build/preview-installer.nsh', root), 'utf8')
assert.doesNotMatch(installer, /WriteReg|FileWrite|DeleteReg|ZyraInstallFileIcons/)
console.log('Preview identity: stable/dev preservation, isolated profile/namespace, source validation, launcher and updater guards passed')
