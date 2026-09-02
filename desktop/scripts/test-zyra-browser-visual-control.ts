import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createBrowserControlTool } from '../../src/agent-control/browser-control-tool.mjs'
import { normalizeTemporaryBrowserOperation, startTemporaryBrowserRelay } from '../../src/agent-control/temporary-browser-relay.mjs'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { browserCdpKeyDescriptor, buildBrowserPointerPath } from '../src/main/agent-control/browser-input'
import { BrowserSurfaceHost } from '../src/main/agent-control/browser-surface-host'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'
import { ObservationStore } from '../src/main/agent-control/observation-store'
import { isTrustedBrowserTabId } from '../src/main/agent-control/trusted-guest-registry'
import { resolveZyraRoot } from '../src/main/zyra/zyra-root'
import { AssistantBrowserAgentCursor } from '../src/renderer/src/pages/assistant/AssistantBrowserAgentCursor'
import type { ControlTarget } from '../src/shared/agent-control/contracts'

const expectedRuntimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const inheritedZyraRoot = process.env.ZYRA_ROOT
try {
    process.env.ZYRA_ROOT = path.resolve(expectedRuntimeRoot, '..', '..', '..')
    assert.equal(resolveZyraRoot(), expectedRuntimeRoot, 'the loaded desktop worktree wins over a stale inherited ZYRA_ROOT')
} finally {
    if (inheritedZyraRoot === undefined) delete process.env.ZYRA_ROOT
    else process.env.ZYRA_ROOT = inheritedZyraRoot
}

assert.equal(isTrustedBrowserTabId('browser:8'), true)
assert.equal(isTrustedBrowserTabId('browser:agent:visual-open'), true, 'agent-created Browser tabs must pass the trusted binding boundary')
assert.equal(isTrustedBrowserTabId('browser:agent/escape'), false)
assert.deepEqual(browserCdpKeyDescriptor('DELETE'), {
    key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46
})
assert.equal(browserCdpKeyDescriptor('ESCAPE').key, 'Escape')
const pointerPath = buildBrowserPointerPath({ x: 10, y: 20 }, { x: 80, y: 90 }, 210)
assert(pointerPath.length > 2, 'visible pointer movement is emitted as acknowledged CDP steps')
assert.deepEqual(pointerPath.at(-1), { x: 80, y: 90 })
assert.throws(() => normalizeTemporaryBrowserOperation({ operation: 'list_windows' }), /not allowed/)
assert.throws(() => normalizeTemporaryBrowserOperation({ operation: 'observe', targetId: 'chrome-tab:1' }), /in-app Browser/)
assert.equal(
    (normalizeTemporaryBrowserOperation({ operation: 'observe', targetId: 'control-target:zyra-browser:1' }) as any).targetId,
    'control-target:zyra-browser:1'
)
const relayFlag = process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY
process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY = '1'
let relayedOperation: any
const relay = await startTemporaryBrowserRelay({
    threadId: 'thread:visual',
    controlClient: {
        request: async (operation: unknown) => {
            relayedOperation = operation
            return { targets: [] }
        }
    }
})
if (relayFlag === undefined) delete process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY
else process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY = relayFlag
assert(relay)
const relayDescriptor = JSON.parse(readFileSync(relay.descriptorFile, 'utf8'))
const unauthorizedRelayResponse = await fetch(`http://127.0.0.1:${relayDescriptor.port}/control`, { method: 'POST', body: '{}' })
assert.equal(unauthorizedRelayResponse.status, 401)
const relayResponse = await fetch(`http://127.0.0.1:${relayDescriptor.port}/control`, {
    method: 'POST',
    headers: { authorization: `Bearer ${relayDescriptor.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation: { operation: 'list_targets', targetKind: 'chrome-tab' } })
})
assert.equal(relayResponse.status, 200)
assert.deepEqual(relayedOperation, { operation: 'list_targets', targetKind: 'zyra-browser' })
relay.stop()
assert.equal(existsSync(relay.descriptorFile), false)

const policyDirectory = mkdtempSync(path.join(os.tmpdir(), 'zyra-browser-relay-policy-'))
const policyPath = path.join(policyDirectory, 'policy.mjs')
const writePolicy = (targetKind: string) => writeFileSync(
    policyPath,
    `export function normalizeTemporaryBrowserOperation(){ return { operation: 'list_targets', targetKind: ${JSON.stringify(targetKind)} }; }\n`
)
writePolicy('version-one')
process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY = '1'
let hotRelayedOperation: any
const hotRelay = await startTemporaryBrowserRelay({
    threadId: 'thread:hot-policy',
    policyPath,
    controlClient: { request: async (operation: unknown) => { hotRelayedOperation = operation; return {} } }
})
if (relayFlag === undefined) delete process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY
else process.env.ZYRA_ENABLE_TEMP_BROWSER_RELAY = relayFlag
assert(hotRelay)
const hotDescriptor = JSON.parse(readFileSync(hotRelay.descriptorFile, 'utf8'))
const postHotPolicy = async () => {
    const response = await fetch(`http://127.0.0.1:${hotDescriptor.port}/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hotDescriptor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: { operation: 'list_targets' } })
    })
    assert.equal(response.status, 200)
}
await postHotPolicy()
assert.equal(hotRelayedOperation.targetKind, 'version-one')
writePolicy('version-two-without-restart')
await postHotPolicy()
assert.equal(hotRelayedOperation.targetKind, 'version-two-without-restart')
hotRelay.stop()
rmSync(policyDirectory, { recursive: true, force: true })

