import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import type { AssistantActivity, AssistantMessage, AssistantReviewIndex, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
import { buildAssistantDiffTurns } from '../src/renderer/src/pages/assistant/assistant-diff-turns'
import { mergeAssistantReviewIndex } from '../src/renderer/src/pages/assistant/assistant-review-index'
import { resolveAssistantDiffTarget, type AssistantDiffTarget } from '../src/renderer/src/pages/assistant/assistant-diff-types'
import { getActivityPatch } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { markdownToPlainText } from '../src/renderer/src/lib/text-layout/markdown-blocks'
import {
    activateAssistantTerminalSession,
    addAssistantTerminalSession,
    ASSISTANT_TERMINALS_PER_GROUP_LIMIT,
    createEmptyAssistantTerminalWorkspaceState,
    reconcileAssistantTerminalWorkspaceState,
    removeAssistantTerminalSession
} from '../src/renderer/src/pages/assistant/assistant-terminal-workspace-state'
import { buildAssistantResourceIndex } from '../src/renderer/src/pages/assistant/assistant-resource-index'
import {
    isPublicBrowserLinkPreviewAddress,
    parseBrowserLinkPreviewHtml
} from '../src/main/ipc/handlers/browser-link-preview'
import {
    activateAssistantBrowserTab,
    addAssistantBrowserTab,
    ASSISTANT_BROWSER_TAB_LIMIT,
    closeAssistantBrowserTab,
    createAssistantBrowserWorkspaceState,
    normalizeAssistantBrowserFaviconUrl,
    normalizeAssistantBrowserNavigation,
    normalizeAssistantBrowserWorkspaceState,
    setAssistantBrowserLayout,
    updateAssistantBrowserTab
} from '../src/renderer/src/pages/assistant/assistant-browser-workspace-state'
import {
    normalizeAssistantInspectorWorkspaceState,
    restoreAssistantInspectorWorkspaceState
} from '../src/renderer/src/pages/assistant/assistant-inspector-workspace-state'

let terminalWorkspaceState = addAssistantTerminalSession(
    createEmptyAssistantTerminalWorkspaceState(),
    [],
    'terminal-1',
    'new'
)
terminalWorkspaceState = addAssistantTerminalSession(terminalWorkspaceState, ['terminal-1'], 'terminal-2', 'split', 'horizontal')
assert.deepEqual(terminalWorkspaceState.groups[0]?.terminalIds, ['terminal-1', 'terminal-2'], 'horizontal split joins the active terminal group')
terminalWorkspaceState = addAssistantTerminalSession(terminalWorkspaceState, ['terminal-1', 'terminal-2'], 'terminal-3', 'new')
assert.equal(terminalWorkspaceState.groups.length, 2, 'New Terminal creates a separate group')
terminalWorkspaceState = activateAssistantTerminalSession(terminalWorkspaceState, 'terminal-1')
terminalWorkspaceState = addAssistantTerminalSession(terminalWorkspaceState, ['terminal-1', 'terminal-2', 'terminal-3'], 'terminal-4', 'split', 'vertical')
assert.equal(terminalWorkspaceState.groups[0]?.splitDirection, 'vertical', 'vertical split changes only the active group layout')
assert.equal(terminalWorkspaceState.activeTerminalId, 'terminal-4', 'a new split receives keyboard focus intent')
terminalWorkspaceState = removeAssistantTerminalSession(terminalWorkspaceState, 'terminal-4')
assert.equal(terminalWorkspaceState.groups.flatMap((group) => group.terminalIds).includes('terminal-4'), false, 'closed terminals leave persisted groups')
const reconciledTerminalWorkspace = reconcileAssistantTerminalWorkspaceState(terminalWorkspaceState, ['terminal-2', 'terminal-3'])
assert.deepEqual(reconciledTerminalWorkspace.groups.flatMap((group) => group.terminalIds).sort(), ['terminal-2', 'terminal-3'], 'server session metadata removes stale persisted terminal IDs')
let limitState = addAssistantTerminalSession(createEmptyAssistantTerminalWorkspaceState(), [], 'limit-1', 'new')
for (let index = 2; index <= ASSISTANT_TERMINALS_PER_GROUP_LIMIT; index += 1) {
    const existingIds = limitState.groups.flatMap((group) => group.terminalIds)
    limitState = addAssistantTerminalSession(limitState, existingIds, `limit-${index}`, 'split')
}
const atLimitIds = limitState.groups.flatMap((group) => group.terminalIds)
const rejectedSplitState = addAssistantTerminalSession(limitState, atLimitIds, 'limit-overflow', 'split')
assert.equal(rejectedSplitState.groups[0]?.terminalIds.length, ASSISTANT_TERMINALS_PER_GROUP_LIMIT, 'split groups enforce the tested pane limit')

assert.deepEqual(normalizeAssistantBrowserNavigation('localhost:5173/app'), { success: true, url: 'http://localhost:5173/app' }, 'schemeless localhost uses HTTP')
assert.deepEqual(normalizeAssistantBrowserNavigation('example.com'), { success: true, url: 'https://example.com/' }, 'public hostnames default to HTTPS')
assert.equal(normalizeAssistantBrowserNavigation('browser preview architecture').success, true, 'plain text becomes a browser search')
assert.equal(normalizeAssistantBrowserNavigation('javascript:alert(1)').success, false, 'script URLs are rejected before reaching Chromium')
assert.equal(normalizeAssistantBrowserNavigation('file:///C:/private.txt').success, false, 'browser tabs cannot escape into local file URLs')
assert.equal(normalizeAssistantBrowserFaviconUrl('https://example.com/favicon.ico'), 'https://example.com/favicon.ico', 'page favicon URLs accept bounded HTTP(S) sources')
assert.equal(normalizeAssistantBrowserFaviconUrl('javascript:alert(1)'), null, 'page favicon URLs reject active-content schemes')
assert.equal(normalizeAssistantBrowserFaviconUrl('data:image/svg+xml,<svg/>'), null, 'page favicon data rejects script-capable SVG')
assert.equal(normalizeAssistantBrowserFaviconUrl(`https://example.com/${'x'.repeat(9000)}`), null, 'page favicon metadata has a strict persistence bound')
assert.equal(
    markdownToPlainText('## Implemented\n\n### Faster validation lanes\n\nAdded **quick checks** and `npm run check`.\n\n| Command | Result |\n|---|---:|\n| Full typecheck | **62 seconds** |'),
    'Implemented · Faster validation lanes · Added quick checks and npm run check. · Command Result Full typecheck 62 seconds',
    'compact Review rows project Markdown into a clean semantic excerpt instead of leaking syntax markers'
)
let browserWorkspaceState = createAssistantBrowserWorkspaceState('browser:0')
for (let index = 1; index <= ASSISTANT_BROWSER_TAB_LIMIT; index += 1) {
    browserWorkspaceState = addAssistantBrowserTab(browserWorkspaceState, `browser:${index}`)
}
assert.equal(browserWorkspaceState.tabs.length, ASSISTANT_BROWSER_TAB_LIMIT, 'browser workspaces enforce the tested tab limit')
const activeBrowserTabId = browserWorkspaceState.activeTabId
browserWorkspaceState = closeAssistantBrowserTab(browserWorkspaceState, activeBrowserTabId, 'browser:replacement')
assert.equal(browserWorkspaceState.tabs.some((tab) => tab.id === activeBrowserTabId), false, 'closed browser tabs release their persisted metadata')
assert.equal(browserWorkspaceState.tabs.some((tab) => tab.id === browserWorkspaceState.activeTabId), true, 'closing the active browser tab selects a real neighbor')
let splitBrowserState = createAssistantBrowserWorkspaceState('browser:primary')
splitBrowserState = addAssistantBrowserTab(splitBrowserState, 'browser:secondary')
splitBrowserState = setAssistantBrowserLayout(splitBrowserState, 'browser:primary', 'browser:secondary')
assert.deepEqual([splitBrowserState.activeTabId, splitBrowserState.splitTabId], ['browser:primary', 'browser:secondary'], 'Browser split layout retains explicit primary and secondary tabs')
splitBrowserState = activateAssistantBrowserTab(splitBrowserState, 'browser:secondary')
assert.deepEqual([splitBrowserState.activeTabId, splitBrowserState.splitTabId], ['browser:secondary', 'browser:primary'], 'selecting the secondary pane swaps focus without destroying the split')
splitBrowserState = closeAssistantBrowserTab(splitBrowserState, 'browser:secondary', 'browser:replacement')
assert.equal(splitBrowserState.activeTabId, 'browser:primary', 'closing the primary split pane promotes the retained secondary tab')
assert.equal(splitBrowserState.splitTabId, null, 'closing either visible split pane safely collapses the layout')
const sanitizedBrowserState = normalizeAssistantBrowserWorkspaceState({
    activeTabId: 'unsafe',
    tabs: [
        { id: 'safe', url: 'http://localhost:3000/', title: 'Local', faviconUrl: 'http://localhost:3000/favicon.ico' },
        { id: 'unsafe', url: 'javascript:alert(1)', title: 'Unsafe', faviconUrl: 'javascript:alert(2)' }
    ],
    splitTabId: 'unsafe'
})
assert.equal(sanitizedBrowserState.tabs.find((tab) => tab.id === 'unsafe')?.url, '', 'unsafe persisted URLs reopen as blank tabs')
assert.equal(sanitizedBrowserState.tabs.find((tab) => tab.id === 'unsafe')?.title, 'New tab', 'a blank restored Browser page never exposes about:blank or stale title text')
const liveBlankBrowserState = updateAssistantBrowserTab(createAssistantBrowserWorkspaceState('browser:blank'), 'browser:blank', { url: '', title: 'about:blank' })
assert.equal(liveBlankBrowserState.tabs[0]?.title, 'New tab', 'live Chromium about:blank title updates normalize to New tab')
assert.equal(sanitizedBrowserState.tabs.every((tab) => tab.status === 'idle'), true, 'restored tabs wait for their live webviews to report status')
assert.equal(sanitizedBrowserState.tabs.every((tab) => tab.audible === false), true, 'stale audio indicators never survive a webview remount')
assert.equal(sanitizedBrowserState.tabs.find((tab) => tab.id === 'safe')?.faviconUrl, 'http://localhost:3000/favicon.ico', 'safe page favicons survive workspace restoration')
assert.equal(sanitizedBrowserState.tabs.find((tab) => tab.id === 'unsafe')?.faviconUrl, null, 'unsafe persisted favicon sources are discarded')
assert.equal(sanitizedBrowserState.splitTabId, null, 'a persisted split cannot point at the active or missing Browser tab')

const normalizedInspectorState = normalizeAssistantInspectorWorkspaceState({
    version: 1,
    activeTabId: 'agents',
    tabs: [
        { id: 'terminal', kind: 'terminal' },
        { id: 'explorer', kind: 'explorer' },
        { id: 'control', kind: 'control' },
        { id: 'resources', kind: 'resources' },
        { id: 'agents', kind: 'agents' },
        { id: 'review', kind: 'review' },
        { id: 'browser:kept', kind: 'browser', browserTabId: 'browser:kept' },
        { id: 'browser:stale', kind: 'browser', browserTabId: 'browser:stale' },
        { id: 'turn:turn-7', kind: 'turn', turnId: 'turn-7' },
        { id: 'terminal-copy', kind: 'terminal' },
        { id: 'unsafe', kind: 'browser', browserTabId: 'javascript:unsafe' }
    ]
})
assert.ok(normalizedInspectorState)
assert.equal(normalizedInspectorState.tabs.filter((tab) => tab.kind === 'terminal').length, 1, 'singleton Inspector tabs deduplicate corrupted persisted copies')
const restoredInspectorState = restoreAssistantInspectorWorkspaceState(normalizedInspectorState, ['browser:kept'])
assert.equal(restoredInspectorState.activeTabId, 'agents', 'the active non-Browser Inspector workspace survives restoration')
assert.deepEqual(
    restoredInspectorState.tabs.map((tab) => tab.id),
    ['terminal', 'explorer', 'control', 'resources', 'agents', 'review', 'browser:kept', 'turn:turn-7'],
    'Inspector restoration preserves every valid workspace kind and its order while removing stale Browser pages'
)
const freshInspectorState = restoreAssistantInspectorWorkspaceState(null, ['browser:restored'])
assert.deepEqual(freshInspectorState.tabs.map((tab) => tab.id), ['review', 'browser:restored'], 'a workspace without Inspector history retains the Review-plus-Browser migration fallback')
assert.equal(freshInspectorState.activeTabId, 'review', 'fresh Inspector state still opens on Review')

assert.equal(isPublicBrowserLinkPreviewAddress('127.0.0.1'), false, 'website metadata cannot reach IPv4 loopback services')
assert.equal(isPublicBrowserLinkPreviewAddress('192.168.1.4'), false, 'website metadata cannot reach private LAN services')
assert.equal(isPublicBrowserLinkPreviewAddress('::1'), false, 'website metadata cannot reach IPv6 loopback services')
assert.equal(isPublicBrowserLinkPreviewAddress('93.184.216.34'), true, 'public website addresses remain eligible for metadata')
const parsedLinkPreview = parseBrowserLinkPreviewHtml(`
    <html><head>
        <meta content="Example &amp; Preview" property="og:title">
        <meta name="description" content="A useful site preview.">
        <meta property="og:image" content="/social-card.png">
        <meta property="og:site_name" content="Example Site">
    </head></html>
`, 'https://example.com/docs')
assert.equal(parsedLinkPreview.title, 'Example & Preview', 'Open Graph titles decode safe HTML entities')
assert.equal(parsedLinkPreview.description, 'A useful site preview.', 'description metadata becomes link-card copy')
assert.equal(parsedLinkPreview.imageUrl, 'https://example.com/social-card.png', 'relative Open Graph images resolve against the final page URL')
assert.equal(parsedLinkPreview.siteName, 'Example Site', 'site names remain available to visual cards')

const resourceDiffTarget: AssistantDiffTarget = {
    activityId: 'resource-change',
    turnId: 'resource-turn',
    filePath: 'assets/preview.png',
    displayPath: '/assets/preview.png',
    patch: '--- a/assets/preview.png\n+++ b/assets/preview.png',
    isNew: true,
    changeKind: 'add'
}
const resourceIndex = buildAssistantResourceIndex({
    projectPath: 'C:\\project',
    turns: [{
        id: 'resource-turn',
        number: 7,
        prompt: 'Use `src/app.ts`, [the docs](docs/readme.md), ![Preview](assets/preview.png), `@scope/pkg/react`, https://example.com/docs, [Scrollbar docs](https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-gutter), and [Balanced URL](https://example.com/a_(b)).',
        promptAttachments: [
            { id: 'docs', name: 'readme.md', displayName: 'readme.md', type: 'FILE', path: 'C:\\project\\docs\\readme.md', mime: 'text/markdown', size: '20', preview: null, note: null, origin: null, content: null, isClipboard: false },
            { id: 'image', name: 'photo.jpg', displayName: 'photo.jpg', type: 'IMAGE', path: 'C:\\project\\assets\\photo.jpg', mime: 'image/jpeg', size: '120', preview: null, note: null, origin: null, content: null, isClipboard: false },
            { id: 'paste', name: 'Pasted text', displayName: 'Pasted text', type: 'TEXT', path: 'clipboard://paste.txt', mime: 'text/plain', size: '12', preview: 'hello', note: null, origin: 'pasted from clipboard', content: 'hello', isClipboard: true },
            { id: 'pasted-image', name: 'Pasted image', displayName: 'Pasted image', type: 'IMAGE', path: 'clipboard://image.png', mime: 'image/png', size: '32', preview: null, note: null, origin: 'pasted from clipboard', content: 'data:image/png;base64,AAAA', isClipboard: true }
        ],
        response: 'Created `assets/preview.png`. Read https://example.com/docs again. ![Remote](https://cdn.example.com/render?id=7). [Unsafe](javascript:alert(1)).',
        historyUnavailable: false,
        detailLoaded: true,
        searchText: '',
        createdAt: '2026-07-20T12:00:00.000Z',
        updatedAt: '2026-07-20T12:01:00.000Z',
        files: [{ target: resourceDiffTarget, additions: 4, deletions: 0 }],
        changes: [{ target: resourceDiffTarget, additions: 4, deletions: 0 }],
        additions: 4,
        deletions: 0
    }]
})
const generatedResource = resourceIndex.resources.find((resource) => resource.path?.replace(/\\/g, '/').endsWith('/assets/preview.png'))
assert.equal(generatedResource?.kind, 'image', 'generated image files become visual Resources')
assert.equal(generatedResource?.sources.includes('generated'), true, 'generated image provenance remains available on its card')
assert.equal(generatedResource?.sources.includes('mentioned'), true, 'image mentions merge into their canonical generated-image Resource')
assert.equal(generatedResource?.latestDiffTarget?.activityId, 'resource-change', 'changed images keep their exact Review target')
assert.equal(resourceIndex.resources.some((resource) => resource.path?.replace(/\\/g, '/').endsWith('/src/app.ts')), false, 'code files stay out of Resources')
assert.equal(resourceIndex.resources.some((resource) => resource.path?.replace(/\\/g, '/').endsWith('/docs/readme.md')), false, 'non-image documents stay out of Resources')
const attachedImageResource = resourceIndex.resources.find((resource) => resource.path?.replace(/\\/g, '/').endsWith('/assets/photo.jpg'))
assert.equal(attachedImageResource?.sources.includes('attached'), true, 'attached local images keep their attachment origin')
assert.equal(resourceIndex.resources.filter((resource) => resource.url === 'https://example.com/docs').length, 1, 'repeated web links deduplicate by normalized URL')
assert.deepEqual(
    resourceIndex.resources.filter((resource) => resource.url?.startsWith('https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-gutter')).map((resource) => resource.url),
    ['https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-gutter'],
    'a Markdown URL and the plain-URL scanner collapse to one clean destination without the closing parenthesis'
)
assert.deepEqual(
    resourceIndex.resources.filter((resource) => resource.url?.startsWith('https://example.com/a_')).map((resource) => resource.url),
    ['https://example.com/a_(b)'],
    'valid balanced parentheses remain part of one resolved Markdown destination'
)
assert.equal(resourceIndex.resources.some((resource) => resource.url === 'https://www.npmjs.com/package/@scope/pkg'), true, 'package references become their safe link card')
assert.equal(resourceIndex.resources.some((resource) => resource.url === 'https://cdn.example.com/render?id=7' && resource.kind === 'image'), true, 'Markdown image syntax creates an image card even without a file extension')
assert.equal(resourceIndex.resources.some((resource) => resource.kind === 'image' && resource.attachment?.isClipboard), true, 'clipboard images remain visual Resources')
assert.equal(resourceIndex.resources.some((resource) => resource.attachment?.type === 'TEXT'), false, 'pasted text stays out of the image-and-link shelf')
assert.equal(resourceIndex.resources.some((resource) => resource.url?.startsWith('javascript:')), false, 'unsafe link schemes never enter Resources')
const posixCaseResourceIndex = buildAssistantResourceIndex({
    projectPath: '/project',
    turns: [{
        id: 'posix-case',
        number: 1,
        prompt: '',
        promptAttachments: [],
        response: '',
        historyUnavailable: false,
        searchText: '',
        createdAt: '2026-07-20T12:00:00.000Z',
        updatedAt: '2026-07-20T12:00:00.000Z',
        files: [],
        additions: 0,
        deletions: 0,
        changes: [
            { target: { ...resourceDiffTarget, activityId: 'upper', filePath: '/project/Foo.png' }, additions: 1, deletions: 0 },
            { target: { ...resourceDiffTarget, activityId: 'lower', filePath: '/project/foo.png' }, additions: 1, deletions: 0 }
        ]
    }]
})
assert.equal(posixCaseResourceIndex.resources.filter((resource) => resource.kind === 'image').length, 2, 'POSIX image identities remain case-sensitive')

const previewPatch = '--- a/src/live.ts\n+++ b/src/live.ts\n@@ -1 +1 @@\n-old\n+preview\n'
const resultPatch = '--- a/src/live.ts\n+++ b/src/live.ts\n@@ -1 +1 @@\n-old\n+final\n'
const target: AssistantDiffTarget = {
    activityId: 'zyra-tool-live-edit',
    filePath: 'src/live.ts',
    displayPath: 'src/live.ts',
    patch: previewPatch,
    provisional: true
}
const runningActivity: AssistantActivity = {
    id: target.activityId,
    kind: 'file-change',
    tone: 'tool',
    summary: 'Editing file',
    turnId: 'turn-live',
    createdAt: '2026-07-11T10:00:00.000Z',
    payload: {
        category: 'file-change',
        provider: 'pi',
        status: 'running',
        source: 'args-preview',
        revision: 1,
        authoritative: false,
        previewPatch,
        paths: [target.filePath]
    }
}
const liveTarget = resolveAssistantDiffTarget(target, runningActivity)
assert.match(liveTarget.patch, /^diff --git a\/src\/live\.ts b\/src\/live\.ts/)
assert.match(liveTarget.patch, /\+preview/)
assert.equal(liveTarget.provisional, true)

const completedActivity: AssistantActivity = {
    ...runningActivity,
    payload: {
        ...runningActivity.payload,
        status: 'completed',
        source: 'provider-result',
        revision: 2,
        authoritative: true,
        patch: resultPatch,
        changes: [{ path: target.filePath, kind: 'update', diff: resultPatch }]
    }
}
const earlierSuccessfulActivity: AssistantActivity = {
    ...completedActivity,
    id: 'earlier-successful-file-edit',
    createdAt: '2026-07-11T09:59:59.500Z',
    payload: {
        ...completedActivity.payload,
        patch: previewPatch,
        changes: [{ path: target.filePath, kind: 'update', diff: previewPatch }]
    }
}
const failedActivity: AssistantActivity = {
    ...runningActivity,
    id: 'failed-file-edit',
    tone: 'error',
    createdAt: '2026-07-11T10:00:00.500Z',
    payload: {
        ...runningActivity.payload,
        status: 'failed',
        authoritative: false,
        output: 'The requested old text was not unique.',
        patch: resultPatch,
        paths: ['src/failed.ts']
    }
}

const refreshedTarget = resolveAssistantDiffTarget(target, completedActivity)
assert.equal(refreshedTarget.activityId, target.activityId)
assert.equal(refreshedTarget.filePath, target.filePath)
assert.match(refreshedTarget.patch, /\+final/, 'an open diff selection must consume the latest activity patch')
assert.equal(refreshedTarget.provisional, false, 'authoritative completion removes the live-preview state')

const promptMessage: AssistantMessage = {
    id: 'prompt-live',
    role: 'user',
    text: 'Tighten the assistant diff sidebar without showing every turn at once.\n\nAttached files (1):\n1. review-layout.png [IMAGE]\nref: clipboard://review-layout-image\nmime: image/png\nsize: 2048 bytes\norigin: pasted from clipboard; treat this as inline context only',
    turnId: 'turn-live',
    streaming: false,
    createdAt: '2026-07-11T09:59:59.000Z',
    updatedAt: '2026-07-11T09:59:59.000Z'
}
const responseMessage: AssistantMessage = {
    id: 'response-live',
    role: 'assistant',
    text: '## Result\n\n- The sidebar now keeps one selected file diff mounted.',
    turnId: 'turn-live',
    streaming: false,
    createdAt: '2026-07-11T10:00:01.000Z',
    updatedAt: '2026-07-11T10:00:01.000Z'
}
const noChangePrompt: AssistantMessage = {
    id: 'prompt-no-change',
    role: 'user',
    text: 'Explain the current review layout.',
    turnId: 'turn-no-change',
    streaming: false,
    createdAt: '2026-07-11T10:01:00.000Z',
    updatedAt: '2026-07-11T10:01:00.000Z'
}
const noChangeResponse: AssistantMessage = {
    id: 'response-no-change',
    role: 'assistant',
    text: 'It has a searchable landing page and a dedicated turn view.',
    turnId: 'turn-no-change',
    streaming: false,
    createdAt: '2026-07-11T10:01:01.000Z',
    updatedAt: '2026-07-11T10:01:01.000Z'
}
const legacyPrompt: AssistantMessage = {
    id: 'prompt-legacy',
    role: 'user',
    text: 'Review this legacy turn too.',
    turnId: null,
    streaming: false,
    createdAt: '2026-07-11T10:02:00.000Z',
    updatedAt: '2026-07-11T10:02:00.000Z'
}
const legacyResponse: AssistantMessage = {
    id: 'response-legacy',
    role: 'assistant',
    text: 'The legacy prompt was matched through its following response.',
    turnId: 'turn-legacy',
    streaming: false,
    createdAt: '2026-07-11T10:02:01.000Z',
    updatedAt: '2026-07-11T10:02:01.000Z'
}
const persistedTurns: AssistantSessionTurnUsageEntry[] = [
    {
        id: 'turn-before-history',
        sessionId: 'session-review',
        threadId: 'thread-review',
        model: 'test-model',
        state: 'completed',
        requestedAt: '2026-07-11T09:00:00.000Z',
        startedAt: '2026-07-11T09:00:00.100Z',
        completedAt: '2026-07-11T09:00:01.000Z',
        assistantMessageId: null,
        usage: null,
        updatedAt: '2026-07-11T09:00:01.000Z'
    },
    ...[
        ['turn-live', promptMessage.createdAt],
        ['turn-no-change', noChangePrompt.createdAt],
        ['turn-legacy', legacyPrompt.createdAt]
    ].map(([id, requestedAt]): AssistantSessionTurnUsageEntry => ({
        id,
        sessionId: 'session-review',
        threadId: 'thread-review',
        model: 'test-model',
        state: 'completed',
        requestedAt,
        startedAt: requestedAt,
        completedAt: requestedAt,
        assistantMessageId: null,
        usage: null,
        updatedAt: requestedAt
    }))
]
const diffTurns = buildAssistantDiffTurns({
    messages: [promptMessage, responseMessage, noChangePrompt, noChangeResponse, legacyPrompt, legacyResponse],
    activities: [completedActivity, earlierSuccessfulActivity, failedActivity],
    turns: persistedTurns,
    projectRootPath: 'C:/project'
})
assert.equal(diffTurns.length, 4, 'the review index includes every persisted ledger turn, even when its message rows are unavailable')
assert.equal(diffTurns.find((turn) => turn.id === 'turn-before-history')?.historyUnavailable, true, 'ledger-only turns remain visible with an honest unavailable-history state')
assert.equal(diffTurns.find((turn) => turn.id === 'turn-before-history')?.number, 1, 'ledger-only turns retain their stable persisted ordinal')
const changedTurn = diffTurns.find((turn) => turn.id === 'turn-live')
assert.equal(changedTurn?.files.length, 1, 'the compact Changed files rail keeps one row per path')
assert.equal(changedTurn?.changes.length, 2, 'every successful file-change activity remains available within its turn')
assert.deepEqual(changedTurn?.changes.map((change) => change.target.activityId), [
    earlierSuccessfulActivity.id,
    completedActivity.id
], 'recorded turn changes retain chronological activity identity')
assert.equal(changedTurn?.files[0]?.target.activityId, completedActivity.id, 'normal file navigation still targets the latest edit for that path')
assert.equal(changedTurn?.files[0]?.additions, 2, 'the compact file row totals additions across recorded edits')
assert.equal(changedTurn?.files[0]?.deletions, 2, 'the compact file row totals deletions across recorded edits')
assert.equal(changedTurn?.number, 2, 'Review uses the persisted thread turn ledger rather than visible message position')
assert.equal(changedTurn?.files[0]?.target.filePath, 'src/live.ts')
assert.match(changedTurn?.prompt || '', /Tighten the assistant diff sidebar/)
assert.equal(changedTurn?.prompt.includes('Attached files'), false, 'Review strips serialized attachment metadata from visible prompt text')
assert.equal(changedTurn?.promptAttachments.length, 1, 'Review retains parsed prompt attachments alongside the turn')
assert.equal(changedTurn?.promptAttachments[0]?.displayName, 'Pasted image', 'clipboard image attachments keep their user-facing display label')
assert.match(changedTurn?.response || '', /one selected file diff/)
assert.match(changedTurn?.response || '', /^## Result\n\n- /, 'agent Markdown formatting remains intact for the turn context renderer')
assert.match(changedTurn?.searchText || '', /turn 2/, 'the persisted turn number is indexed for Review search')
assert.match(changedTurn?.searchText || '', /src\/live\.ts/, 'edited paths are included in the Review search index')
assert.match(changedTurn?.searchText || '', /tighten the assistant/, 'user prompts are included in the Review search index')
assert.equal(diffTurns.find((turn) => turn.id === 'turn-no-change')?.files.length, 0, 'unchanged turns remain filterable review rows')
assert.equal(diffTurns.find((turn) => turn.id === 'turn-legacy')?.prompt, legacyPrompt.text, 'legacy null-turn prompts infer their turn from the following response')

const inFlightPrompt: AssistantMessage = {
    id: 'prompt-in-flight',
    role: 'user',
    text: 'Keep one Review row while this prompt starts.',
    turnId: null,
    streaming: false,
    createdAt: '2026-07-11T10:03:00.000Z',
    updatedAt: '2026-07-11T10:03:00.000Z'
}
const provisionalInFlightTurns = buildAssistantDiffTurns({ messages: [inFlightPrompt], activities: [] })
assert.equal(provisionalInFlightTurns[0]?.id, `message:${inFlightPrompt.id}`, 'an immediate prompt uses a provisional Review identity until the runtime returns its turn id')
const canonicalInFlightIndex: AssistantReviewIndex = {
    threadId: 'thread-review',
    totalTurns: 1,
    turns: [{
        id: 'turn-in-flight',
        number: 5,
        state: 'running',
        prompt: {
            id: inFlightPrompt.id,
            text: inFlightPrompt.text,
            truncated: false,
            createdAt: inFlightPrompt.createdAt,
            updatedAt: inFlightPrompt.updatedAt
        },
        response: null,
        agentLabel: 'Agent',
        requestedAt: inFlightPrompt.createdAt,
        updatedAt: inFlightPrompt.updatedAt,
        changes: []
    }]
}
const reconciledInFlightTurns = mergeAssistantReviewIndex({
    index: canonicalInFlightIndex,
    detailedTurns: provisionalInFlightTurns
})
assert.equal(reconciledInFlightTurns.length, 1, 'a newly sent prompt cannot render both provisional and canonical Review rows')
assert.equal(reconciledInFlightTurns[0]?.id, 'turn-in-flight', 'the reconciled Review row keeps the runtime turn id')
assert.equal(reconciledInFlightTurns[0]?.prompt, inFlightPrompt.text, 'the canonical row retains the immediate live prompt detail')
const unhydratedInFlightTurns = mergeAssistantReviewIndex({
    index: canonicalInFlightIndex,
    detailedTurns: provisionalInFlightTurns,
    hydratedTurnIds: new Set()
})
assert.equal(unhydratedInFlightTurns[0]?.detailLoaded, false, 'a prompt visible in the chat page cannot masquerade as fully hydrated Review detail')
const hydratedInFlightTurns = mergeAssistantReviewIndex({
    index: canonicalInFlightIndex,
    detailedTurns: provisionalInFlightTurns,
    hydratedTurnIds: new Set(['turn-in-flight'])
})
assert.equal(hydratedInFlightTurns[0]?.detailLoaded, true, 'an explicit turn-detail response releases the Review loading state')

const nestedChangeOnlyActivity: AssistantActivity = {
    ...completedActivity,
    id: 'nested-change-only',
    payload: {
        status: 'completed',
        paths: [target.filePath],
        changes: [{ path: target.filePath, kind: 'update', diff: resultPatch }]
    }
}
assert.match(getActivityPatch(nestedChangeOnlyActivity) || '', /^diff --git a\/src\/live\.ts b\/src\/live\.ts/, 'Review reconstructs a renderable patch when canonical history retains it only in changes[].diff')

const legacyActivity: AssistantActivity = {
    ...completedActivity,
    id: 'legacy-file-change',
    payload: {
        patch: resultPatch,
        paths: [target.filePath],
        status: 'completed'
    }
}
const legacyTarget = resolveAssistantDiffTarget({ ...target, activityId: legacyActivity.id }, legacyActivity)
assert.match(legacyTarget.patch, /^diff --git a\/src\/live\.ts b\/src\/live\.ts/, 'legacy patch/path-only activities remain selectable')

const pageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const timelineToolCardSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimelineToolCallCard.tsx', import.meta.url), 'utf8')
const diffTypesSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-diff-types.ts', import.meta.url), 'utf8')
const diffTurnsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-diff-turns.ts', import.meta.url), 'utf8')
const turnReviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTurnReview.tsx', import.meta.url), 'utf8')
const patchDiffViewerSource = readFileSync(new URL('../src/renderer/src/components/ui/diff-viewer/PatchDiffViewer.tsx', import.meta.url), 'utf8')
assert.equal(pageSource.includes('onViewDiff={handleViewDiff}'), true, 'mounted conversation pane must receive a real diff callback')
assert.equal(pageSource.includes('setDiffRevealRequest(turnId ? { id: diffRevealSequenceRef.current++, turnId } : null)'), true, 'chat timeline diff clicks create a one-shot exact-file reveal request')
assert.equal(pageSource.includes('onSelectDiff={handleSelectInspectorDiff}'), true, 'Inspector file selection does not masquerade as a new chat deep link')
assert.equal(pageSource.includes('<AssistantDiffPanel'), true, 'the changes inspector must be mounted in AssistantPage')
assert.equal(pageSource.includes('mergeAssistantReviewIndex({'), true, 'Review rows come from the complete persisted index rather than the loaded chat page')
assert.equal(pageSource.includes('assistant.getTurnDetail({ threadId, turnId })'), true, 'opening an index row fetches only that turn’s complete detail')
assert.equal(pageSource.includes('hydratedTurnIds: hydratedReviewTurnIds'), true, 'loaded chat messages cannot suppress the dedicated Review detail request')
assert.equal(turnReviewSource.includes('key={`all:${turn.id}`}'), true, 'adding another Review batch preserves the mounted combined diff and its scroll position')
assert.equal(turnReviewSource.includes('key={`all:${turn.id}:${renderedRecordedChanges.length}`}'), false, 'batch size cannot remount the complete combined diff')
assert.equal(patchDiffViewerSource.includes('isIncrementalFileDiffAppend'), true, 'the shared diff viewer distinguishes append-only batches from full replacements')
assert.equal(patchDiffViewerSource.includes('<div key={renderToken} className={flush'), false, 'append-only file lists retain existing keyed diff children')
assert.equal(pageSource.includes('useAssistantReviewIndex'), true, 'Review loads its dedicated lightweight persisted index')
assert.equal(pageSource.includes('resolveAssistantDiffTarget(effectiveDiffTarget, effectiveDiffActivity)'), true, 'open selection must refresh from live store activity state')
assert.equal(pageSource.includes('targetTurnId === selectedDiffTurn.id'), true, 'a chat deep link keeps its exact historical activity even when Review indexes a later edit to the same path')
assert.equal(diffTypesSource.includes('getActivityPatch(activity) || selected.patch'), true, 'chat and Inspector refresh use the same canonical activity patch resolver')
assert.equal(diffTurnsSource.includes("readActivityStatus(activity) !== 'failed'"), true, 'failed writes never enter applied Review changes')
assert.equal(timelineToolCardSource.includes('Write failed'), true, 'expanded failed writes show their failure output in chat')
assert.equal(timelineToolCardSource.includes("status !== 'failed' && patch"), true, 'failed attempted writes cannot open as applied sidebar diffs')
assert.equal(pageSource.includes("setRightPanelMode('review')"), true, 'opening a timeline diff reveals the review workspace')
assert.equal(pageSource.includes('assistantInspectorLayout'), false, 'timeline diff routing cannot fall back to a legacy layout preference')
assert.equal(pageSource.includes('AssistantClassicDiffPanel'), false, 'AssistantPage no longer mounts the retired classic diff panel')
assert.equal(
    existsSync(new URL('../src/renderer/src/pages/assistant/AssistantClassicDiffPanel.tsx', import.meta.url)),
    false,
    'the retired classic diff panel source stays deleted'
)
const workspaceLayoutSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantWorkspaceLayout.tsx', import.meta.url), 'utf8')
assert.equal(workspaceLayoutSource.includes('paneLayout.autoCollapseLeftSidebar'), true, 'the left rail collapses when the panes would violate the minimum chat width')
assert.equal(pageSource.includes('maxWidth={paneLayout.maxInspectorWidth}'), true, 'Inspector resizing reserves the minimum chat width during the drag')
assert.equal(workspaceLayoutSource.includes('autoCollapsedLeftSidebarRef.current'), true, 'the left rail restores only when the pane layout collapsed it')
assert.equal(pageSource.includes('onViewDiff={undefined}'), false)

const panelSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantDiffPanel.tsx', import.meta.url), 'utf8')
const inspectorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantInspectorSidebar.tsx', import.meta.url), 'utf8')
const landingSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantReviewLanding.tsx', import.meta.url), 'utf8')
const utilityWorkspaceHostSource = readFileSync(new URL('../src/renderer/src/pages/assistant/utility/AssistantUtilityWorkspaceHost.tsx', import.meta.url), 'utf8')
const reviewIndexSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-review-index.ts', import.meta.url), 'utf8')
const persistenceHistorySource = readFileSync(new URL('../src/main/assistant/persistence-history.ts', import.meta.url), 'utf8')
const fileActionsMenuSource = readFileSync(new URL('../src/renderer/src/components/ui/FileActionsMenu.tsx', import.meta.url), 'utf8')
const explorerWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantExplorerWorkspace.tsx', import.meta.url), 'utf8')
const filesWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantFilesWorkspace.tsx', import.meta.url), 'utf8')
const filesPreviewMountStart = filesWorkspaceSource.indexOf('{preview.previewFile ? (')
const filesPreviewMountEnd = filesWorkspaceSource.indexOf('</FilesPreviewBoundary>', filesPreviewMountStart)
assert.notEqual(filesPreviewMountStart, -1, 'Files mounts a preview only after preview state exists')
assert.notEqual(filesPreviewMountEnd, -1, 'the preview mount remains inside its recovery boundary')
const filesPreviewMountSource = filesWorkspaceSource.slice(filesPreviewMountStart, filesPreviewMountEnd)
const terminalWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTerminalWorkspace.tsx', import.meta.url), 'utf8')
const terminalViewportSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTerminalViewport.tsx', import.meta.url), 'utf8')
const terminalRuntimeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/previewTerminalRuntime.ts', import.meta.url), 'utf8')
const previewTerminalHandlerSource = readFileSync(new URL('../src/main/ipc/handlers/preview-terminal-handlers.ts', import.meta.url), 'utf8')
const browserWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx', import.meta.url), 'utf8')
const browserNewTabSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserNewTab.tsx', import.meta.url), 'utf8')
const processDetectorSource = readFileSync(new URL('../src/main/inspectors/process-detector.ts', import.meta.url), 'utf8')
const inspectorWorkspaceStateSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-inspector-workspace-state.ts', import.meta.url), 'utf8')
const browserPageIconSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserPageIcon.tsx', import.meta.url), 'utf8')
const resourcesWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantResourcesWorkspace.tsx', import.meta.url), 'utf8')
const resourcesLibrarySource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantResourcesLibrary.tsx', import.meta.url), 'utf8')
const resourceIndexSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-resource-index.ts', import.meta.url), 'utf8')
const browserWebviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWebview.tsx', import.meta.url), 'utf8')
const browserViewManagerSource = readFileSync(new URL('../src/main/browser-view-manager.ts', import.meta.url), 'utf8')
const browserViewportFrameSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserViewportFrame.tsx', import.meta.url), 'utf8')
const browserPreviewHandlerSource = readFileSync(new URL('../src/main/ipc/handlers/browser-preview-handlers.ts', import.meta.url), 'utf8')
const browserLinkPreviewSource = readFileSync(new URL('../src/main/ipc/handlers/browser-link-preview.ts', import.meta.url), 'utf8')
const assistantLinkPreviewCacheSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-link-preview-cache.ts', import.meta.url), 'utf8')
const desktopMainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const ipcHandlersSource = readFileSync(new URL('../src/main/ipc/handlers.ts', import.meta.url), 'utf8')
const projectsPreloadSource = readFileSync(new URL('../src/preload/adapters/projects-adapter.ts', import.meta.url), 'utf8')
const devscopeApiSource = readFileSync(new URL('../src/shared/contracts/devscope-api.ts', import.meta.url), 'utf8')
assert.equal(landingSource.includes('assistant.searchTurns({ threadId, query: normalizedQuery })'), true, 'Review search queries persisted unloaded turn text and path metadata')
const reviewPromptAttachmentsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantReviewPromptAttachments.tsx', import.meta.url), 'utf8')
const rawPatchFallbackSource = readFileSync(new URL('../src/renderer/src/components/ui/diff-viewer/RawPatchFallback.tsx', import.meta.url), 'utf8')
const sidebarStateSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantPageSidebarState.ts', import.meta.url), 'utf8')
const sidebarPreviewStateSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-sidebar-preview-state.ts', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantComposerView.tsx', import.meta.url), 'utf8')
const rendererCssSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
assert.equal(rendererCssSource.includes("@import 'xterm/css/xterm.css'"), true, 'xterm receives its required viewport, selection, and helper-textarea styles')
const timelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantTimeline.tsx', import.meta.url), 'utf8')
const virtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
const persistenceWriteSource = readFileSync(new URL('../src/main/assistant/persistence-write.ts', import.meta.url), 'utf8')
const serviceHistorySource = readFileSync(new URL('../src/main/assistant/service-history.ts', import.meta.url), 'utf8')
const paneLayoutSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-pane-layout.ts', import.meta.url), 'utf8')
assert.equal(inspectorSource.includes('Assistant inspector workspace'), true)
assert.equal(inspectorSource.includes('shadow-[-14px_0_32px_rgba(0,0,0,0.16)]'), false, 'Inspector meets the chat pane at one clean border without a false shadow gap')
assert.equal(timelineSource.includes('<AssistantVirtualTimeline'), true, 'chat history uses the virtual timeline owner')
assert.equal(virtualTimelineSource.includes('Retry earlier messages'), true, 'paged history exposes an explicit retry control')
assert.equal(virtualTimelineSource.includes('ListHeaderComponent={header}'), true, 'the earlier-history control remains in normal list flow')
assert.equal(persistenceWriteSource.includes("upsertAssistantMessages(db, thread.thread)"), true, 'ordinary message patches merge surviving rows instead of replacing the complete persisted thread')
assert.equal(persistenceWriteSource.includes("deleteAssistantThreadRowsById(db, 'assistant_messages'"), true, 'history deletion removes only explicitly identified message rows')
assert.equal(persistenceWriteSource.includes("replaceAssistantMessages(db, thread.thread)"), false, 'ordinary thread updates cannot wholesale replace persisted messages from a partial in-memory snapshot')
assert.equal(serviceHistorySource.includes('removedMessageIds: removedMessages.map'), true, 'intentional turn deletion carries exact message identities to persistence')
assert.equal(inspectorSource.includes('Workspace tabs'), true)
assert.equal(inspectorSource.includes('Resize inspector workspace'), true)
assert.equal(inspectorSource.includes('transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]'), true, 'Inspector layout makes room with the same short smooth entrance curve as its title-bar tabs')
assert.equal(inspectorSource.includes('transform-gpu transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]'), true, 'the fixed-width Inspector surface uses compositor-friendly slide and fade motion')
assert.equal(inspectorSource.includes("open ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'"), true, 'Inspector content enters from the right without fading the width-owning flex shell')
assert.equal(inspectorSource.includes('motion-reduce:transition-none'), true, 'Inspector entrance respects reduced-motion preferences')
assert.equal(inspectorSource.includes("resizing ? 'relative w-full' : 'absolute inset-y-0 right-0'"), true, 'the heavy Inspector surface keeps its final width while the outer shell reveals it')
assert.equal(inspectorSource.includes('style={resizing ? undefined : { width: `${resolvedWidth}px` }}'), true, 'opening the Inspector does not reflow its Review content on every width frame')
assert.equal(inspectorSource.includes('duration-250'), false, 'the Inspector cannot rely on an undefined Tailwind duration utility')
assert.equal(paneLayoutSource.includes('ASSISTANT_MAX_INSPECTOR_VIEWPORT_RATIO = 0.75'), true, 'the right workspace can grow to three quarters of the viewport')
assert.equal(panelSource.includes('<AssistantInspectorSidebar'), true, 'review surfaces render inside the reusable inspector shell')
assert.equal(panelSource.includes('assistant-review-navigation-stack relative grid'), true, 'the Review index stays mounted in a shared transition stack so search, selection, and scroll survive Back')
assert.equal(panelSource.includes("data-state={reviewDetailPresented ? 'behind' : 'active'}"), true, 'the landing participates in the forward and reverse Review transition')
assert.equal(panelSource.includes("data-state={reviewDetailPresented ? 'active' : 'ahead'}"), true, 'loading and hydrated detail share one directional transition surface')
assert.match(panelSource, /stagingFrameId = window\.requestAnimationFrame[\s\S]{0,180}presentationFrameId = window\.requestAnimationFrame/, 'detail stays staged through one painted frame before its entrance transition begins')
assert.equal(panelSource.includes('onTransitionEnd={handleReviewDetailTransitionEnd}'), true, 'Back keeps detail mounted until its reverse transform actually completes')
assert.equal(panelSource.includes('const indexAnimation = indexSurface.animate('), true, 'the mounted Review landing receives explicit browser keyframes instead of relying only on a class change')
assert.equal(panelSource.includes('const detailAnimation = detailSurface.animate('), true, 'the mounted full-turn surface receives explicit forward and reverse keyframes')
assert.match(panelSource, /reviewDetailPresented[\s\S]{0,220}translate3d\(-12px, 0, 0\)/, 'forward Review motion moves the landing left')
assert.match(panelSource, /detailSurface\.animate\([\s\S]{0,320}translate3d\(16px, 0, 0\)/, 'full-turn Review enters from and returns toward the right')
assert.equal(panelSource.includes("document.body.classList.contains('zyra-reduce-motion')"), true, 'explicit Review keyframes respect the in-app reduced-motion setting')
assert.equal(utilityWorkspaceHostSource.includes('assistant-review-navigation-stack relative grid'), true, 'full-screen Review uses the same mounted landing/detail stack as docked Review')
assert.equal(utilityWorkspaceHostSource.includes('const detailAnimation = detailSurface.animate('), true, 'full-screen Review runs the same directional detail motion')
assert.equal(landingSource.includes('MASTER_DETAIL_MIN_WIDTH = 1120'), true, 'wide Review uses an explicit container-width master/detail breakpoint')
assert.equal(landingSource.includes('View full turn'), true, 'the preview exposes the existing complete turn Review as an explicit action')
assert.equal(landingSource.includes('Open in tab'), false, 'the master/detail Review does not duplicate workspace-tab actions')
assert.equal(turnReviewSource.includes('showOpenInTab'), false, 'full-turn Review does not expose a second open-in-tab action')
assert.equal(landingSource.includes("previewMode = 'glance'"), true, 'every Review landing defaults to the bounded response-and-files composition')
assert.equal(landingSource.includes("glance && 'line-clamp-2'"), true, 'the master preview bounds long prompts before the full-turn destination')
assert.equal(landingSource.includes('assistant-review-response-fade absolute inset-0 overflow-hidden'), true, 'the first-glance response stays bounded above changed files')
assert.equal(landingSource.includes('<AnimatedHeight'), true, 'See more and Show less reuse the existing anchored collapse component')
assert.equal(landingSource.includes('startViewTransition'), false, 'Review does not maintain a second snapshot animation system')
assert.equal(landingSource.includes("responseDisclosureOpen ? 'Show less' : 'See more'"), true, 'the moving disclosure stays labeled Show less until collapse reaches the See more position')
assert.equal(landingSource.includes('data-collapsing={responseCollapsing'), true, 'the disclosure row exposes its collapse phase as the moving visual anchor')
assert.equal(landingSource.includes('const usePageScroll = !glance || !hasChangedFiles || responseDisclosureOpen'), true, 'the expanded page layout remains stable until the moving disclosure reaches its collapsed position')
assert.equal(rendererCssSource.includes('.assistant-review-response-collapse-scrim'), true, 'a dark gradient attached to the moving disclosure fades response content upward during collapse')
assert.equal(landingSource.includes("'custom-scrollbar h-44 shrink-0 overflow-y-auto"), false, 'expanded response does not add a nested changed-files scrollbar')
assert.equal(landingSource.includes('buildTurnDiffGlimpse'), false, 'the Review landing does not insert a separate diff glimpse above changed files')
assert.equal(landingSource.includes('No diff for this turn'), false, 'unchanged selected turns do not gain a large changed-files empty state')
assert.equal((landingSource.match(/>No diff<\/span>/g) || []).length, 3, 'master rows, selected-turn metadata, and compact Files cells use the same quiet No diff label')
assert.equal(landingSource.includes('{hasChangedFiles ? ('), true, 'the Files changed block exists only when the selected turn changed files')
assert.equal(landingSource.includes('Files changed · {previewTurn.files.length}'), true, 'the area beneath the limited response is the Files changed block')
assert.equal(panelSource.includes('previewMode="glance"'), true, 'the main Inspector Review uses the limited response, See more, and changed-files composition')
assert.equal(utilityWorkspaceHostSource.includes('previewMode="glance"'), true, 'the detached Review landing keeps the same limited response and changed-files composition')
assert.equal(panelSource.includes('onPreviewTurn={selectTurn}'), true, 'selecting a master row hydrates its exact changed-file detail')
assert.equal(utilityWorkspaceHostSource.includes('hydratedTurnIds: new Set(Object.keys(turnDetails))'), true, 'the detached Review cannot mistake index excerpts for hydrated messages')
assert.equal(landingSource.includes('previewTurn.detailLoaded !== false || previewTurn.id === activeTurnId'), true, 'the latest completed message hydrates without changing running-turn handling')
assert.match(rendererCssSource, /\.assistant-review-landing ::-webkit-scrollbar-thumb,[\s\S]*?\.assistant-turn-review ::-webkit-scrollbar-thumb \{\s*border-radius: 0;/, 'Diff page scrollbars keep sharp corners')
assert.equal(rendererCssSource.includes(".assistant-review-navigation-index[data-state='behind']"), true, 'the Review landing exits left while detail enters')
assert.equal(rendererCssSource.includes(".assistant-review-navigation-detail[data-state='ahead']"), true, 'Back reverses detail toward the right without unmounting early')
assert.equal(rendererCssSource.includes('transform 230ms cubic-bezier(0.22, 1, 0.36, 1)'), true, 'shared-axis Review navigation uses the requested restrained timing')
assert.equal(panelSource.includes('assistant-review-full-turn-enter'), true, 'detached full-turn tabs retain their dedicated entrance transition')
assert.equal(rendererCssSource.includes('@keyframes assistant-review-full-turn-enter'), true, 'detached full-turn transition remains in the renderer motion system')
assert.equal(rendererCssSource.includes('@media (prefers-reduced-motion: reduce)'), true, 'the Review transition respects reduced-motion preferences')
assert.equal(turnReviewSource.includes('assistant-turn-review__conversation-pane custom-scrollbar'), true, 'full-turn response remains independently scrollable beside the fixed diff')
assert.equal(turnReviewSource.includes('assistant-turn-review__rail--response-expanded'), true, 'full-turn response expansion changes only the context/files proportions')
assert.equal(rendererCssSource.includes('grid-template-rows: auto minmax(0, 2.6fr) auto minmax(88px, 0.45fr)'), true, 'expanded full-turn response grows while preserving a visible files strip and fixed diff pane')
assert.equal(landingSource.includes('border border-[var(--accent-primary)]/20'), false, 'file counts remain quiet metadata rather than outlined badges')
assert.equal(landingSource.includes('onOpenFile(previewTurn.id, file.target)'), true, 'wide preview file rows open the exact existing detailed diff')
assert.equal(landingSource.includes('INLINE_TOOLBAR_MIN_WIDTH = 720'), true, 'compact Review moves search, filters, and count onto one row whenever they fit')
assert.equal(landingSource.includes("inlineToolbar ? 'min-w-0 flex-1' : 'mb-3 w-full'"), true, 'the toolbar compacts independently of the wider master/detail breakpoint')
assert.equal(landingSource.includes('<div className="sr-only" role="row">'), true, 'compact Review retains semantic column headers without visible table scaffolding')
assert.equal(landingSource.includes('grid-cols-[3rem_minmax(0,1fr)_minmax(12rem,15rem)]'), true, 'the compact Files column stays bounded instead of consuming conversation width')
assert.equal(landingSource.includes('No file changes'), false, 'unchanged compact rows use the shorter No diff copy')
assert.equal(landingSource.includes('rounded-[4px] border border-[color-mix(in_srgb,var(--color-text)_8%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_76%,var(--color-bg))]'), true, 'compact file links use a restrained contrasting pill surface')
assert.match(landingSource, /assistant-review-landing__prompt[\s\S]{0,220}turn\.files\.length > 0 \? 'line-clamp-2 whitespace-normal' : 'truncate'/, 'changed-turn prompts remain bounded to two compact lines')
assert.match(landingSource, /assistant-review-landing__response[\s\S]{0,220}turn\.files\.length > 0 \? 'line-clamp-2 whitespace-normal' : 'truncate'/, 'changed-turn responses never inflate beyond two compact lines')
assert.equal(landingSource.includes("? 'line-clamp-3 whitespace-normal'"), false, 'file-heavy compact responses do not expand to a third line')
assert.equal(turnReviewSource.includes('turn.changes.slice(0, boundedRecordedChangeCount)'), true, 'All changes renders only the current bounded Review batch')
assert.equal(turnReviewSource.includes('This turn remains in the persisted ledger'), false, 'full-turn Review does not stack a history warning onto the missing-agent-response notice')
assert.equal(turnReviewSource.includes('Agent did not respond'), true, 'full-turn Review uses one clear missing-agent-response notice')
assert.equal(turnReviewSource.includes('TriangleAlert'), false, 'the missing-agent-response notice is text-only')
assert.equal(turnReviewSource.includes('exactSelectedChange'), true, 'the compact file rail substitutes the exact activity selected from chat')
assert.equal(turnReviewSource.includes('targetsReferToSameFile(selectedDiff, target)'), true, 'chat-selected paths highlight after canonical path matching')
assert.equal(turnReviewSource.includes('selectedFileIndex >= boundedVisibleFileCount'), true, 'a deep-linked file remains visible beyond every bounded rail batch')
assert.equal(turnReviewSource.includes('attachments={turn.promptAttachments}'), true, 'turn context renders the original prompt attachments beneath You')
assert.equal(reviewPromptAttachmentsSource.includes('resolveClipboardAttachment'), true, 'historical clipboard attachment references resolve through the existing local API')
assert.equal(reviewPromptAttachmentsSource.includes('<AssistantAttachmentImageCard'), true, 'prompt images render as real lazy image cards')
assert.equal(reviewPromptAttachmentsSource.includes('<AssistantPastedTextCard'), true, 'pasted text remains represented in Review prompts')
assert.equal(reviewPromptAttachmentsSource.includes('<AssistantFileAttachmentCard'), true, 'non-image prompt files remain represented in Review prompts')
assert.equal(turnReviewSource.includes('Edit {number} of {total}'), true, 'each repeated file diff engraves its edit position into the Pierre header')
assert.equal(turnReviewSource.includes('formatRecordedEditTime(timestamp)'), false, 'the compact first-row controls do not add a detached timestamp strip')
assert.equal(turnReviewSource.includes('activeFileDiffIndex={activeSelectedFileChangeIndex'), true, 'chat-selected edits still drive exact-section scrolling')
assert.equal(turnReviewSource.includes('Previous recorded edit'), false, 'stacked histories do not duplicate navigation controls on every row')
assert.equal(turnReviewSource.includes('>Selected</span>'), false, 'recorded diff headers do not show a redundant Selected badge')
assert.match(turnReviewSource, /renderRecordedChangeMetadata[\s\S]*?renderCopyPathAction\(change\.target\)[\s\S]*?Edit \{number\} of \{total\}/, 'every recorded row places its own Copy button before Edit x of x')
assert.equal(turnReviewSource.includes('assistant-turn-review__diff-summary'), true, 'All changes and its controls live in one slim persistent diff bar')
assert.equal(turnReviewSource.includes('{renderDiffModeToggle()}'), true, 'the diff view toggle moves into the stable diff summary bar')
assert.equal(turnReviewSource.includes('index === 0 ? renderDiffModeToggle() : null'), false, 'recorded file headers do not duplicate the stable diff view toggle')
assert.equal(turnReviewSource.includes('parsedRecordedChangeEntries'), true, 'repeated paths are parsed as independent FileDiff entries instead of one ambiguous combined patch')
assert.equal(turnReviewSource.includes('change.target.activityId'), true, 'each parsed diff keeps its recorded activity identity')
assert.equal(patchDiffViewerSource.includes('renderFileHeaderMetadata'), true, 'the shared rich viewer supports metadata for each parsed file diff')
assert.equal(patchDiffViewerSource.includes('data-file-diff-entry={index}'), true, 'parsed file entries expose bounded scroll targets')
assert.equal(patchDiffViewerSource.includes('if (settledRenderToken !== renderToken) return'), true, 'exact-edit scrolling waits for rich diff rows to finish layout')
assert.equal(patchDiffViewerSource.includes('absolute right-px top-px'), false, 'per-edit controls are not painted in an early detached overlay')
assert.equal(patchDiffViewerSource.includes('renderHeaderMetadata={renderFileHeaderMetadata'), true, 'per-edit controls use Pierre’s real header slot and load with the row')
assert.equal(panelSource.includes('<AssistantReviewLanding'), true, 'Review retains its landing page')
assert.equal(panelSource.includes('<AssistantInspectorNewTab'), false, 'the Inspector no longer mounts a full-page New tab chooser')
assert.equal(panelSource.includes("kind: 'new'"), false, 'temporary chooser tabs are absent from Inspector state')
assert.equal(panelSource.includes('useState<WorkspaceTab[]>([REVIEW_TAB])'), true, 'a fresh Inspector opens on its useful Review workspace')
assert.equal(panelSource.includes('restoreAssistantInspectorWorkspaceState'), true, 'Inspector restoration merges every persisted workspace with Browser’s authoritative page IDs')
assert.equal(panelSource.includes('persistAssistantInspectorWorkspaceState'), true, 'Inspector tab order and active selection persist per chat')
assert.equal(panelSource.includes('setWorkspaceTabs([REVIEW_TAB, ...restoredBrowserTabs])'), false, 'chat changes no longer discard non-Review and non-Browser workspace tabs')
assert.equal(panelSource.includes('if (!reviewIndexReady) return'), true, 'restored turn tabs wait for the complete Review index before stale IDs are pruned')
assert.equal(inspectorWorkspaceStateSource.includes('ASSISTANT_INSPECTOR_TAB_LIMIT = 32'), true, 'persisted Inspector tabs have a hard bound')
assert.equal(inspectorWorkspaceStateSource.includes('ASSISTANT_INSPECTOR_WORKSPACE_LIMIT = 20'), true, 'per-chat Inspector state retains a bounded workspace history')
assert.equal(existsSync(new URL('../src/renderer/src/pages/assistant/AssistantInspectorNewTab.tsx', import.meta.url)), false, 'the retired bloated chooser source stays deleted')
assert.equal(panelSource.includes("kind: 'explorer'"), true, 'Explorer participates in the shared closable workspace-tab model')
assert.equal(panelSource.includes("import('./AssistantFilesWorkspace')"), true, 'Files and its preview modal load only after the workspace is selected')
assert.equal(panelSource.includes('<AssistantFilesWorkspace'), true, 'the active Files tab mounts its adaptive project workspace')
assert.equal(pageSource.includes('projectPath={diffSource.projectRootPath}'), true, 'Files receives the selected chat project as its filesystem source of truth')
assert.equal(filesWorkspaceSource.includes('useFilePreview()'), true, 'each Files workspace owns stable preview tabs without depending on the main page shell')
assert.equal(filesWorkspaceSource.includes('shellMode='), false, 'Files reuses the centered main-window preview modal')
assert.match(filesPreviewMountSource, /<FilePreviewModal[\s\S]*active=\{active\}/, 'inactive Files tabs retain modal state while the active prop hides presentation')
assert.equal(filesWorkspaceSource.includes('onOpenLinkedPreviewInNewTab={preview.openPreviewInNewTab}'), true, 'Files context actions reuse its modal preview tabs')
assert.equal(explorerWorkspaceSource.includes('<PreviewNavigationSidebar'), true, 'Inspector Explorer reuses the optimized lazy virtual tree and file actions')
assert.equal(explorerWorkspaceSource.includes('window.devscope.getFileTree'), false, 'Inspector Explorer does not create a duplicate filesystem data path')
assert.equal(explorerWorkspaceSource.includes('No project attached'), true, 'projectless chats get an honest empty Explorer state')
assert.equal(panelSource.includes("kind: 'terminal'"), true, 'Terminal participates in the shared closable workspace-tab model')
assert.equal(panelSource.includes("import('./AssistantTerminalWorkspace')"), true, 'Terminal and xterm code load only after workspace selection')
assert.equal(panelSource.includes("activeWorkspaceTab?.kind === 'terminal' ? 'flex min-h-0 flex-1' : 'hidden'"), true, 'Terminal stays mounted while other Inspector tabs are active')
assert.equal(terminalWorkspaceSource.includes('listPreviewTerminalSessions'), true, 'main-process PTY metadata remains the terminal source of truth')
assert.equal(terminalWorkspaceSource.includes("createTerminal('split', 'horizontal')"), true, 'Terminal exposes horizontal splits')
assert.equal(terminalWorkspaceSource.includes("createTerminal('split', 'vertical')"), true, 'Terminal exposes vertical splits')
assert.equal(terminalWorkspaceSource.includes('clearPreviewTerminal'), true, 'Clear removes retained output as well as visible xterm rows')
assert.equal(terminalWorkspaceSource.includes('restartTerminal'), true, 'exited or broken sessions can restart in place')
assert.equal(terminalWorkspaceSource.includes('persistAssistantTerminalWorkspaceState'), true, 'per-chat groups and active terminal survive workspace remounts')
assert.equal(terminalWorkspaceSource.includes('data-terminal-session-group'), true, 'each split layout has a distinct visual group in the Sessions rail')
assert.equal(terminalWorkspaceSource.includes('data-terminal-group-connector'), true, 'terminals shown together share the requested bracket connector')
assert.equal(terminalWorkspaceSource.includes('data-terminal-group-branch'), true, 'each terminal entry visibly joins its group bracket')
assert.equal(terminalWorkspaceSource.includes('rounded-r-[7px]'), false, 'the grouped terminal bracket uses sharp terminal-panel corners')
assert.equal(terminalWorkspaceSource.includes("'pointer-events-none absolute bottom-3 right-0 top-3 w-px'"), true, 'the group uses one crisp vertical spine rather than overlapping borders')
assert.equal(terminalWorkspaceSource.includes("'pointer-events-none absolute -right-3 top-1/2 h-px w-3'"), true, 'each entry meets the spine at one square ninety-degree join')
assert.equal(terminalWorkspaceSource.includes('group/session relative mb-1 flex min-h-6 items-center gap-1 rounded-lg'), false, 'grouped terminal entries remain sharp-cornered')
assert.equal(terminalWorkspaceSource.includes("group.splitDirection === 'vertical'"), true, 'the grouped rail identifies horizontal and vertical split orientation')
assert.equal(terminalWorkspaceSource.includes('No project attached'), true, 'projectless chats get an honest empty Terminal state')
assert.equal(terminalViewportSource.includes('loadPreviewTerminalRuntime'), true, 'Inspector and preview terminals share one lazy xterm runtime')
assert.equal(terminalViewportSource.includes('ResizeObserver'), true, 'each visible terminal fits and resizes its PTY from real pane geometry')
assert.equal(terminalViewportSource.includes("event.code === 'Backquote'"), true, 'focused terminal supports the New Terminal shortcut')
assert.equal(terminalViewportSource.includes("event.code === 'Digit5'"), true, 'focused terminal supports split shortcuts')
assert.equal(terminalRuntimeSource.includes("import('xterm')"), true, 'xterm remains outside the initial Inspector bundle')
assert.equal(previewTerminalHandlerSource.includes("type: 'clear'"), true, 'main process broadcasts durable buffer clears to every mounted terminal surface')
assert.equal(previewTerminalHandlerSource.includes('previewTerminalSessions.get(sessionKey) !== session'), true, 'late events from a restarted or closed PTY cannot affect its replacement')
assert.equal(previewTerminalHandlerSource.includes('Math.max(10, Math.floor(Number(input?.cols)'), true, 'small split panes can report their real PTY column count')
assert.equal(previewTerminalHandlerSource.includes('Math.max(4, Math.floor(Number(input?.rows)'), true, 'small vertical splits can report their real PTY row count')
assert.equal(devscopeApiSource.includes('clearPreviewTerminal'), true, 'clear behavior is part of the typed preload contract')
assert.equal(panelSource.includes("kind: 'browser'"), true, 'Browser participates in the shared closable workspace-tab model')
assert.equal(panelSource.includes("import('./AssistantBrowserWorkspace')"), true, 'Browser and webview code load only after workspace selection')
assert.equal(panelSource.includes("aria-hidden={activeWorkspaceTab?.kind !== 'browser'}"), true, 'inactive Browser workspaces remain mounted but hidden from accessibility')
assert.equal(panelSource.includes("'pointer-events-none invisible absolute inset-0 flex'"), true, 'inactive Browser workspaces fill the Inspector body now that tabs live in the desktop title bar')
assert.match(panelSource, /label: browserTab\?\.url[\s\S]{0,100}\? browserTab\.title \|\| 'New tab'[\s\S]{0,120}: browserTab\?\.sessionMode === 'incognito' \? 'Incognito tab' : 'New tab'/, 'blank Browser pages keep explicit normal and incognito titles')
assert.equal(panelSource.includes('<AssistantBrowserPageIcon faviconUrl={browserTab?.faviconUrl || null}'), true, 'each outer Browser tab mirrors its page favicon')
assert.equal(panelSource.includes("browserTab?.audible ? <Volume2 size={10}"), true, 'audible site state stays attached to its exact outer Browser tab')
assert.equal(panelSource.includes('attention: pendingForTab > 0'), true, 'control approval attention stays attached to its exact outer Browser tab')
assert.equal(inspectorWorkspaceStateSource.includes("kind: 'browser'; browserTabId: string"), true, 'outer Inspector state identifies Browser pages individually')
assert.equal(panelSource.includes('onTabsChange={handleBrowserTabsChange}'), true, 'retained Browser metadata drives the outer Inspector tab list')
assert.equal(inspectorSource.includes('tab.statusIcon'), true, 'Inspector tabs render page status indicators beside their labels')
assert.equal(browserWorkspaceSource.includes('workspaceState.tabs.map((tab)'), true, 'all browser webviews remain mounted while only one page is visible')
assert.equal(browserWorkspaceSource.includes('onClick={() => activateTab(tab.id)}'), false, 'Browser no longer renders a nested tab strip')
assert.equal(browserWorkspaceSource.includes('persistAssistantBrowserWorkspaceState'), true, 'browser tabs and current URLs persist per chat')
assert.equal(browserWorkspaceSource.includes('getBrowserPreviewConfig()'), true, 'credential configuration no longer sends a chat or project workspace key')
assert.equal(browserWorkspaceSource.includes('Local Zyra profile'), true, 'Browser identifies its shared local credential scope')
assert.equal(browserWorkspaceSource.includes('clearBrowserPreviewData()'), true, 'users can explicitly clear the global local profile')
assert.equal(browserWorkspaceSource.includes('Clear now'), true, 'clearing shared credentials requires a deliberate second click')
assert.equal(browserWorkspaceSource.includes('getRunningLocalServers(normalizedProjectPath)'), true, 'New tab uses the bounded main-owned local server inventory')
assert.equal(browserNewTabSource.includes('Other local servers'), true, 'New tab separates servers outside the selected chat project')
assert.equal(browserNewTabSource.includes('onOpenInNewTab(server.url)'), true, 'every running server can open in a separate Browser tab')
assert.equal(processDetectorSource.includes('detectLocalHttpProtocol'), true, 'local port discovery exposes only browser-openable HTTP or HTTPS listeners')
assert.equal(processDetectorSource.includes('attachedToProject'), true, 'the server source classifies current-project and other local listeners')
assert.equal(browserWorkspaceSource.includes('openBrowserPreviewExternal'), true, 'the active HTTP page can open through the guarded external-link owner')
assert.equal(browserWorkspaceSource.includes('onTabsChange(threatWarning ?'), true, 'Browser publishes page title, favicon, audio, loading, and threat state through one retained model')
assert.equal(browserWorkspaceSource.includes('onAudibleChange'), false, 'Browser does not duplicate page status through an aggregate workspace callback')
assert.equal(browserWorkspaceSource.includes('No project attached'), true, 'projectless chats get an honest empty Browser state')
assert.equal(browserWebviewSource.includes('data-assistant-browser-view-slot'), true, 'renderer Browser pages expose only native-view slots')
assert.equal(browserWebviewSource.includes("createElement('iframe'"), false, 'Browser does not inherit iframe frame-policy limitations')
assert.equal(browserViewManagerSource.includes("page.on('did-navigate'"), true, 'live Chromium navigation updates Browser metadata')
assert.equal(browserViewManagerSource.includes("page.on('did-start-navigation'"), true, 'top-level Chromium navigation owns Browser loading state')
assert.equal(browserViewManagerSource.includes('if (!isMainFrame) return'), true, 'subframes cannot restart the page loading indicator')
assert.equal(browserViewManagerSource.includes("page.on('did-start-loading'"), false, 'generic webContents loading pulses cannot revive the refresh state after the main page settles')
assert.equal(browserViewManagerSource.includes("page.on('did-finish-load'"), true, 'main-frame completion settles the Browser loading state')
assert.equal(browserViewManagerSource.includes("page.on('page-favicon-updated'"), true, 'Chromium page favicons enter the retained tab model')
assert.equal(browserViewManagerSource.includes("page.on('did-fail-load'"), true, 'main-frame load failures have an explicit state')
assert.equal(browserWorkspaceSource.includes('<AssistantBrowserPageIcon faviconUrl={activeTab.faviconUrl}'), true, 'the address bar mirrors the selected page favicon')
assert.equal(browserWorkspaceSource.includes('onActiveFaviconChange'), false, 'Browser does not duplicate favicon state outside its page model')
assert.equal(browserPageIconSource.includes('referrerPolicy="no-referrer"'), true, 'favicon image requests do not disclose the Zyra renderer URL')
assert.equal(browserPageIconSource.includes('if (directCandidate) setCandidateIndex((current) => current + 1)'), true, 'broken page favicons advance through the bounded fallback chain')
assert.equal(browserPageIconSource.includes('window.devscope?.getBrowserPageIcon'), true, 'CORP-blocked site icons fall back through trusted Zyra chrome')
assert.equal(browserViewManagerSource.includes("page.on('media-started-playing'"), true, 'Chromium media starts trigger an audio-state check')
assert.equal(browserViewManagerSource.includes("page.on('media-paused'"), true, 'Chromium media pauses clear or reconcile the audio mark')
assert.equal(browserViewManagerSource.includes('page.isCurrentlyAudible()'), true, 'muted video does not create a false site-audio mark')
assert.equal(browserViewManagerSource.includes('record.view.setVisible'), true, 'retained Browser pages stay attached while main owns presentation')
assert.equal(browserViewportFrameSource.includes("data-active={visible ? 'true' : 'false'}"), true, 'inactive Browser pages transition through the retained viewport frame')
assert.equal(browserWorkspaceSource.includes('placement="full"'), true, 'the selected Browser page owns the full Inspector body')
assert.equal(browserWorkspaceSource.includes('setAssistantBrowserLayout'), false, 'Browser pages no longer compete inside a nested split layout')
assert.equal(browserWorkspaceSource.includes('Show two Browser tabs side by side'), false, 'the inner split control is removed')
assert.equal(browserWorkspaceSource.includes('splitTabId: null'), true, 'Browser workspace snapshots expose one visible outer page at a time')
assert.equal(browserWorkspaceSource.includes('consumedNavigationRequestsRef'), true, 'resource links enter Browser through a bounded one-shot request')
assert.equal(panelSource.includes("kind: 'resources'"), true, 'Resources participates in the shared closable workspace-tab model')
assert.equal(panelSource.includes("import('./AssistantResourcesWorkspace')"), true, 'the Resources index and UI load only after workspace selection')
assert.equal(panelSource.includes("activeWorkspaceTab?.kind === 'resources' ? 'flex min-h-0 flex-1' : 'hidden'"), true, 'Resources retains search, filter, and scroll state across Inspector tab switches')
assert.equal(panelSource.includes('onOpenUrl={handleOpenResourceUrl}'), true, 'resource links route through the retained Browser owner')
assert.equal(panelSource.includes('onOpenDiff={handleOpenResourceDiff}'), true, 'changed resources route to their exact Review target')
assert.equal(resourcesWorkspaceSource.includes('buildAssistantResourceIndex({ turns, projectPath })'), true, 'Resources projects the persisted Review turn model instead of fetching duplicate chat state')
assert.equal(resourcesWorkspaceSource.includes('window.devscope.getFileTree'), false, 'Resources does not create another filesystem source')
assert.equal(resourcesWorkspaceSource.includes('usePreviewVirtualWindow'), true, 'large resource tables mount only their visible fixed-height rows')
assert.equal(resourcesWorkspaceSource.includes('role="table"'), true, 'Resources presents one compact semantic table')
assert.equal(resourcesWorkspaceSource.includes('aria-rowindex={rangeStart + rowOffset + 2}'), true, 'virtualized resource rows expose their absolute table position')
assert.equal(resourcesWorkspaceSource.includes('grid grid-cols-2'), false, 'Resources no longer duplicates destinations across preview cards')
assert.equal(resourcesWorkspaceSource.includes('<ResourceImagePreview resource={resource}'), true, 'image rows retain real thumbnail previews')
assert.equal(resourcesWorkspaceSource.includes('<ResourceLinkPreview resource={resource}'), false, 'link rows use their resolved destination instead of a second card-preview surface')
assert.equal(resourcesWorkspaceSource.includes("const location = resource.url || resource.path"), true, 'each table row exposes its resolved URL or local path')
assert.equal(resourcesWorkspaceSource.includes('referrerPolicy="no-referrer"'), true, 'remote image thumbnails do not disclose the chat page as their referrer')
assert.equal(assistantLinkPreviewCacheSource.includes('LINK_PREVIEW_RENDERER_CACHE_LIMIT = 200'), true, 'website metadata requests share a bounded renderer cache')
assert.equal(assistantLinkPreviewCacheSource.includes('pendingLinkPreviews'), true, 'concurrent cards deduplicate metadata requests')
assert.equal(browserLinkPreviewSource.includes('MAX_LINK_PREVIEW_HTML_BYTES = 256 * 1024'), true, 'website metadata reads have a strict response-size cap')
assert.equal(browserLinkPreviewSource.includes('LINK_PREVIEW_TIMEOUT_MS = 5_000'), true, 'website metadata reads have a short timeout')
assert.equal(browserLinkPreviewSource.includes('{ base: 0x7f000000, prefix: 8 }'), true, 'website metadata blocks the IPv4 loopback range')
assert.equal(browserLinkPreviewSource.includes('addresses.some((entry) => !isPublicBrowserLinkPreviewAddress'), true, 'every resolved DNS address must be public')
assert.equal(browserLinkPreviewSource.includes('fetchBrowserLinkPreviewHtml(redirectUrl.toString()'), true, 'every metadata redirect repeats URL and DNS validation')
assert.equal(browserPreviewHandlerSource.includes('LINK_PREVIEW_CACHE_LIMIT = 100'), true, 'main-process metadata has a bounded shared cache')
assert.equal(browserPreviewHandlerSource.includes('LINK_PREVIEW_PENDING_LIMIT = 100'), true, 'website cards cannot create an unbounded main-process request queue')
assert.equal(browserPreviewHandlerSource.includes('LINK_PREVIEW_CONCURRENCY_LIMIT = 4'), true, 'website metadata uses a small connection pool')
assert.equal(browserPreviewHandlerSource.includes('pendingLinkPreviews'), true, 'main-process metadata requests are deduplicated')
assert.equal(resourcesWorkspaceSource.includes('MarkdownSiteIcon host={host}'), true, 'link previews request favicons with hostnames only')
assert.equal(resourcesWorkspaceSource.includes('openAssistantFileTarget'), true, 'local image cards reuse the existing preview owner and path contract')
assert.equal(resourcesWorkspaceSource.includes('resolveClipboardAttachment'), true, 'clipboard image cards resolve through the existing private attachment owner')
assert.equal(resourcesWorkspaceSource.includes('<AssistantAttachmentPreviewModal'), true, 'retained inline images reuse the existing attachment preview')
assert.equal(resourcesLibrarySource.includes("export type ResourceKindFilter = 'all' | 'images' | 'links'"), true, 'Resources exposes only image and link filters')
assert.equal(resourcesWorkspaceSource.includes("RESOURCE_FILTERS.filter((entry) => entry.id !== 'all' && kindCounts[entry.id] > 0)"), true, 'empty resource filter tags stay hidden')
assert.equal(resourcesWorkspaceSource.includes('const showResourceFilters = availableTypeFilters.length > 1'), true, 'resource filters appear only when both resource kinds make filtering useful')
assert.equal(resourcesWorkspaceSource.includes("? 'bg-[var(--surface-active)] text-sparkle-text'"), true, 'the active resource filter uses a quiet theme-neutral surface')
assert.equal(resourcesWorkspaceSource.includes('bg-[var(--accent-primary)]/[0.09]'), false, 'resource filters avoid the old muddy accent highlight')
assert.equal(resourcesWorkspaceSource.includes('<span>{visibleResources.length} of {resourceIndex.resources.length} resources</span>'), false, 'the redundant summary row beneath resource filters stays removed')
assert.equal(resourceIndexSource.includes("export type AssistantResourceKind = 'image' | 'link'"), true, 'code files and generic attachments are absent from the Resources model')
assert.equal(resourceIndexSource.includes('if (!isImageAttachment(attachment)) continue'), true, 'non-image attachments are rejected at the index boundary')
assert.equal(resourceIndexSource.includes('IMAGE_EXTENSIONS.has'), true, 'local changed and mentioned files enter Resources only when they are images')
assert.equal(resourceIndexSource.includes('ASSISTANT_RESOURCE_INDEX_LIMIT = 500'), true, 'the resource read model has a hard identity bound')
assert.equal(resourceIndexSource.includes('ASSISTANT_RESOURCE_TURN_LIMIT = 2_000'), true, 'resource extraction scans a bounded newest-first turn window')
assert.equal(resourceIndexSource.includes('ASSISTANT_RESOURCE_TEXT_BUDGET = 2_000_000'), true, 'resource extraction has a total persisted-text budget')
assert.equal(resourceIndexSource.includes('resources.size >= ASSISTANT_RESOURCE_INDEX_LIMIT'), true, 'full resource indexes stop scanning text that cannot add a visible identity')
assert.equal(resourceIndexSource.includes('ASSISTANT_RESOURCE_ORIGIN_LIMIT = 24'), true, 'deduplicated resources retain a bounded origin history')
assert.equal(resourceIndexSource.includes('resolveMarkdownPackageReference'), true, 'package references are classified before filesystem paths')
assert.equal(resourceIndexSource.includes('trimUrlBoundaryPunctuation'), true, 'plain URL extraction removes unmatched Markdown closing punctuation')
assert.equal(resourceIndexSource.includes('const references = new Map<string, ExtractedTextReference>()'), true, 'overlapping Markdown and plain scanners deduplicate before indexing occurrences')
assert.equal(resourceIndexSource.includes('getAssistantLinkBaseFilePath'), true, 'relative resources resolve against the selected chat project')
assert.equal(browserPreviewHandlerSource.includes("ZYRA_BROWSER_GLOBAL_PROFILE_KEY = 'zyra-global-browser-profile:v1'"), true, 'the main process owns one stable versioned Browser profile identity')
assert.match(browserViewManagerSource, /input\.sessionMode === 'incognito'[\s\S]{0,120}this\.acquireIncognitoSession\(input\.tabId\)[\s\S]{0,120}: getGlobalBrowserSession\(\)[\s\S]{0,180}session: browserSession/, 'main selects the exact global or isolated incognito Browser session before page creation')
assert.equal(browserPreviewHandlerSource.includes("createHash('sha256')"), true, 'the fixed local profile identity becomes an opaque bounded partition name')
assert.equal(browserPreviewHandlerSource.includes('clearStorageData()'), true, 'explicit profile clearing removes cookies and website storage')
assert.equal(browserPreviewHandlerSource.includes('clearCache()'), true, 'explicit profile clearing removes Chromium network cache')
assert.equal(browserPreviewHandlerSource.includes('clearAuthCache()'), true, 'explicit profile clearing removes HTTP authentication state')
assert.equal(browserPreviewHandlerSource.includes('cookies.flushStore()'), true, 'cleared cookie state is flushed to local storage')
assert.equal(browserPreviewHandlerSource.includes('setPermissionRequestHandler'), true, 'browser guests deny site permissions by default')
assert.equal(browserPreviewHandlerSource.includes('getBrowserDownloadService().attachSession(browserSession, isAuthorizedBrowserPermissionTarget)'), true, 'registered Browser guests delegate downloads to the bounded main-owned manager')
assert.equal(browserPreviewHandlerSource.includes("parsed.protocol === 'http:' || parsed.protocol === 'https:'"), true, 'main process allows only HTTP and HTTPS external navigation')
assert.equal(desktopMainSource.includes('webviewTag: false'), true, 'trusted shell renderers cannot create Browser guests')
assert.equal(browserViewManagerSource.includes('sandbox: true'), true, 'main-owned pages are forced into Chromium sandboxing')
assert.equal(browserViewManagerSource.includes('nodeIntegration: false'), true, 'main-owned web pages never receive Node integration')
assert.equal(browserViewManagerSource.includes('contextIsolation: true'), true, 'page globals remain isolated')
assert.equal(browserViewManagerSource.includes("page.on('will-navigate'"), true, 'unsupported page navigation is blocked throughout its lifetime')
assert.equal(projectsPreloadSource.includes("devscope:browserPreview:getConfig"), true, 'Browser configuration crosses the typed preload bridge')
assert.equal(projectsPreloadSource.includes("devscope:browserPreview:clearData"), true, 'local profile clearing crosses the typed preload bridge')
assert.equal(ipcHandlersSource.includes("ipcMain.handle('devscope:browserPreview:clearData'"), true, 'main process owns the destructive Browser-data action')
assert.equal(projectsPreloadSource.includes("devscope:browserPreview:getLinkPreview"), true, 'website metadata crosses the typed preload bridge')
assert.equal(projectsPreloadSource.includes("devscope:getRunningLocalServers"), true, 'running local servers cross the typed preload bridge')
assert.equal(ipcHandlersSource.includes("ipcMain.handle('devscope:getRunningLocalServers'"), true, 'main owns running-server discovery')
assert.equal(devscopeApiSource.includes('getRunningLocalServers'), true, 'running-server discovery is a typed Desktop contract')
assert.equal(devscopeApiSource.includes("profileScope: 'global'"), true, 'Browser configuration declares the global credential scope')
assert.equal(devscopeApiSource.includes('clearBrowserPreviewData'), true, 'Browser data control is part of the shared desktop contract')
assert.equal(devscopeApiSource.includes('DevScopeBrowserPreviewConfig'), true, 'Browser configuration is part of the shared desktop contract')
assert.equal(devscopeApiSource.includes('DevScopeBrowserLinkPreview'), true, 'website preview metadata has a shared renderer contract')
assert.equal(panelSource.includes('turn:${turnId}'), true, 'turn reviews can open as sidebar-local tabs')
assert.equal(panelSource.includes('setFocusedDiffRequestId(revealRequest.id)'), true, 'the Review detail keeps the active chat deep-link request after consuming the page event')
assert.equal(panelSource.includes('onRevealRequestHandled(revealRequest.id)'), true, 'chat deep-link requests are consumed once rather than replayed whenever Inspector opens')
assert.match(panelSource, /const handleOpenTurnInTab[\s\S]*?setReviewTurnId\(null\)[\s\S]*?setWorkspaceTabs/, 'opening a turn tab returns the source Review tab to its landing page')
assert.equal(panelSource.includes('setWorkspaceTabs'), true, 'all Inspector tabs share one closable workspace model')
assert.equal(panelSource.includes('if (next.length === 0)'), true, 'closing the last workspace tab closes Inspector')
assert.equal(panelSource.includes('withoutChooser'), false, 'workspace selection no longer replaces a temporary chooser tab')
assert.equal(inspectorSource.includes('onAddTab'), false, 'the tab rail does not create a synthetic New tab')
assert.equal(inspectorSource.includes('<FileActionsMenu'), true, 'the plus action opens the compact workspace picker directly')
assert.equal(inspectorSource.includes('items={addTabItems}'), true, 'the picker receives one live action list from the Inspector owner')
assert.equal(inspectorSource.includes('triggerIcon={<Plus size={13} />}'), true, 'the compact plus trigger remains beside the tabs')
assert.equal(inspectorSource.includes('density="compact"'), true, 'the workspace picker uses T3-scale menu geometry without shrinking other app menus')
assert.equal(inspectorSource.includes('menuClassName="w-[190px]"'), false, 'the Inspector no longer forces an oversized picker width')
assert.match(panelSource, /id: 'browser',[\s\S]{0,80}label: 'Browser'/, 'Browser is available from the workspace picker')
assert.equal(panelSource.includes("{ id: 'terminal', label: 'Terminal'"), true, 'Terminal is available from the workspace picker')
assert.equal(panelSource.includes("{ id: 'explorer', label: 'Files'"), true, 'Files uses T3’s compact Lucide surface identity')
assert.equal(panelSource.includes("{ id: 'review', label: 'Diff'"), true, 'Diff uses T3’s compact Lucide surface identity')
assert.equal(panelSource.includes("{ id: 'resources', label: 'Resources'"), true, 'Resources is available from the workspace picker')
assert.equal(panelSource.includes("{ id: 'agents', label: 'Agents'"), true, 'Agents is available from the workspace picker')
assert.equal(panelSource.includes("{ id: 'control', label: 'Thread Details'"), true, 'Thread Details replaces Control and leads the workspace picker')
assert.equal(fileActionsMenuSource.includes("presentation = 'portal'"), true, 'the shared picker anchors above desktop content instead of changing title-bar layout')
assert.equal(fileActionsMenuSource.includes("const resolvedMenuWidth = menuWidth || (compact ? 176 : 180)"), true, 'compact menus keep their default width while callers may request wider measured surfaces')
assert.equal(
    fileActionsMenuSource.includes("? 'min-h-8 px-2 py-1.5 text-[11px] leading-none'")
        && fileActionsMenuSource.includes(": compact ? 'rounded-[4px]' : 'rounded-md'"),
    true,
    'compact workspace rows retain the readable 32px menu rhythm'
)
assert.equal(fileActionsMenuSource.includes('updatePosition'), true, 'the workspace picker follows its compact plus trigger')
assert.equal(fileActionsMenuSource.includes('items.map((item)'), true, 'the picker renders supplied workspace actions without fake tabs')
assert.equal(inspectorSource.includes('justify-start'), true, 'workspace tab labels align left')
assert.equal(landingSource.includes('Review this chat'), true)
assert.equal(landingSource.includes("'with-changes'"), true)
assert.equal(landingSource.includes("'without-changes'"), true)
assert.equal(landingSource.includes('LATEST_TURN_LIMIT'), true)
assert.equal(landingSource.includes('INITIAL_VISIBLE_TURNS'), true, 'review index rows mount in bounded batches')
assert.equal(landingSource.includes('Show earlier turns · {hiddenTurnCount} remaining'), true, 'Review exposes the hidden full-index count after visible rows')
assert.match(landingSource, /visibleTurns\.map[\s\S]*\{renderEarlierTurnsButton\(\)\}/, 'the earlier-turn control follows the visible index rows')
assert.equal(landingSource.includes('Message history unavailable'), false, 'missing agent responses do not add a redundant message-history warning')
assert.equal(landingSource.includes('Agent did not respond'), true, 'rows use the normal missing-agent-response warning')
assert.equal(turnReviewSource.includes('persisted ledger, but its stored prompt and response are unavailable'), false, 'full-turn Review omits the redundant history warning')
assert.equal(landingSource.includes('turn.response'), true, 'each row previews the final agent response')
assert.equal(landingSource.includes('role="table"'), true, 'Review renders the complete chat index as a table')
assert.equal(landingSource.includes('role="columnheader"'), true, 'the turn, conversation, and files columns are explicit')
assert.equal(landingSource.includes('Complete chat turn index'), true)
assert.equal(landingSource.includes('<FileEntryIcon'), true, 'file links use the shared local Material icon system')
assert.equal(landingSource.includes('onOpenFile(turn.id, file.target)'), true, 'each indexed file opens its exact recorded change')
assert.equal(landingSource.includes('VISIBLE_FILE_LINK_LIMIT'), true, 'file links remain bounded per row')
assert.equal(landingSource.includes('useDeferredValue(query)'), true, 'search input remains responsive while the full index filters')
assert.equal(landingSource.includes('turn.searchText.includes'), true, 'Review search consumes the prebuilt lightweight index')
assert.equal(landingSource.includes('>Agent response</h3>'), true, 'the final response keeps an explicit agent-owned section label')
assert.equal(landingSource.includes("{ready ? turns.length : '—'} turns"), true, 'Review never presents a loaded-page count as the complete total')
assert.equal(landingSource.includes('Building the complete turn index'), true, 'the table waits for its authoritative persisted index')
assert.equal(landingSource.includes('View full turn <ArrowRight'), true, 'turns can still open in dedicated workspace tabs')
assert.equal(landingSource.includes('event.stopPropagation()'), true, 'file and tab links stay separate from the row action')
assert.equal(landingSource.includes('role="row"'), true, 'each visible turn is an accessible table row')
assert.equal(reviewIndexSource.includes("patch: ''"), true, 'the landing index never transports full diff bodies')
assert.equal(reviewIndexSource.includes('detailLoaded: false'), true, 'index-only rows request full data only when opened')
assert.equal(persistenceHistorySource.includes('readAssistantReviewIndex'), true, 'SQLite owns the complete Review index')
assert.equal(persistenceHistorySource.includes('ROW_NUMBER() OVER'), true, 'the index selects only the final agent response per turn')
assert.equal(persistenceHistorySource.includes("kind = 'file-change'"), true, 'the index loads only file-change metadata rather than every activity')
assert.equal((inspectorSource.match(/zyra-inspector-surface/g) || []).length >= 1, true, 'the compact Inspector tab rail uses the theme-derived desktop chrome surface')
assert.equal(inspectorSource.includes('bg-[color-mix(in_srgb,var(--color-text)_9%,var(--surface-inspector-tab))] text-sparkle-text'), true, 'the active rounded workspace tab has a stronger theme-derived contrast surface')
assert.equal(turnReviewSource.includes('border-b border-white/[0.06] bg-[color-mix(in_srgb,var(--color-bg)_95%,black)] px-2.5'), true, 'the wide turn header retains its focused rich-content surface')
assert.equal(inspectorSource.includes('>Inspector</h2>'), false, 'the redundant Inspector title row is removed')
assert.equal(inspectorSource.includes('aria-label="Close Inspector"'), false, 'the redundant inner collapse action is absent from the compact tab strip')
assert.equal(inspectorSource.includes('top-2'), true, 'tab previews align immediately below the merged desktop tab strip')
assert.equal(inspectorSource.includes('rounded-md border border-transparent'), true, 'workspace tabs use T3-style flat rounded tab geometry')
assert.equal(inspectorSource.includes('rounded-t-md border border-b-0'), false, 'the merged title bar does not retain the detached browser-tab ledge')
assert.equal(inspectorSource.includes('MAX_WORKSPACE_TAB_WIDTH = 168'), true, 'workspace tabs expand across a wide Inspector without becoming oversized')
assert.equal(inspectorSource.includes('MIN_WORKSPACE_TAB_WIDTH = 74'), true, 'all workspace tabs shrink together only to the readable floor')
assert.equal(inspectorSource.includes('width: collapsing ? 0 : targetWorkspaceTabWidth'), true, 'new tabs mount directly at the final shared width while explicit collapse animates to zero')
assert.equal(inspectorSource.includes('previousTabWidthsRef'), true, 'existing tabs retain their prior displayed width for animation')
assert.equal(inspectorSource.includes('min-w-0 flex-1 truncate'), true, 'Review and other tab labels can shrink and ellipsize beside fixed metadata')
assert.equal(inspectorSource.includes('shrink-0 font-mono'), true, 'tab counts remain stable while labels truncate')
assert.equal(inspectorSource.includes('element.animate('), true, 'existing tab pills animate directly from displayed width to final width')
assert.equal(inspectorSource.includes('duration: 240'), true, 'tab compression uses a short browser-like duration')
assert.equal(inspectorSource.includes("easing: 'cubic-bezier(0.22, 1, 0.36, 1)'"), true, 'tab compression uses a smooth browser-style easing curve')
const inspectorWorkspaceTabStyle = rendererCssSource.match(/\.inspector-workspace-tab\s*\{([\s\S]*?)\}/)?.[1] || ''
assert.doesNotMatch(inspectorWorkspaceTabStyle, /\bwidth\b/, 'a competing CSS width transition cannot fight the direct layout animation')
assert.equal(inspectorSource.includes('DndContext'), true, 'workspace tabs use the shared reactive drag-and-drop runtime')
assert.equal(inspectorSource.includes('DragOverlay'), true, 'the dragged workspace tab lifts into a real pointer-following preview')
assert.equal(inspectorSource.includes('horizontalListSortingStrategy'), true, 'neighboring tabs move continuously around the dragged preview')
assert.equal(inspectorSource.includes('CSS.Transform.toString(transform)'), true, 'sortable tab transforms follow dnd-kit measurements rather than native drag ghosts')
assert.equal(inspectorSource.includes("activationConstraint: { distance: 4 }"), true, 'ordinary tab clicks remain distinct from deliberate dragging')
assert.equal(inspectorSource.includes('draggable='), false, 'native HTML drag ghosts no longer control Inspector tab movement')
assert.equal(inspectorSource.includes('requestTabClose'), true, 'tab removal waits for its close transition')
assert.equal(inspectorSource.includes('inspector-tab-out_130ms'), true, 'closing tabs play the reverse of their entrance motion')
assert.equal(panelSource.includes('handleReorderTab'), true, 'dragged tab order is persisted in workspace state')
assert.equal(inspectorSource.includes('separatedFromPrevious'), false, 'the merged T3-style tab row does not draw separators between pills')
assert.equal(inspectorSource.includes('overflow-hidden px-2'), true, 'the merged tab rail keeps restrained title-bar padding around its scrolling contents')
assert.equal(inspectorSource.includes('overflow-x-auto overscroll-x-contain'), true, 'overflowing Inspector tabs scroll within the padded rail')
assert.equal(inspectorSource.includes('requestAnimationFrame'), true, 'Inspector resizing is frame-throttled')
assert.equal(inspectorSource.includes('synchronizeTabWidths(latest.width)'), true, 'tab widths follow the Inspector on the same resize animation frame')
assert.equal(inspectorSource.includes("setProperty('transition', 'none')"), true, 'width interpolation is disabled during direct manipulation')
assert.equal(inspectorSource.includes('tab.preview'), true, 'workspace tabs expose delayed browser-style hover previews')
assert.equal(inspectorSource.includes('}, 650)'), true, 'tab previews wait for deliberate hover intent')
assert.equal(inspectorSource.includes('previewDismissTimerRef'), true, 'tab previews automatically expire')
assert.equal(inspectorSource.includes('top-2'), true, 'the compact tab-preview bubble begins just below the global title bar')
assert.equal(inspectorSource.includes('w-[184px] rounded-2xl'), true, 'tab previews use the smaller rounded bubble treatment')
assert.equal(inspectorSource.includes('dismissTabPreview()'), true, 'tab selection and closure immediately dismiss hover previews')
assert.equal(inspectorSource.includes('<LoaderCircle'), true, 'loading replaces the tab favicon with a browser-style spinner')
assert.equal(inspectorSource.includes('inspector-tab-loading'), true, 'workspace loading state is visible in the matching tab')
assert.equal(rendererCssSource.includes('transform: scaleX(0.88)'), true, 'the tab loading track advances and waits like browser progress')
assert.equal(panelSource.includes('onLoadingChange={handleTurnLoadingChange}'), true, 'real turn-diff rendering drives the active tab loading state')
assert.equal(patchDiffViewerSource.includes('settledRenderToken !== renderToken'), true, 'a new diff enters rendering state synchronously instead of one paint later')
assert.equal(patchDiffViewerSource.includes('key={renderToken}'), true, 'Pierre diff elements remount per render token rather than retaining stale custom-element contents')
assert.equal(patchDiffViewerSource.includes("background: 'color-mix(in srgb, var(--color-bg) 95%, black)'"), true, 'the opaque loading surface hides the previous diff and matches the Review page')
assert.equal(turnReviewSource.includes('requestAnimationFrame'), true, 'heavy selected-diff preparation starts after the turn page can paint')
assert.equal(turnReviewSource.includes('onLoadingChange?.(false)'), true, 'leaving a turn clears its tab loading animation')
assert.equal(panelSource.includes('setContentLoadingTabId((current) => current === tabId ? null : current)'), true, 'closing a tab clears stale loading state')
assert.equal(landingSource.includes('[content-visibility:auto]'), false, 'Review rows stay painted so hover does not trigger materialization jank')
assert.equal(landingSource.includes('transition-[background-color,box-shadow] duration-75'), true, 'Review hover feedback uses a short low-latency transition')
assert.equal(inspectorSource.includes('handleTabRailWheel'), true, 'wheel and trackpad input navigate an overflowing tab rail')
assert.equal(inspectorSource.includes('no-scrollbar'), true, 'the overflowing tab rail does not expose a scrollbar')
assert.equal(inspectorSource.includes('rail.scrollLeft += delta'), true, 'vertical or horizontal wheel deltas move through hidden tabs')
assert.equal(composerSource.includes('event.stopPropagation()'), true, 'textarea wheel input does not leak into the conversation while it can scroll')
assert.equal(composerSource.includes('element.scrollTop > 1'), true, 'upward overflow reaches the conversation only after the textarea is already at its top limit')
assert.equal(composerSource.includes('maxScrollTop - element.scrollTop > 1'), true, 'downward overflow reaches the conversation only after the textarea is already at its bottom limit')
assert.equal(turnReviewSource.includes('memo(function AssistantTurnReview'), true, 'tab loading updates do not reconcile the heavy turn page unnecessarily')
assert.equal(landingSource.includes('memo(function AssistantReviewLanding'), true, 'workspace chrome updates do not reconcile the Review list unnecessarily')
assert.equal(inspectorSource.includes('aria-label="Workspace tabs"'), true)
assert.equal(inspectorSource.includes('overflow-x-auto border-b'), false, 'the workspace tab strip has no separating rule beneath it')
assert.equal(turnReviewSource.includes('visibleFiles.map'), true, 'the dedicated view bounds its initial file list')
assert.equal(turnReviewSource.includes('current + INITIAL_VISIBLE_FILES'), true, 'large Review file lists reveal one bounded batch per click')
assert.equal(turnReviewSource.includes('Load {nextVisibleFileBatchSize} more files'), true, 'the Review file control states the next bounded batch instead of offering every remaining file')
assert.equal(turnReviewSource.includes('setShowAllFiles'), false, 'the Review file rail cannot expand every remaining file in one update')
assert.equal(turnReviewSource.includes('renderedChangesPatch'), true, 'the raw fallback is bounded to the currently revealed Review batch')
assert.equal(turnReviewSource.includes('fileDiffs={parsedRecordedChangeEntries.map((entry) => entry.fileDiff)}'), true, 'all changes sends independently parsed files to the multi-file renderer instead of crashing PatchDiff with a multi-file patch')
assert.equal(turnReviewSource.includes('allChangesPatch'), false, 'Review no longer builds an eager patch containing every recorded change')
assert.equal(turnReviewSource.includes('current + RENDERED_CHANGE_BATCH_SIZE'), true, 'the full diff reveals recorded changes in bounded batches')
assert.equal(turnReviewSource.includes('Render {nextRecordedChangeBatchSize} more changes'), true, 'the diff batch control states how many changes it will render next')
assert.equal(patchDiffViewerSource.includes('fileDiffs.map'), true, 'the shared viewer renders multiple parsed FileDiff entries inside one scroll surface')
assert.equal(turnReviewSource.includes('hideChangeIcon={false}'), false, 'recorded diff rows remove Pierre’s blue change dot')
assert.equal(turnReviewSource.includes('renderRecordedChangeStatus'), true, 'recorded diff rows replace the blue dot with shared Git status pills')
assert.equal(turnReviewSource.includes('assistant-turn-review__rail'), true, 'wide turn pages keep conversation and changed files in a dedicated context rail')
assert.equal(turnReviewSource.includes("type NarrowReviewSurface = 'diff' | 'review'"), true, 'narrow turn pages combine context and files into one full-width review surface')
assert.equal(turnReviewSource.includes("focusSelectedDiffRequestId === null ? 'review' : 'diff'"), true, 'thin chat deep links open directly on Diff while normal turns open on Context and files')
assert.equal(turnReviewSource.includes("setNarrowSurface(focusSelectedDiff ? 'diff' : 'review')"), true, 'repeated chat deep links switch an already-mounted thin turn to Diff')
assert.equal(turnReviewSource.includes('setShowAllChanges(!focusSelectedDiff && turn.changes.length > 0)'), true, 'chat deep links leave All changes and open the selected file revision directly')
assert.equal(turnReviewSource.includes('INITIAL_RENDERED_CHANGES = 4'), true, 'All changes initially mounts only a small diff batch')
assert.equal((turnReviewSource.match(/h-9 min-w-0 flex-1/g) || []).length >= 2, true, 'thin review tabs divide the available width evenly')
assert.equal(turnReviewSource.includes('assistant-turn-review__narrow-diff-stats'), true, 'the thin Diff tab carries the complete turn impact bar')
assert.equal(turnReviewSource.includes("title={!diffSupportsSplit || isNarrowLayout ? 'Split view needs a wider diff pane'"), true, 'the first-row view toggle remains visible and explains when split mode is unavailable')
assert.equal(turnReviewSource.includes('Resize turn context sidebar'), true, 'wide turn pages expose a dedicated rail resize handle')
assert.equal(turnReviewSource.includes('requestAnimationFrame(applyPendingRailWidth)'), true, 'rail resizing is frame-throttled')
assert.equal(turnReviewSource.includes('TURN_REVIEW_RAIL_DEFAULT_WIDTH = 320'), true, 'the wide turn rail starts with more room')
assert.equal(turnReviewSource.includes('TURN_REVIEW_WIDE_MIN_WIDTH = 760'), true, 'the persistent wide review layout activates at the lower requested threshold')
assert.equal(turnReviewSource.includes('TURN_REVIEW_SPLIT_MIN_WIDTH = 680'), true, 'split rendering is based on actual remaining diff width')
assert.equal(turnReviewSource.includes("effectiveRenderMode = isNarrowLayout || !diffSupportsSplit ? 'stacked' : renderMode"), true, 'cramped wide and thin review panes both fall back to unified rendering')
assert.equal(turnReviewSource.includes('assistant-turn-review-rail-width:v2'), true, 'the chosen turn rail width is remembered')
assert.equal(turnReviewSource.includes('formatAssistantDateTime(turn.updatedAt)'), true, 'turn rows show an exact date and time')
assert.equal(turnReviewSource.includes('assistant-turn-review__turn-stats'), false, 'turn headers do not repeat diff totals')
assert.equal((turnReviewSource.match(/flex h-10 shrink-0 items-center/g) || []).length >= 1, true, 'turn metadata stays in one compact header row')
assert.equal(rendererCssSource.includes('assistant-turn-review__turn-time-compact'), true, 'a resized inner rail swaps to compact time instead of clipping the header')
assert.equal(turnReviewSource.includes('formatAssistantRelativeTime'), false, 'turn rows do not use relative hours-ago labels')
assert.equal(turnReviewSource.includes('[scrollbar-gutter:stable]'), true, 'turn context and file surfaces reserve scrollbar space before overflow')
assert.equal(turnReviewSource.includes('preparedSelectedDiff = activeSelectionMatches'), true, 'a newly selected file invalidates the previously mounted rich diff before paint')
assert.equal(turnReviewSource.includes('assistant-turn-review__file-stats inline-flex'), true, 'file rows use fixed compact stats without non-adaptive bars')
assert.equal(rendererCssSource.includes('grid-template-rows: auto minmax(0, 1.25fr) auto minmax(150px, 1fr)'), true, 'the wide message area grows while preserving the divider and changed-file space')
assert.equal(rendererCssSource.includes('grid-template-rows: 52% minmax(0, 48%)'), true, 'thin changed files begin at a stable split instead of following message height')
assert.equal(turnReviewSource.includes('<MarkdownRenderer'), true, 'agent responses and sent user prompts render as Markdown')
assert.equal(turnReviewSource.includes('canExpand = collapsible'), true, 'only explicitly collapsible prompt excerpts receive the compact height limit')
assert.equal(turnReviewSource.includes('primary renderMarkdown collapsible'), true, 'the user side of turn review keeps Markdown and Show more behavior together')
assert.equal(rendererCssSource.includes('.assistant-turn-review__markdown :is(p, li'), true, 'context Markdown receives hard width and wrapping rules in both layouts')
assert.match(rendererCssSource, /\.assistant-turn-review__conversation-pane,\s*\.assistant-turn-review__narrow-panel\s*\{[\s\S]*?min-width:\s*0;/, 'the context surface itself can shrink within its grid or flex column instead of being clipped')
assert.equal(rendererCssSource.includes('contain: inline-size'), true, 'the wide context cell cannot expand from Markdown intrinsic width')
assert.equal(rendererCssSource.includes('grid-template-columns: minmax(0, 1fr)'), true, 'the wide rail grid column cannot expand to Markdown max-content width')
assert.equal(turnReviewSource.includes('assistant-turn-review__narrow-panel min-h-0 min-w-0 max-w-full'), true, 'the thin context flex item cannot retain a wider intrinsic Markdown width')
assert.equal(rendererCssSource.includes('width: calc(100% - 1.5rem)'), true, 'Markdown lists include their outside marker margin inside the available width')
assert.equal(inspectorSource.includes('truncate text-left'), true, 'Inspector turn tab labels align to the left')
assert.equal(turnReviewSource.includes('displayedSelectedDiff.provisional'), false, 'first-row actions contain only edit identity, copy, and view mode controls')
assert.equal(turnReviewSource.includes('headerMetadata={renderDiffHeaderActions()}'), true, 'selected-file actions render inside the rich diff header')
assert.equal(turnReviewSource.includes('headerPrefix={selectedFileStatus'), true, 'file status renders at the start of the rich diff header')
assert.equal(patchDiffViewerSource.includes('renderHeaderMetadata={headerMetadata'), true, 'the shared viewer forwards embedded header actions through Pierre slots')
assert.equal(patchDiffViewerSource.includes("border-radius: ${flush ? '0' : '16px'}"), true, 'flush mode removes the rich renderer corner radius without changing other diff surfaces')
assert.equal(patchDiffViewerSource.includes('[data-diffs-header] [data-change-icon]'), true, 'flush review diffs hide Pierre’s redundant change icon')
assert.equal(rawPatchFallbackSource.includes("flush ? 'rounded-none"), true, 'raw fallback diffs also remove embedded corner rounding')
assert.equal(turnReviewSource.includes('renderFlushDiffHeader()'), true, 'loading and raw fallback states keep the same black embedded header')
assert.equal(rendererCssSource.includes('@container turn-review-root (max-width: 759px)'), true, 'turn review switches between thin and wide surfaces at the reduced threshold')
assert.equal(rendererCssSource.includes('@container turn-review-diff (max-width: 520px)'), true, 'recorded-edit metadata adapts to the actual diff pane width')
assert.equal(patchDiffViewerSource.includes('[data-diffs-header] [data-metadata]'), true, 'Pierre metadata stays pinned while long paths truncate first')
assert.equal(patchDiffViewerSource.includes('const headerSurface = surfaceRaised'), true, 'the complete repeated-diff header uses one theme-derived raised surface')
assert.equal(patchDiffViewerSource.includes('hideHeaderStats'), true, 'stacked history can reserve header space for edit identity and timestamps')
assert.equal(sidebarStateSource.includes('assistant-right-sidebar-widths:v1'), true)
assert.equal(sidebarStateSource.includes('[sessionId]'), true, 'right workspace width is remembered per chat')
const headerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationHeader.tsx', import.meta.url), 'utf8')
const conversationPaneSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const headerProjectClickSource = conversationPaneSource.slice(
    conversationPaneSource.indexOf('const handleCreateHeaderProjectChat'),
    conversationPaneSource.indexOf('const handleArchiveChat')
)
assert.equal(headerSource.includes('Open review workspace'), true, 'conversation header exposes the review workspace')
assert.equal(headerSource.includes('PanelRightClose : PanelRightOpen'), true, 'right workspace trigger mirrors the left sidebar open and close icon pattern')
assert.equal(headerSource.includes("rightPanelOpen && rightPanelMode === 'review' && 'bg-"), false, 'right sidebar trigger stays visually plain while open')
assert.equal(headerSource.includes('resolvedPinnedBubbleHeaderInset'), false, 'the breadcrumb no longer belongs to a second row beside the sidebar bubble')
assert.equal(headerSource.includes('flex h-full min-w-0 items-center'), true, 'the project breadcrumb fills the single app title-bar row')
assert.equal(headerSource.includes('items={headerMenuItems}'), true, 'the conversation ellipsis opens its wired action list')
assert.equal(headerSource.includes('await copyTextToClipboard(canonicalThreadId)'), true, 'Copy thread ID uses the reliable desktop clipboard bridge and fallback path')
assert.equal(headerSource.includes('disabled: !canonicalThreadId'), true, 'Copy thread ID remains available while unrelated chat mutations are pending')
assert.equal(headerSource.includes("onShowToast?.('Thread ID copied', 'success')"), true, 'successful thread-ID copies show explicit feedback')
assert.equal(headerSource.includes("onShowToast?.(message, 'error')"), true, 'thread-ID clipboard failures remain visible')
assert.equal(conversationPaneSource.includes('onShowToast={props.onShowToast}'), true, 'the header receives the conversation page toast owner')
assert.equal(headerSource.includes('onClick={onCreateProjectChat}'), true, 'clicking the header project creates a project-scoped chat')
const projectBreadcrumbSource = headerSource.slice(
    headerSource.indexOf('onClick={onCreateProjectChat}'),
    headerSource.indexOf('{selectedProjectPath ? <span')
)
assert.equal(projectBreadcrumbSource.includes('hover:bg-'), false, 'project breadcrumb feedback never paints a surrounding highlight box')
assert.equal(projectBreadcrumbSource.includes('active:text-sparkle-text'), true, 'project breadcrumb press feedback stays on the icon and text')
assert.equal(headerSource.includes('onClick={onChooseProject}'), false, 'the visible project breadcrumb never changes the current chat directory')
assert.equal(headerSource.includes('onSelect: onChooseProject'), true, 'Attach or Change project remains an explicit overflow action')
assert.equal(headerProjectClickSource.includes("actions.createSessionResult({ mode: 'work', projectPath })"), true, 'the breadcrumb passes the exact current project into new-chat creation')
assert.equal(headerProjectClickSource.includes('chooseProjectPath'), false, 'project breadcrumb creation cannot invoke the directory picker')
assert.equal(headerProjectClickSource.includes('setSessionProjectPath'), false, 'project breadcrumb creation cannot mutate current chat metadata')
assert.equal(headerSource.includes('presentation="portal"'), true, 'the conversation menu escapes the clipped title row')
const chatRailSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const loadingStateSource = readFileSync(new URL('../src/renderer/src/components/ui/LoadingState.tsx', import.meta.url), 'utf8')
assert.equal(chatRailSource.includes("width: loadingScreenActive || collapsed ? '0px'"), true, 'loading and bubble pinning remove the rail without shifting its retained width state')
assert.equal(chatRailSource.includes('const loadingScreenActive = useLoadingScreenActive()'), true, 'the sidebar consumes the synchronous shared loading owner')
assert.equal(chatRailSource.includes('opacity: 0,'), true, 'loading hides the Chats heading with its retained sidebar surface')
assert.equal(chatRailSource.includes("pointerEvents: 'none'"), true, 'the hidden loading rail cannot intercept input')
assert.equal(chatRailSource.includes("(isResizing || loadingScreenActive) && 'transition-none'"), true, 'sidebar chrome disappears before loading can paint a divider remnant')
assert.equal(loadingStateSource.includes('useSyncExternalStore'), true, 'loading visibility has a race-free shared snapshot')
assert.equal(loadingStateSource.includes('useLayoutEffect(() =>'), true, 'the loading snapshot is active before the browser paints')
assert.equal(chatRailSource.includes('flex h-[30px] min-w-0 items-center rounded-[10px] px-2.5 text-[13px]'), true, 'the empty Chats placeholder occupies the same row geometry as a real chat')
assert.equal(chatRailSource.includes('createSessionActionMenuItems'), true, 'sidebar chat dots reuse the complete chat action list')
assert.equal(chatRailSource.includes('onContextMenu={(event) => onOpenContextMenu(event, session)}'), true, 'right-clicking a sidebar chat opens the same actions')
assert.equal(chatRailSource.includes('items={getProjectMenuItems(group, expanded)}'), true, 'project ellipses open project actions instead of copying immediately')
assert.equal(sidebarPreviewStateSource.includes('assistant:bubble-preview-pinned:v1'), true, 'chat and Settings share one floating-sidebar pin state')
assert.equal(sidebarPreviewStateSource.includes('ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS = 180'), true, 'floating sidebars share the hover-close delay')
assert.equal(sidebarPreviewStateSource.includes('ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS = 1_100'), true, 'floating sidebars share the collapse morph delay')
const titleBarSource = readFileSync(new URL('../src/renderer/src/components/layout/TitleBar.tsx', import.meta.url), 'utf8')
const titleBarSlotSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-title-bar.tsx', import.meta.url), 'utf8')
const indexCssSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const themeTokensSource = readFileSync(new URL('../src/renderer/src/styles/theme-tokens.css', import.meta.url), 'utf8')
assert.equal(titleBarSource.includes('assistantWorkspaceActive && !loadingScreenActive ? assistantTitleBarContent : null'), true, 'the wired chat breadcrumb renders in the single app title-bar row only after loading')
assert.equal(titleBarSource.includes('assistantWorkspaceActive && !loadingScreenActive ? assistantTitleBarEndRegion?.content : null'), true, 'Inspector tabs stay out of the desktop title bar while loading')
assert.equal(titleBarSource.includes('className="drag-region min-w-0 flex-1 self-stretch"'), true, 'unused center title-bar space remains a native window drag target')
assert.equal(headerSource.includes('className="drag-region flex h-full min-w-0 items-center px-3"'), true, 'gaps around chat identity remain draggable')
assert.equal(inspectorSource.includes("'drag-region relative h-full shrink-0 overflow-visible"), true, 'unused Inspector title-strip space remains draggable')
assert.equal(inspectorSource.includes("'inspector-workspace-tab no-drag"), true, 'HTML tab reordering stays interactive inside the native drag band')
assert.equal(inspectorSource.includes("WebkitAppRegion: 'no-drag'"), false, 'the Inspector no longer disables dragging across its entire width')
assert.equal(indexCssSource.includes('.drag-region button,'), true, 'buttons opt out of native dragging and keep their click behavior')
assert.equal(indexCssSource.includes('.no-drag'), true, 'sortable Inspector tabs opt out of native window dragging through their explicit interaction surface')
assert.equal(titleBarSource.includes("assistantWorkspaceActive && 'absolute right-0 top-0 z-[5]'"), true, 'window controls overlay their reserved part of the merged Inspector title bar')
assert.equal(titleBarSlotSource.includes('usePublishAssistantTitleBarEndRegion'), true, 'the Inspector publishes one live tab owner instead of duplicating tab actions')
assert.equal(inspectorSource.includes('data-assistant-inspector-titlebar'), true, 'the Inspector exposes its merged title-bar surface')
assert.equal(inspectorSource.includes("paddingRight: 'var(--zyra-titlebar-controls-width, 120px)'"), true, 'Inspector tabs reserve the measured desktop window-control area')
assert.equal(inspectorSource.includes("titleBarSurfaceRef.current?.style.setProperty('width'"), true, 'live Inspector resizing keeps the title-bar divider aligned with the workspace body')
assert.equal(titleBarSource.includes('<span>Zyra</span>'), true, 'one compact Zyra menu replaces permanent desktop menu labels')
assert.equal(titleBarSource.includes('menuLabels'), false, 'File, Edit, View, and Help are no longer permanent title-bar groups')
assert.equal(titleBarSource.includes('ChevronLeft'), false, 'back navigation no longer occupies permanent title-bar space')
assert.equal(titleBarSource.includes('ChevronRight'), false, 'forward navigation no longer occupies permanent title-bar space')
assert.equal(titleBarSource.includes("event.key === 'ArrowLeft' && canGoBack"), true, 'Alt+Left preserves app history navigation')
assert.equal(titleBarSource.includes("event.key === 'ArrowRight' && canGoForward"), true, 'Alt+Right preserves app history navigation')
assert.equal(titleBarSource.includes('getContextualTitleParts(location.pathname)'), true, 'settings and secondary screens publish contextual title-bar identity')
assert.match(titleBarSource, /expandedSidebar[\s\S]{0,180}\? sidebarWidthRef\.current[\s\S]{0,180}width: `\$\{isMac \? Math\.max\(184, baseAppZoneWidth\) : baseAppZoneWidth\}px`/, 'the expanded title-bar app zone follows the live local sidebar width')
assert.match(titleBarSource, /loadingScreenActive && assistantWorkspaceActive[\s\S]{0,40}\? 112[\s\S]{0,80}: expandedSidebar/, 'loading immediately returns the title bar to its compact app zone')
assert.equal(titleBarSource.includes("sidebarWorkspaceActive && !(assistantWorkspaceActive && loadingScreenActive) && 'border-r border-[var(--surface-panel-divider)]'"), true, 'the title-bar sidebar divider is absent while Assistant is loading')
assert.equal(titleBarSource.includes('setSidebarWidth'), false, 'sidebar resize does not rerender the title bar')
assert.equal(titleBarSource.includes("assistantAppZoneRef.current?.style.setProperty('width'"), true, 'live rail width reaches only the matching title-bar element')
const sidebarLiveApplySource = chatRailSource.slice(
    chatRailSource.indexOf('const applyLiveSidebarWidth'),
    chatRailSource.indexOf('const stopResize')
)
const sidebarPointerMoveSource = chatRailSource.slice(
    chatRailSource.indexOf('const handleResizePointerMove'),
    chatRailSource.indexOf('const handleResizePointerEnd')
)
assert.equal(sidebarPointerMoveSource.includes('window.requestAnimationFrame(() =>'), true, 'live sidebar resizing is bounded to one update per animation frame')
assert.equal(sidebarPointerMoveSource.includes('applyLiveSidebarWidth(latest.width)'), true, 'the actual sidebar follows the pointer live')
assert.equal(sidebarPointerMoveSource.includes('onWidthChange('), false, 'pointer movement does not persist React sidebar state on every pixel')
assert.equal(sidebarLiveApplySource.includes("layoutShellRef.current?.style.setProperty('width'"), true, 'live resizing updates the local layout shell directly')
assert.equal(sidebarLiveApplySource.includes("sidebarSurfaceRef.current?.style.setProperty('width'"), true, 'the visible rail follows its local layout shell')
assert.equal(sidebarLiveApplySource.includes('document.documentElement'), false, 'left resize avoids document-wide style invalidation')
assert.equal(chatRailSource.includes('resizeGuideRef'), false, 'left resizing uses the same live-pane interaction as Inspector')
assert.equal(chatRailSource.includes("!collapsed && !loadingScreenActive && '[contain:layout]'"), true, 'layout containment accelerates live resize without trapping hidden loading chrome')
assert.equal(chatRailSource.includes('resizeStateRef.current?.width ?? resolvedWidth'), true, 'unrelated chat updates cannot snap an active drag back to its persisted width')
const sidebarCollapseTransitionStart = chatRailSource.indexOf('const wasCollapsed = wasCollapsedRef.current')
const sidebarCollapseTransitionSource = chatRailSource.slice(
    Math.max(0, sidebarCollapseTransitionStart - 40),
    chatRailSource.indexOf('const expandCollapsedSidebar')
)
assert.equal(sidebarCollapseTransitionSource.includes('useEffect(() =>'), true, 'collapse keeps the original rendered morph timing')
assert.equal(sidebarCollapseTransitionSource.includes('setPreviewOpen(true)'), true, 'collapse first exposes the floating bubble')
assert.equal(sidebarCollapseTransitionSource.includes('schedulePreviewClose(ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS)'), true, 'the floating bubble waits for the shared morph delay before sliding away')
assert.equal(chatRailSource.includes('pointer-events-auto fixed bottom-0 left-0 top-[34px] z-[59] w-4'), true, 'the left-edge hover target remains reachable above chat content without widening the trigger')
assert.equal(chatRailSource.includes("zyra-sidebar-floating-surface absolute bottom-3 left-2 top-2 z-[60]"), true, 'the floating bubble renders above the hover target and chat surface')
assert.equal(chatRailSource.includes("width: `${ASSISTANT_BUBBLE_SIDEBAR_WIDTH}px`"), true, 'the floating bubble keeps one stable wide width instead of inheriting the resized dock width')
assert.equal(chatRailSource.includes('w-3 translate-x-1/2 cursor-col-resize'), true, 'the twelve-pixel resize target straddles the visible sidebar border')
assert.equal(chatRailSource.includes('assistant-sidebar-scrollbar min-h-0 flex-1 overflow-y-scroll'), true, 'the chat list reserves its scrollbar track before overflow')
assert.equal(indexCssSource.includes('scrollbar-gutter: stable'), true, 'sidebar chat actions never shift under a newly appearing scrollbar')
assert.equal(chatRailSource.includes("isResizing && 'bg-[var(--surface-hover)]"), false, 'active resizing does not render a wide divider strip')
assert.equal(pageSource.includes('collapsed: paneLayout.leftSidebarCollapsed'), true, 'assistant sidebar state publishes its effective responsive visibility to desktop chrome')
assert.equal(pageSource.includes('width: paneLayout.leftSidebarWidth || leftSidebarWidth'), true, 'assistant sidebar state publishes its live resolved width to desktop chrome')
assert.equal(indexCssSource.includes('border-right: 1px solid var(--surface-panel-divider)'), true, 'the chat rail has a clear workspace edge')
assert.equal(inspectorSource.includes('border-l border-[var(--surface-panel-divider)]'), true, 'the Inspector has the matching clear workspace edge')
assert.equal(themeTokensSource.includes('--surface-panel-divider:'), true, 'workspace edges remain derived from the active Zyra theme')
assert.equal(titleBarSource.includes("'bg-white/[0.055] text-[#d7d0e3]"), false, 'left sidebar trigger also stays visually plain while open')

console.log('Assistant mounted diff contract: ok')
