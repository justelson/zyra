import './fixtures/inline-overlay-ssr'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantBrowserNewTab } from '../src/renderer/src/pages/assistant/AssistantBrowserNewTab'
import { SettingsProvider } from '../src/renderer/src/lib/settings'
import { AssistantBrowserHistoryImportDialog } from '../src/renderer/src/pages/assistant/AssistantBrowserHistoryImportDialog'
import { isBrowserDevscopeBridgePath } from '../src/shared/browser-assistant-bridge'
import {
    ASSISTANT_INSPECTOR_TAB_KEYBOARD_CODES,
    calculateWorkspaceTabWidth
} from '../src/renderer/src/pages/assistant/AssistantInspectorSidebar'
import { ensureAssistantInspectorBrowserTab } from '../src/renderer/src/pages/assistant/assistant-inspector-workspace-state'
import { assistantTabDragWithTearOff } from '../src/renderer/src/pages/assistant/assistant-tab-drag-modifier'
import { buildAssistantBrowserOmniboxSuggestions, clusterAssistantBrowserHistoryBySite, filterAssistantBrowserHistory, groupAssistantBrowserHistoryByDay, mergeAssistantBrowserHistoryEntry, resolveAssistantBrowserHistoryActiveIndex, resolveAssistantBrowserHistoryKeyboardAction, resolveAssistantBrowserHistoryRecord, resolveAssistantBrowserOmniboxActiveDescendant, resolveAssistantBrowserOmniboxKeyboardAction, transitionAssistantBrowserProfileReloadHistory, type AssistantBrowserProfileReloadHistoryPhase } from '../src/renderer/src/pages/assistant/assistant-browser-history'
import {
    createAssistantBrowserWorkspaceState,
    ensureAssistantBrowserSurfaceTabs,
    ensureAssistantBrowserWorkspaceTab,
    normalizeAssistantBrowserWorkspaceState,
    shouldFocusAssistantBrowserOmnibox,
    updateAssistantBrowserTab
} from '../src/renderer/src/pages/assistant/assistant-browser-workspace-state'

