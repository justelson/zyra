import type { ComponentType } from 'react'
import { AppWindow, Archive, AudioLines, Bot, Brain, Database, Files, FolderKanban, GitBranch, Globe2, Info, KeyRound, MonitorSmartphone, Palette, PanelsTopLeft, Plug, Puzzle, Settings2, ShieldCheck, SlidersHorizontal, TerminalSquare, UsersRound } from 'lucide-react'
import { SETTINGS_PAGE_VIEWS, type SettingsPageFamily } from './settings-page-views'

export type SettingsIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
export type SettingsNavigationItem = { id: string; label: string; description: string; keywords?: string; to: string; icon: SettingsIcon; detailPageIds?: string[] }
export type SettingsNavigationGroup = { id: string; label: string; items: SettingsNavigationItem[] }
export type SettingsDestination = { id: string; categoryId: string; label: string; description: string; keywords: string; to: string; icon: SettingsIcon; legacyPaths?: string[]; parentId?: string; contextual?: boolean }

const primary: SettingsDestination[] = [
    { id: 'general', categoryId: 'app', label: 'Startup & setup', description: 'Login behavior, chat reconnection and setup review', keywords: 'general application login windows startup hidden onboarding', to: '/settings/app/general', icon: Settings2, legacyPaths: ['/settings/general', '/settings/behavior'] },
    { id: 'appearance', categoryId: 'app', label: 'Appearance', description: 'Theme, typography and layout', keywords: 'colors light dark fonts density motion sidebar interface', to: '/settings/app/appearance', icon: Palette, legacyPaths: ['/settings/appearance'] },
    { id: 'keyboard-shortcuts', categoryId: 'app', label: 'Keyboard shortcuts', description: 'Customize app, Browser and terminal keybindings', keywords: 'keyboard shortcut hotkey binding command record reset', to: '/settings/app/keyboard-shortcuts', icon: KeyRound },
    { id: 'assistant', categoryId: 'assistant', label: 'Chats', description: 'Conversation behavior and display', keywords: 'assistant defaults speaking style prompt send queue history output', to: '/settings/assistant/defaults', icon: SlidersHorizontal, legacyPaths: ['/settings/chat', '/settings/assistant/permissions'] },
    { id: 'archived', categoryId: 'assistant', label: 'Archived chats', description: 'Restore or delete archived conversations', keywords: 'archive chats history recover restore remove', to: '/settings/assistant/archived', icon: Archive, legacyPaths: ['/settings/data/archived', '/settings/archived'] },
    { id: 'providers', categoryId: 'assistant', label: 'Providers', description: 'Connections, models and subscription limits', keywords: 'openai chatgpt claude anthropic opencode zen custom api endpoint account oauth credentials', to: '/settings/providers', icon: KeyRound },
    { id: 'plugins', categoryId: 'assistant', label: 'Plugins', description: 'Installed plugins, availability and MCP connections', keywords: 'plugins mcp servers oauth connect disconnect skills tools', to: '/settings/assistant/plugins', icon: Plug },
    { id: 'skills', categoryId: 'assistant', label: 'Skills', description: 'Sources, priority and name conflicts', keywords: 'agents codex claude pi folders imports overrides', to: '/settings/assistant/skills', icon: Puzzle, legacyPaths: ['/settings/skills'] },
    { id: 'voice', categoryId: 'assistant', label: 'Voice', description: 'Dictation and voice conversations', keywords: 'audio microphone speech text transcription realtime instructor', to: '/settings/assistant/voice', icon: AudioLines, legacyPaths: ['/settings/voice'] },
    { id: 'memory', categoryId: 'assistant', label: 'Context & memory', description: 'Context limits and saved memory', keywords: 'compaction tokens profile facts preferences layers local files processing model provider OpenAI Luna Sonnet Big Pickle', to: '/settings/assistant/memory', icon: Brain, legacyPaths: ['/settings/data/memory', '/settings/memory'] },
    { id: 'projects', categoryId: 'workspace', label: 'Projects', description: 'Catalog, discovery and presentation', keywords: 'folders roots index scan associated active archive icons layout finder grid', to: '/settings/workspace/projects', icon: FolderKanban, legacyPaths: ['/settings/projects', '/settings/explorer', '/settings/beta'] },
    { id: 'files-editor', categoryId: 'workspace', label: 'Files & editor', description: 'File preview and editing defaults', keywords: 'fullscreen preview edit wrap minimap font csv colors diff', to: '/settings/workspace/files', icon: Files, legacyPaths: ['/settings/files-editor'] },
    { id: 'terminal-runtime', categoryId: 'workspace', label: 'Terminal & runtime', description: 'Shell, display, script runners and the zyra command', keywords: 'powershell cmd font cursor scrollback node npm pnpm yarn bun cli install', to: '/settings/workspace/terminal', icon: TerminalSquare, legacyPaths: ['/settings/terminal-runtime'] },
    { id: 'source-control', categoryId: 'workspace', label: 'Source control', description: 'Git defaults, pull requests and AI writing', keywords: 'author identity init gitignore commit branch repository', to: '/settings/workspace/source-control', icon: GitBranch, legacyPaths: ['/settings/source-control', '/settings/git'] },
    { id: 'browser-control', categoryId: 'workspace', label: 'Browser', description: 'Browsing, privacy and site data', keywords: 'tabs history profile cookies cache sign in ad blocking', to: '/settings/workspace/browser', icon: Globe2, legacyPaths: ['/settings/browser-control'] },
    { id: 'connections', categoryId: 'account', label: 'Devices', description: 'Browser access, Chrome and trusted devices', keywords: 'phone android computer local remote pairing browser link extension', to: '/settings/account/devices', icon: MonitorSmartphone, legacyPaths: ['/settings/connections'] },
    { id: 'privacy', categoryId: 'data', label: 'Privacy & data', description: 'Analytics consent and cached data', keywords: 'privacy product analytics posthog opt in clear cache maintenance storage', to: '/settings/data/privacy', icon: ShieldCheck },
    { id: 'diagnostics', categoryId: 'data', label: 'Diagnostics', description: 'Chat troubleshooting and Git-writing logs', keywords: 'debug worker replay sequence provider errors records support', to: '/settings/data/diagnostics', icon: TerminalSquare, legacyPaths: ['/settings/diagnostics', '/settings/logs'] },
    { id: 'about', categoryId: 'data', label: 'About & updates', description: 'Version, updates, links and license', keywords: 'download install updater channel github issue build legal', to: '/settings/about', icon: Info }
]

