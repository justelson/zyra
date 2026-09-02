import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    DARK_THEMES,
    LIGHT_THEMES,
    getThemeAppearance,
    getThemePresetAccent,
    loadSettings
} from '../src/renderer/src/lib/settings'
import { createSettingsRowTargetId, findSettingsSearchTargets } from '../src/renderer/src/pages/settings/settings-search'

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return Array.from(this.values.keys())[index] ?? null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

assert.ok(LIGHT_THEMES.length >= 24, 'Appearance must offer a broad light-theme catalog')
assert.ok(DARK_THEMES.length >= 24, 'Appearance must retain the full dark-theme catalog')
assert.ok(LIGHT_THEMES.every((theme) => getThemeAppearance(theme.id) === 'light'))
assert.ok(DARK_THEMES.every((theme) => getThemeAppearance(theme.id) === 'dark'))

storage.setItem('devscope-settings', JSON.stringify({
    theme: 'hostile-theme',
    accentColor: { name: 'Injected', primary: 'url(javascript:1)', secondary: '#fff' },
    compactMode: 'true',
    sidebarCollapsed: true,
    assistantAgentInboxSidebarEnabled: true,
    defaultShell: 'bash',
    projectsFolder: 42,
    additionalFolders: [' C:/one ', '', 99, 'C:/one', 'C:/two'],
    terminalFontSize: 999,
    terminalScrollback: -50,
    fileEditorFontSize: 1,
    fileDiffRenderMode: 'unknown',
    groqApiKey: 12,
    assistantDefaultPromptTemplate: ['not text'],
    projectIconOverrides: { ' C:/project ': ' C:/icon.png ', empty: '' },
    scrollMode: 'smooth',
    betaSettingsEnabled: true
}))

const sanitized = loadSettings()
assert.equal(sanitized.theme, 'dark')
assert.equal(sanitized.appearanceThemeMode, 'dark', 'legacy explicit themes must retain their visual mode')
assert.equal(sanitized.appearanceLightTheme, 'light')
assert.equal(sanitized.appearanceDarkTheme, 'dark')
assert.equal(sanitized.appearanceResolvedMode, 'dark')
assert.equal(sanitized.appearanceCustomTheme, null)
assert.equal(sanitized.appearanceCustomThemeActive, false)
assert.equal(sanitized.appearanceUiFont, 'bricolage')
assert.equal(sanitized.appearanceCodeFont, 'system-mono')
assert.equal(sanitized.accentColor.name, 'Blue')
assert.equal(sanitized.compactMode, false)
assert.equal(sanitized.sidebarCollapsed, true)
assert.equal(sanitized.assistantAgentInboxSidebarEnabled, true)
assert.equal(sanitized.defaultShell, 'powershell')
assert.equal(sanitized.projectsFolder, '')
assert.deepEqual(sanitized.additionalFolders, ['C:/one', 'C:/two'])
assert.equal(sanitized.terminalFontSize, 24)
assert.equal(sanitized.terminalScrollback, 1_000)
assert.equal(sanitized.fileEditorFontSize, 10)
assert.equal(sanitized.fileDiffRenderMode, 'stacked')
assert.equal(sanitized.groqApiKey, '')
assert.equal(sanitized.commitAIProvider, 'codex', 'preference hydration preserves the Codex default')
assert.equal(sanitized.assistantDefaultPromptTemplate, '')
assert.deepEqual(sanitized.projectIconOverrides, { 'C:/project': 'C:/icon.png' })
assert.equal('scrollMode' in sanitized, false)
assert.equal('betaSettingsEnabled' in sanitized, false)
assert.equal(sanitized.settingsSchemaVersion, 4)
assert.equal(sanitized.assistantToolOutputDefaultMode, 'expanded', 'existing installs preserve their prior live tool output behavior during schema migration')
assert.equal(sanitized.assistantHistoryPrefetch, false, 'older settings must not force an immediate second history page')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({
    settingsSchemaVersion: 2,
    assistantHistoryPrefetch: true
}))
assert.equal(loadSettings().assistantHistoryPrefetch, false, 'schema 2 prefetch defaults migrate to the safer opt-in behavior')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({
    settingsSchemaVersion: 3,
    assistantHistoryPrefetch: true
}))
assert.equal(loadSettings().assistantHistoryPrefetch, true, 'an explicit schema 3 prefetch choice remains supported')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ settingsSchemaVersion: 4 }))
const freshV4Settings = loadSettings()
assert.equal(freshV4Settings.appearanceLightTheme, 'light')
assert.equal(freshV4Settings.appearanceDarkTheme, 'dark')
assert.equal(freshV4Settings.appearanceUiFont, 'bricolage', 'new installs use Bricolage Grotesque as the interface default')
assert.equal(freshV4Settings.assistantToolOutputDefaultMode, 'minimized', 'new installs keep live tool responses closed by default')
assert.equal(freshV4Settings.assistantDefaultWebSearch, true, 'new installs enable web search by default')
assert.equal(freshV4Settings.assistantDefaultWebFetch, true, 'new installs enable page fetching by default')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ settingsSchemaVersion: 4, assistantDefaultWebSearch: false, assistantDefaultWebFetch: false }))
const explicitWebOff = loadSettings()
assert.equal(explicitWebOff.assistantDefaultWebSearch, false, 'a later explicit Settings choice must remain authoritative')
assert.equal(explicitWebOff.assistantDefaultWebFetch, false, 'a later explicit Settings choice must remain authoritative')

