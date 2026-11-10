import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { BrowserSurfaceHost } from '../src/main/agent-control/browser-surface-host'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

const principal = { type: 'root' as const, threadId: 'thread:background', turnId: 'turn:background' }
const driver = new FakeControlDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const targetId = broker.targets.createTargetId('zyra-browser')
const target = { kind: 'zyra-browser' as const, targetId, tabId: 'browser:background', ownerThreadId: principal.threadId, guestIdentity: 'guest:background', origin: 'http://127.0.0.1', sessionMode: 'normal' as const }
broker.registerTarget({ target, driver, trustedIdentity: {} })
try {
    const unavailableInspector = new BrowserSurfaceHost({
        send: () => { throw new Error('Browser access must not require the selected chat or an open inspector') },
        resolveTarget: () => target
    })
    broker.setBrowserSurfaceController(unavailableInspector)
    try {
        for (const backgrounded of [true, false]) {
            for (const permissionMode of ['full-access', 'auto-review'] as const) {
                const access = await broker.handleToolOperation(principal, {
                    operation: 'request_grant', targetId, capabilities: ['observe.structure', 'pointer.click'], maxActions: 10
                }, undefined, { backgrounded, permissionMode }) as any
                assert(access.grant && access.observation, 'fresh Browser access and its first observation work without the inspector')
                broker.revokeGrant(access.grant.grantId, principal)
            }
        }
        const supervisedAccess = broker.handleToolOperation(principal, {
            operation: 'request_grant', targetId, capabilities: ['observe.structure', 'pointer.click'], maxActions: 10
        }, undefined, { backgrounded: true, permissionMode: 'approval-required' })
        const request = broker.state().pendingGrants[0]
        assert(request, 'Supervised still waits for an explicit chat approval while its browser stays hidden')
        broker.approvePendingGrant({ pendingRequestId: request.requestId, targetId, capabilities: request.capabilities, durationMs: 60000, maxActions: 10 })
        const approved = await supervisedAccess as any
        assert(approved.grant && approved.observation)
        broker.revokeGrant(approved.grant.grantId, principal)
        await assert.rejects(() => broker.handleToolOperation(principal, { operation: 'reveal_tab', targetId }), /open inspector/, 'explicit reveals still request the visible workspace')
    } finally {
        broker.setBrowserSurfaceController(null)
        unavailableInspector.dispose()
    }
    const request = broker.requestGrant({ principal, targetId, capabilities: ['observe.structure', 'pointer.click'], maxActions: 10 })
    const grant = broker.approvePendingGrant({ pendingRequestId: request.requestId, targetId, capabilities: request.capabilities, durationMs: 60000, maxActions: 10 })
    broker.revokeForegroundPrincipal(principal)
    const observed = await broker.handleToolOperation(principal, { operation: 'observe', targetId, grantId: grant.grantId }, undefined, { backgrounded: true }) as any
    const clicked = await broker.handleToolOperation(principal, {
        operation: 'act', version: 1, requestId: 'request:background', grantId: grant.grantId, targetId,
        observationRevision: observed.observation.revision, action: { type: 'click', elementRef: 'fixture:button' }
    }, undefined, { backgrounded: true }) as any
    assert(clicked.observation.revision > observed.observation.revision, 'background chats retain and use target-local Browser authority')
    const list = await broker.handleToolOperation(principal, { operation: 'list_targets' }, undefined, { backgrounded: true }) as any
    assert(list.targets.every((entry: any) => entry.kind === 'zyra-browser'))
    const chromeDriver = new FakeControlDriver('chrome-tab')
    const chromeId = broker.targets.createTargetId('chrome-tab')
    const chrome = { kind: 'chrome-tab' as const, targetId: chromeId, pairId: 'pair:fixture', tabToken: 'tab:fixture', origin: 'https://example.test', accessMode: 'control' as const }
    broker.registerTarget({ target: chrome, driver: chromeDriver, trustedIdentity: {} })
    const chromeGrantRequest = broker.requestGrant({ principal, targetId: chromeId, capabilities: ['observe.structure', 'pointer.click', 'tab.manage'], maxActions: 10 })
    const chromeGrant = broker.approvePendingGrant({ pendingRequestId: chromeGrantRequest.requestId, targetId: chromeId, capabilities: chromeGrantRequest.capabilities, durationMs: 60000, maxActions: 10 })
    broker.revokeForegroundPrincipal(principal)
    assert.equal(chromeGrant.state, 'active', 'switching chats retains exact paired Chrome grants')
    const chromeList = await broker.handleToolOperation(principal, { operation: 'list_targets', targetKind: 'chrome-tab' }, undefined, { backgrounded: true }) as any
    assert.equal(chromeList.targets[0].targetId, chromeId)
    const chromeObservation = await broker.handleToolOperation(principal, { operation: 'observe', targetId: chromeId, grantId: chromeGrant.grantId }, undefined, { backgrounded: true }) as any
    await broker.handleToolOperation(principal, { operation: 'act', version: 1, requestId: 'click:chrome', targetId: chromeId, grantId: chromeGrant.grantId,
        observationRevision: chromeObservation.observation.revision, action: { type: 'click', elementRef: 'fixture:button' } }, undefined, { backgrounded: true })
    let chromeOpens = 0
    Object.assign(chromeDriver, { openTab: async (_anchor: unknown, url: string) => {
        chromeOpens++; assert.equal(url, 'https://example.test/new')
        const newId = broker.targets.createTargetId('chrome-tab')
        broker.registerTarget({ target: { ...chrome, targetId: newId, tabToken: 'tab:new' }, driver: chromeDriver, trustedIdentity: {} })
        return newId
    } })
    const openedChrome = await broker.handleToolOperation(principal, { operation: 'open_tab', targetKind: 'chrome-tab', targetId: chromeId, grantId: chromeGrant.grantId, url: 'https://example.test/new' }, undefined, { backgrounded: true }) as any
    assert.equal(openedChrome.target.kind, 'chrome-tab', 'Chrome requests never substitute an in-app Browser tab')
    assert.equal(openedChrome.revealed, false)
    await assert.rejects(() => broker.handleToolOperation(principal, { operation: 'open_tab', targetKind: 'chrome-tab', targetId: chromeId, grantId: chromeGrant.grantId, url: 'https://outside.test/' }, undefined, { backgrounded: true }), { code: 'CONTROL_SCOPE_DENIED' })
    await assert.rejects(() => broker.handleToolOperation({ type: 'agent', fleetId: 'fleet:test', agentRunId: 'agent:test', parentThreadId: principal.threadId }, { operation: 'open_tab', targetKind: 'chrome-tab', targetId: chromeId, grantId: chromeGrant.grantId, url: 'https://example.test/new' }, undefined, { backgrounded: true }))
    await assert.rejects(() => broker.handleToolOperation({ ...principal, threadId: 'thread:other' }, { operation: 'open_tab', targetKind: 'chrome-tab', targetId: chromeId, grantId: chromeGrant.grantId, url: 'https://example.test/new' }, undefined, { backgrounded: true }))
    assert.equal(chromeOpens, 1, 'a foreign chat cannot use another chat’s grant')
    const inferred = await broker.handleToolOperation(principal, { operation: 'open_tab', grantId: chromeGrant.grantId, url: 'https://example.test/new' }, undefined, { backgrounded: true }) as any
    assert.equal(inferred.target.kind, 'chrome-tab', 'an exact Chrome grant cannot fall through to the in-app browser when targetKind is omitted')
    broker.revokePrincipal(principal)
    await assert.rejects(() => broker.handleToolOperation(principal, { operation: 'observe', targetId: chromeId, grantId: chromeGrant.grantId }, undefined, { backgrounded: true }), { code: 'CONTROL_GRANT_INACTIVE' })
    for (const operation of [{ operation: 'open_tab', reveal: true }, { operation: 'open_app', application: 'Notepad' }, { operation: 'reveal_tab', targetId }]) {
        await assert.rejects(() => broker.handleToolOperation(principal, operation, undefined, { backgrounded: true }), { code: 'CONTROL_FOREGROUND_REQUIRED' })
    }
    await assert.rejects(() => broker.handleToolOperation({ ...principal, threadId: 'thread:another' }, { operation: 'observe', targetId, grantId: grant.grantId }, undefined, { backgrounded: true }), { code: 'CONTROL_FOREGROUND_REQUIRED' })

    let sent = 0
    const hidden: any[] = []
    const surface = new BrowserSurfaceHost({
        send: () => { sent++ }, resolveTarget: () => target,
        executeHidden: async (request, signal) => {
            hidden.push(request)
            if (request.mode === 'refresh') await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
            return { ...target, tabId: request.tabId }
        }
    })
    try {
        await surface.openTab(principal, false, 'normal')
        await surface.commandTab(principal, target, 'navigate', 'http://127.0.0.1')
        assert.equal(sent, 0, 'hidden tabs and navigation do not depend on a selected chat renderer')
        assert(hidden.every(request => request.reveal === false))
        const controller = new AbortController()
        const pending = assert.rejects(surface.commandTab(principal, target, 'refresh', null, controller.signal), /cancelled/)
        controller.abort()
        await pending
        const stopping = assert.rejects(surface.commandTab(principal, target, 'refresh', null), /cancelled/)
        surface.cancelPending()
        await stopping
    } finally { surface.dispose() }

} finally { broker.dispose() }
console.log('Background Browser ownership, grants, hidden requests, focus restrictions and input cancellation: ok')