const driver = new FakeControlDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const targetId = broker.targets.createTargetId('zyra-browser')
broker.registerTarget({
    target: { kind: 'zyra-browser', targetId, tabId: 'browser:visual', sessionMode: 'normal', ownerThreadId: 'thread:visual', guestIdentity: 'guest:visual', origin: 'http://127.0.0.1' },
    driver,
    trustedIdentity: {}
})
const principal = { type: 'root' as const, threadId: 'thread:visual', turnId: 'turn:visual' }
const pending = broker.requestGrant({
    principal,
    targetId,
    capabilities: ['observe.structure', 'observe.screenshot', 'pointer.move', 'pointer.click', 'pointer.drag'],
    maxActions: 20
})
const grant = broker.approvePendingGrant({
    pendingRequestId: pending.requestId,
    targetId,
    capabilities: pending.capabilities,
    durationMs: 60_000,
    maxActions: 20
})
const client = { request: (operation: unknown, options: { signal?: AbortSignal } = {}) => broker.handleToolOperation(principal, operation, options.signal) }
const tool = createBrowserControlTool({ client })

const surfaceRequests: any[] = []
const openedTargets = new Map<string, any>()
const surfaceHost = new BrowserSurfaceHost({
    send: (request) => surfaceRequests.push(request),
    resolveTarget: (openedTargetId) => {
        const opened = openedTargets.get(openedTargetId)
        if (!opened) throw new Error('missing target')
        return opened
    },
    makeId: () => 'visual-open',
    timeoutMs: 2_000
})
const openedPromise = surfaceHost.openTab(principal, true, 'incognito')
assert.deepEqual(surfaceRequests[0] && {
    requestId: surfaceRequests[0].requestId,
    threadId: surfaceRequests[0].threadId,
    tabId: surfaceRequests[0].tabId,
    sessionMode: surfaceRequests[0].sessionMode,
    reveal: surfaceRequests[0].reveal
}, {
    requestId: 'browser-open:visual-open',
    threadId: principal.threadId,
    tabId: 'browser:agent:visual-open',
    sessionMode: 'incognito',
    reveal: true
})
const openedTarget = {
    kind: 'zyra-browser' as const,
    targetId: 'zyra-browser:opened',
    tabId: surfaceRequests[0].tabId,
    sessionMode: 'incognito' as const,
    ownerThreadId: principal.threadId,
    guestIdentity: 'guest:opened',
    origin: null
}
openedTargets.set(openedTarget.targetId, openedTarget)
const openAcknowledgement = {
    requestId: surfaceRequests[0].requestId,
    threadId: surfaceRequests[0].threadId,
    tabId: surfaceRequests[0].tabId
}
assert.equal(surfaceHost.acknowledge(openAcknowledgement), true)
assert.equal(surfaceHost.acknowledge(openAcknowledgement), false)
assert.equal(surfaceHost.completeRegisteredTarget({ ...openedTarget, ownerThreadId: 'thread:other' }), false, 'tab registration cannot settle another thread\'s open request')
assert.equal(surfaceHost.completeRegisteredTarget(openedTarget), true)
assert.equal((await openedPromise).targetId, openedTarget.targetId)
assert.equal(surfaceHost.complete({
    ...openAcknowledgement,
    success: true,
    targetId: openedTarget.targetId
}), false)
surfaceHost.dispose()

