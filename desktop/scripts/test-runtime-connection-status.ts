import assert from 'node:assert/strict'
import { configureDesktopTerminalEnvironment, desktopNamespaceId, desktopTerminalEnvironment, resolveDesktopAgentServerNamespace } from '../src/main/assistant/agent-server-namespace'
import { getAgentServerPaths } from '../../src/agent-server/paths.mjs'
import { mobileListenerPort } from '../src/shared/mobile-access-policy'
import { configureRuntimeInstallation, publishRuntimeActivation, readRuntimeActivation } from '../src/main/assistant/runtime-activation'
import { runtimeConnectionPresentation } from '../src/shared/runtime-activation'
import { isBrowserDevscopeBridgePath, isBrowserDevscopeRelayEvent } from '../src/shared/browser-assistant-bridge'

const now = new Date().toISOString()
publishRuntimeActivation({ phase: 'waiting', connection: 'connected', lastConfirmedAt: now, updatePending: true,
    instance: { instanceId: 'server-a', namespaceId: 'store-a', channel: 'desktop', protocolVersion: 5, startedAt: now, runtimeRevision: 'a'.repeat(64) }
} as any)
assert.equal((readRuntimeActivation() as any).connection, 'connected', 'a compatible busy service remains observable during an update')
assert.equal((readRuntimeActivation() as any).instance.instanceId, 'server-a')
publishRuntimeActivation({ phase: 'failed', connection: 'disconnected', errorCode: 'AGENT_SERVER_DISCONNECTED' } as any)
assert.equal((readRuntimeActivation() as any).connection, 'disconnected', 'lost transport is not reported as ready or idle')
assert.equal((readRuntimeActivation() as any).lastConfirmedAt, now, 'disconnect retains the last confirmed observation')
configureRuntimeInstallation({ kind: 'development', label: 'Development-test' })
assert.equal(runtimeConnectionPresentation(readRuntimeActivation()).label, 'Development-test')
const live = { phase: 'ready' as const, connection: 'connected' as const, lastConfirmedAt: now }
assert.equal(runtimeConnectionPresentation(live, Date.parse(now)).tone, 'success')
assert.equal(runtimeConnectionPresentation({ ...live, updatePending: true }, Date.parse(now)).tone, 'warning')
assert.equal(runtimeConnectionPresentation(live, Date.parse(now) + 46_000).detail, 'Status stale')
assert.equal(runtimeConnectionPresentation({ ...live, connection: 'disconnected' }).tone, 'danger')
assert.equal(runtimeConnectionPresentation({ phase: 'ready' }).live, false, 'an old ready flag is not a fresh connection observation')
assert.equal(runtimeConnectionPresentation({ ...live, lastConfirmedAt: 'invalid' }).live, false)
assert.equal(isBrowserDevscopeBridgePath(['runtimeActivation', 'getState']), true)
assert.equal(isBrowserDevscopeBridgePath(['runtimeActivation', 'restart']), false, 'status relay grants no service lifecycle authority')
assert.equal(isBrowserDevscopeBridgePath(['runtimeActivation', 'activateUpdate']), false, 'browser cannot invoke Desktop runtime activation')
assert.equal(isBrowserDevscopeBridgePath(['runtimeActivation', 'refresh']), false, 'browser status observation does not grant reconnect authority')
for (const method of ['preflightInstall', 'deferInstall', 'installUpdate', 'resumePreviousAgent']) assert.equal(isBrowserDevscopeBridgePath(['updates', method]), false, 'installer lifecycle remains native-only')
assert.equal(isBrowserDevscopeBridgePath(['updates', 'getState']), true)
assert.equal(isBrowserDevscopeRelayEvent({ event: 'runtimeActivationChanged', payload: live }), true)
const copy = readRuntimeActivation()
copy.instance!.instanceId = 'not-the-owner'
assert.equal(readRuntimeActivation().instance!.instanceId, 'server-a', 'status consumers cannot mutate shared identity')
configureDesktopTerminalEnvironment('/fixture/Zyra-dev-worktree')
assert.deepEqual(desktopTerminalEnvironment(), {
    ZYRA_STATE_DIR: resolveDesktopAgentServerNamespace('/fixture/Zyra-dev-worktree').stateDirectory,
    ZYRA_AGENT_SERVER_CHANNEL: 'desktop'
})
assert.notEqual(desktopTerminalEnvironment().ZYRA_STATE_DIR, resolveDesktopAgentServerNamespace('/fixture/Zyra').stateDirectory)
assert.equal(desktopNamespaceId('/fixture/Zyra-dev-worktree'), getAgentServerPaths(resolveDesktopAgentServerNamespace('/fixture/Zyra-dev-worktree')).namespaceId, 'Desktop discovery and service handshakes use the same stable namespace identity')
assert.deepEqual(Object.keys(desktopTerminalEnvironment()).sort(), ['ZYRA_AGENT_SERVER_CHANNEL', 'ZYRA_STATE_DIR'], 'terminal discovery carries no Desktop authority proof')
assert.equal(mobileListenerPort(undefined, false), 47321)
assert.equal(mobileListenerPort(undefined, true), 0, 'development chooses its own port without blocking installed Zyra')
assert.equal(mobileListenerPort(51234, true), 51234, 'paired phones retain their saved listener address')
assert.throws(() => mobileListenerPort(-1, true), /Invalid/)
console.log('Runtime status, freshness, wordmark tones, browser relay and instance-bound terminals/mobile: ok')
