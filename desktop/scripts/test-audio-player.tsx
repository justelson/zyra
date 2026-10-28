import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AudioPlayer from '../src/renderer/src/components/ui/AudioPlayer'
import MediaPreviewContent from '../src/renderer/src/components/ui/file-preview/MediaPreviewContent'
import { prepareMarkdownRender } from '../src/renderer/src/components/ui/MarkdownRenderer'
import { parseMarkdownToHast } from '../src/renderer/src/components/ui/markdown/markdownPipeline'
import { formatAudioTime } from '../src/renderer/src/components/ui/audio-player-time'

for (const [input, expected] of [[0, '0:00'], [9.99, '0:09'], [162, '2:42'], [3600, '1:00:00'], [3661, '1:01:01'], [-5, '0:00'], [NaN, '0:00'], [Infinity, '0:00']] as const) assert.equal(formatAudioTime(input), expected)
const markup = renderToStaticMarkup(createElement(AudioPlayer, { src: '/sample.wav', label: 'Long audio' }))
assert.equal((markup.match(/<audio\b/g) || []).length, 1)
assert.match(markup, /<audio[^>]*hidden=""[^>]*preload="metadata"/)
assert.doesNotMatch(markup.match(/<audio\b[^>]*>/)![0], /\bcontrols(?:=|\s|>)|autoplay/i)
assert.match(markup, /aria-label="Play Long audio"/)
assert.match(markup, /aria-label="Seek Long audio"/)
assert.match(markup, /aria-label="Mute Long audio"/)
assert.match(markup, /aria-label="Playback speed for Long audio: 1x"/)
assert.match(markup, /disabled=""/, 'unknown duration cannot seek before metadata arrives')
assert.match(markup, /--:--/, 'unknown duration is not invented')
const filePreview = renderToStaticMarkup(createElement(MediaPreviewContent, { file: { path: 'C:/workspace/sample.wav', name: 'sample.wav', type: 'audio', content: '' } }))
assert.equal((filePreview.match(/data-audio-player=""/g) || []).length, 1)
assert.doesNotMatch(filePreview, /Audio Preview|<audio[^>]*controls/)
const previewSource = readFileSync(new URL('../src/renderer/src/components/ui/file-preview/MediaPreviewContent.tsx', import.meta.url), 'utf8')
assert.match(previewSource, /closest\?\.\('\[data-audio-player\]'\)/, 'player keys must not switch sibling files in the modal')
const repeatedAudio = '[Listen to the MP3](C:/workspace/clip.mp3)\n\n[WAV](C:/workspace/clip.wav)\n\n[Listen again](C:/workspace/clip.mp3)'
const grouped = renderToStaticMarkup(prepareMarkdownRender({ content: repeatedAudio, mediaMode: 'images-and-videos' }))
assert.equal((grouped.match(/data-audio-player=""/g) || []).length, 1, 'real messages render one player for repeated/multiple audio outputs')
assert.equal((grouped.match(/<option\b/g) || []).length, 2, 'distinct sources stay selectable, exact repeats do not become another option')
assert.match(grouped, /clip\.wav/, 'the WAV remains available rather than being silently removed')
const individual = renderToStaticMarkup(prepareMarkdownRender({ content: repeatedAudio, mediaMode: 'images-and-videos', audioPresentation: 'individual' }))
assert.equal((individual.match(/data-audio-player=""/g) || []).length, 3, 'the independent-player review explicitly opts out, including its cache key')
const tree = parseMarkdownToHast(repeatedAudio)
const originalTree = JSON.stringify(tree)
renderToStaticMarkup(prepareMarkdownRender({ content: repeatedAudio, cacheKey: 'audio:prepared', preparedTree: tree, mediaMode: 'images-and-videos' }))
assert.equal(JSON.stringify(tree), originalTree, 'presentation grouping cannot mutate a caller-owned prepared tree')
const onlyRepeated = renderToStaticMarkup(prepareMarkdownRender({ content: '[First](C:/workspace/clip.mp3)\n\n[Again](C:/workspace/clip.mp3)', mediaMode: 'images-and-videos' }))
assert.equal((onlyRepeated.match(/data-audio-player=""/g) || []).length, 1)
assert.doesNotMatch(onlyRepeated, /<select/, 'an exact repeat needs no fake extra choice')
const laterMessage = renderToStaticMarkup(prepareMarkdownRender({ content: '[Later message](C:/workspace/clip.mp3)', mediaMode: 'images-and-videos' }))
assert.match(laterMessage, /data-audio-player/, 'a previous message never suppresses a later message source')
const distinct = renderToStaticMarkup(prepareMarkdownRender({ content: repeatedAudio + '\n\n[Different recording](C:/workspace/other.mp3)', mediaMode: 'images-and-videos' }))
assert.equal((distinct.match(/<option\b/g) || []).length, 3)
assert.match(distinct, /Different recording/)
console.log('Custom audio: time formatting, one control set, accessible labels, unknown duration, shared viewer, source grouping, distinct options and prepared-tree/cache isolation: ok')
