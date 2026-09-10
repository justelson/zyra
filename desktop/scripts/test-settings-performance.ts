import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const originalWindow = (globalThis as { window?: unknown }).window
let modelRequests = 0
;(globalThis as any).window = {
    devscope: {
        assistant: {
            listModels: async (forceRefresh = false) => {
                modelRequests += 1
                return {
                    success: true as const,
                    models: [{ id: forceRefresh ? 'model:forced' : 'model:cached', label: 'Model' }]
                }
            }
        }
    }
}

try {
    const registry = await import('../src/renderer/src/lib/settings-cache-registry')
    let cleared = 0
    const unregister = registry.registerSettingsCacheClearer('test-settings-cache', () => { cleared += 1 })
    registry.clearSettingsRuntimeCaches()
    assert.equal(cleared, 1, 'the Settings cache registry clears each loaded cache exactly once')
    unregister()

    const catalog = await import('../src/renderer/src/pages/settings/settings-model-catalog-cache')
    const first = await catalog.loadSettingsModels(false)
    const second = await catalog.loadSettingsModels(false)
    assert.equal(modelRequests, 1, 'Assistant and Providers must share one fresh model-catalog request')
    assert.equal(first, second, 'fresh Settings model reads reuse the same bounded in-memory catalog')

    const forced = await catalog.loadSettingsModels(true)
    assert.equal(modelRequests, 2, 'manual model refresh bypasses the freshness cache')
    assert.equal(forced[0]?.id, 'model:forced')

    catalog.invalidateSettingsModels()
    await catalog.loadSettingsModels(false)
    assert.equal(modelRequests, 3, 'account mutations invalidate the shared model catalog')

    let resolveStaleRequest: ((value: { success: true; models: Array<{ id: string; label: string }> }) => void) | null = null
    let raceRequestIndex = 0
    ;(globalThis as any).window.devscope.assistant.listModels = async () => {
        modelRequests += 1
        raceRequestIndex += 1
        if (raceRequestIndex === 1) {
            return new Promise((resolve) => { resolveStaleRequest = resolve })
        }
        return { success: true as const, models: [{ id: 'model:current-account', label: 'Current account' }] }
    }
    catalog.invalidateSettingsModels()
    const staleRequest = catalog.loadSettingsModels(false)
    catalog.invalidateSettingsModels()
    const currentRequest = catalog.loadSettingsModels(false)
    assert.equal(modelRequests, 4, 'a newer account generation waits for the stale in-flight request before replacing it')
    resolveStaleRequest?.({ success: true, models: [{ id: 'model:old-account', label: 'Old account' }] })
    await staleRequest
    const currentModels = await currentRequest
    assert.equal(modelRequests, 5, 'the post-invalidation generation performs its own model request')
    assert.equal(currentModels[0]?.id, 'model:current-account', 'stale model results cannot repopulate the current account cache')

    const accountSource = readFileSync(new URL('../src/renderer/src/pages/settings/AccountSettings.tsx', import.meta.url), 'utf8')
    const connectionLoadSource = accountSource.split('const loadConnectionState')[1]?.split('const applyAccountOverview')[0] || ''
    assert.doesNotMatch(connectionLoadSource, /listModels/, 'opening Account cannot discover models as an unrelated side effect')
    assert.match(accountSource, /ACCOUNT_POLL_INTERVAL_MS = 60_000/, 'Account polling uses a quiet one-minute cadence')
    assert.match(accountSource, /document\.visibilityState === 'visible'/, 'Account polling pauses network work while hidden')
    assert.match(accountSource, /startAccountOverviewPolling\(\{\s*refresh: loadOverview,/, 'the Account page must use the lifecycle-owned poller')
    assert.match(accountSource, /return \(\) => \{\s*overviewRequestIdRef\.current \+= 1\s*polling\.dispose\(\)/, 'navigation invalidates pending UI updates and permanently stops polling')
    assert.doesNotMatch(accountSource, /finally\(schedulePoll\)/, 'unmounted refresh completions must not resurrect timers')

    const settingsStoreSource = readFileSync(new URL('../src/renderer/src/lib/settings.tsx', import.meta.url), 'utf8')
    assert.match(settingsStoreSource, /clearProjectViewCaches\(\)[\s\S]{0,160}clearSettingsRuntimeCaches\(\)/, 'Clear cache includes loaded Settings runtime caches')

    const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
    assert.match(runtimeSource, /private availabilityCache: \{ root: string; checkedAt: number; result:/, 'runtime availability retains a root-scoped cache')
    assert.match(runtimeSource, /async checkAvailability\(forceRefresh = false\)[\s\S]{0,500}Date\.now\(\) - this\.availabilityCache\.checkedAt < 30_000[\s\S]{0,180}return this\.availabilityCache\.result/, 'runtime availability is cached instead of spawning Node for every Settings mount')
    const listModelsSource = runtimeSource.split('async listModels(forceRefresh = false)')[1]?.split('async prewarm')[0] || ''
    assert.doesNotMatch(listModelsSource, /checkAvailability/, 'model listing performs only one availability check through prewarm')
    assert.match(runtimeSource, /listModelsWithProvenance[\s\S]{0,1600}authoritative: false/, 'fallback model lists expose request-local non-authoritative provenance')

    console.log('Settings performance contract: ok')
} finally {
    if (originalWindow === undefined) delete (globalThis as any).window
    else (globalThis as any).window = originalWindow
}
