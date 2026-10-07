import assert from 'node:assert/strict'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    getMarkdownRenderCacheStats,
    prepareMarkdownRender
} from '../src/renderer/src/components/ui/MarkdownRenderer'
import { getCodeHighlightCacheStats } from '../src/renderer/src/components/ui/markdown/CodeElements'
import {
    StreamingAssistantMarkdown,
    CompletedAssistantMarkdown
} from '../src/renderer/src/pages/assistant/AssistantTimelineText'

const content = `# Cached heading

| Name | State |
| --- | --- |
| Timeline | Fast |

- formatted list
- [internal file](./src/example.ts)
- [unsafe link](javascript:alert(1))

<div data-cache-raw="yes">raw html retained</div>

\`\`\`ts
const ready: boolean = true
\`\`\`
`
const props = {
    content,
    cacheKey: 'assistant-message:test-cache:v1',
    filePath: 'C:/workspace/README.md'
}

const before = getMarkdownRenderCacheStats()
const first = prepareMarkdownRender(props)
const afterFirst = getMarkdownRenderCacheStats()
const second = prepareMarkdownRender(props)
const afterSecond = getMarkdownRenderCacheStats()

assert.equal(afterFirst.compilations, before.compilations + 1, 'first completed-message render compiles Markdown once')
assert.equal(afterSecond.compilations, afterFirst.compilations, 'virtual remount reuses the compiled Markdown tree')
assert.equal(second, first, 'cache returns the same immutable React tree for a stable message version')

const highlightBefore = getCodeHighlightCacheStats()
const markup = renderToStaticMarkup(createElement(Fragment, null, first))
const highlightAfterFirst = getCodeHighlightCacheStats()
const repeatedMarkup = renderToStaticMarkup(createElement(Fragment, null, second))
const highlightAfterSecond = getCodeHighlightCacheStats()
assert.equal(highlightAfterFirst.compilations, highlightBefore.compilations + 1, 'first code-block mount tokenizes immutable source once')
assert.equal(highlightAfterSecond.compilations, highlightAfterFirst.compilations, 'virtual code-block remount reuses its highlighted React tree')
assert.equal(repeatedMarkup, markup)
assert.match(markup, /Cached heading/)
assert.match(markup, /<table/)
assert.match(markup, /formatted list/)
assert.match(markup, /data-cache-raw="yes"/)
assert.doesNotMatch(markup, /javascript:alert/)
assert.match(markup, /const[\s\S]*ready/)
assert.match(markup, /Copy/)

const transientBefore = getMarkdownRenderCacheStats()
prepareMarkdownRender({ content: 'unfinished **tail', transient: true, lightweight: true })
prepareMarkdownRender({ content: 'unfinished **tail grows', transient: true, lightweight: true })
const transientAfter = getMarkdownRenderCacheStats()
assert.equal(transientAfter.entries, transientBefore.entries, 'intermediate stream tails must not pollute the completed Markdown cache')
assert.equal(transientAfter.compilations, transientBefore.compilations + 2, 'changing stream tails compile independently')

const streamingContent = `# Live heading

This is **already bold** while text arrives.

\`\`\`ts
const streaming = true`
const streamCacheBefore = getMarkdownRenderCacheStats()
const streamingMarkup = renderToStaticMarkup(createElement(StreamingAssistantMarkdown, {
    content: streamingContent,
    cacheKey: 'assistant-message:live-stream',
    filePath: 'C:/workspace/README.md'
}))
assert.match(streamingMarkup, /data-assistant-streaming-markdown="true"/)
assert.match(streamingMarkup, /<h1[^>]*>Live heading/)
assert.match(streamingMarkup, /<strong[^>]*>already bold<\/strong>/)
assert.match(streamingMarkup, /const streaming = true/)
assert.equal((streamingMarkup.match(/class="markdown-body /g) || []).length, 1, 'live Markdown retains document-wide paragraph and reference context')
assert.equal(getMarkdownRenderCacheStats().entries, streamCacheBefore.entries, 'streaming documents cannot pollute the completed-tree cache')

const visual = '<visualization title="Chart" summary="Two values.">\n<svg>private-source-marker</svg>'
const pendingVisual = renderToStaticMarkup(createElement(StreamingAssistantMarkdown, { content: 'Before\n' + visual, cacheKey: 'visual-stream' }))
assert.match(pendingVisual, /Creating visualization/)
assert.doesNotMatch(pendingVisual, /private-source-marker/)
const stoppedVisual = renderToStaticMarkup(createElement(CompletedAssistantMarkdown, { content: visual, cacheKey: 'visual-stopped' }))
assert.match(stoppedVisual, /Visualization incomplete/)
assert.doesNotMatch(stoppedVisual, /Creating visualization|private-source-marker/)
const oldThreadVisual = renderToStaticMarkup(createElement(CompletedAssistantMarkdown, { content: 'Before\n' + visual + '\n</visualization>\nAfter', cacheKey: 'historical-visual' }))
assert.match(oldThreadVisual, /data-visualization-state="complete"/)
assert.match(oldThreadVisual, /Before[\s\S]*Chart[\s\S]*After/)
const literalVisual = renderToStaticMarkup(createElement(CompletedAssistantMarkdown, { content: '```html\n' + visual + '\n</visualization>\n```', cacheKey: 'visual-example' }))
assert.doesNotMatch(literalVisual, /data-visualization-state/)

// Reference compilation cost belongs here, outside the native UI fixture's
// 20s deadline. Native chat-display still tests forty real reveal updates for
// these same inputs and bounds its actual mounted renderer compilation count.
for (const [label, largeContent] of [
    ['large paragraph', 'Ordinary paragraph text with words. '.repeat(470)],
    ['350 paragraphs', 'Settled paragraph with **bold** text and words.\n\n'.repeat(350)]
]) {
    const before = getMarkdownRenderCacheStats()
    for (let i = 1; i <= 40; i++) prepareMarkdownRender({ content: largeContent + 'x'.repeat(i), transient: true,
        deferCodeHighlighting: true, fadeStreamingText: true, animateInitialText: true })
    const after = getMarkdownRenderCacheStats()
    assert.equal(after.compilations - before.compilations, 40, 'the unthrottled reference compiles every visible update')
    assert.equal(after.entries, before.entries, 'benchmark versions never enter the completed-message cache')
    console.log(`Reference ${label} (${largeContent.length} chars): 40 updates/40 compilations/${(after.compilationMilliseconds - before.compilationMilliseconds).toFixed(1)}ms`)
}
console.log('Assistant Markdown compiled-cache and visualization routing contracts: ok')
process.exit(0)
