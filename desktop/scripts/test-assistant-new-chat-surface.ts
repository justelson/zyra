import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveAssistantConversationSurfaceMode } from '../src/renderer/src/pages/assistant/assistant-conversation-surface-mode'
import { clearMentionIndex, getOrCreateMentionIndex } from '../src/renderer/src/pages/assistant/assistant-composer-mentions'

assert.equal(
    deriveAssistantConversationSurfaceMode({
        newChatHandoffActive: false,
        selectedSessionUsesNewChatSurface: true,
        showChatOnboardingOverlay: false,
        selectedThreadHasHistoricalContent: true,
        timelineMessageCount: 0,
        activityCount: 4,
        proposedPlanCount: 0,
        isThreadWorking: false,
        connectionBelongsToSelectedChat: false,
        isLoadingSelectedChat: false,
        pendingApprovalCount: 0,
        pendingInputCount: 0,
        hasPendingLabRequest: false
    }),
    'centered-composer',
    'runtime-only connection activities must not turn a new empty session into a blank conversation shell'
)

assert.equal(
    deriveAssistantConversationSurfaceMode({
        newChatHandoffActive: false,
        selectedSessionUsesNewChatSurface: false,
        showChatOnboardingOverlay: false,
        selectedThreadHasHistoricalContent: true,
        timelineMessageCount: 1,
        activityCount: 0,
        proposedPlanCount: 0,
        isThreadWorking: false,
        connectionBelongsToSelectedChat: false,
        isLoadingSelectedChat: false,
        pendingApprovalCount: 0,
        pendingInputCount: 0,
        hasPendingLabRequest: false
    }),
    'conversation',
    'real persisted chat history must keep the timeline and bottom composer'
)

const paneSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantConversationPane.tsx'), 'utf8')
const composerPaneSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantConversationComposerPane.tsx'), 'utf8')
const placementMotionSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/useAssistantComposerPlacementMotion.ts'), 'utf8')
const projectChipSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantNewChatProjectChip.tsx'), 'utf8')
const projectCatalogSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/useAssistantProjectCatalog.ts'), 'utf8')
const composerSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantComposerView.tsx'), 'utf8')
assert.match(paneSource, /\{!composerIsCentered \? \([\s\S]{0,160}<AssistantConversationTimelinePane/u, 'the hidden timeline must leave layout so it cannot push the centered composer downward')
assert.match(paneSource, /newChatPrompt=\{emptyComposerPrompt\}/u, 'the centered New Chat surface must receive its contextual greeting')
assert.match(composerPaneSource, /useAssistantComposerPlacementMotion\(props\.paneRef, placement\)/u, 'the composer should animate between centered and docked geometry')
assert.match(composerPaneSource, /\{placement === 'center' \? \(/u, 'the greeting leaves layout before the bottom composer inset is measured')
assert.doesNotMatch(composerPaneSource, /transition-\[grid-template-rows,margin,opacity,transform\]/u, 'the greeting must not feed a height animation back into the virtual timeline')
assert.match(placementMotionSource, /element\.animate\(\[/u, 'placement motion should use FLIP geometry rather than an abrupt layout switch')
assert.match(placementMotionSource, /translate: `\$\{deltaX\}px \$\{deltaY\}px`[\s\S]{0,100}scale: `\$\{scaleX\} 1`/u, 'FLIP motion must use independent translate and scale properties so centered resting transforms remain intact')
assert.match(placementMotionSource, /prefers-reduced-motion: reduce/u, 'composer placement motion should respect reduced-motion preferences')
assert.match(projectChipSource, /data-assistant-new-chat-project-chip="true"/u, 'New Chat should expose its project context on the composer seam')
assert.match(projectChipSource, /No project/u, 'detached New Chat context must be explicit')
assert.match(projectChipSource, /Choose folder…/u, 'the project context menu must retain the real folder picker path')
assert.match(projectCatalogSource, /assistant\.listProjects\(\)/u, 'New Chat Project choices come from the durable catalog even when no Chat references a folder')
assert.match(paneSource, /projectCatalogState\.catalog\.candidates/u, 'detected configured folders remain explicit review candidates in New Chat')
assert.match(composerSource, /surface-floating[\s\S]{0,260}shadow-\[0_22px_68px/u, 'the centered composer should use the raised floating-surface edge language')

const originalWindow = (globalThis as { window?: unknown }).window
let resolveFileTree: ((value: {
    success: true
    tree: Array<{ name: string; path: string; type: 'file'; isHidden: false; modifiedAt: number }>
}) => void) | null = null
let fileTreeRequests = 0
;(globalThis as any).window = {
    devscope: {
        getFileTree: async () => {
            fileTreeRequests += 1
            return new Promise((resolve) => { resolveFileTree = resolve })
        }
    }
}
try {
    clearMentionIndex()
    const firstIndex = getOrCreateMentionIndex('C:/fixture-project')
    const duplicateIndex = getOrCreateMentionIndex('C:/fixture-project')
    assert.equal(fileTreeRequests, 1, 'simultaneous composer mounts must share one in-flight mention-index scan')
    resolveFileTree?.({
        success: true,
        tree: [{
            name: 'index.ts',
            path: 'C:/fixture-project/index.ts',
            type: 'file',
            isHidden: false,
            modifiedAt: 1234
        }]
    })
    const [firstEntries, duplicateEntries] = await Promise.all([firstIndex, duplicateIndex])
    assert.equal(firstEntries, duplicateEntries, 'deduplicated mention scans must reuse the same indexed entries')
    assert.equal(firstEntries[0]?.modifiedAt, 1234, 'mention entries retain file-tree timestamps without opening file contents')
} finally {
    clearMentionIndex()
    if (originalWindow === undefined) delete (globalThis as any).window
    else (globalThis as any).window = originalWindow
}

const projectDataSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/useAssistantComposerProjectData.ts'), 'utf8')
const mentionSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/assistant-composer-mentions.ts'), 'utf8')
const fileTreeSource = readFileSync(resolve(import.meta.dir, '../src/main/ipc/handlers/file-tree-handlers.ts'), 'utf8')
assert.match(projectDataSource, /mentionActive/u, 'composer file indexing waits for explicit mention intent')
assert.doesNotMatch(projectDataSource, /readFileContent/u, 'mention recency must use file metadata rather than reading candidate contents')
assert.match(mentionSource, /mentionIndexRequestCache/u, 'mention indexing deduplicates in-flight scans')
assert.match(fileTreeSource, /modifiedAt: stats\.mtimeMs/u, 'file-tree metadata carries modification time from the existing stat call')

console.log('Assistant new-chat surface: ok')
