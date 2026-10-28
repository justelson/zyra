import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareMarkdownRender } from '../src/renderer/src/components/ui/MarkdownRenderer'
import { resolveProtocolFilePath } from '../src/main/local-file-content'

// Execute the real prompt injector without starting a provider session or reading credentials.
const sdk = readFileSync(new URL('../../src/zyra-sdk.mjs', import.meta.url), 'utf8')
const promptFunctions = sdk.slice(sdk.indexOf('function readSessionSystemPrompt('), sdk.indexOf('function refreshZyraPromptContext('))
assert.ok(promptFunctions.includes('function injectSurfaceGuide('))
const context = runInNewContext(`${promptFunctions}\n({ injectSurfaceGuide })`, { ZYRA_DESKTOP_UI_MARKER: 'ZYRA_DESKTOP_UI_SURFACE' })
const session = { _baseSystemPrompt: 'Existing instructions.', agent: { state: { systemPrompt: '' } } }
context.injectSurfaceGuide(session, 'desktop-ui')
const guide = session._baseSystemPrompt
assert.match(guide, /inline images, videos and audio/, 'the agent must know the renderer supports media')
assert.match(guide, /file:\/\/\/C:\/Users\/example\/Videos\/chat%20debug\.mp4/, 'the guide supplies a Windows filename-with-spaces example')
assert.match(guide, /backticks|code-formatted/, 'the guide distinguishes an embed from a file chip')
assert.match(guide, /never autoplay/i)
assert.match(guide, /verified|verify/i, 'the guide must not encourage fabricated file paths')
context.injectSurfaceGuide(session, 'desktop-ui')
assert.equal((session._baseSystemPrompt.match(/<ZYRA_DESKTOP_UI_SURFACE>/g) || []).length, 1, 'refreshing the guide is idempotent')
assert.equal(session.agent.state.systemPrompt, session._baseSystemPrompt)
const serverSession = { _baseSystemPrompt: 'Existing instructions.' }
context.injectSurfaceGuide(serverSession, 'agent-server')
assert.equal(serverSession._baseSystemPrompt, guide, 'shared Desktop sessions receive the same media instructions')
for (const surface of ['tui', 'memory-worker']) {
    const other = { _baseSystemPrompt: 'Existing instructions.' }
    context.injectSurfaceGuide(other, surface)
    assert.equal(other._baseSystemPrompt, 'Existing instructions.', `${surface} does not inherit Desktop-only embedding claims`)
}

function render(content: string, filePath?: string, mediaMode: 'none' | 'images' | 'images-and-videos' = 'images-and-videos'): string {
    return renderToStaticMarkup(createElement(Fragment, null, prepareMarkdownRender({ content, filePath, mediaMode })))
}
function videoSource(markup: string): string {
    const tag = markup.match(/<video\b[^>]*>/)?.[0] || ''
    assert.match(tag, /controls=""/)
    assert.match(tag, /preload="metadata"/)
    assert.doesNotMatch(tag, /autoplay/i)
    const source = tag.match(/\bsrc="([^"]+)"/)?.[1]
    assert.ok(source)
    return source.replace(/&amp;/g, '&')
}

