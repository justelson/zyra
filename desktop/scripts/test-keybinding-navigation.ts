import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectiveBindings } from '../src/shared/keybindings'
import { dispatchAppNavigation } from '../src/renderer/src/lib/app-navigation'
import { acknowledgeAssistantInspectorNavigation, subscribeAssistantInspectorNavigation, type AssistantInspectorNavigationRequest } from '../src/renderer/src/pages/assistant/assistant-inspector-navigation'
import { requestAssistantComposerFocus, subscribeAssistantComposerFocus } from '../src/renderer/src/pages/assistant/assistant-composer-focus'
import { subscribeAssistantConversationFind } from '../src/renderer/src/pages/assistant/assistant-conversation-find'
import { subscribeAssistantFileSave } from '../src/renderer/src/pages/assistant/assistant-file-save-requests'

const routes: string[] = []
const events: string[] = []
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event: Event) => { events.push(event.type); return true } } })
const navigate = ((route: string) => { routes.push(route) }) as Parameters<typeof dispatchAppNavigation>[1]
try {
    dispatchAppNavigation('app.shortcuts', navigate)
    assert.equal(routes.at(-1), '/settings/app/keyboard-shortcuts')
    dispatchAppNavigation('app.sidebar', navigate)
    assert.equal(events.at(-1), 'zyra:toggle-assistant-sidebar')
    dispatchAppNavigation('app.chat', navigate)
    assert.equal(routes.at(-1), '/assistant')
    dispatchAppNavigation('app.files', navigate)
    const requests: AssistantInspectorNavigationRequest[] = []
    const unsubscribe = subscribeAssistantInspectorNavigation(request => { requests.push(request); acknowledgeAssistantInspectorNavigation(request) })
    assert.deepEqual(requests.pop(), { workspace: 'explorer' }, 'workspace intent survives route loading')
    for (const [id, workspace] of [['app.browser', 'browser'], ['app.terminal', 'terminal'], ['app.review', 'review']] as const) {
        dispatchAppNavigation(id, navigate)
        assert.deepEqual(requests.pop(), { workspace })
    }
    for (const [id, workspace, binding] of [
        ['app.threadDetails', 'control', 'Ctrl+Alt+d'],
        ['app.resources', 'resources', 'Ctrl+Alt+6'],
        ['app.agents', 'agents', 'Ctrl+Alt+7']
    ] as const) {
        dispatchAppNavigation(id, navigate)
        assert.deepEqual(requests.pop(), { workspace }, `${id} opens the matching Inspector workspace`)
        assert.deepEqual(effectiveBindings(id, 'win32', {}), [binding], `${id} exposes its documented shortcut`)
    }
    const activeThreadRoute = '/assistant/chat/session-current/thread/thread-current'
    for (const [id, workspace] of [
        ['app.threadDetails', 'control'],
        ['app.resources', 'resources'],
        ['app.agents', 'agents']
    ] as const) {
        routes.length = 0
        routes.push(activeThreadRoute)
        dispatchAppNavigation(id, navigate, activeThreadRoute)
        assert.equal(routes.at(-1), activeThreadRoute, `${id} preserves the active thread route`)
        assert.deepEqual(requests.pop(), { workspace }, `${id} still requests its Inspector workspace`)
    }
    routes.length = 0
    dispatchAppNavigation('app.threadDetails', navigate, '/settings/providers')
    assert.deepEqual(routes, ['/assistant'], 'workspace shortcuts from outside chat enter the Assistant route')
    assert.deepEqual(requests.pop(), { workspace: 'control' })
    for (const [id, workspace] of [['app.toggleFiles', 'explorer'], ['app.toggleBrowser', 'browser'], ['app.toggleTerminal', 'terminal'], ['app.toggleInspector', 'review']] as const) {
        dispatchAppNavigation(id, navigate)
        assert.deepEqual(requests.pop(), { workspace, toggle: true })
    }
    let findRequests = 0
    const stopFind = subscribeAssistantConversationFind(() => { findRequests++; return true })
    dispatchAppNavigation('app.findInChat', navigate)
    assert.equal(findRequests, 1)
    stopFind()
    for (const [command, binding] of [['app.searchFiles', 'Ctrl+p'], ['app.searchProjectContents', 'Ctrl+Shift+f']] as const) {
        const before = routes.length
        dispatchAppNavigation(command, navigate, activeThreadRoute)
        assert.equal(events.at(-1), 'zyra:quick-open')
        assert.equal(routes.length, before, 'search overlays preserve the current chat route')
        assert.deepEqual(effectiveBindings(command, 'win32', {}), [binding])
    }
    let saveRequests = 0
    const stopSave = subscribeAssistantFileSave(() => { saveRequests++; return true })
    dispatchAppNavigation('app.saveFile', navigate)
    assert.equal(saveRequests, 1)
    stopSave()
    for (const [id, action] of [['app.nextWorkspaceTab', 'next'], ['app.previousWorkspaceTab', 'previous'], ['app.closeWorkspaceTab', 'close']] as const) {
        dispatchAppNavigation(id, navigate)
        assert.deepEqual(requests.pop(), { workspace: 'tabs', action })
    }
    unsubscribe()
    dispatchAppNavigation('app.composer', navigate)
    let focused = 0
    const stopFocus = subscribeAssistantComposerFocus(() => { focused++; return true })
    assert.equal(focused, 1, 'composer receives pending focus on mount')
    requestAssistantComposerFocus()
    assert.equal(focused, 2)
    stopFocus()
    const second = subscribeAssistantComposerFocus(() => { focused++; return true })
    assert.equal(focused, 2, 'consumed focus does not repeat on remount')
    second()
    const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
    assert.match(source('renderer/src/lib/keybindings.ts'), /subscribeAppNavigationShortcuts[\s\S]*event\.stopPropagation\(\)[\s\S]*}, true\)/, 'navigation captures before xterm can consume the escape gesture')
    assert.match(source('renderer/src/components/layout/AppMenuCommandHost.tsx'), /onCommand\?\.\(command => dispatchAppNavigation\(command, navigate, pathname\)\)/, 'native shortcut commands retain the current route through IPC')
    assert.match(source('renderer/src/components/layout/AppMenuCommandHost.tsx'), /subscribeAppNavigationShortcuts\(command => dispatchAppNavigation\(command, navigate, pathname\)\)/, 'renderer fallback shortcuts retain the current route')
    assert.match(source('renderer/src/components/CommandPalette.tsx'), /dispatchAppNavigation\(id, navigate, location\.pathname\)/, 'palette workspace actions retain the current route')
    assert.match(source('renderer/src/components/layout/TitleBar.tsx'), /shortcut: shortcut\('app\.search'\)\.split\(' \/ '\)\[0\]/, 'the Search menu shows one active shortcut while alternate bindings remain available')
    const inspectorPanel = source('renderer/src/pages/assistant/AssistantDiffPanel.tsx')
    assert.match(inspectorPanel, /request\.workspace === 'tabs'[\s\S]*handleCloseTab[\s\S]*handleSelectTab/, 'tab navigation uses existing lifecycle handlers')
    assert.match(inspectorPanel, /request\.workspace === 'control'[\s\S]*handleOpenThreadDetailsWorkspace/, 'Thread Details requests open the current Inspector workspace')
    assert.match(inspectorPanel, /request\.workspace === 'resources'[\s\S]*handleOpenResourcesWorkspace/, 'Resources requests open the current Inspector workspace')
    assert.match(inspectorPanel, /request\.workspace !== 'agents'[\s\S]*openSingletonWorkspace\(AGENTS_TAB\)/, 'Agents requests open the current Inspector workspace')
    const inspectorSidebar = source('renderer/src/pages/assistant/AssistantInspectorSidebar.tsx')
    assert.match(inspectorSidebar, /tabs\.length === 0[\s\S]*addTabItems\.map[\s\S]*void item\.onSelect\(\)/, 'the empty Inspector offers the same live actions as the add-tab menu')
    assert.match(inspectorSidebar, /flex-wrap justify-center[\s\S]*flexBasis: 'calc\(\(100% - 1\.5rem\) \/ 3\)'/, 'empty-state actions form a centered three-column grid')
    assert.match(inspectorSidebar, /shortcutLabel\(commandId\)\.split\(' \/ '\)\[0\]/, 'each empty-state action shows its configured keyboard shortcut')
    assert.match(inspectorSidebar, /rounded-\[4px\][\s\S]*?<ShortcutKeycaps id=\{commandId\} platform=\{shortcutPlatform\(\)\} overrides=\{settings.keyboardShortcuts\}[\s\S]*?<\/button>/, 'sharp-cornered tiles use shared per-key caps with effective platform overrides')
    assert.match(source('renderer/src/pages/assistant/AssistantComposerView.tsx'), /useAssistantComposerFocus\([\s\S]*sessionId: controller\.loadedSessionId/)
    assert.match(source('renderer/src/pages/assistant/useAssistantComposerFocus.ts'), /subscribeAssistantComposerFocus[\s\S]*textarea\.focus\(\)/)
    assert.match(source('main/native-overlay-manager.ts'), /prepareAppShortcutInput\(contents, input, owner\.contents\)/)
    console.log('Navigation dispatch, deferred workspace/composer intent and capture wiring: ok')
} finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
}
