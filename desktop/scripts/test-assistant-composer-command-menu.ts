import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isBrowserAssistantBridgeMethod } from '../src/shared/browser-assistant-bridge'
import { AssistantComposerCommandMenu } from '../src/renderer/src/pages/assistant/AssistantComposerCommandMenu'
import {
    applyAssistantComposerCommandItem,
    buildAssistantComposerCommandItems,
    findAssistantComposerSlashToken,
    getAssistantComposerCommandOptionId,
    resolveAssistantComposerCommandMenuIndex
} from '../src/renderer/src/pages/assistant/assistant-composer-command-menu'
import {
    buildAssistantComposerFileSearchItems,
    findAssistantComposerIncludeToken,
    removeAssistantComposerIncludeToken
} from '../src/renderer/src/pages/assistant/assistant-composer-file-search'
import { resolveAssistantComposerMenuScrollTop } from '../src/renderer/src/pages/assistant/assistant-composer-menu-scroll'
import {
    listAssistantDesktopSlashCommandResources,
    parseAssistantDesktopSlashCommand,
    resolveAssistantDesktopSlashCommandAction
} from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import {
    readAssistantComposerUsageVisibility,
    setAssistantComposerUsageVisibility
} from '../src/renderer/src/pages/assistant/assistant-composer-usage-visibility'

const resources = {
    commands: [
        { name: 'review', description: 'Review a change', scope: 'project' as const },
        { name: 'yolo', description: 'Attempted custom override', scope: 'project' as const }
    ],
    skills: [{
        name: 'release-check',
        description: 'Verify a release',
        scope: 'personal' as const,
        disableModelInvocation: false
    }],
    diagnostics: []
}

assert.deepEqual(
    listAssistantDesktopSlashCommandResources().map((command) => command.name),
    ['yolo', 'auto', 'edits', 'safe', 'include', 'usage'],
    'the Desktop command manifest retains every intentionally supported local command'
)

const token = findAssistantComposerSlashToken('/rev', 4)
assert.deepEqual(token, { start: 0, end: 4, query: 'rev' })
const embeddedToken = findAssistantComposerSlashToken('Please /rev', 11)
assert.deepEqual(embeddedToken, { start: 7, end: 11, query: 'rev' }, 'slash suggestions follow the active token anywhere in the draft')
assert.equal(findAssistantComposerSlashToken('Open https://zyra.dev', 21), null, 'URLs cannot open the command menu')
const filesystemPathDraft = 'Use C:/workspace/app'
assert.equal(findAssistantComposerSlashToken(filesystemPathDraft, filesystemPathDraft.length), null, 'filesystem slashes cannot open the command menu')
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowDown', 5), 1)
assert.equal(resolveAssistantComposerCommandMenuIndex(4, 'ArrowDown', 5), 0, 'ArrowDown wraps to the first command')
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowUp', 5), 4, 'ArrowUp wraps to the last command')
assert.equal(resolveAssistantComposerCommandMenuIndex(20, 'ArrowUp', 5), 3, 'stale command indexes normalize before moving')
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowDown', 0), 0)
assert.equal(resolveAssistantComposerMenuScrollTop({ scrollTop: 40, viewportHeight: 120, contentHeight: 400, itemTop: 70, itemHeight: 28 }), null, 'a visible active row does not move the list')
assert.equal(resolveAssistantComposerMenuScrollTop({ scrollTop: 40, viewportHeight: 120, contentHeight: 400, itemTop: 170, itemHeight: 28 }), 84, 'an active row below the viewport moves by the minimum required distance')
assert.equal(resolveAssistantComposerMenuScrollTop({ scrollTop: 40, viewportHeight: 120, contentHeight: 400, itemTop: 125, itemHeight: 28, bottomInset: 38 }), 77, 'the selector scrolls before entering the composer-covered area')

const allItems = buildAssistantComposerCommandItems(resources, '')
for (const commandName of ['/yolo', '/auto', '/edits', '/safe', '/include', '/review']) {
    assert.equal(allItems.some((item) => item.label === commandName), true, `${commandName} remains available in the Desktop picker`)
}
assert.equal(
    allItems.find((item) => item.label === '/yolo')?.description,
    'Switch this thread to full access.',
    'custom resources cannot replace a trusted local Desktop command'
)
assert.deepEqual(
    buildAssistantComposerCommandItems(null, '').map((item) => item.label),
    ['/auto', '/edits', '/include', '/safe', '/usage', '/yolo'],
    'built-in commands remain available while resource discovery is loading or unavailable'
)

