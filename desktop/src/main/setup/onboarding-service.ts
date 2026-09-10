import { readFile, realpath, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import {
    ONBOARDING_FLOW_VERSION,
    ONBOARDING_SCHEMA_VERSION,
    ONBOARDING_STEPS,
    getNextOnboardingStep,
    isOnboardingStep,
    type BeginOnboardingReviewInput,
    type CancelOnboardingReviewInput,
    type CommitOnboardingStepInput,
    type NavigateOnboardingInput,
    type OnboardingAppearanceSelection,
    type OnboardingAuthStatus,
    type OnboardingRecord,
    type OnboardingRecovery,
    type OnboardingSnapshot,
    type OnboardingStep,
    type UpdateOnboardingAppearanceInput
} from '../../shared/onboarding/contracts'
import { isDarkThemeId, isLightThemeId } from '../../shared/preferences/theme-contract'
import type { DevicePreferencesService } from './device-preferences-service'
import type { OpenAIConnectionService } from './openai-connection-service'
import { RevisionConflictError, writeJsonAtomically } from './atomic-json'

type HydratedOnboarding =
    | { kind: 'ready'; record: OnboardingRecord }
    | { kind: 'future'; detectedVersion: number }

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function createInitialRecord(now: string): OnboardingRecord {
    return {
        schemaVersion: ONBOARDING_SCHEMA_VERSION,
        flowVersion: ONBOARDING_FLOW_VERSION,
        revision: 0,
        status: 'in-progress',
        currentStep: 'welcome',
        completedSteps: [],
        reviewActive: false,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        data: {}
    }
}

function validTimestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function sanitizeAppearanceSelection(value: unknown): OnboardingAppearanceSelection | null {
    if (!isRecord(value)) return null
    const appearanceThemeMode = value.appearanceThemeMode
    const appearanceLightTheme = value.appearanceLightTheme === undefined
        ? 'light'
        : isLightThemeId(value.appearanceLightTheme) ? value.appearanceLightTheme : null
    const appearanceDarkTheme = isDarkThemeId(value.appearanceDarkTheme) ? value.appearanceDarkTheme : null
    const appearanceUiFont = typeof value.appearanceUiFont === 'string' ? value.appearanceUiFont.trim().slice(0, 128) : ''
    const appearanceCodeFont = typeof value.appearanceCodeFont === 'string' ? value.appearanceCodeFont.trim().slice(0, 128) : ''
    if (
        (appearanceThemeMode !== 'system' && appearanceThemeMode !== 'light' && appearanceThemeMode !== 'dark')
        || appearanceLightTheme === null
        || appearanceDarkTheme === null
        || !appearanceUiFont
        || !appearanceCodeFont
        || typeof value.accessibilityReduceMotion !== 'boolean'
    ) return null
    return {
        appearanceThemeMode,
        appearanceLightTheme,
        appearanceDarkTheme,
        appearanceUiFont,
        appearanceCodeFont,
        accessibilityReduceMotion: value.accessibilityReduceMotion
    }
}

function parseRecord(value: unknown): OnboardingRecord | null {
    if (!isRecord(value)) return null
    if (value.schemaVersion !== ONBOARDING_SCHEMA_VERSION || value.flowVersion !== ONBOARDING_FLOW_VERSION) return null
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null
    if (value.status !== 'in-progress' && value.status !== 'completed') return null
    if (!isOnboardingStep(value.currentStep)) return null
    if (!validTimestamp(value.startedAt) || !validTimestamp(value.updatedAt)) return null
    if (!Array.isArray(value.completedSteps) || !value.completedSteps.every(isOnboardingStep)) return null
    const completedSteps = [...new Set(value.completedSteps)] as OnboardingStep[]
    const data = isRecord(value.data) ? value.data : {}
    const auth: OnboardingRecord['data']['auth'] = isRecord(data.auth)
        && (data.auth.method === 'chatgpt' || data.auth.method === 'api-key')
        && validTimestamp(data.auth.verifiedAt)
        ? { method: data.auth.method as 'chatgpt' | 'api-key', verifiedAt: data.auth.verifiedAt, ...(typeof data.auth.provider === 'string' ? { provider: data.auth.provider.slice(0, 160) } : {}), ...(typeof data.auth.label === 'string' ? { label: data.auth.label.slice(0, 160) } : {}) }
        : undefined
    const appearance: OnboardingRecord['data']['appearance'] = isRecord(data.appearance)
        && (data.appearance.appearanceThemeMode === 'system' || data.appearance.appearanceThemeMode === 'light' || data.appearance.appearanceThemeMode === 'dark')
        && (data.appearance.appearanceLightTheme === undefined || isLightThemeId(data.appearance.appearanceLightTheme))
        && isDarkThemeId(data.appearance.appearanceDarkTheme)
        && typeof data.appearance.appearanceUiFont === 'string'
        && typeof data.appearance.appearanceCodeFont === 'string'
        && typeof data.appearance.accessibilityReduceMotion === 'boolean'
        ? {
            appearanceThemeMode: data.appearance.appearanceThemeMode as 'system' | 'light' | 'dark',
            appearanceLightTheme: data.appearance.appearanceLightTheme === undefined
                ? 'light'
                : data.appearance.appearanceLightTheme,
            appearanceDarkTheme: data.appearance.appearanceDarkTheme,
            appearanceUiFont: data.appearance.appearanceUiFont.slice(0, 128),
            appearanceCodeFont: data.appearance.appearanceCodeFont.slice(0, 128),
            accessibilityReduceMotion: data.appearance.accessibilityReduceMotion
        }
        : undefined
    const web = isRecord(data.web)
        && typeof data.web.webSearch === 'boolean'
        && typeof data.web.webFetch === 'boolean'
        ? { webSearch: data.web.webSearch, webFetch: data.web.webFetch }
        : undefined
    const projects = isRecord(data.projects) && typeof data.projects.projectsFolder === 'string' && data.projects.projectsFolder.trim()
        ? { projectsFolder: data.projects.projectsFolder.trim().slice(0, 2_048) }
        : undefined
    const completedAt = value.completedAt === null || validTimestamp(value.completedAt) ? value.completedAt : null

    if (value.status === 'completed') {
        const reviewing = value.reviewActive === true
        const hasEveryStep = ONBOARDING_STEPS.every((step) => completedSteps.includes(step))
        if ((!reviewing && !hasEveryStep) || !completedAt || !auth || !appearance || !projects) return null
    }

    return {
        schemaVersion: ONBOARDING_SCHEMA_VERSION,
        flowVersion: ONBOARDING_FLOW_VERSION,
        revision: Number(value.revision),
        status: value.status,
        currentStep: value.currentStep,
        completedSteps,
        reviewActive: value.reviewActive === true && value.status === 'completed',
        startedAt: value.startedAt,
        updatedAt: value.updatedAt,
        completedAt,
        data: { auth, appearance, web, projects }
    }
}

const FLOW_V1_STEPS = ['welcome', 'connect-openai', 'appearance', 'web-access', 'projects', 'review'] as const
type FlowV1Step = typeof FLOW_V1_STEPS[number]

function isFlowV1Step(value: unknown): value is FlowV1Step {
    return typeof value === 'string' && (FLOW_V1_STEPS as readonly string[]).includes(value)
}

function migrateFlowV1Record(value: Record<string, unknown>, now: string): OnboardingRecord | null {
    if (value.schemaVersion !== ONBOARDING_SCHEMA_VERSION || value.flowVersion !== 1) return null
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || Number(value.revision) >= Number.MAX_SAFE_INTEGER) return null
    if (value.status !== 'in-progress' && value.status !== 'completed') return null
    if (!isFlowV1Step(value.currentStep)) return null
    if (!validTimestamp(value.startedAt) || !validTimestamp(value.updatedAt)) return null
    if (!Array.isArray(value.completedSteps) || !value.completedSteps.every(isFlowV1Step)) return null

    const legacyCompletedSteps = [...new Set(value.completedSteps)] as FlowV1Step[]
    const data = isRecord(value.data) ? value.data : {}
    const validLegacyWebSelection = isRecord(data.web)
        && typeof data.web.webSearch === 'boolean'
        && typeof data.web.webFetch === 'boolean'
    const completedAt = value.completedAt === null || validTimestamp(value.completedAt) ? value.completedAt : null
    if (value.status === 'completed') {
        const reviewing = value.reviewActive === true
        const hasEveryLegacyStep = FLOW_V1_STEPS.every((step) => legacyCompletedSteps.includes(step))
        if ((!reviewing && !hasEveryLegacyStep) || !completedAt || !validLegacyWebSelection) return null
    }

    const completedSteps = legacyCompletedSteps.filter((step): step is OnboardingStep => step !== 'web-access')
    const currentStep: OnboardingStep = value.currentStep === 'web-access'
        ? legacyCompletedSteps.includes('projects') ? 'review' : 'projects'
        : value.currentStep
    return parseRecord({
        ...value,
        flowVersion: ONBOARDING_FLOW_VERSION,
        revision: Number(value.revision) + 1,
        currentStep,
        completedSteps,
        updatedAt: now
    })
}