const delayedSurfaceRequests: any[] = []
const delayedSurfaceHost = new BrowserSurfaceHost({
    send: (request) => delayedSurfaceRequests.push(request),
    resolveTarget: () => { throw new Error('registration completion should use the trusted target directly') },
    makeId: () => 'delayed-visual-open',
    timeoutMs: 1_000
})
const delayedOpenedPromise = delayedSurfaceHost.openTab(principal, false, 'incognito')
await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
assert.equal(delayedSurfaceHost.acknowledge({
    requestId: delayedSurfaceRequests[0].requestId,
    threadId: delayedSurfaceRequests[0].threadId,
    tabId: delayedSurfaceRequests[0].tabId
}), true)
await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))
const delayedOpenedTarget = {
    ...openedTarget,
    targetId: 'zyra-browser:delayed-opened',
    tabId: delayedSurfaceRequests[0].tabId
}
assert.equal(delayedSurfaceHost.completeRegisteredTarget(delayedOpenedTarget), true)
assert.equal((await delayedOpenedPromise).targetId, delayedOpenedTarget.targetId)
delayedSurfaceHost.dispose()

const managedSurfaceRequests: any[] = []
const cancelledManagedSurfaceRequests: string[] = []
const managedTargets = new Map<string, any>()
let managedSurfaceSequence = 0
const managedSurfaceHost = new BrowserSurfaceHost({
    send: (request) => managedSurfaceRequests.push(request),
    cancel: (requestId) => cancelledManagedSurfaceRequests.push(requestId),
    resolveTarget: (managedTargetId) => {
        const target = managedTargets.get(managedTargetId)
        if (!target) throw new Error('missing managed target')
        return target
    },
    makeId: () => `managed-${managedSurfaceSequence++}`,
    timeoutMs: 2_000
})
const managedPrimary = { ...openedTarget, targetId: 'zyra-browser:managed-primary', tabId: 'browser:managed-primary' }
const managedSecondary = { ...openedTarget, targetId: 'zyra-browser:managed-secondary', tabId: 'browser:managed-secondary' }
managedTargets.set(managedPrimary.targetId, managedPrimary)
managedTargets.set(managedSecondary.targetId, managedSecondary)
const completeManagedRequest = async (promise: Promise<any>, request: any, target: any) => {
    assert.equal(managedSurfaceHost.acknowledge(request), true)
    if (['close', 'refresh', 'external'].includes(request.mode)) assert.equal(managedSurfaceHost.claim(request), true)
    assert.equal(managedSurfaceHost.complete({ ...request, success: true, targetId: target.targetId }), true)
    assert.equal((await promise).targetId, target.targetId)
}
const revealExistingPromise = managedSurfaceHost.revealTabs(principal, managedPrimary, null)
assert.equal(managedSurfaceRequests.at(-1)?.mode, 'reveal')
await completeManagedRequest(revealExistingPromise, managedSurfaceRequests.at(-1), managedPrimary)
const splitExistingPromise = managedSurfaceHost.revealTabs(principal, managedPrimary, managedSecondary)
assert.equal(managedSurfaceRequests.at(-1)?.secondaryTabId, managedSecondary.tabId)
await completeManagedRequest(splitExistingPromise, managedSurfaceRequests.at(-1), managedPrimary)
const singleLayoutPromise = managedSurfaceHost.revealTabs(principal, managedPrimary, null, undefined, true)
assert.equal(managedSurfaceRequests.at(-1)?.mode, 'layout', 'explicit single layout must clear a retained split instead of routing as reveal')
await completeManagedRequest(singleLayoutPromise, managedSurfaceRequests.at(-1), managedPrimary)
const resizeInspectorPromise = managedSurfaceHost.resizeInspector(principal, managedPrimary, 720)
const resizeInspectorRequest = managedSurfaceRequests.at(-1)
assert.equal(resizeInspectorRequest?.mode, 'resize')
assert.equal(resizeInspectorRequest?.width, 720)
assert.equal(managedSurfaceHost.acknowledge(resizeInspectorRequest), true)
assert.equal(managedSurfaceHost.complete({ ...resizeInspectorRequest, success: true, targetId: managedPrimary.targetId, width: 680 }), true)
assert.deepEqual(await resizeInspectorPromise, { target: managedPrimary, width: 680 })
const closeExistingPromise = managedSurfaceHost.closeTab(principal, managedPrimary)
assert.equal(managedSurfaceRequests.at(-1)?.mode, 'close')
await completeManagedRequest(closeExistingPromise, managedSurfaceRequests.at(-1), managedPrimary)
const externalExistingPromise = managedSurfaceHost.commandTab(principal, managedPrimary, 'external', 'https://example.com/')
assert.equal(managedSurfaceRequests.at(-1)?.url, 'https://example.com/')
await completeManagedRequest(externalExistingPromise, managedSurfaceRequests.at(-1), managedPrimary)
const cancelledRefreshPromise = managedSurfaceHost.commandTab(principal, managedPrimary, 'refresh', null)
const cancelledRefreshRequest = managedSurfaceRequests.at(-1)
assert.equal(managedSurfaceHost.acknowledge(cancelledRefreshRequest), true)
managedSurfaceHost.cancelPending('turn cancelled before claim')
await assert.rejects(cancelledRefreshPromise, (error: any) => error.code === 'CONTROL_CANCELLED')
assert.deepEqual(cancelledManagedSurfaceRequests, [cancelledRefreshRequest.requestId], 'unclaimed Browser commands notify the renderer when cancellation wins')
const mismatchedRevealPromise = managedSurfaceHost.revealTabs(principal, managedPrimary, null)
const mismatchedRevealRequest = managedSurfaceRequests.at(-1)
assert.equal(managedSurfaceHost.acknowledge(mismatchedRevealRequest), true)
assert.equal(managedSurfaceHost.complete({ ...mismatchedRevealRequest, success: true, targetId: managedSecondary.targetId }), true)
await assert.rejects(mismatchedRevealPromise, (error: any) => error.code === 'CONTROL_SCOPE_DENIED', 'surface completion cannot substitute another trusted target ID')
const concurrentRevealA = managedSurfaceHost.revealTabs(principal, managedPrimary, null)
const concurrentRequestA = managedSurfaceRequests.at(-1)
const concurrentRevealB = managedSurfaceHost.revealTabs(principal, managedPrimary, null)
const concurrentRequestB = managedSurfaceRequests.at(-1)
assert.equal(managedSurfaceHost.acknowledge(concurrentRequestA), true)
assert.equal(managedSurfaceHost.acknowledge(concurrentRequestB), true)
assert.equal(managedSurfaceHost.complete({ ...concurrentRequestB, success: true, targetId: managedPrimary.targetId }), true)
assert.equal((await concurrentRevealB).targetId, managedPrimary.targetId, 'same-tab completion resolves the exact request ID')
assert.equal(managedSurfaceHost.complete({ ...concurrentRequestA, success: true, targetId: managedPrimary.targetId }), true)
assert.equal((await concurrentRevealA).targetId, managedPrimary.targetId)
managedSurfaceHost.dispose()

