import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import MarkdownRenderer, { getMarkdownRenderCacheStats } from '../../src/renderer/src/components/ui/MarkdownRenderer'
import { StreamingAssistantMarkdown, CompletedAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import { serializeRenderedMarkdownFragment } from '../../src/renderer/src/components/ui/markdown/markdownClipboard'
import { useAssistantVisibleText } from '../../src/renderer/src/pages/assistant/useAssistantVisibleText'
import { STREAMING_MARKDOWN_INTERVAL_MS } from '../../src/renderer/src/pages/assistant/useStreamingMarkdownContent'

Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
const root = createRoot(document.getElementById('root')!)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
const until = async (test: () => boolean, message: string) => { for (let i = 0; i < 180; i++) { if (test()) return; await wait(10) } throw new Error(message + ' DOM: ' + document.getElementById('root')!.innerHTML.slice(0, 1600)) }
function Response({ id, text, streaming, mode }: { id: string; text: string; streaming: boolean; mode: 'stream' | 'chunks' }) {
    const visible = useAssistantVisibleText({ streamId: id, channel: 'message', text, streaming, mode })
    return visible.presenting ? <StreamingAssistantMarkdown content={visible.text} cacheKey={id} fadeStreamingText={mode === 'stream'} /> : <CompletedAssistantMarkdown content={visible.text} cacheKey={id} />
}
const response = (id: string, text: string, streaming: boolean, mode: 'stream' | 'chunks') => flushSync(() => root.render(<Response key={id} id={id} text={text} streaming={streaming} mode={mode} />))
const progress = (stage: string) => {
    ;(window as any).chatDisplayProgress = { stage, at: performance.now() }
    console.log(`CHAT_PROGRESS: ${stage}`)
}
;(window as any).chatDisplayCheck = (async () => {
    progress('history mount')
    response('live', 'Existing prefix', true, 'stream')
    await wait(300)
    assert(document.getElementById('root')!.textContent === 'Existing prefix', 'History is immediate')
    assert(!document.querySelector('.assistant-stream-token'), 'History mount never fades')
    progress('live suffix fade')
    response('live', 'Existing prefix grows a little.', true, 'stream')
    await until(() => Boolean(document.querySelector('.assistant-stream-token')), 'New tokens must fade in the actual Markdown renderer')
    const token = document.querySelector<HTMLElement>('.assistant-stream-token')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    assert(getComputedStyle(token).animationName === (reduced ? 'none' : 'assistant-token-in'), 'Native reduced motion disables the fade')
    assert(reduced ? Number(getComputedStyle(token).opacity) === 1 : Number(getComputedStyle(token).opacity) < 1, 'New tokens fade only when motion is allowed')
    assert(!token.textContent?.includes('Existing prefix'), 'Old prose is not animated again')
    await until(() => document.getElementById('root')!.textContent === 'Existing prefix grows a little.', 'Live text drains without loss')
    progress('selection pause/resume')
    const text = document.querySelector('[data-assistant-stream-text]')!.firstChild!
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4)
    document.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'))
    await wait(20)
    const before = document.getElementById('root')!.textContent
    response('live', 'Existing prefix grows a little. While selected.', true, 'stream')
    await wait(140)
    assert(document.getElementById('root')!.textContent === before && document.getSelection()!.toString() === 'Exis', 'Selection pauses both reveal and token cleanup')
    document.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange'))
    await until(() => document.getElementById('root')!.textContent?.endsWith('While selected.') === true, 'Selection release resumes presentation')
    await wait(350)
    assert(!document.querySelector('.assistant-stream-token'), 'Idle animation pieces fold back into plain text')
    progress('chunk reveal')
    response('chunks', '', true, 'chunks')
    await wait(30)
    let frames = 0
    const original = window.requestAnimationFrame
    window.requestAnimationFrame = callback => { frames++; return original.call(window, callback) }
    response('chunks', 'Unfinished paragraph', true, 'chunks')
    await wait(180)
    assert(!document.getElementById('root')!.textContent?.trim(), 'Chunk mode buffers unfinished prose')
    const after = frames; await wait(140)
    assert(frames === after, 'Waiting for a chunk does not run an idle animation loop')
    window.requestAnimationFrame = original
    response('chunks', 'One whole line\nSecond unfinished', true, 'chunks')
    await until(() => document.getElementById('root')!.textContent?.includes('One whole line') === true, 'Complete row arrives as one chunk')
    assert(!document.getElementById('root')!.textContent?.includes('Second'), 'The next partial line remains buffered')
    assert(!document.querySelector('.assistant-stream-token'), 'Chunk mode does not reveal fading word fragments')
    response('chunks', 'One whole line\nSecond unfinished', false, 'chunks')
    await until(() => document.getElementById('root')!.textContent?.includes('Second unfinished') === true, 'Completion flushes final line')
    const geometryProof: string[] = []
    for (const mode of ['stream', 'chunks'] as const) {
        progress(`paragraph geometry ${mode}`)
        const content = 'First paragraph wraps across a line while retaining proper spacing and its complete multiline Markdown context.\nThis sentence continues the first paragraph.\n\nSecond paragraph has a [reference][target].\n\nThird paragraph remains at the same position when the turn completes.\n\n[target]: https://example.com/docs\n'
        response(`paragraphs:${mode}`, '', true, mode)
        response(`paragraphs:${mode}`, content, true, mode)
        await until(() => document.querySelectorAll('#root p').length === 3 && !!document.querySelector('a[href="https://example.com/docs"]'), 'Live paragraphs and reference context must be complete')
        await wait(350)
        const before = [...document.querySelectorAll('#root p')].map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height, margin: getComputedStyle(node).marginBottom }))
        assert(before[0].margin === '16px' && before[1].margin === '16px', 'Streaming paragraphs already have their final sibling spacing')
        response(`paragraphs:${mode}`, content, false, mode)
        await until(() => !document.querySelector('[data-assistant-streaming-markdown]'), 'Completion must hand off to the final Markdown renderer')
        const after = [...document.querySelectorAll('#root p')].map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height, margin: getComputedStyle(node).marginBottom }))
        assert(JSON.stringify(after) === JSON.stringify(before), 'Completion must not reposition or resize already-rendered paragraphs in either mode')
        geometryProof.push(`${mode} paragraph geometry before = after: ${JSON.stringify(after)}`)
    }
    assert(STREAMING_MARKDOWN_INTERVAL_MS <= 100, 'Live compilation scheduling adds at most 100ms delay')
    const measurements: string[] = []
    for (const [label, largeContent] of [
        ['large paragraph', 'Ordinary paragraph text with words. '.repeat(470)],
        ['350 paragraphs', 'Settled paragraph with **bold** text and words.\n\n'.repeat(350)]
    ]) {
        // Reference compiler timings live in test-assistant-markdown-cache.tsx.
        // Keep this native 20s fixture focused on the mounted optimized path.
        progress(`performance throttle ${label}`)
        const renderLive = (content: string) => flushSync(() => root.render(<StreamingAssistantMarkdown content={content} cacheKey={`perf:${label}`} fadeStreamingText />))
        renderLive(largeContent)
        const baseline = getMarkdownRenderCacheStats()
        const startedAt = performance.now()
        for (let i = 1; i <= 40; i++) {
            renderLive(largeContent + 'x'.repeat(i))
            await wait(4)
        }
        await until(() => document.getElementById('root')!.textContent?.endsWith('x'.repeat(40)) === true, 'Throttled live document must flush the latest update without waiting for completion')
        const after = getMarkdownRenderCacheStats()
        const compilations = after.compilations - baseline.compilations
        const compileMs = after.compilationMilliseconds - baseline.compilationMilliseconds
        measurements.push(`${label} (${largeContent.length} chars): 40 mounted reveal updates, ${compilations} parses/${compileMs.toFixed(1)}ms compilation, ${(performance.now() - startedAt).toFixed(1)}ms elapsed`)
        // Bound parse frequency independently of machine-specific parse duration.
        assert(compilations < 20, `Rapid reveal updates must coalesce full-document parses: ${measurements.at(-1)}`)
        assert(after.entries === baseline.entries, 'Live versions must not fill the completed document cache')
        renderLive(largeContent + 'x'.repeat(41))
        const finalContent = largeContent + 'x'.repeat(42)
        flushSync(() => root.render(<CompletedAssistantMarkdown content={finalContent} cacheKey={`perf:${label}`} />))
        assert(document.getElementById('root')!.textContent?.endsWith('x'.repeat(42)), 'Completion bypasses any live compilation timer and renders final content synchronously')
        await wait(120)
        assert(!document.querySelector('[data-assistant-streaming-markdown]'), 'Unmount cancels the pending live compilation')
    }
    progress('math document.fonts.ready')
    flushSync(() => root.render(<MarkdownRenderer content={'Inline $E=mc^2$.\n\n$$\n\\frac{1}{2}+\\sum_{i=1}^{n}i\n$$'} interactionLayerEnabled={false} />))
    await document.fonts.ready
    const copied = serializeRenderedMarkdownFragment(document.getElementById('root')!)
    assert(copied.includes('$E=mc^2$') && copied.includes('\\frac{1}{2}') && !copied.includes('katex') && copied.split('E=mc^2').length === 2, 'DOM copy uses canonical TeX once, not duplicated visual/MathML text')
    assert(document.querySelectorAll('.katex').length === 2 && document.querySelector('math'), 'Real DOM renders both math forms and MathML')
    assert(getComputedStyle(document.querySelector('.katex')!).fontFamily.includes('KaTeX'), 'Packaged stylesheet reaches formula typography')
    progress('math local font load')
    const fonts = await document.fonts.load('16px KaTeX_Main')
    assert(fonts.length > 0 && fonts.every(font => font.status === 'loaded'), 'Local formula fonts actually load under the app CSP')
    return ['actual live Markdown suffix opacity fade, immediate history and bounded cleanup', 'selection preservation during reveal and cleanup', 'whole-line chunks, no idle rAF and atomic completion', ...geometryProof, ...measurements, 'KaTeX/MathML DOM and local formula stylesheet', reduced ? 'native reduced-motion immediate text and disabled opacity animation' : 'native motion-enabled opacity animation']
})()
;(window as any).chatDisplayShowcase = async () => {
    flushSync(() => root.render(<MarkdownRenderer content={'# Equations in chat\n\nInline math stays with the sentence: $E=mc^2$.\n\n\\[\\begin{pmatrix}a & b\\\\c & d\\end{pmatrix}\\]\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\nCode remains literal: `$x^2$`.'} interactionLayerEnabled={false} />))
    await document.fonts.ready
}
