import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantAccountOverview, AssistantAccountPlanType, AssistantModelInfo } from '@shared/assistant/contracts'
import type { ChatGptDeviceCode, ChatGptSignInMethod, OnboardingAuthMethod, OpenAIConnectionMethodStatus, OpenAIConnectionsStatus } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import { buildRateLimitCards, formatPlan } from '../assistant-account-rate-limits'
import { startAccountOverviewPolling } from '../account-overview-polling'
import { invalidateSettingsModels, loadSettingsModels } from '../settings-model-catalog-cache'

const ACCOUNT_POLL_INTERVAL_MS = 60_000
const ACCOUNT_CACHE_TTL_MS = 45_000

const accountSettingsCache: {
    overview: AssistantAccountOverview | null
    overviewAt: number
    connections: OpenAIConnectionsStatus | null
    connectionsAt: number
} = {
    overview: null,
    overviewAt: 0,
    connections: null,
    connectionsAt: 0
}

let accountCacheGeneration = 0
let pendingAccountOverview: { generation: number; promise: Promise<AssistantAccountOverview> } | null = null
let pendingConnectionStatus: { generation: number; promise: Promise<OpenAIConnectionsStatus> } | null = null

function isAccountCacheFresh(updatedAt: number): boolean {
    return updatedAt > 0 && Date.now() - updatedAt < ACCOUNT_CACHE_TTL_MS
}

function invalidateAccountRuntimeCache(options: {
    overview?: boolean
    connections?: boolean
    clearOverview?: boolean
    clearConnections?: boolean
} = {}): void {
    accountCacheGeneration += 1
    if (options.overview !== false) accountSettingsCache.overviewAt = 0
    if (options.connections !== false) accountSettingsCache.connectionsAt = 0
    if (options.clearOverview) accountSettingsCache.overview = null
    if (options.clearConnections) accountSettingsCache.connections = null
}

registerSettingsCacheClearer('settings-account', () => invalidateAccountRuntimeCache({ clearOverview: true, clearConnections: true }))

async function requestAccountOverview(forceRefresh = false): Promise<AssistantAccountOverview> {
    if (!forceRefresh && accountSettingsCache.overview && isAccountCacheFresh(accountSettingsCache.overviewAt)) {
        return accountSettingsCache.overview
    }
    const previous = pendingAccountOverview
    if (previous) {
        if (previous.generation === accountCacheGeneration && !forceRefresh) return previous.promise
        await previous.promise.catch(() => undefined)
        if (pendingAccountOverview === previous) pendingAccountOverview = null
    }
    const generation = accountCacheGeneration
    const request = window.devscope.assistant.getAccountOverview(forceRefresh).then((result) => {
        if (!result.success) throw new Error(result.error || 'Could not load ChatGPT account information.')
        if (generation === accountCacheGeneration) {
            accountSettingsCache.overview = result.overview
            accountSettingsCache.overviewAt = Date.now()
        }
        return result.overview
    })
    const pending = { generation, promise: request }
    pendingAccountOverview = pending
    void request.finally(() => {
        if (pendingAccountOverview === pending) pendingAccountOverview = null
    }).catch(() => undefined)
    return request
}

async function requestConnectionStatus(forceRefresh = false, analyticsAction?: 'retry'): Promise<OpenAIConnectionsStatus> {
    if (!forceRefresh && accountSettingsCache.connections && isAccountCacheFresh(accountSettingsCache.connectionsAt)) {
        return accountSettingsCache.connections
    }
    const previous = pendingConnectionStatus
    if (previous) {
        if (previous.generation === accountCacheGeneration && !forceRefresh) return previous.promise
        await previous.promise.catch(() => undefined)
        if (pendingConnectionStatus === previous) pendingConnectionStatus = null
    }
    const generation = accountCacheGeneration
    const request = window.devscope.onboarding.getConnectionsStatus(analyticsAction ? { analyticsAction } : undefined).then((result) => {
        if (!result.success) throw new Error(result.error || 'Could not load OpenAI connections.')
        if (generation === accountCacheGeneration) {
            accountSettingsCache.connections = result.status
            accountSettingsCache.connectionsAt = Date.now()
        }
        return result.status
    })
    const pending = { generation, promise: request }
    pendingConnectionStatus = pending
    void request.finally(() => {
        if (pendingConnectionStatus === pending) pendingConnectionStatus = null
    }).catch(() => undefined)
    return request
}