const revealedBrowserLayouts: Array<{ primary: string; secondary: string | null; explicitLayout: boolean }> = []
const resizedInspectorWidths: number[] = []
const closedBrowserTabs: string[] = []
const browserTabCommands: Array<{ targetId: string; mode: string; url: string | null }> = []
const openedBrowserSessionModes: string[] = []
broker.setBrowserSurfaceController({
    openTab: async (_requestPrincipal, reveal, sessionMode) => {
        assert.equal(reveal, true)
        openedBrowserSessionModes.push(sessionMode)
        return broker.targets.get(targetId).target as Extract<ControlTarget, { kind: 'zyra-browser' }>
    },
    revealTabs: async (_requestPrincipal, primary, secondary, _signal, explicitLayout) => {
        revealedBrowserLayouts.push({ primary: primary.targetId, secondary: secondary?.targetId || null, explicitLayout: Boolean(explicitLayout) })
        return primary
    },
    resizeInspector: async (_requestPrincipal, target, width) => {
        resizedInspectorWidths.push(width)
        return { target, width }
    },
    closeTab: async (_requestPrincipal, target) => {
        closedBrowserTabs.push(target.targetId)
        return target
    },
    commandTab: async (_requestPrincipal, target, mode, url) => {
        browserTabCommands.push({ targetId: target.targetId, mode, url })
        return target
    },
    cancelPending: () => undefined
})
const openedByTool = await tool.execute('visual-open-tab', { operation: 'open_tab', reveal: true })
assert.equal((openedByTool.details as any).target.targetId, targetId)
assert.deepEqual(openedBrowserSessionModes, ['incognito'], 'agent-opened Browser tabs default to private storage')
assert.match(String(openedByTool.content[0]?.text), /no navigation or input authority yet/i)
await tool.execute('visual-open-normal-tab', { operation: 'open_tab', reveal: true, sessionMode: 'normal' })
assert.deepEqual(openedBrowserSessionModes, ['incognito', 'normal'], 'agents can explicitly request a normal tab when persistent site state is required')
const modelGrantPromise = tool.execute('visual-request-grant', {
    operation: 'request_grant', targetId, capabilities: ['observe.structure'], maxActions: 2
})
await Promise.resolve()
const modelPending = broker.grants.listPending().find((entry) => entry.principal.type === 'root')
assert(modelPending, 'the model tool call must wait while the approval is visible')
const modelGrant = broker.approvePendingGrant({
    pendingRequestId: modelPending.requestId,
    targetId,
    capabilities: modelPending.capabilities,
    durationMs: 30_000,
    maxActions: 2,
    allowedOrigins: modelPending.allowedOrigins
})
const modelGrantResult = await modelGrantPromise
assert.equal((modelGrantResult.details as any).grant.grantId, modelGrant.grantId)
assert.match(String(modelGrantResult.content[0]?.text), new RegExp(modelGrant.grantId))
broker.revokeGrant(modelGrant.grantId, principal)
await assert.rejects(
    broker.handleToolOperation(principal, { operation: 'open_tab', reveal: 'yes' }),
    (error: any) => error.code === 'CONTROL_VALIDATION_ERROR'
)
await assert.rejects(
    broker.handleToolOperation(principal, { operation: 'open_tab', sessionMode: 'private' }),
    (error: any) => error.code === 'CONTROL_VALIDATION_ERROR'
)