const videoExample = guide.match(/(?<!!)\[Chat debug\]\(file:\/\/\/[^)]+\)/)?.[0]
const imageExample = guide.match(/!\[Screenshot\]\(file:\/\/\/[^)]+\)/)?.[0]
assert.ok(videoExample, 'extract the exact video syntax taught to the agent')
assert.ok(imageExample, 'extract the exact image syntax taught to the agent')
for (const base of [undefined, 'C:/workspace/response.md']) {
    const source = videoSource(render(videoExample, base))
    assert.equal(source, 'zyra:///C:/Users/example/Videos/chat%20debug.mp4')
    assert.equal(resolveProtocolFilePath(source).replace(/^\//, ''), 'C:/Users/example/Videos/chat debug.mp4')
    assert.match(render(imageExample, base), /<img[^>]*src="zyra:\/\/\/C:\/Users\/example\/Pictures\/screen%20shot\.png"/)
}
for (const [encoded, decoded] of [
    ['chat%20debug.mp4', 'chat debug.mp4'],
    ['take%20%231%20%28100%25%29.mp4', 'take #1 (100%).mp4'],
    ['literal%2520name.mp4', 'literal%20name.mp4'],
    ['%E6%B5%8B%E8%AF%95.mp4', '测试.mp4']
]) {
    const source = videoSource(render(`[Recording](./${encoded})`, 'C:/workspace/response.md'))
    assert.equal(resolveProtocolFilePath(source).replace(/^\//, ''), `C:/workspace/${decoded}`, 'local URL path is decoded exactly once')
}
for (const base of [undefined, 'C:/workspace/response.md']) {
    assert.match(render('[View the graded frame](C:/workspace/graded-frame.png)', base, 'images'), /data-markdown-file-link=""[^>]*|class="markdown-inline-file-tag"/, 'ordinary documents keep an actionable local target rather than a stripped, decorative link')
    assert.match(render('[View the graded frame](C:/workspace/graded-frame.png)', base), /data-markdown-image-target="C:\/workspace\/graded-frame.png"/, 'final response image links become an openable embedded image')
    assert.match(render('![Graded frame](C:/workspace/graded-frame.png)', base), /<img[^>]*src="zyra:\/\/\/C:\/workspace\/graded-frame.png"/, 'plain Windows image destinations survive sanitization')
    assert.equal(videoSource(render('[Recording](C:/workspace/recording.mp4)', base)), 'zyra:///C:/workspace/recording.mp4', 'plain Windows video destinations survive sanitization')
}
for (const [href, expected] of [
    ['C:/workspace/take%20%231.wav', 'zyra:///C:/workspace/take%20%231.wav'],
    ['file:///C:/workspace/music.mp3', 'zyra:///C:/workspace/music.mp3'],
    ['./music.m4a', 'zyra:///C:/workspace/music.m4a'],
    ['https://example.com/music.ogg?token=public', 'https://example.com/music.ogg?token=public']
]) {
    const markup = render(`[Listen](${href})`, 'C:/workspace/response.md')
    assert.match(markup, /data-audio-player=""/, 'audio embeds use the shared custom player')
    assert.match(markup, /<audio[^>]*preload="metadata"/)
    assert.doesNotMatch(markup.match(/<audio\b[^>]*>/)?.[0] || '', /\bcontrols(?:=|\s|>)/, 'the native control bar is never rendered alongside custom controls')
    assert.match(markup, /aria-label="Play Listen"/)
    assert.match(markup, /type="range"[^>]*aria-label="Seek Listen"/)
    assert.match(markup, /data-markdown-audio-target=/)
    assert.ok(markup.includes(`src="${expected}"`))
    assert.doesNotMatch(markup, /autoplay/i)
    assert.doesNotMatch(render(`[Listen](${href})`, 'C:/workspace/response.md', 'none'), /<audio/)
    assert.doesNotMatch(render(`[Listen](${href})`, 'C:/workspace/response.md', 'images'), /<audio/)
}
assert.doesNotMatch(render('[Unsafe](javascript:alert%281%29.mp3)'), /<audio|javascript:|<a\b/i, 'unsafe schemes cannot turn into players or misleading dead anchors')
assert.doesNotMatch(render('<img src="javascript:alert(1)" onerror="alert(1)"/><a href="evil:payload.mp4">unsafe</a>'), /javascript:|onerror|evil:|<video/i)
assert.match(render('<a href="C:/workspace/frame.png">View</a>', undefined, 'images'), /data-markdown-file-link=/, 'raw HTML drive destinations use the same safe normalization')
assert.doesNotMatch(render('`C:\\Users\\example\\Videos\\chat debug.mp4`'), /<video\b/, 'code-formatted paths retain file-chip behavior')
assert.doesNotMatch(render(videoExample, undefined, 'images'), /<video\b/, 'ordinary documents retain link behavior')
const narrationMarkup = render(`${videoExample}\n\n${imageExample}`, undefined, 'none')
assert.doesNotMatch(narrationMarkup, /<video\b|data-markdown-image-target=/, 'Work narration does not embed media; file-chip icons remain allowed')
assert.match(narrationMarkup, /data-markdown-media-suppressed="image"/)
assert.doesNotMatch(render('[Unsafe](javascript:alert%281%29.mp4)'), /<video\b|javascript:/i)
assert.equal(videoSource(render('[Demo](https://example.com/demo.mp4?token=public#t=1)')), 'https://example.com/demo.mp4?token=public#t=1')
const shell = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
assert.match(shell, /media-src[^;]*https:/, 'the packaged page policy permits the HTTPS video links supported by the renderer')

// The native smoke runner supplies its own temporary output and a read-only input file.
if (process.env.ZYRA_MEDIA_TEST_FILE && process.env.ZYRA_MEDIA_TEST_HTML) {
    const destination = (path: string) => process.platform === 'win32' ? path.replace(/\\/g, '/').replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23').replace(/\(/g, '%28').replace(/\)/g, '%29') : pathToFileURL(path).href
    const content = [
        `[Recording](${destination(process.env.ZYRA_MEDIA_TEST_FILE)})`,
        process.env.ZYRA_MEDIA_TEST_AUDIO ? `[Listen](${destination(process.env.ZYRA_MEDIA_TEST_AUDIO)})` : '',
        process.env.ZYRA_MEDIA_TEST_IMAGE ? `[View the graded frame](${destination(process.env.ZYRA_MEDIA_TEST_IMAGE)})` : ''
    ].filter(Boolean).join('\n\n')
    const markup = render(content)
    videoSource(markup)
    const csp = shell.match(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
    assert.ok(csp)
    writeFileSync(process.env.ZYRA_MEDIA_TEST_HTML, `<!doctype html><html><head>${csp}</head><body>${markup}</body></html>`)
}
console.log('Assistant media prompt, Windows paths, renderer, and page policy: ok')
