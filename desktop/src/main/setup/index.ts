import { safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { DevicePreferencesService } from './device-preferences-service'
import { DeviceSecretsService } from './device-secrets-service'
import { OnboardingService } from './onboarding-service'
import { getSharedProviderWorkerClient } from './provider-worker-client'
import { OpenAIConnectionService } from './openai-connection-service'
import { DesktopAnalyticsService } from '../analytics/service'

export type DesktopSetupServices = {
    preferences: DevicePreferencesService
    secrets: DeviceSecretsService
    auth: OpenAIConnectionService
    onboarding: OnboardingService
    analytics: DesktopAnalyticsService
}

export function createDesktopSetupServices(userDataPath: string): DesktopSetupServices {
    const setupDirectory = join(userDataPath, 'setup')
    const preferences = new DevicePreferencesService(join(setupDirectory, 'device-preferences.json'))
    const secrets = new DeviceSecretsService(join(setupDirectory, 'device-secrets.bin'), {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
    })
    const authWorker = getSharedProviderWorkerClient()
    const auth = new OpenAIConnectionService({
        openExternal: (url) => shell.openExternal(url),
        loadSdk: async () => authWorker.sdk,
        loadAccount: async () => authWorker.account,
        prewarm: () => authWorker.warm(),
        dispose: () => authWorker.dispose(),
        getAssistantDefaultModel: async () => String(
            (await preferences.get({ surface: 'desktop' })).settings.assistantDefaultModel || ''
        ),
        setAssistantDefaultModel: async (assistantDefaultModel) => {
            await preferences.updateSharedFromMain({ assistantDefaultModel })
        }
    })
    const onboarding = new OnboardingService(
        join(setupDirectory, 'onboarding.json'),
        preferences,
        auth,
        undefined,
        undefined,
        () => authWorker.providers.list()
    )
    const analytics = new DesktopAnalyticsService(userDataPath)
    return { preferences, secrets, auth, onboarding, analytics }
}