const observed = await tool.execute('visual-observe', {
    operation: 'observe', grantId: grant.grantId, targetId, includeScreenshot: true
})
assert.equal(observed.content[0]?.type, 'text')
assert.equal(observed.content[1]?.type, 'image')
assert.equal(observed.content[1]?.mimeType, 'image/png')
const firstRevision = (observed.details as any).observation.revision

const clicked = await tool.execute('visual-click', {
    operation: 'click', grantId: grant.grantId, targetId, observationRevision: firstRevision, x: 320, y: 220
})
assert.equal((clicked.details as any).observation.revision, firstRevision + 1)
let cursor = broker.state().cursors.find((entry) => entry.targetId === targetId)
assert.deepEqual(cursor && { x: cursor.x, y: cursor.y, phase: cursor.phase }, { x: 320, y: 220, phase: 'pressing' })

const dragged = await tool.execute('visual-drag', {
    operation: 'drag', grantId: grant.grantId, targetId,
    observationRevision: (clicked.details as any).observation.revision,
    fromX: 320, fromY: 220, toX: 470, toY: 330, durationMs: 260
})
assert.equal((dragged.details as any).observation.revision, firstRevision + 2)
cursor = broker.state().cursors.find((entry) => entry.targetId === targetId)
assert.deepEqual(cursor && { x: cursor.x, y: cursor.y, phase: cursor.phase }, { x: 470, y: 330, phase: 'idle' })
assert.match(renderToStaticMarkup(createElement(AssistantBrowserAgentCursor, { cursor: cursor || null })), /Zyra Browser cursor/)

const races = new ObservationStore()
const base = {
    version: 1 as const,
    observationId: 'race',
    targetId: 'target:race',
    capturedAt: new Date().toISOString(),
    targetState: 'ready' as const,
    elements: [],
    redactions: []
}
const older = races.nextRevision(base.targetId)
const newer = races.nextRevision(base.targetId)
races.set({ ...base, observationId: 'newer', revision: newer })
races.set({ ...base, observationId: 'older', revision: older })
assert.equal(races.currentRevision(base.targetId), newer)
assert.throws(() => races.requireRevision(base.targetId, older), (error: any) => error.code === 'CONTROL_STALE_OBSERVATION')

const otherThreadTargetId = broker.targets.createTargetId('zyra-browser')
broker.registerTarget({
    target: {
        kind: 'zyra-browser', targetId: otherThreadTargetId, tabId: 'browser:other-thread', sessionMode: 'normal', ownerThreadId: 'thread:other',
        guestIdentity: 'guest:other-thread', origin: 'https://other.example'
    },
    driver,
    trustedIdentity: {}
})
const childPrincipal = { type: 'agent' as const, fleetId: 'fleet:visual', agentRunId: 'agent:visual', parentThreadId: 'thread:visual' }
await assert.rejects(
    broker.handleToolOperation(childPrincipal, { operation: 'open_tab', reveal: true }),
    (error: any) => error.code === 'CONTROL_CAPABILITY_DENIED'
)
await assert.rejects(
    broker.handleToolOperation(childPrincipal, { operation: 'resize_inspector', targetId, width: 720 }),
    (error: any) => error.code === 'CONTROL_CAPABILITY_DENIED'
)
const discovered = await broker.handleToolOperation(childPrincipal, { operation: 'list_targets', targetKind: 'zyra-browser' })
assert.equal((discovered.targets as unknown[]).length, 1, 'children discover only Browser targets owned by their parent thread')
assert.equal((discovered.grants as unknown[]).length, 0)
await assert.rejects(
    broker.handleToolOperation(childPrincipal, {
        operation: 'request_grant', targetId: otherThreadTargetId, capabilities: ['observe.structure'], maxActions: 2
    }),
    (error: any) => error.code === 'CONTROL_SCOPE_DENIED',
    'children cannot request authority over another thread\'s Browser tab'
)
const childGrantPromise = broker.handleToolOperation(childPrincipal, {
    operation: 'request_grant', targetId, capabilities: ['observe.structure', 'observe.screenshot', 'pointer.click'], maxActions: 8
}) as Promise<any>
const childPending = broker.grants.listPending().find((entry) => entry.principal.type === 'agent' && entry.principal.agentRunId === childPrincipal.agentRunId)
assert(childPending, 'the model-facing grant request must remain pending while the tool call waits')
const childGrant = broker.approvePendingGrant({
    pendingRequestId: childPending.requestId,
    targetId,
    capabilities: childPending.capabilities,
    durationMs: 30_000,
    maxActions: 8,
    allowedOrigins: childPending.allowedOrigins
})
const childRequest = await childGrantPromise
assert.equal(childRequest.pending, false)
assert.equal(childRequest.grant.grantId, childGrant.grantId, 'approval must resume the same model tool call with the exact grant')
const attached = await broker.handleToolOperation(childPrincipal, { operation: 'list_targets', targetKind: 'zyra-browser' })
assert.equal((attached.grants as Array<{ grantId: string }>)[0]?.grantId, childGrant.grantId)
const cancelledGrantPromise = broker.handleToolOperation(childPrincipal, {
    operation: 'request_grant', targetId, capabilities: ['observe.structure'], maxActions: 2
})
broker.revokePrincipal(childPrincipal, 'agent finished')
await assert.rejects(cancelledGrantPromise, (error: any) => error.code === 'CONTROL_CANCELLED')
assert.equal(broker.grants.listForPrincipal(childPrincipal).some((entry) => entry.state === 'active'), false)
assert.equal(broker.grants.listPending().some((entry) => entry.principal.type === 'agent' && entry.principal.agentRunId === childPrincipal.agentRunId), false)

