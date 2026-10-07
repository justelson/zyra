import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePreviewResourceNavigatorView } from '../src/renderer/src/pages/assistant/AssistantPreviewResourceNavigator'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const loadingSource = read('../src/renderer/src/components/ui/file-preview/PreviewLoadingSkeleton.tsx')
const syntaxSource = read('../src/renderer/src/components/ui/file-preview/SyntaxPreview.tsx')
const textSource = read('../src/renderer/src/components/ui/file-preview/TextPreviewContent.tsx')
const officeSource = read('../src/renderer/src/components/ui/file-preview/OfficePreviewContent.tsx')
const modalSource = read('../src/renderer/src/components/ui/FilePreviewModal.tsx')
const layoutSource = read('../src/renderer/src/components/ui/file-preview/PreviewModalLayout.tsx')
const utilityHostSource = read('../src/renderer/src/pages/assistant/utility/AssistantUtilityWorkspaceHost.tsx')
const navigatorSource = read('../src/renderer/src/pages/assistant/AssistantPreviewResourceNavigator.tsx')

assert.equal(resolvePreviewResourceNavigatorView(259, 'cards'), 'table', 'narrow resource navigation falls back to the table')
assert.equal(resolvePreviewResourceNavigatorView(260, 'cards'), 'cards', 'two-column cards remain available at their minimum usable width')
assert.equal(resolvePreviewResourceNavigatorView(420, 'table'), 'table', 'the user can keep table view at wide widths')

assert.match(loadingSource, /label = 'Loading file\.\.\.'/u, 'file reads use concise loading copy')
assert.equal(loadingSource.includes('CONTENT_LINE_WIDTHS'), false, 'file loading no longer draws editor-like vertical skeleton rails')
assert.match(loadingSource, /aria-live="polite"/u, 'loading copy remains accessible')
assert.match(syntaxSource, /CodePreviewPlaceholder[^]*content=\{safeContent\}/u, 'editor preparation keeps the real file content readable')
assert.doesNotMatch(textSource, /PreviewRendererFallback|PreviewContentSkeleton/u, 'rich text previews have no file-content loading screen')
assert.match(officeSource, />Rendering file\.\.\.<\/span>/u, 'office rendering uses the same concise phase copy')

assert.match(modalSource, /hasNavigationSidebarOverride = navigationSidebar != null/u, 'a caller-owned navigator participates in preview chrome state')
assert.match(layoutSource, /navigationSidebarOverride \?\? fileNavigationSidebar/u, 'chat resources replace the file tree without changing other preview callers')
assert.match(utilityHostSource, /tab\.workspace === 'resources'[\s\S]*<AssistantPreviewResourceNavigator/u, 'only Resources previews install the chat-resource navigator')
assert.match(utilityHostSource, /navigationSidebar=\{previewResourceNavigator\}/u, 'the Resources preview passes its navigator through the shared modal')

assert.match(navigatorSource, /buildAssistantResourceIndex\(\{ turns, projectPath \}\)/u, 'the navigator derives every item from the current chat resource index')
assert.match(navigatorSource, /grid-cols-2/u, 'card mode keeps two resources per row')
assert.match(navigatorSource, /aria-label="Show resource cards"/u, 'the card toggle is operable and named')
assert.match(navigatorSource, /aria-label="Show resources as a table"/u, 'the table toggle is operable and named')
assert.match(navigatorSource, /usePreviewVirtualWindow/u, 'large chat resource collections remain virtualized')
assert.match(navigatorSource, /resolveClipboardAttachment/u, 'clipboard images remain navigable')
assert.match(navigatorSource, /AssistantAttachmentPreviewModal/u, 'inline-only resources retain a real preview path')
assert.match(navigatorSource, /explicitSelection\.activeFilePath === normalizedActiveFilePath/u, 'explicit URL and inline selections stay scoped to the file that was active when selected')
assert.match(navigatorSource, /currentResourceId = explicitSelectionIsCurrent[\s\S]*activeFileResource\?\.id \?\? null/u, 'one synchronous current resource owns active styling')
assert.match(navigatorSource, /current\.activeFilePath !== normalizedActiveFilePath\) return null/u, 'active-file changes clear stale explicit selection')
assert.equal((navigatorSource.match(/const active = resource\.id === currentResourceId/g) || []).length, 2, 'card and table views expose one current resource')
assert.match(navigatorSource, /setInlinePreview\(null\); setExplicitSelection\(null\)/u, 'closing an inline preview restores current-resource ownership to the active file')
assert.match(navigatorSource, /resolveClipboardAttachment[\s\S]*setExplicitSelection\(\{ id: resource\.id, activeFilePath: normalizedPath\(result\.path\) \}\)/u, 'resolved clipboard previews retain current-resource ownership at their real file path')

console.log('Assistant preview resource navigation tests passed.')
