import { SETTINGS_DESTINATIONS, type SettingsDestination } from './settings-navigation'

export type SettingsSearchTarget = {
    label: string
    section: string
    targetId: string
    sectionTargetId: string
    keywords: string
}

function slug(value: string): string {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'setting'
}

export function createSettingsSectionTargetId(section: string): string {
    return `settings-section-${slug(section)}`
}

export function createSettingsRowTargetId(section: string | null, label: string): string {
    return `settings-row-${section ? `${slug(section)}-` : ''}${slug(label)}`
}

function row(section: string, label: string, keywords = '', targetLabel = label): SettingsSearchTarget {
    return {
        label,
        section,
        targetId: createSettingsRowTargetId(section, targetLabel),
        sectionTargetId: createSettingsSectionTargetId(section),
        keywords
    }
}

function rows(section: string, labels: string[], keywords: Record<string, string> = {}): SettingsSearchTarget[] {
    return labels.map((label) => row(section, label, keywords[label] || ''))
}

function sectionTarget(section: string, label: string, keywords = ''): SettingsSearchTarget {
    const sectionTargetId = createSettingsSectionTargetId(section)
    return { label, section, targetId: sectionTargetId, sectionTargetId, keywords }
}

export const SETTINGS_SEARCH_TARGETS: Readonly<Record<string, readonly SettingsSearchTarget[]>> = {
    general: [
        ...rows('Desktop host', ['Open at login', 'Start hidden'], {
            'Open at login': 'startup launch automatically sign in computer',
            'Start hidden': 'startup minimized background'
        }),
        ...rows('Interface', ['Chat rail', 'Sidebar hover preview', 'Agent Inbox sidebar'], {
            'Chat rail': 'sidebar collapsed navigation surface',
            'Sidebar hover preview': 'sidebar minimized collapsed hover edge bubble peek',
            'Agent Inbox sidebar': 'sidebar active work recent settled'
        }),
        row('Setup', 'Review device setup', 'onboarding openai chatgpt appearance projects review')
    ],
    privacy: [
        row('Privacy', 'Share product analytics', 'privacy posthog anonymous usage diagnostics opt in consent'),
        row('Local maintenance', 'Cached UI data', 'clear cache renderer local maintenance')
    ],
    appearance: [
        row('Theme', 'Appearance mode', 'system default windows light dark'),
        row('Theme', 'Light and dark themes', 'theme pair palettes variants halves catalog light day bright paper dawn latte snow mist dark night midnight graphite forest ocean'),
        row('Theme', 'Custom theme', 'edit saved custom colors typography copy values'),
        row('Theme', 'Accent preset', 'accent colors palette'),
        row('Theme', 'Accent primary', 'accent color hex'),
        row('Theme', 'Accent secondary', 'accent color hex'),
        row('Theme', 'Theme colors', 'background foreground text card border surface color tokens'),
        ...rows('Theme', ['Background', 'Foreground', 'Strong text', 'Subtle text', 'Secondary text', 'Muted text', 'Card', 'Border', 'Strong border', 'Theme primary', 'Theme secondary', 'Surface accent']),
        row('Theme', 'UI font', 'interface typography family google local imported more fonts'),
        row('Theme', 'Code font', 'editor terminal monospace typography google local imported more fonts'),
        ...rows('Preferences', ['Interface density', 'Reduce motion'], {
            'Interface density': 'compact comfortable spacing',
            'Reduce motion': 'animation transitions accessibility scrolling'
        })
    ],
    account: [
        ...rows('OpenAI connections', ['ChatGPT subscription', 'OpenAI API key', 'New-chat default'], {
            'ChatGPT subscription': 'connect reconnect disconnect oauth retry use new chats',
            'OpenAI API key': 'add replace verify remove disconnect api credential',
            'New-chat default': 'switch provider model chatgpt api existing chats'
        }),
        ...rows('ChatGPT account', ['Connection', 'Email', 'Plan', 'Pi provider', 'Account ID', 'Access refresh', 'Connection source'], {
            Connection: 'chatgpt openai oauth login signed in',
            'Pi provider': 'openai codex provider identifier',
            'Access refresh': 'token expiry expiration',
            'Connection source': 'credentials auth source'
        }),
        ...rows('Usage limits', ['Usage display', 'Usage windows'], {
            'Usage display': 'remaining used quota rate limit',
            'Usage windows': 'quota rate limits reset five hour weekly'
        }),
        row('Banked resets', 'Reset credits', 'banked reset credit consume usage limit')
    ],
    connections: [
        ...rows('This device', ['Zyra in your browser', 'Connection scope'], {
            'Zyra in your browser': 'browser link url chrome open copy local host',
            'Connection scope': 'loopback local network reach'
        }),
        row('Trusted devices', 'Other devices', 'phone computer pair pairing remote lan tailscale revoke')
    ],
    assistant: [
        ...rows('Assistant defaults', ['Model', 'Chat title model', 'Refresh chat titles', 'Title refresh interval', 'Zyra profile', 'Permission mode', 'Reasoning effort', 'Fast service tier', 'Web access', 'Busy send behavior', 'Default prompt'], {
            Model: 'default ai model chat',
            'Chat title model': 'name naming generation luna utility',
            'Refresh chat titles': 'automatic regenerate rename interval turns cost recent prompts final responses',
            'Title refresh interval': 'automatic regenerate rename completed turns minimum',
            'Zyra profile': 'default builder instructions profile',
            'Permission mode': 'supervised auto review edits only approval full access browser chrome computer security',
            'Reasoning effort': 'thinking depth high low max',
            'Fast service tier': 'priority fast provider',
            'Web access': 'search fetch pages internet tools new chat default',
            'Busy send behavior': 'queue next interrupt active turn',
            'Default prompt': 'template instructions new chat'
        }),
        ...rows('Reasoning and context', ['Reasoning summaries', 'Context limit'], {
            'Reasoning summaries': 'auto detailed concise readable thoughts chain of thought progress',
            'Context limit': 'window tokens automatic compaction compact summarize 128k 200k 256k 320k 372k'
        }),
        ...rows('Output and history', ['Chat display', 'Assistant output', 'Open live tool output', 'Reconnect on startup', 'Cross-surface status', 'Canonical diagnostics'], {
            'Chat display': 'minimal detailed quiet compact activity timeline conversation',
            'Assistant output': 'stream chunks token text response',
            'Open live tool output': 'expanded minimized collapsed closed command terminal animation',
            'Reconnect on startup': 'connect selected chat launch',
            'Cross-surface status': 'desktop browser active status',
            'Canonical diagnostics': 'worker replay sequence debug'
        }),
        ...rows('Voice transcription', ['Voice input', 'Transcription engine', 'ChatGPT transcription', 'Browser dictation'], {
            'Voice input': 'microphone speech to text voice note',
            'Transcription engine': 'browser chatgpt codex speech',
            'ChatGPT transcription': 'recording account readiness',
            'Browser dictation': 'web speech microphone'
        })
    ],
    skills: [
        row('Skill sources', 'Resolution order', 'priority winner project personal source order'),
        ...rows('Skill sources', ['Zyra', 'Codex', 'Claude Code', 'Shared agents', 'Pi'], {
            Zyra: 'native personal project folder',
            Codex: 'import compatible agent skills',
            'Claude Code': 'import compatible agent skills',
            'Shared agents': 'global agents skills shared folder',
            Pi: 'pi coding agent skills'
        }),
        row('Name conflicts', 'Overlapping names', 'duplicate collision choose preferred winner resolve', 'Overlapping names'),
        row('When changes apply', 'New chats', 'reload existing active agent')
    ],
    voice: rows('Instructor Voice Lab', ['Voice', 'Output', 'Instructions'], {
        Voice: 'speaker realtime audio persona',
        Output: 'audio text spoken response',
        Instructions: 'voice prompt behavior'
    }),
    'browser-control': [
        ...rows('Browser workspace', ['Restore Browser tabs', 'Website sign-ins', 'Google search suggestions', 'Built-in ad blocking', 'New Tab backgrounds', 'Background behavior', 'Retained workspaces', 'Browser history', 'Temporary cache', 'Sign out of websites', 'Reset Browser profile'], {
            'Restore Browser tabs': 'reopen retained workspace',
            'Website sign-ins': 'cookies authentication sessions saved local profile',
            'Google search suggestions': 'autocomplete predictions privacy google typed query',
            'Built-in ad blocking': 'ads trackers ghostery easylist privacy shields',
            'New Tab backgrounds': 'nature images wallpaper unsplash byok categories attribution',
            'Background behavior': 'new tab image rotate shuffle change each tab lock fixed selection',
            'Retained workspaces': 'saved tabs clear layouts',
            'Browser history': 'visited addresses omnibox suggestions recent clear',
            'Temporary cache': 'downloaded page resources clear',
            'Sign out of websites': 'cookies authentication sessions clear logout',
            'Reset Browser profile': 'permissions history cache cookies site data clear'
        })
    ],
    'files-editor': [
        ...rows('File preview', ['Open fullscreen', 'Default mode', 'Python run target', 'Fullscreen left panel', 'Fullscreen Edit Inspector', 'Explorer file names'], {
            'Open fullscreen': 'preview full screen',
            'Default mode': 'preview edit initial',
            'Python run target': 'terminal output play',
            'Fullscreen left panel': 'navigation preview',
            'Fullscreen Edit Inspector': 'right panel information preview edit mode',
            'Explorer file names': 'wrap horizontal'
        }),
        ...rows('Editor defaults', ['Word wrap', 'Minimap', 'Font size', 'CSV colors', 'Diff layout'], {
            'Word wrap': 'long lines editor',
            Minimap: 'code overview editor',
            'Font size': 'editor text size',
            'CSV colors': 'columns distinct spreadsheet',
            'Diff layout': 'stacked split changes'
        })
    ],
    'terminal-runtime': [
        ...rows('Terminal', ['Default shell', 'Font size', 'Blinking cursor', 'Scrollback', 'Preview panel height'], {
            'Default shell': 'powershell command prompt cmd',
            'Font size': 'terminal text size',
            'Blinking cursor': 'terminal caret',
            Scrollback: 'retained lines history',
            'Preview panel height': 'file preview terminal size'
        }),
        row('Package runtime', 'Project script runner', 'node npm pnpm yarn bun package manager')
    ],
    providers: [
        row('Providers', 'Default Git AI provider', 'groq gemini chatgpt codex commit pull request'),
        row('Groq', 'Groq API key', 'credential hosted provider test connection', 'API key'),
        row('Google Gemini', 'Gemini API key', 'google credential hosted provider test connection', 'API key'),
        ...rows('Zyra · ChatGPT', ['Commit model', 'Pull-request model'], {
            'Commit model': 'git generated commit message chatgpt codex',
            'Pull-request model': 'git pr title body chatgpt codex'
        }),
        row('Stored credentials', 'Clear hosted API keys', 'remove groq gemini credentials')
    ],
    projects: [
        ...rows('Project roots', ['Main projects folder', 'Additional roots'], {
            'Main projects folder': 'root discovery choose folder',
            'Additional roots': 'secondary configured root add remove folder discovery'
        }),
        ...rows('Indexing', ['Configured roots', 'Persistence', 'Traversal boundary'], {
            'Configured roots': 'project index eligible folders',
            Persistence: 'index disk cache restart',
            'Traversal boundary': 'bounded scan home app data drive'
        }),
        ...rows('Project browser', ['Project browser view', 'Project content layout'], {
            'Project browser view': 'finder grid',
            'Project content layout': 'tree grouped sections'
        }),
        row('Project icons', 'Automatic detection', 'app icon manifest favicon override')
    ],
    'source-control': [
        ...rows('Pull requests', ['Default guide source', 'Default target branch', 'Default change source', 'Draft by default', 'Global guide mode', 'Global guide', 'Guide file'], {
            'Default guide source': 'pr instructions repository template',
            'Default target branch': 'base branch pull request',
            'Default change source': 'unstaged staged commits local work',
            'Draft by default': 'pull request draft',
            'Global guide mode': 'text markdown file',
            'Global guide': 'pr structure checklist tone',
            'Guide file': 'markdown pull request instructions'
        }),
        ...rows('Workflow', ['Auto-refresh on project open', 'Warn on author mismatch', 'Auto-create working branch'], {
            'Auto-refresh on project open': 'git status history remotes branches',
            'Warn on author mismatch': 'commit identity ownership confirmation',
            'Auto-create working branch': 'stacked pr target branch'
        }),
        ...rows('Repository defaults', ['Initial branch', 'Create .gitignore', 'Create initial commit', 'Bulk action scope'], {
            'Initial branch': 'git init main master',
            'Create .gitignore': 'repository initialization ignore',
            'Create initial commit': 'repository initialization first commit',
            'Bulk action scope': 'stage all unstage project repo'
        }),
        row('Global identity', 'Git author', 'name email commit identity')
    ],
    memory: [
        ...rows('Memory', ['Zyra root', 'Memory directory', 'Sessions directory', 'Runtime defaults'], {
            'Zyra root': 'installation local path',
            'Memory directory': 'profile facts preferences context path',
            'Sessions directory': 'canonical records path',
            'Runtime defaults': 'model thinking level'
        }),
        sectionTarget('Layers', 'Memory layers', 'profile facts preferences project context files'),
        sectionTarget('Recommended prompts', 'Recommended prompts', 'suggested memory setup prompts')
    ],
    archived: rows('Archive', ['Archived chats', 'Search'], {
        'Archived chats': 'hidden conversations restore delete count',
        Search: 'filter title project canonical id'
    }),
    diagnostics: rows('Diagnostics', ['AI debug logs', 'Provider filter', 'Clear logs'], {
        'AI debug logs': 'provider requests responses troubleshooting',
        'Provider filter': 'groq gemini codex records',
        'Clear logs': 'remove debug records'
    }),
    about: [
        ...rows('About Zyra', ['Version', 'Package version', 'Release channel', 'Platform', 'Application stack', 'License'], {
            Version: 'desktop build installed',
            'Package version': 'semantic version',
            'Release channel': 'alpha beta update feed',
            Platform: 'windows operating system',
            'Application stack': 'electron react typescript',
            License: 'mit source code'
        }),
        row('Terminal', 'zyra command', 'install remove bundled tui terminal path'),
        ...rows('Updates', ['Update status', 'Available version', 'Downloaded version', 'Download progress', 'Skipped version', 'Update actions', 'Defer this update'], {
            'Update status': 'check updater service',
            'Available version': 'release offered',
            'Downloaded version': 'ready install restart',
            'Download progress': 'update percentage',
            'Skipped version': 'hidden release clear skip',
            'Update actions': 'check download install update center',
            'Defer this update': 'remind later skip'
        }),
        ...rows('Links', ['Creator GitHub', 'Source code', 'Report an issue'], {
            'Creator GitHub': 'profile justelson',
            'Source code': 'repository github',
            'Report an issue': 'bug feature request github'
        })
    ]
}

function normalizeSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

function matchScore(target: SettingsSearchTarget, query: string, tokens: string[]): number | null {
    const label = normalizeSearchText(target.label)
    const section = normalizeSearchText(target.section)
    const keywords = normalizeSearchText(target.keywords)
    const haystack = `${label} ${section} ${keywords}`
    if (!tokens.every((token) => haystack.includes(token))) return null
    if (label === query) return 0
    if (label.startsWith(query)) return 1
    if (label.includes(query)) return 2
    if (section.startsWith(query)) return 3
    if (section.includes(query)) return 4
    return 5
}

export function findSettingsSearchTargets(pageId: string, rawQuery: string): SettingsSearchTarget[] {
    const query = normalizeSearchText(rawQuery)
    if (!query) return []
    const tokens = query.split(/\s+/).filter(Boolean)
    return [...(SETTINGS_SEARCH_TARGETS[pageId] || [])]
        .map((target, index) => ({ target, index, score: matchScore(target, query, tokens) }))
        .filter((entry): entry is { target: SettingsSearchTarget; index: number; score: number } => entry.score !== null)
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .map((entry) => entry.target)
}

export function getSettingsSearchTarget(pageId: string, targetId: string): SettingsSearchTarget | null {
    return SETTINGS_SEARCH_TARGETS[pageId]?.find((target) => target.targetId === targetId) || null
}

