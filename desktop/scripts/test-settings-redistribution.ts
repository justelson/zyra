import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const settingsRoot = new URL('../src/renderer/src/pages/settings/', import.meta.url)
const source = (name: string) => readFileSync(new URL(name, settingsRoot), 'utf8')
const ownedFiles = [
    new URL('../src/renderer/src/pages/Settings.tsx', import.meta.url),
    ...[
        'AssistantSettings.tsx',
        'ChatDefaultsSettings.tsx',
        'ProviderModelSettings.tsx',
        'PermissionsSettings.tsx',
        'MemorySettings.tsx',
        'VoiceSettings.tsx',
        'ConnectionsSettings.tsx',
        'ArchivedChatsSettings.tsx',
        'LogsSettings.tsx',
        'DataPrivacySettings.tsx',
        'SkillsSettings.tsx'
    ].map((name) => new URL(name, settingsRoot))
]
for (const file of ownedFiles) {
    const contents = readFileSync(file, 'utf8')
    new Bun.Transpiler({ loader: 'tsx' }).transformSync(contents)
    for (const match of contents.matchAll(/\bdescription="([^"]+)"/g)) {
        assert.ok((match[1].match(/\.(?:\s|$)/g) || []).length <= 1, `${file.pathname}: normal descriptions must be a single sentence`)
    }
}

const general = readFileSync(ownedFiles[0]!, 'utf8')
assert.match(general, /title="Startup & setup"/)
assert.match(general, /assistantAutoReconnect/)
assert.match(general, /createSettingsRowTargetId\('Output and history', 'Reconnect on startup'\)/)
assert.doesNotMatch(general, /title="Interface"|sidebarCollapsed|sidebarHoverPreviewEnabled|assistantAgentInboxSidebarEnabled/)
assert.match(general, /getStartupSettings\(\)/)
assert.match(general, /setStartupSettings\(\{ openAtLogin, openAsHidden \}\)/)
assert.match(general, /beginReview\(\{ expectedRevision: revision \}\)/)

const assistant = source('AssistantSettings.tsx')
assert.match(assistant, /view = 'behavior'/)
assert.match(assistant, /title="Chats" navigation=\{<SettingsPageTabs family="chats" \/>\}/)
assert.match(assistant, /title="Chat behavior" searchSection="Assistant defaults"/)
assert.match(assistant, /title="Reasoning" searchSection="Reasoning and context"/)
assert.match(assistant, /title="Conversation display" searchSection="Output and history"/)
assert.match(assistant, /description="Set Zyra's tone without changing its tools or abilities\."/)
assert.match(assistant, /view === 'defaults' \? <ChatDefaultsSettings \/>/)
assert.doesNotMatch(assistant, /assistantDefaultModel|assistantTitleModel|assistantTitleAutoRegenerate|assistantDefaultEffort|assistantDefaultFastMode|assistantDefaultRuntimeMode|assistantDefaultWebSearch|assistantDefaultWebFetch|assistantContextCompactionThresholdTokens|assistantAutoReconnect|assistantShowDiagnostics/)
assert.doesNotMatch(assistant, /title="Default prompt"|title="Permission mode"|title="Busy send behavior"/)

const defaults = source('ChatDefaultsSettings.tsx')
assert.match(defaults, /export function ChatDefaultsSettings\(\)/)
assert.doesNotMatch(defaults, /SettingsPageContainer/)
assert.match(defaults, /ChatDefaultModelPicker/, 'Chat defaults uses the searchable provider-aware model picker rather than a native select')
for (const key of ['assistantDefaultModel', 'assistantDefaultEffort', 'assistantDefaultFastMode']) {
    assert.match(defaults, new RegExp(key), `Chat defaults keeps ${key}`)
}
for (const effort of ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.match(defaults, new RegExp(`'${effort}'`), `Chat defaults keeps ${effort} reasoning effort`)
}
assert.match(defaults, /retainSavedModel/)
assert.match(defaults, /title="Default prompt"/)
assert.match(defaults, /title="Permission mode"/)
assert.match(defaults, /title="Busy send behavior"/)
assert.match(defaults, /updateSettings\(\{ assistantDefaultPromptTemplate: promptTemplateDraft \}\)/)

