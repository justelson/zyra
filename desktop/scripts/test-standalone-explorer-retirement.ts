import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

const appSource = read('src/renderer/src/App.tsx')
const titleBarSource = read('src/renderer/src/components/layout/TitleBar.tsx')
const loadingRouteSource = read('src/renderer/src/components/ui/app-loading-route.ts')
const loadingSkeletonSource = read('src/renderer/src/components/ui/AppRouteSkeleton.tsx')
const projectSettingsSource = read('src/renderer/src/pages/settings/ProjectsSettings.tsx')
const settingsNavigationSource = read('src/renderer/src/pages/settings/settings-navigation.tsx')
const settingsSearchSource = read('src/renderer/src/pages/settings/settings-search.ts')

assert.doesNotMatch(appSource, /import\('\.\/pages\/Explorer'\)/, 'the retired standalone Explorer cannot remain in the renderer bundle graph')
assert.doesNotMatch(appSource, /<Explorer\s*\/>/, 'no route can render the retired standalone Explorer')
assert.match(appSource, /path="\/explorer" element=\{<RetiredExplorerRedirect \/>\}/, 'old Explorer links retire into the Assistant workspace')
assert.match(appSource, /path="\/explorer\/\*" element=\{<RetiredExplorerRedirect \/>\}/, 'old deep Explorer links preserve shell-opened folders while retiring into Assistant')
assert.match(appSource, /migrateLegacyExplorerShellLaunchRoute\(location\.pathname, location\.search\)/, 'the compatibility redirect retains valid shell-launch path and query state')
assert.doesNotMatch(titleBarSource, /pathname\.startsWith\('\/explorer'\)/, 'the title bar has no standalone Explorer identity')
assert.doesNotMatch(loadingRouteSource, /'explorer'/, 'startup no longer treats Explorer as an active screen')
assert.doesNotMatch(loadingSkeletonSource, /ExplorerRouteSkeleton|Opening Explorer|route === 'explorer'/, 'the retired screen has no loading presentation')
assert.equal(existsSync(new URL('../src/renderer/src/pages/settings/ExplorerSettings.tsx', import.meta.url)), false, 'retired Project browser preferences are removed')
assert.doesNotMatch(settingsNavigationSource, /Projects & explorer|discovery, and Explorer/, 'settings navigation no longer advertises the retired screen')
assert.doesNotMatch(settingsSearchSource, /Enable Explorer|rows\('Explorer'/, 'settings search cannot resurrect retired Explorer controls')
assert.equal(existsSync(new URL('../src/renderer/src/pages/Explorer.tsx', import.meta.url)), false, 'the standalone Explorer wrapper is removed')

assert.equal(existsSync(new URL('../src/renderer/src/pages/FolderBrowse.tsx', import.meta.url)), false, 'the unused legacy Projects page is removed')
assert.match(appSource, /path="\/projects" element=\{<Navigate to="\/assistant" replace \/>\}/, 'this change does not alter the existing legacy Projects route policy')
assert.equal(existsSync(new URL('../src/renderer/src/pages/assistant/AssistantExplorerWorkspace.tsx', import.meta.url)), true, 'Assistant Files remains intact and out of scope')
assert.doesNotMatch(projectSettingsSource, /ExplorerPreferencesSections|ProjectPresentationSettings/, 'legacy project browser preferences are no longer exposed')

console.log('Standalone Explorer retirement: ok')
