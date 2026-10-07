import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import SyntaxPreview from '../../src/renderer/src/components/ui/file-preview/SyntaxPreview'
import TextPreviewContent from '../../src/renderer/src/components/ui/file-preview/TextPreviewContent'
import type { editor } from 'monaco-editor'

Object.assign(window, { devscope: { getWorkingDiff: async () => ({ success: true, diff: '' }), getPathInfo: async () => ({ success: true, exists: false }), searchIndexedPaths: async () => ({ success: true, entries: [] }) } })
const root = createRoot(document.getElementById('root')!)
const code = 'def greeting(name):\n    return "Hello " + name\n\nprint(greeting("reader"))\n'
const markdown = '# Startup fixture\n\n**Readable Markdown** with `inline code`.\n\n## Details\n\n' + 'A short document with ordinary paragraphs.\n\n'.repeat(20)
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
async function waitFor(condition: () => boolean, label: string) {
    const deadline = performance.now() + 20_000
    while (!condition() && performance.now() < deadline) await nextFrame()
    if (!condition()) throw Error(label)
}
async function openCode(label: string) {
    flushSync(() => root.render(null))
    let instance: editor.IStandaloneCodeEditor | null = null
    const started = performance.now()
    flushSync(() => root.render(<SyntaxPreview content={code} language="python" filePath={`C:/fixture/${label}.py`} readOnly={false} onEditorMount={value => { instance = value }} />))
    const placeholderOnCommit = Boolean(document.querySelector('[aria-label="Preparing code editor"]'))
    const readableOnCommit = Boolean(document.getElementById('root')?.textContent?.includes('def greeting(name)'))
    await waitFor(() => instance?.getValue() === code, `${label}: code editor did not mount`)
    const interactiveMs = performance.now() - started
    await waitFor(() => Boolean(document.querySelector('.view-lines [class*="mtk"]:not(.mtk1)')), `${label}: Python syntax colors did not load`)
    const syntaxMs = performance.now() - started
    instance!.setPosition({ lineNumber: 1, column: 1 })
    instance!.executeEdits('fixture-input', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '# inserted\n' }])
    if (!instance!.getValue().startsWith('# inserted\n')) throw Error('The ready editor is not editable')
    return { label, interactiveMs, syntaxMs, placeholderOnCommit, readableOnCommit }
}
async function openMarkdown(label: string) {
    flushSync(() => root.render(null))
    const started = performance.now()
    flushSync(() => root.render(<div style={{ height: '100%', overflowY: 'auto' }}><TextPreviewContent file={{ name: 'guide.md', path: 'C:/fixture/guide.md', type: 'md' }} content={markdown} meta={{}} csvDistinctColorsEnabled={false} /></div>))
    await waitFor(() => Boolean(document.querySelector('h1')) && !document.querySelector('[aria-label="Preparing Markdown section"]'), `${label}: Markdown did not render`)
    if (document.querySelector('[aria-label="Markdown worker unavailable; shown as source"]')) throw Error('Markdown must use its real worker, not a source fallback')
    return { label, renderedMs: performance.now() - started }
}
Object.assign(window, { previewStartupCheck: (async () => {
    const coldCode = await openCode('cold-code')
    const warmCode = await openCode('warm-code')
    const coldMarkdown = await openMarkdown('cold-markdown')
    const warmMarkdown = await openMarkdown('warm-markdown')
    flushSync(() => root.render(null))
    root.unmount()
    return { coldCode, warmCode, coldMarkdown, warmMarkdown }
})() })
