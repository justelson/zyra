import type { ComponentType } from 'react'
import {
    AppWindow,
    Archive,
    AudioLines,
    Bot,
    Brain,
    CircleUserRound,
    Database,
    Files,
    FolderKanban,
    GitBranch,
    Globe2,
    Info,
    KeyRound,
    MonitorSmartphone,
    Palette,
    PanelsTopLeft,
    Puzzle,
    Settings2,
    ShieldCheck,
    SlidersHorizontal,
    TerminalSquare,
    UsersRound
} from 'lucide-react'

export type SettingsIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export type SettingsNavigationItem = {
    id: string
    label: string
    description: string
    keywords?: string
    to: string
    icon: SettingsIcon
    detailPageIds?: string[]
}

export type SettingsNavigationGroup = {
    id: string
    label: string
    items: SettingsNavigationItem[]
}

export type SettingsDestination = {
    id: string
    categoryId: string
    label: string
    description: string
    keywords: string
    to: string
    icon: SettingsIcon
    legacyPaths?: string[]
}

export const SETTINGS_DESTINATIONS: SettingsDestination[] = [
    {
        id: 'general',
        categoryId: 'app',
        label: 'General',
        description: 'Startup, sidebar, setup, and interface behavior',
        keywords: 'application login windows hidden chat rail sidebar agent inbox onboarding',
        to: '/settings/app/general',
        icon: Settings2,
        legacyPaths: ['/settings/general', '/settings/behavior']
    },
    {
        id: 'appearance',
        categoryId: 'app',
        label: 'Appearance',
        description: 'Themes, typography, density, and motion',
        keywords: 'color system light dark accent font compact accessibility',
        to: '/settings/app/appearance',
        icon: Palette,
        legacyPaths: ['/settings/appearance']
    },
    {
        id: 'account',
        categoryId: 'account',
        label: 'OpenAI account',
        description: 'ChatGPT, API connections, usage, and reset credits',
        keywords: 'chatgpt openai api key oauth account plan usage quota banked resets',
        to: '/settings/account/openai',
        icon: CircleUserRound
    },
    {
        id: 'connections',
        categoryId: 'account',
        label: 'Device connections',
        description: 'Browser access and trusted devices',
        keywords: 'browser link chrome phone computer local pairing remote trusted device',
        to: '/settings/account/devices',
        icon: MonitorSmartphone,
        legacyPaths: ['/settings/connections']
    },
    {
        id: 'assistant',
        categoryId: 'assistant',
        label: 'Chat defaults',
        description: 'Models, behavior, permissions, context, and output',
        keywords: 'assistant model reasoning permission prompt history transcription context compaction',
        to: '/settings/assistant/defaults',
        icon: SlidersHorizontal,
        legacyPaths: ['/settings/chat']
    },
    {
        id: 'skills',
        categoryId: 'assistant',
        label: 'Skills',
        description: 'Sources, priority, and name conflicts',
        keywords: 'agents codex claude pi folders imports priority overrides',
        to: '/settings/assistant/skills',
        icon: Puzzle,
        legacyPaths: ['/settings/skills']
    },
    {
        id: 'voice',
        categoryId: 'assistant',
        label: 'Voice',
        description: 'Voice Lab defaults and instructions',
        keywords: 'realtime audio text speech instructor microphone',
        to: '/settings/assistant/voice',
        icon: AudioLines,
        legacyPaths: ['/settings/voice']
    },
    {
        id: 'providers',
        categoryId: 'account',
        label: 'AI providers',
        description: 'Hosted credentials and provider connections',
        keywords: 'groq gemini chatgpt codex api key commit pull request',
        to: '/settings/account/providers',
        icon: KeyRound,
        legacyPaths: ['/settings/assistant/providers', '/settings/providers', '/settings/ai']
    },
    {
        id: 'browser-control',
        categoryId: 'workspace',
        label: 'Browser',
        description: 'Tabs, site data, history, privacy, and control access',
        keywords: 'restore tabs cache cookies sign in profile ad blocking approvals permissions',
        to: '/settings/workspace/browser',
        icon: Globe2,
        legacyPaths: ['/settings/browser-control']
    },
    {
        id: 'files-editor',
        categoryId: 'workspace',
        label: 'Files & editor',
        description: 'Preview, editor, CSV, and diff defaults',
        keywords: 'fullscreen python wrap minimap font colors stacked split',
        to: '/settings/workspace/files',
        icon: Files,
        legacyPaths: ['/settings/files-editor']
    },
    {
        id: 'terminal-runtime',
        categoryId: 'workspace',
        label: 'Terminal & runtime',
        description: 'Shell, terminal display, and package runtime',
        keywords: 'powershell cmd font cursor scrollback node npm pnpm yarn bun',
        to: '/settings/workspace/terminal',
        icon: TerminalSquare,
        legacyPaths: ['/settings/terminal-runtime']
    },
    {
        id: 'projects',
        categoryId: 'workspace',
        label: 'Projects',
        description: 'Roots, icons, discovery, and indexing',
        keywords: 'folders index scan bounded layout finder grid overrides',
        to: '/settings/workspace/projects',
        icon: FolderKanban,
        legacyPaths: ['/settings/projects', '/settings/explorer', '/settings/beta']
    },
    {
        id: 'source-control',
        categoryId: 'workspace',
        label: 'Source control',
        description: 'Git identity, branches, and pull requests',
        keywords: 'author init gitignore commit draft guide target repository',
        to: '/settings/workspace/source-control',
        icon: GitBranch,
        legacyPaths: ['/settings/source-control', '/settings/git']
    },
    {
        id: 'privacy',
        categoryId: 'data',
        label: 'Privacy & maintenance',
        description: 'Analytics consent and local cache controls',
        keywords: 'privacy product analytics posthog opt in clear cache maintenance',
        to: '/settings/data/privacy',
        icon: ShieldCheck
    },
    {
        id: 'memory',
        categoryId: 'assistant',
        label: 'Memory',
        description: 'Local memory layers and project context',
        keywords: 'profile facts retrieval preferences sessions local files',
        to: '/settings/data/memory',
        icon: Brain,
        legacyPaths: ['/settings/memory']
    },
    {
        id: 'archived',
        categoryId: 'assistant',
        label: 'Archived chats',
        description: 'Restore canonical archived conversations',
        keywords: 'chats history recover restore archive',
        to: '/settings/data/archived',
        icon: Archive,
        legacyPaths: ['/settings/archived']
    },
    {
        id: 'diagnostics',
        categoryId: 'data',
        label: 'Diagnostics',
        description: 'Logs and local troubleshooting',
        keywords: 'debug provider errors clear support records',
        to: '/settings/data/diagnostics',
        icon: TerminalSquare,
        legacyPaths: ['/settings/diagnostics', '/settings/logs']
    },
    {
        id: 'about',
        categoryId: 'data',
        label: 'About & updates',
        description: 'Version, updates, links and license',
        keywords: 'download install update channel github issue build terminal command',
        to: '/settings/about',
        icon: Info
    }
]

