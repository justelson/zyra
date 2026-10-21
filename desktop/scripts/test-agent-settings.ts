import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
import { AgentSettings } from '../src/main/assistant/agent-settings'
import { AppOperationReceipts } from '../src/main/assistant/app-operation-receipts'
import { projectUsageWindow, redactAppData } from '../src/main/assistant/agent-app-service'
import { agentAppActionParameters, validateAgentAppActionInput } from '../src/main/assistant/agent-app-action-inputs'

const directory = await mkdtemp(join(tmpdir(), 'zyra-agent-settings-'))
try {
    validateAgentAppActionInput(agentAppActionParameters('accounts.enabled'), { accountId: 'known', enabled: false })
    assert.throws(() => validateAgentAppActionInput(agentAppActionParameters('accounts.enabled'), { accountId: 'known', enabled: 'false' }), /Invalid named/)
    assert.throws(() => validateAgentAppActionInput(agentAppActionParameters('accounts.primary'), { accountId: 'known', ignoredField: true }), /Invalid named/)
    assert.throws(() => validateAgentAppActionInput(agentAppActionParameters('runtime.activate'), { arbitraryIpc: 'not-supported' }), /Invalid named/)
    validateAgentAppActionInput(agentAppActionParameters('runtime.activate'), {})
    const preferences = new DevicePreferencesService(join(directory, 'preferences.json'))
    const settings = new AgentSettings(preferences, { getHostedAiStatus: async () => ({ groqConfigured: true, geminiConfigured: false, persistenceAvailable: true, legacyMigrationComplete: true }) })
    const catalog = await settings.inspect({})
    assert.ok(catalog.settings.length > 100)
    assert.equal(catalog.settings.find(setting => setting.id === 'groqApiKey')?.configured, true)
    assert.equal(catalog.settings.find(setting => setting.id === 'groqApiKey')?.writable, false)
    assert.equal(catalog.settings.find(setting => setting.id === 'assistantDefaultModel')?.writable, false)
    assert.equal(catalog.settings.find(setting => setting.id === 'appearanceCodeScale')?.effectiveValue, 100)
    const preview = await settings.preview({ patch: { appearanceCodeScale: 115 } })
    assert.equal(preview.changes[0]?.after, 115)
    assert.equal((await preferences.get({ surface: 'desktop' })).revision, 0, 'preview has no persistence effect')
    await assert.rejects(settings.preview({ patch: { appearanceCodeScale: 200 } }), /Invalid value/)
    await assert.rejects(settings.preview({ patch: { assistantBusyMessageMode: 'force' } }), /Invalid value/)
    await assert.rejects(settings.preview({ patch: { groqApiKey: 'not-a-secret' } }), /not directly writable/)
    await assert.rejects(settings.preview({ patch: { assistantDefaultModel: 'other-model' } }), /not directly writable/)
    await assert.rejects(settings.apply({ expectedRevision: 0, patch: { assistantMemoryEnabled: true } }, false), /approval/)
    const receipts = new AppOperationReceipts(join(directory, 'receipts.json'))
    const request = { actor: 'chat', operationId: 'a'.repeat(64), domain: 'settings', operation: 'apply', params: { expectedRevision: 0, patch: { appearanceCodeScale: 115 } } }
    let applied = 0
    const work = () => { applied++; return settings.apply(request.params, false) }
    const [first, second] = await Promise.all([receipts.run(request, work), receipts.run(request, work)])
    assert.equal(applied, 1, 'same-ID concurrent delivery applies once')
    assert.equal(second.replayed, true)
    assert.equal(first.revision, 1)
    assert.equal(await preferences.getAssistantMemoryEnabled(), false, 'an ordinary settings write before UI migration cannot enable Memory')
    await assert.rejects(settings.apply({ expectedRevision: 0, patch: { appearanceCodeScale: 120 } }, false), /revision conflict/)
    await assert.rejects(receipts.run({ ...request, params: { patch: { appearanceCodeScale: 120 } } }, work), /reused/)
    const restarted = new AppOperationReceipts(join(directory, 'receipts.json'))
    assert.equal((await restarted.run(request, work)).replayed, true, 'receipts survive restart')
    const reverted = await settings.undo({ expectedRevision: 1, input: { operationId: request.operationId } }, 'chat', false, receipts)
    assert.equal(reverted.revision, 2)
    const afterUndo = await preferences.get({ surface: 'desktop' })
    assert.equal(afterUndo.savedKeys?.includes('appearanceCodeScale'), false, 'Undo restores unset ownership, not an invented saved default')
    assert.equal((await settings.inspect({ keys: ['appearanceCodeScale'] })).settings[0]?.effectiveValue, 100)
    await assert.rejects(settings.undo({ expectedRevision: 2, input: { operationId: request.operationId } }, 'chat', false, receipts), /Newer changes/)
    assert.equal(projectUsageWindow({ usedPercent: 0, resetAt: null, windowSeconds: 0 }), null)
    assert.equal(projectUsageWindow({ usedPercent: null, resetAt: null, windowSeconds: 3600 }), null)
    const window = projectUsageWindow({ usedPercent: 0, resetAt: new Date(120_000).toISOString(), windowSeconds: 3600 }, 'observed', 60_000)
    assert.equal(window?.remainingPercent, 100)
    assert.equal(window?.resetsInSeconds, 60)
    assert.equal(projectUsageWindow({ usedPercent: 88, windowSeconds: null, resetAt: null })?.remainingPercent, 12)
    assert.deepEqual(redactAppData({ accessToken: 'private', email: 'private', state: 'ready' }), { state: 'ready' })
    const uncertainFile = join(directory, 'uncertain.json')
    const uncertain = new AppOperationReceipts(uncertainFile)
    const internal = uncertain as unknown as { save(): Promise<void> }
    const save = internal.save.bind(uncertain)
    let saves = 0, sideEffects = 0
    internal.save = async () => { if (++saves === 2) throw new Error('synthetic durable completion failure'); await save() }
    const uncertainRequest = { ...request, operationId: 'b'.repeat(64) }
    const sideEffect = async () => { sideEffects++; return { applied: true } }
    await assert.rejects(uncertain.run(uncertainRequest, sideEffect), /receipt was not saved/)
    await assert.rejects(uncertain.run(uncertainRequest, sideEffect), /uncertain/)
    await assert.rejects(new AppOperationReceipts(uncertainFile).run(uncertainRequest, sideEffect), /uncertain/)
    assert.equal(sideEffects, 1, 'completion persistence failure cannot expose memory-only success or rerun effects')
    const failed = new AppOperationReceipts(join(directory, 'failed.json'))
    await assert.rejects(failed.run({ ...request, operationId: 'c'.repeat(64) }, async () => { throw new Error('provider body with synthetic-private-value') }))
    assert.ok(!(await readFile(join(directory, 'failed.json'), 'utf8')).includes('synthetic-private-value'), 'raw provider error bodies are not durable receipts')
    const retentionFile = join(directory, 'retention.json')
    const retention = new AppOperationReceipts(retentionFile)
    let retainedEffects = 0
    const retainedRequest = { ...request, operationId: 'd'.repeat(64) }
    await retention.run(retainedRequest, async () => { retainedEffects++; return { applied: true } })
    for (let index = 0; index < 501; index++) await retention.run({ ...request, operationId: index.toString(16).padStart(64, '0'), params: { index } }, async () => ({ applied: true }))
    assert.equal(JSON.parse(await readFile(retentionFile, 'utf8')).receipts.length, 500, 'result retention remains bounded')
    await assert.rejects(new AppOperationReceipts(retentionFile).run(retainedRequest, async () => { retainedEffects++; return { applied: true } }), /receipt expired/)
    assert.equal(retainedEffects, 1, 'pruning detailed history must never forget durable admission claims')
    const truncatedFile = join(directory, 'truncated.json')
    await writeFile(`${truncatedFile}.claims.jsonl`, (await readFile(`${retentionFile}.claims.jsonl`, 'utf8')).trimEnd())
    await assert.rejects(new AppOperationReceipts(truncatedFile).run({ ...request, operationId: 'e'.repeat(64) }, async () => { throw new Error('must not execute') }), /Incomplete durable/)
    const resetOwner = new DevicePreferencesService(join(directory, 'memory-reset.json'))
    const resetSettings = new AgentSettings(resetOwner, { getHostedAiStatus: async () => ({ groqConfigured: false, geminiConfigured: false, persistenceAvailable: true, legacyMigrationComplete: true }) })
    await resetOwner.update({ surface: 'desktop', expectedRevision: 0, patch: { appearanceCodeScale: 105 } })
    const resetPreview = await resetSettings.preview({ keys: ['assistantMemoryEnabled'] }, true)
    await resetSettings.apply({ keys: ['assistantMemoryEnabled'], expectedRevision: resetPreview.revision }, true, true)
    assert.equal(await resetOwner.getAssistantMemoryEnabled(), resetPreview.changes[0].after, 'reset preview describes the actual historical ownership fallback')
    console.log('Agent settings: actual owner defaults/schema, strict validation, preview/CAS, protected consent, durable exact-once receipts, safe Undo and honest quota windows passed')
} finally { await rm(directory, { recursive: true, force: true }) }