const secondaryTargetId = broker.targets.createTargetId('zyra-browser')
broker.registerTarget({
    target: {
        kind: 'zyra-browser', targetId: secondaryTargetId, tabId: 'browser:secondary', sessionMode: 'normal', ownerThreadId: principal.threadId, guestIdentity: 'guest:secondary',
        origin: 'https://secondary.example', url: 'https://secondary.example/', title: 'Secondary'
    },
    driver,
    trustedIdentity: {}
})
broker.updateWorkspaceState({
    version: 1,
    threadId: principal.threadId,
    inspector: { open: true, width: 640, activeWorkspace: 'browser', openWorkspaces: ['review', 'browser'] },
    browser: {
        open: true,
        activeTabId: 'browser:visual',
        splitTabId: 'browser:secondary',
        visibleTabIds: ['renderer-values-are-derived'],
        tabs: [
            { tabId: 'browser:visual', sessionMode: 'normal', targetId, url: 'http://127.0.0.1/', title: 'Primary', origin: null, status: 'ready', position: null, visible: false },
            { tabId: 'browser:secondary', sessionMode: 'normal', targetId: secondaryTargetId, url: 'https://secondary.example/', title: 'Secondary', origin: null, status: 'ready', position: null, visible: false },
            { tabId: 'browser:forged', sessionMode: 'incognito', targetId: secondaryTargetId, url: 'https://forged.example/', title: 'Forged', origin: null, status: 'ready', position: null, visible: false }
        ]
    },
    updatedAt: new Date().toISOString()
})
const workspaceListing = await broker.handleToolOperation(principal, { operation: 'list_targets', targetKind: 'zyra-browser' }) as any
assert.deepEqual(workspaceListing.workspace.browser.visibleTabIds, ['browser:visual', 'browser:secondary'], 'the broker derives visible Browser tabs from trusted Inspector layout state')
assert.equal(workspaceListing.workspace.browser.tabs[1].position, 'secondary')
assert.equal(workspaceListing.workspace.inspector.width, 640, 'the model sees the accepted Inspector width')
assert.equal(workspaceListing.workspace.browser.tabs[2].targetId, null, 'renderer layout metadata cannot rebind a trusted target to a different tab identity')
assert.equal(workspaceListing.workspace.browser.tabs[2].trusted, false, 'unbound renderer tab metadata is explicitly marked untrusted')
const modelWorkspaceListing = await tool.execute('visual-list-workspace', { operation: 'list_targets' })
assert.match(String(modelWorkspaceListing.content[0]?.text), /visible workspace state/)
assert.match(String(modelWorkspaceListing.content[0]?.text), /browser:secondary/, 'the model-facing tool receives open sites and visible pane identity')
await broker.handleToolOperation(principal, { operation: 'reveal_tab', targetId })
await broker.handleToolOperation(principal, { operation: 'set_tab_layout', primaryTargetId: targetId })
await broker.handleToolOperation(principal, { operation: 'set_tab_layout', primaryTargetId: targetId, secondaryTargetId })
assert.deepEqual(revealedBrowserLayouts.slice(-3), [
    { primary: targetId, secondary: null, explicitLayout: false },
    { primary: targetId, secondary: null, explicitLayout: true },
    { primary: targetId, secondary: secondaryTargetId, explicitLayout: true }
])
await broker.handleToolOperation(principal, { operation: 'resize_inspector', targetId, width: 720 })
const clampedInspectorResize = await broker.handleToolOperation(principal, { operation: 'resize_inspector', targetId, width: 10 })
assert.equal(clampedInspectorResize.requestedWidth, 340)
assert.equal(clampedInspectorResize.width, 340)
assert.deepEqual(resizedInspectorWidths, [720, 340])