const embeddedItems = buildAssistantComposerCommandItems(resources, '', { allowStartOnlyCommands: false })
for (const commandName of ['/yolo', '/auto', '/edits', '/safe', '/usage']) {
    assert.equal(embeddedItems.some((item) => item.label === commandName), false, `${commandName} is hidden inside prompt prose`)
}
assert.equal(embeddedItems.some((item) => item.label === '/include'), true, '/include remains available inside prompt prose')
assert.equal(embeddedItems.some((item) => item.label === '/skill:release-check'), true, 'skills remain available inside prompt prose')

const includeToken = findAssistantComposerIncludeToken('Review /include src/com', 23)
assert.deepEqual(includeToken, { start: 7, end: 23, query: 'src/com' })
assert.deepEqual(removeAssistantComposerIncludeToken('Review /include src/com next', includeToken!), { text: 'Review next', cursor: 7 })

const duplicateFileItems = buildAssistantComposerFileSearchItems([
    { path: 'C:/main/src/index.ts', rootPath: 'C:/main', parentPath: 'C:/main/src', relativePath: 'src/index.ts', name: 'index.ts', type: 'file', extension: 'ts', isHidden: false, isProject: false, markers: [], frameworks: [], depth: 2 },
    { path: 'C:/docs/index.ts', rootPath: 'C:/docs', parentPath: 'C:/docs', relativePath: 'index.ts', name: 'index.ts', type: 'file', extension: 'ts', isHidden: false, isProject: false, markers: [], frameworks: [], depth: 1 }
], [
    { id: 'main', kind: 'project-home', path: 'C:/main', label: 'Main', access: 'read-write' },
    { id: 'docs', kind: 'associated-folder', path: 'C:/docs', label: 'Docs', access: 'read-only' }
])
assert.deepEqual(duplicateFileItems.map((item) => [item.rootLabel, item.showRootLabel]), [['Main', true], ['Docs', true]], 'duplicate filenames identify their Chat-scoped root')

const command = buildAssistantComposerCommandItems(resources, 'rev')[0]
assert.equal(command.value, '/review')
assert.deepEqual(
    applyAssistantComposerCommandItem('/rev', token!, command),
    { text: '/review ', cursor: 8 }
)
assert.deepEqual(
    applyAssistantComposerCommandItem('Please /rev', embeddedToken!, command),
    { text: 'Please /review ', cursor: 15 },
    'selecting a suggestion replaces only the active slash token'
)

const skill = buildAssistantComposerCommandItems(resources, 'skill:release')[0]
assert.equal(skill.value, '/skill:release-check')

assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/yolo')!),
    { type: 'runtime-mode', mode: 'full-access' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/auto')!),
    { type: 'runtime-mode', mode: 'auto-review' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/edits')!),
    { type: 'runtime-mode', mode: 'edits-only' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/safe')!),
    { type: 'runtime-mode', mode: 'approval-required' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/include src/main.ts')!),
    { type: 'include', path: 'src/main.ts', name: 'main.ts', kind: 'code' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/include')!),
    { type: 'error', message: 'Type a file path after /include.' }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/usage on')!),
    { type: 'usage-visibility', visible: true }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/usage off')!),
    { type: 'usage-visibility', visible: false }
)
assert.deepEqual(
    resolveAssistantDesktopSlashCommandAction(parseAssistantDesktopSlashCommand('/usage')!),
    { type: 'usage-visibility', visible: null },
    '/usage toggles the current Desktop preference when no argument is supplied'
)
assert.deepEqual(parseAssistantDesktopSlashCommand('/yolo fix the failing test'), {
    name: 'yolo', argument: '', remainingPrompt: 'fix the failing test'
}, 'a leading runtime command applies before the prompt that follows it')
assert.deepEqual(parseAssistantDesktopSlashCommand('/usage on explain this'), {
    name: 'usage', argument: 'on', remainingPrompt: 'explain this'
}, 'a leading usage command can update the UI before sending the remaining prompt')
assert.deepEqual(parseAssistantDesktopSlashCommand('/usage explain this'), {
    name: 'usage', argument: '', remainingPrompt: 'explain this'
}, 'usage without an explicit setting toggles before the remaining prompt')
assert.equal(parseAssistantDesktopSlashCommand('Please /usage on'), null, 'Desktop UI commands do not execute inside prompt prose')
assert.equal(parseAssistantDesktopSlashCommand('/review this'), null, 'custom commands continue through the model-backed prompt route')

const usagePreferenceValues = new Map<string, string>()
const usagePreferenceStorage = {
    getItem: (key: string) => usagePreferenceValues.get(key) ?? null,
    setItem: (key: string, value: string) => { usagePreferenceValues.set(key, value) }
}
assert.equal(readAssistantComposerUsageVisibility(usagePreferenceStorage), false, 'composer usage starts hidden for users')
assert.equal(setAssistantComposerUsageVisibility(true, usagePreferenceStorage), true)
assert.equal(readAssistantComposerUsageVisibility(usagePreferenceStorage), true)
assert.equal(setAssistantComposerUsageVisibility(null, usagePreferenceStorage), false, '/usage toggles the persisted preference')

const menuId = 'assistant-command-menu-test'
const markup = renderToStaticMarkup(createElement(AssistantComposerCommandMenu, {
    menuId,
    items: allItems,
    activeIndex: 0,
    loading: false,
    error: null,
    scrollBehavior: 'auto',
    onActiveIndexChange: () => undefined,
    onSelect: () => undefined
}))
assert.match(markup, /\/review/)
assert.match(markup, /\/skill:release-check/)
assert.match(markup, /Commands and skills/)
assert.match(markup, new RegExp(`id="${getAssistantComposerCommandOptionId(menuId, allItems[0]!.id)}"`))
assert.match(markup, /role="listbox"/)
assert.match(markup, /role="option"/)

const composerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerView.tsx', import.meta.url), 'utf8')
const composerSectionsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerSections.tsx', import.meta.url), 'utf8')
const contextIndicatorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerContextIndicator.tsx', import.meta.url), 'utf8')
const rendererStylesSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const commandMenuSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerCommandMenu.tsx', import.meta.url), 'utf8')
const fileMenuSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerFileMenu.tsx', import.meta.url), 'utf8')
const fileSearchSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantComposerFileSearch.ts', import.meta.url), 'utf8')
const menuScrollSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-composer-menu-scroll.ts', import.meta.url), 'utf8')
const conversationPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const handlersSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-composer-handlers.ts', import.meta.url), 'utf8')
const browserAdapterSource = readFileSync(new URL('../src/renderer/src/lib/browser-assistant-bridge-adapter.ts', import.meta.url), 'utf8')
const mainPromptResourcesSource = readFileSync(new URL('../src/main/assistant/prompt-resources.ts', import.meta.url), 'utf8')
assert.match(composerSource, /aria-expanded=\{showSlashMenu\}/, 'the textarea exposes combobox expansion state')
assert.match(composerSource, /aria-activedescendant=/, 'keyboard selection exposes the active option to assistive technology')
assert.match(composerSource, /resolveAssistantComposerCommandMenuIndex/, 'composer command arrows use bounded wraparound navigation')
assert.match(composerSource, /if \(!slashToken \|\| commandActivationPendingRef\.current\) return[\s\S]*commandActivationPendingRef\.current = true/, 'Enter, Tab, and click activation must single-flight before applying a slash item')
assert.doesNotMatch(commandMenuSource, /scrollIntoView|lookaheadItem/, 'command navigation has no competing document-scroll calls')
assert.match(menuScrollSource, /bottomInset: 38[\s\S]*nextTop === null[\s\S]*scrollTo\(\{ top: nextTop, behavior:/, 'the menu stays still for safely visible rows and follows rows before the composer can cover them')
assert.match(composerSource, /event\.repeat \? 'auto' : 'smooth'/, 'single-step navigation animates while held navigation keeps the selector visible')
assert.match(commandMenuSource, /movementX === 0 && event\.movementY === 0/, 'scrolling beneath a stationary pointer cannot pull keyboard highlight backward')
assert.match(commandMenuSource, /scroll-pb-10[\s\S]*pb-10/, 'the slash menu reserves a full row below its last option')
assert.match(fileMenuSource, /FileEntryIcon/, 'include results use the existing file icon language')
assert.match(fileMenuSource, /item\.name[\s\S]*text-right[\s\S]*item\.displayPath/, 'include files stay in one thin row with the relative folder aligned right')
assert.match(fileMenuSource, /item\.showRootLabel/, 'conflicting filenames show their source folder')
assert.match(fileSearchSource, /searchIndexedPaths\([\s\S]*roots:/, 'include search uses the indexed revisioned Chat roots')
assert.match(conversationPaneSource, /selectedSession\?\.chatScope\?\.roots[\s\S]*projectRoots=\{composerProjectRoots\}/, 'existing Chats keep their captured folder revision in include search')
assert.match(handlersSource, /resolveAssistantDesktopSlashCommandAction\(desktopCommand\)/, 'typed built-ins execute before model dispatch')
assert.match(handlersSource, /runtimeModeForSend = action\.mode[\s\S]*prompt = desktopCommand\.remainingPrompt[\s\S]*runtimeMode: runtimeModeForSend/, 'a leading UI command applies before the remaining prompt is dispatched')
assert.match(composerSource, /controller\.upsertAttachment[\s\S]*removeAssistantComposerIncludeToken/, 'selecting an indexed file consumes the inline include command and adds real composer context')
assert.match(handlersSource, /setAssistantComposerUsageVisibility\(action\.visible\)/, 'the usage command changes only the Desktop composer preference')
assert.match(contextIndicatorSource, /subscribeAssistantComposerUsageVisibility/, 'the mounted usage indicator follows slash-command preference changes')
assert.match(contextIndicatorSource, /data-visible=\{visible\}/, 'the usage ring stays mounted so its exit animation can complete')
assert.match(rendererStylesSource, /\.assistant-composer-footer-context\[data-visible='false'\][^}]*width:\s*0/s, 'hidden usage collapses its footer width')
assert.match(rendererStylesSource, /\.assistant-composer-footer-context\[data-visible='false'\][^}]*opacity:\s*0/s, 'hidden usage animates out instead of disappearing abruptly')
assert.equal(isBrowserAssistantBridgeMethod('listPromptResources'), false, 'remote Browser clients cannot enumerate private prompt resources')
assert.equal(isBrowserAssistantBridgeMethod('getSkillSourceOverview'), false, 'remote Browser clients cannot inspect private skill folders')
assert.equal(isBrowserAssistantBridgeMethod('updateSkillSourceSettings'), false, 'remote Browser clients cannot change local skill sources')
assert.match(browserAdapterSource, /Commands and skills are available only in trusted Zyra Desktop windows\./)
assert.match(browserAdapterSource, /Skill sources can be managed only in Zyra Desktop\./)
assert.match(mainPromptResourcesSource, /PROMPT_RESOURCE_CACHE_MAX_PROJECTS = 24/, 'main discovery cache has a fixed project bound')
assert.match(mainPromptResourcesSource, /if \(forceRefresh\) promptResourceCache\.delete\(key\)/, 'trusted callers can force a resource refresh')
assert.match(composerSource, /PROMPT_RESOURCE_CACHE_MAX_PROJECTS = 24/, 'renderer discovery cache cannot grow across unbounded project keys')
assert.match(composerSectionsSource, /relative inline-flex h-7 w-fit min-w-0 max-w-full/, 'the model and speed trigger must not claim the footer spacer as a click target')
assert.match(rendererStylesSource, /\.assistant-composer-footer-access-control\s*\{[\s\S]*?width:\s*var\(--assistant-access-expanded-width\);/, 'permission pill widths remain state-driven so transitions can interpolate')
assert.match(composerSectionsSource, /transition-\[width,height,padding,gap,color,background-color,border-color\]/, 'permission mode changes must animate the pill width')
for (const width of ['104px', '68px', '72px', '64px']) {
    assert.match(composerSectionsSource, new RegExp(`pillWidth: '${width}'`), `permission mode keeps its ${width} animated width`)
}
for (const color of ['emerald', 'sky', 'amber', 'rose']) {
    assert.match(composerSectionsSource, new RegExp(`border-${color}-400`), `permission mode ${color} remains visually distinct`)
}

console.log('Assistant composer command menu: ok')
