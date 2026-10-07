import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    inspectMarkdownLinkAvailability,
    resetMarkdownLinkAvailabilityCache,
    resolveMarkdownLinkSearchRoot
} from '../src/renderer/src/components/ui/markdown/linkAvailability'
import {
    navigateMarkdownLink,
    normalizeMarkdownHref,
    resolveMarkdownLinkTarget
} from '../src/renderer/src/components/ui/markdown/linkNavigation'
import { looksLikeMarkdownFileReference, resolveMarkdownPackageReference } from '../src/renderer/src/components/ui/markdown/fileReferences'

type PathInfoResult = {
    success: boolean
    exists?: boolean
    path?: string
    name?: string
    type?: 'file' | 'directory' | null
    error?: string
}

let pathInfoCalls = 0
let pathInfoResult: PathInfoResult = {
    success: true,
    exists: true,
    path: 'C:\\workspace\\docs\\guide.md',
    name: 'guide.md',
    type: 'file'
}

let existingProjectPath = ''
let projectTree: Array<Record<string, unknown>> = []
let indexedEntries: Array<Record<string, unknown>> = []
let indexedAncestors: Array<Record<string, unknown>> = []
let indexedSearchCalls = 0
Object.assign(globalThis, {
    window: {
        devscope: {
            getPathInfo: async (targetPath: string) => {
                pathInfoCalls += 1
                if (existingProjectPath && targetPath.toLowerCase() === existingProjectPath.toLowerCase()) {
                    const name = targetPath.replace(/\\/g, '/').split('/').pop() || targetPath
                    return { success: true, exists: true, path: targetPath, name, type: 'file' }
                }
                return pathInfoResult
            },
            getFileTree: async () => ({ success: true, tree: projectTree }),
            searchIndexedPaths: async () => {
                indexedSearchCalls += 1
                return {
                    success: true,
                    entries: indexedEntries,
                    ancestors: indexedAncestors,
                    totalMatched: indexedEntries.length
                }
            },
            openInExplorer: async () => ({ success: true })
        }
    }
})

assert.equal(resolveMarkdownPackageReference('@pierre/trees')?.packageName, '@pierre/trees')
assert.equal(resolveMarkdownPackageReference('@pierre/trees/react')?.href, 'https://www.npmjs.com/package/@pierre/trees')
assert.equal(looksLikeMarkdownFileReference('@pierre/trees'), false, 'scoped packages are not local files')
assert.equal(looksLikeMarkdownFileReference('@pierre/trees/react'), false, 'package export paths are not local files')
assert.equal(looksLikeMarkdownFileReference('.ico'), false, 'an extension-only token cannot become a project-root file preview')
assert.equal(looksLikeMarkdownFileReference('.png'), false, 'image extension prose remains ordinary inline code')
assert.equal(looksLikeMarkdownFileReference('.env'), true, 'recognized standalone dotfiles remain navigable')
assert.equal(looksLikeMarkdownFileReference('.env.local'), true, 'environment variants remain navigable')
for (const conceptualPair of ['dev/prod', 'light/dark', 'foreground/background', 'cyan/blue', 'white/neutral']) {
    assert.equal(looksLikeMarkdownFileReference(conceptualPair), false, `${conceptualPair} is a conceptual pair, not an implicit folder path`)
}
assert.equal(looksLikeMarkdownFileReference('src/components'), true, 'known project-root directory paths remain navigable')
assert.equal(looksLikeMarkdownFileReference('desktop/resources/icon.ico'), true, 'real nested file paths remain navigable')
assert.equal(looksLikeMarkdownFileReference('.zyra/memory'), true, 'explicit dot-directory paths remain navigable')
for (const proseToken of ['CLI/runtime:', 'private/person-specific', 'commands/<name>.md', '<project>/.zyra/commands/<name>.md']) {
    assert.equal(looksLikeMarkdownFileReference(proseToken), false, `${proseToken} is documentation prose rather than an automatic filesystem lookup`)
}
assert.equal(
    resolveMarkdownLinkSearchRoot('C:\\Users\\developer\\zyra\\AGENTS.md', 'C:\\Users\\developer'),
    'C:\\Users\\developer\\zyra',
    'a stale home-level utility root narrows to the previewed file directory'
)
assert.equal(
    resolveMarkdownLinkSearchRoot('C:\\workspace\\zyra\\docs\\guide.md', 'C:\\workspace\\zyra'),
    'C:\\workspace\\zyra',
    'an owning project root remains authoritative'
)
assert.equal(normalizeMarkdownHref('github.com/openai/codex'), 'https://github.com/openai/codex')
assert.equal(normalizeMarkdownHref('localhost:5173/docs'), 'http://localhost:5173/docs')
assert.equal(
    resolveMarkdownLinkTarget('github.com/openai/codex', 'C:\\workspace\\README.md'),
    null,
    'scheme-less website links must not be classified as project files'
)

