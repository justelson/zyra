import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
import { resolveAssistantWorkingDirectory } from '../src/shared/assistant/working-directory'

const directory = await mkdtemp(join(tmpdir(), 'zyra-default-folder-'))
try {
    const file = join(directory, 'preferences.json')
    const preferences = new DevicePreferencesService(file)
    await preferences.get({ surface: 'desktop' })
    assert.equal(preferences.getConfiguredProjectsFolder(), null)
    // Setup writes this shared preference; additional discovery roots are not defaults.
    await preferences.updateSharedFromMain({ projectsFolder: 'C:/work', additionalFolders: ['D:/archive'] })
    const restored = new DevicePreferencesService(file)
    await restored.get({ surface: 'desktop' })
    assert.equal(restored.getConfiguredProjectsFolder(), 'C:/work')
    const root = restored.getConfiguredProjectsFolder()
    assert.equal(resolveAssistantWorkingDirectory({}, root), 'C:/work', 'new projectless chat')
    assert.equal(resolveAssistantWorkingDirectory({ cwd: 'C:\\Users\\test\\AppData\\Roaming\\Zyra\\assistant\\global-workspace' }, root), 'C:/work', 'legacy projectless chat')
    assert.equal(resolveAssistantWorkingDirectory({ projectPath: 'D:/explicit', cwd: 'C:/old' }, root), 'D:/explicit')
    assert.equal(resolveAssistantWorkingDirectory({ workingRoot: 'D:/scope', projectPath: 'D:/explicit' }, root), 'D:/scope')
    assert.equal(resolveAssistantWorkingDirectory({ cwd: '/work/imported-chat' }, root), '/work/imported-chat', 'preserve explicit imported cwd')
    await restored.updateSharedFromMain({ projectsFolder: 'E:/new-default' })
    assert.equal(resolveAssistantWorkingDirectory({}, restored.getConfiguredProjectsFolder()), 'E:/new-default', 'updated preference needs no app restart')
    await restored.updateSharedFromMain({ projectsFolder: '' })
    assert.equal(restored.getConfiguredProjectsFolder(), null, 'do not promote an additional folder')
    assert.equal(resolveAssistantWorkingDirectory({}, null), null, 'unset setup keeps the existing safe runtime fallback')
    console.log('Setup folder persistence, projectless cwd, explicit roots and live preference changes passed')
} finally { await rm(directory, { recursive: true, force: true }) }
