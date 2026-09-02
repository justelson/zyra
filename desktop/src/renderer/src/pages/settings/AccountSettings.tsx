import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AssistantAccountOverview, AssistantAccountPlanType, AssistantModelInfo } from '@shared/assistant/contracts'
import type { OnboardingAuthMethod, OpenAIConnectionMethodStatus, OpenAIConnectionsStatus } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { cn } from '@/lib/utils'
import { registerSettingsCacheClearer } from '@/lib/settings-cache-registry'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { buildRateLimitCards, formatFetchedAt, formatPlan } from './assistant-account-rate-limits'
import { AccountResetCreditsSection } from './AccountResetCreditsSection'
import { invalidateSettingsModels, loadSettingsModels } from './settings-model-catalog-cache'
import { createSettingsRowTargetId } from './settings-search'
import {
    SettingsButton,
    SettingsDialog,
    SettingsInput,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented
} from './settings-layout'

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

function connectionStatusLabel(status: OpenAIConnectionMethodStatus | null): string {
    if (!status) return 'Checking…'
    if (status.verified) return 'Connected'
    return status.configured ? 'Needs attention' : 'Not connected'
}

function connectionStatusTone(status: OpenAIConnectionMethodStatus | null): 'ready' | 'warning' | 'muted' {
    if (status?.verified) return 'ready'
    return status?.configured ? 'warning' : 'muted'
}

function methodOwnsModel(method: OnboardingAuthMethod, model: string): boolean {
    return method === 'chatgpt' ? model.startsWith('openai-codex/') : model.startsWith('openai/')
}

function firstModelForMethod(method: OnboardingAuthMethod, models: AssistantModelInfo[]): AssistantModelInfo | null {
    return models.find((model) => methodOwnsModel(method, model.id)) || null
}

