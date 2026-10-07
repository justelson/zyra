import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getPreviewNavigatorFolderPath } from '../src/renderer/src/components/ui/file-preview/usePreviewFolderTree'
import { resolveFilePreviewChromePolicy } from '../src/renderer/src/components/ui/file-preview/filePreviewChromePolicy'
import { scanMarkdownHeadingTargets } from '../src/renderer/src/components/ui/markdown/markdownHeadingIds'
import {
    createPreviewNavigationState,
    getPreviewNavigationTarget,
    movePreviewNavigationToIndex,
    recordPreviewNavigationEntry,
    type PreviewNavigationEntry
} from '../src/renderer/src/components/ui/file-preview/preview-navigation-history'

function entry(name: string): PreviewNavigationEntry {
    return {
        file: { name, path: `C:/project/${name}`, type: 'md' },
        extension: 'md',
        mediaItems: []
    }
}

assert.equal(
    getPreviewNavigatorFolderPath('C:\\project\\src\\components\\Panel.tsx'),
    'C:/project/src/components',
    'file targets open the navigator at their containing folder'
)
assert.equal(
    getPreviewNavigatorFolderPath('C:\\project\\src\\components\\', true),
    'C:\\project\\src\\components',
    'directory targets open that directory itself'
)
assert.deepEqual(
    scanMarkdownHeadingTargets('# Overview\n\n## Details\n').map(({ id, text, depth }) => ({ id, text, depth })),
    [
        { id: 'overview', text: 'Overview', depth: 1 },
        { id: 'details', text: 'Details', depth: 2 }
    ],
    'focused Markdown outlines preserve heading labels and hierarchy'
)

const first = entry('first.md')
const second = entry('second.md')
const third = entry('third.md')
let state = createPreviewNavigationState(first)
state = recordPreviewNavigationEntry(state, second)
assert.equal(state.index, 1)
assert.equal(getPreviewNavigationTarget(state, -1)?.entry.file.name, 'first.md')
assert.equal(getPreviewNavigationTarget(state, 1), null)

state = movePreviewNavigationToIndex(state, 0)
assert.equal(getPreviewNavigationTarget(state, 1)?.entry.file.name, 'second.md')
state = recordPreviewNavigationEntry(state, third)
assert.deepEqual(state.entries.map((item) => item.file.name), ['first.md', 'third.md'], 'opening a file after Back clears the abandoned forward branch')
assert.equal(state.index, 1)

state = recordPreviewNavigationEntry(state, { ...third, file: { ...third.file, focusLine: 42 } })
assert.equal(state.entries.length, 2, 'revisiting the current file updates its location without adding duplicate history')
assert.equal(state.entries[1]?.file.focusLine, 42)

