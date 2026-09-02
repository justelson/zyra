import type { ComponentType } from 'react'
import {
    Archive,
    AudioLines,
    Bot,
    Brain,
    CircleUserRound,
    Files,
    FolderKanban,
    GitBranch,
    Globe2,
    Info,
    KeyRound,
    MonitorSmartphone,
    Palette,
    Puzzle,
    Settings2,
    ShieldCheck,
    SlidersHorizontal,
    TerminalSquare
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
        label: 'Defaults',
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
        categoryId: 'assistant',
        label: 'AI providers',
        description: 'Hosted providers and Git model connections',
        keywords: 'groq gemini chatgpt codex api key commit pull request',
        to: '/settings/assistant/providers',
        icon: KeyRound,
        legacyPaths: ['/settings/providers', '/settings/ai']
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
        categoryId: 'data',
        label: 'Memory',
        description: 'Local memory layers and project context',
        keywords: 'profile facts retrieval preferences sessions local files',
        to: '/settings/data/memory',
        icon: Brain,
        legacyPaths: ['/settings/memory']
    },
    {
        id: 'archived',
        categoryId: 'data',
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
        categoryId: 'about',
        label: 'About & updates',
        description: 'Version, signed updates, links, and license',
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
        icon: Settings2,
        detailPageIds: ['general', 'appearance']
    },
    {
        id: 'account',
        label: 'Account & connections',
        description: 'OpenAI and connected devices',
        keywords: 'chatgpt api key browser trusted device',
        to: '/settings/account',
        icon: CircleUserRound,
        detailPageIds: ['account', 'connections']
    },
    {
        id: 'assistant',
        label: 'Assistant',
        description: 'Defaults, skills, voice, and providers',
        keywords: 'models reasoning permissions skills voice ai',
        to: '/settings/assistant',
        icon: Bot,
        detailPageIds: ['assistant', 'skills', 'voice', 'providers']
    },
    {
        id: 'workspace',
        label: 'Workspace',
        description: 'Browser, files, terminal, projects, and Git',
        keywords: 'browser editor terminal projects source control',
        to: '/settings/workspace',
        icon: Files,
        detailPageIds: ['browser-control', 'files-editor', 'terminal-runtime', 'projects', 'source-control']
    },
    {
        id: 'data',
        label: 'Data & privacy',
        description: 'Privacy, memory, archives, and diagnostics',
        keywords: 'analytics cache memory archived logs privacy',
        to: '/settings/data',
        icon: ShieldCheck,
        detailPageIds: ['privacy', 'memory', 'archived', 'diagnostics']
    },
    {
        id: 'about',
        label: 'About & updates',
        description: 'Version, updates, and links',
        keywords: 'version release channel license github',
        to: '/settings/about',
        icon: Info,
        detailPageIds: ['about']
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
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return true
    return findSettingsDestination(pathname)?.categoryId === item.id
}

export function findSettingsNavigationItem(pathname: string): SettingsNavigationItem {
    return SETTINGS_NAVIGATION_ITEMS.find((item) => settingsNavigationItemMatchesPath(item, pathname))
        || SETTINGS_NAVIGATION_ITEMS[0]!
}

export function getSettingsCategoryDestinations(categoryId: string): SettingsDestination[] {
    return SETTINGS_DESTINATIONS.filter((destination) => destination.categoryId === categoryId)
}

export const SETTINGS_NAVIGATION_ICON = Settings2
