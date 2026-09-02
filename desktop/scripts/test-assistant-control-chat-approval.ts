import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantPendingControlApprovalPanel } from '../src/renderer/src/pages/assistant/AssistantPendingControlApprovalPanel'

const principal = { type: 'root' as const, threadId: 'thread:test', turnId: 'turn:test' }
const target = {
    kind: 'zyra-browser' as const,
    targetId: 'target:test',
    tabId: 'tab:test',
    sessionMode: 'incognito' as const,
    ownerThreadId: 'thread:test',
    guestIdentity: 'guest:test',
    origin: 'https://example.com',
    title: 'Example'
}

const actionMarkup = renderToStaticMarkup(createElement(AssistantPendingControlApprovalPanel, {
    pendingActions: [{
        requestId: 'approval:test',
        principal,
        targetId: target.targetId,
        grantId: 'grant:test',
        actionRequestId: 'action:test',
        actionType: 'click' as const,
        sideEffect: 'purchase' as const,
        observationRevision: 3,
        requestedAt: new Date(0).toISOString(),
        expiresAt: new Date(Date.now() + 30_000).toISOString()
    }],
    pendingGrants: [],
    targets: [target]
}))
assert.match(actionMarkup, /Approve complete a purchase\?/)
assert.match(actionMarkup, /needs your attention even in Full access/)
assert.match(actionMarkup, /Allow this action/)
assert.match(actionMarkup, /https:\/\/example\.com/)
assert.doesNotMatch(actionMarkup, /aria-modal/)

const grantMarkup = renderToStaticMarkup(createElement(AssistantPendingControlApprovalPanel, {
    pendingActions: [],
    pendingGrants: [{
        requestId: 'grant-request:test',
        principal,
        targetId: target.targetId,
        capabilities: ['observe.structure', 'pointer.click'],
        requestedAt: new Date(0).toISOString(),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        maxActions: 20,
        allowedOrigins: ['https://example.com'],
        screenshots: false
    }],
    targets: [target]
}))
assert.match(grantMarkup, /Allow Zyra to use Example\?/)
assert.match(grantMarkup, /Allow for this task/)

const browserSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx', import.meta.url), 'utf8')
const terminalSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPendingTerminalAccessModal.tsx', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerView.tsx', import.meta.url), 'utf8')
const connectedRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConnectedSessionsRail.tsx', import.meta.url), 'utf8')
const chatRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const agentInboxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx', import.meta.url), 'utf8')
assert.match(browserSource, /Waiting in chat/)
assert.doesNotMatch(browserSource, /Browser control permission requested/)
assert.doesNotMatch(browserSource, /approveActivePendingGrant/)
assert.doesNotMatch(terminalSource, /createPortal|aria-modal/)
assert.doesNotMatch(composerSource, /Switch to full access\?/)
assert.match(connectedRailSource, /pendingControlThreadIds/)
assert.match(chatRailSource, /Review permission in chat/)
assert.match(agentInboxSource, /props\.pendingControlThreadIds/)

console.log('Assistant control approvals stay in chat.')
