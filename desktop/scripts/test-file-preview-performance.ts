import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    readPreviewContentCache,
    writePreviewContentCache,
    type PreviewContentSnapshot
} from '../src/renderer/src/components/ui/file-preview/preview-content-cache'
import { scanPreviewInspectorStats } from '../src/renderer/src/components/ui/file-preview/useFilePreviewModalAnalysis'
import { parseDelimitedContent, parseDelimitedContentChunked, resolvePreviewType } from '../src/renderer/src/components/ui/file-preview/utils'
import { getOrCreatePreviewFolderTreeRequest } from '../src/renderer/src/lib/projectViewCache'
import { buildMarkdownPreviewSections, computeMarkdownVirtualRange, markdownPreviewSectionRenderContent, markdownPreviewSectionSource, splitMarkdownPreviewSections } from '../src/renderer/src/components/ui/file-preview/FileMarkdownPreview'
import {
    markdownDomHeight,
    markdownEasedScrollTop,
    markdownLogicalViewportStart,
    markdownPhysicalViewportStart,
    markdownScrollScale,
    markdownShouldAdjustScrollPosition,
    markdownWheelScrollTop,
    MAX_MARKDOWN_DOM_HEIGHT,
    MarkdownPreviewHeightIndex
} from '../src/renderer/src/components/ui/file-preview/markdownPreviewHeightIndex'
import {
    buildVisiblePreviewTreeModel,
    computePreviewVirtualRange,
    previewDirectoryCanExpand,
    previewTreeAnchoredScrollTop,
    previewTreeScrollTopForIndex,
    previewVirtualRangeCoversViewport
} from '../src/renderer/src/components/ui/file-preview/previewVirtualTreeModel'

function snapshot(content: string): PreviewContentSnapshot {
    return {
        content,
        truncated: false,
        size: content.length,
        previewBytes: content.length,
        modifiedAt: 1
    }
}

const cache = new Map<string, PreviewContentSnapshot>()
writePreviewContentCache(cache, 'C:/project/first.md', snapshot('first'))
writePreviewContentCache(cache, 'C:/project/second.md', snapshot('second'))
assert.equal(readPreviewContentCache(cache, 'c:\\project\\first.md')?.content, 'first', 'preview cache keys are path-normalized')
const caseSensitiveCache = new Map<string, PreviewContentSnapshot>()
writePreviewContentCache(caseSensitiveCache, '/project/App.tsx', snapshot('upper'))
writePreviewContentCache(caseSensitiveCache, '/project/app.tsx', snapshot('lower'))
assert.equal(caseSensitiveCache.size, 2, 'POSIX case-distinct files retain separate preview cache entries')
assert.equal([...cache.keys()].at(-1), 'c:/project/first.md', 'cache reads refresh least-recently-used order')
for (let index = 0; index < 12; index += 1) {
    writePreviewContentCache(cache, `C:/project/${index}.txt`, snapshot(String(index)))
}
assert.equal(cache.size <= 8, true, 'preview content cache remains bounded')
writePreviewContentCache(cache, 'C:/project/large.md', snapshot('x'.repeat(8 * 1024 * 1024)))
assert.equal(readPreviewContentCache(cache, 'C:/project/large.md')?.content.length, 8 * 1024 * 1024, 'the maximum rendered Markdown preview remains warm for instant reopen')
writePreviewContentCache(cache, 'C:/project/too-large.txt', snapshot('x'.repeat((8 * 1024 * 1024) + 1)))
assert.equal(readPreviewContentCache(cache, 'C:/project/too-large.txt'), null, 'content beyond the preview ceiling does not stay resident')

assert.deepEqual(resolvePreviewType('LICENSE', ''), { type: 'text', needsContent: true }, 'extensionless license files open in the text preview')
assert.deepEqual(resolvePreviewType('LICENSE-MIT', ''), { type: 'text', needsContent: true })
assert.deepEqual(resolvePreviewType('COPYING', ''), { type: 'text', needsContent: true })
assert.deepEqual(resolvePreviewType('README', ''), { type: 'md', needsContent: true }, 'extensionless README files retain rendered Markdown')
assert.deepEqual(resolvePreviewType('manual.pdf', 'pdf'), { type: 'pdf', needsContent: false }, 'PDFs open in the embedded document viewer')
assert.deepEqual(resolvePreviewType('.env.local', 'local'), { type: 'text', needsContent: true })
assert.deepEqual(resolvePreviewType('yarn.lock', 'lock'), { type: 'text', needsContent: true })
assert.deepEqual(resolvePreviewType('changes.patch', 'patch'), { type: 'text', needsContent: true })
assert.deepEqual(resolvePreviewType('main.tf', 'tf'), { type: 'code', language: 'plaintext', needsContent: true })
assert.deepEqual(resolvePreviewType('events.jsonl', 'jsonl'), { type: 'code', language: 'json', needsContent: true }, 'JSON Lines opens as line-oriented JSON instead of failing whole-document formatting')
assert.deepEqual(resolvePreviewType('events.ndjson', 'ndjson'), { type: 'code', language: 'json', needsContent: true }, 'newline-delimited JSON uses the same syntax-aware preview')
assert.deepEqual(resolvePreviewType('Gemfile', ''), { type: 'code', language: 'ruby', needsContent: true })