const families: Record<SettingsPageFamily, string> = { appearance: 'appearance', providers: 'providers', chats: 'assistant', voice: 'voice', projects: 'projects', files: 'files-editor', browser: 'browser-control', git: 'source-control', devices: 'connections', memory: 'memory' }
const innerMetadata: Record<string, Partial<SettingsDestination>> = {
    usage: { description: 'Token activity and reported model costs', keywords: 'usage tokens input output cache cost history daily provider model', legacyPaths: ['/settings/usage'] },
    account: { label: 'Subscription limits', description: 'ChatGPT identity, usage windows and banked resets', keywords: 'chatgpt account email plan quota remaining used reset credits', legacyPaths: ['/settings/account/openai'] },
    'provider-models': { description: 'Chat titles and delegated work', keywords: 'title refresh interval agent role planner implementer reviewer debugger verifier researcher specialist' },
    'chat-defaults': { description: 'Default model, reasoning and service tier for new chats', keywords: 'default model reasoning effort fast priority new chat' },
    'appearance-typography': { keywords: 'ui interface code font type family managed google local import typography' },
    'appearance-layout': { keywords: 'sidebar rail hover inbox compact comfortable spacing density accessibility reduce motion' },
    'chat-display': { keywords: 'reasoning summaries streaming chunks output activity stats durations timings cross surface status' },
    'voice-lab': { keywords: 'voice lab realtime conversation instructions speaker output audio' },
    'voice-history': { keywords: 'voice dictation transcription history recordings failed audio transcript' },
    'project-discovery': { keywords: 'find projects folders discovery suggestions' },
    'file-editor': { keywords: 'word wrap minimap editor font size csv colors diff split stacked' },
    'browser-privacy': { keywords: 'website sign ins google suggestions ad blocking trackers privacy' },
    'browser-data': { keywords: 'cookies history cache profile layouts sign out clear reset data' },
    'git-pull-requests': { keywords: 'pull request pr guide draft target branch change source' },
    'git-writing': { keywords: 'ai commit message pull request model provider reasoning instructions' },
    'device-chrome': { keywords: 'chrome browser extension pairing computer control' },
    'device-mobile': { keywords: 'mobile android phone trusted devices pair revoke' },
    'memory-inspect': { keywords: 'memory layers contents files prompts local profile inspect read copy' }
}
const inner: SettingsDestination[] = Object.entries(SETTINGS_PAGE_VIEWS).flatMap(([family, views]) => {
    const parent = primary.find(destination => destination.id === families[family as SettingsPageFamily])!
    return views.slice(1).map(view => ({ id: view.id, parentId: parent.id, categoryId: parent.categoryId, label: view.label, description: `${parent.label}: ${view.label}`, keywords: view.label.toLowerCase(), to: view.to, icon: parent.icon, ...innerMetadata[view.id] }))
})
export const SETTINGS_DESTINATIONS: SettingsDestination[] = [
    ...primary, ...inner,
    { id: 'browser-captures', parentId: 'browser-control', categoryId: 'workspace', label: 'Captures', description: 'Saved Browser screenshots and recordings', keywords: 'screenshots recordings video image saved copy delete captures', to: '/settings/workspace/browser/captures', icon: Globe2, contextual: true },
    { id: 'response-timings', parentId: 'diagnostics', categoryId: 'data', label: 'Response timings', description: 'Chat response summary and optional turn history', keywords: 'latency speed first text display diagnostics timings', to: '/settings/data/diagnostics/response-timings', icon: TerminalSquare, contextual: true },
    { id: 'git-writing-connections', parentId: 'source-control', categoryId: 'workspace', label: 'Writing services', description: 'Credentials for Git writing', keywords: 'groq gemini keys', to: '/settings/workspace/source-control/writing/connections', icon: KeyRound, contextual: true },
    { id: 'git-writing-logs', parentId: 'source-control', categoryId: 'workspace', label: 'Writing logs', description: 'Git writing records', keywords: 'git logs', to: '/settings/workspace/source-control/writing/logs', icon: TerminalSquare, contextual: true },
    { id: 'appearance-colors', parentId: 'appearance', categoryId: 'app', label: 'Customize colors', description: 'Edit, copy and restore a custom theme', keywords: 'theme tokens accent background foreground border hex palette custom', to: '/settings/app/appearance/colors', icon: Palette },
    { id: 'skill-conflicts', parentId: 'skills', categoryId: 'assistant', label: 'Skill name conflicts', description: 'Choose a source for overlapping skill names', keywords: 'duplicate skill names unresolved resolved preferred source', to: '/settings/assistant/skills/conflicts', icon: Puzzle, contextual: true },
    { id: 'provider-writing', parentId: 'providers', categoryId: 'assistant', label: 'Git writing services', description: 'Groq and Gemini credentials for Git writing', keywords: 'groq google gemini hosted api key credentials test connection', to: '/settings/providers/writing', icon: KeyRound, legacyPaths: ['/settings/account/providers', '/settings/assistant/providers', '/settings/ai'] }
]