function withRevision(record: OnboardingRecord, now: string, patch: Partial<OnboardingRecord>): OnboardingRecord {
    return {
        ...record,
        ...patch,
        revision: record.revision + 1,
        updatedAt: now
    }
}

function markStepCompleted(record: OnboardingRecord, step: OnboardingStep): OnboardingStep[] {
    return [...new Set([...record.completedSteps, step])]
}

function requireRevision(record: OnboardingRecord, expectedRevision: unknown): void {
    const expected = Number(expectedRevision)
    if (!Number.isSafeInteger(expected) || expected !== record.revision) {
        throw new RevisionConflictError(expected, record.revision)
    }
}

function requireCurrentStep(record: OnboardingRecord, step: OnboardingStep): void {
    if (record.currentStep !== step) {
        throw new Error(`Finish the ${record.currentStep} setup step before continuing.`)
    }
}

function sameFilesystemPath(left: string, right: string): boolean {
    return process.platform === 'win32'
        ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
        : left === right
}

export async function validateOnboardingProjectsFolder(input: string): Promise<string> {
    if (!isAbsolute(input)) throw new Error('Choose an absolute projects folder.')

    let canonical: string
    try {
        canonical = await realpath(resolve(input))
        if (!(await stat(canonical)).isDirectory()) throw new Error('not-directory')
    } catch {
        throw new Error('Choose an existing projects folder.')
    }

    const filesystemRoot = parse(canonical).root
    const home = await realpath(homedir()).catch(() => resolve(homedir()))
    if (sameFilesystemPath(canonical, filesystemRoot) || sameFilesystemPath(canonical, home)) {
        throw new Error('Choose a bounded projects folder instead of an entire drive or home folder.')
    }
    return canonical
}

