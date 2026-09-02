import { readFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
    DEVICE_PREFERENCES_SCHEMA_VERSION,
    SHARED_DEVICE_PREFERENCE_KEYS,
    SURFACE_DEVICE_PREFERENCE_KEYS,
    getDevicePreferenceOwnership,
    isDevicePreferenceSurface,
    type DevicePreferenceSurface,
    type DevicePreferencesChangedEvent,
    type DevicePreferencesSnapshot,
    type GetDevicePreferencesInput,
    type ManagedDevicePreferenceKey,
    type UpdateDevicePreferencesInput
} from '../../shared/preferences/contracts'
import {
    DEFAULT_ASSISTANT_TITLE_MODEL,
    normalizeAssistantAutoTitleTurnInterval,
    type AssistantTitleAutomationPreferences
} from '../../shared/assistant/title-generation'
import {
    normalizeAssistantRuntimePolicy,
    type AssistantRuntimePolicy
} from '../../shared/assistant/runtime-policy'
import { isDarkThemeId, isLightThemeId } from '../../shared/preferences/theme-contract'
import { FutureSchemaError, RevisionConflictError, writeJsonAtomically } from './atomic-json'

type PreferenceBucket = Record<string, unknown>

type DevicePreferencesRecord = {
    schemaVersion: typeof DEVICE_PREFERENCES_SCHEMA_VERSION
    revision: number
    shared: PreferenceBucket
    surfaces: Record<DevicePreferenceSurface, PreferenceBucket>
    migrations: {
        desktopLegacyV4CompletedAt: string | null
    }
    updatedAt: string
}

type HydratedPreferences =
    | { kind: 'ready'; record: DevicePreferencesRecord }
    | { kind: 'future'; detectedVersion: number }

const MAX_PATH_LENGTH = 2_048
const MAX_PROMPT_LENGTH = 32_000
const MAX_RECORD_ENTRIES = 100
const MAX_JSON_DEPTH = 6

const BOOLEAN_KEYS = new Set<string>([
    'appearanceCustomThemeActive', 'compactMode', 'accessibilityReduceMotion', 'explorerTabEnabled',
    'filePreviewOpenInFullscreen', 'fileEditorMinimapEnabled', 'fileCsvDistinctColorsEnabled',
    'terminalCursorBlink', 'gitAutoRefreshOnProjectOpen', 'gitInitCreateGitignore',
    'gitInitCreateInitialCommit', 'gitWarnOnAuthorMismatch', 'gitPullRequestDefaultDraft',
    'gitAutoCreateBranchWhenTargetMatches', 'assistantDefaultFastMode', 'assistantTitleAutoRegenerate', 'assistantDefaultWebSearch',
    'assistantDefaultWebFetch', 'sidebarCollapsed', 'sidebarHoverPreviewEnabled', 'assistantAgentInboxSidebarEnabled',
    'filePreviewFullscreenShowLeftPanel', 'filePreviewFullscreenShowRightPanel',
    'assistantBrowserRestoreTabs', 'assistantBrowserGoogleSuggestions', 'assistantBrowserAdBlockEnabled',
    'assistantBrowserAdBlockPromptDismissed', 'assistantAutoReconnect', 'assistantHistoryPrefetch',
    'assistantShowStatusDetails', 'assistantShowDiagnostics', 'assistantTranscriptionEnabled'
])

const STRING_LIMITS: Record<string, number> = {
    appearanceUiFont: 128,
    appearanceCodeFont: 128,
    explorerHomePath: MAX_PATH_LENGTH,
    projectsFolder: MAX_PATH_LENGTH,
    gitInitDefaultBranch: 256,
    gitPullRequestDefaultTargetBranch: 256,
    gitCommitCodexModel: 256,
    gitPullRequestCodexModel: 256,
    assistantDefaultModel: 256,
    assistantTitleModel: 256,
    assistantDefaultPromptTemplate: MAX_PROMPT_LENGTH,
    assistantBrowserNewTabBackgroundId: 128
}

