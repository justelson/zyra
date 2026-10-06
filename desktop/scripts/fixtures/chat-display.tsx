import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import MarkdownRenderer from '../../src/renderer/src/components/ui/MarkdownRenderer'
import { StreamingAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import { serializeRenderedMarkdownFragment } from '../../src/renderer/src/components/ui/markdown/markdownClipboard'
import { useAssistantVisibleText } from '../../src/renderer/src/pages/assistant/useAssistantVisibleText'

Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
const root = createRoot(document.getElementById('root')!)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
const until = async (test: () => boolean, message: string) => { for (let i = 0; i < 180; i++) { if (test()) return; await wait(10) } throw new Error(message + ' DOM: ' + document.getElementById('root')!.innerHTML.slice(0, 1600)) }
function Response({ id, text, streaming, mode }: { id: string; text: string; streaming: boolean; mode: 'stream' | 'chunks' }) {
    const visible = useAssistantVisibleText({ streamId: id, channel: 'message', text, streaming, mode })
    return visible.presenting ? <StreamingAssistantMarkdown content={visible.text} cacheKey={id} fadeStreamingText={mode === 'stream'} /> : <MarkdownRenderer content={visible.text} interactionLayerEnabled={false} />
}
const response = (id: string, text: string, streaming: boolean, mode: 'stream' | 'chunks') => flushSync(() => root.render(<Response key={id} id={id} text={text} streaming={streaming} mode={mode} />))
;(window as any).chatDisplayCheck = (async () => {
    response('live', 'Existing prefix', true, 'stream')
    await wait(300)
    assert(document.getElementById('root')!.textContent === 'Existing prefix', 'History is immediate')
    assert(!document.querySelector('.assistant-stream-token'), 'History mount never fades')
    response('live', 'Existing prefix grows a little.', true, 'stream')
    await until(() => Boolean(document.querySelector('.assistant-stream-token')), 'New tokens must fade in the actual Markdown renderer')
    const token = document.querySelector<HTMLElement>('.assistant-stream-token')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    assert(getComputedStyle(token).animationName === (reduced ? 'none' : 'assistant-token-in'), 'Native reduced motion disables the fade')
    assert(reduced ? Number(getComputedStyle(token).opacity) === 1 : Number(getComputedStyle(token).opacity) < 1, 'New tokens fade only when motion is allowed')
    assert(!token.textContent?.includes('Existing prefix'), 'Old prose is not animated again')
    await until(() => document.getElementById('root')!.textContent === 'Existing prefix grows a little.', 'Live text drains without loss')
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
    flushSync(() => root.render(<MarkdownRenderer content={'Inline $E=mc^2$.\n\n$$\n\\frac{1}{2}+\\sum_{i=1}^{n}i\n$$'} interactionLayerEnabled={false} />))
    await document.fonts.ready
    const copied = serializeRenderedMarkdownFragment(document.getElementById('root')!)
    assert(copied.includes('$E=mc^2$') && copied.includes('\\frac{1}{2}') && !copied.includes('katex') && copied.split('E=mc^2').length === 2, 'DOM copy uses canonical TeX once, not duplicated visual/MathML text')
    assert(document.querySelectorAll('.katex').length === 2 && document.querySelector('math'), 'Real DOM renders both math forms and MathML')
    assert(getComputedStyle(document.querySelector('.katex')!).fontFamily.includes('KaTeX'), 'Packaged stylesheet reaches formula typography')
    const fonts = await document.fonts.load('16px KaTeX_Main')
    assert(fonts.length > 0 && fonts.every(font => font.status === 'loaded'), 'Local formula fonts actually load under the app CSP')
    return ['actual live Markdown suffix opacity fade, immediate history and bounded cleanup', 'selection preservation during reveal and cleanup', 'whole-line chunks, no idle rAF and atomic completion', 'KaTeX/MathML DOM and local formula stylesheet', reduced ? 'native reduced-motion immediate text and disabled opacity animation' : 'native motion-enabled opacity animation']
})()
;(window as any).chatDisplayShowcase = async () => {
    flushSync(() => root.render(<MarkdownRenderer content={'# Equations in chat\n\nInline math stays with the sentence: $E=mc^2$.\n\n\\[\\begin{pmatrix}a & b\\\\c & d\\end{pmatrix}\\]\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\nCode remains literal: `$x^2$`.'} interactionLayerEnabled={false} />))
    await document.fonts.ready
}
