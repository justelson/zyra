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
assert.equal(openedWindowsApp.launched, false, 'an already-running matching app is reused instead of opening a duplicate window')
assert.equal(openedWindowsApp.windows.length, 1, 'opening a registered app returns its matching opaque window candidate')
broker.revokePrincipal(principal, 'Opening-only turn completed.')
assert.equal(windowsDriver.idleReleaseCallCount(), 1, 'an opening-only turn shuts down an unretained helper immediately')
await assert.rejects(
    () => broker.handleToolOperation(principal, { operation: 'list_windows' }),
    /requires the application requested by the user/,
    'model-facing enumeration cannot expose unrelated ambient windows'
)
const unselectedWindows = await broker.handleToolOperation(principal, { operation: 'list_windows', query: 'Fixture' }) as any
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
    capabilities: ['observe.structure', 'pointer.click', 'keyboard.type', 'keyboard.key'],
    durationMs: 30_000,
    maxActions: 5
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
    maxActions: 5
})
const windowRequest = await windowRequestPromise
assert.equal(windowRequest.grant.grantId, windowGrant.grantId)
assert.equal(windowRequest.grant.targetId, selectedWindow.targetId, 'one request selects and grants the requested Windows target')
assert.equal(windowRequest.observation.revision, 1, 'Windows access returns the initial current observation without another model round trip')
await assert.rejects(() => broker.handleToolOperation(principal, {
    operation: 'act_sequence',
    version: 1,
    requestId: 'sequence:critical',
    grantId: windowGrant.grantId,
    targetId: selectedWindow.targetId,
    observationRevision: windowRequest.observation.revision,
    steps: [{ type: 'click', role: 'button', name: 'Confirm purchase', sideEffect: 'none' }]
}), /canonical side-effect review/, 'semantic sequences cannot bypass critical action review')
await assert.rejects(() => broker.handleToolOperation(principal, {
    operation: 'act_sequence',
    version: 1,
    requestId: 'sequence:sensitive',
    grantId: windowGrant.grantId,
    targetId: selectedWindow.targetId,
    observationRevision: windowRequest.observation.revision,
    steps: [{ type: 'type', name: 'Password', text: 'never', replace: true, sideEffect: 'none' }]
}), /found 0/, 'role-free exact-name resolution still excludes sensitive controls')
const sequence = await broker.handleToolOperation(principal, {
    operation: 'act_sequence',
    version: 1,
    requestId: 'sequence:test',
    grantId: windowGrant.grantId,
    targetId: selectedWindow.targetId,
    observationRevision: windowRequest.observation.revision,
    steps: [
        { type: 'type', role: 'edit', name: 'Smoke input', text: 'seed', replace: true, sideEffect: 'none' },
        { type: 'key', key: 'A', modifiers: ['Ctrl'], sideEffect: 'none' },
        { type: 'type', role: 'edit', name: 'Smoke input', text: 'replacement', replace: false, sideEffect: 'none' },
        { type: 'click', role: 'button', name: 'Apply smoke input', sideEffect: 'none' }
    ]
}) as any
assert.equal(sequence.completedSteps, 4)
assert.equal(sequence.observation.revision, 5, 'each semantic sequence step produces the next fresh observation internally')
const repeatedSelection = await broker.selectWindow(unselectedWindows.windows[0].windowToken)
assert.equal(repeatedSelection.targetId, selectedWindow.targetId, 'selecting the same live window reuses its opaque target')
const selectedWindows = await broker.handleToolOperation(principal, { operation: 'list_windows', query: 'Fixture' }) as any
assert.equal(selectedWindows.windows[0].targetId, selectedWindow.targetId, 'the selected target remains discoverable during the app session')
broker.revokeGrant(windowGrant.grantId)
assert.equal(windowsDriver.retainedTargetCount(), 0, 'ending the task releases the Windows helper lifecycle')
const directAppAccess = await broker.handleToolOperation(principal, {
    operation: 'use_app',
    application: 'Fixture',
    capabilities: ['observe.structure', 'pointer.click', 'keyboard.type'],
    durationMs: 30_000,
    maxActions: 3,
    requestId: 'use-app:sequence',
    steps: [
        { type: 'type', name: 'Smoke input', text: 'one call', replace: true, sideEffect: 'none' },
        { type: 'click', role: 'button', name: 'Apply smoke input', sideEffect: 'none' }
    ]
}, undefined, { permissionMode: 'full-access' }) as any
assert.equal(directAppAccess.launched, false, 'one-call app access reuses the exact running app')
assert.equal(directAppAccess.sequence.completedSteps, 2, 'one-call app access may run an already-clear routine sequence')
assert.equal(directAppAccess.sequence.previousRevision, 6, 'the embedded sequence starts from the granted initial observation')
assert.equal(directAppAccess.observation.revision, 8, 'the combined call returns its latest observation')
assert.deepEqual(directAppAccess.observation.elements.map((element: any) => element.name), ['Smoke input'], 'combined calls return changed, focused, and readback elements instead of repeating unchanged controls')
await assert.rejects(() => broker.handleToolOperation(principal, {
    operation: 'use_app',
    application: 'Fixture',
    capabilities: ['observe.structure', 'pointer.click'],
    durationMs: 30_000,
    maxActions: 3,
    requestId: 'use-app:critical',
    steps: [{ type: 'click', role: 'button', name: 'Confirm purchase', sideEffect: 'none' }]
}, undefined, { permissionMode: 'full-access' }), /canonical side-effect review/)
assert.notEqual(broker.grants.list().find((entry) => entry.grantId === directAppAccess.grant.grantId)?.state, 'active', 'new exact app access never leaves an older Windows grant active for the same turn')
assert.equal(windowsDriver.retainedTargetCount(), 0, 'a rejected embedded sequence revokes its otherwise unusable grant')
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
const expiringAccess = await broker.handleToolOperation(principal, {
    operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure'], durationMs: 1_000, maxActions: 2
}, undefined, { permissionMode: 'full-access' }) as any
assert.equal(windowsDriver.retainedTargetCount(), 1)
await new Promise((resolve) => setTimeout(resolve, 1_700))
assert.equal(expiringAccess.grant.state, 'expired', 'the broker expires idle grants without waiting for another read or action')
assert.equal(windowsDriver.retainedTargetCount(), 0, 'expiry releases the retained Windows helper target')
assert(broker.audit.list().some((event) => event.eventType === 'grant.expired' && event.grantId === expiringAccess.grant.grantId))
await broker.dispose()
console.log('Agent control bounded bridge operations passed.')