const ENUMS: Record<string, ReadonlySet<string>> = {
    appearanceThemeMode: new Set(['system', 'light', 'dark']),
    defaultShell: new Set(['powershell', 'cmd']),
    filePreviewDefaultMode: new Set(['preview', 'edit']),
    filePreviewPythonRunMode: new Set(['terminal', 'output']),
    filePreviewExplorerNameLayout: new Set(['wrap', 'horizontal']),
    fileEditorWordWrap: new Set(['on', 'off']),
    fileDiffRenderMode: new Set(['stacked', 'split']),
    packageRuntimePreference: new Set(['auto', 'node', 'npm', 'pnpm', 'yarn', 'bun']),
    gitBulkActionScope: new Set(['project', 'repo']),
    gitPullRequestDefaultGuideSource: new Set(['project', 'global', 'repo-template', 'none']),
    gitPullRequestDefaultChangeSource: new Set(['unstaged', 'staged', 'local-commits', 'all-local-work']),
    commitAIProvider: new Set(['groq', 'gemini', 'codex']),
    assistantProductProfile: new Set(['default', 'builder']),
    assistantDefaultRuntimeMode: new Set(['approval-required', 'auto-review', 'edits-only', 'full-access']),
    assistantDefaultEffort: new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    assistantReasoningSummary: new Set(['auto', 'detailed', 'concise']),
    assistantBusyMessageMode: new Set(['queue', 'force']),
    browserViewMode: new Set(['grid', 'finder']),
    browserContentLayout: new Set(['grouped', 'explorer']),
    assistantUsageDisplayMode: new Set(['remaining', 'used']),
    assistantTextStreamingMode: new Set(['stream', 'chunks']),
    assistantToolOutputDefaultMode: new Set(['expanded', 'minimized']),
    assistantTranscriptionEngine: new Set(['browser', 'codex']),
    assistantBrowserNewTabBackgroundMode: new Set(['off', 'built-in', 'unsplash']),
    assistantBrowserNewTabBackgroundCategory: new Set(['all', 'forest-paths', 'mountain-highs', 'ocean-moods', 'desert-dreams', 'water-in-motion', 'wildflower-party', 'animal-cameos', 'ice-aurora', 'earth-above']),
    assistantBrowserNewTabBackgroundRotation: new Set(['every-tab', 'fixed'])
}

const NUMBER_RANGES: Record<string, readonly [number, number]> = {
    fileEditorFontSize: [10, 24],
    terminalFontSize: [10, 24],
    terminalScrollback: [1_000, 50_000],
    filePreviewTerminalPanelHeight: [140, 720],
    assistantContextCompactionThresholdTokens: [64_000, 372_000],
    assistantTitleAutoRegenerateTurns: [3, 100]
}

const STRING_LIST_KEYS = new Set(['additionalFolders'])
const STRING_RECORD_KEYS = new Set(['projectIconOverrides'])
const JSON_OBJECT_KEYS = new Set(['appearanceCustomTheme', 'accentColor', 'gitPullRequestGlobalGuide', 'gitProjectPullRequestConfigs'])

function emptyRecord(now: string): DevicePreferencesRecord {
    return {
        schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
        revision: 0,
        shared: {},
        surfaces: { desktop: {}, browser: {} },
        migrations: { desktopLegacyV4CompletedAt: null },
        updatedAt: now
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeString(value: unknown, maxLength: number, preserveWhitespace = false): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = preserveWhitespace ? value : value.trim()
    return normalized.slice(0, maxLength)
}

function sanitizeStringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().slice(0, MAX_PATH_LENGTH))
        .filter(Boolean))]
        .slice(0, 32)
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) return undefined
    return Object.fromEntries(Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, entryValue]) => [key.trim().slice(0, MAX_PATH_LENGTH), entryValue.trim().slice(0, MAX_PATH_LENGTH)])
        .filter(([key, entryValue]) => Boolean(key && entryValue))
        .slice(0, MAX_RECORD_ENTRIES))
}

function sanitizeJson(value: unknown, depth = 0): unknown {
    if (depth > MAX_JSON_DEPTH) return undefined
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') return value.slice(0, MAX_PROMPT_LENGTH)
    if (Array.isArray(value)) {
        return value.slice(0, MAX_RECORD_ENTRIES)
            .map((entry) => sanitizeJson(entry, depth + 1))
            .filter((entry) => entry !== undefined)
    }
    if (!isRecord(value)) return undefined
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key.trim().length > 0 && !['__proto__', 'prototype', 'constructor'].includes(key))
        .slice(0, MAX_RECORD_ENTRIES)
        .flatMap(([key, entryValue]) => {
            const sanitized = sanitizeJson(entryValue, depth + 1)
            return sanitized === undefined ? [] : [[key.slice(0, 256), sanitized]]
        }))
}

