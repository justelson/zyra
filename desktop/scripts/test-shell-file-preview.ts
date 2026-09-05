import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildQuickPreviewRoute, isQuickPreviewRoute, parseQuickPreviewFilePath, QUICK_PREVIEW_ROUTE } from '../src/shared/file-preview-route'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const main = source('main/index.ts')
const app = source('renderer/src/App.tsx')
const previewRoute = QUICK_PREVIEW_ROUTE
const redirects = new Map([...app.matchAll(/<Route path="([^"]+)" element=\{<Navigate to="([^"]+)" replace \/>\}/g)].map((match) => [match[1], match[2]]))
assert.notEqual(redirects.get(previewRoute), '/assistant', `Shell file launch emits ${previewRoute}, but the actual renderer redirects it to Chat`)
assert.match(main, /createQuickPreviewWindow\(initialShellLaunchTarget.path\)/, 'cold file launches retain dedicated window dispatch')
assert.match(main, /createQuickPreviewWindow\(shellLaunchTarget.path\)/, 'warm/macOS file launches retain dedicated window dispatch')
assert.match(main, /buildAssistantFilesShellLaunchRoute\(folderPath\)/, 'directory launches keep the existing Files workspace behavior')
assert.match(app, /if \(isQuickPreviewRoute\(window.location.hash\)\) return <QuickOpenWindow \/>/, 'the actual app root selects the standalone renderer before normal Chat providers')
const standalone = source('renderer/src/pages/QuickOpenWindow.tsx')
assert.match(standalone, /<OnboardingGate/, 'dedicated previews do not bypass setup')
assert.match(standalone, /<QuickOpen \/>/)
assert.doesNotMatch(standalone, /NormalDesktopApp|AssistantRouteShell|CommandPalette|AppContent/, 'file windows have no chat shell or chat-shaped loading screen')
const viewer = source('renderer/src/pages/QuickOpen.tsx')
assert.match(viewer, /shellMode="window"/)
const previewModal = source('renderer/src/components/ui/FilePreviewModal.tsx')
assert.match(previewModal, /const EMPTY_PREVIEW_MEDIA_ITEMS: PreviewMediaItem\[\] = \[\]/)
assert.match(previewModal, /mediaItems = EMPTY_PREVIEW_MEDIA_ITEMS/, 'omitted media lists must not create a render/history effect loop')
assert.doesNotMatch(previewModal, /mediaItems = \[\]/)
assert.match(viewer, /parseQuickPreviewFilePath\(location.search\)/)
assert.doesNotMatch(viewer, /decodeURIComponent/, 'filenames must not be decoded twice')
assert.match(viewer, /if \(!resolvePreviewType\(fileName, extension\)\)[\s\S]*return[\s\S]*openPreview/, 'unsupported shell files do not fall back into OS Open with and relaunch Zyra')

for (const path of ['C:/Projects/file with spaces.md', 'C:/Projects/literal%20name #1+&.md', 'C:/Projects/日本語 résumé %25.md', '/tmp/file?.md']) {
    const route = buildQuickPreviewRoute(path)
    assert.ok(isQuickPreviewRoute(`#${route}`))
    assert.equal(parseQuickPreviewFilePath(route.slice(route.indexOf('?'))), path)
}
assert.equal(parseQuickPreviewFilePath('?file=C%3A%2Ffile%2520name.md'), 'C:/file%20name.md')
assert.equal(parseQuickPreviewFilePath(''), null)
assert.equal(parseQuickPreviewFilePath('?file=%20'), null)
assert.equal(parseQuickPreviewFilePath('?file=a%00.md'), null)
for (const route of ['#/assistant', '#/quick-opening', '#/settings/quick-open']) assert.equal(isQuickPreviewRoute(route), false)