assert.equal(
    resolveMarkdownLinkTarget('./docs/guide.md', 'C:\\workspace\\README.md')?.path,
    'C:\\workspace\\docs\\guide.md',
    'relative Markdown links resolve from the rendered document'
)

resetMarkdownLinkAvailabilityCache()
const available = await inspectMarkdownLinkAvailability('./docs/guide.md', 'C:\\workspace\\README.md')
assert.equal(available?.availability, 'available')
assert.equal(available?.path, 'C:\\workspace\\docs\\guide.md')
assert.equal(available?.targetKind, 'file', 'available links retain their resolved filesystem kind')
await inspectMarkdownLinkAvailability('./docs/guide.md', 'C:\\workspace\\README.md')
assert.equal(pathInfoCalls, 1, 'availability checks are shared across Markdown surfaces')

resetMarkdownLinkAvailabilityCache()
pathInfoResult = { success: true, exists: false, path: 'C:\\workspace\\missing.md', name: 'missing.md', type: null }
const missing = await inspectMarkdownLinkAvailability('./missing.md', 'C:\\workspace\\README.md')
assert.equal(missing?.availability, 'missing', 'confirmed missing targets are disabled before navigation')

resetMarkdownLinkAvailabilityCache()
pathInfoResult = { success: false, error: 'temporarily unavailable' }
const unknown = await inspectMarkdownLinkAvailability('./maybe.md', 'C:\\workspace\\README.md')
assert.equal(unknown?.availability, 'unknown', 'failed checks remain unverified rather than asserting existence')

resetMarkdownLinkAvailabilityCache()
indexedSearchCalls = 0
pathInfoResult = { success: true, exists: false, path: 'C:\\workspace\\missing.md', name: 'missing.md', type: null }
const directOnly = await inspectMarkdownLinkAvailability(
    './missing.md',
    'C:\\workspace\\README.md',
    'C:\\workspace',
    { allowProjectSearch: false }
)
assert.equal(directOnly?.availability, 'missing', 'a missing direct path is marked missing without starting project indexing')
assert.equal(indexedSearchCalls, 0, 'background automatic references cannot start full project indexing')

resetMarkdownLinkAvailabilityCache()
existingProjectPath = 'C:\\workspace\\desktop\\src\\renderer\\src\\pages\\assistant\\AssistantVirtualTimeline.tsx'
projectTree = [{
    name: 'AssistantVirtualTimeline.tsx',
    path: existingProjectPath,
    type: 'file',
    isHidden: false
}]
indexedEntries = [{
    name: 'AssistantVirtualTimeline.tsx',
    path: existingProjectPath,
    rootPath: 'C:\\workspace',
    parentPath: 'C:\\workspace\\desktop\\src\\renderer\\src\\pages\\assistant',
    relativePath: 'desktop/src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx',
    type: 'file',
    extension: 'tsx',
    isHidden: false,
    isProject: false,
    markers: [],
    frameworks: [],
    depth: 7
}]
indexedAncestors = [
    ['desktop', 'C:\\workspace\\desktop', null, 'desktop', 1],
    ['src', 'C:\\workspace\\desktop\\src', 'C:\\workspace\\desktop', 'desktop/src', 2],
    ['renderer', 'C:\\workspace\\desktop\\src\\renderer', 'C:\\workspace\\desktop\\src', 'desktop/src/renderer', 3],
    ['src', 'C:\\workspace\\desktop\\src\\renderer\\src', 'C:\\workspace\\desktop\\src\\renderer', 'desktop/src/renderer/src', 4],
    ['pages', 'C:\\workspace\\desktop\\src\\renderer\\src\\pages', 'C:\\workspace\\desktop\\src\\renderer\\src', 'desktop/src/renderer/src/pages', 5],
    ['assistant', 'C:\\workspace\\desktop\\src\\renderer\\src\\pages\\assistant', 'C:\\workspace\\desktop\\src\\renderer\\src\\pages', 'desktop/src/renderer/src/pages/assistant', 6]
].map(([name, path, parentPath, relativePath, depth]) => ({
    name,
    path,
    rootPath: 'C:\\workspace',
    parentPath,
    relativePath,
    type: 'directory',
    extension: '',
    isHidden: false,
    isProject: false,
    markers: [],
    frameworks: [],
    depth
}))
pathInfoResult = { success: true, exists: false, path: 'C:\\workspace\\AssistantVirtualTimeline.tsx', name: 'AssistantVirtualTimeline.tsx', type: null }
const recoveredBareFile = await inspectMarkdownLinkAvailability(
    'AssistantVirtualTimeline.tsx',
    'C:\\workspace\\__assistant__.md',
    'C:\\workspace'
)
assert.equal(recoveredBareFile?.availability, 'available', 'bare filenames fall back to exact project-index resolution')
assert.equal(recoveredBareFile?.resolvedBy, 'project-search')
assert.equal(recoveredBareFile?.path, existingProjectPath)

