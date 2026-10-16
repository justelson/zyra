import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevicePreferencesService, sanitizeDevicePreferenceValue } from '../src/main/setup/device-preferences-service'
import { getDevicePreferenceOwnership } from '../src/shared/preferences/contracts'
import { configureShortcutOverrides, resolveShortcut, shortcutLabel } from '../src/shared/keybindings'

const directory = await mkdtemp(join(tmpdir(), 'zyra-shortcuts-'))
try {
    const file = join(directory, 'preferences.json')
    const service = new DevicePreferencesService(file)
    configureShortcutOverrides(() => service.getKeyboardShortcuts())
    assert.equal(getDevicePreferenceOwnership('keyboardShortcuts'), 'surface')
    assert.deepEqual(sanitizeDevicePreferenceValue('keyboardShortcuts', { 'app.search': ['Ctrl+J'], invalid: ['Ctrl+Q'], 'browser.reload': [] }), { 'app.search': ['Ctrl+J'], 'browser.reload': [] })
    let snapshot = await service.get({ surface: 'desktop' })
    const changed: string[][] = []
    const unsubscribe = service.subscribe(event => changed.push(event.changedKeys))
    snapshot = await service.update({ surface: 'desktop', expectedRevision: snapshot.revision, patch: { keyboardShortcuts: { 'app.search': ['Mod+Alt+J'], 'browser.reload': [] } } })
    assert.deepEqual(changed, [['keyboardShortcuts']])
    assert.equal(resolveShortcut({ key: 'k', control: true }, 'win32', 'app'), null)
    assert.equal(resolveShortcut({ key: 'j', control: true, alt: true }, 'win32', 'app'), 'app.search')
    assert.equal(shortcutLabel('browser.reload', 'win32'), '')
    const reloaded = new DevicePreferencesService(file)
    const restored = await reloaded.get({ surface: 'desktop' })
    assert.deepEqual(restored.settings.keyboardShortcuts, snapshot.settings.keyboardShortcuts, 'restart retains overrides and explicit clears')
    assert.equal((await service.get({ surface: 'browser' })).settings.keyboardShortcuts, undefined, 'desktop shortcuts do not leak into a browser-client surface')
    await assert.rejects(service.update({ surface: 'desktop', expectedRevision: 0, patch: { keyboardShortcuts: {} } }), /revision/i)
    snapshot = await service.update({ surface: 'desktop', expectedRevision: snapshot.revision, patch: { keyboardShortcuts: {} } })
    assert.equal(resolveShortcut({ key: 'k', control: true }, 'win32', 'app'), 'app.search', 'reset reaches main reader synchronously')
    assert.deepEqual(snapshot.settings.keyboardShortcuts, {})
    unsubscribe()
} finally {
    configureShortcutOverrides(() => ({}))
    await rm(directory, { recursive: true, force: true })
}
console.log('Keybinding preference authority, persistence, isolation, revision conflicts and reset: ok')