export class OnboardingService {
    private hydrated: HydratedOnboarding | null = null
    private hydrationPromise: Promise<HydratedOnboarding> | null = null
    private operationQueue: Promise<void> = Promise.resolve()
    private recovery: OnboardingRecovery = null
    private readonly listeners = new Set<(snapshot: OnboardingSnapshot) => void>()

    constructor(
        private readonly filePath: string,
        private readonly preferences: DevicePreferencesService,
        private readonly auth: OpenAIConnectionService,
        private readonly now: () => Date = () => new Date(),
        private readonly validateProjectsFolder: (path: string) => Promise<string> = validateOnboardingProjectsFolder,
        private readonly getAdditionalConnections: () => Promise<Array<{ provider: string; label: string; verified: boolean }>> = async () => []
    ) {}

    async initialize(): Promise<OnboardingSnapshot> {
        await this.hydrate()
        return this.getState()
    }

    subscribe(listener: (snapshot: OnboardingSnapshot) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    isAccessAllowed(): boolean {
        return this.hydrated?.kind === 'ready' && this.hydrated.record.status === 'completed'
    }

    shouldShowOnboarding(): boolean {
        return this.hydrated?.kind === 'ready'
            && (this.hydrated.record.status !== 'completed' || this.hydrated.record.reviewActive)
    }

    async getState(): Promise<OnboardingSnapshot> {
        const hydrated = await this.hydrate()
        if (hydrated.kind === 'future') {
            return {
                hydrated: true,
                accessAllowed: false,
                showOnboarding: true,
                blockedReason: 'future-schema',
                detectedSchemaVersion: hydrated.detectedVersion,
                recovery: null,
                record: null
            }
        }
        return this.snapshot(hydrated.record)
    }

    async getAuthStatus(): Promise<OnboardingAuthStatus> {
        const status = await this.auth.getStatus()
        if (status.verified) return status
        const additional = (await this.getAdditionalConnections()).find(connection => connection.verified)
        return additional ? { checking: false, verified: true, method: 'api-key', provider: additional.provider, label: `${additional.label} connected`, detail: null, checkedAt: this.now().toISOString() } : status
    }

    connectChatGpt(): Promise<OnboardingAuthStatus> {
        return this.auth.connectChatGpt()
    }

    connectApiKey(apiKey: string): Promise<OnboardingAuthStatus> {
        return this.auth.connectApiKey(apiKey)
    }

    updateAppearance(input: UpdateOnboardingAppearanceInput): Promise<OnboardingSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            requireRevision(record, input?.expectedRevision)
            requireCurrentStep(record, 'appearance')
            const selection = sanitizeAppearanceSelection(input?.selection)
            if (!selection) throw new Error('Choose a valid light and dark theme pair.')
            await this.preferences.updateSharedFromMain(selection)
            const next = withRevision(record, this.now().toISOString(), {
                data: { ...record.data, appearance: selection }
            })
            await this.persist(next)
            return this.emitSnapshot(next)
        })
    }

    commitStep(input: CommitOnboardingStepInput): Promise<OnboardingSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            requireRevision(record, input?.expectedRevision)
            requireCurrentStep(record, input.step)
            const now = this.now().toISOString()
            let next: OnboardingRecord

            switch (input.step) {
                case 'welcome': {
                    next = withRevision(record, now, {
                        completedSteps: markStepCompleted(record, input.step),
                        currentStep: 'connect-openai'
                    })
                    break
                }
                case 'connect-openai': {
                    const authStatus = await this.getAuthStatus()
                    if (!authStatus.verified || !authStatus.method) {
                        throw new Error(authStatus.detail || 'Connect a model provider before continuing.')
                    }
                    next = withRevision(record, now, {
                        completedSteps: markStepCompleted(record, input.step),
                        currentStep: 'appearance',
                        data: {
                            ...record.data,
                            auth: { method: authStatus.method, provider: authStatus.provider || undefined, label: authStatus.label, verifiedAt: authStatus.checkedAt }
                        }
                    })
                    break
                }
                case 'appearance': {
                    const selection = sanitizeAppearanceSelection(input.selection)
                    if (!selection) throw new Error('Choose a valid appearance before continuing.')
                    await this.preferences.updateSharedFromMain(selection)
                    next = withRevision(record, now, {
                        completedSteps: markStepCompleted(record, input.step),
                        currentStep: 'projects',
                        data: { ...record.data, appearance: selection }
                    })
                    break
                }
                case 'projects': {
                    const requestedFolder = String(input.selection?.projectsFolder || '').trim().slice(0, 2_048)
                    if (!requestedFolder) throw new Error('Choose a projects folder before continuing.')
                    const projectsFolder = await this.validateProjectsFolder(requestedFolder)
                    await this.preferences.updateSharedFromMain({ projectsFolder })
                    next = withRevision(record, now, {
                        completedSteps: markStepCompleted(record, input.step),
                        currentStep: 'review',
                        data: { ...record.data, projects: { projectsFolder } }
                    })
                    break
                }
                case 'review': {
                    const requiredSteps = ONBOARDING_STEPS.filter((step) => step !== 'review')
                    if (!requiredSteps.every((step) => record.completedSteps.includes(step))) {
                        throw new Error('Finish every setup step before opening Zyra.')
                    }
                    if (!record.data.appearance || !record.data.projects) {
                        throw new Error('Setup choices are incomplete. Go back and review them.')
                    }
                    const authStatus = await this.getAuthStatus()
                    if (!authStatus.verified || !authStatus.method) {
                        throw new Error(authStatus.detail || 'A model provider must be connected when setup is completed.')
                    }
                    next = withRevision(record, now, {
                        status: 'completed',
                        currentStep: 'review',
                        completedSteps: markStepCompleted(record, 'review'),
                        reviewActive: false,
                        completedAt: now,
                        data: {
                            ...record.data,
                            auth: { method: authStatus.method, provider: authStatus.provider || undefined, label: authStatus.label, verifiedAt: authStatus.checkedAt }
                        }
                    })
                    break
                }
            }

            await this.persist(next)
            return this.emitSnapshot(next)
        })
    }

    navigate(input: NavigateOnboardingInput): Promise<OnboardingSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            requireRevision(record, input?.expectedRevision)
            if (!isOnboardingStep(input?.step)) throw new Error('That setup step does not exist.')
            const currentIndex = ONBOARDING_STEPS.indexOf(record.currentStep)
            const targetIndex = ONBOARDING_STEPS.indexOf(input.step)
            if (targetIndex > currentIndex || (targetIndex < currentIndex && !record.completedSteps.includes(input.step))) {
                throw new Error('Complete setup steps in order.')
            }
            if (input.step === record.currentStep) return this.snapshot(record)
            const next = withRevision(record, this.now().toISOString(), { currentStep: input.step })
            await this.persist(next)
            return this.emitSnapshot(next)
        })
    }

    beginReview(input: BeginOnboardingReviewInput): Promise<OnboardingSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            requireRevision(record, input?.expectedRevision)
            if (record.status !== 'completed') throw new Error('Finish the required setup before reviewing it.')
            if (input.invalidateCompletion === true && input.confirmed !== true) {
                throw new Error('Explicit confirmation is required before making setup mandatory again.')
            }
            const now = this.now().toISOString()
            const next = withRevision(record, now, {
                status: input.invalidateCompletion === true ? 'in-progress' : 'completed',
                currentStep: 'welcome',
                completedSteps: [],
                reviewActive: input.invalidateCompletion !== true,
                completedAt: input.invalidateCompletion === true ? null : record.completedAt
            })
            await this.persist(next)
            return this.emitSnapshot(next)
        })
    }

    cancelReview(input: CancelOnboardingReviewInput): Promise<OnboardingSnapshot> {
        return this.enqueue(async () => {
            const record = await this.requireReadyRecord()
            requireRevision(record, input?.expectedRevision)
            if (record.status !== 'completed' || !record.reviewActive) return this.snapshot(record)
            const next = withRevision(record, this.now().toISOString(), {
                reviewActive: false,
                currentStep: 'review',
                completedSteps: [...ONBOARDING_STEPS]
            })
            await this.persist(next)
            return this.emitSnapshot(next)
        })
    }

    private snapshot(record: OnboardingRecord): OnboardingSnapshot {
        return {
            hydrated: true,
            accessAllowed: record.status === 'completed',
            showOnboarding: record.status !== 'completed' || record.reviewActive,
            blockedReason: null,
            detectedSchemaVersion: null,
            recovery: this.recovery,
            record: structuredClone(record)
        }
    }

    private emitSnapshot(record: OnboardingRecord): OnboardingSnapshot {
        const snapshot = this.snapshot(record)
        for (const listener of [...this.listeners]) listener(snapshot)
        return snapshot
    }

    private async requireReadyRecord(): Promise<OnboardingRecord> {
        const hydrated = await this.hydrate()
        if (hydrated.kind === 'future') {
            throw new Error(`Setup was created by a newer Zyra schema (${hydrated.detectedVersion}). Update Zyra before continuing.`)
        }
        return hydrated.record
    }

    private hydrate(): Promise<HydratedOnboarding> {
        if (this.hydrated) return Promise.resolve(this.hydrated)
        if (!this.hydrationPromise) {
            this.hydrationPromise = this.readFromDisk().then((hydrated) => {
                this.hydrated = hydrated
                return hydrated
            })
        }
        return this.hydrationPromise
    }

    private async readFromDisk(): Promise<HydratedOnboarding> {
        const now = this.now().toISOString()
        let raw: string
        try {
            raw = await readFile(this.filePath, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'ready', record: createInitialRecord(now) }
            throw error
        }

        let value: unknown
        try {
            value = JSON.parse(raw)
        } catch {
            const backupPath = await this.backupInvalidFile('corrupt')
            this.recovery = { reason: 'corrupt', backupPath }
            return { kind: 'ready', record: createInitialRecord(now) }
        }
        const schemaVersion = isRecord(value) ? Number(value.schemaVersion) : Number.NaN
        const flowVersion = isRecord(value) ? Number(value.flowVersion) : Number.NaN
        if (Number.isFinite(schemaVersion) && schemaVersion > ONBOARDING_SCHEMA_VERSION) {
            return { kind: 'future', detectedVersion: schemaVersion }
        }
        if (
            schemaVersion === ONBOARDING_SCHEMA_VERSION
            && Number.isFinite(flowVersion)
            && flowVersion > ONBOARDING_FLOW_VERSION
        ) {
            return { kind: 'future', detectedVersion: flowVersion }
        }
        if (schemaVersion === ONBOARDING_SCHEMA_VERSION && flowVersion === 1 && isRecord(value)) {
            const migrated = migrateFlowV1Record(value, now)
            if (migrated) {
                await writeJsonAtomically(this.filePath, migrated)
                return { kind: 'ready', record: migrated }
            }
        }
        const record = parseRecord(value)
        if (record) return { kind: 'ready', record }
        const backupPath = await this.backupInvalidFile('invalid')
        this.recovery = { reason: 'invalid-current-schema', backupPath }
        return { kind: 'ready', record: createInitialRecord(now) }
    }

    private async backupInvalidFile(reason: string): Promise<string | null> {
        const backupPath = join(dirname(this.filePath), `${basename(this.filePath)}.${reason}-${this.now().getTime()}.bak`)
        try {
            await rename(this.filePath, backupPath)
            return backupPath
        } catch {
            return null
        }
    }

    private async persist(record: OnboardingRecord): Promise<void> {
        await writeJsonAtomically(this.filePath, record)
        this.hydrated = { kind: 'ready', record }
        this.recovery = null
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(work)
        this.operationQueue = next.then(() => undefined, () => undefined)
        return next
    }
}

export function getExpectedNextStep(record: OnboardingRecord): OnboardingStep | null {
    return getNextOnboardingStep(record.currentStep)
}
