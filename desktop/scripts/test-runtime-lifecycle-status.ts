import assert from 'node:assert/strict'
import { runtimeLifecyclePresentation, type RuntimeActivationStatus } from '../src/shared/runtime-activation'
import { configureRuntimeInstallation, publishRuntimeActivation, readRuntimeActivation } from '../src/main/assistant/runtime-activation'

const now = Date.parse('2026-10-01T10:00:00.000Z')
const base: RuntimeActivationStatus = { phase: 'ready', connection: 'connected', lastConfirmedAt: new Date(now).toISOString(),
    expectedRuntimeRevision: 'b'.repeat(64), instance: { instanceId: 'server-one', namespaceId: 'namespace', channel: 'desktop',
        protocolVersion: 5, startedAt: new Date(now).toISOString(), runtimeRevision: 'b'.repeat(64) },
    activity: { activeTurns: 0, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 }
}
assert.equal(runtimeLifecyclePresentation(base, now).codeState, 'current')
assert.equal(runtimeLifecyclePresentation(base, now).canActivate, false)
const pending = { ...base, instance: { ...base.instance!, runtimeRevision: 'a'.repeat(64) } }
assert.equal(runtimeLifecyclePresentation(pending, now).codeState, 'pending', 'revision agreement is not inferred from a generic ready flag')
assert.equal(runtimeLifecyclePresentation(pending, now).canActivate, true)
const busy = { ...pending, activity: { ...base.activity!, activeTurns: 2, backgroundChats: 1 } }
assert.equal(runtimeLifecyclePresentation(busy, now).canActivate, false)
assert.deepEqual(runtimeLifecyclePresentation(busy, now).blockers, ['2 active turns', '1 background chat'])
assert.equal(runtimeLifecyclePresentation({ ...base, connection: 'disconnected' }, now).codeState, 'unknown')
assert.equal(runtimeLifecyclePresentation(base, now + 46_000).codeState, 'unknown', 'old observations cannot claim active code agreement')
assert.equal(runtimeLifecyclePresentation({ ...base, expectedRuntimeRevision: undefined }, now).codeState, 'unknown')
assert.equal(runtimeLifecyclePresentation({ ...base, activity: undefined }, now).blockers.length, 0)
assert.equal(runtimeLifecyclePresentation({ ...pending, activity: undefined }, now).canActivate, false, 'unknown counts are not proof of idle')
assert.equal(runtimeLifecyclePresentation({ ...pending, errorCode: 'AGENT_SERVER_AUTH_FAILED' }, now).canActivate, false)

configureRuntimeInstallation({ kind: 'installed', label: 'Preview', appVersion: '0.7.0-dev.42' })
publishRuntimeActivation({ ...busy, activity: { ...busy.activity, token: 'not-public', path: '/private' } } as any)
const projected = readRuntimeActivation()
assert.equal(projected.expectedRuntimeRevision, base.expectedRuntimeRevision)
assert.equal(projected.installation?.appVersion, '0.7.0-dev.42')
assert.deepEqual(Object.keys(projected.activity!).sort(), Object.keys(base.activity!).sort())
assert.ok(!JSON.stringify(projected).includes('not-public'))
publishRuntimeActivation({ ...base, activity: { ...base.activity, activeTurns: -1 } } as any)
assert.equal(readRuntimeActivation().activity, undefined, 'malformed blocker counts are unknown, not idle')
console.log('PASS runtime desired/active identity, freshness, blockers and sanitized status')