export type SettingsSearchMatch = {
    destination: SettingsDestination
    target: SettingsSearchTarget | null
    score: number
}

function destinationMatchScore(destination: SettingsDestination, query: string, tokens: string[]): number | null {
    const label = normalizeSearchText(destination.label)
    const description = normalizeSearchText(destination.description)
    const keywords = normalizeSearchText(destination.keywords)
    const haystack = `${label} ${description} ${keywords}`
    if (!tokens.every((token) => haystack.includes(token))) return null
    if (label === query) return 0
    if (label.startsWith(query)) return 1
    if (label.includes(query)) return 2
    return 6
}

export function findAllSettingsSearchMatches(rawQuery: string): SettingsSearchMatch[] {
    const query = normalizeSearchText(rawQuery)
    if (!query) return []
    const tokens = query.split(/\s+/).filter(Boolean)
    const matches: SettingsSearchMatch[] = []

    for (const destination of SETTINGS_DESTINATIONS) {
        const pageScore = destinationMatchScore(destination, query, tokens)
        if (pageScore !== null) matches.push({ destination, target: null, score: pageScore })
        for (const target of SETTINGS_SEARCH_TARGETS[destination.id] || []) {
            const score = matchScore(target, query, tokens)
            if (score !== null) matches.push({ destination, target, score })
        }
    }

    return matches.sort((left, right) => (
        left.score - right.score
        || Number(left.target === null) - Number(right.target === null)
        || left.destination.label.localeCompare(right.destination.label)
        || (left.target?.label || '').localeCompare(right.target?.label || '')
    ))
}

export function isSettingsSearchTargetId(value: string): boolean {
    return /^settings-(?:row|section)-[a-z0-9-]+$/.test(value)
}
