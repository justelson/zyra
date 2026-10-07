import assert from 'node:assert/strict'
import { prepareImmediateMarkdownSection, MAX_IMMEDIATE_MARKDOWN_SECTION_CHARS } from '../src/renderer/src/components/ui/file-preview/markdownPreviewImmediateSection'
import { buildMarkdownPreviewSections, markdownPreviewSectionRenderContent } from '../src/renderer/src/components/ui/file-preview/markdownPreviewVirtualModel'

const source = '# Repeat\n\nVisible prose **bold**.\n\n# Repeat\n\n<script>window.bad=true</script>\n\n- item\n'
const tree = prepareImmediateMarkdownSection(source, ['repeat','repeat-1'], true)!
assert.ok(tree, 'ordinary first-screen Markdown is ready without a worker or a loading placeholder')
assert.deepEqual(tree.children.filter(node=>node.type==='element'&&node.tagName==='h1').map(node=>node.type==='element'&&node.properties.id),['repeat','repeat-1'])
assert.ok(!JSON.stringify(tree).includes('window.bad'), 'the immediate path uses the same HTML sanitization')
assert.equal(prepareImmediateMarkdownSection(source,['repeat','repeat-1'],true),tree,'the bounded worker cache also serves immediate content')
assert.equal(prepareImmediateMarkdownSection('not visible',[],false),null,'overscan preparation stays in the worker')
assert.equal(prepareImmediateMarkdownSection('x'.repeat(MAX_IMMEDIATE_MARKDOWN_SECTION_CHARS+1),[],true),null,'large sections cannot synchronously parse on the UI thread')
const document = '# Start\n\n' + 'A paragraph with **emphasis**, a [link](https://example.com), and `code`.\n\n'.repeat(3000)
const opening = buildMarkdownPreviewSections(document.slice(0,16_000))
const section = opening[0]
const started = performance.now()
assert.ok(prepareImmediateMarkdownSection(markdownPreviewSectionRenderContent(document,section),section.headingIds,true),'a large document has a bounded ready opening section')
console.log(`Bounded first-screen Markdown: ${Math.round(performance.now()-started)}ms; heading identity, sanitization, cache and worker limits: ok`)