function resolvePreferredPlanType(overview: AssistantAccountOverview | null): AssistantAccountPlanType | null {
    const accountPlanType = overview?.account?.planType ?? null
    const rateLimitPlanType = overview?.rateLimits?.planType ?? null
    if (rateLimitPlanType && rateLimitPlanType !== 'free') return rateLimitPlanType
    if (accountPlanType && accountPlanType !== 'free') return accountPlanType
    return accountPlanType || rateLimitPlanType
}

export function connectionStatusLabel(status: OpenAIConnectionMethodStatus | null): string {
    if (!status) return 'Checking…'
    if (status.verified) return 'Connected'
    return status.configured ? 'Needs attention' : 'Not connected'
}

export function connectionStatusTone(status: OpenAIConnectionMethodStatus | null): 'ready' | 'warning' | 'muted' {
    if (status?.verified) return 'ready'
    return status?.configured ? 'warning' : 'muted'
}

function methodOwnsModel(method: OnboardingAuthMethod, model: string): boolean {
    return method === 'chatgpt' ? model.startsWith('openai-codex/') : model.startsWith('openai/')
}

function firstModelForMethod(method: OnboardingAuthMethod, models: AssistantModelInfo[]): AssistantModelInfo | null {
    return models.find((model) => methodOwnsModel(method, model.id)) || null
}

