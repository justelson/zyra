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
    listAssistantDesktopSlashCommandResources,
    parseAssistantDesktopSlashCommand,
    resolveAssistantDesktopSlashCommandAction
} from '../src/renderer/src/pages/assistant/assistant-composer-utils'

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
    ['yolo', 'auto', 'edits', 'safe', 'include'],
    'the Desktop command manifest retains every intentionally supported local command'
)

const token = findAssistantComposerSlashToken('/rev', 4)
assert.deepEqual(token, { start: 0, end: 4, query: 'rev' })
assert.equal(findAssistantComposerSlashToken('Please /rev', 11), null)
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowDown', 5), 1)
assert.equal(resolveAssistantComposerCommandMenuIndex(4, 'ArrowDown', 5), 0, 'ArrowDown wraps to the first command')
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowUp', 5), 4, 'ArrowUp wraps to the last command')
assert.equal(resolveAssistantComposerCommandMenuIndex(20, 'ArrowUp', 5), 3, 'stale command indexes normalize before moving')
assert.equal(resolveAssistantComposerCommandMenuIndex(0, 'ArrowDown', 0), 0)

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
    ['/auto', '/edits', '/include', '/safe', '/yolo'],
    'built-in commands remain available while resource discovery is loading or unavailable'
)

const command = buildAssistantComposerCommandItems(resources, 'rev')[0]
assert.equal(command.value, '/review')
assert.deepEqual(
    applyAssistantComposerCommandItem('/rev', token!, command),
    { text: '/review ', cursor: 8 }
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
assert.equal(parseAssistantDesktopSlashCommand('/review this'), null, 'custom commands continue through the model-backed prompt route')

const menuId = 'assistant-command-menu-test'
const markup = renderToStaticMarkup(createElement(AssistantComposerCommandMenu, {
    menuId,
    items: allItems,
    activeIndex: 0,
    loading: false,
    error: null,
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
const rendererStylesSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const commandMenuSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerCommandMenu.tsx', import.meta.url), 'utf8')
const handlersSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-composer-handlers.ts', import.meta.url), 'utf8')
const browserAdapterSource = readFileSync(new URL('../src/renderer/src/lib/browser-assistant-bridge-adapter.ts', import.meta.url), 'utf8')
const mainPromptResourcesSource = readFileSync(new URL('../src/main/assistant/prompt-resources.ts', import.meta.url), 'utf8')
assert.match(composerSource, /aria-expanded=\{showSlashMenu\}/, 'the textarea exposes combobox expansion state')
assert.match(composerSource, /aria-activedescendant=/, 'keyboard selection exposes the active option to assistive technology')
assert.match(composerSource, /resolveAssistantComposerCommandMenuIndex/, 'composer command arrows use bounded wraparound navigation')
assert.match(composerSource, /if \(!slashToken \|\| commandActivationPendingRef\.current\) return[\s\S]*commandActivationPendingRef\.current = true/, 'Enter, Tab, and click activation must single-flight before applying a slash item')
assert.match(commandMenuSource, /scrollIntoView\(\{ block: 'nearest' \}\)/, 'composer command arrows keep the active row visible')
assert.match(commandMenuSource, /lookaheadItem/, 'down-arrow navigation scrolls one row ahead before the active row reaches the composer overlap')
assert.match(commandMenuSource, /scroll-pb-10[\s\S]*pb-10/, 'the slash menu reserves a full row below its last option')
assert.match(commandMenuSource, /onMouseMove=\{\(\) => onActiveIndexChange\(index\)\}/, 'a stationary pointer cannot override keyboard selection while commands scroll')
assert.match(handlersSource, /resolveAssistantDesktopSlashCommandAction\(desktopCommand\)/, 'typed built-ins execute before model dispatch')
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
