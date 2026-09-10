import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
import { OnboardingService, validateOnboardingProjectsFolder } from '../src/main/setup/onboarding-service'
import { OpenAIConnectionService } from '../src/main/setup/openai-connection-service'

const root = await mkdtemp(join(tmpdir(), 'zyra-onboarding-test-'))
const onboardingPath = join(root, 'setup', 'onboarding.json')
const preferencesPath = join(root, 'setup', 'device-preferences.json')
const projectsPath = join(root, 'projects')
await mkdir(projectsPath)
let connected = true
let tick = Date.parse('2026-08-14T10:00:00.000Z')
const now = () => new Date(tick += 1_000)
const appearanceSelection = {
    appearanceThemeMode: 'system' as const,
    appearanceLightTheme: 'light',
    appearanceDarkTheme: 'dark',
    appearanceUiFont: 'hanken',
    appearanceCodeFont: 'system-mono',
    accessibilityReduceMotion: false
}

async function verifyOpenAiConnectionContract() {
    let apiConfigured = false
    let subscriptionConfigured = true
    let verifiedApiKey: string | null = null
    let verificationCalls = 0
    const defaultPreferences = new DevicePreferencesService(join(root, 'setup', 'api-default-preferences.json'), now)
    const readDefaultModel = async () => String((await defaultPreferences.get({ surface: 'desktop' })).settings.assistantDefaultModel || '')
    const apiAuth = new OpenAIConnectionService({
        now,
        openExternal: () => undefined,
        getAssistantDefaultModel: readDefaultModel,
        setAssistantDefaultModel: async (assistantDefaultModel) => {
            await defaultPreferences.updateSharedFromMain({ assistantDefaultModel })
        },
        loadAccount: async () => ({
            // A pre-existing subscription must not let an unverified API-key action pass.
            buildChatGptAccountStatus: async () => ({ provider: 'openai-codex', status: { configured: subscriptionConfigured }, usage: subscriptionConfigured ? {} : undefined })
        }),
        loadSdk: async () => ({
            loginZyraAuth: async () => undefined,
            configureZyraOpenAIApiKey: async (key: string) => {
                apiConfigured = true
                verifiedApiKey = key
                verificationCalls += 1
                return { ok: true, model: 'openai/gpt-5.6-luna' }
            },
            verifyZyraOpenAIApiAuth: async () => ({ ok: true, model: 'openai/gpt-5.6-luna' }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: apiConfigured } }),
            removeZyraAuth: async (method: 'subscription' | 'api') => {
                if (method === 'api') apiConfigured = false
                if (method === 'subscription') subscriptionConfigured = false
            }
        })
    })
    const apiStatus = await apiAuth.connectApiKey('test-openai-key')
    assert.equal(verifiedApiKey, 'test-openai-key')
    assert.equal(verificationCalls, 1, 'API-key onboarding must execute Pi’s provider verification call')
    assert.equal(apiStatus.method, 'api-key')
    assert.equal(apiStatus.verified, true)
    assert.equal(await readDefaultModel(), 'openai/gpt-5.6-luna', 'API-only onboarding persists a verified API-backed model for the first chat')
    const connectedMethods = await apiAuth.getConnectionsStatus()
    assert.equal(connectedMethods.apiKey.verified, true)
    assert.equal(connectedMethods.chatgpt.verified, true)
    const disconnectedMethods = await apiAuth.disconnect('api-key')
    assert.equal(disconnectedMethods.apiKey.configured, false)
    assert.equal(await readDefaultModel(), 'openai-codex/gpt-5.6-sol', 'disconnecting the selected API connection falls back to verified ChatGPT')

    await apiAuth.connectApiKey('replacement-openai-key')
    assert.equal(await readDefaultModel(), 'openai-codex/gpt-5.6-sol', 'adding another connection does not replace an explicit usable default')
    await apiAuth.disconnect('chatgpt')
    assert.equal(await readDefaultModel(), 'openai/gpt-5.6-luna', 'disconnecting the selected ChatGPT connection falls back to the verified API model')
    await apiAuth.disconnect('api-key')
    assert.equal(await readDefaultModel(), '', 'disconnecting the last selected connection clears the unavailable default')

    await defaultPreferences.updateSharedFromMain({ assistantDefaultModel: 'openai-codex/gpt-5.6-sol' })
    await apiAuth.connectApiKey('stale-default-replacement-key')
    assert.equal(await readDefaultModel(), 'openai/gpt-5.6-luna', 'a stale disconnected-provider default cannot survive a successful API connection')

    let releaseRemoval: (() => void) | null = null
    let removalStarted: (() => void) | null = null
    const removalStartedPromise = new Promise<void>((resolve) => { removalStarted = resolve })
    const serializedDisconnect = new OpenAIConnectionService({
        now,
        openExternal: () => undefined,
        loadAccount: async () => ({
            buildChatGptAccountStatus: async () => ({ provider: 'openai-codex', status: { configured: false } })
        }),
        loadSdk: async () => ({
            loginZyraAuth: async () => undefined,
            configureZyraOpenAIApiKey: async () => ({ model: 'openai/gpt-5.6-luna' }),
            verifyZyraOpenAIApiAuth: async () => ({ model: 'openai/gpt-5.6-luna' }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: false } }),
            removeZyraAuth: async () => {
                removalStarted?.()
                await new Promise<void>((resolve) => { releaseRemoval = resolve })
            }
        })
    })
    const firstDisconnect = serializedDisconnect.disconnect('api-key')
    await removalStartedPromise
    await assert.rejects(serializedDisconnect.disconnect('chatgpt'), /Wait for the current OpenAI connection action/)
    releaseRemoval?.()
    await firstDisconnect

    let removalCalls = 0
    const failedPreferenceWrite = new OpenAIConnectionService({
        now,
        openExternal: () => undefined,
        getAssistantDefaultModel: async () => 'openai/gpt-5.6-luna',
        setAssistantDefaultModel: async () => { throw new Error('preference disk unavailable') },
        loadAccount: async () => ({
            buildChatGptAccountStatus: async () => ({ provider: 'openai-codex', status: { configured: true }, usage: {} })
        }),
        loadSdk: async () => ({
            loginZyraAuth: async () => undefined,
            configureZyraOpenAIApiKey: async () => ({ model: 'openai/gpt-5.6-luna' }),
            verifyZyraOpenAIApiAuth: async () => ({ model: 'openai/gpt-5.6-luna' }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: true } }),
            removeZyraAuth: async () => { removalCalls += 1 }
        })
    })
    await assert.rejects(failedPreferenceWrite.disconnect('api-key'), /preference disk unavailable/)
    assert.equal(removalCalls, 0, 'a failed fallback preference write cannot delete the still-selected credential')

    let chatConnected = false
    let openedUrl: string | null = null
    let chatStatusCalls = 0
    let chatStatusOptions: { includeUsage?: boolean; refreshCredential?: boolean } | undefined
    const chatAuth = new OpenAIConnectionService({
        now,
        openExternal: (url) => { openedUrl = url },
        loadAccount: async () => ({
            buildChatGptAccountStatus: async (_provider?: string, options?: { includeUsage?: boolean; refreshCredential?: boolean }) => {
                chatStatusCalls += 1
                chatStatusOptions = options
                return chatConnected
                    ? { provider: 'openai-codex', status: { configured: true }, usage: {} }
                    : { provider: 'openai-codex', status: { configured: false } }
            }
        }),
        loadSdk: async () => ({
            loginZyraAuth: async (_provider: string, options: Record<string, unknown>) => {
                const onAuth = options.onAuth as (info: { url: string }) => void
                onAuth({ url: 'https://auth.openai.test/' })
                chatConnected = true
            },
            configureZyraOpenAIApiKey: async () => undefined,
            verifyZyraOpenAIApiAuth: async () => ({ ok: true }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: false } }),
            removeZyraAuth: async () => undefined
        })
    })
    const chatStatus = await chatAuth.connectChatGpt()
    assert.equal(openedUrl, 'https://auth.openai.test/')
    assert.equal(chatStatus.method, 'chatgpt')
    assert.equal(chatStatus.verified, true)
    assert.deepEqual(chatStatusOptions, { includeUsage: false, refreshCredential: false })
    const callsAfterConnect = chatStatusCalls
    assert.equal((await chatAuth.getStatus()).verified, true)
    assert.equal(chatStatusCalls, callsAfterConnect, 'a just-verified connection must make the Continue checkpoint instant')

    const usageFallback = new OpenAIConnectionService({
        now,
        openExternal: () => undefined,
        loadAccount: async () => ({
            buildChatGptAccountStatus: async () => ({
                provider: 'openai-codex',
                status: { configured: true },
                usageError: 'temporarily unavailable',
                tokenExpiresAt: '2099-08-15T10:00:00.000Z'
            })
        }),
        loadSdk: async () => ({
            loginZyraAuth: async () => undefined,
            configureZyraOpenAIApiKey: async () => undefined,
            verifyZyraOpenAIApiAuth: async () => ({ ok: true }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: false } }),
            removeZyraAuth: async () => undefined
        })
    })
    assert.equal((await usageFallback.getStatus()).verified, true, 'a valid token survives a temporary usage lookup failure')
}