export default function AccountSettings() {
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
        let pollTimer = 0
        const schedulePoll = () => {
            window.clearTimeout(pollTimer)
            pollTimer = window.setTimeout(() => {
                if (document.visibilityState === 'visible') {
                    void loadOverview(true).finally(schedulePoll)
                    return
                }
                schedulePoll()
            }, ACCOUNT_POLL_INTERVAL_MS)
        }
        void loadOverview().finally(schedulePoll)
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void loadOverview()
        }
        document.addEventListener('visibilitychange', handleVisibility)
        return () => {
            overviewRequestIdRef.current += 1
            window.clearTimeout(pollTimer)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [loadOverview])

    useEffect(() => {
        if (desktopHost) void loadConnectionState()
    }, [desktopHost, loadConnectionState])

    const refreshAll = useCallback(async () => {
        await Promise.all([loadOverview(true), loadConnectionState(true, 'retry')])
    }, [loadConnectionState, loadOverview])

    const connectChatGpt = useCallback(async () => {
        setConnectionAction('chatgpt')
        setConnectionError(null)
        try {
            const result = await window.devscope.onboarding.connectChatGpt({ analyticsAction: connections?.chatgpt?.configured ? 'replace' : 'connect' })
            if (!result.success || !result.status.verified) throw new Error(result.success ? result.status.detail || 'ChatGPT could not be verified.' : result.error)
            invalidateSettingsModels()
            invalidateAccountRuntimeCache({ clearOverview: true, clearConnections: true })
            setOverview(null)
            setOverviewLoading(true)
            setConnections(null)
            await Promise.all([loadConnectionState(true), loadOverview(true)])
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'ChatGPT connection failed.')
        } finally {
            setConnectionAction(null)
        }
    }, [connections?.chatgpt?.configured, loadConnectionState, loadOverview])

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
                ? 'Pi did not report an available ChatGPT subscription model.'
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
            await loadOverview(true)
        } catch (error) {
            setConnectionError(error instanceof Error ? error.message : 'Could not disconnect OpenAI.')
        } finally {
            setConnectionAction(null)
        }
    }, [connectionAction, disconnectMethod, loadOverview])

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
                ? 'ChatGPT via Pi'
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

    return (
        <SettingsPageContainer title="OpenAI account" backTo="/settings/account" backLabel="Account & connections">
            <SettingsSection
                title="OpenAI connections"
                headerAction={desktopHost ? (
                    <SettingsButton variant="ghost" onClick={() => void refreshAll()} disabled={connectionBusy}>
                        <RefreshCw size={12} className={connectionAction === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''} />
                        Retry
                    </SettingsButton>
                ) : undefined}
            >
                {!desktopHost ? <SettingsNotice tone="neutral">Open Zyra Desktop on this computer to connect, replace, switch, or disconnect OpenAI credentials.</SettingsNotice> : null}
                {connectionError ? <SettingsNotice tone="error">{connectionError}</SettingsNotice> : null}
                <SettingsRow
                    title="ChatGPT subscription"
                    description="OAuth connection stored by Pi. Use it for ChatGPT models, Voice, account limits, and banked resets."
                    status={desktopHost ? connectionStatusLabel(chatGptConnection) : overview?.requiresOpenaiAuth ? 'Not connected' : 'Connected'}
                    statusTone={desktopHost ? connectionStatusTone(chatGptConnection) : overview?.requiresOpenaiAuth ? 'muted' : 'ready'}
                    statusTitle={chatGptConnection?.detail || undefined}
                    control={desktopHost ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            {chatGptConnection?.verified ? <SettingsButton variant="ghost" disabled={connectionBusy || activeDefaultMethod === 'chatgpt'} onClick={() => void switchDefaultConnection('chatgpt')}>{activeDefaultMethod === 'chatgpt' ? 'Default' : 'Use for new chats'}</SettingsButton> : null}
                            <SettingsButton disabled={connectionBusy} onClick={() => void connectChatGpt()}>{connectionAction === 'chatgpt' ? 'Waiting…' : chatGptConnection?.configured ? 'Reconnect' : 'Connect'}</SettingsButton>
                            {chatGptConnection?.configured ? <SettingsButton variant="danger" disabled={connectionBusy} onClick={() => setDisconnectMethod('chatgpt')}>Disconnect</SettingsButton> : null}
                        </div>
                    ) : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
                <SettingsRow
                    title="OpenAI API key"
                    description="Verified API credential stored by Pi. The key is never returned to this Settings page after it is saved."
                    status={desktopHost ? connectionStatusLabel(apiKeyConnection) : 'Desktop only'}
                    statusTone={desktopHost ? connectionStatusTone(apiKeyConnection) : 'muted'}
                    statusTitle={apiKeyConnection?.detail || undefined}
                    control={desktopHost ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            {apiKeyConnection?.verified ? <SettingsButton variant="ghost" disabled={connectionBusy || activeDefaultMethod === 'api-key'} onClick={() => void switchDefaultConnection('api-key')}>{activeDefaultMethod === 'api-key' ? 'Default' : 'Use for new chats'}</SettingsButton> : null}
                            <SettingsButton disabled={connectionBusy} onClick={() => setApiKeyDialogOpen(true)}>{apiKeyConnection?.configured ? 'Replace key' : 'Add key'}</SettingsButton>
                            {apiKeyConnection?.configured ? <SettingsButton variant="danger" disabled={connectionBusy} onClick={() => setDisconnectMethod('api-key')}>Disconnect</SettingsButton> : null}
                        </div>
                    ) : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />
                <SettingsRow
                    title="New-chat default"
                    description="New chats use this provider model. Existing chats keep their canonical model and connection."
                    status={activeDefaultMethod ? 'Configured' : 'Uses Assistant default'}
                    statusTone={activeDefaultMethod ? 'ready' : 'muted'}
                    control={<span title={settings.assistantDefaultModel || undefined} className="max-w-64 truncate text-xs font-medium text-sparkle-text-secondary">{activeDefaultMethod === 'chatgpt' ? 'ChatGPT subscription' : activeDefaultMethod === 'api-key' ? 'OpenAI API' : settings.assistantDefaultModel || 'Automatic'}</span>}
                />
            </SettingsSection>

            <SettingsSection title="ChatGPT account" headerAction={<SettingsButton variant="ghost" onClick={() => void loadOverview(true)} disabled={overviewLoading}><RefreshCw size={12} className={overviewLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh</SettingsButton>}>
                {overviewError ? <SettingsNotice tone="error">{overviewError}</SettingsNotice> : null}
                {overview?.requiresOpenaiAuth ? <SettingsNotice tone="warning">Connect your ChatGPT account through Zyra to view its identity, plan, usage limits, and banked resets.</SettingsNotice> : null}
                <SettingsRow
                    title="Connection"
                    description="Zyra uses this ChatGPT/OpenAI account through Pi for supported models and account limits."
                    status={initialAccountLoading ? 'Checking' : overview?.requiresOpenaiAuth ? 'Connect account' : overview ? 'Connected' : 'Unavailable'}
                    statusTone={overview?.requiresOpenaiAuth ? 'warning' : overview ? 'ready' : 'muted'}
                    control={<span className="text-xs font-medium text-sparkle-text-secondary">{connectionLabel}</span>}
                />
                <SettingsRow
                    title="Email"
                    description="Email returned by the connected ChatGPT account."
                    status={overview?.emailVerified === true ? 'Verified' : null}
                    statusTone="ready"
                    control={<span title={overview?.account?.email || undefined} className="max-w-64 truncate text-xs font-medium text-sparkle-text-secondary">{displayAccountValue(overview?.account?.email)}</span>}
                />
                <SettingsRow title="Plan" description="Plan reported by ChatGPT for this account." control={<span className="text-xs font-medium text-sparkle-text-secondary">{accountPlan}</span>} />
                <SettingsRow title="Pi provider" description="Provider identifier Pi uses for this ChatGPT connection." control={<span className="max-w-64 truncate text-xs font-medium text-sparkle-text-secondary">{displayAccountValue(overview?.provider)}</span>} />
                <SettingsRow title="Account ID" description="OpenAI account identifier associated with the connected ChatGPT account." control={<span title={overview?.accountId || undefined} className="max-w-64 truncate text-xs font-medium text-sparkle-text-secondary">{displayAccountValue(overview?.accountId)}</span>} />
                <SettingsRow title="Access refresh" description="When Pi is expected to refresh the current ChatGPT access token." control={<span className="text-xs font-medium text-sparkle-text-secondary">{initialAccountLoading ? 'Checking…' : formatAccountDateTime(overview?.tokenExpiresAt)}</span>} />
                <SettingsRow title="Connection source" description="Where Zyra reads the account connection and quota snapshot." control={<span title={overview?.source || undefined} className="max-w-64 truncate text-xs font-medium text-sparkle-text-secondary">{displayAccountValue(overview?.source)}</span>} />
            </SettingsSection>

            <SettingsSection title="Usage limits">
                {overview?.usageError ? <SettingsNotice tone="warning">Usage could not be refreshed: {overview.usageError}</SettingsNotice> : null}
                <SettingsRow title="Usage display" description="Show the amount remaining or already used in each limit window." control={<SettingsSegmented value={settings.assistantUsageDisplayMode} options={[{ value: 'remaining', label: 'Remaining' }, { value: 'used', label: 'Used' }]} onChange={(assistantUsageDisplayMode) => updateSettings({ assistantUsageDisplayMode })} label="Usage display" />} />
                <div data-settings-search-target={createSettingsRowTargetId('Usage limits', 'Usage windows')} tabIndex={-1}>
                    {initialAccountLoading ? (
                        <SettingsRow
                            title="Usage windows"
                            description="Checking the current ChatGPT usage limits."
                            status="Checking"
                            statusTone="muted"
                            control={<RefreshCw size={13} className="animate-spin motion-reduce:animate-none text-[var(--settings-text-muted)]" />}
                        />
                    ) : usageCards.map((card) => (
                        <SettingsRow
                            key={card.id}
                            title={`${card.bucketLabel} · ${card.durationLabel}`}
                            description={`${card.resetSummary} · synced ${formatFetchedAt(overview?.fetchedAt)}`}
                            status={card.resetAbsolute}
                            control={(
                                <div className="w-full sm:w-44">
                                    <div className="mb-1 flex items-center justify-between text-[11px] text-sparkle-text-muted"><span>{card.percentLabel}</span><span>{Math.round(card.percent)}%</span></div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--settings-track)]"><div className={cn('h-full rounded-full bg-[var(--accent-primary)]')} style={{ width: `${card.percent}%` }} /></div>
                                </div>
                            )}
                        />
                    ))}
                    {overview && !overview.usageError && usageCards.length === 0 ? (
                        <SettingsRow title="Usage windows" description="No usage-limit windows were returned by ChatGPT for this account." status="Unavailable" statusTone="muted" />
                    ) : null}
                </div>
            </SettingsSection>

            <AccountResetCreditsSection
                overview={overview}
                loading={overviewLoading}
                onOverviewChange={applyAccountOverview}
            />

            <SettingsDialog
                open={apiKeyDialogOpen}
                title="Connect OpenAI API"
                description="Zyra verifies the key before Pi stores it. Closing this dialog does not save the draft."
                onClose={() => {
                    if (connectionAction === 'api-key') return
                    setApiKeyDraft('')
                    setApiKeyDialogOpen(false)
                }}
                footer={(
                    <>
                        <SettingsButton variant="ghost" disabled={connectionAction === 'api-key'} onClick={() => { setApiKeyDraft(''); setApiKeyDialogOpen(false) }}>Cancel</SettingsButton>
                        <SettingsButton variant="accent" disabled={!apiKeyDraft.trim() || connectionAction === 'api-key'} onClick={() => void connectApiKey()}>
                            {connectionAction === 'api-key' ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}
                            {connectionAction === 'api-key' ? 'Verifying…' : 'Verify and save'}
                        </SettingsButton>
                    </>
                )}
            >
                <label htmlFor="account-openai-api-key" className="text-[12px] font-medium text-[var(--settings-text)]">API key</label>
                <SettingsInput
                    id="account-openai-api-key"
                    autoFocus
                    type="password"
                    value={apiKeyDraft}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                    placeholder="sk-…"
                    className="sm:w-full"
                />
            </SettingsDialog>

            <ConfirmModal
                isOpen={disconnectMethod !== null}
                title={disconnectMethod === 'chatgpt' ? 'Disconnect ChatGPT?' : 'Remove OpenAI API key?'}
                message={disconnectMethod === 'chatgpt'
                    ? 'Zyra will remove the ChatGPT OAuth connection from Pi. Completed onboarding stays complete, but ChatGPT models, Voice, usage, and resets will require reconnection.'
                    : 'Zyra will remove the OpenAI API key from Pi. Chats configured for API models may require another working connection.'}
                confirmLabel={connectionAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                variant="warning"
                onCancel={() => {
                    if (connectionAction !== 'disconnect') setDisconnectMethod(null)
                }}
                onConfirm={() => void disconnect()}
            />
        </SettingsPageContainer>
    )
}

function formatAccountDateTime(value: string | null | undefined): string {
    if (!value) return 'Unavailable'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}
