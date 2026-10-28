import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsProvider } from '../src/renderer/src/lib/settings'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
import { AssistantCapturedReadPreview, AssistantTimelineReadAction } from '../src/renderer/src/pages/assistant/AssistantTimelineReadAction'
import { getAssistantCapturedRead } from '../src/renderer/src/pages/assistant/assistant-action-presentation'
import { areActivitiesEquivalent } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const createdAt = '2026-09-03T12:00:00.000Z'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFsUAAAAASUVORK5CYII='
function read(id: string, path: string, payload: Record<string, unknown> = {}): AssistantActivity {
    return { id, kind: 'file-read', tone: 'tool', summary: 'Read file', turnId: 'turn', createdAt, payload: { toolName: 'read', status: 'completed', paths: [path], ...payload } }
}
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(SettingsProvider, null, element))
const preview = (activity: AssistantActivity) => render(createElement(AssistantCapturedReadPreview, { activity, onClose: () => undefined }))
const image = read('image', 'C:/workspace/assets/screenshot.png', { output: 'Read image file [image/png]', readIsImage: true, result: { content: [{ type: 'image', mimeType: 'image/png', data: png }] } })
assert.equal(getAssistantCapturedRead(image), null, 'image results cannot masquerade as captured source text')
assert.match(render(createElement(AssistantTimelineReadAction, { activity: image })), /lucide-image/, 'image reads use an image icon')
assert.match(preview(image), /data-assistant-read-media="image"/)
assert.match(preview(image), /src="data:image\/png;base64,/, 'captured bytes take precedence over the mutable file')
assert.doesNotMatch(preview(image), /data-assistant-read-snapshot="exact"|captured lines|Read image file \[image\/png\]/)
const fileImage = read('file-image', 'C:/workspace/assets/old screenshot.PNG', { readIsImage: true })
assert.match(preview(fileImage), /data-assistant-read-source="file"/, 'stripped legacy image bodies still open the file as an image')
assert.match(preview(fileImage), /zyra:\/\/\/C:\/workspace\/assets\/old%20screenshot.PNG/, 'local media uses the existing file protocol')
for (const [extension, tag, icon] of [['mp4', 'video', 'film'], ['wav', 'audio', 'music4']] as const) {
    const media = read(extension, `C:/workspace/clip.${extension}`, { output: 'Binary file' })
    assert.equal(getAssistantCapturedRead(media), null)
    const markup = preview(media)
    if (tag === 'audio') {
        assert.match(markup, /data-audio-player=""/, 'captured audio uses the shared custom controls')
        assert.match(markup, /aria-label="Play clip.wav"/)
        assert.doesNotMatch(markup.match(/<audio\b[^>]*>/)?.[0] || '', /\bcontrols(?:=|\s|>)/, 'custom and native audio controls never overlap')
    } else assert.match(markup, /<video[^>]*controls=""/)
    assert.doesNotMatch(preview(media), /autoplay|data-assistant-read-snapshot="exact"/)
    assert.match(render(createElement(AssistantTimelineReadAction, { activity: media })), new RegExp(`lucide-${icon}`))
}
const binary = read('binary', 'C:/workspace/archive.zip', { output: '\u0000binary' })
assert.equal(getAssistantCapturedRead(binary), null)
assert.match(preview(binary), /No preview available/)
assert.doesNotMatch(preview(binary), /data-syntax-preview|data-assistant-read-snapshot="exact"/)
const text = read('text', 'C:/workspace/app.ts', { output: '\nconst middle = true\n\n[Showing lines 20-22 of 80]', readStartLine: 20, readEndLine: 22, readTotalLines: 80 })
assert.equal(getAssistantCapturedRead(text)?.content, '\nconst middle = true\n', 'text snapshots retain exact captured whitespace and range')
assert.match(preview(text), /data-assistant-read-snapshot="exact"/)
assert.match(preview(text), /data-syntax-preview-line-start="20"/)
assert.match(preview(text), /inmemory:\/\/zyra\/captured-read\//)
assert.doesNotMatch(preview(text), /Showing lines/)
const failed = read('failed', 'C:/workspace/missing.png', { status: 'failed', output: 'ENOENT: file not found' })
assert.equal(getAssistantCapturedRead(failed), null)
assert.match(preview(failed), /role="alert"/)
assert.match(preview(failed), /ENOENT/)
assert.doesNotMatch(preview(failed), /data-assistant-read-media=|src="(?:zyra|file):|data-assistant-read-snapshot="exact"/, 'failed reads do not silently fetch another file')
const imageBeforeBytes = { ...image, payload: { ...image.payload, result: undefined } }
assert.equal(areActivitiesEquivalent(imageBeforeBytes, image), false, 'late captured image bytes must invalidate memoized rows')
assert.equal(areActivitiesEquivalent(image, image), true)
console.log('PASS: typed image/video/audio/binary reads, exact text snapshots, icons, failed reads and late media evidence')