assert.equal(isBrowserDevscopeBridgePath(['getBrowserHistory']), false, 'thin Browser clients cannot read Desktop Browser history through crafted relay requests')
assert.equal(isBrowserDevscopeBridgePath(['recordBrowserHistory']), false, 'thin Browser clients cannot forge Desktop Browser history')
assert.equal(isBrowserDevscopeBridgePath(['clearBrowserHistory']), false, 'thin Browser clients cannot clear Desktop Browser history')
assert.equal(isBrowserDevscopeBridgePath(['getRunningLocalServers']), false, 'thin Browser clients cannot enumerate Desktop listeners')
assert.equal(isBrowserDevscopeBridgePath(['getBrowserSearchSuggestions']), false, 'thin Browser clients cannot relay typed searches through Desktop')
assert.equal(isBrowserDevscopeBridgePath(['scanExternalBrowserHistoryProfiles']), false, 'thin Browser clients cannot scan Desktop browser profiles')
assert.equal(isBrowserDevscopeBridgePath(['importExternalBrowserHistory']), false, 'thin Browser clients cannot import Desktop browser history')
assert.equal(calculateWorkspaceTabWidth(900, 4), 168, 'very wide Inspector tabs stop at a restrained browser-tab maximum')
assert.equal(calculateWorkspaceTabWidth(800, 4), 150, 'wide tabs use the available Inspector title bar instead of clustering at the left')
assert.equal(calculateWorkspaceTabWidth(600, 4), 112, 'tabs stop shrinking while their titles remain readable')
assert.equal(calculateWorkspaceTabWidth(500, 4), 112, 'narrow Inspectors scroll rather than crush tab labels')
assert.equal(calculateWorkspaceTabWidth(420, 4), 112, 'tabs retain the same minimum width before the rail scrolls')
assert.equal(calculateWorkspaceTabWidth(900, 10), 112, 'many tabs overflow beneath the pinned add action')
assert.deepEqual(ASSISTANT_INSPECTOR_TAB_KEYBOARD_CODES, {
    start: ['Space'],
    cancel: ['Escape'],
    end: ['Space']
}, 'Enter remains ordinary tab activation while Space owns accessible keyboard reordering')
const dragRect = { left: 100, right: 200, top: 100, bottom: 128, width: 100, height: 28 }
const dragContainer = { left: 80, right: 420, top: 96, bottom: 134, width: 340, height: 38 }
const dragWindow = { left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 }
const dragArgs = {
    activatorEvent: null,
    active: null,
    activeNodeRect: dragRect,
    draggingNodeRect: dragRect,
    containerNodeRect: dragContainer,
    over: null,
    overlayNodeRect: dragRect,
    scrollableAncestors: [],
    scrollableAncestorRects: [],
    windowRect: dragWindow
}
assert.equal(assistantTabDragWithTearOff({ ...dragArgs, transform: { x: 40, y: 18, scaleX: 1, scaleY: 1 } }).y, 0, 'ordinary in-strip sorting remains horizontal')
assert.equal(assistantTabDragWithTearOff({ ...dragArgs, transform: { x: 40, y: 52, scaleX: 1, scaleY: 1 } }).y, 2, 'the lifted preview crosses the 44px strip-edge threshold without a vertical jump')
assert.equal(assistantTabDragWithTearOff({ ...dragArgs, transform: { x: 40, y: 68, scaleX: 1, scaleY: 1 } }).y, 18, 'the lifted preview follows pointer deltas after the threshold handoff')
const existingInspectorTabs = [{ id: 'review', kind: 'review' } as const]
const withOtherServerTab = ensureAssistantInspectorBrowserTab(existingInspectorTabs, 'browser:server-6006')
assert.deepEqual(withOtherServerTab, [
    existingInspectorTabs[0],
    { id: 'browser:server-6006', kind: 'browser', browserTabId: 'browser:server-6006' }
], 'opening another server creates a distinct outer Browser workspace tab')
assert.equal(ensureAssistantInspectorBrowserTab(withOtherServerTab, 'browser:server-6006'), withOtherServerTab, 'reselecting the same Browser page cannot duplicate its outer tab')
const historyFixture = [{
    url: 'https://example.com/docs',
    title: 'Example documentation',
    faviconUrl: 'https://example.com/favicon.ico',
    lastVisitedAt: '2026-08-19T12:00:00.000Z',
    visitCount: 2
}, {
    url: 'https://example.com/docs/setup',
    title: 'Setup documentation',
    faviconUrl: 'https://example.com/favicon.ico',
    lastVisitedAt: '2026-08-18T12:00:00.000Z',
    visitCount: 3
}]
assert.equal(filterAssistantBrowserHistory(historyFixture, 'documentation', 8)[0]?.url, historyFixture[0].url, 'omnibox history matches page titles')
assert.equal(filterAssistantBrowserHistory(historyFixture, 'example.com', 8)[0]?.url, historyFixture[0].url, 'omnibox history matches URLs')
assert.equal(mergeAssistantBrowserHistoryEntry(historyFixture, { ...historyFixture[0], title: 'Updated', visitCount: 3 }).length, 2, 'renderer history merges repeated page identities')
assert.equal(clusterAssistantBrowserHistoryBySite(historyFixture).length, 1, 'history presentation aggregates repeated paths under one site')
assert.equal(clusterAssistantBrowserHistoryBySite(historyFixture)[0]?.pageCount, 2)
assert.deepEqual(groupAssistantBrowserHistoryByDay(historyFixture, new Date('2026-08-19T18:00:00.000Z')).map((group) => group.label), ['Today', 'Yesterday'])
assert.equal(buildAssistantBrowserOmniboxSuggestions(['example docs search'], historyFixture).filter((entry) => entry.kind === 'history').length, 1, 'omnibox offers one history destination per site rather than every path')
assert.equal(resolveAssistantBrowserHistoryActiveIndex(-1, 'ArrowDown', 3), 0)
assert.equal(resolveAssistantBrowserHistoryActiveIndex(0, 'ArrowDown', 3), 1)
assert.equal(resolveAssistantBrowserHistoryActiveIndex(2, 'ArrowDown', 3), 2)
assert.equal(resolveAssistantBrowserHistoryActiveIndex(0, 'ArrowUp', 3), 2)
assert.equal(resolveAssistantBrowserHistoryActiveIndex(2, 'ArrowUp', 3), 1)
assert.deepEqual(resolveAssistantBrowserHistoryKeyboardAction(-1, 'ArrowDown', historyFixture), { handled: true, activeIndex: 0, navigateUrl: null })
assert.deepEqual(resolveAssistantBrowserHistoryKeyboardAction(0, 'Enter', historyFixture), { handled: true, activeIndex: 0, navigateUrl: historyFixture[0].url })
assert.deepEqual(resolveAssistantBrowserHistoryKeyboardAction(-1, 'Enter', historyFixture), { handled: false, activeIndex: -1, navigateUrl: null })
const behavioralOmniboxSuggestions = buildAssistantBrowserOmniboxSuggestions(['zyra browser', 'zyra history'], historyFixture)
let behavioralOmniboxIndex = -1
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp'] as const) {
    const action = resolveAssistantBrowserOmniboxKeyboardAction(behavioralOmniboxIndex, key, behavioralOmniboxSuggestions)
    assert.equal(action.handled, true)
    behavioralOmniboxIndex = action.activeIndex
}
assert.equal(behavioralOmniboxIndex, 0, 'ArrowDown/ArrowUp update the same active omnibox index exposed to assistive technology')
assert.equal(
    resolveAssistantBrowserOmniboxActiveDescendant('behavioral-suggestions', behavioralOmniboxIndex, behavioralOmniboxSuggestions),
    'behavioral-suggestions-option-0',
    'aria-activedescendant identifies the keyboard-active option'
)
assert.deepEqual(
    resolveAssistantBrowserOmniboxKeyboardAction(behavioralOmniboxIndex, 'Enter', behavioralOmniboxSuggestions),
    { handled: true, activeIndex: 0, navigateValue: behavioralOmniboxSuggestions[0]?.value || null },
    'Enter navigates to the option named by aria-activedescendant'
)
assert.equal(resolveAssistantBrowserOmniboxActiveDescendant('behavioral-suggestions', 99, behavioralOmniboxSuggestions), undefined, 'ARIA never references a missing option')
const loadingHistoryTab = {
    ...createAssistantBrowserWorkspaceState('browser:history').tabs[0],
    url: 'https://example.com/docs',
    title: 'Example documentation',
    status: 'loading' as const
}
assert.deepEqual(resolveAssistantBrowserHistoryRecord(loadingHistoryTab, { status: 'ready' }), {
    url: loadingHistoryTab.url,
    title: loadingHistoryTab.title,
    faviconUrl: null
}, 'a completed page load creates one visit')
assert.equal(resolveAssistantBrowserHistoryRecord(loadingHistoryTab, { status: 'error' }), null, 'failed page loads never enter history')
assert.equal(resolveAssistantBrowserHistoryRecord({ ...loadingHistoryTab, status: 'ready' }, { faviconUrl: 'https://example.com/favicon.ico' })?.incrementVisit, false, 'late favicon metadata does not invent a visit')
assert.equal(resolveAssistantBrowserHistoryRecord({ ...loadingHistoryTab, status: 'ready' }, { url: 'https://example.com/docs#part-2' })?.url, 'https://example.com/docs#part-2', 'completed in-page navigation enters history')
const profileReloadVisit = { url: loadingHistoryTab.url, title: loadingHistoryTab.title, faviconUrl: null }
assert.deepEqual(transitionAssistantBrowserProfileReloadHistory('awaiting-start', 'loading', null), { nextPhase: 'loading', suppressRecord: false })
assert.deepEqual(transitionAssistantBrowserProfileReloadHistory('loading', 'ready', profileReloadVisit), { nextPhase: 'settled', suppressRecord: true }, 'the profile-reset reload completion stays out of history')
assert.deepEqual(transitionAssistantBrowserProfileReloadHistory('settled', undefined, { ...profileReloadVisit, incrementVisit: false }), { nextPhase: 'settled', suppressRecord: true }, 'late reset metadata remains suppressed')
assert.deepEqual(transitionAssistantBrowserProfileReloadHistory('settled', 'loading', null), { nextPhase: undefined, suppressRecord: false }, 'a later full navigation releases profile-reset suppression')
assert.deepEqual(transitionAssistantBrowserProfileReloadHistory('settled', undefined, profileReloadVisit), { nextPhase: undefined, suppressRecord: false }, 'a later in-page navigation releases profile-reset suppression')
let behavioralReloadPhase: AssistantBrowserProfileReloadHistoryPhase | undefined = 'awaiting-start'
const behavioralReloadRecords: string[] = []
const applyReloadTransition = (status: 'loading' | 'ready' | undefined, record: Parameters<typeof transitionAssistantBrowserProfileReloadHistory>[2], label: string) => {
    const transition = transitionAssistantBrowserProfileReloadHistory(behavioralReloadPhase, status, record)
    behavioralReloadPhase = transition.nextPhase
    if (record && !transition.suppressRecord) behavioralReloadRecords.push(label)
}
applyReloadTransition('loading', null, 'reset-start')
applyReloadTransition('ready', profileReloadVisit, 'reset-finish')
applyReloadTransition(undefined, { ...profileReloadVisit, incrementVisit: false }, 'reset-metadata')
applyReloadTransition('loading', null, 'later-start')
applyReloadTransition('ready', { ...profileReloadVisit, url: 'https://example.com/later' }, 'later-finish')
assert.equal(behavioralReloadPhase, undefined, 'awaiting-start → loading → settled releases after a later navigation starts')
assert.deepEqual(behavioralReloadRecords, ['later-finish'], 'the reset reload and metadata stay suppressed while the later completed navigation is recorded')

