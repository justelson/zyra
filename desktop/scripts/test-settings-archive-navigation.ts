import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findSettingsDestination, getSettingsCategoryDestinations } from '../src/renderer/src/pages/settings/settings-navigation'
import { SETTINGS_PAGE_VIEWS } from '../src/renderer/src/pages/settings/settings-page-views'

const read = (name: string) => readFileSync(new URL(`../src/renderer/src/${name}`, import.meta.url), 'utf8')
const archive = findSettingsDestination('/settings/assistant/archived')
assert.equal(archive?.id, 'archived')
assert.equal(archive?.parentId, undefined, 'archive is a standalone settings destination')
assert.ok(getSettingsCategoryDestinations('assistant').some((item) => item.id === 'archived'), 'archive appears in the Assistant sidebar')
assert.ok(!SETTINGS_PAGE_VIEWS.chats.some((view) => view.id === 'archived'), 'archive is not a Chats tab')
assert.equal(findSettingsDestination('/settings/data/archived')?.id, 'archived', 'old archive links still resolve')
assert.match(read('App.tsx'), /<Route path="assistant\/archived" element=\{<ArchivedChatsSettings \/>\}/)
assert.match(read('pages/settings/ArchivedChatsSettings.tsx'), /<SettingsPageContainer title="Archived chats" fillViewport>/)
assert.doesNotMatch(read('pages/settings/ArchivedChatsSettings.tsx'), /SettingsPageTabs/)
assert.doesNotMatch(read('pages/settings/DataPrivacySettings.tsx'), /Archived chats|\/settings\/assistant\/archived/)

console.log('Archived chats standalone settings navigation: ok')