export function sanitizeDevicePreferenceValue(key: string, value: unknown): unknown {
    if (key === 'appearanceLightTheme') return isLightThemeId(value) ? value : undefined
    if (key === 'appearanceDarkTheme') return isDarkThemeId(value) ? value : undefined
    if (BOOLEAN_KEYS.has(key)) return typeof value === 'boolean' ? value : undefined
    if (Object.prototype.hasOwnProperty.call(STRING_LIMITS, key)) {
        return sanitizeString(value, STRING_LIMITS[key]!, key === 'assistantDefaultPromptTemplate')
    }
    const values = ENUMS[key]
    if (values) return typeof value === 'string' && values.has(value) ? value : undefined
    const range = NUMBER_RANGES[key]
    if (range) {
        const number = Number(value)
        return Number.isFinite(number) ? Math.max(range[0], Math.min(range[1], Math.round(number))) : undefined
    }
    if (STRING_LIST_KEYS.has(key)) return sanitizeStringList(value)
    if (STRING_RECORD_KEYS.has(key)) return sanitizeStringRecord(value)
    if (JSON_OBJECT_KEYS.has(key)) return sanitizeJson(value)
    return undefined
}

export function partitionDevicePreferencePatch(
    patch: unknown,
    surface: DevicePreferenceSurface
): { shared: PreferenceBucket; surface: PreferenceBucket; changedKeys: ManagedDevicePreferenceKey[] } {
    const shared: PreferenceBucket = {}
    const surfacePatch: PreferenceBucket = {}
    const changedKeys: ManagedDevicePreferenceKey[] = []
    if (!isRecord(patch)) return { shared, surface: surfacePatch, changedKeys }

    for (const [key, value] of Object.entries(patch)) {
        const ownership = getDevicePreferenceOwnership(key)
        if (ownership !== 'shared' && ownership !== 'surface') continue
        const sanitized = sanitizeDevicePreferenceValue(key, value)
        if (sanitized === undefined) continue
        if (ownership === 'shared') shared[key] = sanitized
        else surfacePatch[key] = sanitized
        changedKeys.push(key as ManagedDevicePreferenceKey)
    }
    return { shared, surface: surfacePatch, changedKeys: [...new Set(changedKeys)] }
}

function sanitizeBucket(value: unknown, keys: readonly string[]): PreferenceBucket {
    if (!isRecord(value)) return {}
    const allowed = new Set(keys)
    return Object.fromEntries(Object.entries(value).flatMap(([key, entryValue]) => {
        if (!allowed.has(key)) return []
        const sanitized = sanitizeDevicePreferenceValue(key, entryValue)
        return sanitized === undefined ? [] : [[key, sanitized]]
    }))
}

function parseRecord(value: unknown): DevicePreferencesRecord | null {
    if (!isRecord(value)) return null
    if (value.schemaVersion !== DEVICE_PREFERENCES_SCHEMA_VERSION) return null
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null
    const surfaces = isRecord(value.surfaces) ? value.surfaces : {}
    const migrations = isRecord(value.migrations) ? value.migrations : {}
    const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
        ? value.updatedAt
        : new Date(0).toISOString()
    return {
        schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
        revision: Number(value.revision),
        shared: sanitizeBucket(value.shared, SHARED_DEVICE_PREFERENCE_KEYS),
        surfaces: {
            desktop: sanitizeBucket(surfaces.desktop, SURFACE_DEVICE_PREFERENCE_KEYS),
            browser: sanitizeBucket(surfaces.browser, SURFACE_DEVICE_PREFERENCE_KEYS)
        },
        migrations: {
            desktopLegacyV4CompletedAt: typeof migrations.desktopLegacyV4CompletedAt === 'string'
                ? migrations.desktopLegacyV4CompletedAt
                : null
        },
        updatedAt
    }
}

export class DevicePreferencesService {
    private hydrated: HydratedPreferences | null = null
    private hydrationPromise: Promise<HydratedPreferences> | null = null
    private operationQueue: Promise<void> = Promise.resolve()
    private readonly listeners = new Set<(event: DevicePreferencesChangedEvent) => void>()

    constructor(
        private readonly filePath: string,
        private readonly now: () => Date = () => new Date()
    ) {}