let blankState = createAssistantBrowserWorkspaceState('browser:blank')
blankState = updateAssistantBrowserTab(blankState, 'browser:blank', { url: '', title: 'about:blank' })
assert.equal(blankState.tabs[0]?.title, 'New tab', 'live Chromium blank titles never leak into the Inspector')
const restoredBlankState = normalizeAssistantBrowserWorkspaceState({
    activeTabId: 'browser:blank',
    tabs: [{ id: 'browser:blank', url: '', title: 'about:blank' }]
})
assert.equal(restoredBlankState.tabs[0]?.title, 'New tab', 'persisted blank titles normalize at the state boundary')
const requestedInitialTab = ensureAssistantBrowserWorkspaceTab(
    createAssistantBrowserWorkspaceState('browser:0'),
    'browser:requested'
)
assert.equal(requestedInitialTab.tabs.length, 1, 'a requested tab reuses the sole pristine New Tab instead of creating two blank tabs')
assert.equal(requestedInitialTab.tabs[0]?.id, 'browser:requested')
assert.equal(requestedInitialTab.activeTabId, 'browser:requested')
const occupiedWorkspace = updateAssistantBrowserTab(createAssistantBrowserWorkspaceState('browser:0'), 'browser:0', {
    url: 'https://example.com/',
    status: 'ready'
})
const occupiedRequestedWorkspace = ensureAssistantBrowserWorkspaceTab(occupiedWorkspace, 'browser:requested')
assert.equal(occupiedRequestedWorkspace.tabs.length, 2, 'an occupied Browser tab is never replaced')
assert.equal(occupiedRequestedWorkspace.activeTabId, 'browser:requested', 'the requested tab is active before parent synchronization observes the workspace')
const hiddenSurfaceWorkspace = ensureAssistantBrowserSurfaceTabs(
    createAssistantBrowserWorkspaceState('browser:0'),
    'browser:background-request'
)
assert.equal(hiddenSurfaceWorkspace.tabs.length, 1, 'a non-revealing surface request reuses the pristine initial tab')
assert.equal(hiddenSurfaceWorkspace.activeTabId, 'browser:background-request')
const splitSurfaceWorkspace = ensureAssistantBrowserSurfaceTabs(
    createAssistantBrowserWorkspaceState('browser:0'),
    'browser:primary-request',
    'browser:secondary-request'
)
assert.deepEqual(splitSurfaceWorkspace.tabs.map((tab) => tab.id), ['browser:primary-request', 'browser:secondary-request'])
assert.equal(splitSurfaceWorkspace.activeTabId, 'browser:primary-request', 'adding the requested secondary tab cannot steal primary selection')
const incognitoSurfaceWorkspace = ensureAssistantBrowserSurfaceTabs(
    createAssistantBrowserWorkspaceState('browser:0'),
    'browser:private-request',
    null,
    'incognito'
)
assert.equal(incognitoSurfaceWorkspace.tabs[0]?.sessionMode, 'incognito', 'agent and user requests retain their incognito storage mode in the live workspace')
const restoredPrivateWorkspace = normalizeAssistantBrowserWorkspaceState({
    activeTabId: 'browser:private-request',
    tabs: [{ ...incognitoSurfaceWorkspace.tabs[0], url: 'https://private.example/' }]
})
assert.equal(restoredPrivateWorkspace.tabs[0]?.sessionMode, 'normal')
assert.equal(restoredPrivateWorkspace.tabs[0]?.url, '', 'incognito tabs and their URLs never restore from persisted workspace state')
assert.equal(shouldFocusAssistantBrowserOmnibox(true, true, requestedInitialTab.tabs[0]), true, 'a visible blank tab focuses the omnibox')
assert.equal(shouldFocusAssistantBrowserOmnibox(true, true, occupiedWorkspace.tabs[0]), false, 'loaded pages keep focus in page content')
assert.equal(shouldFocusAssistantBrowserOmnibox(false, true, requestedInitialTab.tabs[0]), false, 'hidden Inspector workspaces cannot steal focus')

