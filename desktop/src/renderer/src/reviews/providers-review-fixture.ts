import type { ChatGptPoolSnapshot } from '@shared/onboarding/contracts'
import type { AssistantAccountOverview } from '@shared/assistant/contracts'

// Preview-only bridge. No connection to the installed app, personal accounts, or processes.
const scenario = new URLSearchParams(location.search).get('scenario') || 'weekly'
const dual = scenario === 'dual' || scenario === 'dual-missing'
const resetAt = new Date(Date.now() + 7 * 86400000).toISOString()
const primary = (usedPercent: number) => ({ usedPercent, resetAt: dual ? new Date(Date.now() + 5 * 3600000).toISOString() : resetAt, windowSeconds: dual ? 18000 : 604800 })
let pool: ChatGptPoolSnapshot = {
    accounts: scenario === 'empty' ? [] : ['alex@example.test', 'sam@example.test'].map((email, index) => ({
        id: `review-${index}`, email, plan: index ? 'prolite' : 'plus', primary: index === 0,
        enabled: true, state: scenario === 'signin' && index === 1 ? 'needs-sign-in' : 'ready',
        resetAt: null, lastUsedAt: null, requestCount: 0, tokenExpiresAt: null,
        usage: { primary: primary(index ? 35 : 15), secondary: dual && !(scenario === 'dual-missing' && index === 1) ? { usedPercent: index ? 10 : 45, resetAt, windowSeconds: 604800 } : null, updatedAt: new Date().toISOString() }
    })),
    policy: { strategy: 'balanced', accountMode: 'all', accountIds: [], preferredAccountId: null },
    checkedAt: new Date().toISOString()
}
let revision = 0
let settings = { settingsSchemaVersion: 5, theme: 'notion', appearanceThemeMode: 'dark', appearanceDarkTheme: 'notion', appearanceUiFont: 'hanken', accentColor: 'blue', assistantUsageDisplayMode: 'remaining', assistantDefaultModel: 'openai-codex/review-model', assistantTitleModel: 'openai-codex/review-model' }
const preferenceSnapshot = () => ({ version: 1, revision, settings, desktopLegacyMigrationComplete: true })
const status = () => ({ chatgpt: { configured: pool.accounts.length > 0, verified: pool.accounts.length > 0, detail: null }, apiKey: { configured: true, verified: true, detail: null } })
let overview: AssistantAccountOverview = {
    provider: 'openai-codex', source: 'review', account: { type: 'chatgpt', email: pool.accounts[0]?.email || null, planType: 'plus' },
    accountId: pool.accounts[0]?.id || null, emailVerified: true, tokenExpiresAt: null, authMode: 'chatgpt',
    requiresOpenaiAuth: !pool.accounts.length, rateLimits: null, rateLimitsByLimitId: {}, usageError: null,
    availableResetCount: 1, resetCredits: [{ id: 'review-reset', title: 'Codex reset', status: 'available', available: true, resetType: 'codex', grantedAt: null, expiresAt: resetAt, description: null }],
    resetCreditsError: null, fetchedAt: new Date().toISOString()
}
let jobs = scenario === 'running' ? [{ jobId: 'preview-server', toolCallId: 'review', command: 'npm run dev', status: 'running', background: true, startedAt: new Date().toISOString() }] : []
const unavailable = async () => ({ success: false, error: 'This action is unavailable in the test preview.' })
export function installProvidersReviewFixture() {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${navigator.userAgent} Electron/preview` })
    const bridge = {
        preferences: { get: async () => ({ success: true, snapshot: preferenceSnapshot() }), update: async ({ patch }: { patch: object }) => { settings = { ...settings, ...patch }; revision++; return { success: true, snapshot: preferenceSnapshot() } }, onChanged: () => () => {} },
        secrets: { migrateLegacyHostedAiKeys: async () => ({ success: true, status: { groqConfigured: false, geminiConfigured: false, legacyMigrationComplete: true } }) },
        onboarding: {
            getChatGptAccounts: async () => scenario === 'error' ? ({ success: false, error: 'Test: account usage unavailable. Refresh to retry.' }) : ({ success: true, pool: structuredClone(pool) }),
            updateChatGptAccounts: async (input: any) => {
                if (input.action === 'policy') pool.policy = input.policy
                if (input.action === 'enabled') pool.accounts = pool.accounts.map(a => a.id === input.accountId ? { ...a, enabled: input.enabled, state: input.enabled ? 'ready' : 'paused' } : a)
                if (input.action === 'remove') { pool.accounts = pool.accounts.filter(a => a.id !== input.accountId); if (!pool.accounts.some(a => a.primary) && pool.accounts.length) pool.accounts[0].primary = true; overview = { ...overview, account: pool.accounts[0] ? { type: 'chatgpt', email: pool.accounts[0].email, planType: 'plus' } : null, accountId: pool.accounts[0]?.id || null } }
                return { success: true, pool: structuredClone(pool) }
            },
            getConnectionsStatus: async () => ({ success: true, status: status() }),
            listModelProviders: async () => ({ success: true, connections: [{ provider: 'custom-review', label: 'Custom endpoint', verified: true, model: 'custom-review/model' }] }),
            connectChatGpt: async ({ accountId }: { accountId?: string }) => {
                if (accountId) pool.accounts = pool.accounts.map(account => account.id === accountId ? { ...account, state: 'ready' } : account)
                else pool.accounts.push({ id: `review-added-${pool.accounts.length}`, email: `new${pool.accounts.length + 1}@example.test`, plan: 'plus', primary: !pool.accounts.length, enabled: true, state: 'ready', resetAt: null, lastUsedAt: null, requestCount: 0, tokenExpiresAt: null, usage: null })
                return { success: true, status: status().chatgpt }
            },
            connectApiKey: unavailable, cancelChatGpt: async () => ({ success: true, cancelled: true }), getChatGptDeviceCode: async () => ({ success: true, deviceCode: null }),
            disconnectModelProvider: unavailable
        },
        assistant: {
            getAccountOverview: async () => ({ success: true, overview: structuredClone(overview) }),
            listModels: async () => ({ success: true, models: [{ id: 'openai-codex/review-model', name: 'Review model', provider: 'openai-codex', reasoning: true, input: ['text'], contextWindow: 256000, maxTokens: 32000 }] }),
            redeemAccountReset: async () => { overview.availableResetCount = 0; overview.resetCredits[0] = { ...overview.resetCredits[0], available: false, status: 'redeemed' }; return { success: true, overview: structuredClone(overview), redemption: { windowsReset: 1 }, refreshError: null } },
            listBackgroundProcesses: async () => ({ success: true, jobs: structuredClone(jobs), runtimeAvailable: true }),
            stopBackgroundProcesses: async () => { jobs = []; return { success: true, jobs: [], runtimeAvailable: true } },
            onEvent: () => () => {}
        },
        getStartupSettings: async () => ({ success: true, settings: { startMinimized: false, startWithWindows: false } }),
        getAppVersion: async () => '0.7.0-review',
        openExternal: async () => ({ success: true })
    }
    window.devscope = bridge as unknown as typeof window.devscope
    ;(window as any).__providersReview = { readPool: () => structuredClone(pool), scenario }
}
