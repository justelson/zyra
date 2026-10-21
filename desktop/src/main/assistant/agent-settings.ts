import { DEFAULT_DEVICE_SETTINGS } from '../../shared/preferences/default-settings'
import { SHARED_DEVICE_PREFERENCE_KEYS, SURFACE_DEVICE_PREFERENCE_KEYS, OS_DEVICE_PREFERENCE_KEYS, SECRET_DEVICE_PREFERENCE_KEYS, DERIVED_DEVICE_PREFERENCE_KEYS, getDevicePreferenceOwnership, type DevicePreferenceSurface } from '../../shared/preferences/contracts'
import { describeDevicePreferenceValue, sanitizeDevicePreferenceValue, type DevicePreferencesService } from '../setup/device-preferences-service'
import type { DeviceSecretsService } from '../setup/device-secrets-service'
import type { AppOperationReceipts } from './app-operation-receipts'

const MIRRORS = new Set(['assistantDefaultModel', 'assistantDefaultEffort', 'assistantDefaultRuntimeMode'])
const defaults = DEFAULT_DEVICE_SETTINGS as Record<string, unknown>
const allKeys = [...SHARED_DEVICE_PREFERENCE_KEYS, ...SURFACE_DEVICE_PREFERENCE_KEYS, ...OS_DEVICE_PREFERENCE_KEYS, ...SECRET_DEVICE_PREFERENCE_KEYS, ...DERIVED_DEVICE_PREFERENCE_KEYS]
const groupFor = (key: string) => key.startsWith('appearance') || key === 'theme' || key === 'accentColor' || key === 'compactMode' || key.startsWith('accessibility') ? 'appearance'
    : key.startsWith('assistantBrowser') || key.startsWith('browser') ? 'browser'
    : key.startsWith('git') || key === 'commitAIProvider' ? 'git'
    : key.startsWith('file') ? 'files' : key.startsWith('terminal') || key === 'defaultShell' || key === 'packageRuntimePreference' ? 'terminal'
    : /Memory|Compaction/.test(key) ? 'memory' : /Transcription/.test(key) ? 'voice'
    : /Model|Title/.test(key) ? 'models' : /projectsFolder|additionalFolders|projectIcon|explorerHome/.test(key) ? 'projects'
    : key === 'keyboardShortcuts' ? 'shortcuts' : key.startsWith('assistant') ? 'chats' : 'general'
const routeFor = (group: string) => ({ appearance: '/settings/app/appearance', browser: '/settings/workspace/browser', git: '/settings/workspace/source-control', files: '/settings/workspace/files', terminal: '/settings/workspace/terminal', memory: '/settings/assistant/memory', voice: '/settings/assistant/voice', models: '/settings/providers/models', projects: '/settings/workspace/projects', shortcuts: '/settings/app/keyboard-shortcuts', chats: '/settings/assistant/defaults', general: '/settings/app/general' })[group]!
const protectedKeys = /(?:RuntimeMode|MemoryEnabled|WebSearch|WebFetch|GoogleSuggestions|projectsFolder|additionalFolders|explorerHomePath|Skill|analytics|consent|endpoint|baseUrl)/i
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export type AgentSettingDescriptor = Record<string, unknown> & { id: string; area: string; scope: string; writable: boolean;
    defaultValue?: unknown; savedValue?: unknown; effectiveValue?: unknown; source?: string; configured?: boolean | null;
    effect: string; requiresApproval: boolean; settingsRoute: string }