const newTabMarkup = renderToStaticMarkup(createElement(SettingsProvider, null, createElement(AssistantBrowserNewTab, {
    projectServers: [{
        pid: 10,
        port: 5174,
        url: 'http://localhost:5174/',
        pageTitle: 'Zyra Desktop',
        processName: 'node.exe',
        attachedToProject: true
    }],
    otherServers: [{
        pid: 20,
        port: 6006,
        url: 'http://localhost:6006/',
        processName: 'storybook',
        attachedToProject: false
    }],
    loading: false,
    error: null,
    onRefresh: () => undefined,
    onNavigate: () => undefined,
    onOpenInNewTab: () => undefined,
    onOpenHistory: () => undefined,
    getSearchSuggestions: async () => []
})))
assert.match(newTabMarkup, />New tab</)
assert.doesNotMatch(newTabMarkup, /Recent|Example documentation/, 'New Tab keeps history hidden until the clock is selected')
assert.match(newTabMarkup, /Open Browser history/)
assert.match(newTabMarkup, /Search Google or enter an address/)
assert.match(newTabMarkup, /Running locally/)
assert.match(newTabMarkup, /aria-expanded="false"[^>]*aria-controls="assistant-browser-local-servers-content"[\s\S]*Local servers/, 'local servers start as the compact collapsed disclosure')
assert.match(newTabMarkup, /This project/)
assert.match(newTabMarkup, /Other local servers/)
assert.match(newTabMarkup, /Zyra Desktop/, 'local server rows prefer the page title returned by the server')
assert.match(newTabMarkup, /storybook/, 'local server rows retain the process name when a page has no title')
assert.doesNotMatch(newTabMarkup, />node</, 'the runtime process label stays hidden when the page provides a title')
assert.match(newTabMarkup, /localhost:5174/)
assert.match(newTabMarkup, /Open localhost:6006 in a new Browser tab/)
assert.match(newTabMarkup, /class="[^"]*size-8[^"]*"[^>]*aria-label="Open Browser history"/, 'the rendered History action uses the requested compact 32px target')
assert.match(newTabMarkup, /class="[^"]*size-9[^"]*"[^>]*aria-label="Open localhost:5174 in a new Browser tab"/, 'the rendered secondary server action has a 36px target')
const importWizardMarkup = renderToStaticMarkup(createElement(AssistantBrowserHistoryImportDialog, { onClose: () => undefined, onImported: () => undefined }))
assert.match(importWizardMarkup, /Sources · 1\/4/)
assert.match(importWizardMarkup, /Sources/)
assert.match(importWizardMarkup, /Choose browser profiles/)
assert.doesNotMatch(importWizardMarkup, /Choose what enters Zyra|Import progress/)

const inspectorSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantInspectorSidebar.tsx', import.meta.url), 'utf8')
const tabDragModifierSource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-tab-drag-modifier.ts', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantDiffPanel.tsx', import.meta.url), 'utf8')
const browserWorkspaceSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx', import.meta.url), 'utf8')
const browserNewTabSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserNewTab.tsx', import.meta.url), 'utf8')
const browserNewTabContrastSource = readFileSync(new URL('../src/renderer/src/pages/assistant/useAssistantBrowserNewTabContrast.ts', import.meta.url), 'utf8')
const browserHistoryPanelSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserHistoryPanel.tsx', import.meta.url), 'utf8')
const browserHistoryImportSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserHistoryImportDialog.tsx', import.meta.url), 'utf8')
const browserHistoryImportStepsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserHistoryImportSteps.tsx', import.meta.url), 'utf8')
const assistantDatePickerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantDatePicker.tsx', import.meta.url), 'utf8')
const assistantCheckboxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantCheckbox.tsx', import.meta.url), 'utf8')
const browserWebviewSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantBrowserWebview.tsx', import.meta.url), 'utf8')
const browserViewManagerSource = readFileSync(new URL('../src/main/browser-view-manager.ts', import.meta.url), 'utf8')
const browserHistoryStoreSource = readFileSync(new URL('../src/main/browser-history-store.ts', import.meta.url), 'utf8')
const browserUrlSanitizationSource = readFileSync(new URL('../src/shared/browser-url-sanitization.ts', import.meta.url), 'utf8')
const browserHistorySource = readFileSync(new URL('../src/renderer/src/pages/assistant/assistant-browser-history.ts', import.meta.url), 'utf8')
const processDetectorSource = readFileSync(new URL('../src/main/inspectors/process-detector.ts', import.meta.url), 'utf8')
const handlersSource = readFileSync(new URL('../src/main/ipc/handlers.ts', import.meta.url), 'utf8')
const browserPreviewHandlersSource = readFileSync(new URL('../src/main/ipc/handlers/browser-preview-handlers.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../src/preload/adapters/projects-adapter.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/shared/contracts/devscope-api.ts', import.meta.url), 'utf8')

