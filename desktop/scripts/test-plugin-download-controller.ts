import assert from 'node:assert/strict'
import { PluginDownloadController, type PluginDownloadApi } from '../src/renderer/src/pages/plugins/plugin-download-controller'
import { makePluginDirectoryFixture } from './fixtures/plugin-directory-data'
import { getReviewedCatalogPluginSelection } from '../src/renderer/src/pages/plugins/plugin-directory-state'
import type { AssistantPluginInspection } from '../src/shared/assistant/contracts'

const release = makePluginDirectoryFixture().releases[0]
const review = (): AssistantPluginInspection => ({
    reviewId: 'review-fixture', expiresAt: new Date(Date.now() + 60_000).toISOString(), manifest: release.manifest,
    release: { name: release.manifest.name, version: release.version, contentDigest: release.contentDigest, fileCount: release.fileCount, totalBytes: release.totalBytes, containsExecutableFiles: true, skills: release.skills, contributions: [{ kind: 'skills', relativePath: './skills', support: 'supported' }, { kind: 'mcp', relativePath: './.mcp.json', support: 'planned' }], diagnostics: [] }
})
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 2))
async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await tick() }
    throw Error('Controller condition did not settle')
}
type Reply = Awaited<ReturnType<PluginDownloadApi['getPluginDownload']>>
const controllers: PluginDownloadController[] = []
function make(api: PluginDownloadApi) { const controller = new PluginDownloadController(() => api, 1); controllers.push(controller); return controller }
try {
    const catalog = makePluginDirectoryFixture()
    const selected = catalog.plugins[0]
    selected.sourceId = `openai-catalog:${selected.name}`
    const sameBytes = { ...selected, id: 'other-installation', sourceId: 'other-source', activeReleaseId: 'other-release' }
    catalog.plugins.unshift(sameBytes)
    catalog.releases.unshift({ ...catalog.releases[0], id: 'other-release', pluginId: sameBytes.id })
    assert.equal(getReviewedCatalogPluginSelection(catalog, selected.name, review())?.pluginId, selected.id, 'new Chat selects the reviewed source, not the first matching digest')
    selected.state = 'disabled'
    assert.equal(getReviewedCatalogPluginSelection(catalog, selected.name, review()), null, 'install cannot silently reactivate a disabled Plugin')
    selected.state = 'active'
    assert.equal(getReviewedCatalogPluginSelection(catalog, selected.name, { ...review(), release: { ...review().release, contentDigest: 'e'.repeat(64) } }), null, 'a changed release cannot inherit approval')
    const result = deferred<Reply>()
    let reads = 0, cancellations = 0, notifications = 0
    const controller = make({
        startPluginDownload: async () => ({ success: true, download: { id: 'job', status: 'downloading' } }),
        getPluginDownload: async () => { reads++; return reads === 1 ? { success: true, download: { id: 'job', status: 'downloading', progress: { phase: 'downloading', completedFiles: 1, totalFiles: 2, completedBytes: 10, totalBytes: 20, cacheHits: 1 } } } : result.promise },
        cancelPluginDownload: async () => { cancellations++; return { success: true } }
    })
    const unsubscribe = controller.subscribe(() => notifications++)
    const task = controller.start('vercel')
    await until(() => reads === 2)
    assert.equal(controller.getSnapshot().download?.progress?.completedFiles, 1)
    unsubscribe() // Navigation removes the listener, not the main-owned job.
    const afterUnmount = notifications
    result.resolve({ success: true, download: { id: 'job', status: 'ready', inspection: review() } })
    await task
    assert.equal(notifications, afterUnmount)
    assert.equal(cancellations, 0)
    assert.equal(controller.getSnapshot().phase, 'ready', 'returning to Plugins sees the same review')
    assert.ok(controller.claimReview())
    assert.equal(controller.claimReview(), null, 'double confirmation cannot claim the review twice')
    await controller.cancel()
    assert.equal(cancellations, 0, 'cancellation cannot race activation')
    controller.finishInstall()
    await tick()
    assert.equal(controller.getSnapshot().phase, 'idle')
    assert.equal(controller.getSnapshot().installationRevision, 1, 'remounted clients can refresh their catalog after activation finishes')
    assert.equal(cancellations, 1)

    const lateStart = deferred<Awaited<ReturnType<PluginDownloadApi['startPluginDownload']>>>()
    const released: string[] = []
    const beforeId = make({
        startPluginDownload: () => lateStart.promise,
        getPluginDownload: async () => { throw Error('Cancelled start must not poll') },
        cancelPluginDownload: async ({id}) => { released.push(id); return { success: true } }
    })
    const pending = beforeId.start('vercel')
    const cancelled = beforeId.cancel()
    assert.equal(beforeId.getSnapshot().phase, 'cancelling')
    lateStart.resolve({ success: true, download: { id: 'late-id', status: 'downloading' } })
    await Promise.all([pending, cancelled])
    assert.deepEqual(released, ['late-id'])
    assert.equal(beforeId.getSnapshot().phase, 'idle')

    const latePoll = deferred<Reply>()
    let polled = false
    const duringPoll = make({
        startPluginDownload: async () => ({ success: true, download: { id: 'poll-id', status: 'downloading' } }),
        getPluginDownload: () => { polled = true; return latePoll.promise },
        cancelPluginDownload: async () => ({ success: true })
    })
    const polling = duringPoll.start('vercel')
    await until(() => polled)
    const cancelPolling = duringPoll.cancel()
    latePoll.resolve({ success: true, download: { id: 'poll-id', status: 'ready', inspection: review() } })
    await Promise.all([polling, cancelPolling])
    assert.equal(duringPoll.getSnapshot().phase, 'idle', 'late ready cannot resurrect a cancelled review')

    let starts = 0, fail = true
    const retry = make({
        startPluginDownload: async () => ({ success: true, download: { id: `retry-${++starts}`, status: 'downloading' } }),
        getPluginDownload: async ({id}) => ({ success: true, download: fail ? { id, status: 'failed', error: 'Fixture network failure' } : { id, status: 'ready', inspection: review() } }),
        cancelPluginDownload: async () => ({ success: true })
    })
    await retry.start('vercel')
    assert.equal(retry.getSnapshot().phase, 'failed')
    fail = false
    await retry.start('vercel')
    assert.equal(starts, 2)
    assert.equal(retry.getSnapshot().phase, 'ready')
    retry.claimReview(); retry.finishInstall('Fixture installation failed. Try again.')
    assert.equal(retry.getSnapshot().phase, 'failed')

    let allowCleanup = false, blockedStarts = 0
    const blocked = make({
        startPluginDownload: async () => ({ success: true, download: { id: `blocked-${++blockedStarts}`, status: 'downloading' } }),
        getPluginDownload: async () => ({ success: false, error: 'Fixture failure' }),
        cancelPluginDownload: async () => allowCleanup ? { success: true } : { success: false, error: 'Cleanup unavailable' }
    })
    await blocked.start('vercel')
    await blocked.start('vercel')
    assert.equal(blockedStarts, 1, 'retry cannot create a competing owner job while cleanup failed')
    allowCleanup = true
    await blocked.cancel()
    assert.equal(blocked.getSnapshot().phase, 'idle')

    let installationStarts = 0, releaseAllowed = false
    const failedActivation = make({
        startPluginDownload: async () => ({ success: true, download: { id: `activation-${++installationStarts}`, status: 'downloading' } }),
        getPluginDownload: async ({id}) => ({ success: true, download: { id, status: 'ready', inspection: review() } }),
        cancelPluginDownload: async () => releaseAllowed ? { success: true } : { success: false, error: 'Cleanup unavailable' }
    })
    await failedActivation.start('vercel')
    failedActivation.claimReview(); failedActivation.finishInstall('Installation request failed.')
    await tick()
    await failedActivation.start('vercel')
    assert.equal(installationStarts, 1, 'failed activation keeps cleanup ownership until acknowledged')
    releaseAllowed = true
    await failedActivation.cancel()
    assert.equal(failedActivation.getSnapshot().phase, 'idle')

    const expires = make({
        startPluginDownload: async () => ({ success: true, download: { id: 'expires', status: 'downloading' } }),
        getPluginDownload: async () => ({ success: true, download: { id: 'expires', status: 'ready', inspection: { ...review(), expiresAt: new Date(Date.now() + 20).toISOString() } } }),
        cancelPluginDownload: async () => ({ success: true })
    })
    await expires.start('vercel')
    await until(() => expires.getSnapshot().phase === 'failed')
    assert.equal(expires.claimReview(), null, 'expired review cannot activate')
    console.log('Plugin controller: navigation survival, explicit review, cancellation races, retry, cleanup and expiry: ok')
} finally {
    for (const controller of controllers) {
        if (controller.getSnapshot().phase === 'installing') controller.finishInstall()
        await controller.cancel()
    }
}
