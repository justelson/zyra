import { SETTINGS_DESTINATIONS, type SettingsDestination } from './settings-navigation'
import { getControllingSettingsTarget } from './settings-dependencies'

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

const PREVIOUS_SETTINGS_SEARCH_TARGETS: Readonly<Record<string, readonly SettingsSearchTarget[]>> = {
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
        row('Theme', 'Interface size', 'interface zoom scale text bigger smaller percent display'),
        row('Theme', 'Code size', 'code zoom scale text bigger smaller percent snippets'),
        row('Theme', 'Contrast', 'contrast stronger softer text borders accents accessible percent'),
        ...rows('Preferences', ['Interface density', 'Reduce motion', 'Animation speed'], {
            'Interface density': 'compact comfortable spacing',
            'Reduce motion': 'animation transitions accessibility scrolling',
            'Animation speed': 'animation speed calm brisk motion transitions duration'
        })
    ],
    account: [
        sectionTarget('ChatGPT accounts', 'ChatGPT accounts', 'multiple accounts sign in add reconnect disconnect pause enable subscription load balancing limits reset'),
        ...rows('ChatGPT usage rules', ['Usage strategy', 'Use first', 'Allowed accounts'], {
            'Usage strategy': 'balance automatic rotate evenly round robin drain fill first quota',
            'Use first': 'preferred priority drain account reset',
            'Allowed accounts': 'only selected restrict account pause enable'
        }),
        sectionTarget('Other model providers', 'Other model providers', 'opencode zen claude anthropic custom endpoint api key connect disconnect models'),
        ...rows('OpenAI connections', ['ChatGPT subscription', 'OpenAI API key'], {
            'ChatGPT subscription': 'connect reconnect disconnect oauth retry use new chats',
            'OpenAI API key': 'add replace verify remove disconnect api credential'
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
        row('Chrome browser', 'Zyra Browser extension', 'chrome extension pairing connect disconnect tabs read control'),
        row('Trusted devices', 'Other devices', 'phone computer pair pairing remote lan tailscale revoke')
    ],
    assistant: [
        ...rows('Assistant defaults', ['Model', 'Chat title model', 'Refresh chat titles', 'Title refresh interval', 'Speaking style', 'Permission mode', 'Reasoning effort', 'Fast service tier', 'Web access', 'Busy send behavior', 'Default prompt'], {
            Model: 'default ai model chat',
            'Chat title model': 'name naming generation luna utility',
            'Refresh chat titles': 'automatic regenerate rename interval turns cost recent prompts final responses',
            'Title refresh interval': 'automatic regenerate rename completed turns minimum',
            'Speaking style': 'concise friendly direct thoughtful playful tone',
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
        row('Output and history', 'Collapse ongoing work', 'working active collapse expand disclosure'),
        row('Output and history', 'Action statistics', 'timings duration counts activity rail actions'),
        ...rows('Output and history', ['Chat display', 'Assistant output', 'Open live tool output', 'Reconnect on startup', 'Cross-surface status', 'Canonical diagnostics'], {
            'Chat display': 'minimal detailed quiet compact activity timeline conversation',
            'Assistant output': 'stream chunks token text response',
            'Open live tool output': 'expanded minimized collapsed closed command terminal animation',
            'Reconnect on startup': 'connect selected chat launch',
            'Cross-surface status': 'desktop browser active status',
            'Canonical diagnostics': 'worker replay sequence debug'
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
    voice: [
        ...rows('Voice transcription', ['Voice input', 'Transcription engine', 'ChatGPT transcription', 'Browser dictation'], {
            'Voice input': 'microphone speech to text voice note',
            'Transcription engine': 'browser chatgpt codex speech',
            'ChatGPT transcription': 'recording account readiness',
            'Browser dictation': 'web speech microphone'
        }),
        ...rows('Instructor Voice Lab', ['Voice', 'Output', 'Instructions'], {
            Voice: 'speaker realtime audio persona',
            Output: 'audio text spoken response',
            Instructions: 'voice prompt behavior'
        })
    ],
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
        }).map(target => {
            const section = ['Restore Browser tabs', 'New Tab backgrounds', 'Background behavior'].includes(target.label) ? 'Browsing'
                : ['Website sign-ins', 'Google search suggestions', 'Built-in ad blocking'].includes(target.label) ? 'Browser privacy' : 'Site data'
            return { ...target, section, sectionTargetId: createSettingsSectionTargetId(section) }
        })
    ],
    'files-editor': [
        ...rows('File preview', ['Open fullscreen', 'Default mode', 'Fullscreen left panel', 'Fullscreen Edit Inspector', 'Explorer file names'], {
            'Open fullscreen': 'preview full screen',
            'Default mode': 'preview edit initial',
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
        ...rows('Terminal', ['Default shell', 'Font size', 'Blinking cursor', 'Scrollback'], {
            'Default shell': 'powershell command prompt cmd',
            'Font size': 'terminal text size',
            'Blinking cursor': 'terminal caret',
            Scrollback: 'retained lines history'
        }),
        row('Package runtime', 'Project script runner', 'node npm pnpm yarn bun package manager')
    ],
    providers: [
        { ...row('Groq', 'Groq API key', 'credential hosted provider test connection', 'API key'), section: 'Hosted providers', sectionTargetId: createSettingsSectionTargetId('Hosted providers') },
        { ...row('Google Gemini', 'Gemini API key', 'google credential hosted provider test connection', 'API key'), section: 'Hosted providers', sectionTargetId: createSettingsSectionTargetId('Hosted providers') },
        row('ChatGPT', 'Connected account', 'openai subscription test manage account'),
        row('Text generation', 'Git writing defaults', 'source control models commit pr provider'),
        row('Stored credentials', 'Clear hosted API keys', 'remove groq gemini credentials')
    ],
    projects: [
        ...rows('Where Zyra looks', ['Look for projects in', 'More folders'], {
            'Look for projects in': 'main folder find discover project suggestions',
            'More folders': 'additional folders find discover project suggestions'
        })
    ],
    'source-control': [
        { ...row('Providers', 'Default Git AI provider', 'groq gemini chatgpt codex commit pull request'), section: 'Text generation', sectionTargetId: createSettingsSectionTargetId('Text generation') },
        { ...row('Zyra · ChatGPT', 'ChatGPT commit model', 'git generated commit message chatgpt codex', 'Commit model'), section: 'Text generation', sectionTargetId: createSettingsSectionTargetId('Text generation') },
        { ...row('Zyra · ChatGPT', 'ChatGPT pull-request model', 'git pr title body chatgpt codex', 'Pull-request model'), section: 'Text generation', sectionTargetId: createSettingsSectionTargetId('Text generation') },
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
        sectionTarget('Layers', 'Memory layers', 'profile facts preferences project context files'),
        row('Layers', 'File content', 'read local memory file contents'),
        sectionTarget('Recommended prompts', 'Recommended prompts', 'suggested memory setup prompts')
    ],
    archived: rows('Archive', ['Archived chats', 'Search'], {
        'Archived chats': 'hidden conversations restore delete count',
        Search: 'filter title project canonical id'
    }),
    plugins: [sectionTarget('Installed plugins', 'Installed plugins', 'mcp connections connect disconnect enabled availability plugin settings')],
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
            License: 'apache apache-2.0 source code'
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

// Keep stable row ids while each control moves to its current routed view.
export const SETTINGS_SEARCH_TARGETS: Readonly<Record<string, readonly SettingsSearchTarget[]>> = reorganizeSearchTargets()

function reorganizeSearchTargets(): Record<string, SettingsSearchTarget[]> {
    const result = Object.fromEntries(Object.entries(PREVIOUS_SETTINGS_SEARCH_TARGETS).map(([id, targets]) => [id, [...targets]]))
    const move = (from: string, to: string, matches: (target: SettingsSearchTarget) => boolean, section?: string) => {
        const moved = (result[from] || []).filter(matches)
        result[from] = (result[from] || []).filter(target => !matches(target))
        result[to] = [...result[to] || [], ...moved.map(target => section ? { ...target, section, sectionTargetId: createSettingsSectionTargetId(section) } : target)]
    }
    const labels = (...values: string[]) => (target: SettingsSearchTarget) => values.includes(target.label)
    result.usage = [sectionTarget('Token activity', 'Token activity', 'usage tokens input output cached cache cost daily history'), sectionTarget('Breakdown', 'Breakdown', 'provider model tokens turns cost')]
    move('providers', 'provider-writing', () => true)
    move('account', 'providers', labels('ChatGPT subscription', 'OpenAI API key'), 'Connections')
    move('account', 'providers', target => target.section === 'ChatGPT accounts', 'Connections')
    result.providers = result.providers.map(target => target.label === 'ChatGPT accounts' ? sectionTarget('Connections', 'ChatGPT accounts', 'multiple accounts add provider sign in reconnect disconnect subscription') : target)
    result.account = result.account.filter(target => !['Other model providers', 'ChatGPT account', 'Usage limits', 'Banked resets'].includes(target.section))
    result.account.unshift(sectionTarget('ChatGPT usage', 'ChatGPT usage', 'accounts quota remaining used rate limits weekly five hour reset credits pause enable'))
    result.skills = result.skills.filter(target => target.section !== 'When changes apply').map(target => target.label === 'Resolution order' ? { ...target, keywords: `${target.keywords} reload new chats apply existing chats` } : target)
    result['skill-conflicts'] = [sectionTarget('Names to review', 'Skill name conflicts', 'overlapping duplicate skills unresolved resolved preferred source automatic priority')]
    result.providers.push(sectionTarget('Connections', 'Provider connections', 'opencode zen anthropic claude custom endpoint connect api key'))
    move('assistant', 'chat-defaults', labels('Model', 'Reasoning effort', 'Fast service tier'), 'Chat models')
    move('assistant', 'chat-defaults', labels('Default prompt', 'Permission mode', 'Busy send behavior'), 'New chat setup')
    move('assistant', 'provider-models', labels('Chat title model', 'Refresh chat titles', 'Title refresh interval'), 'Automatic titles')
    result['provider-models'].push(row('Delegated work', 'Approach', 'delegation automatic models reasoning cost quality speed balanced estimated api'), row('Delegated work', 'Your guidance', 'delegation notes preferences instructions agents planning implementation review debugging verification research'))
    move('assistant', 'chat-display', labels('Reasoning summaries'), 'Reasoning')
    move('assistant', 'general', labels('Reconnect on startup'), 'Startup')
    move('assistant', 'diagnostics', labels('Canonical diagnostics'), 'Chat troubleshooting')
    move('assistant', 'memory', labels('Context limit'), 'Context')
    move('assistant', 'chat-display', target => target.section === 'Output and history', 'Conversation display')
    result.assistant = result.assistant.map(target => {
        const section = target.label === 'Web access' ? 'Tools & approvals' : 'Chat behavior'
        return { ...target, section, sectionTargetId: createSettingsSectionTargetId(section) }
    })
    move('general', 'appearance-layout', target => target.section === 'Interface')
    result.general = result.general.map(target => target.section === 'Desktop host' ? { ...target, section: 'Startup', sectionTargetId: createSettingsSectionTargetId('Startup') } : target)
    move('appearance', 'appearance-typography', labels('UI font', 'Code font', 'Interface size', 'Code size'), 'Typography')
    move('appearance', 'appearance-layout', target => target.section === 'Preferences')
    move('appearance', 'appearance-colors', labels('Custom theme'), 'Custom theme')
    move('appearance', 'appearance-colors', labels('Accent primary', 'Accent secondary'), 'Accent values')
    move('appearance', 'appearance-colors', target => !['Appearance mode', 'Light and dark themes', 'Custom theme', 'Accent preset', 'Contrast'].includes(target.label), 'Theme colors')
    move('voice', 'voice-lab', target => target.section === 'Instructor Voice Lab')
    result['voice-history'] = [sectionTarget('Voice history', 'Voice history', 'dictation transcript failed recording audio playback')]
    move('connections', 'device-chrome', target => target.section === 'Chrome browser')
    result['device-chrome'] = [row('Chrome browser', 'Zyra Browser', 'chrome extension pairing connect disconnect tabs read control', 'Zyra Browser extension')]
    move('connections', 'device-mobile', target => target.section === 'Trusted devices')
    result['device-mobile'] = [{ ...row('Trusted devices', 'Continue from Android', 'mobile phone pairing network trusted devices revoke project access', 'Other devices'), section: 'Zyra on your phone', sectionTargetId: createSettingsSectionTargetId('Zyra on your phone') }]
    move('projects', 'project-discovery', target => target.section === 'Where Zyra looks')
    result.projects.push(sectionTarget('Project catalog', 'Project catalog', 'create projects active detected archived folders access associate restore custom icon override'))
    move('files-editor', 'file-editor', target => target.section === 'Editor defaults')
    move('browser-control', 'browser-privacy', target => target.section === 'Browser privacy')
    move('browser-control', 'browser-data', target => target.section === 'Site data')
    result['browser-extensions'] = [
        row('Extensions', 'Install unpacked', 'chrome extension manifest v3 install add permissions third party')
    ]
    move('source-control', 'git-pull-requests', target => target.section === 'Pull requests')
    move('source-control', 'git-writing', target => target.section === 'Text generation')
    move('memory', 'memory-inspect', target => ['Layers', 'Recommended prompts'].includes(target.section))
    result.memory.push(row('Memory', 'Remember useful details', 'enable disable optional saved context across conversations'), row('Memory', 'Processing model', 'automatic provider-aware OpenAI GPT-5.6 Luna medium ChatGPT Anthropic Claude Sonnet 5 low OpenCode Big Pickle'), sectionTarget('Memory', 'Memory overview', 'local saved memory paths locations'))
    result['memory-inspect'].push(row('Layers', 'Memory layer', 'select saved memory file'), sectionTarget('Locations', 'Memory file locations', 'data memory sessions cli path copy'))
    move('about', 'terminal-runtime', labels('zyra command'), 'Command-line access')
    result.diagnostics = result.diagnostics.map(target => target.section === 'Diagnostics' ? { ...target, section: 'Git-writing logs', sectionTargetId: createSettingsSectionTargetId('Git-writing logs') } : target)
    result['provider-writing'] = result['provider-writing'].filter(target => !['Git writing defaults', 'Connected account'].includes(target.label))
    result['git-writing-connections'] = [...result['provider-writing']]
    result['git-writing-logs'] = result.diagnostics.filter(target => target.section !== 'Chat troubleshooting')
    return result
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

// Bookmarked exact-setting links follow their controls when a page is reorganized.
export function resolveSettingsSearchLocation(pageId: string | null, targetId: string, settings?: Parameters<typeof getControllingSettingsTarget>[1]): { pathname: string; targetId: string } | null {
    const controlling = settings ? getControllingSettingsTarget(targetId, settings) : null
    if (controlling) return resolveSettingsSearchLocation(pageId, controlling)
    const at = (id: string, nextTarget: string) => ({ pathname: SETTINGS_DESTINATIONS.find(entry => entry.id === id)!.to, targetId: nextTarget })
    const sectionMoves: Array<[string, string, string]> = [
        ['Desktop host', 'general', 'Startup'], ['Interface', 'appearance-layout', 'Interface'],
        ['Preferences', 'appearance-layout', 'Preferences'], ['Assistant defaults', 'assistant', 'Chat behavior'],
        ['New chat permissions', 'chat-defaults', 'New chat setup'],
        ['Reasoning and context', 'memory', 'Context'], ['Output and history', 'chat-display', 'Conversation display'],
        ['OpenAI connections', 'providers', 'Connections'], ['Other model providers', 'providers', 'Connections'],
        ['Browser workspace', 'browser-control', 'Browsing'], ['Discovery locations', 'project-discovery', 'Where Zyra looks'],
        ['Providers', 'git-writing', 'Text generation'], ['Zyra · ChatGPT', 'git-writing', 'Text generation'],
        ['Groq', 'provider-writing', 'Hosted providers'], ['Google Gemini', 'provider-writing', 'Hosted providers'],
        ['Diagnostics', 'diagnostics', 'Git-writing logs'], ['Trusted devices', 'device-mobile', 'Zyra on your phone']
    ]
    if (targetId === createSettingsSectionTargetId('When changes apply') || targetId === createSettingsRowTargetId('When changes apply', 'New chats')) return at('skills', createSettingsRowTargetId('Skill sources', 'Resolution order'))
    for (const [oldSection, label] of [['Chat behavior', 'Default prompt'], ['Tools & approvals', 'Permission mode'], ['Chat behavior', 'Busy send behavior']]) {
        if (targetId === createSettingsRowTargetId(oldSection, label)) return at('chat-defaults', createSettingsRowTargetId('New chat setup', label))
    }
    if (['ChatGPT account', 'ChatGPT accounts'].some(section => targetId === createSettingsSectionTargetId(section)) || ['Connection', 'Email', 'Plan', 'Pi provider', 'Account ID', 'Access refresh', 'Connection source'].some(label => targetId === createSettingsRowTargetId('ChatGPT account', label))) return at('providers', createSettingsSectionTargetId('Connections'))
    if (['Usage limits', 'Banked resets'].some(section => targetId === createSettingsSectionTargetId(section)) || ['Usage display', 'Usage windows'].some(label => targetId === createSettingsRowTargetId('Usage limits', label)) || targetId === createSettingsRowTargetId('Banked resets', 'Reset credits')) return at('account', createSettingsSectionTargetId('ChatGPT usage'))
    if (['Provider', 'Planning', 'Implementation', 'Review', 'Debugging', 'Verification', 'Research', 'Other agents'].some(label => targetId === createSettingsRowTargetId('Delegated work', label))) return at('provider-models', createSettingsRowTargetId('Delegated work', 'Approach'))
    const movedSection = sectionMoves.find(([old]) => targetId === createSettingsSectionTargetId(old))
    if (movedSection) {
        const owner = pageId === 'git-writing-connections' && movedSection[1] === 'provider-writing' ? pageId : pageId === 'git-writing-logs' && movedSection[1] === 'diagnostics' ? pageId : movedSection[1]
        return at(owner, createSettingsSectionTargetId(movedSection[2]))
    }
    if (targetId === createSettingsRowTargetId('ChatGPT', 'Connected account')) return at('providers', createSettingsRowTargetId('OpenAI connections', 'ChatGPT subscription'))
    if (targetId === createSettingsSectionTargetId('ChatGPT')) return at('providers', createSettingsSectionTargetId('Connections'))
    if (targetId === createSettingsRowTargetId('Text generation', 'Git writing defaults')) return at('git-writing', createSettingsSectionTargetId('Text generation'))
    if (pageId === 'about' && targetId === createSettingsSectionTargetId('Terminal')) return at('terminal-runtime', createSettingsSectionTargetId('Command-line access'))
    if (targetId.startsWith('settings-row-discovery-locations-')) return at('project-discovery', targetId.replace('settings-row-discovery-locations-', 'settings-row-where-zyra-looks-'))
    const ownsTarget = (id: string) => SETTINGS_SEARCH_TARGETS[id]?.some(target => target.targetId === targetId || target.sectionTargetId === targetId)
    const destination = pageId && ownsTarget(pageId)
        ? SETTINGS_DESTINATIONS.find(entry => entry.id === pageId)
        : SETTINGS_DESTINATIONS.find(entry => ownsTarget(entry.id))
    return destination ? { pathname: destination.to, targetId } : null
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
        if (destination.contextual) continue
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