export class AgentSettings {
    constructor(private readonly preferences: DevicePreferencesService, private readonly secrets: Pick<DeviceSecretsService, 'getHostedAiStatus'>) {}
    async inspect(params: Record<string, unknown>) {
        const surface: DevicePreferenceSurface = params.surface === 'browser' ? 'browser' : 'desktop'
        const snapshot = await this.preferences.get({ surface })
        const status = await this.secrets.getHostedAiStatus().catch(() => ({ groqConfigured: null, geminiConfigured: null }))
        const memoryEnabled = await this.preferences.getAssistantMemoryEnabled()
        const memoryDefault = await this.preferences.getAssistantMemoryResetValue()
        const selected = Array.isArray(params.keys) ? new Set(params.keys.map(String)) : null
        const query = String(params.query || '').toLocaleLowerCase()
        const entries = allKeys.filter(key => (!selected || selected.has(key)) && (!query || `${key} ${groupFor(key)}`.toLocaleLowerCase().includes(query))
            && (!params.area || params.area === 'all' || groupFor(key) === params.area)).map((key): AgentSettingDescriptor => {
            const owner = getDevicePreferenceOwnership(key)
            const secret = owner === 'secret'
            const stored = snapshot.savedKeys?.includes(key) ?? Object.hasOwn(snapshot.settings, key)
            const writable = ['shared', 'surface'].includes(owner) && !MIRRORS.has(key) && !key.endsWith('PromptDismissed')
            return { id: key, area: groupFor(key), scope: owner === 'surface' ? surface : owner === 'shared' ? 'device' : owner,
                ...describeDevicePreferenceValue(key),
                writable, unavailableReason: MIRRORS.has(key) ? 'Compatibility mirror. Use remembered choices or exact Chat configuration.' : owner === 'os' ? 'Use startup.get/startup.update to inspect or change actual OS state.' : secret ? 'Use secure credential entry.' : !writable ? 'Derived or UI-owned state.' : null,
                ...(secret ? { configured: key === 'groqApiKey' ? status.groqConfigured : status.geminiConfigured } : {
                    defaultValue: key === 'assistantMemoryEnabled' ? memoryDefault : defaults[key] ?? null, savedValue: stored ? snapshot.settings[key] : null,
                    effectiveValue: owner === 'os' || owner === 'derived' ? null : key === 'assistantMemoryEnabled' ? memoryEnabled : snapshot.settings[key] ?? defaults[key] ?? null,
                    source: owner === 'os' || owner === 'derived' ? 'owning-service-required' : stored ? 'saved' : key === 'assistantMemoryEnabled' && memoryEnabled ? 'legacy-compatible-default' : 'default',
                }),
                effect: /Default|Title|Reasoning|Compaction|ProductProfile/.test(key) ? 'future-work' : 'immediate',
                requiresApproval: protectedKeys.test(key), settingsRoute: routeFor(groupFor(key)),
            }
        })
        return { owner: 'device-preferences', revision: snapshot.revision, surface, settings: entries,
            otherOwners: ['remembered', 'chat', 'delegation', 'accounts', 'voice', 'plugins', 'skills', 'connections', 'privacy', 'runtime'], updatedAt: snapshot.updatedAt }
    }
    private keys(params: Record<string, unknown>): string[] {
        const keys = params.keys || Object.keys(record(params.patch))
        if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new Error('Choose 1–100 exact setting IDs.')
        for (const key of keys) {
            if (typeof key !== 'string' || !['shared', 'surface'].includes(getDevicePreferenceOwnership(key)) || MIRRORS.has(key) || key.endsWith('PromptDismissed')) throw new Error(`Setting ${String(key).slice(0, 100)} is not directly writable. Read its owner and use its registered operation.`)
        }
        return keys
    }
    async preview(params: Record<string, unknown>, reset = false) {
        const keys = this.keys(params)
        const patch = record(params.patch)
        const current = await this.inspect({ ...params, keys, area: undefined, query: undefined })
        const changes = current.settings.map(setting => {
            const proposed = reset ? setting.defaultValue : patch[setting.id]
            const sanitized = sanitizeDevicePreferenceValue(setting.id, proposed)
            if (sanitized === undefined || JSON.stringify(sanitized) !== JSON.stringify(proposed)) throw new Error(`Invalid value for ${setting.id}. Read the setting constraints; no silent coercion was applied.`)
            return { id: setting.id, before: setting.effectiveValue, savedBefore: setting.savedValue, sourceBefore: setting.source, after: sanitized, effect: setting.effect, requiresApproval: setting.requiresApproval }
        })
        return { ...current, settings: undefined, changes, atomic: true, reset }
    }
    async apply(params: Record<string, unknown>, actorApproved: boolean, reset = false) {
        const preview = await this.preview(params, reset)
        if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision !== preview.revision) throw new Error(`Settings revision conflict. Read revision ${preview.revision} and preview again.`)
        if (preview.changes.some(change => change.requiresApproval) && !actorApproved) throw new Error('This settings change needs actual user approval.')
        const keys = preview.changes.map(change => change.id)
        const snapshot = await this.preferences.update({ surface: preview.surface, expectedRevision: preview.revision,
            patch: reset ? {} : Object.fromEntries(preview.changes.map(change => [change.id, change.after])) }, reset ? keys : [])
        return { owner: preview.owner, surface: preview.surface, revision: snapshot.revision, previousRevision: preview.revision, changes: preview.changes, applied: true }
    }
    async undo(params: Record<string, unknown>, actor: string, approved: boolean, receipts: AppOperationReceipts) {
        const history = await receipts.history(actor, false)
        const target = history.find(item => item.operationId === record(params.input).operationId && item.phase === 'completed' && item.domain === 'settings')
        const result = target?.result
        if (!result || result.undoEligible === false || !Array.isArray(result.changes)) throw new Error('Select an eligible completed settings receipt from history.')
        const changes = result.changes as Array<{ id: string; savedBefore: unknown; sourceBefore: string }>
        if (changes.some(change => protectedKeys.test(change.id)) && !approved) throw new Error('Undoing protected settings requires actual user approval.')
        const snapshot = await this.preferences.get({ surface: result.surface as DevicePreferenceSurface })
        if (params.expectedRevision !== snapshot.revision || result.revision !== snapshot.revision) throw new Error('Newer changes prevent safe Undo. Nothing was overwritten.')
        const resetKeys = changes.filter(change => change.sourceBefore !== 'saved').map(change => change.id)
        const restored = await this.preferences.update({ surface: snapshot.surface, expectedRevision: snapshot.revision,
            patch: Object.fromEntries(changes.filter(change => change.sourceBefore === 'saved').map(change => [change.id, change.savedBefore])) }, resetKeys)
        return { owner: 'device-preferences', revision: restored.revision, revertedOperationId: target!.operationId, restoredKeys: changes.map(change => change.id), applied: true }
    }
}