export function useOpenAIAccountSettings({ usageActive = false, connectionsActive = false }: { usageActive?: boolean; connectionsActive?: boolean }) {
    const { settings, updateSettings } = useSettings()
    const [overview, setOverview] = useState<AssistantAccountOverview | null>(() => accountSettingsCache.overview)
    const [overviewLoading, setOverviewLoading] = useState(() => !accountSettingsCache.overview)
    const [overviewError, setOverviewError] = useState<string | null>(null)
    const overviewRequestIdRef = useRef(0)
    const desktopHost = isElectronRendererRuntime()
    const [connections, setConnections] = useState<OpenAIConnectionsStatus | null>(() => accountSettingsCache.connections)
    const [connectionError, setConnectionError] = useState<string | null>(null)
    const [connectionAction, setConnectionAction] = useState<'refresh' | 'chatgpt' | 'api-key' | 'switch' | 'disconnect' | null>(null)
    const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [disconnectMethod, setDisconnectMethod] = useState<OnboardingAuthMethod | null>(null)
    const [chatGptAuthenticationSuccessOpen, setChatGptAuthenticationSuccessOpen] = useState(false)
    const [chatGptDeviceCode, setChatGptDeviceCode] = useState<ChatGptDeviceCode | null>(null)
    const [chatGptDeviceCodeOpen, setChatGptDeviceCodeOpen] = useState(false)
    const chatGptDeviceCodeDismissedRef = useRef(false)

    const loadOverview = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && accountSettingsCache.overview && isAccountCacheFresh(accountSettingsCache.overviewAt)) {
            setOverview(accountSettingsCache.overview)
            setOverviewError(null)
            setOverviewLoading(false)
            return
        }
        const requestId = ++overviewRequestIdRef.current
        setOverviewLoading(true)
        setOverviewError(null)
        try {
            const nextOverview = await requestAccountOverview(forceRefresh)
            if (requestId !== overviewRequestIdRef.current) return
            setOverview(nextOverview)
        } catch (error) {
            if (requestId !== overviewRequestIdRef.current) return
            setOverviewError(error instanceof Error ? error.message : 'Could not load ChatGPT account information.')
        } finally {
            if (requestId === overviewRequestIdRef.current) setOverviewLoading(false)
        }
    }, [])

    const loadConnectionState = useCallback(async (forceRefresh = false, analyticsAction?: 'retry') => {
        if (!desktopHost) return
        if (!forceRefresh && accountSettingsCache.connections && isAccountCacheFresh(accountSettingsCache.connectionsAt)) {
            setConnections(accountSettingsCache.connections)
            setConnectionError(null)
            return
        }
        setConnectionAction((current) => current || 'refresh')
        setConnectionError(null)
        try {
            setConnections(await requestConnectionStatus(forceRefresh, analyticsAction))
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'Could not load OpenAI connections.')
        } finally {
            setConnectionAction((current) => current === 'refresh' ? null : current)
        }
    }, [desktopHost])

    const applyAccountOverview = useCallback((nextOverview: AssistantAccountOverview) => {
        overviewRequestIdRef.current += 1
        invalidateAccountRuntimeCache({ connections: false })
        accountSettingsCache.overview = nextOverview
        accountSettingsCache.overviewAt = Date.now()
        setOverview(nextOverview)
        setOverviewError(null)
        setOverviewLoading(false)
    }, [])

    useEffect(() => {
        if (!usageActive) return
        const polling = startAccountOverviewPolling({
            refresh: loadOverview,
            isVisible: () => document.visibilityState === 'visible',
            intervalMs: ACCOUNT_POLL_INTERVAL_MS,
            setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
            clearTimer: (timer) => window.clearTimeout(timer)
        })
        document.addEventListener('visibilitychange', polling.refreshIfVisible)
        return () => {
            overviewRequestIdRef.current += 1
            polling.dispose()
            document.removeEventListener('visibilitychange', polling.refreshIfVisible)
        }
    }, [loadOverview, usageActive])

    useEffect(() => {
        if (desktopHost && connectionsActive) void loadConnectionState()
    }, [desktopHost, connectionsActive, loadConnectionState])

    const refreshAll = useCallback(async () => {
        await Promise.all([loadConnectionState(true, 'retry'), ...(usageActive ? [loadOverview(true)] : [])])
    }, [loadConnectionState, loadOverview, usageActive])

    const connectChatGpt = useCallback(async (signInMethod: ChatGptSignInMethod = 'browser', accountId?: string) => {
        setConnectionAction('chatgpt')
        setConnectionError(null)
        setChatGptDeviceCode(null)
        setChatGptDeviceCodeOpen(false)
        chatGptDeviceCodeDismissedRef.current = false
        const deviceCodePolling = signInMethod === 'device-code'
            ? window.setInterval(() => {
                void window.devscope.onboarding.getChatGptDeviceCode().then((result) => {
                    if (result.success && result.deviceCode && !chatGptDeviceCodeDismissedRef.current) {
                        setChatGptDeviceCode(result.deviceCode)
                        setChatGptDeviceCodeOpen(true)
                    }
                })
            }, 350)
            : null
        try {
            const result = await window.devscope.onboarding.connectChatGpt({ analyticsAction: accountId ? 'replace' : 'connect', signInMethod, accountId })
            if (!result.success) throw Object.assign(new Error(result.error), { code: result.code })
            if (!result.status.verified) throw new Error(result.status.detail || 'ChatGPT could not be verified.')
            invalidateSettingsModels()
            invalidateAccountRuntimeCache({ clearOverview: true, clearConnections: true })
            setOverview(null)
            setOverviewLoading(true)
            setConnections(null)
            await Promise.all([loadConnectionState(true), ...(usageActive ? [loadOverview(true)] : [])])
            setChatGptDeviceCode(null)
            setChatGptDeviceCodeOpen(false)
            setChatGptAuthenticationSuccessOpen(true)
        } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ZYRA_OAUTH_CANCELLED')) {
                setConnectionError(error instanceof Error ? error.message : 'ChatGPT connection failed.')
            }
        } finally {
            if (deviceCodePolling !== null) window.clearInterval(deviceCodePolling)
            setConnectionAction(null)
        }
    }, [connections?.chatgpt?.configured, loadConnectionState, loadOverview, usageActive])

    const cancelChatGpt = useCallback(async () => {
        try {
            const result = await window.devscope.onboarding.cancelChatGpt()
            if (!result.success) throw new Error(result.error)
            if (result.cancelled) {
                chatGptDeviceCodeDismissedRef.current = true
                setChatGptDeviceCode(null)
                setChatGptDeviceCodeOpen(false)
            }
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'Could not cancel ChatGPT sign-in.')
        }
    }, [])

    const dismissChatGptDeviceCode = useCallback(() => {
        chatGptDeviceCodeDismissedRef.current = true
        setChatGptDeviceCodeOpen(false)
    }, [])

    const connectApiKey = useCallback(async () => {
        const key = apiKeyDraft.trim()
        if (!key) return
        setConnectionAction('api-key')
        setConnectionError(null)
        setApiKeyDraft('')
        try {
            const result = await window.devscope.onboarding.connectApiKey(key, { analyticsAction: connections?.apiKey?.configured ? 'replace' : 'connect' })
            if (!result.success || !result.status.verified) throw new Error(result.success ? result.status.detail || 'The API key could not be verified.' : result.error)
            invalidateSettingsModels()
            invalidateAccountRuntimeCache({ overview: false, clearConnections: true })
            setConnections(null)
            setApiKeyDialogOpen(false)
            await loadConnectionState(true)
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'OpenAI API connection failed.')
        } finally {
            setConnectionAction(null)
        }
    }, [connections?.apiKey?.configured, apiKeyDraft, loadConnectionState])

    const switchDefaultConnection = useCallback(async (method: OnboardingAuthMethod) => {
        setConnectionAction('switch')
        setConnectionError(null)
        try {
            const target = firstModelForMethod(method, await loadSettingsModels(true))
            if (!target) throw new Error(method === 'chatgpt'
                ? 'No supported ChatGPT subscription model is available.'
                : 'This API key did not report a supported OpenAI API model.')
            await updateSettings({ assistantDefaultModel: target.id })
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'Could not switch the new-chat connection.')
        } finally {
            setConnectionAction(null)
        }
    }, [updateSettings])

    const disconnect = useCallback(async () => {
        if (!disconnectMethod || connectionAction === 'disconnect') return
        setConnectionAction('disconnect')
        setConnectionError(null)
        try {
            const result = await window.devscope.onboarding.disconnectOpenAI({ method: disconnectMethod, confirmed: true })
            if (!result.success) throw new Error(result.error || 'Could not disconnect OpenAI.')
            invalidateSettingsModels()
            const identityChanged = disconnectMethod === 'chatgpt'
            invalidateAccountRuntimeCache({
                overview: identityChanged,
                clearOverview: identityChanged,
                clearConnections: true
            })
            if (identityChanged) {
                setOverview(null)
                setOverviewLoading(true)
            }
            accountSettingsCache.connections = result.status
            accountSettingsCache.connectionsAt = Date.now()
            setConnections(result.status)
            setDisconnectMethod(null)
            if (usageActive) await loadOverview(true)
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'Could not disconnect OpenAI.')
        } finally {
            setConnectionAction(null)
        }
    }, [connectionAction, disconnectMethod, loadOverview, usageActive])

    const usageCards = useMemo(
        () => buildRateLimitCards(overview, settings.assistantUsageDisplayMode),
        [overview, settings.assistantUsageDisplayMode]
    )
    const initialAccountLoading = overviewLoading && !overview
    const accountUnavailable = Boolean(overviewError && !overview)
    const displayAccountValue = (value: string | null | undefined, fallback = 'Unavailable') =>
        initialAccountLoading ? 'Checking…' : value || fallback
    const connectionLabel = initialAccountLoading
        ? 'Checking…'
        : accountUnavailable
            ? 'Unavailable'
            : overview?.authMode === 'chatgpt'
                || overview?.authMode === 'chatgptAuthTokens'
                || overview?.account?.type === 'chatgpt'
                ? 'ChatGPT subscription'
                : overview?.authMode === 'apikey' || overview?.account?.type === 'apiKey'
                    ? 'OpenAI API key'
                    : 'Not connected'
    const accountPlan = initialAccountLoading
        ? 'Checking…'
        : formatPlan(resolvePreferredPlanType(overview))
    const chatGptConnection = connections?.chatgpt || null
    const apiKeyConnection = connections?.apiKey || null
    const activeDefaultMethod: OnboardingAuthMethod | null = settings.assistantDefaultModel.startsWith('openai-codex/')
        ? 'chatgpt'
        : settings.assistantDefaultModel.startsWith('openai/') ? 'api-key' : null
    const connectionBusy = connectionAction !== null

    return { settings, updateSettings, overview, overviewLoading, overviewError, desktopHost, connectionError, connectionAction, apiKeyDialogOpen, setApiKeyDialogOpen, apiKeyDraft, setApiKeyDraft, disconnectMethod, setDisconnectMethod, chatGptAuthenticationSuccessOpen, setChatGptAuthenticationSuccessOpen, chatGptDeviceCode, chatGptDeviceCodeOpen, dismissChatGptDeviceCode, loadOverview, refreshAll, connectChatGpt, cancelChatGpt, connectApiKey, switchDefaultConnection, disconnect, applyAccountOverview, usageCards, initialAccountLoading, displayAccountValue, connectionLabel, accountPlan, chatGptConnection, apiKeyConnection, activeDefaultMethod, connectionBusy }
}
