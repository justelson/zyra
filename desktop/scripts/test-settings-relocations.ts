import assert from 'node:assert/strict'
import { createSettingsRowTargetId, createSettingsSectionTargetId, findAllSettingsSearchMatches, resolveSettingsSearchLocation } from '../src/renderer/src/pages/settings/settings-search'

const cases = [
    { oldPage: 'assistant', section: 'Voice transcription', label: 'Voice input', route: '/settings/assistant/voice' },
    { oldPage: 'assistant', section: 'Voice transcription', label: 'ChatGPT transcription', route: '/settings/assistant/voice' },
    { oldPage: 'providers', section: 'Providers', label: 'Default Git AI provider', route: '/settings/workspace/source-control' },
    { oldPage: 'providers', section: 'Zyra · ChatGPT', label: 'Commit model', route: '/settings/workspace/source-control' },
    { oldPage: 'providers', section: 'Zyra · ChatGPT', label: 'Pull-request model', route: '/settings/workspace/source-control' }
]
for (const entry of cases) {
    const targetId = createSettingsRowTargetId(entry.section, entry.label)
    assert.deepEqual(resolveSettingsSearchLocation(entry.oldPage, targetId), { pathname: entry.route, targetId }, 'old exact-setting links follow the real control')
    assert.ok(findAllSettingsSearchMatches(entry.label).some(match => match.destination.to === entry.route && match.target?.targetId === targetId), 'global search returns the new owner')
}
assert.deepEqual(resolveSettingsSearchLocation('providers', createSettingsSectionTargetId('Zyra · ChatGPT')), { pathname: '/settings/workspace/source-control', targetId: createSettingsSectionTargetId('Text generation') })
assert.deepEqual(resolveSettingsSearchLocation('assistant', createSettingsSectionTargetId('Voice transcription')), { pathname: '/settings/assistant/voice', targetId: createSettingsSectionTargetId('Voice transcription') })
const theme = createSettingsRowTargetId('Theme', 'UI font')
assert.deepEqual(resolveSettingsSearchLocation('appearance', theme), { pathname: '/settings/app/appearance', targetId: theme }, 'unmoved controls keep their location')
assert.equal(resolveSettingsSearchLocation('appearance', 'settings-row-custom-unknown'), null, 'unknown/custom targets must not be guessed')
console.log('Settings relocations: Voice and Git controls, legacy row/section links, global search and unchanged targets: ok')