const modalSource = readFileSync(new URL('../src/renderer/src/components/ui/FilePreviewModal.tsx', import.meta.url), 'utf8')
const windowedHeaderSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewModalHeader.tsx', import.meta.url), 'utf8')
const expandedHeaderSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewExpandedHeaderBar.tsx', import.meta.url), 'utf8')
const codePreviewPlaceholderSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/CodePreviewPlaceholder.tsx', import.meta.url), 'utf8')
const syntaxPreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/SyntaxPreview.tsx', import.meta.url), 'utf8')
const monacoPreviewEditorSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/MonacoPreviewEditor.tsx', import.meta.url), 'utf8')
const historyNavigationSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewHistoryNavigation.tsx', import.meta.url), 'utf8')
const historyHookSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewNavigationHistory.ts', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewModalLayout.tsx', import.meta.url), 'utf8')
const expandedWorkspaceSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewExpandedWorkspace.tsx', import.meta.url), 'utf8')
const previewHookSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreview.ts', import.meta.url), 'utf8')
const assistantNavigationSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-file-navigation.ts', import.meta.url), 'utf8')
const markdownNavigationSource = readFileSync(new URL('../src/renderer/src/components/ui/markdown/linkNavigation.ts', import.meta.url), 'utf8')
const modalInteractionsSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewModalInteractions.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewNavigationSidebar.tsx', import.meta.url), 'utf8')
const virtualTreeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewVirtualFileTree.tsx', import.meta.url), 'utf8')
const virtualWindowSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/usePreviewVirtualWindow.ts', import.meta.url), 'utf8')
const treeMenuSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewTreeContextMenu.tsx', import.meta.url), 'utf8')
const htmlControlsSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewHeaderHtmlControls.tsx', import.meta.url), 'utf8')
const folderTreeHookSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/usePreviewFolderTree.ts', import.meta.url), 'utf8')
const modalAnalysisSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewModalAnalysis.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/renderer/src/lib/settings.tsx', import.meta.url), 'utf8')
const previewChromeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewChrome.ts', import.meta.url), 'utf8')
const panelPreferencesSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/filePreviewPanelPreferences.ts', import.meta.url), 'utf8')
const previewSkeletonSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewLoadingSkeleton.tsx', import.meta.url), 'utf8')
const mediaPreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/MediaPreviewContent.tsx', import.meta.url), 'utf8')
const imagePreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/ImagePreviewContent.tsx', import.meta.url), 'utf8')
const assistantFilesWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantFilesWorkspace.tsx', import.meta.url), 'utf8')
const previewInspectorSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewInspectorSidebar.tsx', import.meta.url), 'utf8')
const previewContextSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewContextSidebar.tsx', import.meta.url), 'utf8')
const previewOutlineSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewOutlinePanel.tsx', import.meta.url), 'utf8')
const documentOutlineSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/documentOutline.ts', import.meta.url), 'utf8')
const editorSettingsSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewEditorSettingsMenu.tsx', import.meta.url), 'utf8')
const editMenuSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewHeaderEditMenu.tsx', import.meta.url), 'utf8')
const fileMarkdownSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/FileMarkdownPreview.tsx', import.meta.url), 'utf8')
const titleBarSource = readFileSync(new URL('../src/renderer/src/components/layout/TitleBar.tsx', import.meta.url), 'utf8')
const utilityWindowSource = readFileSync(new URL('../src/renderer/src/pages/assistant/utility/AssistantUtilityWindow.tsx', import.meta.url), 'utf8')
const fileFocusModeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/filePreviewFocusMode.ts', import.meta.url), 'utf8')
const indexCssSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const quickOpenSource = readFileSync(new URL('../src/renderer/src/pages/QuickOpen.tsx', import.meta.url), 'utf8')
const assistantPageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const utilityHostSource = readFileSync(new URL('../src/renderer/src/pages/assistant/utility/AssistantUtilityWorkspaceHost.tsx', import.meta.url), 'utf8')
const projectDetailsTransientSource = readFileSync(new URL('../src/renderer/src/pages/project-details/ProjectDetailsTransientUi.tsx', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> }

const chromePolicyCases = [
    ['quick-view', { navigator: 'none', history: 'none', allowFullscreen: false, showTabs: false }],
    ['peek', { navigator: 'requested', history: 'available', allowFullscreen: false, showTabs: true }],
    ['detail', { navigator: 'requested', history: 'always', allowFullscreen: true, showTabs: true }],
    ['workspace', { navigator: 'always', history: 'always', allowFullscreen: true, showTabs: true }]
] as const
for (const [context, expectedPolicy] of chromePolicyCases) {
    assert.deepEqual(resolveFilePreviewChromePolicy(context), expectedPolicy, `${context} resolves one canonical chrome policy`)
}

const chromeCallerCases = [
    [quickOpenSource, 'quick-view', 'dedicated shell previews'],
    [assistantPageSource, 'peek', 'chat previews'],
    [utilityHostSource, 'peek', 'utility Browser and Resources previews'],
    [projectDetailsTransientSource, 'detail', 'project previews'],
    [assistantFilesWorkspaceSource, 'workspace', 'Files previews']
] as const
for (const [source, context, label] of chromeCallerCases) {
    assert.equal(source.includes(`chromeContext="${context}"`), true, `${label} use ${context} chrome`)
}
assert.equal([quickOpenSource, assistantPageSource, utilityHostSource].some((source) => source.includes('disableFullscreen')), false, 'callers no longer hand-assemble fullscreen policy')
assert.equal(modalSource.includes('useFilePreviewNavigationHistory'), true, 'the shared modal owns one visit history for linked files and tab selections')
assert.equal(modalSource.includes("if (!active || shellMode !== 'modal') return"), true, 'hidden previews and dedicated preview-window shells do not mutate global document scrolling')
assert.equal(windowedHeaderSource.includes('<PreviewHistoryNavigation'), true, 'windowed previews expose Back and Forward beside the file identity')
assert.equal(windowedHeaderSource.includes('const showWindowedEditMenu = previewModeEnabled && isEditable'), true, 'the non-full-screen viewer hides a meaningless Edit-only split control')
assert.equal(windowedHeaderSource.includes('isEditOnly && isDirty'), true, 'edit-only files retain compact Save and Discard actions only while changes exist')
assert.equal(windowedHeaderSource.includes('border-y border-[var(--surface-panel-divider)]'), true, 'the docked viewer header has a clean boundary from the app header above it')
assert.ok(windowedHeaderSource.indexOf('<PreviewHeaderHtmlControls') < windowedHeaderSource.indexOf('<PreviewHeaderEditMenu'), 'windowed HTML header places Viewport before Preview')
assert.ok(expandedHeaderSource.indexOf('<PreviewHeaderHtmlControls') < expandedHeaderSource.indexOf('aria-pressed={isEditMode}'), 'expanded HTML header places Viewport before the Edit toggle')
assert.equal(expandedHeaderSource.includes('<PreviewHistoryNavigation'), true, 'expanded previews expose the same navigation before the tab strip')
assert.equal(expandedHeaderSource.includes('border-y border-[var(--surface-panel-divider)]'), true, 'docked full-screen preview chrome has a clear boundary below the app tab strip')
assert.equal(expandedHeaderSource.includes('createPortal(toolbar, focusHost)'), false, 'file controls render as a second workspace toolbar instead of replacing the app tab strip')
assert.equal(expandedHeaderSource.includes('const showFileTabs = showPreviewTabs && previewTabs.length > 1'), true, 'a single focused file uses quiet identity instead of a redundant tab strip')
assert.equal(windowedHeaderSource.includes('const showFileTabs = showPreviewTabs && previewTabs.length > 1'), true, 'multi-file sessions expose the same tabs before entering full screen')
assert.doesNotMatch(windowedHeaderSource + expandedHeaderSource, /canRunPython|pythonRunState|Run Python|Stop Python/, 'windowed and expanded previews expose no Python runner')
assert.equal(expandedHeaderSource.includes('<FileActionsMenu'), false, 'full-screen file chrome has no redundant three-dot actions menu')
assert.equal(expandedHeaderSource.includes('<MoreHorizontal'), false, 'the removed overflow trigger cannot leave an inert icon behind')
assert.equal(titleBarSource.includes('FILE_PREVIEW_FOCUS_TOOLBAR_HOST_ID'), false, 'the main title bar remains reserved for workspace tabs')
assert.match(titleBarSource, /FILE_PREVIEW_FOCUS_STATE_EVENT[\s\S]*FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT/, 'the docked app sidebar control adopts the active full-screen file navigator')
assert.match(modalSource, /publishNavigatorToAppTitleBar[\s\S]*FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT/, 'only an active docked full-screen preview publishes navigator ownership')
assert.match(expandedHeaderSource, /showLeftPanelToggle[\s\S]*onToggleLeftPanel/, 'the second toolbar hides its duplicate navigator control when the app title bar owns it')
assert.match(fileFocusModeSource, /active: boolean[\s\S]*leftPanelOpen: boolean/, 'file-focus ownership reports the navigator state needed by the top control')
assert.match(fileFocusModeSource, /dataset\.filePreviewTitlebarNavigator/, 'docked file-focus ownership is reflected on the renderer root')
assert.equal(expandedHeaderSource.includes('data-file-preview-local-navigator-toggle'), true, 'the local navigator control exposes a deterministic duplicate-control hook')
assert.match(indexCssSource, /data-file-preview-titlebar-navigator='true'[\s\S]*data-file-preview-local-navigator-toggle[\s\S]*display:\s*none/, 'the docked renderer forcibly suppresses the duplicate lower toggle')
assert.equal(utilityWindowSource.includes('FILE_PREVIEW_FOCUS_TOOLBAR_HOST_ID'), false, 'utility-window tab chrome remains visible above focused file controls')
assert.equal(modalSource.includes("const defaultRightPanelOpen = initialMode === 'edit'"), true, 'Preview mode starts with the contextual Inspector closed')
assert.match(expandedWorkspaceSource, /flex h-full min-h-0 flex-col[^']*transition-/, 'the Inspector owns the full side-panel width')
assert.match(expandedWorkspaceSource, /will-change-\[width,transform\][\s\S]*duration-\[220ms\]/, 'the file navigator uses one short compositor-conscious open and close curve')
assert.equal(expandedWorkspaceSource.includes("style={{ width: `${leftPanelWidth}px` }}"), true, 'the tree keeps a fixed internal width while its viewport animates')
assert.match(expandedWorkspaceSource, /h-full min-h-0 shrink-0 flex flex-col overflow-hidden/, 'the animated viewport preserves the file tree flex and scroll chain')
assert.match(expandedWorkspaceSource, /motion-reduce:transition-none/, 'file navigator motion respects reduced-motion preferences')
assert.doesNotMatch(expandedWorkspaceSource, /flex h-full min-h-0 flex-col[^']*\bp-3\b/, 'outer right padding cannot leave a gutter after the Inspector scrollbar')
assert.equal(previewInspectorSource.includes('Git Snapshot'), false, 'the focused Inspector omits empty Git cards')
assert.equal(previewInspectorSource.includes('Edit Session'), false, 'the focused Inspector omits passive edit-session cards')
assert.equal(previewInspectorSource.includes('Editor Tools'), false, 'editor controls no longer occupy the Inspector')
assert.equal(documentOutlineSource.includes('OUTLINE_SOURCE_LIMIT = 2 * 1024 * 1024'), true, 'document outline discovery stays bounded for giant documents')
assert.equal(previewContextSource.includes("type SidebarMode = 'outline' | 'inspector'"), true, 'Outline and Inspector remain dedicated side-panel modes')
assert.equal(previewOutlineSource.includes('placeholder="Search"'), true, 'the document outline keeps concise search adjacent to the tree')
assert.equal(fileMarkdownSource.includes('MARKDOWN_PREVIEW_NAVIGATE_EVENT'), true, 'Outline navigation reaches virtualized headings')
assert.equal(fileMarkdownSource.includes('schedulePendingAnchorScroll()'), true, 'Outline navigation follows the virtual section jump with an exact rendered-heading alignment')
assert.equal(fileMarkdownSource.includes('resetScrollFilePathRef.current !== filePath'), true, 'each newly rendered Markdown file owns one fresh top position without resetting after measurements')
assert.equal(fileMarkdownSource.includes('MARKDOWN_PREVIEW_ACTIVE_HEADING_EVENT'), true, 'Markdown scrolling keeps the active outline heading synchronized')
assert.equal(editorSettingsSource.includes('Editor settings'), true, 'Edit mode retains Find, Replace, Wrap, Minimap, and font controls in one popover')
assert.equal(windowedHeaderSource.indexOf('<Expand size={16}') < windowedHeaderSource.indexOf('<PreviewHeaderEditMenu'), true, 'the expand icon sits immediately before the Preview control')
assert.equal(windowedHeaderSource.includes('group/expand ml-auto'), true, 'the expand icon starts the right-aligned file-action cluster')
assert.doesNotMatch(windowedHeaderSource, /<div className=\{controlGroupClass\}>[\s\S]{0,220}onToggleExpanded/, 'the expand icon has no enclosing control container')
assert.equal(windowedHeaderSource.includes('group-hover/file:opacity-100'), true, 'copy path stays quiet until the file identity is engaged')
assert.equal(windowedHeaderSource.includes('h-4 w-px shrink-0'), true, 'a single divider separates navigation from file identity')
assert.match(historyNavigationSource, /expanded\s*\? 'h-full px-1'/, 'expanded history controls stay on the same clean toolbar surface')
assert.doesNotMatch(historyNavigationSource, /expanded[\s\S]{0,80}border-r|expanded[\s\S]{0,100}bg-sparkle-bg/, 'expanded history controls do not create a false nested top bar')
assert.equal(historyHookSource.includes('requestExternalIntent(() =>'), true, 'history traversal preserves the unsaved-edit confirmation flow')
assert.equal(historyHookSource.includes('onBeforeNavigate'), false, 'history traversal cannot freeze the tree on an unrelated folder')
assert.equal(layoutSource.includes('windowedNavigatorEnabled ? ('), true, 'tagged targets mount the file navigator inside the windowed preview modal')
assert.equal(layoutSource.includes('navigationSidebar'), true, 'windowed and expanded previews reuse the existing full navigator')
assert.equal(layoutSource.includes('variant="sidebar"'), true, 'windowed and expanded previews use the same files-and-folders navigator')
assert.equal(layoutSource.includes("variant={isExpanded ? 'navigation' : 'sidebar'}"), false, 'expanded previews do not fall back to the folder-only Files navigation pane')
assert.equal(layoutSource.includes("top-[34px]"), true, 'expanded preview chrome begins directly below the 34px app title bar')
assert.equal(expandedWorkspaceSource.lastIndexOf('{header}') < expandedWorkspaceSource.lastIndexOf('<aside'), true, 'one full-width preview header spans both the folder pane and document')
assert.equal(previewHookSource.includes("options?.targetKind === 'directory'"), true, 'preview state represents directory targets without inventing a fake file')
assert.equal(previewHookSource.includes('options?.revealNavigatorTarget === true'), true, 'link-origin reveal intent receives a unique preview request')
assert.match(previewHookSource, /const previewTabs = useMemo\([\s\S]*\[previewTabsState\]/, 'stable tab descriptors keep memoized header tabs off unrelated render paths')
assert.equal(assistantNavigationSource.includes("targetKind: 'directory'"), true, 'assistant directory tags open the preview navigator')
assert.equal(assistantNavigationSource.includes('revealNavigatorTarget: true'), true, 'assistant file links explicitly request one navigator reveal')
assert.equal(markdownNavigationSource.includes('revealNavigatorTarget: true'), true, 'Markdown file links explicitly request one navigator reveal')
assert.equal(modalInteractionsSource.includes('useNavigate'), false, 'file previews stay mountable in independent workspace windows without a Router')
assert.equal(modalInteractionsSource.includes('openPreview: onOpenLinkedPreview ? openPreview : undefined'), true, 'local Markdown links remain inside their owning file preview')
assert.equal(historyHookSource.includes('revealNavigatorTarget: true'), true, 'Back and Forward reveal their unopened ancestor chain and selected target')
assert.equal(assistantNavigationSource.includes('/folder-browse/'), false, 'assistant directory tags no longer leave chat for the folder-browse route')
assert.equal(desktopPackage.dependencies?.['@pierre/trees'], undefined, 'the preview Explorer has no third-party tree runtime')
assert.equal(virtualTreeSource.includes('@pierre/trees'), false, 'the virtual tree does not retain a hidden Pierre adapter')
assert.equal(sidebarSource.includes('<PreviewVirtualFileTree'), true, 'the preview navigator renders through Zyra’s focused virtual tree')
assert.equal(sidebarSource.includes('aria-label="Search workspace files"'), true, 'the workspace Explorer exposes its file search')
assert.equal(sidebarSource.includes('tracking-[0.14em]'), false, 'the redundant standalone Explorer title row is removed')
assert.equal(sidebarSource.includes('File map'), false, 'the Explorer-only surface removes the app-style File map tab')
assert.equal(sidebarSource.includes('ExplorerCreateIcon'), true, 'new file and folder actions use compact layered entry glyphs')
assert.equal(sidebarSource.includes("startCreate('file', treeRootPath)"), true, 'workspace actions create from the actual Explorer root')
assert.equal(sidebarSource.includes('Collapse Folders in Explorer'), true, 'the workspace header exposes the standard collapse-all action')
assert.equal(modalAnalysisSource.includes('extractOutlineItems'), false, 'removed File map parsing does not continue in hidden preview work')
assert.equal(sidebarSource.includes('DraggablePreviewFileRow'), false, 'the custom file-row renderer is no longer in the production sidebar')
assert.equal(sidebarSource.includes('<span>Up</span>'), false, 'the duplicate bottom Up navigation is removed')
assert.equal(sidebarSource.includes('<span>Prev</span>'), false, 'the duplicate bottom history navigation is removed')
assert.equal(sidebarSource.includes('<span>Next</span>'), false, 'the top Back and Forward controls remain the only history surface')
assert.equal(folderTreeHookSource.includes('maxDepth: 0'), true, 'the project tree loads one directory level at a time instead of blocking preview startup')
assert.equal(virtualTreeSource.includes('requestDirectoryLoad(node)'), true, 'expanding a virtual directory lazily loads its real filesystem children')
assert.equal(virtualTreeSource.includes('onWheel={handleTreeWheel}'), false, 'the tree does not replace native scrolling with scrollTop writes')
assert.equal(virtualWindowSource.includes("addEventListener('scroll', scheduleRangeUpdate, { passive: true })"), true, 'the viewport uses one passive native scroll listener')
assert.equal(virtualWindowSource.includes('window.requestAnimationFrame'), true, 'scroll range work is coalesced to animation frames')
assert.equal(virtualWindowSource.includes('previewVirtualScrollOffsets'), true, 'clearing recursive search restores the prior tree scroll position')
assert.match(virtualTreeSource, /restoreKey: `\$\{rootPathKey\}:\$\{presentation\}:\$\{nameLayout\}`/, 'tree scroll restoration is scoped to the active root and presentation')
assert.equal(virtualTreeSource.includes('buildVisiblePreviewTreeModel(nodes, expandedKeys)'), true, 'hierarchy, lookup indexes, and width are built once when tree or expansion state changes')
assert.equal(virtualTreeSource.includes('rows.slice(range.start, range.end)'), true, 'only the virtual row window reaches React rendering')
assert.equal(virtualTreeSource.includes('group-hover/tree-row:opacity-100'), true, 'row actions stay quiet until the row is engaged, like an editor explorer')
assert.equal(virtualTreeSource.includes("presentation === 'workspace' || presentation === 'navigation' ? 32 : 24"), true, 'workspace, navigation and compact trees keep known fixed row heights')
assert.equal(virtualTreeSource.includes("presentation === 'navigation'"), true, 'full-screen Files can reuse the virtual tree as a folder navigation pane')
assert.equal(virtualTreeSource.includes("nameLayout === 'horizontal' ? 'overflow-auto'"), true, 'full names can use a horizontally scrollable tree')
assert.equal(settingsSource.includes("filePreviewExplorerNameLayout: 'wrap'"), true, 'the legacy filename-layout default stays readable by existing settings')
assert.equal(virtualTreeSource.includes("scrollToIndex(targetIndex, 'center')"), true, 'an externally opened file or folder is aligned at the center of the tree viewport')
assert.equal(virtualTreeSource.includes("scrollToIndex(targetIndex, 'top')"), false, 'revealed targets are never pinned awkwardly against the top edge')
assert.equal(virtualWindowSource.includes('type PreviewTreeScrollAlignment'), true, 'the virtual tree owns deterministic centered reveal geometry')
assert.equal(virtualTreeSource.includes('appliedRevealRequestsRef.current.has(revealTargetRequestId)'), true, 'each link-origin reveal request is consumed once')
assert.equal(modalSource.includes('handledNavigatorRevealRequests'), true, 'layout remounts and tab changes cannot replay a consumed reveal request')
assert.equal(virtualTreeSource.includes('appliedAutoExpansionPathsRef.current.has(pathKey)'), true, 'automatic ancestor expansion does not reopen folders the user collapsed')
assert.equal(virtualTreeSource.includes('appliedCollapseAllRequestRef'), true, 'Explorer collapse-all updates expansion state without rebuilding a package model')
assert.equal(virtualTreeSource.includes('previewTreeExpansionCache'), true, 'clearing file search restores the exact expanded folder set')
assert.match(sidebarSource, /selectedPathKind=\{normalizePathKey\(selectedWorkspacePath\) === normalizePathKey\(activeFolderPath\)/, 'directory previews reveal the active folder while file selections retain file semantics across platform path casing')
assert.match(sidebarSource, /internalSelectionPathRef[\s\S]*setSelectedWorkspacePath[\s\S]*automaticRevealRequestId/, 'the tree distinguishes its own clicks from externally opened targets without remounting')
assert.equal(sidebarSource.includes('revealTargetRequestId={effectiveRevealTargetRequestId}'), true, 'the tree centers external file changes even when they did not originate from an explicit link reveal')
assert.equal(sidebarSource.includes('onActivateDirectory={(node) => navigateToFolder(node.path)}'), true, 'opening a folder makes it the selected, centered navigator target while its disclosure remains independently controllable')
assert.equal(modalInteractionsSource.includes('markPreserveSidebarContext'), false, 'non-tree navigation cannot emit a stale preserve-folder signal that blocks lazy ancestor loading')
assert.equal(folderTreeHookSource.includes('navigatorTargetSettled'), true, 'target reveal waits for the latest ancestor snapshot without blanking the visible tree')
assert.equal(virtualTreeSource.includes('!revealReady'), true, 'the virtual tree does not consume a reveal before unopened ancestors and the target row exist')
assert.equal(layoutSource.includes('leftSidebar={navigationSidebar}'), true, 'closing or changing files keeps the full-screen tree mounted with its scroll and expansion state')
assert.match(layoutSource, /transition-\[width,max-width,height,max-height,border-radius,margin,box-shadow,border-color,opacity\][^']*duration-320/, 'one frame geometry transition runs symmetrically into and out of full screen')
assert.equal(layoutSource.includes('startViewTransition'), false, 'file mode changes do not introduce a competing snapshot transition system')
assert.equal(previewChromeSource.includes("animation: 'scaleIn"), false, 'leaving full screen cannot restart a competing one-way modal entrance animation')
assert.equal(previewChromeSource.includes("maxWidth: '100vw'"), true, 'full-screen and centered frame bounds remain numerically interpolable in both directions')
assert.equal(folderTreeHookSource.includes('The virtual tree owns live expansion state'), true, 'folder expansion avoids a redundant visible-row flatten before loading')
assert.equal(folderTreeHookSource.includes('background: true'), false, 'a fresh cached tree is not silently replaced while the user starts scrolling')
assert.equal(folderTreeHookSource.includes('latestRequestByPathRef'), true, 'independent folder loads do not cancel each other')
assert.equal(folderTreeHookSource.includes('Promise.all(directoryPaths.map'), true, 'restored ancestor directories cross IPC concurrently')
assert.equal(previewChromeSource.includes('pendingResizeClientXRef'), true, 'panel drag coalesces pointer movement before React width updates')
assert.equal(previewChromeSource.includes('requestAnimationFrame'), true, 'panel drag performs at most one width commit per frame')
assert.equal(previewChromeSource.includes('onPanelWidthCommit'), true, 'resized navigator widths persist only after interaction settles')
assert.equal(panelPreferencesSource.includes('zyra:file-preview-panel-layout:v1'), true, 'preview panel widths survive modal remounts')
assert.equal(previewSkeletonSource.includes('Loading project files'), true, 'lazy module and filesystem loading share one row-shaped skeleton')
assert.equal(mediaPreviewSource.includes('useLayoutEffect'), true, 'media transitions install the retained outgoing frame before the browser paints the new file')
assert.equal(mediaPreviewSource.includes('preloadAdjacentImages'), true, 'neighboring local images decode before arrow navigation needs them')
assert.equal(mediaPreviewSource.includes('MEDIA_TRANSITION_MS + MEDIA_TRANSITION_SETTLE_BUFFER_MS'), true, 'the retained media stage cannot unmount before its CSS motion finishes')
assert.equal(mediaPreviewSource.includes('motion-reduce:transition-none'), true, 'media navigation respects reduced-motion preferences')
assert.equal(mediaPreviewSource.includes('ref={setImageControlsHost}'), true, 'image controls mount in a stationary layer above the sweeping media stages')
assert.match(mediaPreviewSource, /transitionState\.from,[\s\S]{0,180}imageControlsHost,\s+false/, 'the outgoing image cannot carry a duplicate controls panel through the sweep')
assert.equal(imagePreviewSource.includes('createPortal(controls, controlsHost)'), true, 'image control actions remain connected while their panel stays outside the moving image')
assert.equal(assistantFilesWorkspaceSource.includes('<FilesPreviewBoundary key={preview.previewFile.path}'), false, 'Files arrow navigation cannot remount the complete preview modal')
assert.equal(assistantFilesWorkspaceSource.includes('resetKey={preview.previewFile.path}'), true, 'preview failures reset for a different file without remounting healthy media')
assert.equal(folderTreeHookSource.includes('toggleDirectory'), false, 'dead navigation logic from the retired custom tree is removed')
assert.equal(treeMenuSource.includes('createPortal('), true, 'tree action menus leave the clipping sidebar stack')
assert.equal(treeMenuSource.includes('z-[360]'), true, 'tree action menus paint above the preview editor')
assert.equal(htmlControlsSource.includes('border border-white/[0.07] bg-transparent'), true, 'the HTML viewport button inherits the color of its control section')
assert.match(htmlControlsSource, /'border border-sparkle-border bg-sparkle-card p-1/, 'the floating HTML viewport menu keeps an opaque themed surface')
assert.equal(windowedHeaderSource.indexOf('PanelLeftClose size') < windowedHeaderSource.indexOf('<PreviewHistoryNavigation'), true, 'the stateful sidebar toggle sits before Back and Forward in windowed previews')
assert.equal(expandedHeaderSource.indexOf('PanelLeftClose size') < expandedHeaderSource.indexOf('<PreviewHistoryNavigation'), true, 'expanded previews keep the same left-side toggle order')
assert.equal(expandedHeaderSource.includes('my-2 ml-1 w-px'), false, 'the doubled separator between history and file identity is removed')
assert.equal(expandedHeaderSource.includes('group/file'), true, 'the focused file identity owns the same quiet hover affordance as the windowed header')
assert.equal(expandedHeaderSource.includes("style={{ WebkitAppRegion: 'no-drag'"), true, 'the expanded preview toolbar remains a clickable control surface')
assert.match(codePreviewPlaceholderSource, /lineNumberStart \+ index/, 'the editor loading view renders the same starting line offset as Monaco')
assert.match(syntaxPreviewSource, /fallback=\{<CodePreviewPlaceholder[^>]+lineNumberStart=\{lineNumberStart\}/, 'the lazy-loading view forwards the real line-number offset')
assert.match(monacoPreviewEditorSource, /loading=\{<CodePreviewPlaceholder[^>]+lineNumberStart=\{lineNumberStart\}/, 'the Monaco loading view forwards the real line-number offset')
assert.equal(expandedHeaderSource.includes('usePreviewPathCopy(file.path)'), true, 'full-screen file identity uses the confirmed clipboard bridge for copy path')
assert.ok(expandedHeaderSource.indexOf('title="Exit file focus mode"') < expandedHeaderSource.indexOf('<PreviewHeaderHtmlControls'), 'exit full screen precedes the Viewport then Preview controls')
assert.match(expandedHeaderSource, /\{previewModeEnabled \? \([\s\S]*aria-pressed=\{isEditMode\}/, 'expanded Preview/Edit files use a single Edit toggle')
assert.match(expandedHeaderSource, /title=\{rightPanelOpen \? 'Hide file side panel' : 'Show file side panel'\}[\s\S]{0,120}<PanelRight size=\{14\}/, 'expanded files expose Inspector as a toolbar icon')
assert.equal(editMenuSource.includes('saveStatusLabel'), false, 'the clean menu omits a redundant always-visible Saved status')
assert.match(editMenuSource, /isDirty \? \([\s\S]*>Discard</, 'Save and Discard appear only when there are edits to act on')
assert.match(editMenuSource, /PanelRight[\s\S]*Inspector/, 'the combined menu owns the full-screen Inspector toggle')
assert.equal(editMenuSource.includes('Eye'), false, 'Preview does not use the rejected eye icon')
assert.equal(editMenuSource.includes('FileText'), true, 'Preview uses the file-view icon in the split button and menu')
assert.match(editMenuSource, /rounded-b-none[\s\S]*absolute left-0 top-full[\s\S]*w-full/, 'the simple dropdown stays physically connected to its split button')

console.log('File preview navigation contract: ok')
