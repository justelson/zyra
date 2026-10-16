import type { BrowserShortcutAction } from './browser-shortcuts'

export type ShortcutPlatform = 'darwin' | 'win32' | 'linux'
export type ShortcutInput = { type?: string; key?: string; code?: string; control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; isAutoRepeat?: boolean; isComposing?: boolean }
export type ShortcutScope = 'app' | 'shell' | 'browser' | 'terminal' | 'navigation'
type Definition = { id: string; label: string; scope: ShortcutScope; defaults: readonly string[]; mac?: readonly string[]; action?: BrowserShortcutAction; group?: 'chats' | 'panels' | 'files' }
const browser = <T extends string>(id: T, label: string, defaults: string[], action: BrowserShortcutAction, mac?: string[]) => ({ id, label, scope: 'browser' as const, defaults, action, mac })
export const COMMANDS = [
    { id: 'app.search', label: 'Command palette', scope: 'app', defaults: ['Mod+K', 'Mod+Shift+P'] },
    { id: 'app.newChat', label: 'New chat', scope: 'app', defaults: ['Mod+N'] },
    { id: 'app.settings', label: 'Settings', scope: 'app', defaults: ['Mod+,'] },
    { id: 'app.shortcuts', label: 'Keyboard shortcuts settings', scope: 'app', defaults: ['Mod+Alt+,', 'Mod+/'] },
    { id: 'app.plugins', label: 'Open Plugins', scope: 'app', defaults: ['Mod+Alt+P'] },
    { id: 'app.newProject', label: 'New project', scope: 'app', defaults: ['Mod+Shift+N'] },
    { id: 'app.themeSearch', label: 'Choose theme', scope: 'app', defaults: ['Mod+Alt+H'] },
    { id: 'app.usageSearch', label: 'Show usage', scope: 'app', defaults: ['Mod+Alt+U'] },
    { id: 'app.actionSearch', label: 'Search current view actions', scope: 'app', defaults: ['Mod+Alt+A'] },
    { id: 'app.sidebar', label: 'Toggle sidebar', scope: 'app', defaults: ['Mod+Alt+B', 'Mod+B'] },
    { id: 'app.chat', label: 'Go to chat', scope: 'app', defaults: ['Mod+Alt+1'] },
    { id: 'app.composer', label: 'Focus message composer', scope: 'app', defaults: ['Mod+Alt+M'] },
    { id: 'app.nextChat', label: 'Next chat', scope: 'app', group: 'chats', defaults: ['Mod+Shift+]'] },
    { id: 'app.previousChat', label: 'Previous chat', scope: 'app', group: 'chats', defaults: ['Mod+Shift+['] },
    { id: 'app.chat1', label: 'Go to chat 1', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+1'] },
    { id: 'app.chat2', label: 'Go to chat 2', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+2'] },
    { id: 'app.chat3', label: 'Go to chat 3', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+3'] },
    { id: 'app.chat4', label: 'Go to chat 4', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+4'] },
    { id: 'app.chat5', label: 'Go to chat 5', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+5'] },
    { id: 'app.chat6', label: 'Go to chat 6', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+6'] },
    { id: 'app.chat7', label: 'Go to chat 7', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+7'] },
    { id: 'app.chat8', label: 'Go to chat 8', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+8'] },
    { id: 'app.chat9', label: 'Go to chat 9', scope: 'app', group: 'chats', defaults: ['Mod+Alt+Shift+9'] },
    { id: 'app.files', label: 'Open Files workspace', scope: 'app', defaults: ['Mod+Alt+2'] },
    { id: 'app.browser', label: 'Open Browser workspace', scope: 'app', defaults: ['Mod+Alt+3'] },
    { id: 'app.review', label: 'Open Review workspace', scope: 'app', defaults: ['Mod+Alt+4'] },
    { id: 'app.terminal', label: 'Open Terminal workspace', scope: 'app', defaults: ['Mod+Alt+T'] },
    { id: 'app.threadDetails', label: 'Open Thread Details workspace', scope: 'app', defaults: ['Mod+Alt+D'] },
    { id: 'app.resources', label: 'Open Resources workspace', scope: 'app', defaults: ['Mod+Alt+6'] },
    { id: 'app.agents', label: 'Open Agents workspace', scope: 'app', defaults: ['Mod+Alt+7'] },
    { id: 'app.toggleFiles', label: 'Toggle Files panel', scope: 'app', group: 'panels', defaults: ['Mod+Shift+E'] },
    { id: 'app.toggleBrowser', label: 'Toggle Browser panel', scope: 'app', group: 'panels', defaults: ['Mod+Shift+B'] },
    { id: 'app.toggleTerminal', label: 'Toggle Terminal panel', scope: 'app', group: 'panels', defaults: ['Mod+`'] },
    { id: 'app.toggleInspector', label: 'Toggle review panel', scope: 'app', group: 'panels', defaults: ['Mod+Alt+R'] },
    { id: 'app.findInChat', label: 'Find in chat', scope: 'app', defaults: ['Mod+F'] },
    { id: 'app.searchFiles', label: 'Quick Open file', scope: 'app', group: 'files', defaults: ['Mod+P'] },
    { id: 'app.searchProjectContents', label: 'Search text in project files', scope: 'app', group: 'files', defaults: ['Mod+Shift+F'] },
    { id: 'app.saveFile', label: 'Save file', scope: 'app', group: 'files', defaults: ['Mod+S'] },
    { id: 'app.stopTurn', label: 'Stop the running turn', scope: 'app', defaults: ['Mod+.'] },
    { id: 'app.nextWorkspaceTab', label: 'Next workspace tab', scope: 'app', defaults: ['Mod+Alt+PageDown'] },
    { id: 'app.previousWorkspaceTab', label: 'Previous workspace tab', scope: 'app', defaults: ['Mod+Alt+PageUp'] },
    { id: 'app.closeWorkspaceTab', label: 'Close workspace tab', scope: 'app', defaults: ['Mod+Alt+W'] },
    { id: 'app.reload', label: 'Reload UI', scope: 'shell', defaults: ['Mod+R'] },
    { id: 'app.devtools', label: 'Developer tools', scope: 'app', defaults: ['Ctrl+Shift+I'], mac: ['Meta+Alt+I'] },
    { id: 'app.loadingPreview', label: 'Loading preview (development)', scope: 'app', defaults: ['Mod+Shift+L'] },
    { id: 'navigation.back', label: 'Go back', scope: 'navigation', defaults: ['Alt+ArrowLeft'] },
    { id: 'navigation.forward', label: 'Go forward', scope: 'navigation', defaults: ['Alt+ArrowRight'] },
    { id: 'terminal.new', label: 'New terminal', scope: 'terminal', defaults: ['Mod+Shift+`'] },
    { id: 'terminal.splitHorizontal', label: 'Split terminal horizontally', scope: 'terminal', defaults: ['Mod+Shift+5'] },
    { id: 'terminal.splitVertical', label: 'Split terminal vertically', scope: 'terminal', defaults: ['Mod+Alt+5'] },
    { id: 'terminal.close', label: 'Close terminal', scope: 'terminal', defaults: ['Mod+Shift+W'] },
    { id: 'terminal.clear', label: 'Clear terminal', scope: 'terminal', defaults: ['Mod+Shift+K'] },
    { id: 'terminal.restart', label: 'Restart terminal', scope: 'terminal', defaults: ['Mod+Alt+Shift+R'] },
    { id: 'browser.history', label: 'Browser history', scope: 'browser', defaults: ['Mod+H'] },
    { id: 'browser.downloads', label: 'Browser downloads', scope: 'browser', defaults: ['Mod+J'] },
    { id: 'browser.screenshot', label: 'Capture Browser screenshot', scope: 'browser', defaults: ['Mod+Shift+S'] },
    browser('browser.newTab', 'New Browser tab', ['Mod+T'], { type: 'new-tab' }),
    browser('browser.closeTab', 'Close Browser tab', ['Mod+W'], { type: 'close-tab' }),
    browser('browser.reopenTab', 'Reopen closed Browser tab', ['Mod+Shift+T'], { type: 'reopen-closed-tab' }),
    browser('browser.address', 'Focus Browser address', ['Mod+L'], { type: 'focus-address' }),
    browser('browser.openFile', 'Open file in Browser', ['Mod+O'], { type: 'open-file' }),
    browser('browser.reload', 'Reload Browser page', ['Mod+R', 'F5'], { type: 'reload', bypassCache: false }),
    browser('browser.hardReload', 'Reload Browser page without cache', ['Mod+Shift+R', 'Shift+F5'], { type: 'reload', bypassCache: true }),
    browser('browser.nextTab', 'Next Browser tab', ['Ctrl+Tab', 'Mod+PageDown'], { type: 'next-tab' }, ['Ctrl+Tab', 'Mod+PageDown', 'Mod+Alt+ArrowRight']),
    browser('browser.previousTab', 'Previous Browser tab', ['Ctrl+Shift+Tab', 'Mod+PageUp'], { type: 'previous-tab' }, ['Ctrl+Shift+Tab', 'Mod+PageUp', 'Mod+Alt+ArrowLeft']),
    browser('browser.back', 'Browser back', ['Alt+ArrowLeft'], { type: 'back' }, ['Alt+ArrowLeft', 'Mod+[']),
    browser('browser.forward', 'Browser forward', ['Alt+ArrowRight'], { type: 'forward' }, ['Alt+ArrowRight', 'Mod+]']),
    browser('browser.devtools', 'Browser tab developer tools', ['F12'], { type: 'devtools' }),
    browser('browser.fullscreen', 'Browser fullscreen', ['F11'], { type: 'toggle-fullscreen' }),
    browser('browser.tab1', 'Browser tab 1', ['Mod+1'], { type: 'select-tab', index: 0 }),
    browser('browser.tab2', 'Browser tab 2', ['Mod+2'], { type: 'select-tab', index: 1 }),
    browser('browser.tab3', 'Browser tab 3', ['Mod+3'], { type: 'select-tab', index: 2 }),
    browser('browser.tab4', 'Browser tab 4', ['Mod+4'], { type: 'select-tab', index: 3 }),
    browser('browser.tab5', 'Browser tab 5', ['Mod+5'], { type: 'select-tab', index: 4 }),
    browser('browser.tab6', 'Browser tab 6', ['Mod+6'], { type: 'select-tab', index: 5 }),
    browser('browser.tab7', 'Browser tab 7', ['Mod+7'], { type: 'select-tab', index: 6 }),
    browser('browser.tab8', 'Browser tab 8', ['Mod+8'], { type: 'select-tab', index: 7 }),
    browser('browser.lastTab', 'Last Browser tab', ['Mod+9'], { type: 'select-tab', index: 'last' })
] as const satisfies readonly Definition[]
export type CommandId = typeof COMMANDS[number]['id']
/** Missing = platform defaults; [] = explicitly disabled. */
export type ShortcutOverrides = Partial<Record<CommandId, string[]>>
const modifiers = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const
function keyName(value: string): string {
    const key = value.toLowerCase()
    return ({ left: 'arrowleft', right: 'arrowright', 'page-up': 'pageup', 'page-down': 'pagedown', esc: 'escape', ' ': 'space' } as Record<string, string>)[key] || key
}
export function normalizeBinding(value: string, platform: ShortcutPlatform): string | null {
    const parts = value.replace(/Mod/g, platform === 'darwin' ? 'Meta' : 'Ctrl').split('+')
    const key = keyName(parts.pop() || '')
    if (!/^(?:[a-z0-9,./;\[\]\\'`=-]|f(?:[1-9]|1[0-9]|2[0-4])|arrow(?:left|right|up|down)|pageup|pagedown|home|end|tab|space|enter|backspace|delete)$/.test(key)) return null
    if (parts.some(part => !modifiers.includes(part as typeof modifiers[number])) || new Set(parts).size !== parts.length) return null
    // Plain typing and standard editing keys must remain available to text surfaces.
    if (!parts.some(part => part === 'Ctrl' || part === 'Meta' || part === 'Alt') && !/^f\d+$/.test(key)) return null
    return [...modifiers.filter(mod => parts.includes(mod)), key].join('+')
}
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrides {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const result: ShortcutOverrides = {}
    for (const { id } of COMMANDS) {
        if (!Object.prototype.hasOwnProperty.call(value, id)) continue
        const bindings = (value as Record<string, unknown>)[id]
        if (!Array.isArray(bindings) || bindings.length > 4) continue
        if (!bindings.every(binding => typeof binding === 'string' && binding.length < 80 && normalizeBinding(binding, 'win32') && normalizeBinding(binding, 'darwin'))) continue
        result[id] = [...new Set(bindings as string[])]
    }
    return result
}
let readOverrides: () => ShortcutOverrides = () => ({})
let shortcutsSuspended = false
export function suspendShortcuts(suspended: boolean): void { shortcutsSuspended = suspended }
/** Each process installs its own preference-backed reader; no disk/IPC in input handlers. */
export function configureShortcutOverrides(reader: () => ShortcutOverrides): void { readOverrides = reader }
export function effectiveBindings(id: CommandId, platform: ShortcutPlatform, overrides = readOverrides()): string[] {
    const command: Definition = COMMANDS.find(command => command.id === id)!
    const bindings = overrides[id] ?? (platform === 'darwin' ? command.mac ?? command.defaults : command.defaults)
    return [...new Set(bindings.map(binding => normalizeBinding(binding, platform)).filter((binding): binding is string => Boolean(binding)))]
}
export function inputBinding(input: ShortcutInput): string | null {
    if (input.isComposing || input.isAutoRepeat || (input.type && !['keydown', 'keyDown'].includes(input.type))) return null
    let key = keyName(input.key || '')
    // KeyboardEvent.key reflects Shift (%, ~, +); preserve the existing physical
    // terminal defaults and record a binding that the matcher can replay.
    if ((input.shift || input.alt) && input.code) {
        if (/^Digit[0-9]$/.test(input.code)) key = input.code.slice(5)
        else if (input.alt && (input.control || input.meta) && /^Key[A-Z]$/.test(input.code) && !/^[a-z]$/.test(key)) key = input.code.slice(3).toLowerCase()
        else key = ({ Backquote: '`', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' } as Record<string, string>)[input.code] || key
    }
    return normalizeBinding([
        input.control && 'Ctrl', input.meta && 'Meta', input.alt && 'Alt', input.shift && 'Shift', key
    ].filter(Boolean).join('+'), 'win32')
}
function scopesOverlap(left: ShortcutScope, right: ShortcutScope): boolean {
    return left === right || left === 'app' || right === 'app'
        || (left === 'shell' && right === 'navigation') || (left === 'navigation' && right === 'shell')
}
export function resolveShortcut(input: ShortcutInput, platform: ShortcutPlatform, scope: ShortcutScope, overrides = readOverrides()): CommandId | null {
    if (shortcutsSuspended) return null
    const binding = inputBinding(input)
    if (!binding) return null
    // Ambiguous imported preferences fail closed instead of dispatching two actions.
    const matches = COMMANDS.filter(command => scopesOverlap(command.scope, scope) && effectiveBindings(command.id, platform, overrides).includes(binding))
    if (matches.length !== 1 || matches[0]!.scope !== scope) return null
    return matches[0]!.id
}
export function isManagedShortcutInput(input: ShortcutInput, platform: ShortcutPlatform): boolean {
    const binding = inputBinding(input)
    return Boolean(binding && COMMANDS.some(command => effectiveBindings(command.id, platform).includes(binding) || effectiveBindings(command.id, platform, {}).includes(binding)))
}
export function bindingConflicts(id: CommandId, binding: string, platform: ShortcutPlatform, overrides = readOverrides()): CommandId[] {
    const normalized = normalizeBinding(binding, platform)
    const scope = COMMANDS.find(command => command.id === id)!.scope
    return COMMANDS.filter(command => command.id !== id && scopesOverlap(command.scope, scope) && effectiveBindings(command.id, platform, overrides).includes(normalized || '')).map(command => command.id)
}
export function shortcutLabel(id: CommandId, platform: ShortcutPlatform, overrides = readOverrides()): string {
    return effectiveBindings(id, platform, overrides).map(binding => binding.split('+').map(part => {
        if (part === 'Meta') return platform === 'darwin' ? '⌘' : 'Super'
        if (part === 'Alt') return platform === 'darwin' ? '⌥' : 'Alt'
        if (part === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift'
        if (part === 'Ctrl') return platform === 'darwin' ? '⌃' : 'Ctrl'
        return ({ arrowleft: '←', arrowright: '→', pageup: 'PageUp', pagedown: 'PageDown' } as Record<string, string>)[part] || part.toUpperCase()
    }).join(platform === 'darwin' ? '' : '+')).join(' / ')
}
export function shortcutAccelerator(id: CommandId, platform: ShortcutPlatform): string | undefined {
    return effectiveBindings(id, platform)[0]?.replace('Meta+', 'Command+').replace('arrowleft', 'Left').replace('arrowright', 'Right')
}
export const KEYBINDING_RECORDING_CHANNEL = 'zyra:keybindings:recording'
export const KEYBINDING_COMMAND_CHANNEL = 'zyra:keybindings:command'
export const KEYBINDING_DISPATCH_CHANNEL = 'zyra:keybindings:dispatch'
// Renderer-dispatched app commands: navigation plus chat, panel and editor actions.
export const APP_NAVIGATION_COMMANDS = [
    'app.shortcuts', 'app.plugins', 'app.newProject', 'app.themeSearch', 'app.usageSearch', 'app.actionSearch', 'app.sidebar', 'app.chat', 'app.composer',
    'app.nextChat', 'app.previousChat', 'app.chat1', 'app.chat2', 'app.chat3', 'app.chat4', 'app.chat5', 'app.chat6', 'app.chat7', 'app.chat8', 'app.chat9',
    'app.files', 'app.browser', 'app.review', 'app.terminal', 'app.threadDetails', 'app.resources', 'app.agents',
    'app.toggleFiles', 'app.toggleBrowser', 'app.toggleTerminal', 'app.toggleInspector',
    'app.findInChat', 'app.searchFiles', 'app.searchProjectContents', 'app.saveFile', 'app.stopTurn',
    'app.nextWorkspaceTab', 'app.previousWorkspaceTab', 'app.closeWorkspaceTab'
] as const satisfies readonly CommandId[]
export type AppNavigationCommand = typeof APP_NAVIGATION_COMMANDS[number]
export function isAppNavigationCommand(value: unknown): value is AppNavigationCommand {
    return typeof value === 'string' && (APP_NAVIGATION_COMMANDS as readonly string[]).includes(value)
}