function createAuth() {
    return new OpenAIConnectionService({
        now,
        openExternal: () => undefined,
        loadAccount: async () => ({
            buildChatGptAccountStatus: async () => connected
                ? { provider: 'openai-codex', status: { configured: true }, usage: {} }
                : { provider: 'openai-codex', status: { configured: false } }
        }),
        loadSdk: async () => ({
            loginZyraAuth: async () => undefined,
            configureZyraOpenAIApiKey: async () => undefined,
            verifyZyraOpenAIApiAuth: async () => ({ ok: true }),
            getZyraAuthStatus: async () => ({ provider: 'openai', status: { configured: false } }),
            removeZyraAuth: async () => undefined
        })
    })
}

try {
    await verifyOpenAiConnectionContract()
    const preferences = new DevicePreferencesService(preferencesPath, now)
    const service = new OnboardingService(onboardingPath, preferences, createAuth(), now)
    let snapshot = await service.initialize()
    assert.equal(snapshot.accessAllowed, false)
    assert.equal(service.shouldShowOnboarding(), true)
    assert.equal(snapshot.record?.currentStep, 'welcome')
    assert.equal(snapshot.record?.revision, 0)

    await assert.rejects(
        service.navigate({ expectedRevision: 0, step: 'appearance' }),
        /Complete setup steps in order/
    )

    snapshot = await service.commitStep({ expectedRevision: 0, step: 'welcome' })
    assert.equal(snapshot.record?.currentStep, 'connect-openai')
    assert.equal(snapshot.record?.revision, 1)
    const resumedCheckpoint = await new OnboardingService(onboardingPath, preferences, createAuth(), now).initialize()
    assert.equal(resumedCheckpoint.record?.currentStep, 'connect-openai', 'a restart must resume the exact committed checkpoint')
    assert.equal(resumedCheckpoint.record?.revision, 1)
    await assert.rejects(
        service.commitStep({ expectedRevision: 0, step: 'connect-openai' }),
        /expected revision 0, found 1/
    )

    snapshot = await service.commitStep({ expectedRevision: 1, step: 'connect-openai' })
    snapshot = await service.updateAppearance({
        expectedRevision: 2,
        selection: appearanceSelection
    })
    assert.equal(snapshot.record?.currentStep, 'appearance', 'saving a theme must not advance setup')
    assert.deepEqual(snapshot.record?.data.appearance, appearanceSelection, 'the selected theme must be resumable before Continue')
    const appearanceCheckpoint = await new OnboardingService(onboardingPath, preferences, createAuth(), now).initialize()
    assert.equal(appearanceCheckpoint.record?.currentStep, 'appearance', 'saving a theme must resume on the same setup page')
    assert.deepEqual(appearanceCheckpoint.record?.data.appearance, appearanceSelection, 'a restart must retain the selected theme before Continue')
    const savedAppearance = await preferences.get({ surface: 'desktop' })
    assert.equal(savedAppearance.settings.appearanceLightTheme, appearanceSelection.appearanceLightTheme)
    assert.equal(savedAppearance.settings.appearanceDarkTheme, appearanceSelection.appearanceDarkTheme)
    snapshot = await service.commitStep({
        expectedRevision: 3,
        step: 'appearance',
        selection: appearanceSelection
    })
    snapshot = await service.commitStep({
        expectedRevision: 4,
        step: 'projects',
        selection: { projectsFolder: projectsPath }
    })
    assert.equal(snapshot.record?.currentStep, 'review')
    snapshot = await service.commitStep({ expectedRevision: 5, step: 'review' })
    assert.equal(snapshot.accessAllowed, true)
    assert.equal(snapshot.showOnboarding, false)
    assert.equal(snapshot.record?.status, 'completed')
    assert.equal(snapshot.record?.revision, 6)
    assert.equal(service.shouldShowOnboarding(), false)

    const stored = await readFile(onboardingPath, 'utf8')
    assert.equal(stored.includes('test-openai-key'), false, 'onboarding persistence must never contain a credential')
    assert.equal(stored.includes('webSearch'), false, 'web defaults must not be serialized as a setup decision')
    assert.equal((await readdir(join(root, 'setup'))).some((name) => name.includes('.tmp-')), false, 'atomic temp files must be cleaned up')

    const webDefaults = await preferences.getNewChatWebDefaults()
    assert.deepEqual(webDefaults, { webSearch: true, webFetch: true }, 'new installs enable both web tools without adding an onboarding step')
    assert.equal(await validateOnboardingProjectsFolder(projectsPath), await realpath(projectsPath))
    await assert.rejects(validateOnboardingProjectsFolder(join(root, 'missing')), /existing projects folder/)
    await assert.rejects(validateOnboardingProjectsFolder(parse(root).root), /bounded projects folder/)

    connected = false
    const restarted = new OnboardingService(onboardingPath, preferences, createAuth(), now)
    const remembered = await restarted.initialize()
    assert.equal(remembered.accessAllowed, true, 'later auth expiry must not invalidate completed onboarding')

    const review = await restarted.beginReview({ expectedRevision: 6 })
    assert.equal(review.accessAllowed, true, 'review mode must preserve completed access')
    assert.equal(review.showOnboarding, true)
    assert.equal(review.record?.reviewActive, true)
    assert.equal(restarted.shouldShowOnboarding(), true)
    const resumedReview = new OnboardingService(onboardingPath, preferences, createAuth(), now)
    assert.equal((await resumedReview.initialize()).record?.reviewActive, true, 'review progress must resume after close')
    const cancelled = await resumedReview.cancelReview({ expectedRevision: 7 })
    assert.equal(cancelled.showOnboarding, false)
    assert.equal(cancelled.record?.status, 'completed')
    assert.equal(resumedReview.shouldShowOnboarding(), false)

    await assert.rejects(
        resumedReview.beginReview({ expectedRevision: 8, invalidateCompletion: true }),
        /Explicit confirmation/
    )

    const legacyCompletedRecord = {
        schemaVersion: 1,
        flowVersion: 1,
        revision: 11,
        status: 'completed',
        currentStep: 'review',
        completedSteps: ['welcome', 'connect-openai', 'appearance', 'web-access', 'projects', 'review'],
        reviewActive: false,
        startedAt: '2026-08-14T08:00:00.000Z',
        updatedAt: '2026-08-14T09:00:00.000Z',
        completedAt: '2026-08-14T09:00:00.000Z',
        data: {
            auth: { method: 'chatgpt', verifiedAt: '2026-08-14T08:10:00.000Z' },
            appearance: appearanceSelection,
            web: { webSearch: false, webFetch: true },
            projects: { projectsFolder: projectsPath }
        }
    }
    const legacyCompletedPath = join(root, 'setup', 'flow-v1-completed.json')
    await writeFile(legacyCompletedPath, JSON.stringify(legacyCompletedRecord))
    const migratedCompleted = await new OnboardingService(legacyCompletedPath, preferences, createAuth(), now).initialize()
    assert.equal(migratedCompleted.accessAllowed, true, 'removing the web step must preserve completed devices')
    assert.equal(migratedCompleted.record?.flowVersion, 2)
    assert.equal(migratedCompleted.record?.revision, 12)
    assert.equal(migratedCompleted.record?.completedAt, legacyCompletedRecord.completedAt)
    assert.equal((migratedCompleted.record?.completedSteps as readonly string[] | undefined)?.includes('web-access'), false)
    assert.equal(JSON.parse(await readFile(legacyCompletedPath, 'utf8')).flowVersion, 2, 'flow migration must persist atomically')
    assert.equal((await new OnboardingService(legacyCompletedPath, preferences, createAuth(), now).initialize()).record?.revision, 12, 'flow migration must be idempotent after restart')

    const { appearanceLightTheme: _removedLightTheme, ...pairlessAppearance } = appearanceSelection
    const pairlessCurrentPath = join(root, 'setup', 'flow-v2-pairless.json')
    await writeFile(pairlessCurrentPath, JSON.stringify({
        ...legacyCompletedRecord,
        flowVersion: 2,
        revision: 20,
        completedSteps: ['welcome', 'connect-openai', 'appearance', 'projects', 'review'],
        data: { ...legacyCompletedRecord.data, appearance: pairlessAppearance }
    }))
    const pairlessCurrent = await new OnboardingService(pairlessCurrentPath, preferences, createAuth(), now).initialize()
    assert.equal(pairlessCurrent.accessAllowed, true, 'existing v2 records without a light half must remain completed')
    assert.equal(pairlessCurrent.record?.data.appearance?.appearanceLightTheme, 'light', 'missing light halves migrate in memory to Zyra Light')

    const invalidPairPath = join(root, 'setup', 'flow-v2-invalid-theme-pair.json')
    await writeFile(invalidPairPath, JSON.stringify({
        ...legacyCompletedRecord,
        flowVersion: 2,
        revision: 21,
        completedSteps: ['welcome', 'connect-openai', 'appearance', 'projects', 'review'],
        data: {
            ...legacyCompletedRecord.data,
            appearance: { ...appearanceSelection, appearanceLightTheme: 'forest' }
        }
    }))
    const invalidPair = await new OnboardingService(invalidPairPath, preferences, createAuth(), now).initialize()
    assert.equal(invalidPair.accessAllowed, false, 'a dark theme cannot be trusted as the saved light half')
    assert.equal(invalidPair.recovery?.reason, 'invalid-current-schema')

    const legacyWebStepPath = join(root, 'setup', 'flow-v1-web-step.json')
    await writeFile(legacyWebStepPath, JSON.stringify({
        schemaVersion: 1,
        flowVersion: 1,
        revision: 4,
        status: 'in-progress',
        currentStep: 'web-access',
        completedSteps: ['welcome', 'connect-openai', 'appearance'],
        reviewActive: false,
        startedAt: '2026-08-14T08:00:00.000Z',
        updatedAt: '2026-08-14T08:20:00.000Z',
        completedAt: null,
        data: {
            auth: { method: 'chatgpt', verifiedAt: '2026-08-14T08:10:00.000Z' },
            appearance: appearanceSelection
        }
    }))
    const migratedWebStep = await new OnboardingService(legacyWebStepPath, preferences, createAuth(), now).initialize()
    assert.equal(migratedWebStep.record?.currentStep, 'projects', 'an unfinished removed web step must resume at the next useful decision')
    assert.equal(migratedWebStep.record?.flowVersion, 2)
    assert.equal(migratedWebStep.record?.revision, 5)

    const legacyBacktrackedPath = join(root, 'setup', 'flow-v1-backtracked-web-step.json')
    await writeFile(legacyBacktrackedPath, JSON.stringify({
        ...legacyCompletedRecord,
        revision: 8,
        status: 'in-progress',
        currentStep: 'web-access',
        completedSteps: ['welcome', 'connect-openai', 'appearance', 'web-access', 'projects'],
        completedAt: null
    }))
    const migratedBacktracked = await new OnboardingService(legacyBacktrackedPath, preferences, createAuth(), now).initialize()
    assert.equal(migratedBacktracked.record?.currentStep, 'review', 'a backtracked removed step must not make the user repeat Projects')
    assert.equal(migratedBacktracked.record?.revision, 9)

    const invalidLegacyPath = join(root, 'setup', 'flow-v1-invalid-completed.json')
    await writeFile(invalidLegacyPath, JSON.stringify({
        ...legacyCompletedRecord,
        revision: 14,
        data: {
            auth: legacyCompletedRecord.data.auth,
            appearance: legacyCompletedRecord.data.appearance,
            projects: legacyCompletedRecord.data.projects
        }
    }))
    const invalidLegacy = await new OnboardingService(invalidLegacyPath, preferences, createAuth(), now).initialize()
    assert.equal(invalidLegacy.accessAllowed, false, 'an invalid v1 completion must never be relaxed into a valid v2 completion')
    assert.equal(invalidLegacy.recovery?.reason, 'invalid-current-schema')
    assert.ok(invalidLegacy.recovery?.backupPath)

    const corruptPath = join(root, 'setup', 'corrupt-onboarding.json')
    await writeFile(corruptPath, '{not json')
    const corruptService = new OnboardingService(corruptPath, preferences, createAuth(), now)
    const recovered = await corruptService.initialize()
    assert.equal(recovered.accessAllowed, false)
    assert.equal(recovered.recovery?.reason, 'corrupt')
    assert.ok(recovered.recovery?.backupPath, 'corrupt setup must be backed up instead of trusted')

    const futurePath = join(root, 'setup', 'future-onboarding.json')
    const futureContents = JSON.stringify({ schemaVersion: 99, revision: 42, status: 'completed' })
    await writeFile(futurePath, futureContents)
    const futureService = new OnboardingService(futurePath, preferences, createAuth(), now)
    const future = await futureService.initialize()
    assert.equal(future.blockedReason, 'future-schema')
    assert.equal(future.accessAllowed, false)
    assert.equal(await readFile(futurePath, 'utf8'), futureContents, 'future schema data must remain untouched')

    const futureFlowPath = join(root, 'setup', 'future-flow-onboarding.json')
    const futureFlowContents = JSON.stringify({ schemaVersion: 1, flowVersion: 7, revision: 2, status: 'in-progress' })
    await writeFile(futureFlowPath, futureFlowContents)
    const futureFlowService = new OnboardingService(futureFlowPath, preferences, createAuth(), now)
    assert.equal((await futureFlowService.initialize()).blockedReason, 'future-schema')
    assert.equal(await readFile(futureFlowPath, 'utf8'), futureFlowContents, 'future flow versions must remain untouched')

    const concurrentPath = join(root, 'setup', 'concurrent-onboarding.json')
    const concurrent = new OnboardingService(concurrentPath, preferences, createAuth(), now)
    await concurrent.initialize()
    await concurrent.commitStep({ expectedRevision: 0, step: 'welcome' })
    connected = true
    const concurrentResults = await Promise.allSettled([
        concurrent.commitStep({ expectedRevision: 1, step: 'connect-openai' }),
        concurrent.commitStep({ expectedRevision: 1, step: 'connect-openai' })
    ])
    assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1, 'serialized writes must reject a stale concurrent revision')
    assert.equal((await concurrent.getState()).record?.currentStep, 'appearance')

    connected = false
    const providerPath = join(root, 'setup', 'claude-onboarding.json')
    const additionalConnections = async () => [{ provider: 'anthropic', label: 'Claude API', verified: true }]
    const providerService = new OnboardingService(providerPath, preferences, createAuth(), now, undefined, additionalConnections)
    let providerSnapshot = await providerService.initialize()
    providerSnapshot = await providerService.commitStep({ expectedRevision: providerSnapshot.record!.revision, step: 'welcome' })
    providerSnapshot = await providerService.commitStep({ expectedRevision: providerSnapshot.record!.revision, step: 'connect-openai' })
    assert.equal(providerSnapshot.record?.data.auth?.provider, 'anthropic')
    assert.equal(providerSnapshot.record?.currentStep, 'appearance')
    const providerRestored = await new OnboardingService(providerPath, preferences, createAuth(), now, undefined, additionalConnections).initialize()
    assert.equal(providerRestored.record?.data.auth?.label, 'Claude API connected')
    console.log('onboarding state and persistence: ok')
} finally {
    await rm(root, { recursive: true, force: true })
}
