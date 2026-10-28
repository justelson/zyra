import assert from 'node:assert/strict'
import { createInstallPreflight } from '../src/main/update/install-preflight'
let version: string | null = '0.8.0', prepares = 0, installs = 0, releases = 0, now = 1_000
const activity = { activeTurns: 1, backgroundChats: 2, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 }
let instance = 'instance-a', fail = false, hold: (() => void) | undefined
const controller = createInstallPreflight({ version: () => version, now: () => now,
    inspect: async () => ({ instance: { instanceId: instance, namespaceId: 'namespace-a' }, activity: { ...activity }, methods: ['server.prepareUpdate'] }),
    prepare: async input => { prepares++; assert.equal(input.expectedInstanceId, instance, 'confirmation is bound to observed instance'); if (hold) await new Promise<void>(resolve => { hold = resolve }); if (fail) throw new Error('Could not stop owned process') },
    release: async () => { releases++ }, install: () => { installs++ } })
let plan = await controller.inspect()
assert.equal(plan.agentServerUpdate, true, 'agent update is flagged before installer invocation')
assert.equal(plan.state, 'blocked'); assert.equal(prepares, 0); assert.equal(installs, 0)
await controller.defer(); assert.equal(prepares, 0, 'Later does not cancel work or schedule an installation')
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /expired/)
plan = await controller.inspect()
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: false }), /Stop/)
fail = true
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /Could not stop/)
assert.equal(installs, 0); assert.equal(releases, 1, 'failed preparation releases the maintenance lock')
fail = false; plan = await controller.inspect(); now += 61_000
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /expired/)
plan = await controller.inspect(); version = '0.8.1'
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /expired/)
plan = await controller.inspect(); hold = () => {}
const confirming = controller.confirm({ planId: plan.id, stopBlockers: true })
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /already running/)
await assert.rejects(controller.defer(), /already running/)
hold!(); await confirming
assert.equal(installs, 1)
await assert.rejects(controller.confirm({ planId: plan.id, stopBlockers: true }), /expired/)
version = null
await assert.rejects(controller.inspect(), /Download/)
console.log('PASS pre-install agent flag, Later, explicit stop consent, exact identity, expiry, single handoff and failure release')
