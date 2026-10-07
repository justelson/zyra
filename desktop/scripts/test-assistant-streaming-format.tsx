import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { fromHtml } from 'hast-util-from-html'
import { StreamingAssistantMarkdown, CompletedAssistantMarkdown } from '../src/renderer/src/pages/assistant/AssistantTimelineText'
const samples = [
    'First paragraph wraps across a line.\nStill the same paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
    '1. First item.\n\n   Its continuation paragraph.\n\n2. Second item.',
    '> A quoted paragraph.\n>\n> Another quoted paragraph.',
    'Use [the reference][target].\n\n[target]: https://example.com/docs',
    '$$\n\\begin{aligned}\na &= b\n\nc &= d\n\\end{aligned}\n$$'
]
const tags = (html: string) => {
    const tree = fromHtml(html, { fragment: true })
    const result: string[] = []
    const walk = (node: any) => { if (node.type === 'element' && ['p', 'ol', 'ul', 'li', 'blockquote', 'a', 'math'].includes(node.tagName)) result.push(`${node.tagName}:${node.properties.href || ''}`); node.children?.forEach(walk) }
    walk(tree)
    return result
}
for (const [index, content] of samples.entries()) {
    const stream = renderToStaticMarkup(<StreamingAssistantMarkdown content={content} cacheKey={`format:${index}`} />)
    const completed = renderToStaticMarkup(<CompletedAssistantMarkdown content={content} cacheKey={`format:${index}`} />)
    assert.equal((stream.match(/class="markdown-body /g) || []).length, 1, 'streaming paragraphs belong to one Markdown document, preserving normal sibling spacing')
    assert.deepEqual(tags(stream), tags(completed), 'multiline paragraphs, list continuations, quotes, references and math keep the completed document structure while streaming')
}
console.log('Streaming format: shared paragraph spacing and full-document list, quote, reference and math structure: ok')
