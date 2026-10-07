import type { ModelProviderInput, ModelHarnessConnectInput, AgentRoleModelInput, DelegationPreferencesUpdate } from '../../shared/onboarding/contracts'
import { ipcRenderer } from 'electron'
import {
    ONBOARDING_IPC,
    type AccountConnectionAnalyticsInput,
    type ChatGptAccountsUpdate,
    type AccountConnectionStatusInput,
    type BeginOnboardingReviewInput,
    type CancelOnboardingReviewInput,
    type CommitOnboardingStepInput,
    type DisconnectOpenAIInput,
    type NavigateOnboardingInput,
    type OnboardingSnapshot,
    type UpdateOnboardingAppearanceInput
} from '../../shared/onboarding/contracts'
import {
    DEVICE_PREFERENCES_IPC,
    type DevicePreferencesChangedEvent,
    type GetDevicePreferencesInput,
    type UpdateDevicePreferencesInput
} from '../../shared/preferences/contracts'
import {
    DEVICE_SECRETS_IPC,
    type UpdateBrowserIntegrationSecretsInput,
    type UpdateHostedAiSecretsInput
} from '../../shared/preferences/secrets-contracts'

export function createSetupAdapter() {
    return {
        preferences: {
            get: (input: GetDevicePreferencesInput) => ipcRenderer.invoke(DEVICE_PREFERENCES_IPC.get, input),
            update: (input: UpdateDevicePreferencesInput) => ipcRenderer.invoke(DEVICE_PREFERENCES_IPC.update, input),
            onChanged: (callback: (event: DevicePreferencesChangedEvent) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, payload: DevicePreferencesChangedEvent) => callback(payload)
                ipcRenderer.on(DEVICE_PREFERENCES_IPC.changed, listener)
                return () => ipcRenderer.removeListener(DEVICE_PREFERENCES_IPC.changed, listener)
            }
        },
        secrets: {
            updateHostedAiKeys: (input: UpdateHostedAiSecretsInput) => ipcRenderer.invoke(DEVICE_SECRETS_IPC.updateHostedAiKeys, input),
            migrateLegacyHostedAiKeys: (input: UpdateHostedAiSecretsInput) => ipcRenderer.invoke(DEVICE_SECRETS_IPC.migrateLegacyHostedAiKeys, input),
            updateBrowserIntegrationSecrets: (input: UpdateBrowserIntegrationSecretsInput) => ipcRenderer.invoke(DEVICE_SECRETS_IPC.updateBrowserIntegrationSecrets, input)
        },
        onboarding: {
            getChatGptAccounts: (input?: { refreshUsage?: boolean }) => ipcRenderer.invoke(ONBOARDING_IPC.getChatGptAccounts, input),
            updateChatGptAccounts: (input: ChatGptAccountsUpdate) => ipcRenderer.invoke(ONBOARDING_IPC.updateChatGptAccounts, input),
            connectModelProvider: (input: ModelProviderInput) => ipcRenderer.invoke(ONBOARDING_IPC.connectModelProvider, input),
            disconnectModelProvider: (provider: string) => ipcRenderer.invoke(ONBOARDING_IPC.disconnectModelProvider, provider),
            getDelegationPreferences: () => ipcRenderer.invoke(ONBOARDING_IPC.getDelegationPreferences),
            saveDelegationPreferences: (input: DelegationPreferencesUpdate) => ipcRenderer.invoke(ONBOARDING_IPC.saveDelegationPreferences, input),
            getAgentRoleModels: () => ipcRenderer.invoke(ONBOARDING_IPC.getAgentRoleModels),
            setAgentRoleModel: (input: AgentRoleModelInput) => ipcRenderer.invoke(ONBOARDING_IPC.setAgentRoleModel, input),
            listModelProviders: () => ipcRenderer.invoke(ONBOARDING_IPC.listModelProviders),
            detectHarness: () => ipcRenderer.invoke(ONBOARDING_IPC.detectHarness),
            connectHarness: (input: ModelHarnessConnectInput) => ipcRenderer.invoke(ONBOARDING_IPC.connectHarness, input),
            getState: () => ipcRenderer.invoke(ONBOARDING_IPC.getState),
            getAuthStatus: () => ipcRenderer.invoke(ONBOARDING_IPC.getAuthStatus),
            getConnectionsStatus: (input?: AccountConnectionStatusInput) => ipcRenderer.invoke(ONBOARDING_IPC.getConnectionsStatus, input),
            getChatGptDeviceCode: () => ipcRenderer.invoke(ONBOARDING_IPC.getChatGptDeviceCode),
            connectChatGpt: (input?: AccountConnectionAnalyticsInput) => ipcRenderer.invoke(ONBOARDING_IPC.connectChatGpt, input),
            cancelChatGpt: () => ipcRenderer.invoke(ONBOARDING_IPC.cancelChatGpt),
            connectApiKey: (apiKey: string, input?: AccountConnectionAnalyticsInput) => ipcRenderer.invoke(ONBOARDING_IPC.connectApiKey, apiKey, input),
            disconnectOpenAI: (input: DisconnectOpenAIInput) => ipcRenderer.invoke(ONBOARDING_IPC.disconnectOpenAI, input),
            updateAppearance: (input: UpdateOnboardingAppearanceInput) => ipcRenderer.invoke(ONBOARDING_IPC.updateAppearance, input),
            commitStep: (input: CommitOnboardingStepInput) => ipcRenderer.invoke(ONBOARDING_IPC.commitStep, input),
            navigate: (input: NavigateOnboardingInput) => ipcRenderer.invoke(ONBOARDING_IPC.navigate, input),
            beginReview: (input: BeginOnboardingReviewInput) => ipcRenderer.invoke(ONBOARDING_IPC.beginReview, input),
            cancelReview: (input: CancelOnboardingReviewInput) => ipcRenderer.invoke(ONBOARDING_IPC.cancelReview, input),
            onChanged: (callback: (snapshot: OnboardingSnapshot) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, payload: OnboardingSnapshot) => callback(payload)
                ipcRenderer.on(ONBOARDING_IPC.changed, listener)
                return () => ipcRenderer.removeListener(ONBOARDING_IPC.changed, listener)
            }
        }
    }
}