const csvFixture = 'name,description\r\nalpha,"one, two"\r\nbeta,"escaped ""quote"""\r\n'
assert.deepEqual(
    await parseDelimitedContentChunked(csvFixture, ',', () => false, 8),
    parseDelimitedContent(csvFixture, ','),
    'chunked CSV parsing preserves quoted fields and CRLF behavior while yielding between chunks'
)

let folderRequestCount = 0
const loadFolder = () => getOrCreatePreviewFolderTreeRequest('C:/project', 'C:/project/src', async () => {
    folderRequestCount += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return [{ name: 'index.ts', path: 'C:/project/src/index.ts', type: 'file', isHidden: false }]
})
const [firstFolderTree, secondFolderTree] = await Promise.all([loadFolder(), loadFolder()])
assert.equal(folderRequestCount, 1, 'concurrent Inspector and preview tree loads share one filesystem request')
assert.equal(firstFolderTree, secondFolderTree)

const repositoryReadme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
const readmeSections = splitMarkdownPreviewSections(repositoryReadme)
assert.equal(readmeSections.join(''), repositoryReadme, 'progressive Markdown preserves the exact source')
assert.equal(readmeSections.length > 1, true, 'the repository README no longer compiles in one renderer task')
assert.equal(Math.max(...readmeSections.map((section) => section.length)) < 8_000, true, 'README compilation work stays in bounded semantic sections')
const fencedFixture = `# Before\n\n${'a'.repeat(2_500)}\n\n\`\`\`md\n# remains inside the fence\n\n${'b'.repeat(2_500)}\n\`\`\`\n\n# After\n`
assert.equal(splitMarkdownPreviewSections(fencedFixture).join(''), fencedFixture, 'Markdown chunking never alters fenced source')
const longListFixture = `# API\n\n${'- A very long operation description with inline `code` and stable rendering semantics.\n'.repeat(2_000)}`
const longListSections = buildMarkdownPreviewSections(longListFixture)
assert.equal(longListSections.map((section) => markdownPreviewSectionSource(longListFixture, section)).join(''), longListFixture, 'hard section bounds preserve every source byte')
assert.equal(Math.max(...longListSections.map((section) => section.end - section.start)) < 300_000, true, 'pathological lists split only at complete item boundaries after a large semantic safety threshold')
const giantFenceFixture = `# Generated output\n\n\`\`\`ts\n${'export const value = 1\n'.repeat(2_000)}\`\`\`\n`
const giantFenceSections = buildMarkdownPreviewSections(giantFenceFixture)
assert.equal(giantFenceSections.map((section) => markdownPreviewSectionSource(giantFenceFixture, section)).join(''), giantFenceFixture, 'virtual code sections preserve the exact source')
assert.equal(Math.max(...giantFenceSections.map((section) => section.end - section.start)) < 8_000, true, 'one giant fence cannot defeat section virtualization')
assert.equal(giantFenceSections.filter((section) => section.kind === 'fence').every((section) => markdownPreviewSectionRenderContent(giantFenceFixture, section).includes('```')), true, 'continued code sections remain fully rendered fenced blocks')
const longMarkdownFixture = `${'# Long document\n\n'}${'## Section\n\nA formatted paragraph with **bold**, [links](guide.md), and `code`.\n\n'.repeat(28_000)}`
const longMarkdownSections = buildMarkdownPreviewSections(longMarkdownFixture)
const longMarkdownOffsets = [0]
for (const section of longMarkdownSections) longMarkdownOffsets.push((longMarkdownOffsets.at(-1) || 0) + section.estimatedHeight)
const initialMarkdownRange = computeMarkdownVirtualRange(longMarkdownOffsets, 0, 900)
assert.equal(longMarkdownSections.length > 500, true, 'multi-megabyte Markdown is split into bounded render work')
assert.equal(initialMarkdownRange.end - initialMarkdownRange.start <= 3, true, 'initial Markdown paint mounts only the visible viewport and overscan')
const deepMarkdownRange = computeMarkdownVirtualRange(longMarkdownOffsets, longMarkdownOffsets.at(-1)! / 2, (longMarkdownOffsets.at(-1)! / 2) + 900)
assert.equal(deepMarkdownRange.end - deepMarkdownRange.start <= 5, true, 'deep scrolling keeps mounted Markdown sections bounded')

const tableHeader = '| Name | Value |\n| --- | ---: |\n'
const largeTableFixture = `# Records\n\n${tableHeader}${Array.from({ length: 20_000 }, (_, index) => `| Row ${index} | ${index} |\n`).join('')}\nAfter table.\n`
const largeTableSections = buildMarkdownPreviewSections(largeTableFixture)
assert.equal(largeTableSections.map((section) => markdownPreviewSectionSource(largeTableFixture, section)).join(''), largeTableFixture, 'semantic table sections preserve every source byte')
const continuedTableSections = largeTableSections.filter((section) => section.kind === 'table' && section.renderPrefix)
assert.equal(continuedTableSections.length > 0, true, 'very large tables split into bounded row groups')
assert.equal(continuedTableSections.every((section) => section.renderPrefix?.startsWith(tableHeader)), true, 'continued table groups repeat their header instead of rendering rows as paragraphs')

