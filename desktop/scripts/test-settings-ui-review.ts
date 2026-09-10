import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { paginateSettingsItems } from '../src/renderer/src/pages/settings/settings-list-page'
import { getSettingsSearchKeyAction } from '../src/renderer/src/pages/settings/settings-search-keyboard'
import { getSettingsUpdateAction } from '../src/renderer/src/pages/settings/settings-update-action'
import { SETTINGS_NAVIGATION_ITEMS, settingsNavigationItemMatchesPath } from '../src/renderer/src/pages/settings/settings-navigation'

const items = Array.from({ length: 25 }, (_, id) => ({ id, name: 'Same name' }))
const pages = [0, 1, 2].map(index => paginateSettingsItems(items, index))
assert.deepEqual(pages.flatMap(page => page.items).map(item => item.id), items.map(item => item.id), 'paging preserves every identity and original order')
assert.deepEqual(pages.map(page => [page.start, page.end]), [[1,12],[13,24],[25,25]])
assert.equal(paginateSettingsItems(items.slice(0, 1), 9).page, 0, 'filtering cannot leave the view on an empty out-of-range page')
assert.equal(paginateSettingsItems([], 8).start, 0)
assert.equal(paginateSettingsItems(items, Infinity, NaN).items.length, 12)
assert.deepEqual(getSettingsSearchKeyAction('Enter', 3, -1, true), { type: 'activate', index: 0 })
assert.deepEqual(getSettingsSearchKeyAction('ArrowDown', 3, 2, false), { type: 'focus', index: 0 })
assert.deepEqual(getSettingsSearchKeyAction('ArrowUp', 3, -1, true), { type: 'focus', index: 2 })
assert.deepEqual(getSettingsSearchKeyAction('Escape', 0, -1, true), { type: 'clear' })
assert.equal(getSettingsSearchKeyAction('Home', 3, -1, true), null, 'input caret navigation is preserved')
assert.equal(getSettingsSearchKeyAction('Enter', 3, 1, false), null, 'focused links keep native activation')
assert.equal(getSettingsUpdateAction('available', true, false).id, 'download')
assert.equal(getSettingsUpdateAction('downloaded', true, false).id, 'install')
for (const status of ['checking', 'downloading', 'unknown']) assert.equal(getSettingsUpdateAction(status, true, false).disabled, true)
assert.equal(getSettingsUpdateAction('downloaded', false, false).disabled, true)
assert.equal(getSettingsUpdateAction('available', true, true).disabled, true)
assert.equal(getSettingsUpdateAction('up-to-date', true, false).disabled, false)
assert.deepEqual(SETTINGS_NAVIGATION_ITEMS.filter(item => settingsNavigationItemMatchesPath(item, '/settings/assistant/providers')).map(item => item.id), ['account'], 'a moved legacy page belongs to only its current category')

const root = join(import.meta.dir, '../src/renderer/src/pages/settings')
const files: string[] = []
const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (path.endsWith('.tsx') || path.endsWith('.ts')) files.push(path)
    }
}
walk(root)
files.push(join(root, '../Settings.tsx'), join(root, '../../App.tsx'), join(root, '../../components/ui/FileActionsMenu.tsx'))
for (const file of files) {
    const source = readFileSync(file, 'utf8')
    new Bun.Transpiler({ loader: file.endsWith('.tsx') ? 'tsx' : 'ts' }).transformSync(source)
    for (const match of source.matchAll(/\bdescription="([^"]+)"/g)) {
        assert.ok((match[1].match(/\.(?:\s|$)/g) || []).length <= 1, `${file}: normal descriptions must be a single sentence`)
    }
}
const providers = readFileSync(join(root, 'AISettings.tsx'), 'utf8')
const saveKey = providers.split('const saveHostedKey')[1].split('const clearHostedKeys')[0]
assert.doesNotMatch(saveKey, /\[provider\]: 'success'/, 'saving a credential must not claim the connection was verified')
assert.doesNotMatch(providers, /useCodexModelOptions|updateSettings\(\{ commitAIProvider/, 'provider credentials no longer own Git model preferences')
const redirect = readFileSync(join(root, 'SettingsRedirect.tsx'), 'utf8')
assert.match(redirect, /pathname: to, search, hash/, 'legacy navigation preserves exact-setting links')
console.log(`Settings UI review: list identity/bounds, keyboard search, update gating, legacy ownership, truthful key status and ${files.length} source files: ok`)
