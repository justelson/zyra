import { getSharedProviderWorkerClient } from '../../setup/provider-worker-client'
import type { ModelProviderInput } from '../../../shared/onboarding/contracts'
import { BrowserWindow } from 'electron'
import {
    ONBOARDING_IPC,
    type AccountConnectionAnalyticsInput,
    type AccountConnectionStatusInput,
    type BeginOnboardingReviewInput,
    type CancelOnboardingReviewInput,
    type CommitOnboardingStepInput,
    type DisconnectOpenAIInput,
    type NavigateOnboardingInput,
    type OnboardingSnapshot,
    type UpdateOnboardingAppearanceInput
} from '../../../shared/onboarding/contracts'
import {
    DEVICE_PREFERENCES_IPC,
    type GetDevicePreferencesInput,
    type UpdateDevicePreferencesInput
} from '../../../shared/preferences/contracts'
import {
    DEVICE_SECRETS_IPC,
    type UpdateBrowserIntegrationSecretsInput,
    type UpdateHostedAiSecretsInput
} from '../../../shared/preferences/secrets-contracts'
import type { DesktopSetupServices } from '../../setup'
import { ANALYTICS_IPC, normalizeAnalyticsOnboardingStep } from '../../../shared/analytics/contracts'
import { classifyAnalyticsErrorCode as analyticsErrorCode } from '../../../shared/analytics/error-code'
import { createOnboardingGatedIpcMain } from '../onboarding-ipc-gate'
import { ipcMain as trustedIpcMain } from '../trusted-ipc'

const PRE_ONBOARDING_SETUP_CHANNELS = new Set<string>([
    DEVICE_PREFERENCES_IPC.get,
    DEVICE_SECRETS_IPC.migrateLegacyHostedAiKeys,
    ONBOARDING_IPC.getState,
    ONBOARDING_IPC.connectModelProvider,
    ONBOARDING_IPC.listModelProviders,
    ONBOARDING_IPC.getAuthStatus,
    ONBOARDING_IPC.connectChatGpt,
    ONBOARDING_IPC.connectApiKey,
    ONBOARDING_IPC.updateAppearance,
    ONBOARDING_IPC.commitStep,
    ONBOARDING_IPC.navigate,
    ANALYTICS_IPC.getStatus,
    ANALYTICS_IPC.setEnabled
])

function errorPayload(error: unknown) {
    return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Setup request failed.',
        ...(
            error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
                ? { code: (error as { code: string }).code }
                : {}
        )
    }
}

async function result<T>(work: () => Promise<T> | T) {
    try {
        return { success: true as const, ...(await work() as object) }
    } catch (error) {
        return errorPayload(error)
    }
}

async function analyticsResult<T>(work: () => Promise<T> | T) {
    try {
        return { success: true as const, ...(await work() as object) }
    } catch {
        return { success: false as const, error: 'Product analytics could not be updated.', code: 'ANALYTICS_ERROR' as const }
    }
}

function broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
        try {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
        } catch {
            // A closing window cannot turn a successful persisted update into an IPC failure.
        }
    }
}