const semanticListFixture = `${'# Items\n\n'}${Array.from({ length: 600 }, (_, index) => `- Item ${index}\n`).join('')}`
const semanticListSections = buildMarkdownPreviewSections(semanticListFixture)
const semanticListStart = semanticListFixture.indexOf('- Item')
assert.equal(semanticListSections.filter((section) => section.end > semanticListStart).length, 1, 'ordinary long lists remain one semantic list instead of fragmenting at viewport boundaries')
const multilineParagraphFixture = Array.from({ length: 900 }, (_, index) => `line ${index} continues the same paragraph`).join('\n')
assert.equal(buildMarkdownPreviewSections(multilineParagraphFixture).length, 1, 'one multiline paragraph is never hard-split into different paragraphs')
const nonInterruptingOrderedMarker = `${'paragraph words '.repeat(500)}\n2. this remains part of the paragraph`
assert.equal(buildMarkdownPreviewSections(nonInterruptingOrderedMarker).length, 1, 'an ordered marker other than 1 cannot incorrectly interrupt an existing CommonMark paragraph')
const duplicateHeadingSections = buildMarkdownPreviewSections('# Same\n\nBody.\n\n# Same\n')
assert.deepEqual(duplicateHeadingSections.flatMap((section) => section.headingIds || []), ['same', 'same-2'], 'heading IDs are unique at document scope before virtual sections parse out of order')

const referencedFixture = `${'[Open the guide][guide]\n\n'.repeat(300)}[guide]: ./docs/guide.md \"Guide\"\n`
const referencedSections = buildMarkdownPreviewSections(referencedFixture)
const referenceUseSection = referencedSections.find((section) => markdownPreviewSectionSource(referencedFixture, section).includes('[Open the guide][guide]'))
assert.equal(Boolean(referenceUseSection), true)
assert.equal(markdownPreviewSectionRenderContent(referencedFixture, referenceUseSection!).includes('[guide]: ./docs/guide.md'), true, 'document-level reference definitions remain available inside independently parsed sections')
const manyDefinitionsFixture = `${'[label0]\n\n'.repeat(200)}${Array.from({ length: 40 }, (_, index) => `[label${index}]: ./docs/${index}.md`).join('\n')}\n`
const shortcutReferenceSection = buildMarkdownPreviewSections(manyDefinitionsFixture).find((section) => markdownPreviewSectionSource(manyDefinitionsFixture, section).includes('[label0]'))
assert.equal(markdownPreviewSectionRenderContent(manyDefinitionsFixture, shortcutReferenceSection!).includes('[label0]: ./docs/0.md'), true, 'shortcut references still resolve when a document defines more than 32 labels')
const footnoteFixture = `${'Footnote[^note].\n\n'.repeat(200)}[^note]: Shared footnote.\n`
const footnoteSections = buildMarkdownPreviewSections(footnoteFixture)
assert.equal(footnoteSections.length, 1, 'documents with cross-section footnote semantics stay atomic')
assert.equal(footnoteSections.every((section) => !(section.renderPrefix || '').includes('[^note]:')), true, 'footnote definitions are not duplicated into virtual sections')
const oversizedFootnoteFixture = `${'Large footnote reference[^note].\n\n'.repeat(10_000)}[^note]: Shared footnote.\n`
assert.equal(buildMarkdownPreviewSections(oversizedFootnoteFixture).every((section) => section.renderAsSource === true), true, 'oversized footnote documents use a bounded source fallback instead of one giant renderer task')

