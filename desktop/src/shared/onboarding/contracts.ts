import type { DarkThemeId, LightThemeId } from '../preferences/theme-contract'

export const ONBOARDING_SCHEMA_VERSION = 1 as const
export const ONBOARDING_FLOW_VERSION = 2 as const

export const ONBOARDING_STEPS = [
    'welcome',
    'connect-openai',
    'appearance',
    'projects',
    'review'
] as const

export type OnboardingStep = typeof ONBOARDING_STEPS[number]
export type OnboardingCompletionStatus = 'in-progress' | 'completed'
export type OnboardingAuthMethod = 'chatgpt' | 'api-key'

export type OnboardingAppearanceSelection = {
    appearanceThemeMode: 'system' | 'light' | 'dark'
    appearanceLightTheme: LightThemeId
    appearanceDarkTheme: DarkThemeId
    appearanceUiFont: string
    appearanceCodeFont: string
    accessibilityReduceMotion: boolean
}

export type LegacyOnboardingWebSelection = {
    webSearch: boolean
    webFetch: boolean
}

export type OnboardingProjectsSelection = {
    projectsFolder: string
}

export type OnboardingRecord = {
    schemaVersion: typeof ONBOARDING_SCHEMA_VERSION
    flowVersion: typeof ONBOARDING_FLOW_VERSION
    revision: number
    status: OnboardingCompletionStatus
    currentStep: OnboardingStep
    completedSteps: OnboardingStep[]
    reviewActive: boolean
    startedAt: string
    updatedAt: string
    completedAt: string | null
    data: {
        auth?: {
            method: OnboardingAuthMethod
            provider?: string
            label?: string
            verifiedAt: string
        }
        appearance?: OnboardingAppearanceSelection
        web?: LegacyOnboardingWebSelection
        projects?: OnboardingProjectsSelection
    }
}

export type OnboardingRecovery =
    | { reason: 'corrupt'; backupPath: string | null }
    | { reason: 'invalid-current-schema'; backupPath: string | null }
    | null

export type OnboardingSnapshot = {
    hydrated: true
    accessAllowed: boolean
    showOnboarding: boolean
    blockedReason: 'future-schema' | null
    detectedSchemaVersion: number | null
    recovery: OnboardingRecovery
    record: OnboardingRecord | null
}

export type OnboardingAuthStatus = {
    checking: boolean
    verified: boolean
    method: OnboardingAuthMethod | null
    provider: string | null
    label: string
    detail: string | null
    checkedAt: string
}

export type OpenAIConnectionMethodStatus = {
    method: OnboardingAuthMethod
    provider: 'openai-codex' | 'openai'
    configured: boolean
    verified: boolean
    label: string
    detail: string | null
    checkedAt: string
}

export type OpenAIConnectionsStatus = {
    chatgpt: OpenAIConnectionMethodStatus
    apiKey: OpenAIConnectionMethodStatus
    checkedAt: string
}

export type AccountConnectionAnalyticsAction = 'connect' | 'replace'

export type AccountConnectionAnalyticsInput = {
    analyticsAction?: AccountConnectionAnalyticsAction
}

export type AccountConnectionStatusInput = {
    analyticsAction?: 'retry'
}

export type DisconnectOpenAIInput = {
    method: OnboardingAuthMethod
    confirmed: true
}

export type UpdateOnboardingAppearanceInput = {
    expectedRevision: number
    selection: OnboardingAppearanceSelection
}

export type CommitOnboardingStepInput =
    | { expectedRevision: number; step: 'welcome' }
    | { expectedRevision: number; step: 'connect-openai' }
    | { expectedRevision: number; step: 'appearance'; selection: OnboardingAppearanceSelection }
    | { expectedRevision: number; step: 'projects'; selection: OnboardingProjectsSelection }
    | { expectedRevision: number; step: 'review' }

export type NavigateOnboardingInput = {
    expectedRevision: number
    step: OnboardingStep
}

export type BeginOnboardingReviewInput = {
    expectedRevision: number
    invalidateCompletion?: boolean
    confirmed?: boolean
}

export type CancelOnboardingReviewInput = {
    expectedRevision: number
}

export type AgentRoleModels = Record<string, Partial<Record<'planner' | 'implementer' | 'reviewer' | 'debugger' | 'verifier' | 'researcher' | 'specialist', string>>>
export type AgentRoleModelInput = { provider: string; role: string; model: string }

export type ModelProviderInput = { provider: 'opencode' | 'anthropic' | 'custom'; apiKey: string; name?: string; baseUrl?: string; model?: string; api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' }
export type ModelProviderConnection = { provider: string; label: string; model: string; verified: boolean; verifiedAt?: string }
export const ONBOARDING_IPC = {
    connectModelProvider: 'zyra:providers:connect',
    disconnectModelProvider: 'zyra:providers:disconnect',
    listModelProviders: 'zyra:providers:list',
    getAgentRoleModels: 'zyra:providers:roleModels',
    setAgentRoleModel: 'zyra:providers:saveRoleModel',
    getState: 'zyra:onboarding:get-state',
    getAuthStatus: 'zyra:onboarding:get-auth-status',
    getConnectionsStatus: 'zyra:account:get-openai-connections',
    connectChatGpt: 'zyra:onboarding:connect-chatgpt',
    connectApiKey: 'zyra:onboarding:connect-api-key',
    disconnectOpenAI: 'zyra:account:disconnect-openai',
    updateAppearance: 'zyra:onboarding:update-appearance',
    commitStep: 'zyra:onboarding:commit-step',
    navigate: 'zyra:onboarding:navigate',
    beginReview: 'zyra:onboarding:begin-review',
    cancelReview: 'zyra:onboarding:cancel-review',
    changed: 'zyra:onboarding:changed'
} as const

export function isOnboardingStep(value: unknown): value is OnboardingStep {
    return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export function getNextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
    const index = ONBOARDING_STEPS.indexOf(step)
    return index >= 0 ? ONBOARDING_STEPS[index + 1] || null : null
}

export function getPreviousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
    const index = ONBOARDING_STEPS.indexOf(step)
    return index > 0 ? ONBOARDING_STEPS[index - 1] || null : null
}
