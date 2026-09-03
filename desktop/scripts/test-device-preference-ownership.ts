import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    getDevicePreferenceOwnership,
    SHARED_DEVICE_PREFERENCE_KEYS,
    SURFACE_DEVICE_PREFERENCE_KEYS
} from '../src/shared/preferences/contracts'
import {
    DevicePreferencesService,
    partitionDevicePreferencePatch,
    sanitizeDevicePreferenceValue
} from '../src/main/setup/device-preferences-service'
import { DeviceSecretsService } from '../src/main/setup/device-secrets-service'

const root = await mkdtemp(join(tmpdir(), 'zyra-preferences-test-'))
let tick = Date.parse('2026-08-14T11:00:00.000Z')
const now = () => new Date(tick += 1_000)

try {
    const partitioned = partitionDevicePreferencePatch({
        appearanceThemeMode: 'dark',
        appearanceLightTheme: 'paper-light',
        assistantDefaultWebSearch: false,
        assistantTitleModel: 'openai-codex/gpt-5.6-luna',
        assistantReasoningSummary: 'detailed',
        assistantContextCompactionThresholdTokens: 256_000,
        assistantChatDisplayMode: 'detailed',
        browserViewMode: 'grid',
        startWithWindows: true,
        groqApiKey: 'must-not-migrate',
        theme: 'midnight',
        unknownValue: true
    }, 'desktop')
    assert.deepEqual(partitioned.shared, {
        appearanceThemeMode: 'dark',
        appearanceLightTheme: 'paper-light',
        assistantDefaultWebSearch: false,
        assistantTitleModel: 'openai-codex/gpt-5.6-luna',
        assistantReasoningSummary: 'detailed',
        assistantContextCompactionThresholdTokens: 256_000
    })
    assert.deepEqual(partitioned.surface, { assistantChatDisplayMode: 'detailed', browserViewMode: 'grid' })
    assert.equal(getDevicePreferenceOwnership('startWithWindows'), 'os')
    assert.equal(getDevicePreferenceOwnership('groqApiKey'), 'secret')
    assert.equal(sanitizeDevicePreferenceValue('appearanceLightTheme', 'forest'), undefined, 'dark themes cannot enter the light half')
    assert.equal(sanitizeDevicePreferenceValue('appearanceDarkTheme', 'paper-light'), undefined, 'light themes cannot enter the dark half')
    assert.equal(sanitizeDevicePreferenceValue('appearanceLightTheme', 'paper-light'), 'paper-light')
    assert.equal(sanitizeDevicePreferenceValue('appearanceDarkTheme', 'forest'), 'forest')
    assert.equal(sanitizeDevicePreferenceValue('assistantTitleModel', 56), undefined, 'the title model rejects malformed non-string values')
    assert.equal(sanitizeDevicePreferenceValue('assistantReasoningSummary', 'raw'), undefined, 'raw chain-of-thought cannot become a reasoning-summary mode')
    assert.equal(sanitizeDevicePreferenceValue('assistantReasoningSummary', 'detailed'), 'detailed')
    assert.equal(sanitizeDevicePreferenceValue('assistantDefaultRuntimeMode', 'auto-review'), 'auto-review')
    assert.equal(sanitizeDevicePreferenceValue('assistantDefaultRuntimeMode', 'edits-only'), 'edits-only')
    assert.equal(sanitizeDevicePreferenceValue('assistantChatDisplayMode', 'detailed'), 'detailed')
    assert.equal(sanitizeDevicePreferenceValue('assistantChatDisplayMode', 'dense'), undefined)
    assert.equal(sanitizeDevicePreferenceValue('assistantContextCompactionThresholdTokens', 500_000), 372_000, 'context limits clamp below the 400k model ceiling')

    const allOwned = new Set([...SHARED_DEVICE_PREFERENCE_KEYS, ...SURFACE_DEVICE_PREFERENCE_KEYS])
    assert.equal(allOwned.size, SHARED_DEVICE_PREFERENCE_KEYS.length + SURFACE_DEVICE_PREFERENCE_KEYS.length, 'shared and surface preference keys must not overlap')

    const path = join(root, 'device-preferences.json')
    const service = new DevicePreferencesService(path, now)
    assert.deepEqual(
        await service.getNewChatWebDefaults(),
        { webSearch: true, webFetch: true },
        'ordinary new installs start with both web tools enabled'
    )
    assert.equal(
        await service.getAssistantTitleModel(),
        'openai-codex/gpt-5.6-luna',
        'ordinary new installs use GPT-5.6 Luna for chat titles'
    )
    assert.deepEqual(
        await service.getAssistantRuntimePolicy(),
        { reasoningSummary: 'detailed', contextCompactionThresholdTokens: 256_000 },
        'ordinary installs request detailed summaries and compact before a new turn crosses 256k'
    )
    const browserBeforeDesktop = await service.get({
        surface: 'browser',
        legacySettings: {
            appearanceThemeMode: 'light',
            browserViewMode: 'grid',
            assistantDefaultWebFetch: false
        }
    })
    assert.equal(browserBeforeDesktop.desktopLegacyMigrationComplete, false, 'browser legacy data must never trigger the Desktop migration')
    assert.deepEqual(browserBeforeDesktop.settings, {})

    const events: Array<{ revision: number; changedKeys: string[] }> = []
    service.subscribe((event) => events.push({ revision: event.revision, changedKeys: event.changedKeys }))
    const desktop = await service.get({
        surface: 'desktop',
        legacySettings: {
            settingsSchemaVersion: 4,
            appearanceThemeMode: 'light',
            appearanceLightTheme: 'paper-light',
            appearanceDarkTheme: 'forest',
            assistantDefaultWebSearch: false,
            assistantDefaultWebFetch: true,
            browserViewMode: 'grid',
            assistantChatDisplayMode: 'detailed',
            assistantAutoReconnect: false,
            startWithWindows: true,
            groqApiKey: 'secret-groq',
            geminiApiKey: 'secret-gemini'
        }
    })
    assert.equal(desktop.desktopLegacyMigrationComplete, true)
    assert.equal(desktop.settings.appearanceThemeMode, 'light')
    assert.equal(desktop.settings.appearanceLightTheme, 'paper-light')
    assert.equal(desktop.settings.appearanceDarkTheme, 'forest')
    assert.equal(desktop.settings.browserViewMode, 'grid')
    assert.equal(desktop.settings.assistantChatDisplayMode, 'detailed')
    assert.equal(desktop.settings.assistantAutoReconnect, false)
    assert.equal('startWithWindows' in desktop.settings, false)
    assert.equal('groqApiKey' in desktop.settings, false)

    const browser = await service.get({ surface: 'browser' })
    assert.equal(browser.settings.appearanceThemeMode, 'light', 'shared Desktop choices must reach the browser')
    assert.equal(browser.settings.appearanceLightTheme, 'paper-light', 'the selected light half must sync across surfaces')
    assert.equal(browser.settings.appearanceDarkTheme, 'forest', 'the selected dark half must sync across surfaces')
    assert.equal(browser.settings.assistantDefaultWebSearch, false)
    assert.equal('browserViewMode' in browser.settings, false, 'Desktop layout must not overwrite browser layout')
    assert.equal('assistantChatDisplayMode' in browser.settings, false, 'Desktop conversation density must not overwrite the browser surface')
    assert.equal('assistantAutoReconnect' in browser.settings, false, 'surface reconnect behavior must remain local')

    const updated = await service.update({
        surface: 'browser',
        expectedRevision: browser.revision,
        patch: {
            browserViewMode: 'finder',
            assistantHistoryPrefetch: true,
            assistantDefaultWebSearch: true,
            assistantTitleModel: 'openai-codex/gpt-5.6-terra',
            assistantReasoningSummary: 'concise',
            assistantContextCompactionThresholdTokens: 320_000,
            groqApiKey: 'still-secret'
        }
    })
    assert.equal(updated.settings.browserViewMode, 'finder')
    assert.equal(updated.settings.assistantHistoryPrefetch, true)
    assert.equal(updated.settings.assistantDefaultWebSearch, true)
    assert.equal(updated.settings.assistantTitleModel, 'openai-codex/gpt-5.6-terra')
    assert.equal(await service.getAssistantTitleModel(), 'openai-codex/gpt-5.6-terra')
    assert.deepEqual(
        await service.getAssistantRuntimePolicy(),
        { reasoningSummary: 'concise', contextCompactionThresholdTokens: 320_000 },
        'runtime policy changes remain shared across Desktop and Browser'
    )
    assert.equal(events.at(-1)?.revision, updated.revision, 'preference writes must publish a typed revision event')
    assert.ok(events.at(-1)?.changedKeys.includes('assistantDefaultWebSearch'))

    const pendingPolicyUpdate = service.update({
        surface: 'desktop',
        expectedRevision: updated.revision,
        patch: {
            assistantReasoningSummary: 'detailed',
            assistantContextCompactionThresholdTokens: 200_000,
            sidebarHoverPreviewEnabled: false
        }
    })
    const policyDuringWrite = service.getAssistantRuntimePolicy()
    await pendingPolicyUpdate
    assert.deepEqual(
        await policyDuringWrite,
        { reasoningSummary: 'detailed', contextCompactionThresholdTokens: 200_000 },
        'prompt dispatch waits for an already-queued Settings policy write'
    )

    const desktopAfterBrowser = await service.get({ surface: 'desktop' })
    assert.equal(desktopAfterBrowser.settings.browserViewMode, 'grid', 'browser surface updates must not alter Desktop view')
    assert.equal(desktopAfterBrowser.settings.assistantDefaultWebSearch, true, 'shared updates must sync live across surfaces')
    assert.equal(desktopAfterBrowser.settings.assistantTitleModel, 'openai-codex/gpt-5.6-terra', 'the title-model preference must remain shared across Desktop and Browser')
    assert.equal(desktopAfterBrowser.settings.sidebarHoverPreviewEnabled, false, 'Desktop retains the disabled minimized-sidebar hover preview preference')
    assert.equal((await service.get({ surface: 'browser' })).settings.sidebarHoverPreviewEnabled, undefined, 'the Desktop hover preference cannot overwrite another surface')
    const mainOwnedBlockerUpdate = await service.updateSurfaceFromMain('desktop', {
        assistantBrowserAdBlockEnabled: true,
        assistantBrowserAdBlockPromptDismissed: true,
        assistantDefaultWebSearch: false
    })
    assert.equal(mainOwnedBlockerUpdate.settings.assistantBrowserAdBlockEnabled, true, 'main can atomically persist Desktop blocker state')
    assert.equal(mainOwnedBlockerUpdate.settings.assistantBrowserAdBlockPromptDismissed, true)
    assert.equal(mainOwnedBlockerUpdate.settings.assistantDefaultWebSearch, true, 'main surface updates cannot mutate shared preferences')

    await assert.rejects(
        service.update({ surface: 'desktop', expectedRevision: desktop.revision, patch: { compactMode: true } }),
        /expected revision/
    )
    const persisted = await readFile(path, 'utf8')
    assert.equal(persisted.includes('secret-groq'), false)
    assert.equal(persisted.includes('secret-gemini'), false)
    assert.equal(persisted.includes('still-secret'), false)

    const encryptedPath = join(root, 'device-secrets.bin')
    const encryption = {
        isAvailable: () => true,
        encrypt: (value: string) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`),
        decrypt: (value: Buffer) => Buffer.from(value.toString().slice(4), 'base64').toString('utf8')
    }
    const secrets = new DeviceSecretsService(encryptedPath, encryption, now)
    await secrets.migrateLegacyHostedAiKeys({ groqApiKey: 'groq-private', geminiApiKey: 'gemini-private' })
    const secretSnapshot = await secrets.getHostedAiKeys()
    assert.deepEqual(secretSnapshot.secrets, { groqApiKey: 'groq-private', geminiApiKey: 'gemini-private' })
    const encrypted = await readFile(encryptedPath, 'utf8')
    assert.equal(encrypted.includes('groq-private'), false, 'hosted keys must not be persisted as plaintext')
    await secrets.migrateLegacyHostedAiKeys({ groqApiKey: 'browser-must-not-win' })
    assert.equal((await secrets.getHostedAiKeys()).secrets.groqApiKey, 'groq-private', 'legacy migration must run once')
    await assert.rejects(
        secrets.updateHostedAiKeys({ groqApiKey: '' }),
        (error: unknown) => (error as { code?: string }).code === 'CONFIRMATION_REQUIRED',
        'removing an encrypted hosted credential requires an explicit destructive confirmation'
    )
    await secrets.updateHostedAiKeys({ groqApiKey: '', confirmClear: true })
    assert.equal((await secrets.getHostedAiKeys()).status.groqConfigured, false)
    await secrets.updateBrowserIntegrationSecrets({ unsplashAccessKey: 'unsplash-private' })
    assert.equal(await secrets.getUnsplashAccessKey(), 'unsplash-private')
    assert.equal((await readFile(encryptedPath, 'utf8')).includes('unsplash-private'), false, 'Unsplash BYOK must remain encrypted')
    await assert.rejects(secrets.updateBrowserIntegrationSecrets({ unsplashAccessKey: '' }), /Confirm before removing/)
    await secrets.updateBrowserIntegrationSecrets({ unsplashAccessKey: '', confirmClear: true })
    assert.equal((await secrets.updateBrowserIntegrationSecrets({})).status.unsplashConfigured, false)
    assert.equal((await secrets.getHostedAiKeys()).status.geminiConfigured, true)

    const unavailableSecrets = new DeviceSecretsService(join(root, 'unavailable-secrets.bin'), {
        isAvailable: () => false,
        encrypt: () => { throw new Error('must not encrypt') },
        decrypt: () => { throw new Error('must not decrypt') }
    }, now)
    await assert.rejects(
        unavailableSecrets.migrateLegacyHostedAiKeys({ groqApiKey: 'retain-in-legacy-until-secure' }),
        /Secure OS credential storage is unavailable/
    )
    assert.equal((await unavailableSecrets.getHostedAiKeys()).status.persistenceAvailable, false)

    const futurePath = join(root, 'future-device-preferences.json')
    const futureContents = JSON.stringify({ schemaVersion: 88, revision: 9, shared: { compactMode: true } })
    await writeFile(futurePath, futureContents)
    const futureService = new DevicePreferencesService(futurePath, now)
    await assert.rejects(futureService.get({ surface: 'desktop' }), /newer Zyra version/)
    await assert.rejects(
        futureService.update({ surface: 'desktop', expectedRevision: 9, patch: { compactMode: false } }),
        /newer Zyra version/
    )
    assert.equal(await readFile(futurePath, 'utf8'), futureContents, 'future preference schemas must not be overwritten or downgraded')

    console.log('device preference ownership and sync: ok')
} finally {
    await rm(root, { recursive: true, force: true })
}