const explicitHanken = loadSettings({ settingsSchemaVersion: 4, appearanceUiFont: 'hanken' })
assert.equal(explicitHanken.appearanceUiFont, 'hanken', 'existing explicit font choices remain authoritative')

const explicitLightPair = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'light',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'forest',
    appearanceUiFont: 'bricolage'
})
assert.equal(explicitLightPair.theme, 'paper-light', 'fixed light mode resolves the selected light catalog entry')
assert.equal(explicitLightPair.appearanceResolvedMode, 'light')
assert.equal(explicitLightPair.appearanceUiFont, 'bricolage')
assert.equal(explicitLightPair.appearanceCustomThemeActive, false)

const systemPair = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'system',
    appearanceLightTheme: 'ocean-mist',
    appearanceDarkTheme: 'tokyo-night'
})
assert.equal(systemPair.theme, 'tokyo-night', 'headless system mode resolves the configured dark half')
assert.equal(systemPair.appearanceResolvedMode, 'dark')
assert.equal(systemPair.appearanceLightTheme, 'ocean-mist')
assert.equal(systemPair.appearanceDarkTheme, 'tokyo-night')

const explicitAccent = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'dark',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'forest',
    accentColor: { name: 'Custom', primary: '#8b1f66', secondary: '#236a75' }
})
assert.deepEqual(explicitAccent.accentColor, { name: 'Custom', primary: '#8b1f66', secondary: '#236a75' }, 'an explicit non-theme accent must survive hydration')