export function registerSetupIpcHandlers(services: DesktopSetupServices): void {
    services.preferences.subscribe((event) => broadcast(DEVICE_PREFERENCES_IPC.changed, event))
    services.onboarding.subscribe((snapshot) => broadcast(ONBOARDING_IPC.changed, snapshot))
    services.analytics.subscribeStatus((status) => broadcast(ANALYTICS_IPC.statusChanged, status))

    const ipcMain = createOnboardingGatedIpcMain(trustedIpcMain, {
        isAccessAllowed: () => services.onboarding.isAccessAllowed(),
        allowedBeforeOnboarding: PRE_ONBOARDING_SETUP_CHANNELS,
        blockedResult: onboardingRequiredError
    })

    ipcMain.handle(DEVICE_PREFERENCES_IPC.get, (_event, input: GetDevicePreferencesInput) => result(async () => ({
        snapshot: await services.preferences.get(input)
    })))
    ipcMain.handle(DEVICE_PREFERENCES_IPC.update, (_event, input: UpdateDevicePreferencesInput) => result(async () => ({
        snapshot: await services.preferences.update(input)
    })))

    ipcMain.handle(ANALYTICS_IPC.getStatus, () => analyticsResult(async () => ({
        status: await services.analytics.refreshStatus()
    })))
    ipcMain.handle(ANALYTICS_IPC.setEnabled, (_event, enabled: unknown) => analyticsResult(async () => {
        if (typeof enabled !== 'boolean') throw new Error('Analytics enabled value must be boolean.')
        return { status: await services.analytics.updateEnabled(enabled) }
    }))
    ipcMain.handle(ANALYTICS_IPC.capture, (_event, input: unknown) => analyticsResult(async () => ({
        accepted: await services.analytics.captureFromRenderer(input)
    })))

    ipcMain.handle(DEVICE_SECRETS_IPC.updateHostedAiKeys, (_event, input: UpdateHostedAiSecretsInput) => result(async () => (
        services.secrets.updateHostedAiKeys(input)
    )))
    ipcMain.handle(DEVICE_SECRETS_IPC.migrateLegacyHostedAiKeys, (_event, input: UpdateHostedAiSecretsInput) => result(async () => (
        services.secrets.migrateLegacyHostedAiKeys(input)
    )))
    ipcMain.handle(DEVICE_SECRETS_IPC.updateBrowserIntegrationSecrets, (_event, input: UpdateBrowserIntegrationSecretsInput) => result(async () => (
        services.secrets.updateBrowserIntegrationSecrets(input)
    )))

    ipcMain.handle(ONBOARDING_IPC.getState, () => result(async () => ({
        snapshot: await services.onboarding.getState()
    })))
    ipcMain.handle(ONBOARDING_IPC.disconnectModelProvider, (_event, provider: string) => result(async () => await getSharedProviderWorkerClient().providers.disconnect(provider)))
    ipcMain.handle(ONBOARDING_IPC.getAgentRoleModels, () => result(async () => ({ models: await getSharedProviderWorkerClient().providers.roleModels() })))
    ipcMain.handle(ONBOARDING_IPC.setAgentRoleModel, (_event, input) => result(async () => ({ models: await getSharedProviderWorkerClient().providers.saveRoleModel(input) })))
    ipcMain.handle(ONBOARDING_IPC.listModelProviders, () => result(async () => ({ connections: await getSharedProviderWorkerClient().providers.list() })))
    ipcMain.handle(ONBOARDING_IPC.connectModelProvider, (_event, input: ModelProviderInput) => result(async () => {
        const connection = await getSharedProviderWorkerClient().providers.connect(input)
        await services.preferences.updateSharedFromMain({ assistantDefaultModel: connection.model })
        return { connection }
    }))
    ipcMain.handle(ONBOARDING_IPC.getAuthStatus, () => result(async () => ({
        status: await services.onboarding.getAuthStatus()
    })))
    ipcMain.handle(ONBOARDING_IPC.getConnectionsStatus, (_event, input?: AccountConnectionStatusInput) => result(async () => {
        const retry = input?.analyticsAction === 'retry'
        if (retry) services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action: 'retry', method: 'unknown', outcome: 'started' } })
        try {
            const status = await services.auth.getConnectionsStatus()
            if (retry) services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action: 'retry', method: 'unknown', outcome: 'completed' } })
            return { status }
        } catch (error) {
            if (retry) services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action: 'retry', method: 'unknown', outcome: 'failed', error_code: analyticsErrorCode(error) } })
            throw error
        }
    }))
    ipcMain.handle(ONBOARDING_IPC.connectChatGpt, (_event, input?: AccountConnectionAnalyticsInput) => result(async () => {
        const action = input?.analyticsAction === 'replace' ? 'replace' : 'connect'
        services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'subscription', outcome: 'started' } })
        try {
            const status = await services.onboarding.connectChatGpt()
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'subscription', outcome: status.verified ? 'completed' : 'failed', ...(status.verified ? {} : { error_code: 'authorization_failed' }) } })
            return { status }
        } catch (error) {
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'subscription', outcome: 'failed', error_code: analyticsErrorCode(error) } })
            throw error
        }
    }))
    ipcMain.handle(ONBOARDING_IPC.connectApiKey, (_event, apiKey: string, input?: AccountConnectionAnalyticsInput) => result(async () => {
        const action = input?.analyticsAction === 'replace' ? 'replace' : 'connect'
        services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'api', outcome: 'started' } })
        try {
            const status = await services.onboarding.connectApiKey(apiKey)
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'api', outcome: status.verified ? 'completed' : 'failed', ...(status.verified ? {} : { error_code: 'authorization_failed' }) } })
            return { status }
        } catch (error) {
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action, method: 'api', outcome: 'failed', error_code: analyticsErrorCode(error) } })
            throw error
        }
    }))
    ipcMain.handle(ONBOARDING_IPC.updateAppearance, (_event, input: UpdateOnboardingAppearanceInput) => result(async () => ({
        snapshot: await services.onboarding.updateAppearance(input)
    })))
    ipcMain.handle(ONBOARDING_IPC.disconnectOpenAI, (_event, input: DisconnectOpenAIInput) => result(async () => {
        if (input?.confirmed !== true) {
            throw Object.assign(new Error('Confirm the exact OpenAI connection before disconnecting it.'), {
                code: 'CONFIRMATION_REQUIRED'
            })
        }
        const method = input.method === 'api-key' ? 'api' : 'subscription'
        try {
            const status = await services.auth.disconnect(input.method)
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action: 'disconnect', method, outcome: 'completed' } })
            return { status }
        } catch (error) {
            services.analytics.capture({ event: 'zyra_v1_account_connection', properties: { action: 'disconnect', method, outcome: 'failed', error_code: analyticsErrorCode(error) } })
            throw error
        }
    }))
    ipcMain.handle(ONBOARDING_IPC.commitStep, (_event, input: CommitOnboardingStepInput) => result(async () => {
        const snapshot = await services.onboarding.commitStep(input)
        services.analytics.capture({
            event: 'zyra_v1_onboarding',
            properties: {
                action: snapshot.accessAllowed ? 'completed' : 'step_completed',
                step: normalizeAnalyticsOnboardingStep(input?.step),
                outcome: 'completed'
            }
        })
        if (!snapshot.accessAllowed && snapshot.record) {
            services.analytics.capture({
                event: 'zyra_v1_onboarding',
                properties: { action: 'step_started', step: normalizeAnalyticsOnboardingStep(snapshot.record.currentStep), outcome: 'started' }
            })
        }
        return { snapshot }
    }))
    ipcMain.handle(ONBOARDING_IPC.navigate, (_event, input: NavigateOnboardingInput) => result(async () => {
        const snapshot = await services.onboarding.navigate(input)
        services.analytics.capture({ event: 'zyra_v1_onboarding', properties: { action: 'step_back', step: normalizeAnalyticsOnboardingStep(input?.step), outcome: 'completed' } })
        if (snapshot.record) {
            services.analytics.capture({ event: 'zyra_v1_onboarding', properties: { action: 'step_started', step: normalizeAnalyticsOnboardingStep(snapshot.record.currentStep), outcome: 'started' } })
        }
        return { snapshot }
    }))
    ipcMain.handle(ONBOARDING_IPC.beginReview, (_event, input: BeginOnboardingReviewInput) => result(async () => {
        const snapshot = await services.onboarding.beginReview(input)
        services.analytics.capture({ event: 'zyra_v1_onboarding', properties: { action: 'review_started', outcome: 'completed' } })
        return { snapshot }
    }))
    ipcMain.handle(ONBOARDING_IPC.cancelReview, (_event, input: CancelOnboardingReviewInput) => result(async () => {
        const snapshot = await services.onboarding.cancelReview(input)
        services.analytics.capture({ event: 'zyra_v1_onboarding', properties: { action: 'review_exited', outcome: 'completed' } })
        return { snapshot }
    }))
}

export function onboardingRequiredError(): { success: false; error: string; code: 'ONBOARDING_REQUIRED' } {
    return {
        success: false,
        error: 'Finish setup in Zyra Desktop before using Assistant.',
        code: 'ONBOARDING_REQUIRED'
    }
}

export function requireOnboardingAccess(services: DesktopSetupServices): void {
    if (services.onboarding.isAccessAllowed()) return
    const error = new Error('Finish setup in Zyra Desktop before using Assistant.') as Error & { code?: string }
    error.code = 'ONBOARDING_REQUIRED'
    throw error
}

export type { OnboardingSnapshot }