resetMarkdownLinkAvailabilityCache()
const recoveredShorthandPath = await inspectMarkdownLinkAvailability(
    'assistant/AssistantVirtualTimeline.tsx',
    'C:\\workspace\\__assistant__.md',
    'C:\\workspace'
)
assert.equal(recoveredShorthandPath?.availability, 'available', 'unique trailing project paths recover shortened agent links')
assert.equal(recoveredShorthandPath?.resolvedBy, 'project-search')
assert.equal(recoveredShorthandPath?.path, existingProjectPath)

pathInfoResult = { success: true, exists: true, path: 'C:\\workspace\\src', name: 'src', type: 'directory' }
resetMarkdownLinkAvailabilityCache()
const availableDirectory = await inspectMarkdownLinkAvailability('./src', 'C:\\workspace\\README.md')
assert.equal(availableDirectory?.targetKind, 'directory', 'folder links expose directory semantics to their rendered icon')
let directoryPreview: { file: { name: string; path: string }; ext: string; options?: Record<string, unknown> } | null = null
let directoryRouteUsed = false
const openedDirectory = await navigateMarkdownLink({
    href: './src',
    filePath: 'C:\\workspace\\README.md',
    navigate: () => { directoryRouteUsed = true },
    openPreview: async (file, ext, options) => {
        directoryPreview = { file, ext, options }
    }
})
assert.equal(openedDirectory, true)
assert.equal(directoryRouteUsed, false, 'directory links stay in the preview workflow when a preview owner exists')
assert.equal(directoryPreview?.file.path, 'C:\\workspace\\src')
assert.equal(directoryPreview?.options?.targetKind, 'directory')
assert.equal(directoryPreview?.options?.openNavigator, true, 'directory links request the normal preview navigator')

pathInfoResult = { success: true, exists: false, path: 'C:\\workspace\\missing.md', name: 'missing.md', type: null }
let routed = false
const openedMissing = await navigateMarkdownLink({
    href: './missing.md',
    filePath: 'C:\\workspace\\README.md',
    navigate: () => { routed = true }
})
assert.equal(openedMissing, false)
assert.equal(routed, false, 'missing local links never fall through to app routing')