const systemAfterOfflineSchemeChange = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'system',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'tokyo-night',
    accentColor: getThemePresetAccent('paper-light')
})
assert.deepEqual(systemAfterOfflineSchemeChange.accentColor, getThemePresetAccent('tokyo-night'), 'System mode must replace a stale opposite-half default accent')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ settingsSchemaVersion: 4, assistantToolOutputDefaultMode: 'expanded' }))
assert.equal(loadSettings().assistantToolOutputDefaultMode, 'expanded', 'the persisted setting can explicitly enable live tool expansion')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ assistantTranscriptionEngine: 'vosk' }))
assert.equal(loadSettings().assistantTranscriptionEngine, 'codex', 'saved Vosk choices should migrate to Codex transcription')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ assistantTranscriptionEngine: 'codex' }))
assert.equal(loadSettings().assistantTranscriptionEngine, 'codex', 'saved Codex choices should remain selected')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ theme: 'light', lastDarkTheme: 'midnight' }))
const migratedLightTheme = loadSettings()
assert.equal(migratedLightTheme.appearanceThemeMode, 'light')
assert.equal(migratedLightTheme.appearanceLightTheme, 'light')
assert.equal(migratedLightTheme.appearanceDarkTheme, 'midnight', 'the legacy last dark preset must survive the new appearance mode')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({
    appearanceThemeMode: 'dark',
    theme: 'dark',
    appearanceCustomThemeActive: true,
    appearanceCustomTheme: {
        baseTheme: 'dark',
        tokens: { bg: '#112233' },
        accentColor: { name: 'Custom', primary: '#123456', secondary: '#abcdef' },
        uiFont: 'local:Aptos',
        codeFont: 'managed:google-jetbrains-mono-abc123'
    },
    appearanceUiFont: 'local:Aptos',
    appearanceCodeFont: 'managed:google-jetbrains-mono-abc123',
    accentColor: { name: 'Custom', primary: '#123456', secondary: '#abcdef' }
}))
const customTheme = loadSettings()
assert.equal(customTheme.appearanceCustomThemeActive, true)
assert.equal(customTheme.appearanceCustomTheme?.tokens.bg, '#112233')
assert.equal(customTheme.appearanceCustomTheme?.tokens.text, '#f0f4f8', 'missing custom values must inherit from the base theme')
assert.equal(customTheme.appearanceUiFont, 'local:Aptos')
assert.equal(customTheme.appearanceCodeFont, 'managed:google-jetbrains-mono-abc123')
assert.deepEqual(customTheme.accentColor, { name: 'Custom', primary: '#123456', secondary: '#abcdef' })

const inactiveSavedCustom = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'light',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'dark',
    appearanceCustomThemeActive: true,
    appearanceCustomTheme: customTheme.appearanceCustomTheme
})
assert.equal(inactiveSavedCustom.appearanceCustomThemeActive, false)
assert.ok(inactiveSavedCustom.appearanceCustomTheme, 'an inactive saved custom theme must not be deleted')

const systemWithSavedCustom = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'system',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'dark',
    appearanceCustomThemeActive: true,
    appearanceCustomTheme: customTheme.appearanceCustomTheme
})
assert.equal(systemWithSavedCustom.appearanceCustomThemeActive, false)
assert.ok(systemWithSavedCustom.appearanceCustomTheme, 'System mode must retain the saved custom theme for later reuse')

const lightCustomTheme = loadSettings({
    settingsSchemaVersion: 4,
    appearanceThemeMode: 'light',
    appearanceLightTheme: 'paper-light',
    appearanceDarkTheme: 'dark',
    appearanceCustomThemeActive: true,
    appearanceCustomTheme: {
        baseTheme: 'paper-light',
        tokens: { bg: '#fffaf0' },
        accentColor: { name: 'Custom', primary: '#8a4b2a', secondary: '#39705e' },
        uiFont: 'bricolage',
        codeFont: 'system-mono'
    }
})
assert.equal(lightCustomTheme.theme, 'paper-light')
assert.equal(lightCustomTheme.appearanceResolvedMode, 'light')
assert.equal(lightCustomTheme.appearanceCustomThemeActive, true)
assert.equal(lightCustomTheme.appearanceCustomTheme?.tokens.bg, '#fffaf0')

storage.clear()
storage.setItem('devscope-settings', JSON.stringify({ theme: 'midnight' }))
storage.setItem('devscope:project-details:diff-render-mode:v1', 'split')
storage.setItem('zyra-ui:active-profile:v2', 'builder')
storage.setItem('devscope:assistant-composer-preferences', JSON.stringify({
    model: 'legacy-model',
    runtimeMode: 'auto-review',
    interactionMode: 'plan',
    effort: 'high',
    fastModeEnabled: true
}))