assert.match(inspectorSource, /synchronizeTabWidths\(latest\.width\)/, 'tab widths update in the same animation frame as the Inspector drag')
assert.match(inspectorSource, /color-text\)_9%,var\(--surface-inspector-tab\)/, 'the active rounded tab has the stronger contrast surface')
assert.match(inspectorSource, /text-sparkle-text-secondary\/82/, 'inactive tabs remain clearly legible')
assert.match(inspectorSource, /tabRailOverflow && 'before:pointer-events-none/, 'overflowing Inspector tabs fade beneath the pinned add action')
assert.match(inspectorSource, /DndContext[\s\S]*PointerSensor[\s\S]*activationConstraint: \{ distance: 4 \}/, 'Inspector tabs use deliberate pointer-activated drag-and-drop instead of native drag ghosts')
assert.match(inspectorSource, /SortableContext[\s\S]*horizontalListSortingStrategy/, 'neighboring Inspector tabs react continuously while the dragged tab crosses them')
assert.match(inspectorSource, /modifiers=\{\[tabDragModifier\]\}/, 'the docked strip uses the shared deliberate tear-off handoff controller')
assert.match(tabDragModifierSource, /ASSISTANT_TAB_TEAR_OFF_THRESHOLD = 44/, 'ordinary sorting stays bounded until an intentional vertical tear-off threshold')
assert.match(tabDragModifierSource, /if \(!tearingOff\)[\s\S]*y: 0/, 'in-strip sorting remains horizontal before tear-off')
assert.match(tabDragModifierSource, /onTearOffChange\(true\)/, 'the modifier publishes the exact visible handoff state used at drop')
assert.match(tabDragModifierSource, /if \(!windowRect\) return \{ \.\.\.transform, x, y \}/, 'the lifted preview follows post-threshold pointer deltas')
assert.doesNotMatch(inspectorSource, /PanelTopOpen|Move \$\{tab\.label\} to a new window/, 'tabs detach by dragging rather than a hover-only button')
assert.match(inspectorSource, /useSortable[\s\S]*CSS\.Transform\.toString\(transform\)/, 'each tab follows measured sortable transforms with smooth sibling movement')
assert.match(inspectorSource, /DragOverlay[\s\S]*InspectorTabDragPreview/, 'dragging renders a lifted, content-complete tab preview')
assert.match(inspectorSource, /activeDragTabId \? tabs\.find/, 'the lifted preview reads current tab metadata while status changes continue')
assert.match(inspectorSource, /handleTabDragEnd[\s\S]*onReorderTab\(draggedTabId, targetTabId\)/, 'Inspector order and persistence commit once at the drop boundary')
assert.doesNotMatch(inspectorSource, /onDragMove=|onDragOver=/, 'pointer movement stays transform-only without React workspace writes')
assert.match(inspectorSource, /isDragging && 'cursor-grabbing'/, 'the tab enters drag cursor state only after dnd-kit activates a drag')
assert.doesNotMatch(inspectorSource, /cursor-grab(?:\s|')/, 'resting and hovered tabs keep their normal cursor before drag activation')
assert.doesNotMatch(inspectorSource, /animate-\[inspector-tab-in_150ms|animation: isSorting/, 'finishing a drag cannot replay mount animations across the tab strip')
assert.doesNotMatch(inspectorSource, /draggable=/, 'native HTML drag behavior cannot replace the reactive sortable preview')
assert.match(inspectorSource, /dropAnimation=\{reducedMotion \? null/, 'reduced motion disables the drag-overlay drop animation')
assert.match(inspectorSource, /if \(reducedMotion\)[\s\S]*element\.style\.width/, 'reduced motion applies tab widths directly without Web Animations')
assert.match(inspectorSource, /onCloseTabRef\.current\(tabId\)/, 'deferred close commits through the latest Inspector state callback')
assert.match(inspectorSource, /if \(reducedMotion\) \{[\s\S]*onCloseTabRef\.current\(tabId\)/, 'reduced motion closes tabs immediately instead of retaining a hidden animation delay')
assert.match(panelSource, /browserTab\?\.url[\s\S]{0,160}browserTab\?\.sessionMode === 'incognito' \? 'Incognito tab' : 'New tab'/, 'the visible outer title distinguishes a blank incognito tab without exposing page state')
assert.match(browserWorkspaceSource, /activeTab\?\.sessionMode === 'incognito'[\s\S]{0,180}<IncognitoIcon/, 'the omnibox uses the dedicated hat-and-glasses incognito mark')
assert.match(browserViewManagerSource, /createIncognitoBrowserSession\(\)[\s\S]*tabIds: new Set/, 'all active incognito tabs share one temporary session group')
assert.match(browserViewManagerSource, /tabIds\.size > 0[\s\S]*disposeIncognitoBrowserSession/, 'closing the last incognito tab clears its temporary session')
assert.match(browserWorkspaceSource, /onRequestTabSelection\(tabId\)/, 'Browser requests the outer tab selection before mutating its retained page model')
assert.match(panelSource, /handleBrowserTabSelectionRequest[\s\S]*ensureAssistantInspectorBrowserTab\(current, tabId\)[\s\S]*setActiveTabId\(tabId\)/, 'opening a server creates and selects its separate outer Inspector tab synchronously')
assert.match(browserViewManagerSource, /title = blank \? 'New tab'/, 'the main-owned Browser view normalizes about:blank before projecting tab metadata')
assert.match(browserWorkspaceSource, /getRunningLocalServers\(normalizedProjectPath\)/, 'New tab reads the main-owned local server inventory')
assert.match(browserWorkspaceSource, /<AssistantBrowserNewTab[\s\S]*key=\{activeTab\.id\}/, 'each blank Browser tab owns a fresh random-background lifecycle')
assert.match(browserWorkspaceSource, /getBrowserHistory\(\{ limit: 50 \}\)/, 'Browser loads its private main-owned history once')
assert.match(browserHistorySource, /completedNavigation \|\| completedInPageNavigation/, 'only completed main-frame or in-page navigation creates a history visit')
assert.match(browserHistorySource, /incrementVisit: false/, 'late favicon and title metadata cannot inflate visit counts')
assert.match(browserHistorySource, /Date\.UTC\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\)\)/, 'history periods use calendar-day ordinals instead of DST-sensitive millisecond division')
assert.match(browserWorkspaceSource, /Address and search suggestions/, 'the omnibox exposes one combined suggestion list')
assert.match(browserWorkspaceSource, /text-\[11px\] font-medium text-\[var\(--color-text\)\][\s\S]{0,80}suggestion\.label/, 'omnibox destination titles use the strongest readable hierarchy')
assert.match(browserWorkspaceSource, /text-\[9px\] text-\[color-mix\(in_srgb,var\(--color-text\)_52%,transparent\)\][\s\S]{0,80}suggestion\.detail/, 'omnibox metadata is visibly subordinate to its destination title')
assert.match(browserWorkspaceSource, /AnchoredNativeOverlay[\s\S]*anchorRef=\{addressContainerRef\}[\s\S]*autoFocus=\{false\}[\s\S]*ref=\{omniboxMenuRef\}[\s\S]*role="listbox"[\s\S]*max-h-72 overflow-y-auto rounded-b-\[13px\] border/, 'omnibox suggestions use the anchored native overlay without stealing focus')
assert.match(browserWorkspaceSource, /role="combobox"[\s\S]*aria-expanded=\{omniboxOpen\}[\s\S]*aria-activedescendant[\s\S]*role="listbox"/, 'the anchored omnibox preserves combobox and listbox accessibility semantics')
assert.match(browserWorkspaceSource, /setOmniboxLoading\(true\)[\s\S]*omniboxOpen \?[\s\S]*Finding suggestions/, 'the omnibox shell stays mounted while local and remote result contents change')
assert.match(browserWorkspaceSource, /querySelector<HTMLInputElement>\('input'\)\?\.blur\(\)[\s\S]*setAddressFocused\(false\)/, 'omnibox submission keeps logical and DOM focus synchronized')
assert.match(browserWorkspaceSource, /shouldFocusAssistantBrowserOmnibox[\s\S]*requestAnimationFrame[\s\S]*querySelector<HTMLInputElement>\('input'\)\?\.focus\(\)/, 'each newly active blank Browser tab focuses the omnibox after it mounts')
assert.match(browserWorkspaceSource, /if \(active\) return[\s\S]*addressFocusedRef\.current = false[\s\S]*querySelector<HTMLInputElement>\('input'\)\?\.blur\(\)/, 'hiding the Browser workspace releases an already-focused omnibox')
assert.match(browserWorkspaceSource, /ensureAssistantBrowserSurfaceTabs\([\s\S]*surfaceRequest\.tabId[\s\S]*surfaceRequest\.secondaryTabId/, 'background surface requests share the same pristine-tab reconciliation as revealed tabs')
assert.match(browserWorkspaceSource, /const current = workspaceStateRef\.current\.tabs\.find[\s\S]*setAddressValue\(browserTabAddress\(current\)\)/, 'tab-switch blur reconciliation reads the current tab rather than a stale closure')
assert.match(browserWorkspaceSource, /Keep filtering the already loaded local history/, 'failed deep history lookups preserve valid local fallback suggestions')
assert.match(browserWorkspaceSource, /suggestion\.kind === 'history'[\s\S]{0,500}suggestion\.detail/, 'history metadata stays inline while search suggestions remain one clean line')
assert.match(browserWorkspaceSource, /getBrowserHistory\(\{ query: historyQuery, limit: 24 \}\)/, 'omnibox queries enough rows to aggregate repeated history paths by site')
assert.match(browserWorkspaceSource, /getBrowserSearchSuggestions\(\{ query: historyQuery \}\)/, 'meaningful omnibox text requests Google suggestions through main')
assert.match(browserWorkspaceSource, /resolveAssistantBrowserOmniboxKeyboardAction\(historyActiveIndex, event\.key, omniboxSuggestions\)/, 'the combined omnibox uses behavior-tested arrow and Enter navigation')
assert.match(browserWorkspaceSource, /aria-activedescendant/, 'omnibox exposes its active history option to assistive technology')
assert.match(browserWorkspaceSource, /clearBrowserHistory\(\)/, 'Browser exposes an explicit history-only clear action')
assert.match(browserWorkspaceSource, /System appearance[\s\S]*Light appearance[\s\S]*Dark appearance[\s\S]*aria-pressed/, 'Browser appearance uses accessible theme icons with persistent selection state')
assert.doesNotMatch(browserWorkspaceSource, /Local Browser profile|Website sign-ins persist on this device/, 'the Browser menu keeps profile maintenance compact instead of explaining it inline')
assert.match(browserWorkspaceSource, /<span>History<\/span>[\s\S]*<span>Downloads<\/span>/, 'the Browser menu opens both full history surfaces')
assert.match(browserWorkspaceSource, /transitionAssistantBrowserProfileReloadHistory/, 'profile-reset reloads use the behavior-tested suppression state machine')
assert.match(browserHistoryStoreSource, /BROWSER_HISTORY_ENTRY_LIMIT = 1_000/, 'Browser history persistence has a hard identity bound')
assert.match(browserHistoryStoreSource, /sanitizeBrowserPersistentUrl/, 'history uses the shared persistent-URL sanitizer')
assert.match(browserUrlSanitizationSource, /url\.username = ''[\s\S]*url\.password = ''[\s\S]*isSensitiveBrowserQueryKey[\s\S]*url\.hash = ''/, 'persistent Browser URLs strip credentials, authentication parameters, and fragments')
assert.match(processDetectorSource, /detectLocalHttpProtocol/, 'TCP listeners must answer HTTP or HTTPS before appearing in Browser')
assert.match(browserNewTabSource, /AssistantBrowserPageIcon faviconUrl=\{null\}/, 'local server rows use the same page identity icon as Browser tabs instead of a server glyph')
assert.doesNotMatch(browserNewTabSource, /divide-y[^"']*border-y/, 'local server groups do not draw a trailing divider after the final row')
assert.doesNotMatch(browserNewTabSource, /attributionText[^\n]*rounded-full/, 'active background credit renders as plain text rather than a pill')
assert.match(browserNewTabSource, /size-9 shrink-0/, 'secondary server actions retain a tap-friendly target')
assert.match(browserNewTabSource, /hourCycle: 'h23'/, 'New Tab time uses an unambiguous local 24-hour clock')
assert.match(browserNewTabSource, /contrast\.clock === 'dark'[\s\S]*contrast\.actions === 'dark'[\s\S]*contrast\.attribution === 'dark'/, 'New Tab selects independent foreground tones for the clock, actions, and attribution regions')
assert.match(browserNewTabContrastSource, /CONTRAST_REGIONS[\s\S]*actions:[\s\S]*attribution:[\s\S]*clock:[\s\S]*getImageData/, 'New Tab contrast reads the visible image pixels at each rendered control region')
assert.match(browserNewTabSource, /aria-label="Choose New Tab background"[\s\S]{0,200}<ImageIcon size=\{14\}/, 'New Tab background and history actions stay directly on the image without visible button chrome')
assert.match(browserNewTabSource, /role="combobox"[\s\S]*aria-activedescendant[\s\S]*role="listbox"[\s\S]*role="option"/, 'New Tab search exposes its keyboard-active suggestions to assistive technology')
assert.doesNotMatch(browserNewTabSource, /rgba\(5, 8, 12|text-white|bg-white|border-white/, 'New Tab controls must not mix fixed dark surfaces or white utilities with adaptive theme text')
assert.match(newTabMarkup, /color-mix\(in srgb, var\(--color-bg\) (?:9\d|100)%, transparent\)/, 'search and local servers render on a near-opaque theme surface')
assert.match(browserNewTabSource, /text-sparkle-text transition-colors[\s\S]{0,500}<span className="truncate text-\[11px\] font-medium">\{suggestion\}/, 'New Tab suggestion values remain high-contrast over the photographic canvas')
assert.doesNotMatch(browserNewTabSource, />Google suggestions<\/div>/, 'New Tab results attach directly without a redundant heading between the field and suggestions')
// Shared-frame geometry, scrolling and intermediate disclosure states are
// exercised by test-browser-new-tab-layout-renderer.mjs in actual Chromium.
assert.match(browserNewTabSource, /opacity: serversExpanded \? 1 : 0[\s\S]*visibility: serversExpanded \? 'visible' : 'hidden'/, 'local server contents fade and move without remaining keyboard-focusable while collapsed')
assert.match(browserNewTabSource, /(?:bottom-0[\s\S]{0,160}flex items-center|flex items-center[\s\S]{0,160}bottom-0)[\s\S]{0,700}(?:justifyContent\s*:\s*['"](?:flex-start|start)['"]|justify-start)[\s\S]{0,700}<span[^>]*>Local servers<\/span>/, 'the local-server rail label stays precisely left-aligned in both states')
assert.match(browserNewTabSource, /height: 14, width: 14[\s\S]*height: 14, lineHeight: '14px'[\s\S]*text-\[10px\] font-medium text-sparkle-text-muted[\s\S]*height: 14, lineHeight: '14px'/, 'the local-server icon, label, and standard-font count share one fixed alignment box')
assert.match(browserNewTabSource, /serversExpanded \? <button[^>]*onClick=\{onRefresh\}/, 'the refresh action only occupies space while the local-server drawer is open')
assert.doesNotMatch(browserNewTabSource, /BrowserServerShortcut|quickServers/, 'expanded local servers use compact rows rather than shortcut icon tiles')
assert.match(browserNewTabSource, /suggestionsOpen = focused[\s\S]*aria-expanded=\{suggestionsOpen\}[\s\S]*Finding suggestions/, 'New Tab keeps one result shell mounted while suggestion contents settle')
assert.match(browserNewTabSource, /event\.currentTarget\.blur\(\)[\s\S]*setFocused\(false\)/, 'New Tab Escape synchronizes DOM and logical focus')
assert.match(browserNewTabSource, /60_000 - \(Date\.now\(\) % 60_000\) \+ 25/, 'clock updates align to the actual system minute boundary')
assert.match(browserNewTabSource, /visibilitychange/, 'clock resynchronizes after the window resumes')
assert.match(browserHistoryPanelSource, /size-9 shrink-0/, 'secondary history actions retain a tap-friendly target')
assert.match(browserHistoryPanelSource, /aria-label="Search Browser history"/, 'history search has an explicit accessible name')
assert.match(browserHistoryPanelSource, /text-\[11px\] font-medium text-\[var\(--color-text\)\][^>]*>\{cluster\.title\}/, 'history destination titles use full primary contrast')
assert.match(browserHistoryPanelSource, /text-\[9px\] text-\[color-mix\(in_srgb,var\(--color-text\)_54%,transparent\)\]/, 'history visit metadata remains subordinate')
assert.match(browserHistoryPanelSource, /translate-x-\[calc\(100%\+16px\)\]/, 'history exits horizontally to the right')
assert.doesNotMatch(browserHistoryPanelSource, /backdrop-blur|transition-opacity/, 'history motion never exposes a tinted empty overlay')
assert.match(browserHistoryPanelSource, /panelRef\.current\?\.querySelector<HTMLInputElement>\('input'\)\?\.focus\(\)/, 'history establishes initial focus')
assert.match(browserHistoryPanelSource, /event\.key !== 'Tab'/, 'history traps keyboard focus')
assert.match(browserHistoryPanelSource, /previousFocusRef\.current\?\.focus\(\)/, 'history restores the invoking control on close')
assert.match(browserHistoryPanelSource, /assistant-browser-history-panel-in_180ms/, 'history enters with the short horizontal keyframe')
assert.match(browserHistoryPanelSource, /setEmptyVisible\(true\), 220/, 'empty history search results wait before appearing')
assert.match(browserHistoryImportSource, /WIZARD_STEPS = \['Sources', 'Range', 'Review', 'Done'\]/, 'history import is one coherent four-step wizard')
assert.match(browserHistoryImportStepsSource, /AssistantBrowserBrandIcon/, 'detected profiles render real browser identities')
assert.match(browserHistoryImportStepsSource, /profile\.accountHint/, 'available profile email hints help distinguish profiles')
assert.match(browserHistoryImportSource, /dialogRef\.current\?\.focus\(\)/, 'the import modal establishes initial focus')
assert.match(browserHistoryImportSource, /event\.key !== 'Tab'/, 'the import modal traps keyboard focus')
assert.match(browserHistoryImportSource, /previouslyFocused[\s\S]*previouslyFocused\?\.focus\(\)/, 'the import modal restores the invoking control on close')
assert.match(browserHistoryImportStepsSource, /role="radiogroup"[\s\S]*role="radio"[\s\S]*aria-checked/, 'custom range choices expose radio semantics')
assert.match(browserHistoryImportStepsSource, /data-scope="all"[\s\S]*tabIndex=\{scope === 'all' \? 0 : -1\}/, 'custom range radios use roving keyboard focus')
assert.doesNotMatch(`${browserHistoryImportSource}${browserHistoryImportStepsSource}`, /type="date"/, 'history import never falls back to the native date input')
assert.match(assistantDatePickerSource, /createPortal/, 'the date picker renders outside the scrolling wizard body')
assert.match(assistantDatePickerSource, /fixed inset-0 z-\[1000\]/, 'the date picker owns a dedicated modal layer')
assert.match(assistantDatePickerSource, /grid grid-cols-7/, 'the in-app date picker owns its calendar grid')
assert.match(assistantDatePickerSource, /aria-pressed=\{formatDateValue\(date\) === value\}/, 'the selected calendar day is programmatically exposed')
assert.match(assistantCheckboxSource, /role="checkbox"/, 'profile selection uses the app-owned checkbox control')
assert.match(processDetectorSource, /attachedToProject/, 'the main source separates current-project and other local servers')
assert.match(processDetectorSource, /getPortListeners\(\)/, 'running-server discovery considers real listeners beyond a fixed port list')
assert.match(processDetectorSource, /\.slice\(0, 128\)/, 'machine-wide listener probing has a hard candidate bound')
assert.doesNotMatch(newTabMarkup, /CommandLine|my_coding_play/, 'New tab never exposes private process commands or paths')
assert.match(handlersSource, /devscope:getRunningLocalServers/, 'running-server discovery is registered in main')
assert.match(preloadSource, /devscope:getRunningLocalServers/, 'running-server discovery crosses preload')
assert.match(apiSource, /getRunningLocalServers/, 'running-server discovery is typed')
assert.match(handlersSource, /devscope:browserPreview:getHistory/, 'Browser history reads are registered in main')
assert.match(handlersSource, /devscope:browserPreview:recordHistory/, 'completed navigation records history through main')
assert.match(handlersSource, /devscope:browserPreview:getSearchSuggestions/, 'Google suggestions are fetched through bounded main IPC')
assert.match(handlersSource, /devscope:browserPreview:scanExternalHistory/, 'external browser profile discovery is main-owned')
assert.match(handlersSource, /devscope:browserPreview:importExternalHistory/, 'confirmed external history import is main-owned')
assert.match(preloadSource, /devscope:browserPreview:clearHistory/, 'history clearing crosses preload')
assert.match(preloadSource, /devscope:browserPreview:scanExternalHistory/, 'external history scan crosses the typed preload boundary')
assert.match(apiSource, /DevScopeBrowserHistoryEntry/, 'Browser history has a shared typed contract')
const profileClearSource = browserPreviewHandlersSource.split('handleClearBrowserPreviewData')[1] || ''
const suppressionIndex = profileClearSource.indexOf('suppressRecordingFor(30_000)')
const storageClearIndex = profileClearSource.indexOf('clearStorageData()')
const cookieFlushIndex = profileClearSource.indexOf('cookies.flushStore()')
const historyClearIndex = profileClearSource.indexOf('historyStore.clear()')
assert.ok(suppressionIndex >= 0 && storageClearIndex >= 0 && suppressionIndex < storageClearIndex, 'main suppresses racing history records before profile clearing starts')
assert.ok(cookieFlushIndex >= 0 && historyClearIndex > cookieFlushIndex, 'main clears history after Chromium profile work so earlier racing records cannot survive')

console.log('Assistant Inspector tabs and Browser New tab: ok')