await assert.rejects(
    broker.handleToolOperation(principal, { operation: 'close_tab', targetId, grantId: grant.grantId }),
    (error: any) => error.code === 'CONTROL_CAPABILITY_DENIED',
    'closing an existing Browser tab requires explicit tab.manage authority'
)
const managedPending = broker.requestGrant({
    principal,
    targetId,
    capabilities: ['navigate', 'tab.manage'],
    durationMs: 60_000,
    maxActions: 10,
    allowedOrigins: ['http://127.0.0.1']
})
const managedGrant = broker.approvePendingGrant({
    pendingRequestId: managedPending.requestId,
    targetId,
    capabilities: managedPending.capabilities,
    durationMs: 60_000,
    maxActions: 10,
    allowedOrigins: managedPending.allowedOrigins
})
const secondaryPending = broker.requestGrant({ principal, targetId: secondaryTargetId, capabilities: ['observe.structure'], maxActions: 2 })
const secondaryGrant = broker.approvePendingGrant({
    pendingRequestId: secondaryPending.requestId,
    targetId: secondaryTargetId,
    capabilities: secondaryPending.capabilities,
    durationMs: 30_000,
    maxActions: 2,
    allowedOrigins: secondaryPending.allowedOrigins
})
const multiGrantListing = await broker.handleToolOperation(principal, { operation: 'list_targets', targetKind: 'zyra-browser' }) as any
assert(multiGrantListing.grants.some((entry: { grantId: string }) => entry.grantId === managedGrant.grantId))
assert(multiGrantListing.grants.some((entry: { grantId: string }) => entry.grantId === secondaryGrant.grantId), 'one principal may hold independent bounded grants for multiple Browser tabs')

await broker.handleToolOperation(principal, { operation: 'refresh_tab', targetId, grantId: managedGrant.grantId })
await assert.rejects(
    broker.handleToolOperation(principal, {
        operation: 'open_external', targetId, grantId: managedGrant.grantId, url: 'https://outside.example/'
    }),
    (error: any) => error.code === 'CONTROL_SCOPE_DENIED'
)
await broker.handleToolOperation(principal, {
    operation: 'open_external', targetId, grantId: managedGrant.grantId, url: 'http://127.0.0.1/external'
})
await broker.handleToolOperation(principal, { operation: 'close_tab', targetId, grantId: managedGrant.grantId })
assert.deepEqual(browserTabCommands.map((entry) => entry.mode), ['refresh', 'external'])
assert.equal(browserTabCommands.at(-1)?.url, 'http://127.0.0.1/external')
assert.deepEqual(closedBrowserTabs, [targetId])
assert.equal(broker.grants.list().find((entry) => entry.grantId === managedGrant.grantId)?.state, 'revoked', 'closing a Browser tab immediately ends its tab-management authority')

await broker.emergencyStop()
assert.equal(broker.state().cursors.length, 0)

const pageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const surfaceRequestsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantBrowserSurfaceRequests.ts', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantDiffPanel.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx', import.meta.url), 'utf8')
const webviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWebview.tsx', import.meta.url), 'utf8')
const viewportFrameSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserViewportFrame.tsx', import.meta.url), 'utf8')
const agentCursorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserAgentCursor.tsx', import.meta.url), 'utf8')
const handlerSource = readFileSync(new URL('../src/main/ipc/handlers/agent-control-handlers.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../src/preload/adapters/agent-control-adapter.ts', import.meta.url), 'utf8')
const protocolSource = readFileSync(new URL('../src/shared/agent-control/protocol.ts', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../src/main/agent-control/browser-surface-host.ts', import.meta.url), 'utf8')
const browserDriverSource = readFileSync(new URL('../src/main/agent-control/drivers/zyra-browser-driver.ts', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const browserViewManagerSource = readFileSync(new URL('../src/main/browser-view-manager.ts', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
assert(surfaceRequestsSource.includes('onBrowserSurfaceRequest'))
assert(surfaceRequestsSource.includes('request.threadId !== threadRef.current'))
assert(surfaceRequestsSource.includes('if (request.reveal) revealInspector()'))
assert(surfaceRequestsSource.includes('onBrowserSurfaceCancel'))
assert(surfaceRequestsSource.includes("request.mode === 'resize'"))
assert(surfaceRequestsSource.includes('threadRef.current !== request.threadId'))
assert(pageSource.includes('setRightSidebarWidth(width)'))
assert(surfaceRequestsSource.includes('waitForAppliedInspectorWidth(request, previousWidth)'))
assert(surfaceRequestsSource.includes('width: appliedWidth'))
assert(panelSource.includes('processedBrowserSurfaceRequestRef'))
assert(panelSource.includes('surfaceRequest={browserSurfaceRequest}'))
assert(panelSource.includes("'pointer-events-none invisible absolute inset-0 flex'"))
assert(workspaceSource.includes('ensureAssistantBrowserSurfaceTabs('))
assert(workspaceSource.includes('transitionToBrowserTab(surfaceRequest.tabId)'))
assert(workspaceSource.includes("mode === 'close' || mode === 'refresh' || mode === 'external'"))
assert(workspaceSource.includes('completeBrowserSurfaceRequest({'))
assert(workspaceSource.includes('claimBrowserSurfaceRequest({'))
assert(workspaceSource.includes('knownTargetId !== surfaceRequest.targetId'))
assert(workspaceSource.includes('knownSecondaryTargetId !== surfaceRequest.secondaryTargetId'))
assert(workspaceSource.includes('surfaceRequest.threadId !== threadId'))
assert(panelSource.includes('updateWorkspaceState({'))
assert(panelSource.includes('onWorkspaceStateChange={handleBrowserWorkspaceStateChange}'))
assert(workspaceSource.includes('<span>Waiting in chat</span>'))
assert.equal(workspaceSource.includes('rejectGrant('), false, 'Browser chrome cannot resolve permission requests')
assert(viewportFrameSource.includes("data-assistant-browser-viewport={viewport.mode}"))
assert(viewportFrameSource.includes('Zyra-controlled Browser surface'))
assert.equal(workspaceSource.includes('webviewRefs.current.get(activeTab.id)?.focus()'), false, 'revealing Browser never steals physical keyboard focus')
assert.equal(webviewSource.includes("type: 'focus'"), false, 'revealing a retained main-owned page keeps focus user-owned')
assert(agentCursorSource.includes('MousePointer2'))
assert(browserDriverSource.includes("for (const fromSurface of [true, false])"))
assert(browserDriverSource.includes('guest.capturePage()'))
assert(browserDriverSource.includes("await this.inputCommand(guest, 'Input.insertText', { text: action.text }, context)"))
assert(browserDriverSource.includes('Click or focus an observed page element before sending target-local keyboard input.'))
assert(browserDriverSource.includes('buildBrowserPointerPath'))
assert(/finally \{[\s\S]{0,240}Input\.dispatchMouseEvent'[\s\S]{0,80}mouseReleased/.test(browserDriverSource), 'pressed pointer actions release even when cursor publication or cancellation fails')
assert(browserViewManagerSource.includes('backgroundThrottling: false'))
assert(runtimeSource.includes("'Root Browser control ended with its turn.'"))
assert(protocolSource.includes("operation: 'open_tab'"))
assert(protocolSource.includes("operation: 'reveal_tab'"))
assert(protocolSource.includes("operation: 'close_tab'"))
assert(protocolSource.includes("operation: 'set_tab_layout'"))
assert(protocolSource.includes("operation: 'resize_inspector'"))
assert(protocolSource.includes("operation: 'open_external'"))
assert(protocolSource.includes('acknowledgeBrowserSurfaceRequest'))
assert(protocolSource.includes('claimBrowserSurfaceRequest'))
assert(protocolSource.includes('browserSurfaceCancelled'))
assert(preloadSource.includes('browserSurfaceRequested'))
assert(preloadSource.includes('acknowledgeBrowserSurfaceRequest'))
assert(preloadSource.includes('claimBrowserSurfaceRequest'))
assert(preloadSource.includes('onBrowserSurfaceCancel'))
assert(preloadSource.includes('updateWorkspaceState'))
assert(preloadSource.includes('onCursorChange'))
assert(protocolSource.includes('cursorChanged'))
assert(handlerSource.includes('assertTrustedRenderer(event, mainWindow)'))
assert(handlerSource.includes('browserSurface.completeRegisteredTarget(target)'))
assert(handlerSource.includes('browserSurface.claim(input)'))
assert(hostSource.includes("tabId: `browser:agent:${id}`"))
assert(hostSource.includes('revealTabs('))
assert(hostSource.includes('resizeInspector('))
assert(hostSource.includes('closeTab('))
assert(hostSource.includes('commandTab('))
assert(hostSource.includes("phase: 'sent' | 'accepted' | 'claimed'"))
console.log('Zyra visual Browser control contract passed.')