const migrated = loadSettings()
assert.equal(migrated.theme, 'midnight')
assert.equal(migrated.appearanceThemeMode, 'dark')
assert.equal(migrated.appearanceDarkTheme, 'midnight', 'legacy dark presets must remain the selected dark preset')
assert.equal(migrated.assistantAgentInboxSidebarEnabled, false)
assert.equal(migrated.fileDiffRenderMode, 'split')
assert.equal(migrated.assistantProductProfile, 'builder')
assert.equal(migrated.assistantDefaultModel, 'legacy-model')
assert.equal(migrated.assistantTitleModel, 'openai-codex/gpt-5.6-luna')
assert.equal(migrated.assistantDefaultRuntimeMode, 'auto-review')
assert.equal('assistantDefaultInteractionMode' in migrated, false, 'retired Plan-mode preferences are removed')
assert.equal(migrated.assistantDefaultEffort, 'high')
assert.equal(migrated.assistantDefaultFastMode, true)

storage.setItem('devscope-settings', JSON.stringify({
    assistantDefaultModel: 'central-model',
    assistantTitleModel: 'openai-codex/gpt-5.6-terra',
    fileDiffRenderMode: 'stacked',
    assistantProductProfile: 'default'
}))
const centralWins = loadSettings()
assert.equal(centralWins.assistantDefaultModel, 'central-model')
assert.equal(centralWins.assistantTitleModel, 'openai-codex/gpt-5.6-terra')
assert.equal(centralWins.fileDiffRenderMode, 'stacked')
assert.equal(centralWins.assistantProductProfile, 'default')

const settingsLayoutSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/settings-layout.tsx'), 'utf8')
assert.match(settingsLayoutSource, /data-state=\{checked \? 'checked' : 'unchecked'\}/, 'Settings switches must expose an explicit visual state')
assert.match(settingsLayoutSource, /className="zyra-settings-switch"/, 'Settings switches must use the shared CSS contract')
assert.match(settingsLayoutSource, /max-w-\[680px\]/, 'Settings content must stay in the compact shared column')
assert.doesNotMatch(settingsLayoutSource, /\[var\(--accent-primary\)\]\/\d+/, 'Shared Settings controls cannot use unsupported Tailwind opacity on CSS variables')
assert.match(settingsLayoutSource, /export function SettingsStatusPill/, 'Settings rows should share one compact inline status treatment')
assert.doesNotMatch(settingsLayoutSource, /\{status \? <div className="pt-0\.5/, 'Settings status must not add a third text line below the description')
assert.match(settingsLayoutSource, /data-settings-search-target=\{searchTargetId\}/, 'Settings sections must expose stable search targets')
assert.match(settingsLayoutSource, /data-settings-search-target=\{searchTargetId \|\| undefined\}/, 'Settings rows must expose stable search targets')

const appearanceFontTargets = findSettingsSearchTargets('appearance', 'font').map((target) => target.label)
assert.deepEqual(appearanceFontTargets.slice(0, 2), ['UI font', 'Code font'], 'Settings search must return matching sub-options within a page')
assert.equal(findSettingsSearchTargets('appearance', 'paper')[0]?.label, 'Light theme', 'light palette search must reach the light catalog')
assert.equal(findSettingsSearchTargets('appearance', 'midnight')[0]?.label, 'Dark theme', 'dark palette search must reach the dark catalog')
assert.equal(findSettingsSearchTargets('terminal-runtime', 'font size')[0]?.targetId, createSettingsRowTargetId('Terminal', 'Font size'), 'search results must identify the exact section-aware row target')
assert.equal(findSettingsSearchTargets('connections', 'phone')[0]?.label, 'Other devices', 'Settings keywords must locate future-facing device controls')
assert.equal(findSettingsSearchTargets('assistant', 'web access')[0]?.label, 'Web access', 'Settings search must locate the web default after it leaves onboarding')
assert.equal(findSettingsSearchTargets('assistant', 'luna')[0]?.label, 'Chat title model', 'Settings search must locate the independent chat-title model')
assert.equal(findSettingsSearchTargets('assistant', 'detailed reasoning')[0]?.label, 'Reasoning summaries', 'Settings search must locate readable reasoning controls')
assert.equal(findSettingsSearchTargets('assistant', '256k')[0]?.label, 'Context limit', 'Settings search must locate the real automatic-compaction boundary')

const settingsShellSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/SettingsShell.tsx'), 'utf8')
assert.match(
    settingsShellSource,
    /useLayoutEffect\(\(\) => \{[\s\S]{0,120}if \(requestedSearchTarget\) return[\s\S]{0,240}scrollContainer\.scrollTop = 0[\s\S]{0,160}\}, \[location\.pathname, requestedSearchTarget\]\)/,
    'changing Settings pages must reset the shared content scroller before paint unless an exact search target owns the scroll'
)
assert.match(settingsShellSource, /<section ref=\{contentScrollRef\}[^>]+overflow-y-auto/, 'the reset must target the real Settings content scroller')
assert.match(settingsShellSource, /data-settings-sidebar-peek="true"/, 'collapsed Settings should expose the same left-edge peek target as chat')
assert.match(settingsShellSource, /zyra-sidebar-floating-surface absolute bottom-3 left-2 top-2 z-\[60\]/, 'collapsed Settings should use the shared floating bubble surface')
assert.match(settingsShellSource, /width: `\$\{ASSISTANT_BUBBLE_SIDEBAR_WIDTH\}px`/, 'the Settings bubble should use the same stable wide width as chat')
assert.match(settingsShellSource, /schedulePreviewClose\(ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS\)/, 'Settings collapse should retain the shared bubble morph before closing')
assert.match(settingsShellSource, /aria-label=\{previewPinned \? 'Unpin bubble sidebar' : 'Pin bubble sidebar'\}/, 'the Settings bubble should expose the shared pin control')
assert.match(settingsShellSource, /aria-label="Expand sidebar"/, 'the Settings bubble should expose the shared expand control')
assert.match(settingsShellSource, /mx-2 mt-auto shrink-0 border-t border-\[var\(--surface-divider\)\] pb-2\.5 pt-2/, 'Back to chats should use the same inset divider as Settings in the chat sidebar')
assert.match(settingsShellSource, /groupSettingsSearchTargets\(searchMatchesByPage\[item\.id\]/, 'Settings search must render matched sub-options beneath their page')
assert.match(settingsShellSource, /to=\{`\$\{item\.to\}\?setting=\$\{encodeURIComponent\(target\.targetId\)\}`\}/, 'sub-option results must navigate to an exact setting target')
assert.match(settingsShellSource, /target\.scrollIntoView\(\{[\s\S]{0,140}block: 'center'/, 'an exact Settings result must scroll its target into view')
assert.match(settingsShellSource, /target\.classList\.add\('zyra-settings-search-target'\)/, 'the selected setting must receive a visible arrival highlight')

const assistantSettingsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/AssistantSettings.tsx'), 'utf8')
assert.match(
    assistantSettingsSource,
    /title="Chat title model"[\s\S]{0,520}updateSettings\(\{ assistantTitleModel: event\.target\.value \}\)/,
    'Assistant Settings must expose the persisted chat-title model selector'
)
assert.match(
    assistantSettingsSource,
    /Names new chats without adding the title request to the conversation\./,
    'the title-model row must explain that utility prompts stay out of the chat timeline'
)
assert.match(
    assistantSettingsSource,
    /title="Reasoning summaries"[\s\S]{0,1200}<option value="detailed">Detailed<\/option>/,
    'Assistant Settings must expose the provider-supported detailed reasoning-summary mode'
)
assert.match(
    assistantSettingsSource,
    /title="Context limit"[\s\S]{0,1200}assistantContextCompactionThresholdTokens: Number\(event\.target\.value\)/,
    'Assistant Settings must persist the real automatic-compaction threshold'
)
assert.match(
    assistantSettingsSource,
    /ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_OPTIONS\.map/,
    'the context selector must use the shared bounded runtime policy options'
)
const accountSettingsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/AccountSettings.tsx'), 'utf8')
const accountResetCreditsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/AccountResetCreditsSection.tsx'), 'utf8')
const connectionsSettingsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/ConnectionsSettings.tsx'), 'utf8')
const browserControlSettingsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/BrowserControlSettings.tsx'), 'utf8')
const settingsNavigationSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/settings-navigation.tsx'), 'utf8')
const settingsRouteLoadersSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/settings-route-loaders.ts'), 'utf8')
const skillsSettingsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/settings/SkillsSettings.tsx'), 'utf8')
const appSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/App.tsx'), 'utf8')
assert.match(
    assistantSettingsSource,
    /title="Default prompt"[\s\S]{0,360}control=\{<SettingsButton onClick=\{openPromptTemplate\}>Edit prompt<\/SettingsButton>\}/,
    'the default prompt should be represented by a compact settings row'
)
assert.match(
    assistantSettingsSource,
    /<SettingsDialog[\s\S]*?open=\{promptTemplateOpen\}[\s\S]*?title="Edit default prompt"/,
    'the default prompt editor should use the shared Settings modal'
)
assert.match(
    assistantSettingsSource,
    /onClick=\{savePromptTemplate\}>Save prompt<\/SettingsButton>[\s\S]*?<SettingsTextarea[\s\S]*?value=\{promptTemplateDraft\}/,
    'the modal should expose an explicit Save action and draft-backed textarea'
)
assert.match(
    assistantSettingsSource,
    /updateSettings\(\{ assistantDefaultPromptTemplate: promptTemplateDraft \}\)/,
    'the prompt draft should persist only through the explicit modal save action'
)
assert.doesNotMatch(
    assistantSettingsSource,
    /onChange=\{\(event\) => updateSettings\(\{ assistantDefaultPromptTemplate:/,
    'typing in the modal must not mutate the saved prompt before Save is pressed'
)
assert.match(
    assistantSettingsSource,
    /options=\{\[\{ value: 'browser', label: 'Browser' \}, \{ value: 'codex', label: 'ChatGPT' \}\]\}/,
    'voice transcription settings should describe the account-backed engine as ChatGPT'
)
assert.doesNotMatch(
    assistantSettingsSource,
    /Local Vosk model|Download model/,
    'the retired Vosk download controls must not remain visible'
)
assert.match(
    assistantSettingsSource,
    /title="ChatGPT transcription"[\s\S]{0,260}status=\{chatGptVoiceStatus\.label\}[\s\S]{0,120}statusTone=\{chatGptVoiceStatus\.tone\}/,
    'ChatGPT transcription readiness should use the shared compact status beside the setting name'
)
assert.match(
    assistantSettingsSource,
    /title="Browser dictation"[\s\S]{0,220}status=\{browserSpeechAvailable \? 'Available' : 'Unavailable'\}[\s\S]{0,140}statusTone=\{browserSpeechAvailable \? 'ready' : 'warning'\}/,
    'Browser availability should use the shared compact status beside the setting name'
)
assert.doesNotMatch(
    assistantSettingsSource,
    /status=\{transcriptionError \|\| transcriptionState\?\.message/,
    'voice readiness should not render as a long status line below the row'
)
assert.match(
    accountSettingsSource,
    /<AccountResetCreditsSection[\s\S]{0,180}onOverviewChange=\{applyAccountOverview\}/,
    'the dedicated Account tab must expose the real banked-reset workflow'
)
assert.match(settingsNavigationSource, /label: 'Account'[\s\S]{0,220}to: '\/settings\/account'/, 'Account must be a real top-level Settings destination')
assert.match(appSource, /<Route path="account" element=\{<AccountSettings \/>\}/, 'the Account navigation destination must render the real account page')
assert.match(appSource, /const AccountSettings = lazy\(loadAccountSettings\)/, 'Settings lazy routes must reuse the same preloadable module loader')
assert.match(settingsNavigationSource, /label: 'Skills'[\s\S]{0,260}to: '\/settings\/skills'/, 'Skills must be a real top-level Settings destination')
assert.match(appSource, /<Route path="skills" element=\{<SkillsSettings \/>\}/, 'the Skills destination must render the real source manager')
assert.match(settingsRouteLoadersSource, /'\/settings\/skills': loadSkillsSettings/, 'Skills must participate in Settings intent preloading')
assert.match(skillsSettingsSource, /title="Resolution order"[\s\S]{0,520}Project skills still win over personal skills/, 'Skills settings must explain deterministic scope and source priority')
assert.match(skillsSettingsSource, /getSkillSourceOverview\(selectedProjectPath\)/, 'Skills settings must inspect personal and current-project source folders')
assert.match(skillsSettingsSource, /cachedOverviewProjectKey === projectCacheKey\(projectPath\)/, 'Skills settings must not reuse one project overview for another project')
assert.match(skillsSettingsSource, /updateSkillSourceSettings\(settings, selectedProjectPath\)/, 'source choices must persist through Desktop IPC with current-project context')
assert.match(skillsSettingsSource, /window\.devscope\.selectFolder\(\)/, 'users must be able to add another compatible agent skill folder')
assert.match(skillsSettingsSource, /function updateConflictPreference[\s\S]{0,520}preferredSourceBySkill/, 'conflict choices must persist as per-skill source overrides')
assert.match(skillsSettingsSource, /title="Resolve skill names"[\s\S]{0,2600}updateConflictPreference/, 'overlapping skill names must expose an explicit per-name source choice')
assert.match(settingsShellSource, /<Suspense fallback=\{<SettingsRouteFallback \/>\}>[\s\S]{0,100}<Outlet \/>/, 'first-visit page loading must preserve the Settings sidebar and shell')
assert.match(settingsShellSource, /onPointerEnter=\{\(\) => preloadSettingsRoute\(item\.to\)\}[\s\S]{0,160}onFocus=\{\(\) => preloadSettingsRoute\(item\.to\)\}/, 'Settings destinations must preload from mouse and keyboard intent')
assert.match(settingsRouteLoadersSource, /'\/settings\/account': loadAccountSettings[\s\S]*'\/settings\/about': loadAboutSettings/, 'every Settings destination must participate in intent preloading')
assert.match(settingsNavigationSource, /label: 'Connections'[\s\S]{0,260}to: '\/settings\/connections'/, 'Connections must be a real top-level Settings destination')
assert.match(appSource, /<Route path="connections" element=\{<ConnectionsSettings \/>\}/, 'the Connections destination must render the real connection page')
assert.match(connectionsSettingsSource, /copyToClipboard\(BROWSER_CLIENT_HOST_ORIGIN\)/, 'Connections must expose a working local-browser Copy link action')
assert.match(connectionsSettingsSource, /openBrowserPreviewExternal\(BROWSER_CLIENT_HOST_ORIGIN\)/, 'Connections must expose a working Desktop Open action')
assert.match(connectionsSettingsSource, /title="Connection scope"[\s\S]{0,220}status="Local only"/, 'Connections must state the real loopback-only access boundary')
assert.match(connectionsSettingsSource, /title="Trusted devices"[\s\S]{0,260}Connections from phones and other computers are currently disabled/, 'Connections must reserve the trusted-device surface without offering fake pairing controls')
assert.doesNotMatch(browserControlSettingsSource, /BROWSER_CLIENT_HOST_ORIGIN|Local browser client|openLocalBrowserClient/, 'Browser & control must stay focused on integrated-browser state after the link moves to Connections')
assert.doesNotMatch(assistantSettingsSource, /getAccountOverview|AccountResetCreditsSection/, 'Assistant settings must not fetch or render account data')
assert.doesNotMatch(`${accountSettingsSource}\n${accountResetCreditsSource}`, /Zyra subscription|subscription account|subscription-backed/, 'Account UI must not imply that Zyra owns the user’s ChatGPT plan')
assert.match(accountSettingsSource, /overviewLoading, setOverviewLoading\] = useState\(\(\) => !accountSettingsCache\.overview\)/, 'the first Account visit loads while a recent in-memory snapshot makes repeat visits immediate')
assert.match(accountSettingsSource, /ACCOUNT_POLL_INTERVAL_MS = 60_000[\s\S]{0,900}isAccountCacheFresh/, 'Account refreshes must use a bounded freshness window instead of aggressive remount polling')
assert.doesNotMatch(accountSettingsSource.split('const loadConnectionState')[1]?.split('const applyAccountOverview')[0] || '', /listModels/, 'Account connection status must not discover models during page entry')
assert.match(accountSettingsSource, /initialAccountLoading = overviewLoading && !overview/, 'background refreshes must preserve already-loaded account values')
assert.match(accountSettingsSource, /initialAccountLoading \? 'Checking…'/, 'unresolved account values must say Checking instead of showing unavailable placeholders')
assert.match(accountSettingsSource, /title="Usage windows"[\s\S]{0,180}status="Checking"/, 'usage limits must expose a clear initial loading row')
assert.match(accountResetCreditsSource, /title="Reset credits"/, 'the Account page must keep one compact reset summary row')
assert.match(
    accountResetCreditsSource,
    /onClick=\{openResetManager\}[\s\S]{0,220}View resets/,
    'reset credits must open from a single Account-row action instead of rendering inline'
)
assert.match(
    accountResetCreditsSource,
    /<SettingsDialog[\s\S]*?open=\{resetsOpen\}[\s\S]*?<ResetCreditList/,
    'the reset-credit list must render inside the formatted Settings modal'
)
assert.match(accountResetCreditsSource, /min-h-12 items-center[\s\S]{0,120}px-3 py-2/, 'reset rows must keep a compact single-line rhythm')
assert.doesNotMatch(accountResetCreditsSource, /Available now|Ready to use|!max-w-\[620px\]/, 'the reset modal must not repeat summary data or use the former oversized shell')
assert.doesNotMatch(accountResetCreditsSource, /credit\.description/, 'provider grant prose must stay out of the compact reset rows')
assert.match(
    accountResetCreditsSource,
    /title=\{selectedCredit \? 'Approve banked reset' : 'Banked resets'\}/,
    'the reset manager must enter a distinct approval prompt before redemption'
)
assert.match(
    accountResetCreditsSource,
    /Approve and use reset/,
    'the irreversible action must use explicit approval wording'
)
assert.doesNotMatch(
    accountResetCreditsSource,
    /window\.(?:confirm|prompt)\(/,
    'reset approval must use the formatted Settings modal rather than a plain browser prompt'
)
assert.match(
    accountResetCreditsSource,
    /redeemAccountReset\(\{[\s\S]{0,120}confirmed: true/,
    'banked reset redemption must cross IPC only after explicit confirmation'
)
assert.match(
    accountResetCreditsSource,
    /This spends one banked reset\.[\s\S]{0,120}action cannot be undone/,
    'the irreversible reset boundary must be visible in the confirmation dialog'
)

const settingsCss = readFileSync(resolve(import.meta.dir, '../src/renderer/src/index.css'), 'utf8')
assert.match(settingsCss, /\.zyra-settings-switch\[data-state='checked'\]/, 'Checked switch CSS must be explicit')
assert.match(settingsCss, /\.zyra-settings-switch:focus-visible/, 'Switch focus state must remain visible')
assert.match(settingsCss, /\.zyra-settings-section-body > \* \+ \*/, 'Every Settings row type must share section dividers')
assert.match(settingsCss, /\.settings-content-scrollbar\s*\{[^}]*scrollbar-gutter:\s*stable;/, 'Settings pages must reserve the content scrollbar gutter even when a page is short')
assert.doesNotMatch(settingsCss, /\.zyra-settings-footer::before/, 'Back to chats must not retain the old gradient-only divider')
assert.match(settingsLayoutSource, /max-h-\[calc\(100vh-2\.5rem\)\][\s\S]{0,120}flex-col overflow-hidden/, 'Settings dialogs must remain viewport bounded')
assert.match(settingsLayoutSource, /min-h-0 overflow-y-auto space-y-3/, 'Settings dialog bodies must scroll independently between fixed header and footer')
assert.match(settingsLayoutSource, /content-visibility:auto[\s\S]{0,100}contain-intrinsic-size:auto_68px/, 'offscreen Settings rows must skip layout and paint work')

console.log('settings contract: ok')