const interactionSource = readFileSync(new URL('../src/renderer/src/components/ui/markdown/MarkdownInteractionLayer.tsx', import.meta.url), 'utf8')
const linkAvailabilitySource = readFileSync(new URL('../src/renderer/src/components/ui/markdown/linkAvailability.ts', import.meta.url), 'utf8')
const rendererSource = readFileSync(new URL('../src/renderer/src/components/ui/MarkdownRenderer.tsx', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
const previewHandlerSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewModalInteractions.tsx', import.meta.url), 'utf8')
const readmeSource = readFileSync(new URL('../src/renderer/src/pages/project-details/ProjectDetailsReadmeTab.tsx', import.meta.url), 'utf8')
const assistantSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const assistantToastSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPageHelpers.tsx', import.meta.url), 'utf8')
const editMenuSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewHeaderEditMenu.tsx', import.meta.url), 'utf8')
const fileIndexServiceSource = readFileSync(new URL('../src/main/services/file-index-service.ts', import.meta.url), 'utf8')
assert.equal(interactionSource.includes('if (!root || !onInternalLinkClick) return'), false, 'all Markdown surfaces intercept local links')
assert.equal(interactionSource.includes('event.preventDefault()'), true, 'local links cannot refresh or replace the app route')
assert.equal(interactionSource.includes("await navigateMarkdownLink({ href: openTarget, filePath })"), true, 'surfaces without a custom preview opener retain safe fallback behavior')
assert.equal(interactionSource.includes('Broken link — file not found:'), true, 'failed clicks provide explicit feedback')
assert.equal(interactionSource.includes('target.dataset.markdownTargetKind = targetKind'), true, 'resolved directory semantics reach the inline link element')
assert.equal(interactionSource.includes("onLinkNotice?.('This section is already in view.', 'info')"), true, 'self-heading links use the owning surface toast')
assert.equal(interactionSource.includes('fixed bottom-8 left-1/2'), false, 'Markdown does not create a private toast surface')
assert.equal(interactionSource.includes("target.closest('h1,h2,h3,h4,h5,h6')"), true, 'only the heading control pointing to itself uses the already-visible toast')
assert.equal(interactionSource.includes('button[data-markdown-heading-target]'), true, 'heading controls are intercepted without relying on anchor navigation')
assert.equal(rendererSource.includes("contentKey={renderReady ? content : ''}"), true, 'link availability starts when rendered Markdown is mounted')
assert.match(interactionSource, /allowProjectSearch: !target\.dataset\.devscopeFileReference/, 'automatic prose references use direct checks without starting a project-wide index')
assert.match(linkAvailabilitySource, /const searchMode = options\.allowProjectSearch === false \? 'direct' : 'project'/, 'direct background results cannot suppress a later user-requested project search')
assert.match(fileIndexServiceSource, /scopeIndexPromises = new Map<string, Promise<void>>\(\)[\s\S]*const existing = this\.scopeIndexPromises\.get\(scopeKey\)[\s\S]*if \(existing\) return existing/, 'concurrent searches share one first-time index operation per normalized root')
assert.match(fileIndexServiceSource, /let fileIndexService: FileIndexService \| null = null[\s\S]*fileIndexService \?\?= new FileIndexService\(\)/, 'the file index opens only after Zyra applies its runtime-specific user-data identity')
assert.match(fileIndexServiceSource, /processedEntries - lastYieldAt >= FILE_INDEX_YIELD_INTERVAL[\s\S]*await yieldToEventLoop\(\)/, 'directory indexing yields by elapsed batch size instead of an unreliable exact modulus')
assert.doesNotMatch(fileIndexServiceSource, /readSearchCatalog/, 'a first indexed search cannot materialize the complete project catalog on the main thread')
assert.match(fileIndexServiceSource, /name_lower LIKE \? ESCAPE[\s\S]*relative_path_lower LIKE \? ESCAPE/, 'indexed search narrows candidates inside SQLite')
assert.match(fileIndexServiceSource, /const cachedResult = this\.searchResultCache\.get\(cacheKey\)[\s\S]*return cachedResult/, 'duplicate indexed searches reuse a bounded result')
assert.match(fileIndexServiceSource, /FILE_INDEX_REVALIDATE_MS = 30 \* 60 \* 1000/, 'full fallback revalidation cannot rescan an unchanged project every five minutes')
assert.equal(stylesSource.includes('data-markdown-link-state="missing"'), true)
assert.equal(stylesSource.includes('opacity: 0.82'), true, 'known broken links remain pale without becoming hard to read')
assert.equal(stylesSource.includes('.markdown-inline-file-label'), true, 'file path labels own a single-line truncation boundary')
assert.equal(stylesSource.includes('[data-markdown-target-kind="directory"] .markdown-inline-target-directory-icon'), true, 'folder links replace the generic file icon after preflight')
assert.equal(stylesSource.includes('white-space: nowrap'), true, 'long path tags never wrap onto a second line')
assert.equal(stylesSource.includes('content: "missing file"'), false, 'missing links do not add visual warning pills')
assert.equal(previewHandlerSource.includes('return navigateMarkdownLink({'), true, 'preview link failures reach the shared interaction layer')
assert.equal(readmeSource.includes('return navigateMarkdownLink({'), true, 'README link failures reach the shared interaction layer')
assert.equal(assistantSource.includes('return openAssistantTarget(href, false, false)'), true, 'assistant link failures reach the shared interaction layer without duplicate toasts')
assert.equal(assistantSource.includes('onShowToast={showToast}'), true, 'assistant Markdown and previews use the existing bottom-right toast owner')
assert.equal(assistantToastSource.includes('w-[min(24rem,calc(100vw-2rem))]'), true, 'the existing toast keeps a responsive fixed width')
assert.equal(assistantToastSource.includes('[overflow-wrap:anywhere]'), true, 'long local paths wrap instead of overflowing the toast')
assert.equal(editMenuSource.includes('Discard unsaved edits'), true, 'the edit menu names the destructive local action clearly')

console.log('Markdown link availability contract: ok')
