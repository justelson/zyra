import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    sanitizeAssistantUtilityStateCapsule,
    type AssistantUtilityExplorerStateCapsule
} from '../src/shared/assistant/utility-window'

const explorer = sanitizeAssistantUtilityStateCapsule({
    version: 1,
    workspace: 'explorer',
    rootPath: 'C:/project',
    currentFolderPath: `C:/project/${'folder/'.repeat(300)}`,
    expandedPaths: Array.from({ length: 100 }, (_, index) => `C:/project/folder-${index}`),
    selectedPath: 'C:/project/src/index.ts\u0000',
    activePreview: {
        name: 'index.ts',
        path: 'C:/project/src/index.ts',
        extension: 'ts',
        mode: 'edit',
        expanded: true,
        content: 'renderer content must never cross the capsule boundary'
    },
    scrollAnchor: { key: 'files', offset: Number.MAX_SAFE_INTEGER },
    ignored: { arbitrary: true }
}, 'explorer') as AssistantUtilityExplorerStateCapsule

assert.equal(explorer.workspace, 'explorer')
assert.equal(explorer.rootPath, 'C:/project', 'Files capsules retain the selected Chat-scope root')
assert.equal(explorer.expandedPaths?.length, 64, 'expanded file state stays bounded')
assert.equal(explorer.currentFolderPath?.length, 1_024, 'paths stay bounded')
assert.equal(explorer.selectedPath, 'C:/project/src/index.ts', 'control characters are removed')
assert.equal(explorer.scrollAnchor?.offset, 10_000_000, 'scroll offsets stay bounded')
assert.deepEqual(explorer.activePreview, {
    name: 'index.ts',
    path: 'C:/project/src/index.ts',
    extension: 'ts',
    mode: 'edit',
    expanded: true
}, 'preview capsules retain bounded identity and presentation but no file content')
assert.equal('ignored' in explorer, false)

const resources = sanitizeAssistantUtilityStateCapsule({
    version: 1,
    workspace: 'resources',
    query: 'x'.repeat(1_000),
    kindFilter: 'invalid',
    sourceFilter: 'attached',
    turnFilter: 'turn-7',
    selectedResourceId: 'resource-4',
    drillDown: {
        turnId: 'turn-7',
        selectedDiff: { activityId: 'activity-2', filePath: 'src/file.ts', patch: 'never retain patches' }
    }
}, 'resources')
assert.equal(resources?.workspace, 'resources')
if (resources?.workspace !== 'resources') throw new Error('Expected a Resources capsule.')
assert.equal(resources.query?.length, 256)
assert.equal(resources.kindFilter, undefined)
assert.equal(resources.sourceFilter, 'attached')
assert.deepEqual(resources.drillDown?.selectedDiff, { activityId: 'activity-2', filePath: 'src/file.ts', turnId: undefined, previousPath: undefined })
assert.equal(sanitizeAssistantUtilityStateCapsule(resources, 'agents'), undefined, 'capsules cannot hydrate a different workspace kind')
assert.equal(sanitizeAssistantUtilityStateCapsule({ version: 1, workspace: 'browser', url: 'https://example.com' }), undefined, 'Browser state is outside this capsule layer')
assert.equal(sanitizeAssistantUtilityStateCapsule({ version: 1, workspace: 'terminal', buffer: 'secret' }), undefined, 'Terminal state is outside this capsule layer')

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const manager = read('../src/main/assistant/assistant-utility-window-manager.ts')
const panel = read('../src/renderer/src/pages/assistant/AssistantDiffPanel.tsx')
const utilityWindow = read('../src/renderer/src/pages/assistant/utility/AssistantUtilityWindow.tsx')
const host = read('../src/renderer/src/pages/assistant/utility/AssistantUtilityWorkspaceHost.tsx')

assert.match(manager, /sanitizeAssistantUtilityStateCapsule\(input\.tab\.stateCapsule/, 'main sanitizes renderer capture before a cross-window transfer')
assert.match(manager, /private async updateStateCapsule/, 'main owns persisted utility-window capsules')
assert.match(manager, /stateCapsule: sanitizeAssistantUtilityStateCapsule\(tab\.stateCapsule, tab\.workspace\)/, 'persisted capsules are sanitized again on restore')
assert.match(panel, /ensureUtilityTabId/, 'main workspaces retain stable utility identities across round trips')
assert.match(panel, /adoptIncomingCapsule/, 'main hydrates accepted utility tabs before acknowledging transfer')
assert.match(utilityWindow, /capsuleByTabIdRef\.current\.get\(tab\.id\)/, 'utility tear-off captures the latest renderer-local state at transfer time')
assert.match(host, /stateCapsule=\{tab\.stateCapsule/, 'utility workspace hosts hydrate Files from the transferred capsule')
assert.match(host, /resolveAssistantUtilityDiffSelection/, 'Review and Resources restore diff selection by bounded identity, not raw patches')

console.log('Assistant utility state capsules: ok')