export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
    {
        id: 'app',
        label: 'App',
        description: 'General behavior and appearance',
        keywords: 'startup sidebar interface theme font motion',
        to: '/settings/app',
        icon: AppWindow,
        detailPageIds: ['general', 'appearance']
    },
    {
        id: 'assistant',
        label: 'Assistant',
        description: 'Chat behavior, skills, voice and saved context',
        keywords: 'models reasoning permissions skills voice ai',
        to: '/settings/assistant',
        icon: Bot,
        detailPageIds: ['assistant', 'skills', 'voice', 'memory', 'archived']
    },
    {
        id: 'workspace',
        label: 'Workspace',
        description: 'Browser, files, terminal, projects, and Git',
        keywords: 'browser editor terminal projects source control',
        to: '/settings/workspace',
        icon: PanelsTopLeft,
        detailPageIds: ['projects', 'files-editor', 'terminal-runtime', 'source-control', 'browser-control']
    },
    {
        id: 'account',
        label: 'Connections',
        description: 'Accounts, AI providers and connected devices',
        keywords: 'chatgpt api key browser trusted device',
        to: '/settings/account',
        icon: UsersRound,
        detailPageIds: ['account', 'providers', 'connections']
    },
    {
        id: 'data',
        label: 'Privacy & support',
        description: 'Privacy, maintenance, diagnostics and updates',
        keywords: 'analytics cache logs privacy version updates help',
        to: '/settings/data',
        icon: Database,
        detailPageIds: ['privacy', 'diagnostics', 'about']
    }
]

export const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
    { id: 'settings', label: '', items: SETTINGS_NAVIGATION_ITEMS }
]

export function findSettingsDestinationById(id: string): SettingsDestination | null {
    return SETTINGS_DESTINATIONS.find((destination) => destination.id === id) || null
}

export function findSettingsDestination(pathname: string): SettingsDestination | null {
    return SETTINGS_DESTINATIONS.find((destination) => (
        pathname === destination.to
        || pathname.startsWith(`${destination.to}/`)
        || destination.legacyPaths?.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    )) || null
}

export function settingsNavigationItemMatchesPath(item: SettingsNavigationItem, pathname: string): boolean {
    const destination = findSettingsDestination(pathname)
    if (destination) return destination.categoryId === item.id
    return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export function findSettingsNavigationItem(pathname: string): SettingsNavigationItem {
    return SETTINGS_NAVIGATION_ITEMS.find((item) => settingsNavigationItemMatchesPath(item, pathname))
        || SETTINGS_NAVIGATION_ITEMS[0]!
}

export function getSettingsCategoryDestinations(categoryId: string): SettingsDestination[] {
    const category = SETTINGS_NAVIGATION_ITEMS.find(item => item.id === categoryId)
    return category?.detailPageIds
        ? category.detailPageIds.map(findSettingsDestinationById).filter((destination): destination is SettingsDestination => Boolean(destination && destination.categoryId === categoryId))
        : SETTINGS_DESTINATIONS.filter(destination => destination.categoryId === categoryId)
}

export function getSettingsCategoryEntry(categoryId: string): SettingsDestination {
    return getSettingsCategoryDestinations(categoryId)[0] || SETTINGS_DESTINATIONS[0]!
}

export const SETTINGS_NAVIGATION_ICON = Settings2