// Execute the actual private main-process dispatch helpers, with only OS/window APIs replaced.
const transpiler = new Bun.Transpiler({ loader: 'ts' })
const targetsSource = main.slice(main.indexOf('function resolveShellLaunchTarget('), main.indexOf('function ensureIpcHandlersRegistered('))
const appState = { isPackaged: true }
const targets = new Function('app', 'existsSync', 'statSync', `${transpiler.transformSync(targetsSource)}; return { resolveShellLaunchTarget, extractShellLaunchTargetFromArgv };`)(appState, existsSync, statSync)
const fixtureRoot = mkdtempSync(join(tmpdir(), 'zyra-shell-file-preview-'))
try {
    const file = join(fixtureRoot, 'literal%20 #1.md')
    const folder = join(fixtureRoot, 'folder')
    writeFileSync(file, '# File fixture')
    mkdirSync(folder)
    assert.deepEqual(targets.extractShellLaunchTargetFromArgv(['Zyra.exe', file]), { kind: 'file', path: file })
    assert.deepEqual(targets.resolveShellLaunchTarget(folder), { kind: 'directory', path: folder })
    appState.isPackaged = false
    assert.deepEqual(targets.extractShellLaunchTargetFromArgv(['electron', 'app-entry', file]), { kind: 'file', path: file })
    assert.equal(targets.resolveShellLaunchTarget(join(fixtureRoot, 'missing.md')), null)
    assert.equal(targets.resolveShellLaunchTarget('--zyra-background-host'), null)
} finally { rmSync(fixtureRoot, { recursive: true, force: true }) }

const calls: string[] = []
const windows: FakeWindow[] = []
class FakeWindow {
    handlers = new Map<string, () => void>()
    options: any
    minimized = false
    route = ''
    webContents = { on() {}, setWindowOpenHandler() {} }
    constructor(options: any) { this.options = options; windows.push(this) }
    on(name: string, fn: () => void) { this.handlers.set(name, fn) }
    isDestroyed() { return false }
    isMinimized() { return this.minimized }
    restore() { calls.push('restore'); this.minimized = false }
    maximize() { calls.push('maximize') }
    show() { calls.push('show') }
    focus() { calls.push('focus') }
}
const windowSource = main.slice(main.indexOf('function createQuickPreviewWindow('), main.indexOf('function captureProjectOpenAnalytics('))
const create = new Function('deps', `const { BrowserWindow, getAppIconPath, buildQuickPreviewRoute, getWindowChromeOptions, getPreloadPath, configureTrustedRendererWindow, registerEditableContextMenu, attachWindowStateEvents, lockWindowZoom, loadRendererRoute, shell } = deps; let quickPreviewWindow = null; ${transpiler.transformSync(windowSource)}; return createQuickPreviewWindow;`)({
    BrowserWindow: FakeWindow, getAppIconPath: () => null, buildQuickPreviewRoute, getWindowChromeOptions: () => ({}), getPreloadPath: () => 'fixture-preload',
    configureTrustedRendererWindow() {}, registerEditableContextMenu() {}, attachWindowStateEvents() {}, lockWindowZoom() {}, shell: { openExternal() {} },
    loadRendererRoute: (window: FakeWindow, route: string) => { window.route = route }
})
const first = create('C:/Projects/first.md') as FakeWindow
assert.equal(first.route, buildQuickPreviewRoute('C:/Projects/first.md'))
first.handlers.get('ready-to-show')?.()
assert.deepEqual(calls, ['maximize', 'show'], 'cold shell opens maximize the dedicated viewer before showing it')
assert.equal(first.options.webPreferences.sandbox, true)
assert.equal(first.options.webPreferences.contextIsolation, true)
assert.equal(first.options.webPreferences.nodeIntegration, false)
calls.length = 0
first.minimized = true
assert.equal(create('C:/Projects/second%20.md'), first)
assert.equal(windows.length, 1, 'warm shell opens reuse only the dedicated viewer')
assert.equal(first.route, buildQuickPreviewRoute('C:/Projects/second%20.md'))
assert.deepEqual(calls, ['restore', 'maximize', 'show', 'focus'])
console.log('Shell file preview: native argument classification, dedicated root route, exact paths, setup gate, cold/warm maximized windows and unsupported-file guard: ok')
