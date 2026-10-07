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
    /** Main-resolved OS Documents/Zyra path. Older clients can omit it. */
    defaultProjectsFolder?: string | null
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
export type ChatGptSignInMethod = 'browser' | 'device-code'

export type ChatGptDeviceCode = {
    verificationUrl: string
    userCode: string
    expiresAt: string | null
}

export type AccountConnectionAnalyticsInput = {
    analyticsAction?: AccountConnectionAnalyticsAction
    signInMethod?: ChatGptSignInMethod
    accountId?: string
}

export type ChatGptRoutingPolicy = {
    strategy: 'balanced' | 'round-robin' | 'fill-first'
    accountMode: 'all' | 'selected'
    accountIds: string[]
    preferredAccountId: string | null
}
export type ChatGptAccountUsageWindow = { usedPercent: number; resetAt: string | null; windowSeconds: number | null }
export type ChatGptAccountProfile = {
    id: string; email: string | null; plan: string | null; primary: boolean; enabled: boolean
    state: 'ready' | 'limited' | 'paused' | 'needs-sign-in'; resetAt: string | null
    lastUsedAt: string | null; requestCount: number
    tokenExpiresAt: string | null
    usage: { primary: ChatGptAccountUsageWindow | null; secondary: ChatGptAccountUsageWindow | null; updatedAt: string } | null
}
export type ChatGptPoolSnapshot = { accounts: ChatGptAccountProfile[]; policy: ChatGptRoutingPolicy; checkedAt: string }
export type ChatGptAccountsUpdate =
    | { action: 'policy'; policy: ChatGptRoutingPolicy }
    | { action: 'enabled'; accountId: string; enabled: boolean }
    | { action: 'remove'; accountId: string; confirmed: true }

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

export type DelegationPreset = 'balanced' | 'cost' | 'quality' | 'speed'
export type DelegationPreferences = { version: 1; preset: DelegationPreset; notes: string }
export type DelegationPreferencesUpdate = Partial<Pick<DelegationPreferences, 'preset' | 'notes'>>
export type DelegationSettingsSnapshot = { preferences: DelegationPreferences; presets: Array<{ id: DelegationPreset; label: string; description: string }> }

export type AgentRoleModels = Record<string, Partial<Record<'planner' | 'implementer' | 'reviewer' | 'debugger' | 'verifier' | 'researcher' | 'specialist', string>>>
export type AgentRoleModelInput = { provider: string; role: string; model: string }

export type ModelProviderInput = { provider: 'opencode' | 'anthropic' | 'custom'; apiKey: string; name?: string; baseUrl?: string; model?: string; api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' }
export type ModelProviderConnection = { provider: string; label: string; model: string; verified: boolean; verifiedAt?: string }
export type ModelHarnessConnectInput = { model?: string }
export type HarnessDetection = { detected: { executable: string; version: string } | null }
export const HARNESS_PROVIDER_ID = 'opencode-harness'
export const ONBOARDING_IPC = {
    connectModelProvider: 'zyra:providers:connect',
    disconnectModelProvider: 'zyra:providers:disconnect',
    listModelProviders: 'zyra:providers:list',
    detectHarness: 'zyra:providers:detectHarness',
    connectHarness: 'zyra:providers:connectHarness',
    getDelegationPreferences: 'zyra:providers:delegationPreferences',
    saveDelegationPreferences: 'zyra:providers:saveDelegationPreferences',
    getAgentRoleModels: 'zyra:providers:roleModels',
    setAgentRoleModel: 'zyra:providers:saveRoleModel',
    getState: 'zyra:onboarding:get-state',
    getAuthStatus: 'zyra:onboarding:get-auth-status',
    getConnectionsStatus: 'zyra:account:get-openai-connections',
    getChatGptDeviceCode: 'zyra:account:get-chatgpt-device-code',
    getChatGptAccounts: 'zyra:account:get-chatgpt-accounts',
    updateChatGptAccounts: 'zyra:account:update-chatgpt-accounts',
    connectChatGpt: 'zyra:onboarding:connect-chatgpt',
    cancelChatGpt: 'zyra:onboarding:cancel-chatgpt',
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
