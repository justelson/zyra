import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRenderer from '../src/renderer/src/components/ui/MarkdownRenderer'
import { clearMathRenderCache, getMathRenderCacheStats, normalizeMathDelimiters } from '../src/renderer/src/components/ui/markdown/math'
const render = (content: string) => renderToStaticMarkup(createElement(MarkdownRenderer, { content, interactionLayerEnabled: false }))
const inline = render('Energy $E = mc^2$ and \\(a^2 + b^2 = c^2\\).')
assert.match(inline, /class="katex"/, 'Inline TeX must render math, not literal dollar signs')
assert.equal((inline.match(/class="katex"/g) || []).length, 2, 'Both common inline delimiters render')
const display = render('$$\n\\frac{1}{2} + \\sum_{i=1}^{n} i\n$$\n\n\\[\\begin{pmatrix}a & b\\\\c & d\\end{pmatrix}\\]')
assert.equal((display.match(/katex-display/g) || []).length, 2, 'Both display delimiters render')
assert.match(display, /<math[\s>]/, 'MathML supplies accessible formula content')
assert.match(display, /data-markdown-copy=/, 'Formula copies preserve source TeX')
assert.match(render('$$x^2$$'), /katex-display/, 'Compact whole-line display delimiters still render a display equation')
assert.doesNotMatch(render('`$x$`\n\n```tex\n\\[x^2\\]\n```'), /class="katex"/, 'Code examples remain literal')
for (const price of ['Budget $5 and $10.', 'Plans cost $5/month or $10/year.', 'The range is $5-$10.']) assert.doesNotMatch(render(price), /class="katex"/, 'Ordinary currency is not an equation')
assert.doesNotMatch(render('$' + 'x'.repeat(9000) + '$'), /class="katex"/, 'Oversized equations fall back without expensive TeX processing')
const hostile = render('$\\href{javascript:alert(1)}{click}$\n\n<img src=x onerror="alert(1)"><script>alert(1)</script>')
assert.doesNotMatch(hostile, /href="javascript:|onerror=|<script/, 'Math must not relax the Markdown sanitizer or enable trusted TeX HTML')
assert.doesNotThrow(() => render('$\\frac{1$'), 'Bad TeX must not crash a message')
assert.doesNotMatch(render('$$\n\\frac{1'), /class="katex"/, 'Unclosed display math stays readable until complete')
clearMathRenderCache()
const transient = (content: string) => renderToStaticMarkup(createElement(MarkdownRenderer, { content, transient: true, interactionLayerEnabled: false }))
transient('$x^2$ tail')
const count = getMathRenderCacheStats().compilations
assert.match(transient('$x^2$ tail grows'), /class="katex"/)
assert.equal(getMathRenderCacheStats().compilations, count, 'Unchanged formula output is reused while later prose streams')
for (let i = 0; i < 40; i++) transient(`$x_{${i}}$`)
assert(getMathRenderCacheStats().entries <= 32 && getMathRenderCacheStats().bytes <= 512 * 1024, 'Formula cache is entry/byte bounded')
assert.equal(normalizeMathDelimiters('\\('.repeat(10000)), '\\('.repeat(10000), 'Repeated unmatched delimiters stay literal without rescanning every suffix')
console.log('Chat math: inline/display delimiters, accessible TeX copying, code/currency preservation and safe malformed input passed')