    subscribe(listener: (event: DevicePreferencesChangedEvent) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    async get(input: GetDevicePreferencesInput): Promise<DevicePreferencesSnapshot> {
        await this.operationQueue
        const surface = isDevicePreferenceSurface(input?.surface) ? input.surface : 'browser'
        if (surface === 'desktop' && isRecord(input?.legacySettings)) {
            await this.migrateDesktopLegacy(input.legacySettings)
        }
        const record = await this.requireReadyRecord()
        return this.snapshot(record, surface)
    }

    async update(input: UpdateDevicePreferencesInput): Promise<DevicePreferencesSnapshot> {
        const surface = isDevicePreferenceSurface(input?.surface) ? input.surface : 'browser'
        const expectedRevision = Number(input?.expectedRevision)
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) {
                throw new RevisionConflictError(expectedRevision, record.revision)
            }
            const partitioned = partitionDevicePreferencePatch(input?.patch, surface)
            if (partitioned.changedKeys.length === 0) return this.snapshot(record, surface)
            const next = this.withPatch(record, surface, partitioned.shared, partitioned.surface)
            await this.persist(next)
            this.emit({
                schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
                revision: next.revision,
                changedKeys: partitioned.changedKeys,
                sourceSurface: surface
            })
            return this.snapshot(next, surface)
        })
    }

    async updateSurfaceFromMain(surface: DevicePreferenceSurface, patch: Record<string, unknown>): Promise<DevicePreferencesSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            const partitioned = partitionDevicePreferencePatch(patch, surface)
            const changedKeys = partitioned.changedKeys.filter((key) => getDevicePreferenceOwnership(key) === 'surface')
            if (changedKeys.length === 0) return this.snapshot(record, surface)
            const next = this.withPatch(record, surface, {}, partitioned.surface)
            await this.persist(next)
            this.emit({
                schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
                revision: next.revision,
                changedKeys,
                sourceSurface: 'main'
            })
            return this.snapshot(next, surface)
        })
    }

    async updateSharedFromMain(patch: Record<string, unknown>): Promise<DevicePreferencesSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            const partitioned = partitionDevicePreferencePatch(patch, 'desktop')
            const changedKeys = partitioned.changedKeys.filter((key) => getDevicePreferenceOwnership(key) === 'shared')
            if (changedKeys.length === 0) return this.snapshot(record, 'desktop')
            const next = this.withPatch(record, 'desktop', partitioned.shared, {})
            await this.persist(next)
            this.emit({
                schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
                revision: next.revision,
                changedKeys,
                sourceSurface: 'main'
            })
            return this.snapshot(next, 'desktop')
        })
    }

    async getProjectDiscoveryRoots(): Promise<string[]> {
        const record = await this.requireReadyRecord()
        const primary = typeof record.shared.projectsFolder === 'string' ? record.shared.projectsFolder.trim() : ''
        const additional = Array.isArray(record.shared.additionalFolders)
            ? record.shared.additionalFolders.map((value) => String(value || '').trim()).filter(Boolean)
            : []
        return [...new Set([primary, ...additional].filter(Boolean))]
    }

    async getNewChatWebDefaults(): Promise<{ webSearch: boolean; webFetch: boolean }> {
        const record = await this.requireReadyRecord()
        return {
            webSearch: record.shared.assistantDefaultWebSearch !== false,
            webFetch: record.shared.assistantDefaultWebFetch !== false
        }
    }

    async getAssistantTitleModel(): Promise<string> {
        const record = await this.requireReadyRecord()
        const configured = typeof record.shared.assistantTitleModel === 'string'
            ? record.shared.assistantTitleModel.trim()
            : ''
        return configured || DEFAULT_ASSISTANT_TITLE_MODEL
    }

    async getAssistantTitleAutomation(): Promise<AssistantTitleAutomationPreferences> {
        const record = await this.requireReadyRecord()
        return {
            enabled: record.shared.assistantTitleAutoRegenerate === true,
            turnInterval: normalizeAssistantAutoTitleTurnInterval(record.shared.assistantTitleAutoRegenerateTurns)
        }
    }

    async getAssistantRuntimePolicy(): Promise<AssistantRuntimePolicy> {
        await this.operationQueue
        const record = await this.requireReadyRecord()
        return normalizeAssistantRuntimePolicy({
            reasoningSummary: record.shared.assistantReasoningSummary as AssistantRuntimePolicy['reasoningSummary'],
            contextCompactionThresholdTokens: record.shared.assistantContextCompactionThresholdTokens as number
        })
    }

    private migrateDesktopLegacy(legacySettings: Record<string, unknown>): Promise<void> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            if (record.migrations.desktopLegacyV4CompletedAt) return
            const partitioned = partitionDevicePreferencePatch(legacySettings, 'desktop')
            const now = this.now().toISOString()
            const next: DevicePreferencesRecord = {
                ...record,
                revision: record.revision + 1,
                // Existing main-owned values win if onboarding or another Desktop writer arrived first.
                shared: { ...partitioned.shared, ...record.shared },
                surfaces: {
                    ...record.surfaces,
                    desktop: { ...partitioned.surface, ...record.surfaces.desktop }
                },
                migrations: { desktopLegacyV4CompletedAt: now },
                updatedAt: now
            }
            await this.persist(next)
            this.emit({
                schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
                revision: next.revision,
                changedKeys: partitioned.changedKeys,
                sourceSurface: 'desktop'
            })
        })
    }

    private withPatch(
        record: DevicePreferencesRecord,
        surface: DevicePreferenceSurface,
        sharedPatch: PreferenceBucket,
        surfacePatch: PreferenceBucket
    ): DevicePreferencesRecord {
        const updatedAt = this.now().toISOString()
        return {
            ...record,
            revision: record.revision + 1,
            shared: { ...record.shared, ...sharedPatch },
            surfaces: {
                ...record.surfaces,
                [surface]: { ...record.surfaces[surface], ...surfacePatch }
            },
            updatedAt
        }
    }

    private snapshot(record: DevicePreferencesRecord, surface: DevicePreferenceSurface): DevicePreferencesSnapshot {
        return {
            schemaVersion: DEVICE_PREFERENCES_SCHEMA_VERSION,
            revision: record.revision,
            surface,
            settings: structuredClone({ ...record.shared, ...record.surfaces[surface] }),
            desktopLegacyMigrationComplete: Boolean(record.migrations.desktopLegacyV4CompletedAt),
            updatedAt: record.updatedAt
        }
    }

    private async requireReadyRecord(): Promise<DevicePreferencesRecord> {
        const hydrated = await this.hydrate()
        if (hydrated.kind === 'future') throw new FutureSchemaError(hydrated.detectedVersion)
        return hydrated.record
    }

    private hydrate(): Promise<HydratedPreferences> {
        if (this.hydrated) return Promise.resolve(this.hydrated)
        if (!this.hydrationPromise) {
            this.hydrationPromise = this.readFromDisk().then((hydrated) => {
                this.hydrated = hydrated
                return hydrated
            })
        }
        return this.hydrationPromise
    }

    private async readFromDisk(): Promise<HydratedPreferences> {
        const now = this.now().toISOString()
        let raw: string
        try {
            raw = await readFile(this.filePath, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'ready', record: emptyRecord(now) }
            throw error
        }

        let value: unknown
        try {
            value = JSON.parse(raw)
        } catch {
            await this.backupInvalidFile('corrupt')
            return { kind: 'ready', record: emptyRecord(now) }
        }
        const schemaVersion = isRecord(value) ? Number(value.schemaVersion) : Number.NaN
        if (Number.isFinite(schemaVersion) && schemaVersion > DEVICE_PREFERENCES_SCHEMA_VERSION) {
            return { kind: 'future', detectedVersion: schemaVersion }
        }
        const record = parseRecord(value)
        if (record) return { kind: 'ready', record }
        await this.backupInvalidFile('invalid')
        return { kind: 'ready', record: emptyRecord(now) }
    }

    private async backupInvalidFile(reason: string): Promise<void> {
        const backupPath = join(dirname(this.filePath), `${basename(this.filePath)}.${reason}-${this.now().getTime()}.bak`)
        await rename(this.filePath, backupPath).catch(() => undefined)
    }

    private async persist(record: DevicePreferencesRecord): Promise<void> {
        await writeJsonAtomically(this.filePath, record)
        this.hydrated = { kind: 'ready', record }
    }

    private emit(event: DevicePreferencesChangedEvent): void {
        for (const listener of [...this.listeners]) listener(event)
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(work)
        this.operationQueue = next.then(() => undefined, () => undefined)
        return next
    }
}
