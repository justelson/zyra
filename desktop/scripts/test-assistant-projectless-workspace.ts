import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
import { ensureDefaultChatWorkspace, prepareDefaultChatWorkspace } from '../src/main/setup/default-chat-workspace'
import { OnboardingService } from '../src/main/setup/onboarding-service'
import { resolveImportedAssistantProjectPath, resolveAssistantSessionProjectPath } from '../src/shared/assistant/project-identity'

const cwd = 'C:/Users/test/Documents/Zyra'
assert.equal(resolveAssistantSessionProjectPath({ projectPath: null, workingRoot: cwd }), '')
assert.equal(resolveAssistantSessionProjectPath({ projectPath: '/work/legacy', workingRoot: cwd }), '/work/legacy')
assert.equal(resolveAssistantSessionProjectPath({ projectPath: null, projectId: 'explicit', workingRoot: '/work/app' }), '/work/app')
assert.equal(resolveImportedAssistantProjectPath({ canonicalProjectPath: cwd, existingSession: { projectPath: null, workingRoot: cwd } }), null, 'canonical storage cwd cannot attach a project to a Desktop projectless chat')
assert.equal(resolveImportedAssistantProjectPath({ canonicalProjectPath: cwd, existingSession: { projectPath: '/work/legacy' } }), '/work/legacy', 'preserve explicit legacy assignment even when canonical metadata differs')
assert.equal(resolveImportedAssistantProjectPath({ canonicalProjectPath: '/cli/project' }), '/cli/project', 'new CLI imports retain their explicit project')
assert.equal(resolveImportedAssistantProjectPath({ canonicalProjectPath: null }), null, 'cwd-only import stays projectless')

const root = await mkdtemp(join(tmpdir(), 'zyra-projectless-workspace-'))
try {
    const documents = join(root, 'Documents redirected')
    const fallback = join(documents, 'Zyra')
    const file = join(root, 'preferences.json')
    const preferences = new DevicePreferencesService(file, undefined, fallback)
    const initial = await preferences.get({ surface: 'desktop' })
    assert.equal(preferences.getConfiguredProjectsFolder(), fallback)
    assert.equal(initial.settings.projectsFolder, fallback)
    await assert.rejects(stat(fallback), { code: 'ENOENT' }, 'preferences resolve paths without touching Documents')
    await prepareDefaultChatWorkspace(process.platform === 'win32' ? fallback.replace(/\\/g, '/').toUpperCase() : fallback, preferences.getConfiguredProjectsFolder())
    assert.equal((await stat(fallback)).isDirectory(), true, 'workspace activation creates the bounded working folder')
    const explicit = join(root, 'explicit-projects')
    await mkdir(explicit)
    await preferences.updateSharedFromMain({ projectsFolder: explicit, additionalFolders: [join(root, 'extra')] })
    assert.equal(preferences.getConfiguredProjectsFolder(), explicit)
    const restored = new DevicePreferencesService(file, undefined, fallback)
    assert.equal((await restored.get({ surface: 'desktop' })).settings.projectsFolder, explicit)
    await restored.updateSharedFromMain({ projectsFolder: '' })
    assert.equal(restored.getConfiguredProjectsFolder(), fallback)
    assert.equal((await restored.get({ surface: 'desktop' })).settings.projectsFolder, fallback)
    const disk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(disk.shared.projectsFolder, '', 'effective fallback needs no schema migration or rewriting the saved choice')
    assert.equal((await stat(explicit)).isDirectory(), true, 'changing defaults never deletes a user folder')
    const unrelatedFolder = join(root, 'unrelated')
    await prepareDefaultChatWorkspace(unrelatedFolder, fallback)
    await assert.rejects(stat(unrelatedFolder), { code: 'ENOENT' }, 'activation never creates an unrelated project directory')
    const blocked = join(root, 'not-a-directory')
    await writeFile(blocked, 'fixture')
    const unavailablePreferences = new DevicePreferencesService(join(root, 'blocked.json'), undefined, blocked)
    await unavailablePreferences.get({ surface: 'desktop' })
    await unavailablePreferences.updateSharedFromMain({ assistantDefaultWebSearch: false })
    assert.equal((await unavailablePreferences.get({ surface: 'desktop' })).settings.assistantDefaultWebSearch, false, 'unrelated settings do not depend on Documents availability')
    await assert.rejects(ensureDefaultChatWorkspace(blocked), /chat folder/i)
    const setupFolder = join(documents, 'Blank setup', 'Zyra')
    const setupPreferences = new DevicePreferencesService(join(root, 'setup-preferences.json'), undefined, setupFolder)
    const setupFile = join(root, 'onboarding.json')
    const now = new Date().toISOString()
    await writeFile(setupFile, JSON.stringify({ schemaVersion: 1, flowVersion: 2, revision: 0, status: 'in-progress', currentStep: 'projects', completedSteps: ['welcome', 'connect-openai', 'appearance'], reviewActive: false, startedAt: now, updatedAt: now, completedAt: null, data: {} }))
    const setup = new OnboardingService(setupFile, setupPreferences, {} as never)
    assert.equal((await setup.initialize()).defaultProjectsFolder, setupFolder)
    const accepted = await setup.commitStep({ expectedRevision: 0, step: 'projects', selection: { projectsFolder: '  ' } })
    assert.equal(accepted.record?.currentStep, 'review', 'blank folder is accepted by the main-owned gate')
    const canonicalSetupFolder = await realpath(setupFolder)
    assert.equal(accepted.record?.data.projects?.projectsFolder, canonicalSetupFolder, 'setup stores the canonical folder, including Windows short-path aliases')
    assert.equal((await stat(setupFolder)).isDirectory(), true, 'blank setup creates the actual directory before continuing')
    assert.equal((await new OnboardingService(setupFile, setupPreferences, {} as never).initialize()).record?.data.projects?.projectsFolder, canonicalSetupFolder, 'setup resumes with its saved effective folder')
    console.log('Projectless identity, explicit legacy/CLI preservation and Documents fallback: ok')
} finally {
    await rm(root, { recursive: true, force: true })
}