export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
    { id: 'app', label: 'General', description: 'Startup and appearance', keywords: 'startup interface theme font layout', to: '/settings/app', icon: AppWindow, detailPageIds: ['general', 'appearance', 'keyboard-shortcuts'] },
    { id: 'assistant', label: 'Assistant', description: 'Chats, archived chats, providers, plugins, skills, voice and memory', keywords: 'agent chat models providers plugins mcp tools context archive', to: '/settings/assistant', icon: Bot, detailPageIds: ['assistant', 'archived', 'providers', 'plugins', 'skills', 'voice', 'memory'] },
    { id: 'workspace', label: 'Workspace', description: 'Projects, files, terminal, Git and Browser', keywords: 'editor terminal projects source control browser', to: '/settings/workspace', icon: PanelsTopLeft, detailPageIds: ['projects', 'files-editor', 'terminal-runtime', 'source-control', 'browser-control'] },
    { id: 'account', label: 'Connections', description: 'This device, Chrome and trusted mobile devices', keywords: 'devices pairing local browser chrome mobile', to: '/settings/account', icon: UsersRound, detailPageIds: ['connections'] },
    { id: 'data', label: 'Privacy & support', description: 'Privacy, diagnostics and updates', keywords: 'analytics storage logs version help', to: '/settings/data', icon: Database, detailPageIds: ['privacy', 'diagnostics', 'about'] }
]
export const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [{ id: 'settings', label: '', items: SETTINGS_NAVIGATION_ITEMS }]

export function findSettingsDestinationById(id: string): SettingsDestination | null {
    return SETTINGS_DESTINATIONS.find(destination => destination.id === id) || null
}
export function findSettingsDestination(pathname: string): SettingsDestination | null {
    let match: SettingsDestination | null = null
    let length = -1
    for (const destination of SETTINGS_DESTINATIONS) {
        for (const path of [destination.to, ...(destination.legacyPaths || [])]) {
            if ((pathname === path || pathname.startsWith(`${path}/`)) && path.length > length) { match = destination; length = path.length }
        }
    }
    return match
}
export function settingsNavigationItemMatchesPath(item: SettingsNavigationItem, pathname: string): boolean {
    const destination = findSettingsDestination(pathname)
    return destination ? destination.categoryId === item.id : pathname === item.to || pathname.startsWith(`${item.to}/`)
}
export function findSettingsNavigationItem(pathname: string): SettingsNavigationItem {
    return SETTINGS_NAVIGATION_ITEMS.find(item => settingsNavigationItemMatchesPath(item, pathname)) || SETTINGS_NAVIGATION_ITEMS[0]!
}
export function getSettingsCategoryDestinations(categoryId: string): SettingsDestination[] {
    const category = SETTINGS_NAVIGATION_ITEMS.find(item => item.id === categoryId)
    return (category?.detailPageIds || []).map(findSettingsDestinationById).filter((destination): destination is SettingsDestination => Boolean(destination && destination.categoryId === categoryId && !destination.parentId))
}
export function getSettingsCategoryEntry(categoryId: string): SettingsDestination {
    return getSettingsCategoryDestinations(categoryId)[0] || SETTINGS_DESTINATIONS[0]!
}
export const SETTINGS_NAVIGATION_ICON = Settings2