const models = source('ProviderModelSettings.tsx')
assert.match(models, /export function ProviderModelSettings\(\)/)
assert.doesNotMatch(models, /SettingsPageContainer/)
for (const key of ['assistantTitleModel', 'assistantTitleAutoRegenerate', 'assistantTitleAutoRegenerateTurns']) {
    assert.match(models, new RegExp(key), `Provider models keeps ${key}`)
}
assert.match(models, /retainSavedModel/)
assert.match(models, /ChatDefaultModelPicker/, 'Automatic titles uses the same searchable provider-aware model picker')
assert.match(models, /DEFAULT_ASSISTANT_TITLE_MODEL/)
assert.match(models, /MIN_ASSISTANT_AUTO_TITLE_TURNS/)
assert.match(models, /MAX_ASSISTANT_AUTO_TITLE_TURNS/)
assert.match(models, /disabled=\{!settings\.assistantTitleAutoRegenerate\}/)

const permissions = source('PermissionsSettings.tsx')
assert.match(permissions, /export function ChatAccessSettings/)
assert.match(permissions, /searchSection="Assistant defaults"/)
assert.doesNotMatch(permissions, /title="Permission mode"/)
assert.match(permissions, /assistantDefaultWebSearch/)
assert.match(permissions, /assistantDefaultWebFetch/)

const memory = source('MemorySettings.tsx')
assert.match(memory, /view = 'overview'/)
assert.match(memory, /title=\{view === 'inspect' \? 'Saved memory' : 'Context & memory'\}/)
assert.match(memory, /title="Context" searchSection="Reasoning and context"/)
assert.match(memory, /assistantContextCompactionThresholdTokens/)
assert.match(memory, /ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_OPTIONS\.map/)
assert.match(memory, /view === 'overview' \? \(/)
assert.match(memory, /if \(view === 'inspect'\) void load\(\)/, 'overview must not invoke the content-bearing memory API')
assert.match(memory, /<MemoryInspectView/)
assert.match(memory, /data-settings-search-target=\{createSettingsRowTargetId\('Layers', 'File content'\)\}/)
assert.ok(memory.indexOf('selectedLayer.content') > memory.indexOf('function MemoryInspectView'), 'layer contents are read only by the inspect view')

const voice = source('VoiceSettings.tsx')
assert.match(voice, /view = 'dictation'/)
assert.match(voice, /family="voice"/)
assert.match(voice, /view === 'dictation' \? <VoiceTranscriptionSettings \/>/)
assert.match(voice, /view === 'conversation' \? <VoiceConversationSettings \/>/)
assert.match(voice, /to="\/settings\/providers"/)
assert.match(voice, /requires a connected ChatGPT account/)

const connections = source('ConnectionsSettings.tsx')
assert.match(connections, /view = 'device'/)
assert.match(connections, /title="Devices" navigation=\{<SettingsPageTabs family="devices" \/>\}/)
assert.match(connections, /view === 'chrome' \? \(/)
assert.match(connections, /view === 'mobile' \? \(/)
assert.match(connections, /createSettingsRowTargetId\('Chrome browser', 'Zyra Browser extension'\)/)
assert.match(connections, /createSettingsRowTargetId\('Trusted devices', 'Other devices'\)/)
assert.equal((connections.match(/<ChromeBrowserConnectionSettings \/>/g) || []).length, 1)
assert.equal((connections.match(/<MobileConnectionSettings \/>/g) || []).length, 1)

const archived = source('ArchivedChatsSettings.tsx')
assert.match(archived, /<SettingsPageContainer title="Archived chats" fillViewport>/)
assert.doesNotMatch(archived, /SettingsPageTabs/)
assert.match(archived, /createSettingsRowTargetId\('Archive', 'Search'\)/)
assert.match(archived, /archiveSessionResult/)
assert.match(archived, /deleteSessionResult/)
assert.match(archived, /paginateSettingsItems/)

const logs = source('LogsSettings.tsx')
assert.match(logs, /title="Chat troubleshooting" searchSection="Output and history"/)
assert.match(logs, /assistantShowDiagnostics/)
assert.match(logs, /Git-writing logs/)
assert.match(logs, /Git-writing records/)
assert.doesNotMatch(logs, /auth|OAuth|token/i, 'Diagnostics must not add auth logging')

const privacy = source('DataPrivacySettings.tsx')
assert.match(privacy, /title="Privacy & data"/)
assert.match(privacy, /<AnalyticsPrivacyRow/)
assert.match(privacy, /control=\{<SettingsButton onClick=\{clearCache\}>Clear cache<\/SettingsButton>\}/)
assert.doesNotMatch(privacy, /Archived chats|\/settings\/assistant\/archived/)

console.log('Settings redistribution: owned syntax, view splits, control ownership, stable legacy row sections and safety boundaries: ok')