const heightIndex = new MarkdownPreviewHeightIndex([100, 120, 80, 200])
assert.equal(heightIndex.totalHeight(), 500)
assert.equal(heightIndex.offsetAt(3), 300)
assert.deepEqual(heightIndex.rangeForViewport(100, 220, 0), { start: 1, end: 2 }, 'height index maps exact viewport boundaries to sections')
assert.equal(heightIndex.update(0, 150), 50)
assert.equal(heightIndex.offsetAt(3), 350, 'one measurement updates later offsets without rebuilding an array')
assert.deepEqual(heightIndex.rangeForViewport(149, 271, 0), { start: 0, end: 3 }, 'height index range lookup follows measured changes')
const oversizedMarkdownHeight = 48_000_000
const markdownViewportHeight = 900
const oversizedMarkdownDomHeight = markdownDomHeight(oversizedMarkdownHeight)
const oversizedMarkdownScale = markdownScrollScale(oversizedMarkdownHeight, oversizedMarkdownDomHeight, markdownViewportHeight)
assert.equal(oversizedMarkdownDomHeight, MAX_MARKDOWN_DOM_HEIGHT, 'extreme Markdown stays below Chromium’s reliable DOM height ceiling')
assert.equal(Math.round(markdownLogicalViewportStart((oversizedMarkdownDomHeight - markdownViewportHeight) / 2, oversizedMarkdownHeight, oversizedMarkdownDomHeight, markdownViewportHeight)), Math.round((oversizedMarkdownHeight - markdownViewportHeight) / 2), 'scaled scroll coordinates address the middle of the logical scrollable extent')
assert.equal(Math.round(markdownLogicalViewportStart(oversizedMarkdownDomHeight - markdownViewportHeight, oversizedMarkdownHeight, oversizedMarkdownDomHeight, markdownViewportHeight)), oversizedMarkdownHeight - markdownViewportHeight, 'the final logical viewport remains reachable')
assert.equal(Math.round(markdownPhysicalViewportStart(oversizedMarkdownHeight - markdownViewportHeight, oversizedMarkdownHeight, oversizedMarkdownDomHeight, markdownViewportHeight)), oversizedMarkdownDomHeight - markdownViewportHeight, 'logical end navigation maps to the physical scrollbar end')
assert.equal(oversizedMarkdownScale < 1, true)
assert.equal(markdownShouldAdjustScrollPosition(600, 1_000, 400, false), false, 'the Markdown end edge never receives programmatic scroll correction')
assert.equal(markdownShouldAdjustScrollPosition(350, 1_000, 400, false), false, 'the final three quarters of a viewport remains free of automatic correction')
assert.equal(markdownShouldAdjustScrollPosition(200, 1_000, 400, false), true, 'settled deep-document measurements can still preserve a distant viewport anchor')
assert.equal(markdownShouldAdjustScrollPosition(200, 1_000, 400, true), false, 'active wheel, trackpad, and scrollbar input always owns the viewport')
assert.equal(markdownWheelScrollTop(200, 1_000, 400, 120), 320, 'Markdown wheel input maps directly to one deterministic scroll delta')
assert.equal(markdownWheelScrollTop(560, 1_000, 400, 120), 600, 'Markdown wheel input clamps at the bottom without overscroll bounce')
assert.equal(markdownWheelScrollTop(20, 1_000, 400, -120), 0, 'Markdown wheel input clamps at the top without scroll chaining')
const easedDown = markdownEasedScrollTop(200, 500, 16)
const easedUp = markdownEasedScrollTop(500, 200, 16)
assert.equal(easedDown > 200 && easedDown < 500, true, 'Markdown easing advances toward the target without overshooting')
assert.equal(easedUp < 500 && easedUp > 200, true, 'Markdown easing is symmetric in both directions')
assert.equal(markdownEasedScrollTop(499.75, 500, 16), 500, 'sub-pixel easing settles exactly on the target')

assert.equal(previewTreeScrollTopForIndex({ index: 30, rowCount: 100, rowHeight: 32, viewportHeight: 320, currentScrollTop: 0, alignment: 'center' }), 816, 'tree reveal centers the selected row in the viewport')
assert.equal(previewTreeScrollTopForIndex({ index: 1, rowCount: 100, rowHeight: 32, viewportHeight: 320, currentScrollTop: 500, alignment: 'center' }), 0, 'centered reveal clamps cleanly at the tree start')
assert.equal(previewTreeScrollTopForIndex({ index: 99, rowCount: 100, rowHeight: 32, viewportHeight: 320, currentScrollTop: 0, alignment: 'center' }), 2_880, 'centered reveal clamps cleanly at the tree end')
assert.equal(previewTreeScrollTopForIndex({ index: 5, rowCount: 100, rowHeight: 32, viewportHeight: 320, currentScrollTop: 0, alignment: 'auto' }), 0, 'ordinary keyboard navigation does not move a row that is already visible')

assert.equal(previewDirectoryCanExpand({ name: 'empty', path: 'C:/empty', type: 'directory', isHidden: false, childrenLoaded: true, children: [] }), false, 'known-empty folders are navigation targets without false disclosure controls')
assert.equal(previewDirectoryCanExpand({ name: 'lazy', path: 'C:/lazy', type: 'directory', isHidden: false, childrenLoaded: false }), true, 'unloaded folders retain disclosure until their contents are known')
assert.equal(previewDirectoryCanExpand({ name: 'full', path: 'C:/full', type: 'directory', isHidden: false, childrenLoaded: true, children: [{ name: 'child', path: 'C:/full/child', type: 'directory', isHidden: false }] }), true)
const previousAnchorRows = buildVisiblePreviewTreeModel([
    { name: 'a', path: 'C:/a', type: 'directory', isHidden: false },
    { name: 'b', path: 'C:/b', type: 'directory', isHidden: false },
    { name: 'c', path: 'C:/c', type: 'directory', isHidden: false }
], new Set()).rows
const nextAnchorModel = buildVisiblePreviewTreeModel([
    { name: 'inserted-1', path: 'C:/inserted-1', type: 'directory', isHidden: false },
    { name: 'inserted-2', path: 'C:/inserted-2', type: 'directory', isHidden: false },
    { name: 'a', path: 'C:/a', type: 'directory', isHidden: false },
    { name: 'b', path: 'C:/b', type: 'directory', isHidden: false },
    { name: 'c', path: 'C:/c', type: 'directory', isHidden: false }
], new Set())
assert.equal(previewTreeAnchoredScrollTop(previousAnchorRows, nextAnchorModel.rowIndexByKey, 65, 32), 129, 'tree refreshes keep the same top row and pixel offset visible')

assert.deepEqual(
    scanPreviewInspectorStats(`short\n${'x'.repeat(121)}\ntrailing  `),
    { totalFileLines: 3, longLineCount: 1, trailingWhitespaceCount: 1 },
    'inspector line metrics share one text scan'
)

const historyNavigationSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewHistoryNavigation.tsx', import.meta.url), 'utf8')
const previewHookSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreview.ts', import.meta.url), 'utf8')
const fileHandlerSource = readFileSync(new URL('../src/main/ipc/handlers/file-tree-handlers.ts', import.meta.url), 'utf8')
const projectViewCacheSource = readFileSync(new URL('../src/renderer/src/lib/projectViewCache.ts', import.meta.url), 'utf8')
const previewUtilsSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/utils.ts', import.meta.url), 'utf8')
const previewModalSource = readFileSync(new URL('../src/renderer/src/components/ui/FilePreviewModal.tsx', import.meta.url), 'utf8')
const terminalRuntimeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/previewTerminalRuntime.ts', import.meta.url), 'utf8')
const textPreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/TextPreviewContent.tsx', import.meta.url), 'utf8')
const fileMarkdownSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/FileMarkdownPreview.tsx', import.meta.url), 'utf8')
const deferredMarkdownSectionSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/DeferredMarkdownSection.tsx', import.meta.url), 'utf8')
const markdownWorkerClientSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/markdownPreviewWorkerClient.ts', import.meta.url), 'utf8')
const markdownWorkerSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/markdown-preview.worker.ts', import.meta.url), 'utf8')
const markdownIndexWorkerClientSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/markdownPreviewIndexWorkerClient.ts', import.meta.url), 'utf8')
const markdownIndexWorkerSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/markdown-preview-index.worker.ts', import.meta.url), 'utf8')
const codeElementsSource = readFileSync(new URL('../src/renderer/src/components/ui/markdown/CodeElements.tsx', import.meta.url), 'utf8')
const markdownRenderQueueSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/markdownPreviewRenderQueue.ts', import.meta.url), 'utf8')
const imagePreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/ImagePreviewContent.tsx', import.meta.url), 'utf8')
const pdfPreviewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PdfPreviewContent.tsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewModalLayout.tsx', import.meta.url), 'utf8')
const analysisSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/useFilePreviewModalAnalysis.tsx', import.meta.url), 'utf8')
const csvSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/CsvPreviewTable.tsx', import.meta.url), 'utf8')
const virtualTreeSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/PreviewVirtualFileTree.tsx', import.meta.url), 'utf8')
const virtualTreeModelSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/previewVirtualTreeModel.ts', import.meta.url), 'utf8')
const virtualWindowSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/usePreviewVirtualWindow.ts', import.meta.url), 'utf8')
const electronViteSource = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
}
assert.equal(historyNavigationSource.includes('ChevronLeft'), true, 'preview history uses tailless chevrons')
assert.equal(historyNavigationSource.includes('ArrowLeft'), false)
assert.equal(previewHookSource.includes('readPreviewContentCache'), true, 'replaced files paint from bounded memory while reopening')
assert.equal(previewHookSource.includes('window.devscope.readFileContent(filePath, cached'), true, 'cached previews still revalidate against disk metadata')
assert.equal(previewHookSource.includes('response.notModified && cached'), true, 'unchanged warm previews avoid retransferring file content')
assert.equal(previewHookSource.includes('previewContentRequests'), true, 'hover prefetch and open-time reads share one in-flight content request')
assert.equal(previewHookSource.includes('yieldToBrowserPaint'), false, 'file I/O starts immediately instead of waiting an extra frame')
assert.equal(previewHookSource.includes('preloadPreviewRenderer(previewTarget.type)'), true, 'renderer chunks begin loading in parallel with file I/O')
assert.equal(previewHookSource.includes('.warmFileMarkdownPreview()'), true, 'Markdown workers warm when an explicit file preview is prepared')
assert.equal(previewHookSource.includes('const sharedPreviewContentCache'), true, 'bounded preview snapshots survive modal remounts for immediate warm reopening')
assert.equal(previewHookSource.includes('sharedPreviewContentCache.clear()'), false, 'closing the preview does not discard the bounded warm cache')
assert.equal(fileHandlerSource.includes('const PREVIEW_MAX_BYTES = 8 * 1024 * 1024'), true, 'virtual Markdown raises the rendered preview ceiling to eight MiB')
assert.equal(fileHandlerSource.includes('const stats = await fileHandle.stat()'), true, 'preview reads use the open file handle instead of access/stat/open path probes')
assert.equal(fileHandlerSource.includes('previewBytes - probeBytes'), true, 'text preview does not reread binary-probe bytes')
assert.equal(fileHandlerSource.includes("fileHandle.readFile({ encoding: 'utf-8' })"), true, 'full edit reads reuse the already validated file handle')
assert.equal(projectViewCacheSource.includes('MAX_PREVIEW_FOLDER_TREE_CACHE_ENTRIES = 80'), true, 'preview navigation cache has a hard memory bound')
assert.equal(projectViewCacheSource.includes('previewFolderTreeInFlight'), true, 'duplicate folder-tree requests share an in-flight cache')
assert.equal(projectViewCacheSource.includes('invalidateCachedPreviewFolderTreeRoot'), true, 'explicit refreshes invalidate nested directory snapshots together')
assert.equal(previewUtilsSource.includes('content.split(/\\r?\\n/)'), false, 'CSV delimiter detection does not allocate every line before parsing')
assert.doesNotMatch(previewModalSource, /useFilePreviewTerminal|useFilePreviewPython|PreviewTerminalPanel|PreviewPythonOutputPanel/, 'file previews have no execution or embedded terminal lifecycle')
assert.equal(terminalRuntimeSource.includes("import('xterm')"), true, 'terminal code loads only when a terminal surface mounts')
assert.equal(textPreviewSource.includes("lazy(() => import('./FileMarkdownPreview'))"), true, 'non-Markdown previews do not load the progressive Markdown renderer')
assert.equal(fileMarkdownSource.includes('computeMarkdownVirtualRange'), true, 'long Markdown renders only the current scroll window')
assert.equal(fileMarkdownSource.includes('requestAnimationFrame'), true, 'Markdown range and measurement work is frame-coalesced')
assert.equal(fileMarkdownSource.includes('requestMarkdownPreviewIndex'), true, 'long-document semantic indexing leaves the renderer thread')
assert.equal(markdownIndexWorkerSource.includes('buildMarkdownPreviewSections(request.content)'), true, 'the lightweight index worker owns long-document section construction')
assert.equal(markdownIndexWorkerClientSource.includes('MAX_INDEX_CACHE_ENTRIES = 2'), true, 'warm semantic indexes are retained within a hard memory bound')
assert.equal(markdownIndexWorkerClientSource.includes('activeRequestId'), true, 'semantic indexing coalesces duplicate work and runs one document at a time')
assert.equal(markdownIndexWorkerClientSource.includes('restartIndexWorker'), true, 'an abandoned active index cannot block a newly selected document')
assert.equal(markdownIndexWorkerClientSource.includes('MAX_INDEX_CACHE_BYTES'), true, 'semantic index retention includes section metadata and repeated synthetic context')
assert.equal(markdownIndexWorkerClientSource.includes('MARKDOWN_INDEX_WORKER_IDLE_TTL_MS = 20_000'), true, 'an idle semantic-index worker releases its renderer process')
assert.doesNotMatch(markdownIndexWorkerClientSource, /if \(typeof window !== 'undefined'\) warmMarkdownPreviewIndexWorker\(\)/, 'loading file-preview code alone cannot start a Markdown index process')
assert.equal(fileMarkdownSource.includes('pendingHeightsRef'), true, 'section measurements batch before updating the height index')
assert.equal(fileMarkdownSource.includes('pendingBottomPinRef'), false, 'Markdown never engages a sticky stay-at-bottom mode')
assert.equal(fileMarkdownSource.includes('isMarkdownScrollBusy()'), true, 'active user scrolling suppresses programmatic height-correction writes')
assert.match(fileMarkdownSource, /const scheduleScrollUpdate = \(\) => \{[\s\S]{0,160}markMarkdownScrollActivity\(\)[\s\S]{0,120}if \(!fullyResident\) scheduleUpdate\(\)/, 'scroll activity stays observable without running virtual geometry for fully resident documents')
assert.equal(fileMarkdownSource.includes('resizeObserver?.observe(root)'), false, 'the Markdown root cannot feed its own height updates back through a second resize observer')
assert.match(fileMarkdownSource, /getPropertyValue\('--markdown-scroll-compensation'\) !== scrollCompensation/, 'unchanged virtual scroll compensation does not invalidate style every frame')
assert.equal(fileMarkdownSource.includes('shouldAdjustScrollPosition'), true, 'near-end height measurements update layout without taking over the viewport')
assert.equal(fileMarkdownSource.includes('--markdown-scroll-compensation'), true, 'extreme documents keep true-size visible blocks inside a scaled browser scroll range')
assert.equal(fileMarkdownSource.includes('handleCompressedMarkdownWheel'), true, 'only giant compressed Markdown documents need a mapped vertical wheel path')
assert.equal(fileMarkdownSource.includes("overscrollBehaviorY = 'none'"), true, 'Markdown disables native end-edge bounce while mounted')
assert.match(fileMarkdownSource, /if \(scrollParent && totalHeight > domHeight\)[\s\S]{0,180}addEventListener\('wheel', handleCompressedMarkdownWheel/, 'ordinary Markdown leaves wheel input on Chromium’s compositor without a blocking listener')
assert.equal(fileMarkdownSource.includes('markdownWheelScrollTop('), true, 'compressed giant Markdown clamps mapped wheel movement through tested geometry')
assert.equal(fileMarkdownSource.includes("behavior: 'smooth'"), false, 'ordinary wheel input cannot trail repeated compositor smooth-scroll retargeting')
assert.equal(fileMarkdownSource.includes('wheelAnimationFrameRef'), false, 'Markdown cannot retain a JavaScript animation-frame scroll loop')
assert.equal(fileMarkdownSource.includes('wheelSettleTimerRef'), false, 'Markdown retains no synthetic wheel target after input ends')
assert.match(fileMarkdownSource, /const fullyResident = sections\.length <= 8 && totalHeight <= 40_000/, 'small semantic documents stay mounted and skip per-frame virtual range geometry')
assert.equal(fileMarkdownSource.includes("className={fullyResident ? 'relative w-full' : 'absolute inset-x-0 top-0 w-full'}"), true, 'fully resident Markdown sections use document flow so late growth pushes later sections down')
assert.equal(fileMarkdownSource.includes("height: fullyResident ? undefined : `${domHeight}px`"), true, 'fully resident Markdown lets measured content own the root height')
assert.equal(fileMarkdownSource.includes('handleVirtualAnchorLink'), true, 'fragment links can navigate to headings whose sections are not mounted')
assert.equal(fileMarkdownSource.includes('markdownPhysicalViewportStart'), true, 'virtual heading navigation respects compressed giant-document coordinates')
assert.equal(fileMarkdownSource.includes('pendingAnchorRef'), true, 'virtual fragment navigation performs a final exact heading reveal after mount')
assert.equal(deferredMarkdownSectionSource.includes('requestMarkdownPreviewSection'), true, 'Markdown parsing leaves the renderer thread through a cancellable request')
assert.equal(deferredMarkdownSectionSource.includes('parseRequest?.cancel()'), true, 'unmounted viewport sections cancel stale parse demand')
assert.equal(deferredMarkdownSectionSource.includes('const previewInstanceId = useId()'), true, 'two previews of the same file cannot cancel each other’s queued sections')
assert.equal(deferredMarkdownSectionSource.includes('section.headingIds'), true, 'document-scoped heading identities reach out-of-order section parsing')
assert.equal(deferredMarkdownSectionSource.includes('activePreparation?.tree === null'), true, 'worker failure falls back to bounded escaped source instead of parsing a giant section on the renderer thread')
assert.equal(deferredMarkdownSectionSource.includes('plainCodeBlocks'), false, 'viewport bounding preserves the full code-block renderer instead of degrading appearance')
assert.equal(deferredMarkdownSectionSource.includes('interactionLayerEnabled={false}'), true, 'virtual sections delegate links to one document interaction layer')
assert.equal(deferredMarkdownSectionSource.includes('deferCodeHighlighting'), true, 'visible code blocks retain full chrome while highlighting upgrades progressively')
assert.match(fileMarkdownSource, /eagerLayout=\{fullyResident\}/, 'small fully resident Markdown files request stable eager section layout')
assert.match(deferredMarkdownSectionSource, /eagerLayout[\s\S]*\? undefined[\s\S]*contentVisibility: 'auto'/, 'small Markdown avoids deferred offscreen height changes while virtual documents retain content visibility')
assert.equal(codeElementsSource.includes('deferredHighlightQueue'), true, 'syntax highlighting uses one bounded upgrade queue')
assert.equal(codeElementsSource.includes('window.requestIdleCallback'), true, 'syntax color upgrades wait for genuine browser idle time')
assert.equal(markdownRenderQueueSource.includes('isMarkdownScrollBusy'), true, 'non-visible Markdown preparation pauses during active scrolling')
assert.equal(markdownRenderQueueSource.includes('drainUrgentQueue'), true, 'the complete visible window enters the worker scheduler without one-frame-per-section latency')
assert.equal(codeElementsSource.includes('!isMarkdownScrollBusy()'), true, 'syntax coloring cannot steal frames while the document is moving')
assert.equal(markdownWorkerClientSource.includes('MAX_PARSED_TREE_CACHE_ENTRIES = 128'), true, 'worker results use a bounded warm cache for reverse scrolling')
assert.equal(markdownWorkerClientSource.includes('inFlightJob: ParseJob | null'), true, 'only one parse is in flight so urgent work can overtake queued overscan')
assert.equal(markdownWorkerClientSource.includes('urgentParseQueue'), true, 'visible Markdown has a dedicated priority queue')
assert.equal(markdownWorkerClientSource.includes('restartWorkerForUrgentWork'), true, 'abandoned active parses cannot block a newer visible section')
assert.equal(markdownWorkerClientSource.includes('MAX_PARSED_TREE_CACHE_BYTES'), true, 'parsed-tree retention is bounded by estimated tree memory, not source characters alone')
assert.equal(markdownWorkerClientSource.includes('MARKDOWN_PARSE_WORKER_IDLE_TTL_MS = 20_000'), true, 'an idle Markdown parser releases its renderer process')
assert.doesNotMatch(markdownWorkerClientSource, /if \(typeof window !== 'undefined'\) warmMarkdownPreviewWorker\(\)/, 'loading file-preview code alone cannot start a Markdown parser process')
assert.match(markdownWorkerClientSource, /import\.meta\.hot[\s\S]{0,220}worker\?\.terminate\(\)/, 'development hot reloads terminate the previous parser worker')
assert.equal(markdownWorkerSource.includes('stripMarkdownTreePositions'), true, 'worker transfers omit unused source-position payloads')
assert.equal(markdownWorkerSource.includes('warm parser'), true, 'the real Markdown parse pipeline is compiled before the first visible section')
assert.equal(electronViteSource.includes("decode-named-character-reference/index.js"), true, 'Markdown workers use the worker-safe entity decoder instead of the DOM-only browser export')
assert.equal(imagePreviewSource.includes('object-cover opacity-[0.18] blur-2xl'), true, 'contained images fill unused preview space with a quiet image-derived backdrop')
assert.equal(imagePreviewSource.includes('IMAGE_DIMENSION_CACHE_LIMIT = 96'), true, 'media transitions retain bounded image measurements without unbounded renderer state')
assert.equal(imagePreviewSource.includes('setNaturalSize(readImageDimensions(filePath))'), true, 'an outgoing image keeps its natural dimensions when it enters the transition layer')
assert.equal(imagePreviewSource.includes('imagePreviewViewportSizes.set(viewportMode, dimensions)'), true, 'an outgoing image keeps the active stage dimensions instead of jumping to 100% size')
assert.equal(imagePreviewSource.includes('object-contain'), true, 'the primary preview still shows the complete image')
assert.equal(imagePreviewSource.includes('title="Fill the preview"'), true, 'users can intentionally fill the stage when cropping is preferable')
assert.equal(pdfPreviewSource.includes('<iframe'), true, 'PDF preview uses Chromium’s local embedded document viewer')
assert.equal(pdfPreviewSource.includes('getFileUrl(filePath)'), true, 'PDFs stay on the protected local-file protocol')
assert.equal(textPreviewSource.includes("lazy(() => import('./CsvPreviewTable'))"), true, 'non-tabular previews do not load CSV rendering')
assert.equal(textPreviewSource.includes('Large Markdown is shown as source'), false, 'large documents remain fully rendered instead of dropping to source mode')
assert.equal(textPreviewSource.includes('<FileMarkdownPreview'), true, 'all Markdown sizes use the virtual rendered document surface')
assert.equal(layoutSource.includes("await import('./PreviewNavigationSidebar')"), true, 'windowed previews skip expanded navigation code')
assert.equal(layoutSource.includes("await import('./PreviewContextSidebar')"), true, 'windowed previews skip expanded Outline and Inspector code')
assert.equal(layoutSource.includes('scrollContainerRef={markdownScrollContainerRef}'), true, 'Markdown virtualization receives the element that actually owns preview scrolling')
assert.equal(analysisSource.includes('useDeferredValue(draftContent)'), true, 'diff and inspector analysis cannot block urgent editor keystrokes')
assert.equal(csvSource.includes('content.length > 100_000'), true, 'large CSV parsing waits for an idle interaction frame')
assert.equal(csvSource.includes('parseDelimitedContentChunked'), true, 'large CSV parsing yields between bounded chunks instead of blocking one renderer task')
const visibleTreeModel = buildVisiblePreviewTreeModel([
    {
        name: 'src',
        path: 'C:/project/src',
        type: 'directory',
        isHidden: false,
        childrenLoaded: true,
        children: [{ name: 'main.ts', path: 'C:/project/src/main.ts', type: 'file', isHidden: false }]
    },
    { name: 'package.json', path: 'C:/project/package.json', type: 'file', isHidden: false }
], new Set(['c:/project/src']))
assert.deepEqual(visibleTreeModel.rows.map((row) => [row.node.name, row.depth]), [
    ['src', 0],
    ['main.ts', 1],
    ['package.json', 0]
], 'expanded hierarchy flattens into stable visible rows before rendering')
assert.equal(visibleTreeModel.rowIndexByKey.get('c:/project/src/main.ts'), 1, 'the same traversal builds keyboard and target lookup indexes')
assert.equal(visibleTreeModel.horizontalContentWidth >= 240, true, 'the same traversal measures horizontal tree width')

const millionRowRange = computePreviewVirtualRange({
    rowCount: 1_000_000,
    rowHeight: 24,
    scrollTop: 12_000_000,
    viewportHeight: 600,
    overscan: 10
})
assert.equal(millionRowRange.end - millionRowRange.start <= 46, true, 'a million-row tree mounts only one viewport plus overscan')
assert.equal(previewVirtualRangeCoversViewport({
    range: millionRowRange,
    rowCount: 1_000_000,
    rowHeight: 24,
    scrollTop: 12_000_048,
    viewportHeight: 600,
    guardRows: 3
}), true, 'small native scroll movement reuses the current rendered window')
assert.equal(previewVirtualRangeCoversViewport({
    range: millionRowRange,
    rowCount: 1_000_000,
    rowHeight: 24,
    scrollTop: 12_002_400,
    viewportHeight: 600,
    guardRows: 3
}), false, 'the rendered window advances once the viewport reaches its guard boundary')
assert.equal(virtualTreeSource.includes('rows.slice(range.start, range.end)'), true, 'React receives only the virtual row window')
assert.match(virtualTreeModelSource, /previewTreeNodeLayoutIdentityCache = new WeakMap[\s\S]*cached\?\.path === node\.path && cached\.name === node\.name/, 'repeat tree expansions reuse immutable path and width identities')
assert.equal(virtualWindowSource.includes("addEventListener('scroll', scheduleRangeUpdate, { passive: true })"), true, 'native scroll uses one passive listener')
assert.equal(virtualWindowSource.includes('window.requestAnimationFrame'), true, 'scroll calculations are frame-coalesced')
assert.equal(desktopPackage.dependencies?.['@pierre/trees'], undefined, 'the slow tree framework is absent from production dependencies')
assert.equal(desktopPackage.scripts?.postinstall?.includes('patch-pierre-trees.mjs'), false, 'the retired package patch is absent from installation')

console.log('File preview performance contract: ok')
