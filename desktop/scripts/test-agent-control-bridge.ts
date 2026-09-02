import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

const driver = new FakeControlDriver()
const windowsDriver = new FakeControlDriver('windows-window')
const broker = new AgentControlBroker({ drivers: [driver, windowsDriver] })
const targetId = broker.targets.createTargetId('zyra-browser')
broker.registerTarget({ target: { kind: 'zyra-browser', targetId, tabId: 'browser:test', ownerThreadId: 'thread:test', guestIdentity: 'guest:test', origin: 'http://127.0.0.1' }, driver, trustedIdentity: {} })
const principal = { type: 'root' as const, threadId: 'thread:test', turnId: 'turn:test' }
const listed = await broker.handleToolOperation(principal, { operation: 'list_targets', targetKind: 'zyra-browser' })
assert.equal((listed.targets as unknown[]).length, 1)
const openedWindowsApp = await broker.handleToolOperation(principal, { operation: 'open_app', application: 'Fixture' }) as any
assert.equal(openedWindowsApp.applicationName, 'Fixture')
assert.equal(openedWindowsApp.windows.length, 1, 'opening a registered app returns its matching opaque window candidate')
broker.revokePrincipal(principal, 'Opening-only turn completed.')
assert.equal(windowsDriver.idleReleaseCallCount(), 1, 'an opening-only turn shuts down an unretained helper immediately')
const unselectedWindows = await broker.handleToolOperation(principal, { operation: 'list_windows' }) as any
assert.equal(unselectedWindows.windows[0].targetId, undefined, 'enumeration cannot select a Windows target implicitly')
await assert.rejects(() => broker.handleToolOperation({
    type: 'agent', fleetId: 'fleet:test', agentRunId: 'agent:test', parentThreadId: principal.threadId
}, {
    operation: 'request_grant',
    windowToken: unselectedWindows.windows[0].windowToken,
    capabilities: ['observe.structure']
}), /Child agents cannot select Windows targets/)
const windowRequestPromise = broker.handleToolOperation(principal, {
    operation: 'request_grant',
    windowToken: unselectedWindows.windows[0].windowToken,
    capabilities: ['observe.structure', 'keyboard.type'],
    durationMs: 30_000,
    maxActions: 3
}) as Promise<any>
await new Promise((resolve) => setImmediate(resolve))
const pendingWindow = broker.grants.listPending()[0]
assert(pendingWindow, 'an agent-selected Windows candidate must wait for approval in chat')
assert.equal(windowsDriver.retainedTargetCount(), 1, 'the on-demand helper remains available only while the task is pending or active')
const selectedWindow = broker.state().targets.find((entry) => entry.kind === 'windows-window')
assert(selectedWindow?.kind === 'windows-window')
assert.equal(selectedWindow.title, 'Fixture editor', 'the exact selected window is available to the chat approval surface')
const windowGrant = broker.approvePendingGrant({
    pendingRequestId: pendingWindow.requestId,
    targetId: pendingWindow.targetId,
    capabilities: pendingWindow.capabilities,
    durationMs: 30_000,
    maxActions: 3
})
const windowRequest = await windowRequestPromise
assert.equal(windowRequest.grant.grantId, windowGrant.grantId)
assert.equal(windowRequest.grant.targetId, selectedWindow.targetId, 'one request selects and grants the requested Windows target')
const repeatedSelection = await broker.selectWindow(unselectedWindows.windows[0].windowToken)
assert.equal(repeatedSelection.targetId, selectedWindow.targetId, 'selecting the same live window reuses its opaque target')
const selectedWindows = await broker.handleToolOperation(principal, { operation: 'list_windows' }) as any
assert.equal(selectedWindows.windows[0].targetId, selectedWindow.targetId, 'the selected target remains discoverable during the app session')
broker.revokeGrant(windowGrant.grantId)
assert.equal(windowsDriver.retainedTargetCount(), 0, 'ending the task releases the Windows helper lifecycle')
const requestPromise = broker.handleToolOperation(principal, {
    operation: 'request_grant', targetId, capabilities: ['observe.structure'], durationMs: 30_000, maxActions: 2
}) as Promise<any>
const pending = broker.grants.listPending()[0]
assert(pending, 'grant approval must remain pending while the model tool call waits')
const grant = broker.approvePendingGrant({ pendingRequestId: pending.requestId, targetId, capabilities: pending.capabilities, durationMs: 30_000, maxActions: 2 })
const request = await requestPromise
assert.equal(request.pending, false)
assert.equal(request.grant.grantId, grant.grantId)
const observed = await broker.handleToolOperation(principal, { operation: 'observe', grantId: grant.grantId, targetId }) as any
assert.equal(observed.observation.targetId, targetId)
await assert.rejects(() => broker.handleToolOperation({ ...principal, turnId: 'turn:forged' }, { operation: 'observe', grantId: grant.grantId, targetId }), /another principal/)
await assert.rejects(() => broker.handleToolOperation(principal, { operation: 'raw_cdp' }), (error: any) => error.code === 'CONTROL_UNKNOWN_OPERATION')
console.log('Agent control bounded bridge operations passed.')
